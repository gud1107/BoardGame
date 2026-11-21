import { nextWaypoint, type Layout } from "./arena";
import { BELT_REACH, BELT_SPEED, BOX_INFO, HEAVY_HANDLE, REACH, type BoxKind } from "./data";
import { boxOf, dockFor, grabTarget, isCoop, layoutOf, press, rnd, setInput, throwRange, type Box, type HostRuntime, type MatchState, type PlayerState } from "./sim";

/**
 * 택배 대란 AI (룰북 §9). 레벨이 오를수록 빨리 판단하고(생각 간격), 급한 상자(⚡·🧊·컨베이어 끝)를 먼저 고르고,
 * 🎯 던져 넣기·💨 돌진·🛋️ 가구 같이 들기·🚜 지게차 피하기를 쓴다.
 * 협동에서는 봇끼리 같은 상자를 노리지 않는다(목표 예약). 경쟁에서는 Lv.6부터 남의 상자를 들이받는다.
 */

export interface BotParams {
  /** 생각 간격 (ms) */
  think: number;
  /** 조이스틱 세기 (1 = 최고 속도) */
  speed: number;
  /** 고르는 판단의 흔들림 (점수 잡음) */
  noise: number;
  /** 던지기 조준 오차 (라디안) */
  aimErr: number;
  /** 🎯 트럭에 던져 넣기 */
  throws: boolean;
  /** 급한 상자 가중치 (0~1) */
  urgency: number;
  dash: boolean;
  /** 🛋️ 팀원이 든 가구 돕기 */
  help: boolean;
  /** 🚜 지게차 피하기 */
  dodge: boolean;
  /** ⚔️ 남의 상자 들이받기 */
  steal: boolean;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 800, speed: 0.5, noise: 16, aimErr: 0.3, throws: false, urgency: 0, dash: false, help: false, dodge: false, steal: false },
  2: { think: 680, speed: 0.57, noise: 13, aimErr: 0.26, throws: false, urgency: 0.15, dash: false, help: false, dodge: false, steal: false },
  3: { think: 560, speed: 0.66, noise: 10, aimErr: 0.22, throws: false, urgency: 0.3, dash: false, help: true, dodge: false, steal: false },
  4: { think: 460, speed: 0.75, noise: 8, aimErr: 0.18, throws: false, urgency: 0.45, dash: false, help: true, dodge: true, steal: false },
  5: { think: 380, speed: 0.86, noise: 6, aimErr: 0.14, throws: true, urgency: 0.55, dash: true, help: true, dodge: true, steal: false },
  6: { think: 320, speed: 0.9, noise: 5, aimErr: 0.1, throws: true, urgency: 0.65, dash: true, help: true, dodge: true, steal: true },
  7: { think: 270, speed: 0.94, noise: 4, aimErr: 0.07, throws: true, urgency: 0.75, dash: true, help: true, dodge: true, steal: true },
  8: { think: 230, speed: 0.97, noise: 3, aimErr: 0.05, throws: true, urgency: 0.85, dash: true, help: true, dodge: true, steal: true },
  9: { think: 190, speed: 1, noise: 2, aimErr: 0.03, throws: true, urgency: 0.95, dash: true, help: true, dodge: true, steal: true },
  10: { think: 150, speed: 1, noise: 1, aimErr: 0.015, throws: true, urgency: 1, dash: true, help: true, dodge: true, steal: true },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

const r01 = (rt: HostRuntime) => rnd(rt.botRng);

/** 상자 고르기 점수 (클수록 좋다) */
function boxScore(s: MatchState, p: PlayerState, b: Box, prm: BotParams, L: Layout): number {
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  let v = BOX_INFO[b.kind].value;
  const u = prm.urgency;
  if (b.kind === "express" && s.t < b.deadline) v += 10 * u;
  if (b.kind === "cold" && b.expireAt > 0) {
    const left = (b.expireAt - s.t) / 1000;
    v += (left < 18 ? 14 : 4) * u;
    if (left < 6) v -= 20; // 못 갈 것 같으면 포기
  }
  if (b.state === "belt") {
    const left = (L.belt.x1 - b.x) / BELT_SPEED;
    v += (left < 8 ? 16 : left < 14 ? 6 : 0) * u;
  }
  if (!b.known && p.role !== "inspector") v -= 6;
  if (b.kind === "heavy") {
    if (p.role === "strong") v += 6;
    else if (!isCoop(s)) v -= 14;
    else v -= 4;
  }
  if (b.kind === "fragile" && !isCoop(s)) v -= 2;
  // 목적지 트럭이 가까우면 가산 (이동 거리 전체)
  const k = dockFor(s, b.dest);
  if (k >= 0) {
    const dz = L.docks[k];
    const trip = Math.hypot(dz.x - b.x, dz.z - b.z);
    v -= trip * 0.35;
    if (s.docks[k].state !== "here") v -= 3;
  }
  return v - d * 1.6;
}

function steer(rt: HostRuntime, p: PlayerState, tx: number, tz: number, prm: BotParams, slow = 1) {
  const s = rt.state;
  const L = layoutOf(s);
  const w = nextWaypoint(L, p.x, p.z, tx, tz);
  const dx = w.x - p.x;
  const dz = w.z - p.z;
  const d = Math.hypot(dx, dz);
  const k = d < 1e-4 ? 0 : (Math.min(1, d / 0.35) * prm.speed * slow) / d;
  const inp = rt.inputs[p.seat];
  setInput(rt, p.seat, { mx: dx * k, mz: dz * k, grab: inp.grab, throw: inp.throw, dash: inp.dash, aim: inp.aim });
}

function stop(rt: HostRuntime, p: PlayerState) {
  const inp = rt.inputs[p.seat];
  setInput(rt, p.seat, { mx: 0, mz: 0, grab: inp.grab, throw: inp.throw, dash: inp.dash, aim: inp.aim });
}

/** 다른 봇이 이미 노리는 상자 (협동) */
function reserved(rt: HostRuntime, seat: number): Set<number> {
  const out = new Set<number>();
  const s = rt.state;
  for (const q of s.players) {
    if (q.seat === seat || !q.bot) continue;
    const m = rt.bots[q.seat];
    if (m && m.target >= 0 && q.hold < 0) out.add(m.target);
  }
  return out;
}

/** 🚜 지게차 길 위면 비켜설 자리 */
function forkDodge(s: MatchState, p: PlayerState): { x: number; z: number } | null {
  const f = s.fork;
  if (!f) return null;
  if (Math.abs(p.z - f.z) > 1.6) return null;
  const ahead = (p.x - f.x) * f.dir;
  if (s.t < f.goAt || (ahead > -1.5 && ahead < 7)) {
    const side = p.z >= f.z ? 1 : -1;
    return { x: p.x, z: f.z + side * 2.1 };
  }
  return null;
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const p = s.players[seat];
  const m = rt.bots[seat];
  const prm = paramsFor(p.lv);
  const L = layoutOf(s);
  if (!p || p.move === "stagger") return;

  // 매 스텝: 지게차 피하기 → 목표로 이동
  if (prm.dodge) {
    const dg = forkDodge(s, p);
    if (dg && !(p.hold >= 0 && boxOf(s, p.hold)?.kind === "heavy")) {
      steer(rt, p, dg.x, dg.z, prm);
      return;
    }
  }

  if (s.t >= m.nextThinkAt) {
    m.nextThinkAt = s.t + prm.think * (0.8 + r01(rt) * 0.4);
    decide(rt, p, prm, L);
    // 막힘: 1.5초 동안 거의 안 움직이면 잠깐 옆으로
    if (Math.hypot(p.x - m.lastX, p.z - m.lastZ) > 0.25 || m.plan === "wait") {
      m.lastX = p.x;
      m.lastZ = p.z;
      m.stuckAt = s.t;
    } else if (s.t - m.stuckAt > 1500) {
      m.stuckAt = s.t;
      m.plan = "wander";
      m.tx = p.x + (r01(rt) - 0.5) * 3;
      m.tz = p.z + (r01(rt) - 0.5) * 3;
    }
  }

  if (m.plan === "wait") stop(rt, p);
  else steer(rt, p, m.tx, m.tz, prm);

  act(rt, p, prm, L);
}

function decide(rt: HostRuntime, p: PlayerState, prm: BotParams, L: Layout) {
  const s = rt.state;
  const m = rt.bots[p.seat];
  if (p.hold >= 0) {
    const b = boxOf(s, p.hold);
    if (!b) return;
    m.target = b.id;
    if (!b.known) {
      m.plan = "scan";
      m.tx = L.scanner.x;
      m.tz = L.scanner.z;
      return;
    }
    const k = dockFor(s, b.dest);
    if (k < 0) {
      m.plan = "wander";
      return;
    }
    const dz = L.docks[k];
    // 🛋️ 혼자 든 가구: 오는 도우미가 있으면 잠깐 기다린다
    if (b.kind === "heavy" && b.holders.length === 1 && isCoop(s)) {
      const helper = s.players.some((q) => q.bot && q.seat !== p.seat && q.hold < 0 && rt.bots[q.seat]?.plan === "help" && rt.bots[q.seat]?.target === b.id);
      if (helper && s.t - b.bornAt < 1e9) {
        m.plan = "wait";
        return;
      }
    }
    if (s.docks[k].state !== "here") {
      // 트럭이 없으면 칸 앞에서 기다린다
      m.plan = "deliver";
      m.tx = dz.x;
      m.tz = dz.zone.z1 + 0.9;
      return;
    }
    m.plan = "deliver";
    m.tx = dz.x;
    m.tz = dz.z + 0.2;
    return;
  }

  // 빈손: 상자 고르기
  const taken = isCoop(s) ? reserved(rt, p.seat) : new Set<number>();
  let best: Box | null = null;
  let bs = -Infinity;
  let help: Box | null = null;
  for (const b of s.boxes) {
    if (taken.has(b.id)) continue;
    if (b.state === "held") {
      if (prm.help && isCoop(s) && b.kind === "heavy" && b.holders.length === 1 && !b.holders.includes(p.seat)) {
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < 10) {
          const sc = 22 - d * 1.4 + (r01(rt) - 0.5) * prm.noise;
          if (sc > bs) {
            bs = sc;
            help = b;
            best = null;
          }
        }
      }
      continue;
    }
    if (b.state !== "belt" && b.state !== "floor") continue;
    if (s.t < b.noPickUntil) continue;
    const sc = boxScore(s, p, b, prm, L) + (r01(rt) - 0.5) * prm.noise;
    if (sc > bs) {
      bs = sc;
      best = b;
      help = null;
    }
  }
  if (help) {
    m.plan = "help";
    m.target = help.id;
    const other = s.players[help.holders[0]];
    const a = Math.atan2(other.z - help.z, other.x - help.x) + Math.PI;
    m.tx = help.x + Math.cos(a) * HEAVY_HANDLE;
    m.tz = help.z + Math.sin(a) * HEAVY_HANDLE;
    return;
  }
  // ⚔️ 들이받기: 가까이에서 상자 든 상대
  if (prm.steal && !isCoop(s) && s.t >= p.dashCdAt) {
    let vic: PlayerState | null = null;
    let vd = 3.2;
    for (const q of s.players) {
      if (q.seat === p.seat || q.hold < 0) continue;
      const qb = boxOf(s, q.hold);
      if (!qb || qb.kind === "heavy") continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < vd) {
        vd = d;
        vic = q;
      }
    }
    if (vic) {
      m.plan = "steal";
      m.target = -1;
      m.tx = vic.x + vic.vx * 0.25;
      m.tz = vic.z + vic.vz * 0.25;
      return;
    }
  }
  if (!best) {
    m.plan = "wander";
    m.target = -1;
    m.tx = (L.belt.x0 + L.belt.x1) / 2 + (r01(rt) - 0.5) * 4;
    m.tz = L.belt.z - L.belt.hw - 1;
    return;
  }
  m.plan = "fetch";
  m.target = best.id;
  if (best.state === "belt") {
    // 컨베이어 위 상자: 앞질러 서서 기다린다 (위쪽에서)
    const eta = Math.hypot(best.x - p.x, best.z - p.z) / 4.5;
    const lead = Math.min(L.belt.x1 - 0.4, best.x + BELT_SPEED * eta * 0.8);
    m.tx = lead;
    m.tz = L.belt.z - L.belt.hw - 0.55;
  } else {
    m.tx = best.x;
    m.tz = best.z;
  }
}

function act(rt: HostRuntime, p: PlayerState, prm: BotParams, L: Layout) {
  const s = rt.state;
  const m = rt.bots[p.seat];
  const inp = rt.inputs[p.seat];
  if (p.hold < 0) {
    if ((m.plan === "fetch" || m.plan === "help") && m.target >= 0) {
      const b = boxOf(s, m.target);
      if (!b || (b.state !== "belt" && b.state !== "floor" && !(m.plan === "help" && b.state === "held"))) {
        m.nextThinkAt = s.t;
        return;
      }
      const reach = b.state === "belt" ? BELT_REACH : b.state === "held" ? HEAVY_HANDLE + 0.6 : REACH;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d <= reach * 0.95 && grabTarget(s, p)?.id === b.id) {
        // 바라보는 방향을 상자 쪽으로 (잡기 판정이 앞쪽 상자를 고른다)
        p.face = Math.atan2(b.z - p.z, b.x - p.x);
        press(rt, p.seat, "grab");
        m.nextThinkAt = s.t + 60;
      } else if (b.state === "belt" && d < 3) {
        // 컨베이어 상자는 상자 x에 맞춰 위쪽에 바짝
        m.tx = Math.min(L.belt.x1 - 0.3, b.x + 0.25);
        m.tz = L.belt.z - L.belt.hw - BELT_REACH * 0.45;
      } else if (b.state === "floor") {
        m.tx = b.x;
        m.tz = b.z;
      }
      // 💨 멀면 돌진
      if (prm.dash && s.t >= p.dashCdAt && d > 6 && Math.hypot(inp.mx, inp.mz) > 0.6) {
        const w = nextWaypoint(L, p.x, p.z, m.tx, m.tz);
        if (Math.abs(w.x - m.tx) < 0.01 && Math.abs(w.z - m.tz) < 0.01) press(rt, p.seat, "dash");
      }
    } else if (m.plan === "steal") {
      const d = Math.hypot(m.tx - p.x, m.tz - p.z);
      if (d < 2.4 && s.t >= p.dashCdAt) {
        press(rt, p.seat, "dash");
        m.nextThinkAt = s.t + 200;
      }
    }
    return;
  }
  const b = boxOf(s, p.hold);
  if (!b) return;
  if (m.plan === "deliver" && b.known && b.kind !== "heavy" && prm.throws && (b.kind !== "fragile" || p.role === "pitcher")) {
    const k = dockFor(s, b.dest);
    if (k < 0 || s.docks[k].state !== "here") return;
    const dz = L.docks[k];
    const tx = dz.x;
    const tz = dz.z;
    const d = Math.hypot(tx - p.x, tz - p.z);
    const range = throwRange(p);
    if (d > 2.6 && d < range * 0.92 && p.z > dz.zone.z1) {
      const err = (r01(rt) - 0.5) * 2 * prm.aimErr;
      const a = Math.atan2(tz - p.z, tx - p.x) + err;
      setInput(rt, p.seat, { mx: Math.cos(a), mz: Math.sin(a), grab: inp.grab, throw: inp.throw, dash: inp.dash, aim: Math.max(0.25, Math.min(1, (d - 0.55) / range)) });
      press(rt, p.seat, "throw");
      m.nextThinkAt = s.t + 120;
    }
  }
}

/** 테스트용: 종류별 가치 */
export const kindValue = (k: BoxKind) => BOX_INFO[k].value;
