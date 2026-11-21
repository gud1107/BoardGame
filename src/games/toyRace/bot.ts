import { CAR_R, DRIFT_T1_MS, DRIFT_T2_MS, DRIFT_TURN_MULT, TURN, TURN_HIGH_SPEED_LOSS, V_MAX } from "./data";
import { forwardSpeed } from "./physics";
import { botReset, botRocket, carAhead, itemReady, leader, rnd, setInput, trackOf, fireItem, dropToy, type HostRuntime, type PlayerState } from "./sim";
import { pointAt, project, trainState, wrapDelta, wrapS } from "./track";

/**
 * 장난감 방 레이스 AI (Lv.1~10). 사람과 같은 정보만 쓴다(트랙·차 위치·보이는 위험물·아이템).
 *
 * 운전: 앞(속도에 비례한 거리)의 트랙 위 한 점을 보고 핸들을 꺾는다. 그 점의 옆 위치(라인)는
 * - 코너 안쪽으로 붙기(레이싱 라인) · 앞의 오리·장난감 벽·장애물 피하기 · 선물 상자 노리기 · 바로 앞차 옆으로 빠지기.
 * 브레이크: 앞쪽 가장 급한 굽이에서 낼 수 있는 속도(√ 없이 회전 한계로 계산)보다 빠르면 밟는다 — 낮은 레벨은 덜 내다본다.
 * 드리프트: 급한 굽이에서 꺾은 채 눌러 ⚡ 부스트를 모은다 (높은 레벨일수록 2단까지).
 * 아이템: 털실은 앞차가 정면에 있을 때, 오리는 뒤에 붙었을 때, 방패는 요요·털실이 오면, 건전지는 곧은 길에서.
 * 레벨이 낮을수록 생각이 느리고, 핸들이 흔들리고, 덜 피하고, 출발 부스트를 못 맞춘다.
 * 가장 높은 레벨도 생각 간격 60ms보다 빠르지 않다.
 */

export interface BotParams {
  /** 다시 생각하는 간격 ms */
  think: number;
  /** 핸들 흔들림 (rad) */
  noise: number;
  /** 얼마나 앞을 보고 브레이크를 정하나 (u) */
  brakeLook: number;
  /** 코너 속도 여유 (1 = 한계까지) */
  margin: number;
  /** 레이싱 라인 (코너 안쪽 붙기) 0~1 */
  line: number;
  /** 드리프트 0~1 (2단까지 끌고 가는 정도) */
  drift: number;
  /** 위험물 피하기 0~1 */
  avoid: number;
  /** 아이템 잘 쓰기 0~1 */
  item: number;
  /** 출발 부스트 성공 · 시동 꺼짐 확률 */
  rocket: number;
  stall: number;
  /** 선물 상자 노리기 0~1 */
  greed: number;
  /** 최고 속도 대비 이만큼 넘으면 살짝 브레이크 (낮은 레벨은 덜 밟는 운전) */
  cap: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 200, noise: 0.22, brakeLook: 4, margin: 0.98, line: 0, drift: 0, avoid: 0.05, item: 0.1, rocket: 0, stall: 0.25, greed: 0, cap: 0.8 },
  2: { think: 180, noise: 0.18, brakeLook: 6, margin: 0.97, line: 0.1, drift: 0, avoid: 0.15, item: 0.2, rocket: 0.03, stall: 0.2, greed: 0.1, cap: 0.83 },
  3: { think: 160, noise: 0.15, brakeLook: 8, margin: 0.96, line: 0.2, drift: 0.05, avoid: 0.3, item: 0.3, rocket: 0.08, stall: 0.15, greed: 0.2, cap: 0.86 },
  4: { think: 140, noise: 0.12, brakeLook: 10, margin: 0.96, line: 0.35, drift: 0.15, avoid: 0.45, item: 0.4, rocket: 0.15, stall: 0.12, greed: 0.3, cap: 0.89 },
  5: { think: 120, noise: 0.1, brakeLook: 12, margin: 0.97, line: 0.5, drift: 0.3, avoid: 0.6, item: 0.5, rocket: 0.25, stall: 0.1, greed: 0.45, cap: 0.92 },
  6: { think: 105, noise: 0.08, brakeLook: 13, margin: 0.98, line: 0.62, drift: 0.45, avoid: 0.7, item: 0.6, rocket: 0.35, stall: 0.08, greed: 0.55, cap: 0.95 },
  7: { think: 90, noise: 0.06, brakeLook: 14, margin: 0.99, line: 0.74, drift: 0.6, avoid: 0.8, item: 0.7, rocket: 0.45, stall: 0.06, greed: 0.65, cap: 0.97 },
  8: { think: 80, noise: 0.045, brakeLook: 15, margin: 1, line: 0.84, drift: 0.75, avoid: 0.88, item: 0.8, rocket: 0.58, stall: 0.04, greed: 0.75, cap: 1 },
  9: { think: 70, noise: 0.03, brakeLook: 16, margin: 1.01, line: 0.92, drift: 0.88, avoid: 0.95, item: 0.9, rocket: 0.7, stall: 0.02, greed: 0.85, cap: 1.02 },
  10: { think: 60, noise: 0.02, brakeLook: 17, margin: 1.02, line: 1, drift: 1, avoid: 1, item: 1, rocket: 0.82, stall: 0.01, greed: 0.95, cap: 1.05 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

/** 굽은 정도 k(rad/u)에서 핸들로 돌 수 있는 최고 속도 (드리프트면 더 빨리) */
export function cornerSpeed(k: number, drift = false): number {
  const turn = TURN * (drift ? DRIFT_TURN_MULT : 1);
  const kk = Math.max(1e-4, Math.abs(k));
  return turn / (kk + (turn * TURN_HIGH_SPEED_LOSS) / V_MAX);
}

function angleTo(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const p = s.players[seat];
  const P = paramsFor(p.lv);
  const brain = rt.bots[seat];
  if (p.rocket === 0 && s.t - s.goAt < 40) botRocket(rt, p, P.rocket, P.stall);
  if (s.t < brain.nextThinkAt) return;
  brain.nextThinkAt = s.t + P.think * (0.85 + rnd(rt.botRng) * 0.3);
  const tr = trackOf(s);
  const pr = project(tr, p.x, p.z, p.seg);
  const vf = forwardSpeed(p);

  // 막힘·반대 방향 → 제자리로
  if (s.t >= p.stallUntil && s.t >= p.spinUntil && s.t >= p.resetUntil && vf < 1) brain.stuckMs += P.think;
  else brain.stuckMs = Math.max(0, brain.stuckMs - P.think);
  if (brain.stuckMs > 1800 || p.wrongMs > 1400) {
    brain.stuckMs = 0;
    botReset(rt, p);
    return;
  }

  // ── 라인 정하기 ──
  const look = 2.5 + Math.max(0, vf) * 0.42;
  const ahead = wrapS(pr.s + look, tr.L);
  // 앞쪽 굽이 (평균 부호) → 안쪽으로
  let kSum = 0;
  let kMax = 0;
  let kMaxAt = 0;
  for (let d = 2; d <= Math.max(6, P.brakeLook + vf * 0.5); d += 1.6) {
    const i = Math.floor(wrapS(pr.s + d, tr.L) / tr.ds) % tr.n;
    if (d < 14) kSum += tr.curv[i];
    if (Math.abs(tr.curv[i]) > Math.abs(kMax)) {
      kMax = tr.curv[i];
      kMaxAt = d;
    }
  }
  const W = tr.w[pr.i];
  let lane = Math.max(-1, Math.min(1, kSum * 3)) * (W - 0.9) * P.line;
  // 위험물 피하기 (앞 4~22u)
  if (P.avoid > 0 && rnd(rt.botRng) < 0.4 + P.avoid * 0.6) lane = dodge(rt, p, pr.s, lane, W, P.avoid);
  // 장난감 벽은 늘 본다 (크고 그림자로 미리 보이니까) — 레벨이 낮으면 늦게 알아챈다
  for (const toy of s.toys) {
    // 벽은 표적(선두)이 지나가면 무너지니, 표적이 아니면 그 벽까지 갈 일이 거의 없다
    if (toy.target !== seat && toy.d - p.dist > 4) continue;
    const dd = wrapDelta(toy.s - pr.s, tr.L);
    if (dd > 0.5 && dd < 8 + P.avoid * 22 && Math.abs(toy.y - p.y) < 0.8) {
      lane = -toy.side * Math.min(W - 0.7, 1.7);
      break;
    }
  }
  // 상자 노리기 (아이템이 없을 때)
  if (p.item === null && s.options.items && P.greed > 0) {
    for (let i = 0; i < tr.boxes.length; i++) {
      const b = tr.boxes[i];
      const dd = wrapDelta(b.s - pr.s, tr.L);
      if (dd < 5 || dd > 16 || s.boxes[i].back > 0) continue;
      if (Math.abs(b.lat - lane) < 1.6 && rnd(rt.botRng) < P.greed) {
        lane = lane + (b.lat - lane) * P.greed;
        break;
      }
    }
  }
  // 바로 앞차가 같은 라인이면 옆으로 (추월)
  for (const o of s.players) {
    if (o === p || Math.abs(o.y - p.y) > 0.8) continue;
    const op = project(tr, o.x, o.z, o.seg);
    const dd = wrapDelta(op.s - pr.s, tr.L);
    if (dd > 0.5 && dd < 4 + vf * 0.25 && Math.abs(op.lat - lane) < CAR_R * 2.6 && forwardSpeed(o) < vf + 0.5) {
      lane = op.lat > 0 ? op.lat - 1.6 : op.lat + 1.6;
      break;
    }
  }
  lane = Math.max(-(W - 0.55), Math.min(W - 0.55, lane));
  brain.lane += (lane - brain.lane) * 0.6;

  const tgt = pointAt(tr, ahead, brain.lane);
  const want = Math.atan2(tgt.z - p.z, tgt.x - p.x);
  const err = angleTo(p.h, want) + (rnd(rt.botRng) * 2 - 1) * P.noise;
  let steer = Math.max(-1, Math.min(1, err * 2.4));

  // ── 드리프트 ──
  let drift = false;
  const sharp = Math.abs(kMax) > 0.085 && kMaxAt < 12;
  if (P.drift > 0) {
    if (p.drift !== 0) {
      // 굽이가 끝나거나, 레벨만큼 모았으면 뗀다
      const goal = P.drift > 0.7 ? DRIFT_T2_MS : DRIFT_T1_MS;
      const curveLeft = Math.abs(tr.curv[(pr.i + 4) % tr.n]) > 0.04 && Math.sign(tr.curv[(pr.i + 4) % tr.n]) === p.drift;
      drift = curveLeft && p.driftMs < goal + 400;
      if (!curveLeft && p.driftMs < DRIFT_T1_MS * 0.8 && P.drift < 0.5) drift = false;
    } else if (sharp && vf > 8 && rnd(rt.botRng) < P.drift) {
      drift = true;
      steer = kMax > 0 ? Math.max(0.6, steer) : Math.min(-0.6, steer);
    }
  }
  brain.drifting = drift;

  // ── 브레이크 ──
  let brake = false;
  const vSafe = cornerSpeed(kMax, drift) * P.margin;
  if (vf > vSafe + 0.6 && kMaxAt < P.brakeLook) brake = true;
  if (vf > V_MAX * P.cap && rnd(rt.botRng) < 0.35) brake = true;
  // 🚂 기차: 건널목 앞에서 기다리기
  if (tr.train) {
    const st = trainState(tr, s.t - s.goAt);
    const gap = wrapDelta(tr.train.s - pr.s, tr.L);
    if (st !== "clear" && gap > 0 && gap < 3 + vf * 0.9 * (0.5 + P.avoid * 0.5) && rnd(rt.botRng) < 0.3 + P.avoid * 0.7) brake = true;
  }
  if (drift) brake = false;
  setInput(rt, seat, { steer, brake, drift });

  // ── 아이템 ──
  if (p.item !== null && itemReady(s, p)) {
    if (brain.holdSince === 0) brain.holdSince = s.t;
    if (wantItem(rt, p, P, pr.s, kSum, s.t - brain.holdSince)) {
      if (fireItem(rt, seat)) brain.holdSince = 0;
    }
  } else brain.holdSince = 0;
  // ── 🧸 꼴찌 장난감: 잠깐 뒤 던진다 (높은 레벨은 선두가 투하 자리 바로 앞일 때) ──
  if (p.toy > 0) {
    const wait = 600 + (1 - P.item) * 3000;
    if (s.t - p.toyAt > wait) dropToy(rt, seat);
  }
}

/** 앞의 위험물을 보고 라인을 옆으로 (막힌 쪽 반대) */
function dodge(rt: HostRuntime, p: PlayerState, s0: number, lane: number, W: number, avoid: number): number {
  const s = rt.state;
  const tr = trackOf(s);
  const far = 6 + avoid * 18;
  const near = (x: number, z: number, y: number) => {
    if (Math.abs(y - p.y) > 0.8) return null;
    const q = project(tr, x, z, Math.round(s0 / tr.ds));
    const dd = wrapDelta(q.s - s0, tr.L);
    return dd > 1.5 && dd < far ? q.lat : null;
  };
  const blocks: number[] = [];
  for (const d of s.ducks) {
    const l = near(d.x, d.z, d.y);
    if (l !== null) blocks.push(l);
  }
  for (const o of tr.obstacles) {
    const l = near(o.x, o.z, tr.y[Math.round(o.s / tr.ds) % tr.n]);
    if (l !== null) blocks.push(l);
  }
  for (const toy of s.toys) {
    if (toy.target !== p.seat) continue;
    const dd = wrapDelta(toy.s - s0, tr.L);
    if (dd > 1 && dd < far + 6 && Math.abs(toy.y - p.y) < 0.8) {
      // 벽이 막는 반쪽 반대편 가운데로
      return -toy.side * Math.min(W - 0.7, 1.6);
    }
  }
  for (const pj of s.projectiles) {
    if (pj.kind !== "yarn" || pj.owner === p.seat) continue;
    const l = near(pj.x, pj.z, pj.y);
    if (l !== null) blocks.push(l);
  }
  let out = lane;
  for (const b of blocks) {
    if (Math.abs(b - out) < 1.3) out = b > 0 ? b - 1.6 : b + 1.6;
  }
  return Math.max(-(W - 0.55), Math.min(W - 0.55, out));
}

function wantItem(rt: HostRuntime, p: PlayerState, P: ReturnType<typeof paramsFor>, s0: number, kSum: number, held: number): boolean {
  const s = rt.state;
  const tr = trackOf(s);
  // 낮은 레벨: 그냥 아무 때나 금방 쓴다
  if (rnd(rt.botRng) > P.item) return held > 400 + rnd(rt.botRng) * 1500;
  const kind = p.item!;
  const fx = Math.cos(p.h);
  const fz = Math.sin(p.h);
  if (kind === "battery") return Math.abs(kSum) < 0.08 || held > 5000;
  if (kind === "top" || kind === "yoyo") return true;
  if (kind === "bubble") {
    const incoming = s.projectiles.some((pj) => pj.target === p.seat || (pj.kind === "yarn" && pj.owner !== p.seat && Math.hypot(pj.x - p.x, pj.z - p.z) < 9));
    const lead = leader(s);
    const toyAhead = s.toys.some((t) => wrapDelta(t.s - s0, tr.L) > 0 && wrapDelta(t.s - s0, tr.L) < 14);
    return incoming || toyAhead || (held > 9000 && lead !== p);
  }
  if (kind === "yarn") {
    for (const o of s.players) {
      if (o === p || o.finishedAt || Math.abs(o.y - p.y) > 0.8) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const fwd = dx * fx + dz * fz;
      const side = Math.abs(-dx * fz + dz * fx);
      if (fwd > 1 && fwd < 22 && side < 0.9 + fwd * 0.04) return true;
    }
    return held > 10_000;
  }
  if (kind === "duck") {
    for (const o of s.players) {
      if (o === p || o.finishedAt || Math.abs(o.y - p.y) > 0.8) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const back = -(dx * fx + dz * fz);
      if (back > 0.8 && back < 9 && Math.abs(-dx * fz + dz * fx) < 1.6) return true;
    }
    return held > 7000 || (carAhead(s, p) < 0 && held > 2500);
  }
  return held > 3000;
}
