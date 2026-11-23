import type { AugId } from "./augments";
import { blockedByStand } from "./arena";
import { BASIC_KINDS, BODY_R, SET_RAINBOW_BONUS, SET_TRIPLE_BONUS, TOUCH_BODY, TOY_INFO, type ToyKind } from "./data";
import {
  allies,
  basketOf,
  basketSafe,
  bombOf,
  chainValue,
  isBasketKeeper,
  isBomb,
  isTeam,
  hasAug,
  limitBlock,
  lootReachOf,
  maxChainOf,
  press,
  rnd,
  safeCount,
  setInput,
  speedMult,
  valueOf as valueOfKind,
  type HostRuntime,
  type PlayerState,
} from "./sim";

/**
 * 만지면 내 꺼! AI (Lv.1~10). 사람과 같은 화면 정보만 쓴다(물건·줄·바구니·남은 시간·폭탄 깜빡임).
 * 💣 폭탄의 숨은 타이머는 보지 않는다.
 *
 * 생각 순서:
 * 1. 💣 폭탄을 들었으면 가깝고 점수 높은 사람을 쫓아 떠넘긴다. 남의 폭탄이 가까우면 피한다.
 * 2. 🧺 집에 갈 때인가: 줄 값이 기준 이상 · 줄이 거의 꽉 참 · 남은 시간이 집까지 갈 시간뿐 · 뒤쫓기는 중.
 *    낮은 레벨은 기준이 들쭉날쭉하고 시간을 덜 본다(욕심부리다 줄에 남기고 끝나는 실수).
 * 3. 뒤에 바짝 붙으면 ✂️ 줄 끊기로 탈출(높은 레벨), 팀전은 집에 더 가까운 팀원에게 🤝 넘겨주기.
 * 4. 아니면 목표 고르기: 바닥 물건(값 ÷ 거리, 세트·타임세일 덤) vs 남의 줄(가져갈 값 합 ÷ 거리) vs
 *    🔥 마감 세일 바구니 털기. 마감 세일엔 내 바구니에 털이범이 다가오면 지키러 간다.
 * 레벨이 낮을수록 늦게 반응하고, 값을 덜 따지고(그냥 가까운 것), 덜 노린다. 가장 높은 레벨도 반응은
 * 150ms보다 빠르지 않다. 수치는 balance.sim.test.ts 셀프플레이로 맞췄다.
 */

export interface BotParams {
  think: number;
  aim: number;
  /** 움직이는 줄을 몇 초 앞서 노리나 */
  lead: number;
  dash: number;
  dashRange: number;
  /** 집에 가는 줄 값 기준 (가운데 값) */
  home: number;
  /** 기준 흔들림 (낮은 레벨일수록 큼) */
  homeJitter: number;
  /** 남은 시간 챙기기 0~1 */
  clock: number;
  /** 가로채기 적극성 */
  aggro: number;
  /** 뒤쫓길 때 ✂️ 쓰기 */
  cut: number;
  /** 뒤에 붙은 사람 알아채기 0~1 */
  aware: number;
  /** 마감 세일 털기·지키기 0~1 */
  loot: number;
  wander: number;
  /** 값을 얼마나 따지나 (낮으면 그냥 가까운 것) */
  valuePow: number;
  /** 세트 보너스·타임세일 챙기기 0~1 */
  sets: number;
  /** 집에서 먼 물건 덜 노리기 0~1 */
  route: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 520, aim: 0.55, lead: 0, dash: 0.12, dashRange: 2.6, home: 9, homeJitter: 5, clock: 0.15, aggro: 0.25, cut: 0, aware: 0.1, loot: 0.15, wander: 0.2, valuePow: 0.25, sets: 0, route: 0 },
  2: { think: 460, aim: 0.46, lead: 0.05, dash: 0.2, dashRange: 2.7, home: 9, homeJitter: 4.5, clock: 0.3, aggro: 0.35, cut: 0.05, aware: 0.2, loot: 0.25, wander: 0.15, valuePow: 0.35, sets: 0.1, route: 0.1 },
  3: { think: 400, aim: 0.38, lead: 0.1, dash: 0.28, dashRange: 2.8, home: 9, homeJitter: 4, clock: 0.45, aggro: 0.45, cut: 0.12, aware: 0.32, loot: 0.35, wander: 0.11, valuePow: 0.45, sets: 0.2, route: 0.2 },
  4: { think: 350, aim: 0.31, lead: 0.15, dash: 0.36, dashRange: 2.9, home: 9.5, homeJitter: 3.4, clock: 0.58, aggro: 0.55, cut: 0.2, aware: 0.44, loot: 0.45, wander: 0.08, valuePow: 0.55, sets: 0.3, route: 0.3 },
  5: { think: 300, aim: 0.25, lead: 0.2, dash: 0.44, dashRange: 3, home: 10, homeJitter: 2.8, clock: 0.7, aggro: 0.65, cut: 0.3, aware: 0.56, loot: 0.55, wander: 0.05, valuePow: 0.65, sets: 0.45, route: 0.45 },
  6: { think: 260, aim: 0.2, lead: 0.26, dash: 0.52, dashRange: 3.1, home: 10, homeJitter: 2.3, clock: 0.8, aggro: 0.75, cut: 0.4, aware: 0.66, loot: 0.65, wander: 0.03, valuePow: 0.72, sets: 0.55, route: 0.55 },
  7: { think: 225, aim: 0.15, lead: 0.32, dash: 0.6, dashRange: 3.2, home: 10.5, homeJitter: 1.8, clock: 0.88, aggro: 0.85, cut: 0.5, aware: 0.76, loot: 0.75, wander: 0.02, valuePow: 0.8, sets: 0.7, route: 0.65 },
  8: { think: 195, aim: 0.11, lead: 0.38, dash: 0.68, dashRange: 3.3, home: 11, homeJitter: 1.4, clock: 0.94, aggro: 0.95, cut: 0.6, aware: 0.85, loot: 0.85, wander: 0.01, valuePow: 0.88, sets: 0.8, route: 0.75 },
  9: { think: 170, aim: 0.08, lead: 0.44, dash: 0.76, dashRange: 3.4, home: 11, homeJitter: 1, clock: 0.98, aggro: 1.05, cut: 0.7, aware: 0.93, loot: 0.92, wander: 0, valuePow: 0.95, sets: 0.9, route: 0.85 },
  10: { think: 150, aim: 0.05, lead: 0.5, dash: 0.84, dashRange: 3.5, home: 11.5, homeJitter: 0.6, clock: 1, aggro: 1.15, cut: 0.8, aware: 1, loot: 1, wander: 0, valuePow: 1, sets: 1, route: 1 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

type P2 = { x: number; z: number };
const d2 = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);

/** 가로채기 점수 배율 (바닥 줍기와 견줄 때) */
const SNATCH_WEIGHT = 0.28;

function noisy(rt: HostRuntime, ang: number, amp: number): number {
  return ang + (rnd(rt.botRng) * 2 - 1) * amp;
}

function steerAngle(rt: HostRuntime, seat: number, ang: number, speed = 1) {
  const cur = rt.inputs[seat];
  setInput(rt, seat, { mx: Math.cos(ang) * speed, mz: Math.sin(ang) * speed, dash: cur.dash, skill: cur.skill });
}

/** 목표 쪽으로 가되 진열대를 비켜 가고, 피할 것(폭탄·쫓는 사람)에서 멀어지고, 담을 조심한다 */
function steerTo(rt: HostRuntime, me: PlayerState, tx: number, tz: number, P: BotParams, speed = 1, avoid: P2[] = []) {
  const s = rt.state;
  let dx = tx - me.x;
  let dz = tz - me.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.12) {
    steerAngle(rt, me.seat, 0, 0);
    return;
  }
  dx /= d;
  dz /= d;
  for (const c of s.stands) {
    const ox = c.x - me.x;
    const oz = c.z - me.z;
    const od = Math.hypot(ox, oz);
    if (od > 2.4 || od > d + c.r) continue;
    const ahead = (ox * dx + oz * dz) / od;
    if (ahead < 0.3) continue;
    const side = ox * dz - oz * dx > 0 ? 1 : -1;
    const w = ((2.4 - od) / 2.4) * 1.3 * ahead;
    dx += (-oz / od) * side * w;
    dz += (ox / od) * side * w;
  }
  for (const a of avoid) {
    const ad = d2(me, a);
    if (ad > 3.5 || ad < 1e-3) continue;
    const w = ((3.5 - ad) / 3.5) * 1.6;
    dx += ((me.x - a.x) / ad) * w;
    dz += ((me.z - a.z) / ad) * w;
  }
  const r = Math.hypot(me.x, me.z);
  if (r > s.radius - 1.2) {
    dx -= (me.x / r) * 0.6;
    dz -= (me.z / r) * 0.6;
  }
  steerAngle(rt, me.seat, noisy(rt, Math.atan2(dz, dx), P.aim), speed);
}

function tryDash(rt: HostRuntime, me: PlayerState, P: BotParams, tx: number, tz: number) {
  if (rt.state.t < me.dashCdAt || rnd(rt.botRng) > P.dash) return;
  if (blockedByStand(rt.state.stands, me.x, me.z, tx, tz, BODY_R * 0.6)) return;
  steerAngle(rt, me.seat, noisy(rt, Math.atan2(tz - me.z, tx - me.x), P.aim * 0.5), 1);
  press(rt, me.seat, "dash");
}

function teammateTouching(s: HostRuntime["state"], me: PlayerState): PlayerState | null {
  for (const o of s.players) if (allies(s, me.seat, o.seat) && d2(o, me) <= TOUCH_BODY + 0.05) return o;
  return null;
}

type Goal = { x: number; z: number; sc: number; kind: "floor" | "snatch" | "loot"; vx: number; vz: number; target: number };

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const me = s.players[seat];
  const mem = rt.bots[seat];
  if (s.t < mem.nextThinkAt) return;
  const P = paramsFor(me.lv);
  mem.nextThinkAt = s.t + P.think * (0.85 + rnd(rt.botRng) * 0.3);
  if (s.phase !== "fight") return;
  const byId = new Map(s.toys.map((t) => [t.id, t]));
  const left = s.fightEnd - s.t;
  const myVal = chainValue(s, me, byId);
  const basket = basketOf(s, me);
  const homeD = d2(me, basket);
  const speed = 5 * speedMult(s, me, byId);

  // ── 💣 폭탄 ──
  const avoid: P2[] = [];
  if (isBomb(s)) {
    const mine = bombOf(s, seat);
    if (mine) {
      mem.plan = "bomb";
      const pool = s.players.filter((o) => o !== me && !bombOf(s, o.seat) && !(mine.prev === o.seat && s.t < mine.prevUntil));
      if (pool.length) {
        pool.sort((a, b) => d2(me, a) - a.score * 0.08 - (d2(me, b) - b.score * 0.08));
        const t = pool[0];
        const td = d2(me, t);
        const lead = Math.min(P.lead, td / 6);
        const tx = t.x + t.vx * lead;
        const tz = t.z + t.vz * lead;
        steerTo(rt, me, tx, tz, P);
        if (td > TOUCH_BODY && td < P.dashRange && s.t >= mine.shieldUntil - 100) tryDash(rt, me, P, tx, tz);
        return;
      }
    }
    for (const b of s.bombs) {
      if (b.state !== "held" || b.holder === seat) continue;
      const h = s.players[b.holder];
      if (b.prev === seat && s.t < b.prevUntil - 300) continue;
      if (d2(me, h) < 4 && rnd(rt.botRng) < 0.4 + P.aware * 0.6) avoid.push(h);
    }
  }

  // ── 딴짓 (낮은 레벨) ──
  if (mem.wander && s.t < mem.wander.until) {
    steerTo(rt, me, mem.wander.x, mem.wander.z, P, 1, avoid);
    return;
  }
  if (me.chain.length === 0 && rnd(rt.botRng) < P.wander * 0.5) {
    const a = rnd(rt.botRng) * Math.PI * 2;
    const r = Math.sqrt(rnd(rt.botRng)) * s.radius * 0.6;
    mem.wander = { x: Math.cos(a) * r, z: Math.sin(a) * r, until: s.t + 600 };
    mem.plan = "wander";
    return;
  }

  // ── 집에 갈 때인가 ──
  if (me.chain.length === 0 || mem.homeAt <= 0) mem.homeAt = Math.max(3, P.home + (rnd(rt.botRng) * 2 - 1) * P.homeJitter);
  // 뒤에 붙은 위협: 내 줄 근처에서 가로챌 수 있는 사람
  let threat: PlayerState | null = null;
  let threatD = Infinity;
  if (me.chain.length > 0) {
    for (const o of s.players) {
      if (o === me || allies(s, o.seat, seat) || (o.revengeOn === seat && s.t < o.revengeUntil)) continue;
      let best = Infinity;
      for (const id of me.chain) {
        const t = byId.get(id);
        if (t) best = Math.min(best, d2(o, t));
      }
      if (best < threatD) {
        threatD = best;
        threat = o;
      }
    }
    if (threat && threatD > 1.2 + P.aware * 2.6) threat = null;
    if (threat && rnd(rt.botRng) > P.aware) threat = null;
  }
  const etaHome = (homeD / Math.max(1.5, speed)) * 1000 + me.chain.length * 260 + 900;
  const timeUp = me.chain.length > 0 && rnd(rt.botRng) < P.clock && left < etaHome + 1500;
  const cap = maxChainOf(me);
  const full = me.chain.length >= cap - 1;
  const rich = myVal >= mem.homeAt;
  const scared = !!threat && myVal >= 4 + (1 - P.aware) * 6;
  let goHome = me.chain.length > 0 && (rich || full || timeUp || scared || me.inBasket);
  // 바구니 바로 옆이면 조금이라도 넣고 가기 (높은 레벨)
  if (!goHome && me.chain.length > 0 && homeD < 3 && myVal >= 3 && rnd(rt.botRng) < P.clock) goHome = true;

  // ✂️ 탈출: 바로 뒤에 붙었고 줄이 길면
  if (threat && threatD < 1.4 && me.chain.length >= 4 && s.t >= me.cutCdAt && rnd(rt.botRng) < P.cut * 0.5) {
    if (!(isTeam(s) && teammateTouching(s, me))) press(rt, seat, "skill");
  }
  // 🤝 팀전: 집에 더 가까운 팀원이 닿아 있으면 넘겨주기
  if (isTeam(s) && me.chain.length >= 3 && s.t >= me.passCdAt) {
    const mate = teammateTouching(s, me);
    if (mate && d2(mate, basket) + 2.5 < homeD && mate.chain.length + me.chain.length <= maxChainOf(mate)) press(rt, seat, "skill");
  }

  if (goHome) {
    mem.plan = "home";
    if (me.inBasket) {
      steerTo(rt, me, basket.x, basket.z, P, d2(me, basket) > 0.5 ? 0.8 : 0);
      return;
    }
    steerTo(rt, me, basket.x, basket.z, P, 1, threat ? [...avoid, threat] : avoid);
    if (homeD > 3.2 && homeD < 6 && threat && threatD < 2) tryDash(rt, me, P, basket.x, basket.z);
    return;
  }

  // ── 🔥 마감 세일: 털이범이 오면 내 바구니 지키기 ──
  if (s.sale) {
    const bi = s.baskets.indexOf(basket);
    const lootersNear = s.players.some((o) => o !== me && !isBasketKeeper(s, o, bi) && d2(o, basket) < lootReachOf(o) + 1.5);
    const stackV = basket.stack.reduce((a, k) => a + valueOfKind(k), 0);
    if (lootersNear && stackV >= 8 && me.chain.length === 0 && homeD < 5 && rnd(rt.botRng) < P.loot * 0.7) {
      mem.plan = "home";
      steerTo(rt, me, basket.x, basket.z, P, 1, avoid);
      return;
    }
  }

  // ── 목표 고르기 ──
  let best: Goal | null = null;
  const consider = (g: Goal) => {
    if (!best || g.sc > best.sc) best = g;
  };
  // 세트 보너스: 지금 줄에 있는 종류 개수 (같은 종류 3개 · 4종 무지개)
  const have = [0, 0, 0, 0];
  for (const id of me.chain) {
    const t = byId.get(id);
    const ki = t ? BASIC_KINDS.indexOf(t.kind) : -1;
    if (ki >= 0) have[ki]++;
  }
  const worth = (kind: ToyKind) => {
    let v = TOY_INFO[kind].value;
    const ki = BASIC_KINDS.indexOf(kind);
    if (ki >= 0 && P.sets > 0) {
      if (have[ki] === 2) v += SET_TRIPLE_BONUS * P.sets;
      if (have[ki] === 0 && have.filter((c) => c > 0).length === 3) v += SET_RAINBOW_BONUS * P.sets;
    }
    if (s.event?.k === "timeSale" && s.event.kind === kind) v += TOY_INFO[kind].value * P.sets;
    return v;
  };
  for (const t of s.toys) {
    if (t.state === "chain") continue;
    if (t.state === "drop" && t.landAt - s.t > 900) continue;
    if (limitBlock(s, me, t.kind, byId)) continue;
    const d = d2(me, t);
    const rival = s.players.some((o) => o !== me && d2(o, t) < d * 0.55 && d > 2);
    const v = Math.pow(worth(t.kind), P.valuePow);
    const back = d2(t, basket) * 0.12 * P.route;
    consider({ x: t.x, z: t.z, sc: (v / (d + 2 + back)) * (rival ? 0.45 : 1), kind: "floor", vx: 0, vz: 0, target: t.id });
  }
  if (P.aggro > 0 && me.chain.length < cap - 1 && me.snatchCdAt - s.t < 800) {
    for (const o of s.players) {
      if (o === me || allies(s, o.seat, seat) || o.chain.length === 0 || o.inBasket) continue;
      if (me.revengeOn === o.seat && s.t < me.revengeUntil) continue;
      const safe = safeCount(s, o);
      let acc = 0;
      for (let k = o.chain.length - 1; k >= safe; k--) {
        const t = byId.get(o.chain[k]);
        if (!t) continue;
        acc += TOY_INFO[t.kind].value;
        if (t.shieldUntil - s.t > 600) continue;
        const d = d2(me, t);
        const front = k === safe ? 0.8 : 1;
        consider({ x: t.x, z: t.z, sc: ((acc * P.aggro * front) / (d + 2.5)) * SNATCH_WEIGHT, kind: "snatch", vx: o.vx, vz: o.vz, target: o.seat });
      }
    }
  }
  if (s.sale && P.loot > 0 && me.chain.length < cap - 1) {
    s.baskets.forEach((b, bi) => {
      if (isBasketKeeper(s, me, bi) || b.stack.length === 0 || b.lootCdUntil - s.t > 400 || basketSafe(s, bi)) return;
      const top = b.stack[b.stack.length - 1];
      if (limitBlock(s, me, top, byId)) return;
      const d = Math.max(0, d2(me, b) - lootReachOf(me) * 0.8);
      consider({ x: b.x, z: b.z, sc: ((valueOfKind(top) + 1.5) * P.loot) / (d + 2), kind: "loot", vx: 0, vz: 0, target: bi });
    });
  }
  const chosen = best as Goal | null;
  if (!chosen) {
    mem.plan = "collect";
    steerTo(rt, me, me.x * 0.5, me.z * 0.5, P, 0.6, avoid);
    return;
  }
  mem.plan = chosen.kind === "snatch" ? "snatch" : chosen.kind === "loot" ? "loot" : "collect";
  mem.target = chosen.target;
  const d = d2(me, chosen);
  const lead = chosen.kind === "snatch" ? Math.min(P.lead, d / 6) : 0;
  const tx = chosen.x + chosen.vx * lead;
  const tz = chosen.z + chosen.vz * lead;
  steerTo(rt, me, tx, tz, P, 1, avoid);
  // 💨 돌진: 바닥 물건 경쟁 · 줄 따라잡기 (돌진 중엔 못 가로채서 줄은 더 먼 거리에서만)
  const lo = chosen.kind === "snatch" ? (hasAug(me, "dashSnatch") ? 1.2 : 2.6) : 1.6;
  const hi = chosen.kind === "snatch" ? P.dashRange + 0.3 : P.dashRange;
  if (d > lo && d < hi) {
    const contested = chosen.kind !== "floor" || s.players.some((o) => o !== me && d2(o, chosen) < d + 1);
    if (contested || rnd(rt.botRng) < 0.25) tryDash(rt, me, P, tx, tz);
  }
}

/**
 * 🧬 봇 증강 고르기: 높은 레벨일수록 이 판(모드·인원·남은 회차)에 쓸모 있는 카드를 고른다.
 * 점수는 셀프플레이 증강별 승률 측정(룰북 §15)의 대략적 순서 — 낮은 레벨은 거의 무작위.
 */
const AUG_PREF: Record<AugId, number> = {
  sneakers: 5,
  quickDash: 4,
  bigBag: 4,
  tightGrip: 4,
  tape: 4,
  quickHands: 3,
  scissors: 2,
  fastDeposit: 3,
  sockLover: 4,
  sticky: 3,
  pickupBoost: 4,
  steady: 2,
  strongBack: 5,
  magnetHand: 5,
  ram: 4,
  dashSnatch: 4,
  setMaster: 4,
  regular: 3,
  counter: 3,
  giftWrap: 4,
  longArm: 4,
  bombPro: 5,
  teamPlayer: 4,
  lockBasket: 5,
  bigLoot: 4,
  piggyBank: 5,
  trophyHunter: 4,
  clutch: 5,
  vacuum: 5,
  turbo: 6,
};

export function chooseBotAug(rt: HostRuntime, seat: number, offer: AugId[]): number {
  const me = rt.state.players[seat];
  const skill = Math.max(0, Math.min(1, ((me?.lv ?? 5) - 1) / 9));
  let best = 0;
  let bestSc = -Infinity;
  offer.forEach((id, i) => {
    const sc = AUG_PREF[id] * skill + rnd(rt.botRng) * (1.5 + (1 - skill) * 6);
    if (sc > bestSc) {
      best = i;
      bestSc = sc;
    }
  });
  return best;
}
