import { blockedByPillar, type ArenaGeo } from "./arena";
import { BODY_R, CROWN_DROP_MS, DASH_MS, DASH_SPEED, ROAR_R, SNARE_R, TOUCH_DIST } from "./data";
import {
  allies,
  geoOf,
  hidden,
  inPlay,
  isCurse,
  isKing,
  king,
  onGround,
  press,
  revengeBanned,
  rnd,
  setInput,
  speedMult,
  wearsFake,
  type HostRuntime,
  type PlayerState,
} from "./sim";

/**
 * 왕관 도둑 AI (Lv.1~10). 사람과 같은 화면 정보만 쓴다(위치·왕관·무적·복수 금지·아이템·바나나).
 * 덤불 안 사람은 낮은 레벨 봇이 못 본다. 가짜 왕관에는 낮은 레벨일수록 잘 속는다.
 *
 * 역할별 생각:
 * - 쫓기(개인전·팀전, 왕이 아님): 왕의 0~0.6초 뒤 위치를 예측해 달려가고, 사거리에서 💨 돌진.
 *   🛡 무적이 남았거나 ✋ 복수 금지면 1.8m쯤 떨어져 맴돌며 기다린다.
 * - 도망(왕): 16방향을 재 보고 쫓는 사람에게서 멀고·가장자리가 아니고·기둥 뒤로 숨는 쪽으로.
 *   붙으면 💨 돌진, 둘 이상 붙거나 가장자리 근처 상대가 있으면 📣 호령.
 * - 경호(팀전, 우리 팀이 왕): 왕과 가장 가까운 상대 사이에 끼어든다.
 * - 저주: 왕이 쫓고(가까운 사람·복수 금지 아닌 사람), 나머지가 도망. 💀 손길로 느리게 만든다.
 * 레벨이 낮을수록 늦게 반응하고, 예측이 짧고, 가장자리·바나나를 덜 살핀다.
 * 가장 높은 레벨도 반응은 150ms보다 빠르지 않다(사람이 못 이기는 반응 속도 방지).
 * 수치는 balance.sim.test.ts 셀프플레이로 맞췄다.
 */

export interface BotParams {
  /** 다시 생각하는 간격 ms (반응 속도) */
  think: number;
  /** 가는 방향 오차 (rad) */
  aim: number;
  /** 몇 초 뒤 위치를 예측해 쫓나 */
  lead: number;
  /** 좋은 순간에 돌진을 쓸 확률 */
  dash: number;
  /** 돌진을 쓰는 거리 (m) */
  dashRange: number;
  /** 호령·손길을 쓸 확률 */
  skill: number;
  /** 가장자리 조심 0~1 */
  edge: number;
  /** 도망칠 때 기둥 뒤로 숨기 0~1 */
  cover: number;
  /** 도망칠 때 점프대 쓰기 0~1 */
  pads: number;
  /** 아이템 욕심 거리 (m) */
  greed: number;
  /** 바나나 피하기 0~1 */
  banana: number;
  /** 엉뚱한 데로 가는 확률 (생각할 때마다) */
  wander: number;
  /** 가짜 왕관을 알아챌 확률 */
  seeFake: number;
  /** 덤불 속 사람을 알아챌 확률 */
  seeBush: number;
  /** 무적·복수 금지일 때 참고 기다리기 0~1 (낮으면 그냥 들이받음) */
  patience: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 520, aim: 0.55, lead: 0, dash: 0.15, dashRange: 2.2, skill: 0.1, edge: 0.15, cover: 0, pads: 0, greed: 1.5, banana: 0, wander: 0.22, seeFake: 0.1, seeBush: 0.1, patience: 0 },
  2: { think: 460, aim: 0.46, lead: 0.05, dash: 0.22, dashRange: 2.4, skill: 0.16, edge: 0.3, cover: 0.05, pads: 0.05, greed: 2, banana: 0.1, wander: 0.17, seeFake: 0.2, seeBush: 0.2, patience: 0.15 },
  3: { think: 400, aim: 0.38, lead: 0.1, dash: 0.3, dashRange: 2.6, skill: 0.22, edge: 0.45, cover: 0.15, pads: 0.1, greed: 2.5, banana: 0.25, wander: 0.12, seeFake: 0.3, seeBush: 0.3, patience: 0.3 },
  4: { think: 350, aim: 0.31, lead: 0.16, dash: 0.38, dashRange: 2.8, skill: 0.3, edge: 0.6, cover: 0.3, pads: 0.2, greed: 3, banana: 0.4, wander: 0.08, seeFake: 0.4, seeBush: 0.4, patience: 0.45 },
  5: { think: 300, aim: 0.25, lead: 0.22, dash: 0.46, dashRange: 3, skill: 0.38, edge: 0.72, cover: 0.45, pads: 0.3, greed: 3.5, banana: 0.55, wander: 0.05, seeFake: 0.5, seeBush: 0.5, patience: 0.6 },
  6: { think: 260, aim: 0.2, lead: 0.28, dash: 0.55, dashRange: 3.1, skill: 0.46, edge: 0.82, cover: 0.6, pads: 0.42, greed: 4, banana: 0.7, wander: 0.03, seeFake: 0.6, seeBush: 0.6, patience: 0.72 },
  7: { think: 225, aim: 0.15, lead: 0.36, dash: 0.64, dashRange: 3.2, skill: 0.55, edge: 0.9, cover: 0.72, pads: 0.55, greed: 4.5, banana: 0.82, wander: 0.02, seeFake: 0.72, seeBush: 0.72, patience: 0.82 },
  8: { think: 195, aim: 0.11, lead: 0.44, dash: 0.73, dashRange: 3.3, skill: 0.64, edge: 0.95, cover: 0.82, pads: 0.66, greed: 5, banana: 0.9, wander: 0.01, seeFake: 0.82, seeBush: 0.82, patience: 0.9 },
  9: { think: 170, aim: 0.08, lead: 0.52, dash: 0.82, dashRange: 3.4, skill: 0.72, edge: 1, cover: 0.9, pads: 0.76, greed: 5.5, banana: 0.96, wander: 0, seeFake: 0.9, seeBush: 0.9, patience: 0.96 },
  10: { think: 150, aim: 0.05, lead: 0.6, dash: 0.9, dashRange: 3.5, skill: 0.8, edge: 1, cover: 1, pads: 0.85, greed: 6, banana: 1, wander: 0, seeFake: 0.96, seeBush: 0.96, patience: 1 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

type P2 = { x: number; z: number };

const d2 = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);

function noisy(rt: HostRuntime, ang: number, amp: number): number {
  return ang + (rnd(rt.botRng) * 2 - 1) * amp;
}

function steerAngle(rt: HostRuntime, seat: number, ang: number, speed = 1) {
  const cur = rt.inputs[seat];
  setInput(rt, seat, { mx: Math.cos(ang) * speed, mz: Math.sin(ang) * speed, dash: cur.dash, skill: cur.skill });
}

/** 목표 쪽으로 가되 기둥을 비켜 가고, 가장자리·바나나를 조심한다 */
function steerTo(rt: HostRuntime, me: PlayerState, tx: number, tz: number, P: BotParams, speed = 1) {
  const s = rt.state;
  const geo = geoOf(s);
  let dx = tx - me.x;
  let dz = tz - me.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) {
    steerAngle(rt, me.seat, 0, 0);
    return;
  }
  dx /= d;
  dz /= d;
  // 기둥 비켜 가기: 가는 길에 기둥이 있으면 옆으로
  for (const c of geo.pillars) {
    const ox = c.x - me.x;
    const oz = c.z - me.z;
    const od = Math.hypot(ox, oz);
    if (od > 2.2 || od > d + c.r) continue;
    const ahead = (ox * dx + oz * dz) / od;
    if (ahead < 0.3) continue;
    // 기둥이 진행 방향 왼쪽에 있으면 오른쪽으로, 오른쪽이면 왼쪽으로 (기둥 방향에 수직)
    const side = ox * dz - oz * dx > 0 ? 1 : -1;
    const w = ((2.2 - od) / 2.2) * 1.2 * ahead;
    dx += (-oz / od) * side * w;
    dz += (ox / od) * side * w;
  }
  // 바나나 피하기
  if (P.banana > 0) {
    for (const tr of s.traps) {
      const td = d2(me, tr);
      if (td > 2 || td < 1e-3) continue;
      if (tr.owner === me.seat && s.t - tr.at < 1500) continue;
      const w = ((2 - td) / 2) * 1.5 * P.banana;
      dx += ((me.x - tr.x) / td) * w;
      dz += ((me.z - tr.z) / td) * w;
    }
  }
  // 가장자리: 미끄러져 나갈 곳이면 안쪽으로
  const fx = me.x + me.vx * 0.35 + dx * 0.6;
  const fz = me.z + me.vz * 0.35 + dz * 0.6;
  const fr = Math.hypot(fx, fz);
  const margin = geo.radius - 1.1;
  if (fr > margin && P.edge > 0) {
    const w = Math.min(3, (fr - margin) * 2.5) * P.edge;
    dx -= (fx / fr) * w;
    dz -= (fz / fr) * w;
  }
  steerAngle(rt, me.seat, noisy(rt, Math.atan2(dz, dx), P.aim), speed);
}

function predict(p: PlayerState, sec: number): P2 {
  return { x: p.x + p.vx * sec, z: p.z + p.vz * sec };
}

/** 쫓는 사람이 볼 수 있나 (덤불 속이면 레벨에 따라) */
function seen(rt: HostRuntime, P: BotParams, o: PlayerState): boolean {
  return !hidden(rt.state, o) || rnd(rt.botRng) < P.seeBush;
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const me = s.players[seat];
  const mem = rt.bots[seat];
  if (s.t < mem.nextThinkAt) return;
  const P = paramsFor(me.lv);
  mem.nextThinkAt = s.t + P.think * (0.85 + rnd(rt.botRng) * 0.3);
  if (s.phase !== "fight" || !onGround(me)) return;
  const geo = geoOf(s);

  // 가끔 딴짓 (낮은 레벨)
  if (mem.wander && s.t < mem.wander.until) {
    steerTo(rt, me, mem.wander.x, mem.wander.z, P);
    return;
  }
  if (!isKing(s, seat) && rnd(rt.botRng) < P.wander) {
    const a = rnd(rt.botRng) * Math.PI * 2;
    const r = Math.sqrt(rnd(rt.botRng)) * geo.radius * 0.6;
    mem.wander = { x: Math.cos(a) * r, z: Math.sin(a) * r, until: s.t + 700 };
    return;
  }

  const c = s.crown;
  if (c.state === "pending") {
    // 왕관이 떨어질 가운데로 (저주 모드는 아무 데나 흩어져 있기)
    if (!isCurse(s)) {
      const left = s.fightStart + CROWN_DROP_MS - s.t;
      steerTo(rt, me, 0, 0, P, left > 900 ? 1 : 0.85);
    }
    return;
  }
  if (c.state === "ground") {
    goForCrown(rt, me, P);
    return;
  }
  const k = king(s);
  if (!k) return;
  if (isCurse(s)) {
    if (k === me) chaseAsCursed(rt, me, P);
    else flee(rt, me, P, [k]);
    return;
  }
  if (k === me) {
    const threats = s.players.filter((o) => o !== me && inPlay(s, o) && !allies(s, o.seat, me.seat) && seen(rt, P, o));
    flee(rt, me, P, threats);
    kingSkills(rt, me, P, threats);
    return;
  }
  if (allies(s, me.seat, k.seat)) {
    guard(rt, me, k, P);
    return;
  }
  chase(rt, me, k, P);
}

function goForCrown(rt: HostRuntime, me: PlayerState, P: BotParams) {
  const s = rt.state;
  const c = s.crown;
  const d = d2(me, c);
  steerTo(rt, me, c.x, c.z, P);
  if (d > 1.4 && d < P.dashRange + 0.4 && s.t >= me.dashCdAt && rnd(rt.botRng) < P.dash) {
    // 다른 사람이 더 가까우면 돌진으로 앞지르기
    const rival = s.players.some((o) => o !== me && inPlay(s, o) && d2(o, c) < d + 0.6);
    if (rival || rnd(rt.botRng) < 0.3) press(rt, me.seat, "dash");
  }
}

/** 쫓기: 왕(또는 속은 가짜)을 예측 위치로 쫓고, 사거리에서 돌진 */
function chase(rt: HostRuntime, me: PlayerState, k: PlayerState, P: BotParams) {
  const s = rt.state;
  const mem = rt.bots[me.seat];
  let target = k;
  // 가짜 왕관에 속기
  if (mem.fooledBy >= 0 && !wearsFake(s, s.players[mem.fooledBy])) mem.fooledBy = -1;
  if (mem.fooledBy < 0) {
    const fakes = s.players.filter((o) => o !== me && wearsFake(s, o) && onGround(o));
    if (fakes.length && rnd(rt.botRng) > P.seeFake) {
      fakes.sort((a, b) => d2(me, a) - d2(me, b));
      if (d2(me, fakes[0]) < d2(me, k)) mem.fooledBy = fakes[0].seat;
    }
  }
  if (mem.fooledBy >= 0) target = s.players[mem.fooledBy];
  mem.target = target.seat;

  // 아이템이 가깝고 왕은 멀면 줍기
  const kd = d2(me, target);
  if (kd > 4.5) {
    const it = s.items.find((x) => d2(me, x) < P.greed && d2(me, x) < kd * 0.6);
    if (it) {
      steerTo(rt, me, it.x, it.z, P);
      return;
    }
  }

  const banned = revengeBanned(s, me.seat);
  const invulnLeft = s.crown.invulnUntil - s.t;
  const mySpeed = 5 * speedMult(s, me);
  const eta = (kd / Math.max(1, mySpeed)) * 1000;
  const wait = (banned ? Math.max(invulnLeft, s.crown.prevUntil - s.t) : invulnLeft) > eta + 120;
  if (wait && rnd(rt.botRng) < P.patience) {
    // 1.8m쯤에서 맴돌며 기다리기 (왕이 가는 쪽 앞을 막듯이)
    const pk = predict(target, 0.3);
    const a = Math.atan2(me.z - pk.z, me.x - pk.x) + 0.5;
    steerTo(rt, me, pk.x + Math.cos(a) * 1.8, pk.z + Math.sin(a) * 1.8, P);
    return;
  }
  const lead = Math.min(P.lead, kd / 6);
  const pk = predict(target, lead);
  // 기둥 너머면 돌아가기: 목표를 기둥 옆으로 살짝 밀기
  steerTo(rt, me, pk.x, pk.z, P);
  // 돌진: 사거리 안 + 무적이 곧 끝남 + 복수 금지 아님 + 공중이 아님
  const arrive = (kd / DASH_SPEED) * 1000;
  if (
    s.t >= me.dashCdAt &&
    kd > TOUCH_DIST * 0.9 &&
    kd < P.dashRange &&
    !banned &&
    invulnLeft < arrive + DASH_MS * 0.3 &&
    onGround(target) &&
    !blockedByPillar(geoOf(s), me.x, me.z, pk.x, pk.z, BODY_R * 0.6) &&
    rnd(rt.botRng) < P.dash
  ) {
    const geo = geoOf(s);
    // 가장자리 바깥으로 날아가는 돌진은 참는다 (조심하는 봇)
    const ex = me.x + ((pk.x - me.x) / kd) * 3.2;
    const ez = me.z + ((pk.z - me.z) / kd) * 3.2;
    if (Math.hypot(ex, ez) < geo.radius - 0.4 || rnd(rt.botRng) > P.edge) {
      const ang = Math.atan2(pk.z - me.z, pk.x - me.x);
      steerAngle(rt, me.seat, noisy(rt, ang, P.aim * 0.6), 1);
      press(rt, me.seat, "dash");
    }
  }
}

/** 경호: 왕(우리 팀)과 가장 가까운 상대 사이로 */
function guard(rt: HostRuntime, me: PlayerState, k: PlayerState, P: BotParams) {
  const s = rt.state;
  const foes = s.players.filter((o) => inPlay(s, o) && !allies(s, o.seat, k.seat) && o !== k);
  if (!foes.length) {
    steerTo(rt, me, k.x, k.z, P, 0.6);
    return;
  }
  foes.sort((a, b) => d2(a, k) - d2(b, k));
  const f = foes[0];
  const gx = k.x + (f.x - k.x) * 0.45;
  const gz = k.z + (f.z - k.z) * 0.45;
  steerTo(rt, me, gx, gz, P);
  const fd = d2(me, f);
  if (d2(f, k) < 2 && fd < 2.6 && fd > 0.9 && s.t >= me.dashCdAt && rnd(rt.botRng) < P.dash) {
    steerAngle(rt, me.seat, Math.atan2(f.z - me.z, f.x - me.x), 1);
    press(rt, me.seat, "dash");
  }
}

/** 도망: 16방향을 재 보고 가장 안전한 쪽 */
function flee(rt: HostRuntime, me: PlayerState, P: BotParams, threats: PlayerState[]) {
  const s = rt.state;
  const geo = geoOf(s);
  if (!threats.length) {
    // 쫓는 사람이 없으면 가운데 쪽으로 천천히 (가장자리 위험 줄이기)
    steerTo(rt, me, me.x * 0.6, me.z * 0.6, P, 0.5);
    return;
  }
  const preds = threats.map((o) => predict(o, 0.25));
  const nearest = preds.reduce((m, p) => Math.min(m, d2(me, p)), Infinity);
  let bestA = 0;
  let bestScore = -Infinity;
  const base = Math.atan2(me.vz, me.vx);
  for (let i = 0; i < 16; i++) {
    const a = base + (i / 16) * Math.PI * 2;
    const sc = fleeScore(rt, geo, me, P, preds, a);
    if (sc > bestScore) {
      bestScore = sc;
      bestA = a;
    }
  }
  steerAngle(rt, me.seat, noisy(rt, bestA, P.aim), 1);
  // 붙으면 돌진으로 빠져나가기 (무적 중엔 아낌)
  if (nearest < 1.7 && s.t >= me.dashCdAt && s.t >= s.crown.invulnUntil - 150 && rnd(rt.botRng) < P.dash) {
    const ex = me.x + Math.cos(bestA) * 3;
    const ez = me.z + Math.sin(bestA) * 3;
    if (Math.hypot(ex, ez) < geo.radius - 0.5 || rnd(rt.botRng) > P.edge) press(rt, me.seat, "dash");
  }
}

function fleeScore(rt: HostRuntime, geo: ArenaGeo, me: PlayerState, P: BotParams, threats: P2[], a: number): number {
  const s = rt.state;
  const pr = { x: me.x + Math.cos(a) * 2.2, z: me.z + Math.sin(a) * 2.2 };
  let minD = Infinity;
  let sum = 0;
  let closest: P2 | null = null;
  for (const t of threats) {
    const d = d2(pr, t);
    if (d < minD) {
      minD = d;
      closest = t;
    }
    sum += Math.min(d, 9);
  }
  let sc = Math.min(minD, 7) * 1.4 + (sum / threats.length) * 0.35;
  const r = Math.hypot(pr.x, pr.z);
  const safe = geo.radius - 1.8;
  if (r > safe) sc -= (r - safe) * (2 + 6 * P.edge);
  if (r > geo.radius - 0.3) sc -= 10 * P.edge;
  for (const c of geo.pillars) if (Math.hypot(c.x - pr.x, c.z - pr.z) < c.r + BODY_R) sc -= 2.5;
  if (closest && P.cover > 0 && blockedByPillar(geo, pr.x, pr.z, closest.x, closest.z, 0.1)) sc += 1.6 * P.cover;
  if (P.pads > 0) {
    for (const pad of geo.pads) {
      if (Math.hypot(pad.x - pr.x, pad.z - pr.z) > pad.r + 0.6 || s.t < me.padCdAt) continue;
      const landSafe = threats.every((t) => Math.hypot(t.x - pad.tx, t.z - pad.tz) > 3);
      if (landSafe && minD < 4) sc += 2.4 * P.pads;
    }
  }
  if (P.banana > 0) for (const tr of s.traps) if (Math.hypot(tr.x - pr.x, tr.z - pr.z) < 1) sc -= 3 * P.banana;
  // 지금 가는 방향 유지 선호 (갈팡질팡 방지)
  const cur = Math.atan2(me.vz, me.vx);
  sc += Math.cos(a - cur) * 0.3;
  return sc + (rnd(rt.botRng) - 0.5) * (1 - P.cover) * 0.8;
}

/** 왕의 📣 호령 */
function kingSkills(rt: HostRuntime, me: PlayerState, P: BotParams, threats: PlayerState[]) {
  const s = rt.state;
  if (me.skillUsed || rnd(rt.botRng) > P.skill) return;
  const geo = geoOf(s);
  const near = threats.filter((o) => d2(me, o) < ROAR_R * 0.8);
  if (!near.length) return;
  const closest = Math.min(...near.map((o) => d2(me, o)));
  const edgeVictim = near.some((o) => Math.hypot(o.x, o.z) > geo.radius - 3.2 && Math.hypot(o.x, o.z) > Math.hypot(me.x, me.z));
  const invulnLeft = s.crown.invulnUntil - s.t;
  if (invulnLeft > 300 && !edgeVictim) return;
  if (near.length >= 2 || edgeVictim || (closest < 1.3 && s.t < me.dashCdAt)) press(rt, me.seat, "skill");
}

/** 💀 저주의 왕: 가까운 사람을 쫓아 떠넘기기 */
function chaseAsCursed(rt: HostRuntime, me: PlayerState, P: BotParams) {
  const s = rt.state;
  const pool = s.players.filter((o) => o !== me && inPlay(s, o) && !revengeBanned(s, o.seat) && seen(rt, P, o));
  if (!pool.length) {
    steerTo(rt, me, 0, 0, P, 0.6);
    return;
  }
  // 가깝고, 점수(저주)가 적은 사람 쪽을 조금 더 (1등 끌어내리기)
  pool.sort((a, b) => d2(me, a) - a.score / 4000 - (d2(me, b) - b.score / 4000));
  const t = pool[0];
  rt.bots[me.seat].target = t.seat;
  const td = d2(me, t);
  const pk = predict(t, Math.min(P.lead, td / 6));
  steerTo(rt, me, pk.x, pk.z, P);
  const invulnLeft = s.crown.invulnUntil - s.t;
  if (s.t >= me.dashCdAt && td > TOUCH_DIST * 0.9 && td < P.dashRange && invulnLeft < 200 && rnd(rt.botRng) < P.dash) {
    steerAngle(rt, me.seat, noisy(rt, Math.atan2(pk.z - me.z, pk.x - me.x), P.aim * 0.6), 1);
    press(rt, me.seat, "dash");
  }
  if (!me.skillUsed && rnd(rt.botRng) < P.skill) {
    const near = s.players.filter((o) => o !== me && inPlay(s, o) && d2(me, o) < SNARE_R * 0.75).length;
    if (near >= 2 || (near >= 1 && s.t < me.dashCdAt && invulnLeft < 0)) press(rt, me.seat, "skill");
  }
}
