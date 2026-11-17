import { BODY_R, GAUGE_MIN_ON, GRACE_MS, HEART_R, LUNGE_SPEED, RECOVER_MUL, SLOW_MUL, SPEED_CROUCH, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, TAG_SPEED, THAW_RANGE, type MoveMode } from "./data";
import { DOORS, DOOR_AT, EXITS, KIND, SPOTS, WALKABLE, accessCells, centerOf, clearLine, collide, nextCell, walkCellAt, walkField } from "./map";
import { applyAct, isExposed, isStunned, taggerHears, taggerOf, taggerRooted, yawTo, type HostRuntime, type PlayerState } from "./sim";

/**
 * 봇 (빈자리 AI · 나간 사람 대신) — 도망자와 술래 둘 다 한다. 사람과 같은 정보만 쓴다:
 * 도망자 봇은 **변장한 술래를 못 알아보고**(같은 편인 줄 안다), 가면 쓴 술래는 눈에 보이거나
 * 심장 소리가 날 만큼 가까울 때만 안다. 술래 봇은 눈에 보이는 도망자와 귀에 들리는 소리만 쫓는다.
 * 레벨이 낮을수록 늦게 알아채고, 술래는 멀리서부터 가면을 써 기운을 낭비하고 헛손질이 많다.
 */

interface Mem {
  stamina: number;
  /** 위험을 처음 알아챈 시각 / 마지막으로 느낀 시각 */
  seenAt: number;
  threatAt: number;
  mode: "work" | "flee";
  fleeCell: number;
  fleePickAt: number;
  /** 술래: 쫓는 자리 · 마지막으로 본 곳 */
  target: number;
  lastX: number;
  lastZ: number;
  lastAt: number;
  patrol: number;
  patrolUntil: number;
  /** 술래가 덮칠 때 굳힌 방향 */
  lungeYaw: number;
}

function memOf(rt: HostRuntime, seat: number): Mem {
  let m = rt.mem[seat] as Mem | undefined;
  if (!m) {
    m = { stamina: 100, seenAt: -1, threatAt: -99_999, mode: "work", fleeCell: -1, fleePickAt: 0, target: -1, lastX: 0, lastZ: 0, lastAt: -99_999, patrol: -1, patrolUntil: 0, lungeYaw: 0 };
    rt.mem[seat] = m;
  }
  return m;
}

/** 봉인 터마다 다가설 칸 */
const SPOT_ACCESS: number[][] = SPOTS.map((d) => accessCells(d.cell));
const EXIT_CELLS = EXITS.map((e) => walkCellAt(e.x, e.z));

function moveToward(rt: HostRuntime, p: PlayerState, tx: number, tz: number, speed: number, mv: MoveMode, dt: number): boolean {
  const s = rt.state;
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
  p.mv = mv;
  p.cr = mv === 1;
  return false;
}

/** 길 따라 `target` 칸으로. 닫힌 문은 연다(가면 쓴 술래는 부순다). 그 칸에 들어서면 true. */
function travel(rt: HostRuntime, p: PlayerState, target: number, speed: number, mv: MoveMode, dt: number): boolean {
  const s = rt.state;
  const here = walkCellAt(p.x, p.z);
  if (here === target) {
    const c = centerOf(target);
    return moveToward(rt, p, c.x, c.z, speed, mv, dt) || Math.hypot(p.x - c.x, p.z - c.z) < 0.5;
  }
  const n = nextCell(here, target);
  if (n === here) return true;
  if (KIND[n] === 2 && !s.doors[DOOR_AT[n]]) {
    const d = DOORS[DOOR_AT[n]];
    p.mv = 0;
    applyAct(rt, p.seat, { k: "door", i: d.i });
    if (!s.doors[d.i] && Math.hypot(p.x - d.x, p.z - d.z) > 1.3) moveToward(rt, p, d.x, d.z, speed, mv, dt);
    return false;
  }
  const c = centerOf(n);
  moveToward(rt, p, c.x, c.z, speed, mv, dt);
  return false;
}

/* ── 도망자 ─────────────────────────────────────────────────────────── */

/** 술래에게서 멀어질 칸: 내가 술래보다 먼저 닿고, 술래에게서 가장 먼 곳 */
function pickFlee(rt: HostRuntime, p: PlayerState, near: number, far: number): number {
  const t = taggerOf(rt.state);
  const fm = walkField(walkCellAt(p.x, p.z));
  const fg = walkField(walkCellAt(t.x, t.z));
  let best = -1;
  let bs = -Infinity;
  for (const c of WALKABLE) {
    if (fm[c] < near || fm[c] > far || KIND[c] === 2) continue;
    if (fg[c] < fm[c] + 2) continue;
    const sc = fg[c] - fm[c] * 0.45;
    if (sc > bs) {
      bs = sc;
      best = c;
    }
  }
  return best;
}

function runnerThink(rt: HostRuntime, p: PlayerState, m: Mem, dtMs: number) {
  const s = rt.state;
  const dt = dtMs / 1000;
  const lvl = p.level;
  const t = taggerOf(s);
  const tg = s.tg;
  const slow = s.t < p.slowUntil ? SLOW_MUL : 1;
  const speedOf = (mv: MoveMode) => (mv === 3 ? SPEED_RUN : mv === 2 ? SPEED_WALK : SPEED_CROUCH) * slow;

  p.light = true;
  if (p.mv !== 3) m.stamina = Math.min(100, m.stamina + STAMINA_REGEN * dt);

  // 위험: 가면(쓰는 중 포함)이 눈에 보이거나, 심장 소리가 아주 가깝거나, 정체가 드러난 변장
  const td = Math.hypot(t.x - p.x, t.z - p.z);
  const los = td < 16 && clearLine(p.x, p.z, t.x, t.z, s.doors);
  const scary = tg.form !== "kid";
  const threat = (scary && ((td < 15 && los) || td < HEART_R * 0.45)) || (!scary && isExposed(s) && td < 8 && los);
  if (threat) {
    if (m.seenAt < 0) m.seenAt = s.t;
    if (s.t - m.seenAt >= (10 - lvl) * 160) m.threatAt = s.t;
  } else m.seenAt = -1;
  const fleeing = s.t - m.threatAt < 3500;

  // 🧂 소금: 코앞까지 온 가면 술래에게 (레벨 4부터, 낮을수록 빗나간다)
  if (p.salt > 0 && lvl >= 4 && tg.form === "mask" && !isStunned(s) && td < 3.4 && los) {
    const err = lvl >= 8 ? 0 : (Math.sin(s.t * 0.013 + p.seat) * (9 - lvl)) / 14;
    applyAct(rt, p.seat, { k: "salt", yaw: yawTo(p.x, p.z, t.x, t.z) + err });
  }

  if (fleeing) {
    p.use = null;
    if (m.mode !== "flee" || s.t >= m.fleePickAt || m.fleeCell < 0) {
      m.mode = "flee";
      m.fleeCell = pickFlee(rt, p, lvl >= 5 ? 8 : 5, 30);
      m.fleePickAt = s.t + 2500;
    }
    const wantRun = td < 11 || lvl < 4;
    const run: MoveMode = wantRun && m.stamina > (p.mv === 3 ? 0 : STAMINA_MIN_RUN) ? 3 : 2;
    if (run === 3) m.stamina = Math.max(0, m.stamina - STAMINA_DRAIN * dt);
    if (m.fleeCell < 0 || travel(rt, p, m.fleeCell, speedOf(run), run, dt)) m.fleePickAt = 0;
    return;
  }
  m.mode = "work";

  // 심장 소리가 들릴 만큼 가깝다: 레벨이 높으면 손을 떼고 앉아서 숨는다
  const near = scary && td < HEART_R;
  if (near && td < 8 && lvl >= 6) {
    p.use = null;
    p.mv = 0;
    p.cr = true;
    return;
  }
  const mv: MoveMode = near && lvl >= 5 ? 1 : 2;
  const here = walkCellAt(p.x, p.z);
  const fm = walkField(here);

  // 교문이 열렸다
  if (s.gate === "open") {
    p.use = null;
    let best = 0;
    let bs = -Infinity;
    EXITS.forEach((e, i) => {
      const mine = fm[EXIT_CELLS[i]];
      const sc = lvl >= 5 && scary ? Math.min(40, Math.hypot(t.x - e.x, t.z - e.z)) * 0.6 - mine : -mine;
      if (sc > bs) {
        bs = sc;
        best = i;
      }
    });
    const run: MoveMode = m.stamina > (p.mv === 3 ? 0 : STAMINA_MIN_RUN) && fm[EXIT_CELLS[best]] < 14 ? 3 : 2;
    if (run === 3) m.stamina = Math.max(0, m.stamina - STAMINA_DRAIN * dt);
    if (travel(rt, p, EXIT_CELLS[best], speedOf(run), run, dt)) moveToward(rt, p, EXITS[best].x, EXITS[best].z, speedOf(run), run, dt);
    return;
  }

  // 얼음이 된 동료 — 술래가 지키고 있는 게 보이면 미룬다. 다른 봇이 더 가까우면 맡긴다.
  for (const q of s.players) {
    if (q.role !== "runner" || q.st !== "frozen") continue;
    if (scary && Math.hypot(t.x - q.x, t.z - q.z) < 9 && td < 16) continue;
    const qc = walkCellAt(q.x, q.z);
    const mine = fm[qc];
    const closer = s.players.some((o) => o !== p && o.role === "runner" && o.st === "alive" && (o.bot || o.away) && walkField(walkCellAt(o.x, o.z))[qc] < mine - 0.01);
    if (closer) continue;
    if (Math.hypot(p.x - q.x, p.z - q.z) <= THAW_RANGE) {
      p.mv = 0;
      p.use = `t${q.seat}`;
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
    } else {
      p.use = null;
      if (travel(rt, p, qc, speedOf(mv), mv, dt)) moveToward(rt, p, q.x, q.z, speedOf(mv), mv, dt);
    }
    return;
  }

  // 봉인 터: 가깝고, 진행된 곳 먼저. 이미 둘이 붙은 곳은 피한다.
  let bestK = -1;
  let bestCell = -1;
  let bd = Infinity;
  s.spots.forEach((sp, k) => {
    if (sp.done) return;
    const crowd = s.players.filter((o) => o !== p && o.st === "alive" && o.use === `s${k}`).length;
    for (const a of SPOT_ACCESS[sp.i]) {
      const d = fm[a] - sp.p * 12 + (crowd >= 2 ? 25 : crowd === 1 ? -3 : 0);
      if (d < bd) {
        bd = d;
        bestK = k;
        bestCell = a;
      }
    }
  });
  if (bestK >= 0) {
    const def = SPOTS[s.spots[bestK].i];
    const ac = centerOf(bestCell);
    if (here === bestCell && Math.hypot(p.x - ac.x, p.z - ac.z) < 0.6) {
      p.mv = 0;
      p.use = `s${bestK}`;
      p.yaw = yawTo(p.x, p.z, def.x, def.z);
    } else {
      p.use = null;
      travel(rt, p, bestCell, speedOf(mv), mv, dt);
    }
    return;
  }
  p.use = null;
  p.mv = 0;
}

/* ── 술래 ───────────────────────────────────────────────────────────── */

function taggerThink(rt: HostRuntime, p: PlayerState, m: Mem, dtMs: number) {
  const s = rt.state;
  const dt = dtMs / 1000;
  const lvl = p.level;
  const tg = s.tg;
  if (taggerRooted(s)) {
    p.mv = 0;
    return;
  }
  const masked = tg.form === "mask";
  p.light = !masked;

  // 덮치는 중: 굳힌 방향으로 돌진
  if (masked && s.t < tg.swingUntil) {
    const pos = { x: p.x - Math.sin(m.lungeYaw) * LUNGE_SPEED * dt, z: p.z - Math.cos(m.lungeYaw) * LUNGE_SPEED * dt };
    collide(pos, s.doors, BODY_R);
    p.x = pos.x;
    p.z = pos.z;
    p.yaw = m.lungeYaw;
    p.mv = 3;
    return;
  }

  // 보이거나 들리는 도망자 중 가장 가까운 사람
  const view = (masked ? 16 : 13) * (0.6 + 0.04 * lvl);
  let tgt: PlayerState | null = null;
  let bd = Infinity;
  for (const q of s.players) {
    if (q.role !== "runner" || q.st !== "alive") continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    const seen = d <= view && clearLine(p.x, p.z, q.x, q.z, s.doors);
    if (!seen && !taggerHears(s, q)) continue;
    const sc = d + (s.t < q.safeUntil ? 8 : 0);
    if (sc < bd) {
      bd = sc;
      tgt = q;
    }
  }
  if (tgt) {
    m.target = tgt.seat;
    m.lastX = tgt.x;
    m.lastZ = tgt.z;
    m.lastAt = s.t;
  }
  const fresh = s.t - m.lastAt < 6000;

  // 순찰할 봉인 터: 진행된 곳 먼저
  if (m.patrol < 0 || s.spots[m.patrol]?.done || s.t >= m.patrolUntil) {
    const open = s.spots.map((sp, k) => ({ sp, k })).filter((o) => !o.sp.done);
    if (open.length) {
      const hot = open.filter((o) => o.sp.p > 0.05);
      const pool = hot.length && lvl >= 4 ? hot : open;
      const pick = pool[Math.floor((((s.t / 1000) * 7 + p.seat * 3) % pool.length + pool.length) % pool.length)];
      m.patrol = pick.k;
    } else m.patrol = -1;
    m.patrolUntil = s.t + 14_000;
  }
  const patrolCell = m.patrol >= 0 ? (SPOT_ACCESS[s.spots[m.patrol].i][0] ?? -1) : s.gate !== "locked" ? EXIT_CELLS[Math.floor(s.t / 12_000) % EXIT_CELLS.length] : -1;

  if (!masked) {
    // 변장: 아이인 척 걸어서 다가간다. 충분히 가까워지면 가면을 쓴다.
    const need = lvl >= 6 ? 55 : GAUGE_MIN_ON;
    const maskDist = lvl >= 7 ? 5 : lvl >= 4 ? 8 : 13;
    if (tgt && s.t >= GRACE_MS && tg.gauge >= need && bd <= maskDist) {
      applyAct(rt, p.seat, { k: "mask", on: true });
      return;
    }
    p.use = null;
    if (tgt || fresh) {
      const c = walkCellAt(m.lastX, m.lastZ);
      if (travel(rt, p, c, SPEED_WALK, 2, dt)) p.mv = 0;
    } else if (patrolCell >= 0) {
      if (travel(rt, p, patrolCell, SPEED_WALK, 2, dt)) {
        p.mv = 0;
        // 봉인하는 시늉 (진행도는 안 오른다)
        if (m.patrol >= 0 && lvl >= 5) p.use = `s${m.patrol}`;
      }
    } else p.mv = 0;
    return;
  }

  // 가면
  const speed = TAG_SPEED * (s.t < tg.recoverUntil ? RECOVER_MUL : 1);
  if (tgt) {
    p.use = null;
    const d = Math.hypot(tgt.x - p.x, tgt.z - p.z);
    const los = clearLine(p.x, p.z, tgt.x, tgt.z, s.doors);
    const reach = lvl >= 6 ? 1.3 : lvl >= 3 ? 1.7 : 2.1;
    if (los && d <= reach && s.t >= tg.recoverUntil && s.t >= tgt.safeUntil) {
      m.lungeYaw = yawTo(p.x, p.z, tgt.x, tgt.z);
      p.yaw = m.lungeYaw;
      applyAct(rt, p.seat, { k: "hit" });
      return;
    }
    if (los && d < 5) moveToward(rt, p, tgt.x, tgt.z, speed, 3, dt);
    else travel(rt, p, walkCellAt(tgt.x, tgt.z), speed, 3, dt);
    return;
  }
  // 놓쳤다: 마지막으로 본 곳 → 순찰. 오래 못 찾으면 가면을 벗어 기운을 아낀다.
  if (s.t - m.lastAt > (lvl >= 5 ? 7000 : 12_000) && tg.gauge < 70) {
    applyAct(rt, p.seat, { k: "mask", on: false });
    return;
  }
  if (fresh) {
    p.use = null;
    if (travel(rt, p, walkCellAt(m.lastX, m.lastZ), speed, 3, dt)) m.lastAt = -99_999;
    return;
  }
  if (patrolCell >= 0) {
    if (travel(rt, p, patrolCell, speed, 3, dt)) {
      p.mv = 0;
      const sp = m.patrol >= 0 ? s.spots[m.patrol] : null;
      if (sp && !sp.done && sp.p > 0.08 && lvl >= 5) p.use = `k${m.patrol}`;
      else {
        p.use = null;
        m.patrolUntil = 0;
      }
    } else p.use = null;
    return;
  }
  p.mv = 0;
}

export function botThink(rt: HostRuntime, seat: number, dtMs: number) {
  const p = rt.state.players[seat];
  if (!p || p.st !== "alive") return;
  const m = memOf(rt, seat);
  if (p.role === "tagger") taggerThink(rt, p, m, dtMs);
  else runnerThink(rt, p, m, dtMs);
}
