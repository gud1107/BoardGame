import { BODY_R, FEAR_BEAT_1, NOISE_BOTTLE, NOISE_WALK, REVIVE_RANGE, SEARCH_MS, SPEED_CROUCH, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, type MoveMode } from "./data";
import { ALTAR, ALTAR_CELL, BLOCKED, CELL, COLS, CONTAINERS, DOORS, DOOR_AT, EXIT, KIND, ROWS, WALKABLE, cellX, cellZ, centerOf, colOf, collide, idx, nextCell, rowOf, throwLanding, walkCellAt, walkField } from "./map";
import { applyAct, ghostDist, hearMul, type HostRuntime, type PlayerState } from "./sim";

/**
 * 동료 봇 (빈자리 AI · 나간 사람 대신). 사람과 같은 정보만 쓴다: 귀신의 "딱…딱…" 소리가 들리는
 * 거리(13m) 안에서만 귀신 위치를 알고, 서랍 속은 열어 봐야 안다.
 *
 * 하는 일: 가까운 서랍 뒤지기 → 부적을 얻으면 제단으로 → 쓰러진 동료 일으키기 → 문이 열리면 현관으로.
 * 귀신이 가까우면 벽에 붙어 앉아 숨을 참고, 쫓기면 달아났다가 조용히 자리를 옮긴다.
 * 레벨이 낮을수록 늦게 반응하고(종이 울려도 몇 걸음 더 걷는다) 귀신 가까이에서도 그냥 걷는다.
 */

const HEAR_GHOST_R = 13;

interface Mem {
  stamina: number;
  /** 위험을 처음 알아챈 시각 (반응 지연용) */
  dangerAt: number;
  hushAt: number;
  mode: "work" | "flee" | "sneak";
  fleeCell: number;
  modeUntil: number;
  /** 뒤지는 중인 서랍 / 꽉 차서 못 가져간 서랍 */
  cont: number;
  usedMs: number;
  skip: number[];
  throwAt: number;
  lastX: number;
  lastZ: number;
  stuckMs: number;
}

function memOf(rt: HostRuntime, seat: number): Mem {
  let m = rt.mem[seat] as Mem | undefined;
  if (!m) {
    m = { stamina: 100, dangerAt: -1, hushAt: -1, mode: "work", fleeCell: -1, modeUntil: 0, cont: -1, usedMs: 0, skip: [], throwAt: 0, lastX: 0, lastZ: 0, stuckMs: 0 };
    rt.mem[seat] = m;
  }
  return m;
}

/** 서랍마다 다가설 칸 (서랍 칸의 상하좌우 중 걸을 수 있는 곳) */
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
const ALTAR_ACCESS = ALTAR_CELL + COLS;
const EXIT_CELL_IN = walkCellAt(EXIT.x, EXIT.z);

function moveToward(rt: HostRuntime, p: PlayerState, m: Mem, tx: number, tz: number, mode: MoveMode, dt: number): boolean {
  const s = rt.state;
  const speed = mode === 3 ? SPEED_RUN : mode === 2 ? SPEED_WALK : SPEED_CROUCH;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.06) {
    p.mv = 0;
    return true;
  }
  const step = Math.min(d, speed * dt);
  const pos = { x: p.x + (dx / d) * step, z: p.z + (dz / d) * step };
  collide(pos, s.doors, BODY_R);
  p.x = pos.x;
  p.z = pos.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = 0;
  p.mv = mode;
  p.cr = mode === 1;
  if (mode === 3) m.stamina = Math.max(0, m.stamina - STAMINA_DRAIN * dt);
  return false;
}

/** 길 따라 `target` 칸으로. 닫힌 문은 연다 (조심하면 앉아서 조용히). 그 칸에 들어서면 true. */
function travel(rt: HostRuntime, p: PlayerState, m: Mem, target: number, mode: MoveMode, dt: number, quietDoors: boolean): boolean {
  const s = rt.state;
  const here = walkCellAt(p.x, p.z);
  if (here === target) {
    const c = centerOf(target);
    return moveToward(rt, p, m, c.x, c.z, mode, dt) || Math.hypot(p.x - c.x, p.z - c.z) < 0.5;
  }
  const n = nextCell(here, target);
  if (n === here) return true;
  if (KIND[n] === 2 && !s.doors[DOOR_AT[n]]) {
    const was = p.cr;
    p.cr = quietDoors;
    p.mv = 0;
    applyAct(rt, p.seat, { k: "door", i: DOOR_AT[n] });
    p.cr = was;
    if (!s.doors[DOOR_AT[n]]) {
      // 아직 멀다 — 문 쪽으로 더 다가간다
      const d = DOORS[DOOR_AT[n]];
      moveToward(rt, p, m, d.x, d.z, mode, dt);
    }
    return false;
  }
  const c = centerOf(n);
  moveToward(rt, p, m, c.x, c.z, mode, dt);
  return false;
}

/** 벽에 바짝 붙을 자리 (복도 한가운데로 지나가는 귀신을 비켜 선다) */
function hugPoint(x: number, z: number): { x: number; z: number } | null {
  const cell = walkCellAt(x, z);
  if (KIND[cell] === 2) return null;
  const c = colOf(cell);
  const r = rowOf(cell);
  for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || KIND[idx(nc, nr)] !== 0) continue;
    return { x: cellX(c) + dc * (CELL / 2 - BODY_R - 0.01), z: cellZ(r) + dr * (CELL / 2 - BODY_R - 0.01) };
  }
  return null;
}

/** 귀신에게서 멀어질 칸: 내가 귀신보다 먼저 닿고, 귀신에게서 가장 먼 곳 */
function pickFlee(rt: HostRuntime, p: PlayerState, near: number, far: number): number {
  const g = rt.state.ghost;
  const fm = walkField(walkCellAt(p.x, p.z));
  const fg = walkField(walkCellAt(g.x, g.z));
  let best = -1;
  let bs = -Infinity;
  for (const c of WALKABLE) {
    if (fm[c] < near || fm[c] > far || KIND[c] === 2) continue;
    if (fg[c] < fm[c] + 3) continue;
    const sc = fg[c] - fm[c] * 0.4;
    if (sc > bs) {
      bs = sc;
      best = c;
    }
  }
  return best;
}

function tryThrow(rt: HostRuntime, p: PlayerState, m: Mem) {
  const s = rt.state;
  const g = s.ghost;
  if (p.bottles <= 0 || p.level < 4 || s.t < m.throwAt) return;
  const hunting = g.mode === "hunt";
  const coming = g.mode === "investigate" && Math.hypot(g.tx - p.x, g.tz - p.z) < 5;
  if (!hunting && !coming) return;
  const reach = NOISE_BOTTLE * hearMul(s);
  let best: { yaw: number; sc: number } | null = null;
  for (let k = 0; k < 12; k++) {
    const yaw = (k / 12) * Math.PI * 2;
    const land = throwLanding(p.x, p.z, yaw, 0.45, s.doors);
    if (land.dist < 5 || ghostDist(rt, land.x, land.z) > reach) continue;
    let sc = Infinity;
    for (const q of s.players) if (q.st === "alive" || q.st === "down") sc = Math.min(sc, Math.hypot(q.x - land.x, q.z - land.z));
    if (sc >= 5.5 && (!best || sc > best.sc)) best = { yaw, sc };
  }
  if (!best) return;
  m.throwAt = s.t + 9000;
  applyAct(rt, p.seat, { k: "throw", yaw: best.yaw, pitch: 0.45 });
}

export function botThink(rt: HostRuntime, seat: number, dtMs: number) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || p.st !== "alive") return;
  const m = memOf(rt, seat);
  const dt = dtMs / 1000;
  const g = s.ghost;
  const lvl = p.level;
  const careful = lvl >= 5;
  const delay = (10 - lvl) * 300;

  p.light = p.battery > 0;
  p.hb = false;
  if (p.mv !== 3) m.stamina = Math.min(100, m.stamina + STAMINA_REGEN * dt);
  if (p.pills > 0 && p.fear >= 70) applyAct(rt, seat, { k: "pill" });

  const awake = g.mode !== "sleep";
  const gdRaw = awake ? ghostDist(rt, p.x, p.z) : Infinity;
  const gd = gdRaw <= HEAR_GHOST_R ? gdRaw : Infinity;
  const hunted = g.mode === "hunt" && g.seat === seat;
  const wantBreath = () => {
    p.hb = p.fear >= FEAR_BEAT_1 - 4 && p.breath > 0.7 && s.t >= p.gaspUntil;
  };
  const freeze = () => {
    p.use = null;
    const hug = lvl >= 4 ? hugPoint(p.x, p.z) : null;
    if (hug && Math.hypot(hug.x - p.x, hug.z - p.z) > 0.08) moveToward(rt, p, m, hug.x, hug.z, 1, dt);
    else {
      p.mv = 0;
      p.cr = true;
    }
    wantBreath();
  };

  tryThrow(rt, p, m);

  // ── 정적(종): 멈춘다 ──
  if (s.hush.st !== "idle") {
    if (m.hushAt < 0) m.hushAt = s.t;
    if (s.t - m.hushAt >= delay * 0.8 && !hunted) {
      freeze();
      return;
    }
  } else m.hushAt = -1;

  // ── 쫓긴다: 달아났다가 조용히 자리를 옮긴다 ──
  if (hunted && m.mode === "work") {
    m.mode = "flee";
    m.fleeCell = pickFlee(rt, p, 8, 26);
    m.modeUntil = s.t + 6000;
  }
  if (m.mode === "flee") {
    p.use = null;
    const run: MoveMode = m.stamina > (p.mv === 3 ? 0 : STAMINA_MIN_RUN) ? 3 : 2;
    const arrived = m.fleeCell < 0 || travel(rt, p, m, m.fleeCell, run, dt, false);
    if (arrived || s.t >= m.modeUntil || (!hunted && gdRaw > 9)) {
      m.mode = "sneak";
      m.fleeCell = pickFlee(rt, p, 4, 12);
      m.modeUntil = s.t + 4500;
    }
    return;
  }
  if (m.mode === "sneak") {
    p.use = null;
    wantBreath();
    const arrived = m.fleeCell < 0 || travel(rt, p, m, m.fleeCell, 1, dt, true);
    if (arrived || s.t >= m.modeUntil) {
      if (hunted && gdRaw < 8 && m.stamina > STAMINA_MIN_RUN) {
        m.mode = "flee";
        m.fleeCell = pickFlee(rt, p, 8, 26);
        m.modeUntil = s.t + 5000;
      } else m.mode = "work";
    }
    return;
  }

  // ── 귀신이 가깝다: 벽에 붙어 숨죽인다 / 내 소리 난 곳으로 오면 살금살금 비킨다 ──
  const comingAtMe = g.mode === "investigate" && Math.hypot(g.tx - p.x, g.tz - p.z) < 3.5 && gdRaw < 16;
  const danger = (gd < 7 && g.mode !== "feed") || comingAtMe;
  if (danger) {
    if (m.dangerAt < 0) m.dangerAt = s.t;
    if (s.t - m.dangerAt >= delay) {
      if (comingAtMe && lvl >= 4) {
        m.mode = "sneak";
        m.fleeCell = pickFlee(rt, p, 4, 12);
        m.modeUntil = s.t + 5000;
        return;
      }
      freeze();
      return;
    }
  } else m.dangerAt = -1;

  // ── 할 일 ──
  // 귀신 소리가 들리는 거리에서는 앉아 걷는다 (레벨이 낮으면 그냥 걷는다)
  const margin = lvl >= 7 ? 3.5 : lvl >= 4 ? 1.5 : -2;
  const mode: MoveMode = gd < NOISE_WALK * hearMul(s) + margin ? 1 : 2;

  // 꽉 차서 못 가져간 서랍은 건너뛴다
  if (m.cont >= 0) {
    if (p.use === `c${m.cont}`) m.usedMs += dtMs;
    else {
      if (m.usedMs >= SEARCH_MS - 100 && !s.searched[m.cont]) m.skip.push(m.cont);
      m.cont = -1;
      m.usedMs = 0;
    }
  }

  const here = walkCellAt(p.x, p.z);
  const fm = walkField(here);

  // 쓰러진 동료 (다른 봇이 더 가까우면 맡긴다)
  const downed = s.players.filter((q) => q.st === "down" && ghostDist(rt, q.x, q.z) > 6);
  for (const q of downed) {
    const qc = walkCellAt(q.x, q.z);
    const mine = fm[qc];
    const closer = s.players.some((o) => o !== p && o.st === "alive" && (o.bot || o.away) && walkField(walkCellAt(o.x, o.z))[qc] < mine - 0.01);
    if (closer) continue;
    if (Math.hypot(p.x - q.x, p.z - q.z) <= REVIVE_RANGE) {
      p.mv = 0;
      p.cr = true;
      p.use = `r${q.seat}`;
      p.yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
    } else {
      p.use = null;
      if (travel(rt, p, m, qc, mode, dt, careful)) moveToward(rt, p, m, q.x, q.z, mode, dt);
    }
    return;
  }

  if (s.exitOpen) {
    p.use = null;
    if (travel(rt, p, m, EXIT_CELL_IN, mode, dt, careful)) moveToward(rt, p, m, EXIT.x, EXIT.z, mode, dt);
    return;
  }

  // 부적을 들었으면 제단으로
  if (p.tal > 0 && s.placed < s.need) {
    if (here === ALTAR_ACCESS && Math.hypot(p.x - cellX(colOf(ALTAR_ACCESS)), p.z - cellZ(rowOf(ALTAR_ACCESS))) < 0.6) {
      p.mv = 0;
      p.use = "a";
      p.yaw = Math.atan2(-(ALTAR.x - p.x), -(ALTAR.z - p.z));
    } else {
      p.use = null;
      travel(rt, p, m, ALTAR_ACCESS, mode, dt, careful);
    }
    return;
  }

  // 가장 가까운 안 뒤진 서랍 (다른 봇이 이미 뒤지는 곳은 빼고)
  let bestC = -1;
  let bestCell = -1;
  let bd = Infinity;
  for (const c of CONTAINERS) {
    if (s.searched[c.i] || m.skip.includes(c.i)) continue;
    if (s.players.some((o) => o !== p && o.st === "alive" && o.use === `c${c.i}`)) continue;
    for (const a of ACCESS[c.i]) {
      // 다른 봇이 훨씬 가까우면 양보 (같은 서랍으로 몰려가지 않게)
      let d = fm[a];
      for (const o of s.players) if (o !== p && o.st === "alive" && (o.bot || o.away) && o.tal === 0 && walkField(walkCellAt(o.x, o.z))[a] < d - 4) d += 30;
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
    } else {
      p.use = null;
      travel(rt, p, m, bestCell, mode, dt, careful);
    }
    return;
  }

  // 할 게 없다: 기도실 앞에서 기다린다
  p.use = null;
  const wait = ALTAR_ACCESS + COLS * 2;
  if (!travel(rt, p, m, wait, mode, dt, careful)) return;
  p.mv = 0;
}
