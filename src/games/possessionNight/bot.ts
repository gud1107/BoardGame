import { BODY_R, BURN_R, BUDDY_R, GHOST_EYE, GHOST_SLOW, GHOST_SPEED, GRACE_MS, LANTERN_MS, MANIFEST_CONE, POSSESS_R, QUENCH_R, REVIVE_RANGE, RITUAL_R, SHIMMER_BEAM_R, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, WARD_R, WATER_R, WHISPER_R, type MoveMode, type PowerKind } from "./data";
import { BLOCKED, BRAZIER, BRAZIER_CELL, COLS, CONTAINERS, FURNITURE, LANTERNS, ROWS, centerOf, clampGhost, clearLine, colOf, collide, idx, lanternOf, nextCell, pathDist, roomAt, rowOf, walkCellAt } from "./map";
import { angleTo, applyAct, ghostDist, hasBuddy, lightOn, possessTarget, powerCheck, roomLit, slamTarget, standing, castPower, type HostRuntime, type MatchState, type PlayerState } from "./sim";

/**
 * 봇 (빈자리 AI · 나간 사람 대신) — 퇴마사와 원귀 둘 다.
 *
 * 🧿 퇴마사 봇은 **사람이 아는 것만** 쓴다: 자기 영기 탐지기, 자기에게 들린 속삭임 방향, 덜컹 소리 자리,
 * 눈에 보인 원귀(현신·성수·그림자). 판정 기기가 원귀 좌표를 알아도 그건 보지 않는다.
 * 하는 일: 가까운 수납 뒤지기(동료 곁을 고른다) → 물건은 화로로 → 빙의된 동료 퇴마 → 어두운 방 등잔 켜기 →
 * 무서우면 동료·마당으로 → 원귀가 코앞이면 성수 → 의식이 시작되면 화로 곁에.
 *
 * 👻 원귀 봇은 다 본다(원귀니까): 혼자 떨어진 사람·공포가 높은 사람을 골라 따라붙고, 손전등 빛을 피해
 * 뒤에서 속삭이고, 뒤지는 수납을 덜컹거리고, 눈을 마주칠 때 현신하고, 기회가 오면 빙의한다.
 * 레벨이 낮을수록 반응이 늦고, 빛을 덜 피하고, 힘을 아무 때나 쓴다.
 */

interface HunterMem {
  stamina: number;
  cont: number;
  lastEv: number;
  /** 원귀가 있었던 것 같은 곳 (속삭임·현신·그림자) */
  threat: { x: number; z: number; at: number } | null;
  waterAt: number;
  teaAt: number;
  decideAt: number;
  plan: "search" | "burn" | "revive" | "pick" | "flee" | "ritual" | "lantern" | "buddy" | "guard";
  planN: number;
}

interface GhostMem {
  prey: number;
  preyUntil: number;
  actAt: number;
  fleeUntil: number;
  wander: { x: number; z: number } | null;
}

const ACCESS: number[][] = CONTAINERS.map((c) => {
  const f = FURNITURE.find((it) => it.container === c.i);
  const col = colOf(c.cell);
  const row = rowOf(c.cell);
  const out: number[] = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    const n = idx(nc, nr);
    if (!BLOCKED[n]) out.push(n);
  }
  // 가구가 붙은 벽 반대쪽(정면)부터
  if (f) out.sort((a, b) => Math.hypot(centerOf(a).x - f.x, centerOf(a).z - f.z) - Math.hypot(centerOf(b).x - f.x, centerOf(b).z - f.z));
  return out;
});
const BRAZIER_ACCESS: number[] = [];
for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
  const n = idx(colOf(BRAZIER_CELL) + dc, rowOf(BRAZIER_CELL) + dr);
  if (!BLOCKED[n]) BRAZIER_ACCESS.push(n);
}
const LANTERN_ACCESS = LANTERNS.map((l) => l.cell);

function hmem(rt: HostRuntime, seat: number): HunterMem {
  let m = rt.mem[seat] as HunterMem | undefined;
  if (!m) {
    m = { stamina: 100, cont: -1, lastEv: 0, threat: null, waterAt: 0, teaAt: 0, decideAt: 0, plan: "search", planN: -1 };
    rt.mem[seat] = m;
  }
  return m;
}

function gmem(rt: HostRuntime, seat: number): GhostMem {
  let m = rt.mem[seat] as GhostMem | undefined;
  if (!m) {
    m = { prey: -1, preyUntil: 0, actAt: 0, fleeUntil: 0, wander: null };
    rt.mem[seat] = m;
  }
  return m;
}

/** 레벨별 반응 지연(ms) */
const reaction = (lv: number) => 900 - lv * 70;

/* ── 퇴마사 이동 ────────────────────────────────────────────────────── */

function moveToward(rt: HostRuntime, p: PlayerState, m: HunterMem, tx: number, tz: number, mode: MoveMode, dt: number): boolean {
  const s = rt.state;
  const run = mode === 3 && !p.panic && m.stamina > (p.mv === 3 ? 0 : STAMINA_MIN_RUN);
  const speed = run ? SPEED_RUN : SPEED_WALK;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.06) {
    p.mv = 0;
    return true;
  }
  const step = Math.min(d, speed * dt);
  const pos = { x: p.x + (dx / d) * step, z: p.z + (dz / d) * step };
  const others = s.players.filter((q) => q !== p && q.role === "hunter" && q.st === "alive");
  collide(pos, BODY_R, others);
  p.x = pos.x;
  p.z = pos.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = -0.08;
  p.mv = run ? 3 : 2;
  if (run) m.stamina = Math.max(0, m.stamina - STAMINA_DRAIN * dt);
  return false;
}

function travel(rt: HostRuntime, p: PlayerState, m: HunterMem, target: number, mode: MoveMode, dt: number): boolean {
  const here = walkCellAt(p.x, p.z);
  if (here === target) {
    const c = centerOf(target);
    return moveToward(rt, p, m, c.x, c.z, mode, dt) || Math.hypot(p.x - c.x, p.z - c.z) < 0.45;
  }
  const n = nextCell(here, target);
  if (n === here) return true;
  const c = centerOf(n);
  moveToward(rt, p, m, c.x, c.z, mode, dt);
  return false;
}

function face(p: PlayerState, x: number, z: number) {
  p.yaw = Math.atan2(-(x - p.x), -(z - p.z));
  p.pitch = -0.2;
}

/** 이 자리에서 가장 가까운 접근 칸 */
function nearestAccess(p: PlayerState, cells: number[]): number {
  let best = -1;
  let bd = Infinity;
  for (const c of cells) {
    const q = centerOf(c);
    const d = pathDist(p.x, p.z, q.x, q.z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/* ── 퇴마사 봇 ──────────────────────────────────────────────────────── */

function perceive(s: MatchState, p: PlayerState, m: HunterMem) {
  for (const e of s.events) {
    if (e.id <= m.lastEv) continue;
    if (e.k === "whisper" && e.to === p.seat && e.x !== undefined && e.z !== undefined) m.threat = { x: e.x, z: e.z, at: s.t };
    else if ((e.k === "manifest" || e.k === "ghostHit") && e.x !== undefined && e.z !== undefined && Math.hypot(e.x - p.x, e.z - p.z) < 16) m.threat = { x: e.x, z: e.z, at: s.t };
    else if (e.k === "slam" && e.x !== undefined && e.z !== undefined && Math.hypot(e.x - p.x, e.z - p.z) < 6) m.threat = { x: e.x, z: e.z, at: s.t };
  }
  m.lastEv = s.eid;
  // 눈에 보이는 원귀 (그림자·현신) — 내 쪽에서 실제로 보일 때만
  if (s.ghostVis > 0) {
    const g = s.ghost;
    const d = Math.hypot(g.x - p.x, g.z - p.z);
    if (d < 14 && clearLine(p.x, p.z, g.x, g.z) && (s.ghostVis === 2 || angleTo(p, g.x, g.z) < 1.2)) m.threat = { x: g.x, z: g.z, at: s.t };
  }
}

/**
 * 짝 정하기 (Lv.5+): 서 있는 퇴마사를 자리 순으로 둘씩 묶는다 — 앞사람이 뒤지고(leader) 뒷사람은 곁에서 지켜 준다.
 * 홀수면 마지막 사람은 앞 짝의 leader를 따라간다.
 */
function pairOf(s: MatchState, p: PlayerState): { lead: PlayerState; follower: boolean; mate: PlayerState } | null {
  const list = standing(s).filter((q) => q.level >= 5);
  const i = list.indexOf(p);
  if (i < 0 || list.length < 2) return null;
  if (i % 2 === 0 && i + 1 < list.length) return { lead: p, follower: false, mate: list[i + 1] };
  if (i % 2 === 1) return { lead: list[i - 1], follower: true, mate: list[i - 1] };
  return null;
}

function chooseContainer(rt: HostRuntime, p: PlayerState, m: HunterMem, buddy: PlayerState | null): number {
  const s = rt.state;
  let best = -1;
  let bs = Infinity;
  // 다른 봇이 노리는 곳은 피한다
  const taken = new Set<string>();
  for (const q of s.players) {
    if (q === p) continue;
    if (q.use) taken.add(q.use);
    const qm = rt.mem[q.seat] as HunterMem | undefined;
    if (q.role === "hunter" && qm && qm.cont >= 0) taken.add(`c${qm.cont}`);
  }
  for (const c of CONTAINERS) {
    if (s.searched[c.i] || taken.has(`c${c.i}`)) continue;
    const a = ACCESS[c.i][0];
    if (a === undefined) continue;
    const q = centerOf(a);
    let sc = pathDist(p.x, p.z, q.x, q.z);
    if (buddy && p.level >= 5) sc += 0.6 * pathDist(buddy.x, buddy.z, q.x, q.z);
    if (m.threat && s.t - m.threat.at < 8000 && Math.hypot(q.x - m.threat.x, q.z - m.threat.z) < 6) sc += 25;
    if (sc < bs) {
      bs = sc;
      best = c.i;
    }
  }
  return best;
}

function hunterThink(rt: HostRuntime, p: PlayerState, dtMs: number) {
  const s = rt.state;
  const m = hmem(rt, p.seat);
  const dt = dtMs / 1000;
  const lv = p.level;
  if (p.mv !== 3) m.stamina = Math.min(100, m.stamina + STAMINA_REGEN * dt);
  if (s.phase !== "play" || p.st !== "alive") {
    p.use = null;
    return;
  }
  perceive(s, p, m);
  p.light = p.battery > 0;
  const mates = standing(s).filter((q) => q !== p);
  const buddy = mates.length ? mates.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b)) : null;
  const together = hasBuddy(s, p);

  // 🍵 청심환
  if (p.tea > 0 && p.fear >= 88 - lv * 1.5 && s.t >= m.teaAt) {
    m.teaAt = s.t + 4000;
    applyAct(rt, p.seat, { k: "tea" });
  }
  // 💧 성수 — 원귀가 코앞이라고 느끼면 그쪽으로
  const th = m.threat;
  const fresh = th && s.t - th.at < 1600 + lv * 150;
  if (p.water > 0 && th && fresh && s.t >= m.waterAt && Math.hypot(th.x - p.x, th.z - p.z) <= WATER_R + 0.5 && (p.emf >= 2 || s.ghostVis > 0)) {
    m.waterAt = s.t + reaction(lv) + 1500;
    // 낮은 레벨은 방향이 어긋난다
    const err = (10 - lv) * 0.05 * (((s.t / 50) % 7) / 3.5 - 1);
    face(p, th.x, th.z);
    p.yaw += err;
    p.use = null;
    applyAct(rt, p.seat, { k: "water", yaw: p.yaw, pitch: 0 });
    return;
  }

  // 무엇을 할지 (조금씩만 다시 정한다)
  if (s.t >= m.decideAt) {
    m.decideAt = s.t + 350 + (10 - lv) * 40;
    const fleeAt = 74 - lv * 0.6;
    const pair = lv >= 5 ? pairOf(s, p) : null;
    const downed = s.players.filter((q) => q.role === "hunter" && q.st === "possessed");
    let rescuer: PlayerState | null = null;
    let rescue = -1;
    for (const q of downed) {
      // 가장 가까운 사람이 간다
      const near = standing(s).reduce<PlayerState | null>((a, b) => (!a || pathDist(b.x, b.z, q.x, q.z) < pathDist(a.x, a.z, q.x, q.z) ? b : a), null);
      if (near === p) {
        rescuer = p;
        rescue = q.seat;
        break;
      }
    }
    const ground = s.ground.length && p.carry.length < 2 ? s.ground.reduce((a, b) => (pathDist(p.x, p.z, a.x, a.z) <= pathDist(p.x, p.z, b.x, b.z) ? a : b)) : null;
    const room = roomAt(p.x, p.z);
    const li = lanternOf(room);
    if (s.ritual >= 0) m.plan = "ritual";
    else if (rescuer && rescue >= 0) {
      m.plan = "revive";
      m.planN = rescue;
    } else if (p.fear >= fleeAt && !together && (p.carry.length === 0 || mates.length > 0)) m.plan = mates.length ? "buddy" : "flee";
    else if (p.carry.length >= 2 || (p.carry.length > 0 && (s.burned + p.carry.length >= s.need || p.fear > 45 || chooseContainer(rt, p, m, buddy) < 0))) m.plan = "burn";
    else if (ground && pathDist(p.x, p.z, ground.x, ground.z) < 20) {
      m.plan = "pick";
      m.planN = ground.id;
    } else if (lv >= 4 && li >= 0 && !s.lanterns[li] && Math.hypot(LANTERNS[li].x - p.x, LANTERNS[li].z - p.z) < 8) {
      m.plan = "lantern";
      m.planN = li;
    } else if (pair && pair.follower) {
      m.plan = "guard";
      m.planN = pair.lead.seat;
    }
    else {
      m.plan = "search";
      if (m.cont < 0 || s.searched[m.cont]) m.cont = chooseContainer(rt, p, m, buddy);
    }
    if (m.plan !== "search" && m.plan !== "buddy") m.cont = m.plan === "flee" ? -1 : m.cont;
  }

  const urgent = p.fear > 60 || (m.threat && s.t - m.threat.at < 3000);
  const mode: MoveMode = urgent && lv >= 3 ? 3 : 2;
  switch (m.plan) {
    case "ritual": {
      const d = Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z);
      if (d > RITUAL_R - 0.8) {
        p.use = null;
        travel(rt, p, m, nearestAccess(p, BRAZIER_ACCESS), 3, dt);
      } else {
        p.mv = 0;
        // 화로를 등지고 바깥을 본다 (원귀가 오는 쪽)
        const a = (s.t / 2600 + p.seat * 1.7) % (Math.PI * 2);
        p.yaw = Math.atan2(-(Math.cos(a)), -(Math.sin(a)));
        p.use = null;
      }
      return;
    }
    case "revive": {
      const q = s.players[m.planN];
      if (!q || q.st !== "possessed") {
        m.decideAt = 0;
        return;
      }
      if (Math.hypot(q.x - p.x, q.z - p.z) <= REVIVE_RANGE - 0.3) {
        face(p, q.x, q.z);
        p.mv = 0;
        p.use = `r${q.seat}`;
      } else {
        p.use = null;
        travel(rt, p, m, walkCellAt(q.x, q.z), 3, dt);
      }
      return;
    }
    case "burn": {
      if (Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z) <= BURN_R - 0.2) {
        face(p, BRAZIER.x, BRAZIER.z);
        p.mv = 0;
        p.use = "b";
      } else {
        p.use = null;
        if (Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z) < 4.2) moveToward(rt, p, m, BRAZIER.x, BRAZIER.z, 2, dt);
        else travel(rt, p, m, nearestAccess(p, BRAZIER_ACCESS), mode, dt);
      }
      return;
    }
    case "pick": {
      const g = s.ground.find((it) => it.id === m.planN);
      if (!g) {
        m.decideAt = 0;
        return;
      }
      if (Math.hypot(g.x - p.x, g.z - p.z) <= 1.6) {
        face(p, g.x, g.z);
        p.mv = 0;
        p.use = `g${g.id}`;
      } else {
        p.use = null;
        travel(rt, p, m, walkCellAt(g.x, g.z), mode, dt);
      }
      return;
    }
    case "lantern": {
      const l = LANTERNS[m.planN];
      if (!l || s.lanterns[l.i]) {
        m.decideAt = 0;
        return;
      }
      if (Math.hypot(l.x - p.x, l.z - p.z) <= 1.5) {
        face(p, l.x, l.z);
        p.mv = 0;
        p.use = `l${l.i}`;
        void LANTERN_MS;
      } else {
        p.use = null;
        travel(rt, p, m, nearestAccess(p, [LANTERN_ACCESS[l.i]]), 2, dt);
      }
      return;
    }
    case "guard": {
      const lead = s.players[m.planN];
      if (!lead || lead.st !== "alive") {
        m.decideAt = 0;
        return;
      }
      const d = Math.hypot(lead.x - p.x, lead.z - p.z);
      if (d > 6.5) {
        p.use = null;
        travel(rt, p, m, walkCellAt(lead.x, lead.z), d > 9 ? 3 : 2, dt);
        return;
      }
      // 짝 곁(5m)의 수납이면 같이 뒤진다
      const lu = lead.use?.[0] === "c" ? Number(lead.use.slice(1)) : -1;
      const lm = rt.mem[lead.seat] as HunterMem | undefined;
      let near: (typeof FURNITURE)[number] | null = null;
      let nd = Infinity;
      for (const f of FURNITURE) {
        if (f.container < 0 || f.container === lu || f.container === lm?.cont || s.searched[f.container]) continue;
        if (Math.hypot(f.x - lead.x, f.z - lead.z) > 5.5) continue;
        const fd = Math.hypot(f.x - p.x, f.z - p.z);
        if (fd < nd) {
          nd = fd;
          near = f;
        }
      }
      if (near && p.fear < 60) {
        if (nd <= 2.1 && clearLine(p.x, p.z, near.x + (p.x - near.x) * 0.4, near.z + (p.z - near.z) * 0.4)) {
          face(p, near.x, near.z);
          p.mv = 0;
          p.use = "c" + near.container;
        } else {
          p.use = null;
          const a = nearestAccess(p, ACCESS[near.container]);
          if (a >= 0 && !travel(rt, p, m, a, 2, dt)) return;
          moveToward(rt, p, m, near.x, near.z, 2, dt);
        }
        return;
      }
      // 아니면 짝의 등 뒤를 비춘다
      p.use = null;
      p.mv = 0;
      const away = Math.atan2(-(p.x - lead.x), -(p.z - lead.z));
      p.yaw = away + Math.PI + Math.sin(s.t / 900 + p.seat) * 0.9;
      p.pitch = -0.05;
      return;
    }
    case "buddy":
    case "flee": {
      p.use = null;
      const mate = m.plan === "buddy" ? buddy : null;
      if (mate) {
        if (Math.hypot(mate.x - p.x, mate.z - p.z) < BUDDY_R - 2.5) {
          p.mv = 0;
          if (m.threat) face(p, m.threat.x, m.threat.z);
          m.decideAt = Math.min(m.decideAt, s.t + 600);
          return;
        }
        travel(rt, p, m, walkCellAt(mate.x, mate.z), 3, dt);
      } else {
        // 혼자면 달빛 아래 화로 곁으로
        if (Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z) < WARD_R + 0.5) {
          p.mv = 0;
          if (m.threat) face(p, m.threat.x, m.threat.z);
          return;
        }
        travel(rt, p, m, nearestAccess(p, BRAZIER_ACCESS), 3, dt);
      }
      return;
    }
    default: {
      const ci = m.cont;
      if (ci < 0 || s.searched[ci]) {
        m.decideAt = 0;
        p.use = null;
        // 뒤질 곳이 없으면 화로 쪽
        if (ci < 0) travel(rt, p, m, nearestAccess(p, BRAZIER_ACCESS), 2, dt);
        return;
      }
      const f = FURNITURE.find((it) => it.container === ci);
      if (!f) return;
      const pr = lv >= 5 ? pairOf(s, p) : null;
      if (pr && !pr.follower && Math.hypot(pr.mate.x - p.x, pr.mate.z - p.z) > 7 && p.use === null) {
        p.mv = 0;
        face(p, pr.mate.x, pr.mate.z);
        return;
      }
      const fd = Math.hypot(f.x - p.x, f.z - p.z);
      const seeIt = clearLine(p.x, p.z, f.x + (p.x - f.x) * 0.4, f.z + (p.z - f.z) * 0.4);
      if (fd <= 2.1 && seeIt) {
        face(p, f.x, f.z);
        p.mv = 0;
        p.use = "c" + ci;
        // 뒤지는 동안 원귀가 덮치면 손을 뗀다 (높은 레벨)
        if (lv >= 5 && p.fear > 70 && !together) {
          p.use = null;
          m.decideAt = 0;
        }
      } else if (fd <= 3.4 && seeIt) {
        p.use = null;
        moveToward(rt, p, m, f.x, f.z, 2, dt);
      } else {
        p.use = null;
        const a = nearestAccess(p, ACCESS[ci]);
        if (a < 0) {
          m.cont = -1;
          return;
        }
        travel(rt, p, m, a, mode, dt);
      }

    }
  }
}

/* ── 원귀 봇 ────────────────────────────────────────────────────────── */

function preyScore(s: MatchState, p: PlayerState): number {
  let sc = p.fear;
  if (!hasBuddy(s, p)) sc += 45;
  if (p.panic) sc += 40;
  if (p.carry.length) sc += 12;
  if (s.t < p.safeUntil) sc -= 60;
  sc -= Math.hypot(s.ghost.x - p.x, s.ghost.z - p.z) * 1.6;
  if (roomLit(s, roomAt(p.x, p.z))) sc -= 15;
  return sc;
}

function ghostMove(s: MatchState, tx: number, tz: number, dt: number, avoidLight: boolean) {
  const g = s.ghost;
  if (s.t < g.stunUntil) {
    g.moving = false;
    return;
  }
  const slow = s.t < g.manifestUntil || s.t < g.revealUntil;
  const speed = slow ? GHOST_SLOW : GHOST_SPEED;
  let dx = tx - g.x;
  let dz = tz - g.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.1) {
    g.moving = false;
    return;
  }
  dx /= d;
  dz /= d;
  // 손전등 빛줄기 안이면 옆으로 비켜 간다
  if (avoidLight)
    for (const p of standing(s)) {
      if (!lightOn(s, p)) continue;
      const pd = Math.hypot(g.x - p.x, g.z - p.z);
      if (pd > SHIMMER_BEAM_R + 1.5 || angleTo(p, g.x, g.z) > 0.65) continue;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      const side = (g.x - p.x) * fz - (g.z - p.z) * fx >= 0 ? 1 : -1;
      dx += fz * side * 1.4;
      dz += -fx * side * 1.4;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
  const step = Math.min(d, speed * dt);
  const pos = { x: g.x + dx * step, z: g.z + dz * step };
  clampGhost(pos, WARD_R);
  g.x = pos.x;
  g.z = pos.z;
  g.yaw = Math.atan2(-dx, -dz);
  g.pitch = -0.15;
  g.moving = true;
}

/** 사람 등 뒤 자리 (시선 반대편 `r` m) */
function behind(p: PlayerState, r: number) {
  return { x: p.x + Math.sin(p.yaw) * r, z: p.z + Math.cos(p.yaw) * r };
}

function ghostThink(rt: HostRuntime, gp: PlayerState, dtMs: number) {
  const s = rt.state;
  const g = s.ghost;
  const m = gmem(rt, gp.seat);
  const dt = dtMs / 1000;
  const lv = gp.level;
  if (s.phase !== "play") return;
  const alive = standing(s);
  if (!alive.length) return;
  if (s.t < g.stunUntil) {
    m.fleeUntil = s.t + 2500 + lv * 200;
    return;
  }

  // 먹잇감 고르기
  if (m.prey < 0 || s.t >= m.preyUntil || s.players[m.prey]?.st !== "alive") {
    let best = -1;
    let bs = -Infinity;
    for (const p of alive) {
      const sc = preyScore(s, p) + (lv < 4 ? ((p.seat * 37 + Math.floor(s.t / 7000)) % 11) * 4 : 0);
      if (sc > bs) {
        bs = sc;
        best = p.seat;
      }
    }
    m.prey = best;
    m.preyUntil = s.t + 6000 + lv * 400;
  }
  const prey = s.players[m.prey];
  if (!prey) return;
  const avoid = lv >= 4;

  // 막 맞았으면 물러난다
  if (s.t < m.fleeUntil) {
    const ax = g.x + (g.x - prey.x);
    const az = g.z + (g.z - prey.z);
    ghostMove(s, ax, az, dt, avoid);
    return;
  }

  // 의식 중이면 화로를 노린다
  if (s.ritual >= 0) {
    const a = Math.atan2(g.z - BRAZIER.z, g.x - BRAZIER.x) + dt * 0.4;
    const rr = QUENCH_R - 0.8;
    ghostMove(s, BRAZIER.x + Math.cos(a) * rr, BRAZIER.z + Math.sin(a) * rr, dt, avoid);
  } else if (s.t < GRACE_MS) {
    // 아직 힘이 없다 — 멀리서 지켜본다
    if (Math.hypot(g.x - prey.x, g.z - prey.z) < 12) ghostMove(s, g.x + (g.x - prey.x), g.z + (g.z - prey.z), dt, avoid);
    else g.moving = false;
  } else {
    // 빙의할 수 있으면 붙고, 아니면 등 뒤 3~5m에서 맴돈다
    const close = (prey.fear >= 70 && !hasBuddy(s, prey)) || prey.panic;
    const spot = close ? behind(prey, 1.2) : behind(prey, lv >= 6 ? 3.6 : 4.5);
    ghostMove(s, spot.x, spot.z, dt, avoid && !close);
  }

  // 힘 쓰기
  if (s.t < m.actAt || s.t < GRACE_MS) return;
  m.actAt = s.t + reaction(lv) * 0.6 + 150;
  const tryPower = (k: PowerKind) => powerCheck(s, k).ok && castPower(s, k);
  if (possessTarget(s) >= 0 && tryPower("possess")) return;
  if (s.ritual >= 0 && tryPower("quench")) return;
  const d = Math.hypot(g.x - prey.x, g.z - prey.z);
  const alone = !hasBuddy(s, prey);
  // 빙의 몫 기력을 남겨 둔다 (높은 레벨)
  const reserve = lv >= 6 && prey.fear >= 50 ? 30 : 0;
  const spare = g.energy - reserve;
  if (lv >= 3) {
    // 누가 뒤지는 수납 곁이면 덜컹
    const o = slamTarget(s);
    const f = o && o.id < 1000 ? FURNITURE[o.id] : null;
    const searching = f && f.container >= 0 && alive.some((p) => p.use === `c${f.container}` && p.useMs > 900);
    if (searching && spare >= 20 && tryPower("slam")) return;
  }
  if (spare >= 40 && d <= 9 && (lv < 5 || (angleTo(prey, g.x, g.z) <= MANIFEST_CONE * 0.8 && clearLine(prey.x, prey.z, g.x, g.z))) && (alone || lv < 5) && prey.fear >= 30 && tryPower("manifest")) return;
  if (spare >= 25 && d <= 6 && (lightOn(s, prey) || roomLit(s, roomAt(g.x, g.z))) && (lv < 5 || alone) && tryPower("snuff")) return;
  if (spare >= 15 && d <= WHISPER_R && tryPower("whisper")) return;
  if (lv < 4 && g.energy >= 60 && tryPower("slam")) return;
  void POSSESS_R;
  void GHOST_EYE;
}

/** 자리마다 한 번 (판정 틱마다) */
export function botThink(rt: HostRuntime, seat: number, dtMs: number) {
  const p = rt.state.players[seat];
  if (!p) return;
  if (p.role === "ghost") ghostThink(rt, p, dtMs);
  else hunterThink(rt, p, dtMs);
}

export { ghostDist };
