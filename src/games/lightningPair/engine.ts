import { shuffle } from "@/lib/rng";
import {
  CARD_COUNT,
  CLAIM_WINDOW_MS,
  DECK,
  dumpHand,
  FREEZE_MS,
  GOLDEN_EVERY,
  GRAB_ROUNDS,
  INTRO_MS,
  LATENCY_ALLOW_MS,
  MAX_PLAYERS,
  MIN_FIND_MS,
  MIN_PLAYERS,
  REVEAL_MS,
  SWIFT_MS,
  type Mode,
} from "./data";

/**
 * 번개 짝꿍 엔진 (룰북 §3~§8). 방장 권위 실시간 — 방장이 20ms마다 `tick`, 입력은 도착하는 대로 `applyAction`.
 * 순수 함수: 같은 객체를 돌려주면 "바뀐 것 없음".
 *
 * 공정성:
 * - **반응 시간은 각자 기기에서 잰다.** 지금 카드 쌍이 내 화면에 그려진 순간부터 그림을 누른 순간까지(ms). 방장은 첫 맞힘이
 *   도착하면 {@link CLAIM_WINDOW_MS} 동안 더 기다렸다가 가장 짧은 반응 시간에게 준다 → 핑이 먼 사람도 손해가 적다.
 * - 거짓으로 줄인 반응 시간을 막으려고, 방장 기준 경과 시간 − {@link LATENCY_ALLOW_MS}보다 짧으면 그 값으로 끌어올린다.
 * - 틀린 그림은 {@link FREEZE_MS} 얼음 — 아무 데나 마구 누르는 게 손해가 되게.
 * 숨길 정보는 없다: 덱 순서를 알아도 짝 찾기에는 도움이 안 된다.
 */

export type SeatIndex = number;

export interface SeatStats {
  /** 맞혀서 가져온(떨이전: 버린) 횟수 */
  claims: number;
  rtSum: number;
  /** 가장 빠른 맞힘 (없으면 0) */
  minRt: number;
  swift: number;
  wrong: number;
  /** 맞혔지만 더 빠른 사람에게 진 횟수 */
  close: number;
  goldens: number;
  streak: number;
  maxStreak: number;
}

export interface Pending {
  seat: SeatIndex;
  sym: number;
  rt: number;
  at: number;
}

export interface LastClaim {
  seq: number;
  winner: SeatIndex;
  sym: number;
  rt: number;
  /** 맞힘 순간의 가운데 카드 */
  center: number;
  /** 맞힘 순간 승자의 카드 */
  top: number;
  golden: boolean;
  /** 같이 맞혔지만 진 자리 */
  rivals: SeatIndex[];
}

export interface PairState {
  mode: Mode;
  playerCount: number;
  /** 카드 배치 무작위 소금 (판마다 다르게 보이게) */
  salt: number;
  phase: "intro" | "play" | "reveal" | "finished";
  phaseAt: number;
  /** 가운데 카드가 바뀔 때마다 +1 — 맞힘에 실어 보내 지난 카드에 대한 맞힘을 거른다 */
  seq: number;
  /** 방장 시각: 지금 카드 쌍을 누를 수 있게 된 때 */
  centerAt: number;
  center: number;
  golden: boolean;
  /** 쟁탈전: 남은 덱 */
  deck: number[];
  /** 쟁탈전: 아직 펼칠 가운데 카드 수 (지금 것 포함) */
  roundsLeft: number;
  /** 쟁탈전에서 지금까지 펼친 가운데 카드 수 */
  flipped: number;
  /** 자리별 카드 더미, 맨 위 = 마지막 (쟁탈전: 모은 카드 / 떨이전: 남은 손 카드) */
  piles: number[][];
  frozenUntil: number[];
  lastActAt: number[];
  pending: Pending[];
  windowEnd: number | null;
  last: LastClaim | null;
  stats: SeatStats[];
  ranking: SeatIndex[] | null;
  /** ⚡ 번개 카드 위치를 흔드는 값 */
  goldenPhase: number;
  /** 마지막 맞힘으로 판이 끝남 (결과를 보여 준 뒤 finished) */
  over: boolean;
}

export type PairAction = { type: "claim"; seat: SeatIndex; sym: number; seq: number; rt?: number };

function emptyStats(): SeatStats {
  return { claims: 0, rtSum: 0, minRt: 0, swift: 0, wrong: 0, close: 0, goldens: 0, streak: 0, maxStreak: 0 };
}

/** 쟁탈전 k번째(0부터) 가운데 카드가 ⚡인지 — 시작 위치만 seed로 흔든다. */
function isGolden(k: number, phase: number): boolean {
  return (k + phase) % GOLDEN_EVERY === GOLDEN_EVERY - 1;
}

export function createGame(o: { playerCount: number; mode: Mode; seed: number; now: number; rng: () => number }): PairState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, o.playerCount));
  const deck = shuffle(
    Array.from({ length: CARD_COUNT }, (_, i) => i),
    o.rng,
  );
  const piles: number[][] = [];
  if (o.mode === "grab") {
    for (let i = 0; i < n; i++) piles.push([deck.pop()!]);
  } else {
    const k = dumpHand(n);
    for (let i = 0; i < n; i++) piles.push(deck.splice(deck.length - k, k));
  }
  const center = deck.pop()!;
  const goldenPhase = Math.floor(o.rng() * GOLDEN_EVERY);
  const rounds = o.mode === "grab" ? Math.min(GRAB_ROUNDS, deck.length + 1) : 0;
  return {
    mode: o.mode,
    playerCount: n,
    salt: o.seed % 100_000,
    phase: "intro",
    phaseAt: o.now,
    seq: 0,
    centerAt: o.now + INTRO_MS,
    center,
    golden: o.mode === "grab" && isGolden(0, goldenPhase),
    deck: o.mode === "grab" ? deck : [],
    roundsLeft: rounds,
    flipped: o.mode === "grab" ? 1 : 0,
    piles,
    frozenUntil: Array(n).fill(0),
    lastActAt: Array(n).fill(o.now),
    pending: [],
    windowEnd: null,
    last: null,
    stats: Array.from({ length: n }, emptyStats),
    ranking: null,
    goldenPhase,
    over: false,
  };
}

export function isFinished(s: PairState): boolean {
  return s.phase === "finished";
}

/** 자리의 지금 카드 (더미 맨 위). 떨이전에서 다 버렸으면 null. */
export function topCard(s: PairState, seat: SeatIndex): number | null {
  const p = s.piles[seat];
  return p && p.length ? p[p.length - 1] : null;
}

/** 점수 — 쟁탈전: 모은 카드(시작 카드 제외) + ⚡ 보너스 / 떨이전: 남은 카드 (적을수록 좋음). */
export function score(s: PairState, seat: SeatIndex): number {
  if (s.mode === "grab") return s.piles[seat].length - 1 + s.stats[seat].goldens;
  return s.piles[seat].length;
}

export function avgRt(st: SeatStats): number | null {
  return st.claims ? Math.round(st.rtSum / st.claims) : null;
}

/** 지금 이 자리가 맞혀야 하는 그림 (봇·힌트·테스트용). */
export function answerFor(s: PairState, seat: SeatIndex): number | null {
  const top = topCard(s, seat);
  if (top === null) return null;
  for (const sym of DECK[s.center]) if (DECK[top].includes(sym)) return sym;
  return null;
}

export function computeRanking(s: PairState): SeatIndex[] {
  const seats = Array.from({ length: s.playerCount }, (_, i) => i);
  const sign = s.mode === "grab" ? -1 : 1;
  return seats.sort((a, b) => {
    const d = sign * (score(s, a) - score(s, b));
    if (d) return d;
    const ra = avgRt(s.stats[a]) ?? 1e9;
    const rb = avgRt(s.stats[b]) ?? 1e9;
    if (ra !== rb) return ra - rb;
    if (s.stats[a].wrong !== s.stats[b].wrong) return s.stats[a].wrong - s.stats[b].wrong;
    return a - b;
  });
}

function resolve(s: PairState, now: number): PairState {
  const pend = [...s.pending].sort((a, b) => a.rt - b.rt || a.at - b.at);
  const win = pend[0];
  const stats = s.stats.map((st) => ({ ...st }));
  const w = stats[win.seat];
  w.claims++;
  w.rtSum += win.rt;
  if (!w.minRt || win.rt < w.minRt) w.minRt = win.rt;
  if (win.rt < SWIFT_MS) w.swift++;
  if (s.golden) w.goldens++;
  w.streak++;
  w.maxStreak = Math.max(w.maxStreak, w.streak);
  for (let i = 0; i < stats.length; i++) if (i !== win.seat) stats[i].streak = 0;
  const rivals = pend.slice(1).map((p) => p.seat);
  for (const r of rivals) stats[r].close++;

  const piles = s.piles.map((p) => [...p]);
  const top = piles[win.seat][piles[win.seat].length - 1];
  const last: LastClaim = { seq: s.seq, winner: win.seat, sym: win.sym, rt: win.rt, center: s.center, top, golden: s.golden, rivals };
  let center = s.center;
  let deck = s.deck;
  let roundsLeft = s.roundsLeft;
  let flipped = s.flipped;
  let golden = false;
  let over = false;
  if (s.mode === "grab") {
    piles[win.seat].push(s.center);
    roundsLeft--;
    if (roundsLeft <= 0 || deck.length === 0) over = true;
    else {
      deck = [...deck];
      center = deck.pop()!;
      golden = isGolden(flipped, s.goldenPhase);
      flipped++;
    }
  } else {
    center = piles[win.seat].pop()!;
    if (piles[win.seat].length === 0) over = true;
  }
  return { ...s, phase: "reveal", phaseAt: now, seq: s.seq + 1, center, golden, deck, roundsLeft, flipped, piles, pending: [], windowEnd: null, last, stats, over };
}

export function tick(s: PairState, now: number): PairState {
  if (s.phase === "intro") {
    if (now < s.phaseAt + INTRO_MS) return s;
    return { ...s, phase: "play", phaseAt: now, centerAt: now, lastActAt: s.lastActAt.map(() => now) };
  }
  if (s.phase === "play") {
    if (s.windowEnd !== null && now >= s.windowEnd) return resolve(s, now);
    return s;
  }
  if (s.phase === "reveal") {
    if (now < s.phaseAt + REVEAL_MS[s.mode]) return s;
    if (s.over) {
      const done: PairState = { ...s, phase: "finished", phaseAt: now };
      return { ...done, ranking: computeRanking(done) };
    }
    return { ...s, phase: "play", phaseAt: now, centerAt: now };
  }
  return s;
}

export function applyAction(s: PairState, a: PairAction, now: number): PairState {
  if (a.type !== "claim") return s;
  const seat = a.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= s.playerCount) return s;
  if (s.phase !== "play" || a.seq !== s.seq) return s;
  if (s.frozenUntil[seat] > now || s.pending.some((p) => p.seat === seat)) return s;
  const top = topCard(s, seat);
  if (top === null) return s;
  const lastActAt = [...s.lastActAt];
  lastActAt[seat] = now;
  const ok = DECK[s.center].includes(a.sym) && DECK[top].includes(a.sym);
  if (!ok) {
    const frozenUntil = [...s.frozenUntil];
    frozenUntil[seat] = now + FREEZE_MS;
    const stats = s.stats.map((st, i) => (i === seat ? { ...st, wrong: st.wrong + 1, streak: 0 } : st));
    return { ...s, frozenUntil, stats, lastActAt };
  }
  const hostElapsed = now - s.centerAt;
  const claimed = typeof a.rt === "number" && Number.isFinite(a.rt) ? a.rt : hostElapsed;
  const rt = Math.round(Math.max(MIN_FIND_MS, claimed, hostElapsed - LATENCY_ALLOW_MS));
  return {
    ...s,
    pending: [...s.pending, { seat, sym: a.sym, rt, at: now }],
    windowEnd: s.windowEnd ?? now + CLAIM_WINDOW_MS,
    lastActAt,
  };
}
