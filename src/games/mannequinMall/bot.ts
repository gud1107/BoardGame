import { BACK_MUL, BIND_RANGE, BODY_R, CREAK_R, STARE_RANGE, EYE, FLICKER_WARN_MS, MANNEQUIN_EYE_Y, REVIVE_RANGE, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, type MoveMode } from "./data";
import { BLOCKED, COLS, CONTAINERS, EXIT, PANEL, PANEL_CELL, ROWS, WALKABLE, cellX, cellZ, centerOf, clearLine, colOf, collide, idx, nextCell, pathDist, rowOf, walkCellAt, walkField } from "./map";
import { applyAct, sees, type HostRuntime, type Mannequin, type PlayerState } from "./sim";

/**
 * 동료 봇 (빈자리 AI · 나간 사람 대신). 사람과 비슷한 정보만 쓴다:
 * - 진열 자리를 기억해 두고, **눈으로 봤을 때 자리가 바뀐 마네킹**만 "살아 있다"고 의심한다
 *   (플래시·포장 끈으로 드러난 것도). 처음부터 누가 살아 있는지는 모른다.
 * - "삐걱" 소리(15m 안에서 움직임)가 들리면 그쪽을 돌아본다.
 *
 * 하는 일: 가까운 상자 뒤지기 → 퓨즈는 배전반으로 → 굳은 동료 풀어 주기 → 셔터가 열리면 정문으로.
 * 의심 가는 마네킹이 가까우면 **멈춰 서서 그것을 노려보고**, 너무 가까우면 보면서 뒷걸음질한다.
 * 동료가 뒤지는 중이면 동료 쪽으로 오는 마네킹을 대신 지켜 준다. 레벨이 낮을수록 늦게 돌아보고 덜 둘러본다.
 */

interface Mem {
  stamina: number;
  /** 마네킹별 마지막으로 본 자리 */
  seenX: number[];
  seenZ: number[];
  suspect: boolean[];
  heardAt: number;
  glanceUntil: number;
  glanceAt: number;
  glanceId: number;
  nextGlance: number;
  cont: number;
  usedMs: number;
  skip: number[];
  flashAt: number;
}

function memOf(rt: HostRuntime, seat: number): Mem {
  let m = rt.mem[seat] as Mem | undefined;
  if (!m) {
    const ms = rt.state.mannequins;
    m = {
      stamina: 100,
      seenX: ms.map((q) => q.x),
      seenZ: ms.map((q) => q.z),
      suspect: ms.map(() => false),
      heardAt: -1,
      glanceUntil: 0,
      glanceAt: 0,
      glanceId: -1,
      nextGlance: 0,
      cont: -1,
      usedMs: 0,
      skip: [],
      flashAt: 0,
    };
    rt.mem[seat] = m;
  }
  return m;
}

/** 상자마다 다가설 칸 */
const ACCESS: number[][] = CONTAINERS.map((c) => {
  const col = colOf(c.cell);
  const row = rowOf(c.cell);
  const out: number[] = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    if (!BLOCKED[idx(nc, nr)]) out.push(idx(nc, nr));
  }
  return out;
});
const PANEL_ACCESS = PANEL_CELL + COLS;
const EXIT_CELL_IN = walkCellAt(EXIT.x, EXIT.z);

function look(p: PlayerState, x: number, z: number) {
  p.yaw = Math.atan2(-(x - p.x), -(z - p.z));
  const flat = Math.max(0.3, Math.hypot(x - p.x, z - p.z));
  p.pitch = Math.atan2(MANNEQUIN_EYE_Y - EYE, flat);
}

function moveToward(rt: HostRuntime, p: PlayerState, m: Mem, tx: number, tz: number, mode: MoveMode, dt: number, face = true): boolean {
  const s = rt.state;
  const speed = mode === 3 ? SPEED_RUN : SPEED_WALK;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.06) {
    p.mv = 0;
    return true;
  }
  // 보면서 물러날 땐(face=false) 사람처럼 느리다
  const step = Math.min(d, speed * (face ? 1 : BACK_MUL) * dt);
  const pos = { x: p.x + (dx / d) * step, z: p.z + (dz / d) * step };
  collide(pos, BODY_R, s.mannequins);
  p.x = pos.x;
  p.z = pos.z;
  if (face) {
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = -0.05;
  }
  p.mv = mode;
  if (mode === 3) m.stamina = Math.max(0, m.stamina - STAMINA_DRAIN * dt);
  return false;
}

function travel(rt: HostRuntime, p: PlayerState, m: Mem, target: number, mode: MoveMode, dt: number): boolean {
  const here = walkCellAt(p.x, p.z);
  if (here === target) {
    const c = centerOf(target);
    return moveToward(rt, p, m, c.x, c.z, mode, dt) || Math.hypot(p.x - c.x, p.z - c.z) < 0.5;
  }
  const n = nextCell(here, target);
  if (n === here) return true;
  const c = centerOf(n);
  moveToward(rt, p, m, c.x, c.z, mode, dt);
  return false;
}

/** 마네킹 `q`에게서 멀어지는 이웃 칸 (보면서 뒷걸음질할 곳) */
function backAway(p: PlayerState, q: Mannequin): { x: number; z: number } | null {
  const here = walkCellAt(p.x, p.z);
  const f = walkField(walkCellAt(q.x, q.z));
  const c = colOf(here);
  const r = rowOf(here);
  let best = -1;
  let bs = f[here];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const n = idx(nc, nr);
      if (BLOCKED[n] || n === here) continue;
      if (dc !== 0 && dr !== 0 && (BLOCKED[idx(nc, r)] || BLOCKED[idx(c, nr)])) continue;
      // 물러난 곳에서도 그것이 보여야 한다
      if (!clearLine(cellX(nc), cellZ(nr), q.x, q.z)) continue;
      if (f[n] > bs) {
        bs = f[n];
        best = n;
      }
    }
  return best >= 0 ? centerOf(best) : null;
}

/** 지금 이 봇의 눈에 들어온 마네킹으로 기억을 고친다 */
function updateMemory(rt: HostRuntime, p: PlayerState, m: Mem) {
  const s = rt.state;
  const thr = p.level >= 8 ? 0.25 : p.level >= 4 ? 0.45 : 0.8;
  for (const q of s.mannequins) {
    if (q.revealUntil > s.t) m.suspect[q.id] = true;
    if (!sees(s, p, q.x, q.z)) continue;
    if (Math.hypot(q.x - m.seenX[q.id], q.z - m.seenZ[q.id]) > thr) m.suspect[q.id] = true;
    m.seenX[q.id] = q.x;
    m.seenZ[q.id] = q.z;
  }
}

export function botThink(rt: HostRuntime, seat: number, dtMs: number) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || p.st !== "alive") return;
  const m = memOf(rt, seat);
  const dt = dtMs / 1000;
  const lvl = p.level;
  const react = (10 - lvl) * 110;

  p.light = p.battery > 0;
  if (p.mv !== 3) m.stamina = Math.min(100, m.stamina + STAMINA_REGEN * dt);

  updateMemory(rt, p, m);

  // 삐걱 소리: 근처에서 무언가 움직인다
  const moving = s.mannequins.filter((q) => q.moving && Math.hypot(q.x - p.x, q.z - p.z) < CREAK_R);
  if (moving.length) {
    if (m.heardAt < 0) m.heardAt = s.t;
  } else m.heardAt = -1;
  const heard = m.heardAt >= 0 && s.t - m.heardAt >= react;

  // 지켜볼 대상: 의심 가는(또는 소리 난) 마네킹 중 우리 편 누군가에게 가장 가까운 것, 내 눈이 닿는 것
  const team = s.players.filter((q) => q.st === "alive");
  let threat: Mannequin | null = null;
  let tScore = Infinity;
  let tNear = Infinity;
  for (const q of s.mannequins) {
    const known = m.suspect[q.id] || (heard && q.moving);
    if (!known || s.t < q.boundUntil || s.t < q.downUntil) continue;
    const myD = Math.hypot(q.x - p.x, q.z - p.z);
    if (myD > 16 || !clearLine(p.x, p.z, q.x, q.z)) continue;
    // 다른 사람이 이미 보고 있으면 맡긴다 (내가 제일 가까우면 그래도 본다)
    const others = s.players.some((o) => o !== p && sees(s, o, q.x, q.z));
    let near = Infinity;
    for (const t of team) near = Math.min(near, pathDist(q.x, q.z, t.x, t.z));
    const sc = near + (others ? 6 : 0) + myD * 0.1;
    if (sc < tScore) {
      tScore = sc;
      threat = q;
      tNear = near;
    }
  }
  const guardR = lvl >= 7 ? 9 : lvl >= 4 ? 7 : 4.5;
  const flickerSoon = s.flicker.st === "warn" || (s.flicker.st === "idle" && s.flicker.at - s.t < FLICKER_WARN_MS * 0.5);

  // 📸 카메라: 가까이 둘 이상이거나, 정전 직전에 코앞이면
  if (threat && p.cameras > 0 && lvl >= 3 && s.t >= m.flashAt) {
    const close = s.mannequins.filter((q) => m.suspect[q.id] && s.t >= q.stunUntil && Math.hypot(q.x - p.x, q.z - p.z) < 7).length;
    if (close >= 2 || (flickerSoon && Math.hypot(threat.x - p.x, threat.z - p.z) < 6)) {
      look(p, threat.x, threat.z);
      applyAct(rt, seat, { k: "flash", yaw: p.yaw, pitch: p.pitch });
      m.flashAt = s.t + 4000;
    }
  }

  // 손전등이 닿는 거리면 쓰러질 때까지 노려본다 (레벨 3부터)
  const canGlare = !!threat && lvl >= 3 && p.battery > 3 && Math.hypot(threat.x - p.x, threat.z - p.z) <= STARE_RANGE - 0.5;
  if (threat && (tNear < guardR || flickerSoon || canGlare) && s.t >= threat.stunUntil) {
    // 노려본다
    p.use = null;
    const d = Math.hypot(threat.x - p.x, threat.z - p.z);
    // 🎀 바로 앞이면 묶는다
    if (p.ribbons > 0 && lvl >= 4 && d <= BIND_RANGE) {
      look(p, threat.x, threat.z);
      p.mv = 0;
      p.use = `m${threat.id}`;
      return;
    }
    if (d < (flickerSoon ? 6 : 2.6)) {
      const to = backAway(p, threat);
      if (to) moveToward(rt, p, m, to.x, to.z, 2, dt, false);
      else p.mv = 0;
    } else p.mv = 0;
    look(p, threat.x, threat.z);
    return;
  }

  // ── 할 일 ──
  if (m.cont >= 0) {
    if (p.use === `c${m.cont}`) m.usedMs += dtMs;
    else {
      if (m.usedMs >= 2000 && !s.searched[m.cont]) m.skip.push(m.cont);
      m.cont = -1;
      m.usedMs = 0;
    }
  }
  const here = walkCellAt(p.x, p.z);
  const fm = walkField(here);
  const mode: MoveMode = 2;
  let busy = false;

  const act = () => {
    // 굳은 동료
    for (const q of s.players) {
      if (q.st !== "down") continue;
      const qc = walkCellAt(q.x, q.z);
      const closer = s.players.some((o) => o !== p && o.st === "alive" && (o.bot || o.away) && walkField(walkCellAt(o.x, o.z))[qc] < fm[qc] - 0.01);
      if (closer) continue;
      if (Math.hypot(p.x - q.x, p.z - q.z) <= REVIVE_RANGE) {
        p.mv = 0;
        p.use = `r${q.seat}`;
        look(p, q.x, q.z);
        busy = true;
      } else {
        p.use = null;
        if (travel(rt, p, m, qc, mode, dt)) moveToward(rt, p, m, q.x, q.z, mode, dt);
      }
      return;
    }
    if (s.exitOpen) {
      p.use = null;
      const run: MoveMode = m.stamina > (p.mv === 3 ? 0 : STAMINA_MIN_RUN) && lvl >= 5 ? 3 : 2;
      if (travel(rt, p, m, EXIT_CELL_IN, run, dt)) moveToward(rt, p, m, EXIT.x, EXIT.z, run, dt);
      return;
    }
    if (p.fuses > 0 && s.placed < s.need) {
      const ac = centerOf(PANEL_ACCESS);
      if (here === PANEL_ACCESS && Math.hypot(p.x - ac.x, p.z - ac.z) < 0.6) {
        p.mv = 0;
        p.use = "p";
        p.yaw = Math.atan2(-(PANEL.x - p.x), -(PANEL.z - p.z));
        p.pitch = -0.1;
        busy = true;
      } else {
        p.use = null;
        travel(rt, p, m, PANEL_ACCESS, mode, dt);
      }
      return;
    }
    let bestC = -1;
    let bestCell = -1;
    let bd = Infinity;
    for (const c of CONTAINERS) {
      if (s.searched[c.i] || m.skip.includes(c.i)) continue;
      if (s.players.some((o) => o !== p && o.st === "alive" && o.use === `c${c.i}`)) continue;
      for (const a of ACCESS[c.i]) {
        let d = fm[a];
        for (const o of s.players) if (o !== p && o.st === "alive" && (o.bot || o.away) && o.fuses === 0 && walkField(walkCellAt(o.x, o.z))[a] < d - 4) d += 30;
        if (d < bd) {
          bd = d;
          bestC = c.i;
          bestCell = a;
        }
      }
    }
    if (bestC >= 0) {
      const c = CONTAINERS[bestC];
      const ac = centerOf(bestCell);
      if (here === bestCell && Math.hypot(p.x - ac.x, p.z - ac.z) < 0.6) {
        p.mv = 0;
        p.use = `c${bestC}`;
        p.yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
        p.pitch = -0.3;
        m.cont = bestC;
        busy = true;
      } else {
        p.use = null;
        travel(rt, p, m, bestCell, mode, dt);
      }
      return;
    }
    // 할 게 없다: 배전반 앞에서 기다리며 둘러본다
    p.use = null;
    if (travel(rt, p, m, PANEL_ACCESS + COLS, mode, dt)) p.mv = 0;
  };
  act();

  // 걷는 동안 가끔 뒤를 돌아본다 (진열 자리와 달라진 마네킹을 찾는다). 뒤지는 중엔 손을 멈춘다
  if (s.t >= m.nextGlance && lvl >= 2) {
    const cand = s.mannequins.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 12 && clearLine(p.x, p.z, q.x, q.z) && !sees(s, p, q.x, q.z));
    if (cand.length) {
      const q = cand.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
      m.glanceId = q.id;
      m.glanceUntil = s.t + 450;
    }
    m.nextGlance = s.t + (lvl >= 8 ? 1500 : lvl >= 5 ? 2400 : 3800) + (WALKABLE.length % 7) * 40;
  }
  if (s.t < m.glanceUntil && m.glanceId >= 0 && !busy) {
    const q = s.mannequins[m.glanceId];
    if (q) look(p, q.x, q.z);
  }
}
