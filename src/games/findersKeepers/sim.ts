import { AUG_AT, AUG_N, AUG_OFFER, AUG_PICK_MS, AUG_REROLLS, AUG_RESUME_MS, rollAugOffer, rollAugTier, type AugId, type AugTier } from "./augments";
import { basketSpots, clampSpot, hallFor, standSpots, TOY_R, walkwayPush, type Circle, type HallGeo } from "./arena";
import {
  ACCEL,
  BASKET_R,
  BASIC_KINDS,
  BODY_R,
  BOMB_BASKET_LOSS,
  BOMB_FIRST_MS,
  BOMB_FUSE_MAX,
  BOMB_FUSE_MIN,
  BOMB_HASTE,
  BOMB_RESPAWN_MS,
  BOMB_REVENGE_MS,
  BOMB_SHIELD_MS,
  BOMB_STAGGER_MS,
  CHAIN_PULL,
  COUNTDOWN_MS,
  CUT_BOOST,
  CUT_BOOST_MS,
  CUT_CD_MS,
  DASH_CD_MS,
  DASH_HIT_STAGGER_MS,
  DASH_MS,
  DASH_SPEED,
  DEPOSIT_MS,
  DRAG,
  DROP_NOPICK_MS,
  DROP_WARN_MS,
  EVENT_EVERY_MS,
  EVENT_FIRST_MS,
  EVENT_INFO,
  FULL_WARN_MS,
  GAP,
  GOAL_BONUS,
  GOAL_KINDS,
  HELD_SAFE,
  UNDERDOG_SAFE,
  LAG_COMP_MS,
  LOOT_CD_MS,
  LOOT_REACH,
  MAX_CHAIN,
  PASS_CD_MS,
  RAIN_N,
  REFILL_EVERY_MS,
  REFILL_N,
  REFILL_THRESHOLD,
  REFILL_THRESHOLD_DUEL,
  REFILL_WEIGHTS,
  RESTITUTION,
  REVENGE_MS,
  SALE_MS,
  SALE_MS_DUEL,
  SET_RAINBOW_BONUS,
  SET_TRIPLE_BONUS,
  SHIELD_MS,
  SNATCH_CD_MS,
  SNATCH_SHIELD_MS,
  STAGGER_DRAG,
  STEP_MS,
  TOUCH_BODY,
  TOUCH_ITEM,
  TOY_INFO,
  UNDERDOG_BONUS,
  WALKWAY_SPEED,
  WEIGHT_MAX,
  WEIGHT_PER,
  WET_ACCEL,
  WET_DRAG,
  bombCountFor,
  sanitizeOptions,
  teamOf,
  type GameOptions,
  type GoalKind,
  type ShopEventKind,
  type ToyKind,
} from "./data";

/**
 * 만지면 내 꺼! 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다(줄 위 물건 위치까지 상태에 있다).
 * 그래서 방장이 나가도 손님 하나가 마지막 스냅샷으로 `createHost`를 다시 불러 판을 이어갈 수 있다.
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다 — 같은 입력이면 같은 결과.
 *
 * 한 스텝(1/60초): 봇 생각 → 조작(돌진·✂️) → 몸 이동(무빙워크·진열대·담) → 몸끼리 부딪힘 → 위치 기록(핑 보정) →
 * 줄 따라오기 → 바구니에 넣기 → 만지기(바닥 줍기·가로채기·마감 세일 털기) → 💣 폭탄 → 떨어지는 물건·다시 채우기 →
 * 📢 점장 방송 → 점수 → 🔥 마감 세일·시간 끝.
 */

/** augment = 🧬 증강 고르기 (판이 멈춘다: s.t가 안 흐른다) */
export type Phase = "augment" | "countdown" | "fight" | "gameOver";
export type MoveKind = "none" | "dash" | "stagger";

export interface PlayerStats {
  /** 바닥에서 주운 개수 */
  picks: number;
  /** 가로채기 횟수 / 가로챈 개수 / 값 */
  snatches: number;
  snatchedToys: number;
  snatchedValue: number;
  /** 가로채기 당한 횟수 / 값 */
  lost: number;
  lostValue: number;
  /** 바구니에 넣은 개수 / 값 (타임세일 덤 제외) */
  deposits: number;
  depositValue: number;
  /** 한 번(바구니를 떠나기 전까지)에 넣은 최고 값 */
  bestRun: number;
  /** 한 번에 넣은 최다 개수 */
  bestRunToys: number;
  socks: number;
  ducks: number;
  robots: number;
  gifts: number;
  trophies: number;
  /** 세트 보너스로 얻은 점수 */
  setBonus: number;
  /** 타임세일 덤 */
  saleBonus: number;
  /** 🎖 목표 달성 수 / 점수 */
  goalsWon: number;
  cuts: number;
  passes: number;
  /** 마감 세일 때 턴 횟수 / 털린 횟수 */
  loots: number;
  looted: number;
  dashes: number;
  dashHits: number;
  /** 한 번에 가장 길었던 줄 */
  maxChain: number;
  /** 끝날 때 줄에 남아 0점이 된 값 */
  wastedValue: number;
  bombPasses: number;
  bombBooms: number;
  /** 🧬 증강으로 더 얻은 점수 */
  augBonus: number;
}

const zeroStats = (): PlayerStats => ({
  picks: 0,
  snatches: 0,
  snatchedToys: 0,
  snatchedValue: 0,
  lost: 0,
  lostValue: 0,
  deposits: 0,
  depositValue: 0,
  bestRun: 0,
  bestRunToys: 0,
  socks: 0,
  ducks: 0,
  robots: 0,
  gifts: 0,
  trophies: 0,
  setBonus: 0,
  saleBonus: 0,
  goalsWon: 0,
  cuts: 0,
  passes: 0,
  loots: 0,
  looted: 0,
  dashes: 0,
  dashHits: 0,
  maxChain: 0,
  wastedValue: 0,
  bombPasses: 0,
  bombBooms: 0,
  augBonus: 0,
});

/** 이번에 바구니에 넣는 중인 묶음 (세트 보너스용) */
export interface Run {
  sum: number;
  n: number;
  /** 기본 4종 개수 (sock·duck·robot·gift) */
  counts: number[];
  /** 같은 종류 3개 보너스를 받은 종류 (비트) */
  tri: number;
  rainbow: boolean;
}

const newRun = (): Run => ({ sum: 0, n: 0, counts: [0, 0, 0, 0], tri: 0, rainbow: false });

export interface PlayerState {
  seat: number;
  bot: boolean;
  lv: number;
  away: boolean;
  team: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  face: number;
  move: MoveKind;
  moveAt: number;
  moveUntil: number;
  dashCdAt: number;
  cutCdAt: number;
  passCdAt: number;
  /** 🤲 다시 가로챌 수 있는 시각 */
  snatchCdAt: number;
  boostUntil: number;
  /** ✋ 되찜 금지: 이 사람의 줄은 revengeUntil까지 못 건드린다 */
  revengeOn: number;
  revengeUntil: number;
  /** 내 줄 (물건 id, 몸 바로 뒤가 0번) */
  chain: number[];
  /** 내 바구니 (s.baskets 번호) */
  basket: number;
  /** 세트·타임세일·목표 점수 */
  bonus: number;
  /** 화면용 점수 (개인전: 바구니 값 + 보너스 · 팀전: 내가 넣은 값 + 보너스) */
  score: number;
  depositNextAt: number;
  inBasket: boolean;
  run: Run;
  fullWarnAt: number;
  lastHitBy: number;
  lastHitAt: number;
  stats: PlayerStats;
  /** 🧬 고른 증강 (옛 스냅샷엔 없을 수 있다) */
  augs?: AugId[];
  /** 🧬 이번 판에 쓴 다시 뽑기 */
  rerolls?: number;
}

export interface Toy {
  id: number;
  kind: ToyKind;
  x: number;
  z: number;
  /** floor = 바닥 · chain = 누군가의 줄 · drop = 지붕 틈에서 떨어지는 중(landAt에 바닥) */
  state: "floor" | "chain" | "drop";
  owner: number;
  shieldUntil: number;
  noPickUntil: number;
  landAt: number;
}

export interface Basket {
  x: number;
  z: number;
  a: number;
  /** 개인전: 주인 자리 · 팀전: -1 */
  owner: number;
  /** 팀전: 팀 번호 · 개인전: -1 */
  team: number;
  /** 넣은 물건 (마지막이 맨 위) */
  stack: ToyKind[];
  lootCdUntil: number;
}

export interface Bomb {
  id: number;
  state: "pending" | "held";
  holder: number;
  at: number;
  /** 터지는 시각 (스냅샷엔 마지막 몇 초만 보인다) */
  fuseAt: number;
  shieldUntil: number;
  prev: number;
  prevUntil: number;
  dropAt: number;
}

export interface ShopEvent {
  k: ShopEventKind;
  /** 타임세일 종류 */
  kind: ToyKind | null;
  at: number;
  until: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "go" }
  | { k: "pick"; s: number; kind: ToyKind; x: number; z: number }
  /** 가로채기: s가 from의 줄에서 n개(값 v)를 가져감 */
  | { k: "snatch"; s: number; from: number; n: number; v: number; x: number; z: number }
  | { k: "deposit"; s: number; kind: ToyKind; v: number; x: number; z: number; sale: boolean }
  | { k: "set"; s: number; set: "triple" | "rainbow"; kind: ToyKind | null; b: number; x: number; z: number }
  | { k: "runEnd"; s: number; sum: number; n: number }
  | { k: "cut"; s: number; n: number; x: number; z: number }
  | { k: "pass"; s: number; to: number; n: number; x: number; z: number }
  | { k: "loot"; s: number; basket: number; kind: ToyKind; x: number; z: number }
  | { k: "blocked"; s: number; why: "full" | "gift" | "trophy" }
  | { k: "dash"; s: number }
  | { k: "dashHit"; a: number; b: number; x: number; z: number }
  | { k: "bump"; a: number; b: number; x: number; z: number; p: number }
  | { k: "dropWarn"; toy: number; x: number; z: number; kind: ToyKind }
  | { k: "land"; toy: number; x: number; z: number; kind: ToyKind }
  | { k: "sale" }
  | { k: "shop"; e: ShopEventKind; kind: ToyKind | null }
  | { k: "shopEnd"; e: ShopEventKind }
  | { k: "bombOn"; s: number; from: number; x: number; z: number }
  | { k: "boom"; s: number; n: number; lost: number; x: number; z: number }
  | { k: "goal"; goal: GoalKind; seats: number[] }
  | { k: "augOpen"; round: number; tier: AugTier }
  | { k: "augPick"; s: number; aug: AugId; auto: boolean }
  | { k: "augDone"; round: number }
  | { k: "piggy"; s: number; b: number }
  | { k: "ram"; s: number; to: number; n: number; x: number; z: number }
  | { k: "over" }
);

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  fightStart: number;
  fightEnd: number;
  saleStart: number;
  sale: boolean;
  radius: number;
  stands: Circle[];
  baskets: Basket[];
  toys: Toy[];
  toySeq: number;
  /** 판 시작 때 물건 수 (다시 채우기 기준) */
  initialToys: number;
  nextRefillAt: number;
  event: ShopEvent | null;
  nextEventAt: number;
  lastEvent: ShopEventKind | null;
  /** 🎖 이번 판 보너스 목표 (시작 때 공개) */
  goals: GoalKind[];
  /** 끝났을 때 목표별 달성자 */
  goalWinners: number[][];
  bombs: Bomb[];
  players: PlayerState[];
  teamScores: [number, number];
  teamMult: [number, number];
  /** 가로채기 총 횟수 */
  snatchCount: number;
  leadChanges: number;
  leader: number;
  /** 마감 세일이 시작될 때 1등 (막판 역전 기록) */
  saleLeader: number;
  events: GameEvent[];
  eventSeq: number;
  ranks: number[] | null;
  winnerTeam: number;
  /** 🧬 다음에 열 증강 회차 (AUG_AT 번호). 증강 꺼짐이면 AUG_AT.length */
  augNext?: number;
  /** 🧬 회차별로 여는 시뮬 시각 */
  augAtMs?: number[];
  /** 🧬 지금 고르는 중인 회차 */
  aug?: AugPhase | null;
  /** 🐷 저금통 다음 지급 시각 */
  piggyAt?: number;
}

export interface AugPhase {
  round: number;
  tier: AugTier;
  /** 자리별 카드 3장 */
  offers: AugId[][];
  done: boolean[];
  picks: (AugId | null)[];
  /** 고르기 시작 뒤 흐른 시간 (판은 멈춰 있다) */
  el: number;
  limit: number;
  /** 모두 고른 시각 (el 기준, 아직이면 -1) */
  doneAt: number;
  /** 봇이 고르는 시각 (el 기준) */
  botAt: number[];
  resume: "countdown" | "fight";
}

export interface SeatSpec {
  bot: boolean;
  level: number;
}

/* ── 난수 ───────────────────────────────────────────────────────────── */

export function rnd(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ── 조회 ───────────────────────────────────────────────────────────── */

export function geoOf(s: MatchState): HallGeo {
  return hallFor(s.seatCount);
}

export const isTeam = (s: MatchState) => s.options.mode === "team";
export const isBomb = (s: MatchState) => s.options.mode === "bomb";

export function allies(s: MatchState, a: number, b: number): boolean {
  return isTeam(s) && a !== b && s.players[a]?.team === s.players[b]?.team;
}

export function toyOf(s: MatchState, id: number): Toy | undefined {
  return s.toys.find((t) => t.id === id);
}

export const valueOf = (k: ToyKind) => TOY_INFO[k].value;

export function chainValue(s: MatchState, p: PlayerState, byId?: Map<number, Toy>): number {
  let v = 0;
  for (const id of p.chain) {
    const t = byId ? byId.get(id) : toyOf(s, id);
    if (t) v += valueOf(t.kind);
  }
  return v;
}

export function chainWeight(s: MatchState, p: PlayerState, byId?: Map<number, Toy>): number {
  let w = 0;
  for (const id of p.chain) {
    const t = byId ? byId.get(id) : toyOf(s, id);
    if (t) w += t.kind === "trophy" && hasAug(p, "trophyHunter") ? AUG_N.trophyHunterWeight : TOY_INFO[t.kind].weight;
  }
  return w;
}

export function basketValue(b: Basket): number {
  let v = 0;
  for (const k of b.stack) v += valueOf(k);
  return v;
}

/** 이 사람이 물건을 넣는 바구니 */
export function basketOf(s: MatchState, p: PlayerState): Basket {
  return s.baskets[p.basket];
}

export function bombOf(s: MatchState, seat: number): Bomb | null {
  return s.bombs.find((b) => b.state === "held" && b.holder === seat) ?? null;
}

/** 🐢 무게 배수 */
export function weightMult(s: MatchState, p: PlayerState, byId?: Map<number, Toy>): number {
  const k = hasAug(p, "strongBack") ? AUG_N.strongBackWeight : 1;
  return 1 - Math.min(WEIGHT_MAX * k, chainWeight(s, p, byId) * WEIGHT_PER * k);
}

export function isUnderdog(s: MatchState, p: PlayerState): boolean {
  if (s.phase !== "fight") return false;
  if (isTeam(s)) {
    const [a, b] = s.teamScores;
    if (a === b) return false;
    return p.team === (a < b ? 0 : 1);
  }
  const vals = s.players.map((q) => q.score);
  const lo = Math.min(...vals);
  return lo !== Math.max(...vals) && p.score === lo && vals.filter((v) => v === lo).length === 1;
}

/** 줄 앞에서 이만큼은 못 뺏는다 (✊ 손에 쥔 것 · 🐣 꼴찌 보호) */
export function safeCount(s: MatchState, p: PlayerState): number {
  return (isUnderdog(s, p) ? UNDERDOG_SAFE : HELD_SAFE) + (hasAug(p, "tightGrip") && p.chain.length <= AUG_N.tightGripMaxChain ? AUG_N.tightGripPlus : 0);
}

export function speedMult(s: MatchState, p: PlayerState, byId?: Map<number, Toy>): number {
  let m = weightMult(s, p, byId);
  if (isUnderdog(s, p)) m += UNDERDOG_BONUS;
  if (s.t < p.boostUntil) m += CUT_BOOST;
  if (isBomb(s) && bombOf(s, p.seat)) m += BOMB_HASTE;
  if (hasAug(p, "sneakers")) m += AUG_N.sneakersSpeed;
  if (hasAug(p, "turbo")) m += AUG_N.turboSpeed;
  if (s.sale && hasAug(p, "clutch")) m += AUG_N.clutchSpeed;
  return m;
}

export function isWet(s: MatchState): boolean {
  return !!s.event && s.event.k === "wet" && s.t < s.event.until;
}

/* ── 🧬 증강 조회 ───────────────────────────────────────────────────── */

export const hasAug = (p: PlayerState | undefined, id: AugId): boolean => !!p?.augs?.includes(id);

export function maxChainOf(p: PlayerState): number {
  return MAX_CHAIN + (hasAug(p, "bigBag") ? AUG_N.bigBagPlus : 0);
}

export function dashCdOf(p: PlayerState): number {
  const q = hasAug(p, "quickDash");
  const t = hasAug(p, "turbo");
  if (q && t) return AUG_N.quickDashCdMs - 600;
  if (q) return AUG_N.quickDashCdMs;
  if (t) return AUG_N.turboDashCdMs;
  return DASH_CD_MS;
}

export const cutCdOf = (p: PlayerState) => (hasAug(p, "scissors") ? AUG_N.scissorsCdMs : CUT_CD_MS);
export const snatchCdOf = (p: PlayerState) => (hasAug(p, "quickHands") ? AUG_N.quickHandsCdMs : SNATCH_CD_MS);
export const pickReachOf = (p: PlayerState) => TOUCH_ITEM + (hasAug(p, "magnetHand") ? AUG_N.magnetPickReach : 0);
export const snatchReachOf = (p: PlayerState) => TOUCH_ITEM + (hasAug(p, "longArm") ? AUG_N.longArmReach : 0);
export const lootReachOf = (p: PlayerState) => LOOT_REACH + (hasAug(p, "bigLoot") ? AUG_N.bigLootReach : 0);
export const passReachOf = (p: PlayerState) => TOUCH_BODY + 0.1 + (hasAug(p, "teamPlayer") ? AUG_N.teamPassReach : 0);

/** 이 물건을 이 사람이 지금 가질 수 없는 이유 (없으면 null) */
export function limitBlock(s: MatchState, p: PlayerState, kind: ToyKind, byId?: Map<number, Toy>): "full" | "gift" | "trophy" | null {
  if (p.chain.length >= maxChainOf(p)) return "full";
  if (kind === "gift" || kind === "trophy") {
    const lim = kind === "gift" && hasAug(p, "giftWrap") ? AUG_N.giftWrapMax : 1;
    let n = 0;
    for (const id of p.chain) {
      const t = byId ? byId.get(id) : toyOf(s, id);
      if (t && t.kind === kind && ++n >= lim) return kind;
    }
  }
  return null;
}

/* ── 이벤트 ─────────────────────────────────────────────────────────── */

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

function emit(s: MatchState, e: EventBody) {
  s.events.push({ ...(e as object), id: ++s.eventSeq, at: s.t } as GameEvent);
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

function newPlayer(seat: number, spec: SeatSpec): PlayerState {
  return {
    seat,
    bot: spec.bot,
    lv: Math.max(1, Math.min(10, Math.round(spec.level) || 5)),
    away: false,
    team: teamOf(seat),
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    face: 0,
    move: "none",
    moveAt: 0,
    moveUntil: 0,
    dashCdAt: 0,
    cutCdAt: 0,
    passCdAt: 0,
    snatchCdAt: 0,
    boostUntil: 0,
    revengeOn: -1,
    revengeUntil: 0,
    chain: [],
    basket: 0,
    bonus: 0,
    score: 0,
    depositNextAt: 0,
    inBasket: false,
    run: newRun(),
    fullWarnAt: 0,
    lastHitBy: -1,
    lastHitAt: 0,
    stats: zeroStats(),
    augs: [],
    rerolls: 0,
  };
}

function addToy(s: MatchState, kind: ToyKind, x: number, z: number, state: Toy["state"] = "floor", landAt = 0): Toy {
  const t: Toy = { id: ++s.toySeq, kind, x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000, state, owner: -1, shieldUntil: 0, noPickUntil: 0, landAt };
  s.toys.push(t);
  return t;
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const seatCount = seats.length;
  const opts = sanitizeOptions(options, seatCount);
  const players = seats.map((spec, i) => newPlayer(i, spec));
  const sizes = [0, 1].map((k) => players.filter((p) => p.team === k).length);
  const big = Math.max(...sizes);
  const geo = hallFor(seatCount);
  const saleMs = seatCount <= 2 ? SALE_MS_DUEL : SALE_MS;
  const fightEnd = COUNTDOWN_MS + opts.seconds * 1000;
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount,
    options: opts,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: COUNTDOWN_MS,
    fightStart: COUNTDOWN_MS,
    fightEnd,
    saleStart: fightEnd - saleMs,
    sale: false,
    radius: geo.radius,
    stands: [],
    baskets: [],
    toys: [],
    toySeq: 0,
    initialToys: 0,
    nextRefillAt: COUNTDOWN_MS + REFILL_EVERY_MS,
    event: null,
    nextEventAt: COUNTDOWN_MS + EVENT_FIRST_MS,
    lastEvent: null,
    goals: [],
    goalWinners: [],
    bombs: [],
    players,
    teamScores: [0, 0],
    teamMult: [sizes[0] > 0 ? big / sizes[0] : 1, sizes[1] > 0 ? big / sizes[1] : 1],
    snatchCount: 0,
    leadChanges: 0,
    leader: -1,
    saleLeader: -1,
    events: [],
    eventSeq: 0,
    ranks: null,
    winnerTeam: -1,
    augNext: AUG_AT.length,
    augAtMs: [],
    aug: null,
    piggyAt: COUNTDOWN_MS + AUG_N.piggyEveryMs,
  };
  const rot = rnd(s) * Math.PI * 2;
  const team = opts.mode === "team";
  s.stands = standSpots(geo, team ? 4 : seatCount, rot);
  // 자리 순서는 무작위 (바구니 위치가 자리 번호와 상관없게)
  const order = players.map((p) => p.seat);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (team) {
    const spots = basketSpots(geo.radius, 2, rot);
    s.baskets = spots.map((b, k) => ({ x: b.x, z: b.z, a: b.a, owner: -1, team: k, stack: [], lootCdUntil: 0 }));
    for (const k of [0, 1]) {
      const mates = order.filter((q) => players[q].team === k);
      mates.forEach((seat, i) => {
        const p = players[seat];
        p.basket = k;
        const b = s.baskets[k];
        const spread = (i - (mates.length - 1) / 2) * 0.42;
        const r = geo.radius - 2.6;
        p.x = Math.cos(b.a + spread) * r;
        p.z = Math.sin(b.a + spread) * r;
        p.face = Math.atan2(-p.z, -p.x);
      });
    }
  } else {
    const spots = basketSpots(geo.radius, seatCount, rot);
    order.forEach((seat, k) => {
      const b = spots[k];
      s.baskets.push({ x: b.x, z: b.z, a: b.a, owner: seat, team: -1, stack: [], lootCdUntil: 0 });
      const p = players[seat];
      p.basket = k;
      p.x = b.x * 0.82;
      p.z = b.z * 0.82;
      p.face = Math.atan2(-p.z, -p.x);
    });
  }
  // 물건: 자리 구역마다 같은 무늬 (팀전도 인원수만큼 구역을 나눠 똑같이) + 가운데 선물
  const n = seatCount;
  const R = geo.radius;
  const half = Math.PI / n;
  const pattern: [ToyKind, number, number][] = [
    ["sock", 0.6, -0.22],
    ["sock", 0.6, 0.22],
    ["sock", 0.34, 0],
    ["duck", 0.46, -half * 0.55],
    ["duck", 0.46, half * 0.55],
    ["robot", 0.24, half],
  ];
  for (let k = 0; k < n; k++) {
    const a0 = rot + (k / n) * Math.PI * 2;
    for (const [kind, f, da] of pattern) {
      const a = a0 + da;
      const spot = clampSpot(R, s.stands, Math.cos(a) * R * f, Math.sin(a) * R * f, TOY_R + 0.2);
      addToy(s, kind, spot.x, spot.z);
    }
  }
  const gifts = n <= 3 ? 1 : n <= 5 ? 2 : 3;
  const cr = geo.size === "small" ? 1.5 : 1.0;
  for (let k = 0; k < gifts; k++) {
    const a = rot + (k / gifts) * Math.PI * 2 + 0.3;
    const spot = clampSpot(R, s.stands, gifts === 1 && geo.size !== "small" ? 0 : Math.cos(a) * cr, gifts === 1 && geo.size !== "small" ? 0 : Math.sin(a) * cr, TOY_R + 0.2);
    addToy(s, "gift", spot.x, spot.z);
  }
  if (n <= 3) {
    for (let k = 0; k < 2; k++) {
      const a = rot + Math.PI / 2 + k * Math.PI;
      addToy(s, "robot", Math.cos(a) * 2.2, Math.sin(a) * 2.2);
    }
  }
  s.initialToys = s.toys.length;
  // 🎖 보너스 목표 2개 (목표 끄면 없음)
  if (opts.goals) {
    const pool = GOAL_KINDS.filter((g) => !(g === "looter" && seatCount <= 2));
    for (let k = 0; k < 2 && pool.length; k++) {
      const i = Math.floor(rnd(s) * pool.length);
      s.goals.push(pool[i]);
      pool.splice(i, 1);
    }
  }
  if (opts.mode === "bomb") {
    const nb = bombCountFor(seatCount);
    for (let k = 0; k < nb; k++) s.bombs.push({ id: k + 1, state: "pending", holder: -1, at: 0, fuseAt: 0, shieldUntil: 0, prev: -1, prevUntil: 0, dropAt: COUNTDOWN_MS + BOMB_FIRST_MS + k * 2500 });
  }
  if (opts.augments) {
    const len = fightEnd - COUNTDOWN_MS;
    s.augAtMs = AUG_AT.map((f) => (f === 0 ? 0 : Math.round(Math.min(COUNTDOWN_MS + f * len, s.saleStart - 5000) / STEP_MS) * STEP_MS));
    s.augNext = 0;
    openAug(s, "countdown");
  }
  return s;
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  mx: number;
  mz: number;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  dash: number;
  /** ✂️ 줄 끊기 / 🤝 넘겨주기 */
  skill: number;
  /** 🧬 증강 고르기 [번호(늘어나면 새 요청), 회차, 카드 0~2 · −1 = 다시 뽑기] */
  aug?: [number, number, number];
}

export interface BotMemory {
  nextThinkAt: number;
  /** 지금 하는 일 (디버그·테스트용) */
  plan: "collect" | "snatch" | "home" | "loot" | "flee" | "bomb" | "wander";
  target: number;
  /** 이번에 집에 갈 줄 값 기준 */
  homeAt: number;
  wander: { x: number; z: number; until: number } | null;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seenDash: number[];
  seenSkill: number[];
  dashReq: number[];
  skillReq: number[];
  acc: number;
  bots: BotMemory[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
  /** 핑 보정: 몸의 지난 위치 */
  hist: { x: number; z: number }[][];
  /** 핑 보정: 줄 위 물건의 지난 위치 */
  toyHist: Map<number, { x: number; z: number }[]>;
  seenAug: number[];
  /** 🧬 봇(대신 하는 봇 포함)이 고를 카드 번호 — 없으면 무작위 */
  augChoose: ((rt: HostRuntime, seat: number, offer: AugId[]) => number) | null;
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, dash: 0, skill: 0 });
const LAG_STEPS = Math.max(1, Math.round(LAG_COMP_MS / STEP_MS));

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seenDash: Array(n).fill(0),
    seenSkill: Array(n).fill(0),
    dashReq: Array(n).fill(-1),
    skillReq: Array(n).fill(-1),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, plan: "collect" as const, target: -1, homeAt: 0, wander: null })),
    think,
    botRng: { rng: (state.seed ^ 0x5bd1e995) | 0 },
    hist: state.players.map(() => []),
    toyHist: new Map(),
    seenAug: Array(n).fill(0),
    augChoose: null,
  };
}

export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= rt.state.seatCount) return;
  if (rt.state.players[seat].bot) return;
  setInput(rt, seat, inp);
}

export function setInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput>) {
  const cur = rt.inputs[seat];
  let mx = Number(inp.mx) || 0;
  let mz = Number(inp.mz) || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  cur.mx = mx;
  cur.mz = mz;
  const d = Number(inp.dash) || 0;
  const k = Number(inp.skill) || 0;
  if (d > rt.seenDash[seat]) {
    rt.seenDash[seat] = d;
    rt.dashReq[seat] = rt.state.t;
  }
  if (k > rt.seenSkill[seat]) {
    rt.seenSkill[seat] = k;
    rt.skillReq[seat] = rt.state.t;
  }
  cur.dash = d;
  cur.skill = k;
  const a = inp.aug;
  if (Array.isArray(a) && a.length === 3 && Number(a[0]) > (rt.seenAug[seat] ?? 0)) {
    rt.seenAug[seat] = Number(a[0]);
    augAction(rt.state, seat, Number(a[1]), Number(a[2]));
  }
}

export function press(rt: HostRuntime, seat: number, what: "dash" | "skill") {
  if (what === "dash") rt.dashReq[seat] = rt.state.t;
  else rt.skillReq[seat] = rt.state.t;
}

/** 사람이 나가면 봇이 대신, 돌아오면 돌려준다 (줄·폭탄은 그대로) */
export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p) return;
  if (away && !p.bot) {
    p.bot = true;
    p.away = true;
  } else if (!away && p.away) {
    p.bot = false;
    p.away = false;
    rt.inputs[seat] = idleInput();
    rt.seenDash[seat] = 0;
    rt.seenSkill[seat] = 0;
    rt.seenAug[seat] = 0;
  }
}

/* ── 진행 ───────────────────────────────────────────────────────────── */

export function hostStep(rt: HostRuntime, dtMs: number) {
  rt.acc += Math.min(dtMs, 250);
  while (rt.acc >= STEP_MS) {
    rt.acc -= STEP_MS;
    step(rt);
  }
}

export function step(rt: HostRuntime) {
  const s = rt.state;
  if (s.phase === "augment") {
    augStep(rt);
    return;
  }
  const an = s.augNext ?? AUG_AT.length;
  if (s.phase === "fight" && an < AUG_AT.length && s.t >= (s.augAtMs?.[an] ?? Infinity)) {
    openAug(s, "fight");
    return;
  }
  s.t += STEP_MS;
  if (s.phase === "countdown") {
    if (s.t >= s.phaseEnd) {
      s.phase = "fight";
      s.phaseStart = s.t;
      emit(s, { k: "go" });
    }
  } else if (s.phase === "fight") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    fight(rt);
  } else {
    for (const p of s.players) {
      p.vx *= 0.9;
      p.vz *= 0.9;
      p.x += (p.vx * STEP_MS) / 1000;
      p.z += (p.vz * STEP_MS) / 1000;
    }
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function fight(rt: HostRuntime) {
  const s = rt.state;
  const dt = STEP_MS / 1000;
  let byId = new Map(s.toys.map((t) => [t.id, t]));
  for (const p of s.players) {
    control(rt, p, byId);
    moveBody(rt, p, dt, byId);
  }
  collideBodies(s);
  for (const p of s.players) {
    const h = rt.hist[p.seat] ?? (rt.hist[p.seat] = []);
    h.push({ x: p.x, z: p.z });
    if (h.length > LAG_STEPS + 1) h.shift();
  }
  followChains(rt, dt, byId);
  deposits(s, byId);
  byId = new Map(s.toys.map((t) => [t.id, t]));
  touches(rt, byId);
  if (isBomb(s)) bombs(rt);
  drops(s);
  shopEvents(s);
  piggy(s);
  scoring(s);
  if (!s.sale && s.t >= s.saleStart) startSale(s);
  if (s.t >= s.fightEnd) finishMatch(s);
}

/* ── 조작 ───────────────────────────────────────────────────────────── */

function control(rt: HostRuntime, p: PlayerState, byId: Map<number, Toy>) {
  const s = rt.state;
  const dq = rt.dashReq[p.seat];
  if (dq >= 0) {
    if (s.t - dq > 200) rt.dashReq[p.seat] = -1;
    else if (p.move === "none" && s.t >= p.dashCdAt) {
      rt.dashReq[p.seat] = -1;
      const inp = rt.inputs[p.seat];
      const l = Math.hypot(inp.mx, inp.mz);
      const dx = l > 0.2 ? inp.mx / l : Math.cos(p.face);
      const dz = l > 0.2 ? inp.mz / l : Math.sin(p.face);
      const sp = DASH_SPEED * weightMult(s, p, byId);
      p.vx = dx * sp;
      p.vz = dz * sp;
      p.face = Math.atan2(dz, dx);
      p.move = "dash";
      p.moveAt = s.t;
      p.moveUntil = s.t + DASH_MS;
      p.dashCdAt = s.t + dashCdOf(p);
      p.stats.dashes += 1;
      emit(s, { k: "dash", s: p.seat });
    }
  }
  const kq = rt.skillReq[p.seat];
  if (kq >= 0) {
    if (s.t - kq > 200) {
      rt.skillReq[p.seat] = -1;
      return;
    }
    if (p.chain.length === 0) {
      rt.skillReq[p.seat] = -1;
      return;
    }
    // 🤝 팀전: 팀원에게 닿아 있으면 넘겨주기
    if (isTeam(s) && s.t >= p.passCdAt) {
      let mate: PlayerState | null = null;
      let md = Infinity;
      for (const o of s.players) {
        if (!allies(s, p.seat, o.seat)) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d <= passReachOf(p) && d < md && o.chain.length < maxChainOf(o)) {
          mate = o;
          md = d;
        }
      }
      if (mate) {
        rt.skillReq[p.seat] = -1;
        passChain(s, p, mate, byId);
        return;
      }
    }
    if (s.t >= p.cutCdAt) {
      rt.skillReq[p.seat] = -1;
      cutChain(s, p, byId);
    }
  }
}

function dropToFloor(s: MatchState, t: Toy, noPick = DROP_NOPICK_MS) {
  t.state = "floor";
  t.owner = -1;
  t.noPickUntil = s.t + noPick;
  t.shieldUntil = 0;
  const spot = clampSpot(s.radius, s.stands, t.x, t.z, TOY_R + 0.05);
  t.x = spot.x;
  t.z = spot.z;
}

/** ✂️ 내 줄 끊기: 뒤에서 절반(올림)을 떨어뜨리고 잠깐 빠르게 */
function cutChain(s: MatchState, p: PlayerState, byId: Map<number, Toy>) {
  const n = Math.ceil(p.chain.length / 2);
  const cut = p.chain.splice(p.chain.length - n, n);
  for (const id of cut) {
    const t = byId.get(id);
    if (t) dropToFloor(s, t);
  }
  p.cutCdAt = s.t + cutCdOf(p);
  p.boostUntil = s.t + (hasAug(p, "scissors") ? AUG_N.scissorsBoostMs : CUT_BOOST_MS);
  p.stats.cuts += 1;
  emit(s, { k: "cut", s: p.seat, n, x: p.x, z: p.z });
}

/** 🤝 팀원에게 줄 넘겨주기 (팀원 한도 안에서 앞에서부터) */
function passChain(s: MatchState, p: PlayerState, mate: PlayerState, byId: Map<number, Toy>) {
  let n = 0;
  const keep: number[] = [];
  for (const id of p.chain) {
    const t = byId.get(id);
    if (!t) continue;
    if (limitBlock(s, mate, t.kind, byId)) {
      keep.push(id);
      continue;
    }
    mate.chain.push(id);
    t.owner = mate.seat;
    t.shieldUntil = s.t + SHIELD_MS;
    n++;
  }
  p.chain = keep;
  p.passCdAt = s.t + (hasAug(p, "teamPlayer") ? AUG_N.teamPassCdMs : PASS_CD_MS);
  if (hasAug(p, "teamPlayer") && n > 0) p.boostUntil = Math.max(p.boostUntil, s.t + AUG_N.teamPassBoostMs);
  p.stats.passes += 1;
  mate.stats.maxChain = Math.max(mate.stats.maxChain, mate.chain.length);
  emit(s, { k: "pass", s: p.seat, to: mate.seat, n, x: p.x, z: p.z });
}

function stagger(s: MatchState, p: PlayerState, ms: number, by: number) {
  if (hasAug(p, "steady")) ms *= AUG_N.steadyStagger;
  p.move = "stagger";
  p.moveAt = s.t;
  p.moveUntil = Math.max(p.moveUntil, s.t + ms);
  if (by >= 0) {
    p.lastHitBy = by;
    p.lastHitAt = s.t;
  }
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

function moveBody(rt: HostRuntime, p: PlayerState, dt: number, byId: Map<number, Toy>) {
  const s = rt.state;
  const geo = geoOf(s);
  const inp = rt.inputs[p.seat];
  const wet = isWet(s) && !hasAug(p, "steady");
  if (p.move === "dash") {
    if (s.t >= p.moveUntil) {
      p.move = "none";
      p.vx *= 0.45;
      p.vz *= 0.45;
    }
  } else if (p.move === "stagger") {
    p.vx -= p.vx * STAGGER_DRAG * dt;
    p.vz -= p.vz * STAGGER_DRAG * dt;
    if (s.t >= p.moveUntil) p.move = "none";
  } else {
    const m = speedMult(s, p, byId);
    const acc = wet ? WET_ACCEL : ACCEL;
    const drag = wet ? WET_DRAG : DRAG;
    p.vx += (inp.mx * acc * m - p.vx * drag) * dt;
    p.vz += (inp.mz * acc * m - p.vz * drag) * dt;
    if (Math.hypot(inp.mx, inp.mz) > 0.2) p.face = turnTo(p.face, Math.atan2(inp.mz, inp.mx), dt * 14);
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const push = walkwayPush(geo, p.x, p.z, WALKWAY_SPEED);
  if (push) {
    p.x += push.vx * dt;
    p.z += push.vz * dt;
  }
  for (const c of s.stands) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const need = c.r + BODY_R;
    if (d >= need) continue;
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    p.x = c.x + nx * need;
    p.z = c.z + nz * need;
    const vn = p.vx * nx + p.vz * nz;
    if (vn < 0) {
      p.vx -= nx * vn * 1.3;
      p.vz -= nz * vn * 1.3;
    }
  }
  // 담: 안으로 밀고 바깥 속도를 지운다 (살짝 튕김)
  const r = Math.hypot(p.x, p.z);
  const lim = geo.radius - BODY_R;
  if (r > lim) {
    const nx = p.x / r;
    const nz = p.z / r;
    p.x = nx * lim;
    p.z = nz * lim;
    const vn = p.vx * nx + p.vz * nz;
    if (vn > 0) {
      p.vx -= nx * vn * 1.3;
      p.vz -= nz * vn * 1.3;
    }
  }
}

function collideBodies(s: MatchState) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const rr = BODY_R * 2;
      if (d >= rr) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const over = (rr - d) / 2;
      a.x -= nx * over;
      a.z -= nz * over;
      b.x += nx * over;
      b.z += nz * over;
      const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (vn <= 0) continue;
      const aDash = a.move === "dash";
      const bDash = b.move === "dash";
      if (aDash !== bDash) {
        const hit = aDash ? b : a;
        const dasher = aDash ? a : b;
        const dir = aDash ? 1 : -1;
        const sp = Math.hypot(dasher.vx, dasher.vz) * 0.7;
        hit.vx = nx * dir * sp;
        hit.vz = nz * dir * sp;
        dasher.vx *= 0.25;
        dasher.vz *= 0.25;
        dasher.move = "none";
        if (!allies(s, a.seat, b.seat)) {
          const ram = hasAug(dasher, "ram");
          stagger(s, hit, DASH_HIT_STAGGER_MS * (ram ? AUG_N.ramStagger : 1), dasher.seat);
          dasher.stats.dashHits += 1;
          if (ram) ramDrop(s, dasher, hit);
        }
        emit(s, { k: "dashHit", a: dasher.seat, b: hit.seat, x: a.x + nx * BODY_R, z: a.z + nz * BODY_R });
        continue;
      }
      const J = ((1 + RESTITUTION) * vn) / 2;
      a.vx -= nx * J;
      a.vz -= nz * J;
      b.vx += nx * J;
      b.vz += nz * J;
      if (vn > 3) emit(s, { k: "bump", a: a.seat, b: b.seat, x: a.x + nx * BODY_R, z: a.z + nz * BODY_R, p: Math.round(vn * 10) / 10 });
    }
  }
}

/* ── 줄 ─────────────────────────────────────────────────────────────── */

/** 줄 위 물건이 앞 물건(맨 앞은 몸)을 간격 GAP으로 따라온다 — 밧줄처럼 */
function followChains(rt: HostRuntime, dt: number, byId: Map<number, Toy>) {
  const s = rt.state;
  const maxStep = CHAIN_PULL * dt;
  for (const p of s.players) {
    let lx = p.x;
    let lz = p.z;
    for (const id of p.chain) {
      const t = byId.get(id);
      if (!t) continue;
      const dx = t.x - lx;
      const dz = t.z - lz;
      const d = Math.hypot(dx, dz);
      if (d > GAP) {
        const mv = Math.min(d - GAP, maxStep);
        t.x -= (dx / d) * mv;
        t.z -= (dz / d) * mv;
      }
      // 진열대·담 밖으로 삐져나가지 않게
      for (const c of s.stands) {
        const ex = t.x - c.x;
        const ez = t.z - c.z;
        const ed = Math.hypot(ex, ez);
        const need = c.r + TOY_R;
        if (ed < need && ed > 1e-6) {
          t.x = c.x + (ex / ed) * need;
          t.z = c.z + (ez / ed) * need;
        }
      }
      const r = Math.hypot(t.x, t.z);
      const lim = s.radius - TOY_R;
      if (r > lim) {
        t.x *= lim / r;
        t.z *= lim / r;
      }
      lx = t.x;
      lz = t.z;
      const h = rt.toyHist.get(id) ?? [];
      h.push({ x: t.x, z: t.z });
      if (h.length > LAG_STEPS + 1) h.shift();
      rt.toyHist.set(id, h);
    }
  }
  // 줄에서 빠진 물건의 기록은 지운다
  if (rt.toyHist.size > 0 && s.t % 1000 < STEP_MS) {
    for (const id of [...rt.toyHist.keys()]) {
      const t = byId.get(id);
      if (!t || t.state !== "chain") rt.toyHist.delete(id);
    }
  }
}

function attach(s: MatchState, p: PlayerState, t: Toy, shield = SHIELD_MS) {
  t.state = "chain";
  t.owner = p.seat;
  t.shieldUntil = s.t + shield;
  t.noPickUntil = 0;
  p.chain.push(t.id);
  p.stats.maxChain = Math.max(p.stats.maxChain, p.chain.length);
}

/* ── 바구니 ─────────────────────────────────────────────────────────── */

const KIND_STAT: Record<ToyKind, keyof PlayerStats> = { sock: "socks", duck: "ducks", robot: "robots", gift: "gifts", trophy: "trophies" };

function endRun(s: MatchState, p: PlayerState) {
  if (p.run.n > 0) {
    p.stats.bestRun = Math.max(p.stats.bestRun, p.run.sum);
    p.stats.bestRunToys = Math.max(p.stats.bestRunToys, p.run.n);
    emit(s, { k: "runEnd", s: p.seat, sum: p.run.sum, n: p.run.n });
  }
  p.run = newRun();
}

function deposits(s: MatchState, byId: Map<number, Toy>) {
  let removed = false;
  for (const p of s.players) {
    const b = basketOf(s, p);
    const d = Math.hypot(p.x - b.x, p.z - b.z);
    if (!p.inBasket && d <= BASKET_R) {
      p.inBasket = true;
      p.run = newRun();
      p.depositNextAt = Math.max(p.depositNextAt, s.t);
    } else if (p.inBasket && d > BASKET_R + 0.3) {
      p.inBasket = false;
      endRun(s, p);
    }
    if (!p.inBasket || p.chain.length === 0 || s.t < p.depositNextAt) continue;
    const id = p.chain.shift()!;
    const t = byId.get(id);
    p.depositNextAt = s.t + (hasAug(p, "fastDeposit") ? AUG_N.fastDepositMs : DEPOSIT_MS);
    if (!t) continue;
    t.state = "floor";
    t.owner = -2; // 표시: 지울 것
    removed = true;
    b.stack.push(t.kind);
    const v = valueOf(t.kind);
    p.stats.deposits += 1;
    p.stats.depositValue += v;
    (p.stats[KIND_STAT[t.kind]] as number) += 1;
    const sale = !!s.event && s.event.k === "timeSale" && s.event.kind === t.kind && s.t < s.event.until;
    const saleV = sale ? v * (hasAug(p, "regular") ? AUG_N.regularSaleMult : 1) : 0;
    if (sale) {
      p.bonus += saleV;
      p.stats.saleBonus += saleV;
    }
    const extra = depositAugBonus(s, p, t.kind);
    if (extra) {
      p.bonus += extra;
      p.stats.augBonus += extra;
    }
    p.run.sum += v + saleV + extra;
    p.run.n += 1;
    emit(s, { k: "deposit", s: p.seat, kind: t.kind, v: v + saleV + extra, x: b.x, z: b.z, sale });
    const ki = BASIC_KINDS.indexOf(t.kind);
    if (ki >= 0) {
      p.run.counts[ki] += 1;
      const sm = hasAug(p, "setMaster") ? AUG_N.setMasterMult : 1;
      if (p.run.counts[ki] === 3 && !(p.run.tri & (1 << ki))) {
        p.run.tri |= 1 << ki;
        p.bonus += SET_TRIPLE_BONUS * sm;
        p.stats.setBonus += SET_TRIPLE_BONUS * sm;
        emit(s, { k: "set", s: p.seat, set: "triple", kind: t.kind, b: SET_TRIPLE_BONUS * sm, x: b.x, z: b.z });
      }
      if (!p.run.rainbow && p.run.counts.every((c) => c > 0)) {
        p.run.rainbow = true;
        p.bonus += SET_RAINBOW_BONUS * sm;
        p.stats.setBonus += SET_RAINBOW_BONUS * sm;
        emit(s, { k: "set", s: p.seat, set: "rainbow", kind: null, b: SET_RAINBOW_BONUS * sm, x: b.x, z: b.z });
      }
    }
  }
  if (removed) s.toys = s.toys.filter((t) => t.owner !== -2);
}

/* ── 만지기 ─────────────────────────────────────────────────────────── */

function canTouch(p: PlayerState): boolean {
  return p.move !== "stagger";
}

function tieBetter(a: PlayerState, b: PlayerState): boolean {
  if (a.score !== b.score) return a.score < b.score;
  return a.seat < b.seat;
}

function blocked(s: MatchState, p: PlayerState, why: "full" | "gift" | "trophy") {
  if (s.t < p.fullWarnAt) return;
  p.fullWarnAt = s.t + FULL_WARN_MS;
  emit(s, { k: "blocked", s: p.seat, why });
}

function touches(rt: HostRuntime, byId: Map<number, Toy>) {
  const s = rt.state;
  const acted = new Set<number>();
  // ① 가로채기: 남의 줄 k번째를 만지면 k번째부터 끝까지 내 줄 끝으로. 더 앞 칸을 만진 사람부터.
  const cands: { p: PlayerState; o: PlayerState; k: number; d: number }[] = [];
  for (const p of s.players) {
    if (!canTouch(p) || (p.move === "dash" && !hasAug(p, "dashSnatch")) || s.t < p.snatchCdAt) continue;
    const reach = snatchReachOf(p);
    for (const o of s.players) {
      if (o === p || allies(s, p.seat, o.seat) || o.chain.length === 0) continue;
      if (p.revengeOn === o.seat && s.t < p.revengeUntil) continue;
      // 🧺 내 바구니 안에 선 사람의 줄은 안전
      if (o.inBasket) continue;
      for (let k = safeCount(s, o); k < o.chain.length; k++) {
        const t = byId.get(o.chain[k]);
        if (!t || s.t < t.shieldUntil) continue;
        let d = Math.hypot(t.x - p.x, t.z - p.z);
        const old = rt.toyHist.get(t.id)?.[0];
        if (old) d = Math.min(d, Math.hypot(old.x - p.x, old.z - p.z));
        if (d <= reach) {
          cands.push({ p, o, k, d });
          break; // 가장 앞 칸 하나만
        }
      }
    }
  }
  cands.sort((a, b) => a.k - b.k || a.d - b.d || (tieBetter(a.p, b.p) ? -1 : 1));
  for (const c of cands) {
    if (acted.has(c.p.seat)) continue;
    const id = c.o.chain[c.k];
    const t = id !== undefined ? byId.get(id) : undefined;
    if (!t || t.owner !== c.o.seat || s.t < t.shieldUntil) continue;
    if (c.p.chain.length >= maxChainOf(c.p)) {
      blocked(s, c.p, "full");
      continue;
    }
    acted.add(c.p.seat);
    snatch(s, c.p, c.o, c.k, byId);
  }
  // ② 바닥 줍기: 물건마다 가장 가까운 사람
  for (const t of s.toys) {
    if (t.state !== "floor" || s.t < t.noPickUntil) continue;
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const p of s.players) {
      if (acted.has(p.seat) || !canTouch(p)) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > pickReachOf(p)) continue;
      const why = limitBlock(s, p, t.kind, byId);
      if (why) {
        blocked(s, p, why);
        continue;
      }
      if (d < bestD - 0.005 || (Math.abs(d - bestD) <= 0.005 && best && tieBetter(p, best))) {
        best = p;
        bestD = d;
      }
    }
    if (!best) continue;
    acted.add(best.seat);
    attach(s, best, t, hasAug(best, "vacuum") ? AUG_N.vacuumShieldMs : hasAug(best, "tape") ? AUG_N.tapePickShieldMs : SHIELD_MS);
    best.stats.picks += 1;
    emit(s, { k: "pick", s: best.seat, kind: t.kind, x: t.x, z: t.z });
    if (hasAug(best, "pickupBoost")) best.boostUntil = Math.max(best.boostUntil, s.t + AUG_N.pickupBoostMs);
    if (hasAug(best, "vacuum")) vacuum(s, best, t, byId);
  }
  // ③ 🔥 마감 세일: 남의 바구니 맨 위 1개 털기
  if (s.sale) {
    s.baskets.forEach((b, bi) => {
      if (b.stack.length === 0 || s.t < b.lootCdUntil) return;
      if (basketSafe(s, bi)) return;
      const top = b.stack[b.stack.length - 1];
      let best: PlayerState | null = null;
      let bestD = Infinity;
      for (const p of s.players) {
        if (acted.has(p.seat) || !canTouch(p) || p.move === "dash" || isBasketKeeper(s, p, bi)) continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d > lootReachOf(p) || limitBlock(s, p, top, byId)) continue;
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
      if (!best) return;
      acted.add(best.seat);
      b.lootCdUntil = s.t + (s.players.some((q) => isBasketKeeper(s, q, bi) && hasAug(q, "lockBasket")) ? AUG_N.lockLootCdMs : LOOT_CD_MS);
      const takes = hasAug(best, "bigLoot") ? AUG_N.bigLootN : 1;
      for (let k = 0; k < takes && b.stack.length > 0; k++) {
        const kind = b.stack[b.stack.length - 1];
        if (k > 0 && limitBlock(s, best, kind, byId)) break;
        b.stack.pop();
        const t = addToy(s, kind, b.x + (best.x - b.x) * 0.5, b.z + (best.z - b.z) * 0.5, "chain");
        attach(s, best, t);
        byId.set(t.id, t);
        best.stats.loots += 1;
        for (const q of s.players) if (isBasketKeeper(s, q, bi)) q.stats.looted += 1;
        emit(s, { k: "loot", s: best.seat, basket: bi, kind, x: b.x, z: b.z });
      }
    });
  }
}

/** 이 바구니를 지금 털 수 없나: 주인이 바구니 안에 서 있음 · 🐣 꼴찌의 바구니 */
export function basketSafe(s: MatchState, bi: number): boolean {
  const b = s.baskets[bi];
  return s.players.some((q) => isBasketKeeper(s, q, bi) && (Math.hypot(q.x - b.x, q.z - b.z) <= BASKET_R || (!isTeam(s) && isUnderdog(s, q))));
}

/** 이 사람이 이 바구니 주인(팀전: 그 팀)인가 */
export function isBasketKeeper(s: MatchState, p: PlayerState, bi: number): boolean {
  const b = s.baskets[bi];
  return b.team >= 0 ? p.team === b.team && isTeam(s) : b.owner === p.seat;
}

function snatch(s: MatchState, p: PlayerState, o: PlayerState, k: number, byId: Map<number, Toy>) {
  const moved = o.chain.splice(k);
  let n = 0;
  let v = 0;
  let x = p.x;
  let z = p.z;
  for (const id of moved) {
    const t = byId.get(id);
    if (!t) continue;
    if (n === 0) {
      x = t.x;
      z = t.z;
    }
    if (limitBlock(s, p, t.kind, byId)) {
      dropToFloor(s, t, DROP_NOPICK_MS);
      continue;
    }
    attach(s, p, t, hasAug(p, "tape") ? AUG_N.tapeSnatchShieldMs : SNATCH_SHIELD_MS);
    n++;
    v += valueOf(t.kind);
  }
  o.revengeOn = p.seat;
  o.revengeUntil = s.t + REVENGE_MS;
  p.snatchCdAt = s.t + snatchCdOf(p);
  if (hasAug(o, "counter")) {
    o.revengeUntil = 0;
    o.snatchCdAt = Math.min(o.snatchCdAt, s.t);
  }
  if (hasAug(o, "sticky")) stagger(s, p, AUG_N.stickyStaggerMs, o.seat);
  p.stats.snatches += 1;
  p.stats.snatchedToys += n;
  p.stats.snatchedValue += v;
  o.stats.lost += 1;
  o.stats.lostValue += v;
  s.snatchCount += 1;
  emit(s, { k: "snatch", s: p.seat, from: o.seat, n, v, x, z });
}

/* ── 💣 폭탄 세일 ───────────────────────────────────────────────────── */

function bombs(rt: HostRuntime) {
  const s = rt.state;
  for (const b of s.bombs) {
    if (b.state === "pending") {
      if (s.t < b.dropAt || s.t > s.fightEnd - 4000) continue;
      // 1등(동점이면 무작위)에게 내려앉는다 — 앞선 사람 견제
      const pool = s.players.filter((p) => !bombOf(s, p.seat));
      if (!pool.length) continue;
      const top = Math.max(...pool.map((p) => p.score));
      const tops = pool.filter((p) => p.score === top);
      const to = tops[Math.floor(rnd(s) * tops.length)];
      b.state = "held";
      b.holder = to.seat;
      b.at = s.t;
      b.fuseAt = s.t + BOMB_FUSE_MIN + rnd(s) * (BOMB_FUSE_MAX - BOMB_FUSE_MIN);
      b.shieldUntil = s.t + (hasAug(to, "bombPro") ? AUG_N.bombProShieldMs : BOMB_SHIELD_MS);
      b.prev = -1;
      b.prevUntil = 0;
      emit(s, { k: "bombOn", s: to.seat, from: -1, x: to.x, z: to.z });
      continue;
    }
    const h = s.players[b.holder];
    if (!h) continue;
    if (s.t >= b.fuseAt) {
      explode(s, b, h);
      continue;
    }
    if (s.t < b.shieldUntil || !canTouch(h)) continue;
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const o of s.players) {
      if (o === h || allies(s, o.seat, h.seat) || bombOf(s, o.seat)) continue;
      if (b.prev === o.seat && s.t < b.prevUntil) continue;
      let d = Math.hypot(o.x - h.x, o.z - h.z);
      const old = rt.hist[o.seat]?.[0];
      if (old) d = Math.min(d, Math.hypot(old.x - h.x, old.z - h.z));
      if (d <= TOUCH_BODY && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    if (!best) continue;
    b.holder = best.seat;
    b.prev = h.seat;
    b.prevUntil = s.t + BOMB_REVENGE_MS;
    b.shieldUntil = s.t + (hasAug(best, "bombPro") ? AUG_N.bombProShieldMs : BOMB_SHIELD_MS);
    h.stats.bombPasses += 1;
    emit(s, { k: "bombOn", s: best.seat, from: h.seat, x: best.x, z: best.z });
  }
}

function explode(s: MatchState, b: Bomb, h: PlayerState) {
  const byId = new Map(s.toys.map((t) => [t.id, t]));
  const n = h.chain.length;
  for (const id of h.chain) {
    const t = byId.get(id);
    if (t) dropToFloor(s, t, 800);
  }
  h.chain = [];
  // 바구니 맨 위 물건이 날아가 바구니 앞에 흩어진다 (팀전엔 폭탄 모드가 없다)
  const bk = basketOf(s, h);
  let lost = 0;
  const keep = hasAug(h, "bombPro") || hasAug(h, "lockBasket");
  for (let k = 0; k < (keep ? 0 : BOMB_BASKET_LOSS) && bk.stack.length > 0; k++) {
    const kind = bk.stack.pop()!;
    const a = bk.a + Math.PI + (rnd(s) - 0.5) * 1.4;
    const r = 2.2 + rnd(s) * 1.2;
    const spot = clampSpot(s.radius, s.stands, bk.x + Math.cos(a) * r, bk.z + Math.sin(a) * r, TOY_R + 0.1);
    const t = addToy(s, kind, spot.x, spot.z);
    t.noPickUntil = s.t + 800;
    lost++;
  }
  stagger(s, h, BOMB_STAGGER_MS, -1);
  h.stats.bombBooms += 1;
  emit(s, { k: "boom", s: h.seat, n, lost, x: h.x, z: h.z });
  b.state = "pending";
  b.holder = -1;
  b.fuseAt = 0;
  b.dropAt = s.t + BOMB_RESPAWN_MS;
}

/* ── 떨어지는 물건 · 다시 채우기 · 방송 ─────────────────────────────── */

function freeSpot(s: MatchState): { x: number; z: number } | null {
  for (let tries = 0; tries < 28; tries++) {
    const a = rnd(s) * Math.PI * 2;
    const r = Math.sqrt(rnd(s)) * s.radius * 0.8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (s.stands.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.6)) continue;
    if (s.baskets.some((b) => Math.hypot(b.x - x, b.z - z) < BASKET_R + 0.8)) continue;
    if (s.players.some((p) => Math.hypot(p.x - x, p.z - z) < 1.6)) continue;
    if (s.toys.some((t) => t.state !== "chain" && Math.hypot(t.x - x, t.z - z) < 0.8)) continue;
    return { x, z };
  }
  return null;
}

function pickRefillKind(s: MatchState): ToyKind {
  const tot = REFILL_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = rnd(s) * tot;
  for (const [k, w] of REFILL_WEIGHTS) {
    r -= w;
    if (r < 0) return k;
  }
  return "sock";
}

function dropToy(s: MatchState, kind: ToyKind, at?: { x: number; z: number }) {
  const spot = at ?? freeSpot(s);
  if (!spot) return;
  const t = addToy(s, kind, spot.x, spot.z, "drop", s.t + DROP_WARN_MS);
  emit(s, { k: "dropWarn", toy: t.id, x: t.x, z: t.z, kind });
}

function drops(s: MatchState) {
  for (const t of s.toys) {
    if (t.state === "drop" && s.t >= t.landAt) {
      t.state = "floor";
      emit(s, { k: "land", toy: t.id, x: t.x, z: t.z, kind: t.kind });
    }
  }
  if (s.t >= s.nextRefillAt) {
    s.nextRefillAt = s.t + REFILL_EVERY_MS;
    const thr = s.seatCount <= 2 ? REFILL_THRESHOLD_DUEL : REFILL_THRESHOLD;
    const loose = s.toys.filter((t) => t.state !== "chain").length;
    if (loose < s.initialToys * thr) for (let k = 0; k < REFILL_N; k++) dropToy(s, pickRefillKind(s));
  }
}

function shopEvents(s: MatchState) {
  const ev = s.event;
  if (ev && s.t >= ev.until) {
    emit(s, { k: "shopEnd", e: ev.k });
    s.event = null;
  }
  if (!s.options.events || s.event || s.t < s.nextEventAt) return;
  s.nextEventAt += EVENT_EVERY_MS;
  if (s.t > s.saleStart - 4000) return;
  const kinds = (Object.keys(EVENT_INFO) as ShopEventKind[]).filter((k) => k !== s.lastEvent);
  const k = kinds[Math.floor(rnd(s) * kinds.length)];
  const saleKinds: ToyKind[] = ["sock", "duck", "robot"];
  const kind = k === "timeSale" ? saleKinds[Math.floor(rnd(s) * saleKinds.length)] : null;
  s.event = { k, kind, at: s.t, until: s.t + EVENT_INFO[k].ms };
  s.lastEvent = k;
  emit(s, { k: "shop", e: k, kind });
  if (k === "rain") for (let i = 0; i < RAIN_N; i++) dropToy(s, pickRefillKind(s));
}

function startSale(s: MatchState) {
  s.sale = true;
  s.saleLeader = s.leader;
  emit(s, { k: "sale" });
  const spot = clampSpot(s.radius, s.stands, 0, 0, TOY_R + 0.3);
  dropToy(s, "trophy", spot);
}

/* ── 🧬 증강 ─────────────────────────────────────────────────────────── */

function openAug(s: MatchState, resume: AugPhase["resume"]) {
  const round = s.augNext ?? 0;
  s.augNext = round + 1;
  const tier = rollAugTier(s.seed, round);
  const n = s.seatCount;
  const r = { rng: (s.seed ^ Math.imul(round + 7, 0x27d4eb2d)) | 0 };
  s.aug = {
    round,
    tier,
    offers: s.players.map((p) => rollAugOffer(s.seed, round, p.seat, tier, p.augs ?? [], p.rerolls ?? 0, s.options.mode, s.options.events)),
    done: Array(n).fill(false),
    picks: Array(n).fill(null),
    el: 0,
    limit: AUG_PICK_MS[Math.min(round, AUG_PICK_MS.length - 1)],
    doneAt: -1,
    botAt: s.players.map(() => 900 + Math.floor(rnd(r) * 2600)),
    resume,
  };
  s.phase = "augment";
  for (const p of s.players) if (p.move === "dash") p.move = "none";
  emit(s, { k: "augOpen", round, tier });
}

/** 사람이 고름 / 다시 뽑기 (choice −1). 회차가 안 맞거나 이미 골랐으면 무시. */
export function augAction(s: MatchState, seat: number, round: number, choice: number) {
  const a = s.aug;
  const p = s.players[seat];
  if (s.phase !== "augment" || !a || !p || a.round !== round || a.done[seat] || a.doneAt >= 0) return;
  if (choice === -1) {
    if ((p.rerolls ?? 0) >= AUG_REROLLS) return;
    p.rerolls = (p.rerolls ?? 0) + 1;
    a.offers[seat] = rollAugOffer(s.seed, round, seat, a.tier, p.augs ?? [], p.rerolls, s.options.mode, s.options.events, a.offers[seat]);
    return;
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= AUG_OFFER) return;
  takeAug(s, seat, choice, false);
}

function takeAug(s: MatchState, seat: number, choice: number, auto: boolean) {
  const a = s.aug!;
  const p = s.players[seat];
  const id = a.offers[seat]?.[choice] ?? a.offers[seat]?.[0];
  a.done[seat] = true;
  if (!id) return;
  a.picks[seat] = id;
  p.augs = [...(p.augs ?? []), id];
  emit(s, { k: "augPick", s: seat, aug: id, auto });
}

function augStep(rt: HostRuntime) {
  const s = rt.state;
  const a = s.aug;
  if (!a) {
    s.phase = "fight";
    return;
  }
  a.el += STEP_MS;
  if (a.doneAt < 0) {
    for (const p of s.players) {
      if (a.done[p.seat] || !p.bot || a.el < a.botAt[p.seat]) continue;
      const offer = a.offers[p.seat] ?? [];
      const i = rt.augChoose ? rt.augChoose(rt, p.seat, offer) : Math.floor(rnd(rt.botRng) * offer.length);
      takeAug(s, p.seat, Math.max(0, Math.min(offer.length - 1, i)), false);
    }
    if (a.el >= a.limit) for (const p of s.players) if (!a.done[p.seat]) takeAug(s, p.seat, 0, true);
    if (a.done.every(Boolean)) a.doneAt = a.el;
    return;
  }
  if (a.el < a.doneAt + AUG_RESUME_MS) return;
  s.aug = null;
  emit(s, { k: "augDone", round: a.round });
  if (a.resume === "countdown") {
    s.phase = "countdown";
    s.phaseStart = s.t;
    s.phaseEnd = s.t + COUNTDOWN_MS;
  } else s.phase = "fight";
}

/** 넣을 때 증강으로 더 받는 점수 */
function depositAugBonus(s: MatchState, p: PlayerState, kind: ToyKind): number {
  if (!p.augs?.length) return 0;
  let b = 0;
  if (kind === "sock" && hasAug(p, "sockLover")) b += AUG_N.sockLoverBonus;
  if (kind === "gift" && hasAug(p, "giftWrap")) b += AUG_N.giftWrapBonus;
  if (kind === "trophy" && hasAug(p, "trophyHunter")) b += AUG_N.trophyHunterBonus;
  if (s.sale && hasAug(p, "clutch")) b += AUG_N.clutchBonus;
  return b;
}

/** 🐂 들이받기: 박힌 사람 줄 끝(못 뺏는 앞 칸 제외)이 바닥으로 */
function ramDrop(s: MatchState, by: PlayerState, hit: PlayerState) {
  const safe = safeCount(s, hit);
  const n = Math.min(AUG_N.ramDropN, Math.max(0, hit.chain.length - safe));
  if (n <= 0 || hit.inBasket) return;
  const ids = hit.chain.splice(hit.chain.length - n, n);
  for (const id of ids) {
    const t = toyOf(s, id);
    if (t) dropToFloor(s, t, 600);
  }
  emit(s, { k: "ram", s: by.seat, to: hit.seat, n, x: hit.x, z: hit.z });
}

/** 🌀 진공 청소기: 주운 물건 둘레의 바닥 물건을 같이 */
function vacuum(s: MatchState, p: PlayerState, first: Toy, byId: Map<number, Toy>) {
  const near = s.toys
    .filter((t) => t !== first && t.state === "floor" && s.t >= t.noPickUntil && Math.hypot(t.x - p.x, t.z - p.z) <= AUG_N.vacuumReach)
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  let n = 0;
  for (const t of near) {
    if (n >= AUG_N.vacuumN) break;
    if (limitBlock(s, p, t.kind, byId)) continue;
    attach(s, p, t, AUG_N.vacuumShieldMs);
    p.stats.picks += 1;
    n++;
    emit(s, { k: "pick", s: p.seat, kind: t.kind, x: t.x, z: t.z });
  }
}

/** 🐷 저금통 */
function piggy(s: MatchState) {
  if (s.piggyAt === undefined || s.t < s.piggyAt) return;
  s.piggyAt += AUG_N.piggyEveryMs;
  for (const p of s.players) {
    if (!hasAug(p, "piggyBank")) continue;
    const b = Math.min(AUG_N.piggyMax, Math.floor(basketValue(basketOf(s, p)) / AUG_N.piggyPer));
    if (b <= 0) continue;
    p.bonus += b;
    p.stats.augBonus += b;
    emit(s, { k: "piggy", s: p.seat, b });
  }
}

/* ── 점수 ───────────────────────────────────────────────────────────── */

export function teamBasketValue(s: MatchState, team: number): number {
  const b = s.baskets.find((x) => x.team === team);
  return b ? basketValue(b) : 0;
}

function scoring(s: MatchState) {
  if (isTeam(s)) {
    for (const p of s.players) p.score = p.stats.depositValue + p.bonus;
    for (const k of [0, 1]) {
      const bonus = s.players.filter((p) => p.team === k).reduce((a, p) => a + p.bonus, 0);
      s.teamScores[k as 0 | 1] = Math.round((teamBasketValue(s, k) + bonus) * s.teamMult[k] * 10) / 10;
    }
  } else {
    for (const p of s.players) p.score = basketValue(basketOf(s, p)) + p.bonus;
  }
  let lead = -1;
  if (isTeam(s)) {
    const [a, b] = s.teamScores;
    lead = a > b ? 0 : b > a ? 1 : s.leader;
  } else {
    const sorted = [...s.players].sort((a, b) => b.score - a.score);
    lead = sorted.length > 1 && sorted[0].score === sorted[1].score ? s.leader : sorted[0].seat;
  }
  if (lead !== s.leader) {
    if (s.leader >= 0) s.leadChanges += 1;
    s.leader = lead;
  }
}

/* ── 끝 ─────────────────────────────────────────────────────────────── */

function goalMetric(s: MatchState, p: PlayerState, g: GoalKind): number {
  const st = p.stats;
  switch (g) {
    case "snatcher":
      return st.snatchedValue;
    case "train":
      return st.bestRun;
    case "duck":
      return st.ducks;
    case "robot":
      return st.robots;
    case "socks":
      return st.socks;
    case "looter":
      return st.loots;
    case "clean":
      // 적을수록 좋음 → 음수로 (10점 이상 넣은 사람만)
      return st.depositValue >= 10 ? -st.lostValue : -Infinity;
  }
}

function awardGoals(s: MatchState) {
  s.goalWinners = s.goals.map((g) => {
    const vals = s.players.map((p) => goalMetric(s, p, g));
    const best = Math.max(...vals);
    if (!Number.isFinite(best) || (g !== "clean" && best <= 0)) return [];
    const seats = s.players.filter((p, i) => vals[i] === best).map((p) => p.seat);
    for (const seat of seats) {
      const p = s.players[seat];
      p.bonus += GOAL_BONUS;
      p.stats.goalsWon += 1;
    }
    emit(s, { k: "goal", goal: g, seats });
    return seats;
  });
}

export function rankKey(s: MatchState, p: PlayerState): number[] {
  return [p.score, -basketOf(s, p).stack.length, p.stats.snatchedValue];
}

export function computeRanks(s: MatchState): number[] {
  if (isTeam(s)) {
    const [a, b] = s.teamScores;
    let win = a > b ? 0 : b > a ? 1 : -1;
    if (win < 0) {
      // 동점: 트로피를 넣은 팀 → 바구니 물건이 적은 팀
      const tro = [0, 1].map((k) => (s.baskets.find((x) => x.team === k)?.stack ?? []).filter((x) => x === "trophy").length);
      const cnt = [0, 1].map((k) => s.baskets.find((x) => x.team === k)?.stack.length ?? 0);
      win = tro[0] !== tro[1] ? (tro[0] > tro[1] ? 0 : 1) : cnt[0] !== cnt[1] ? (cnt[0] < cnt[1] ? 0 : 1) : -1;
    }
    s.winnerTeam = win;
    return s.players.map((p) => (win < 0 || p.team === win ? 1 : 2));
  }
  const cmp = (a: PlayerState, b: PlayerState) => {
    const ka = rankKey(s, a);
    const kb = rankKey(s, b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...s.players].sort(cmp);
  const ranks = s.players.map(() => 0);
  sorted.forEach((p, i) => {
    ranks[p.seat] = i > 0 && cmp(sorted[i - 1], p) === 0 ? ranks[sorted[i - 1].seat] : i + 1;
  });
  return ranks;
}

function finishMatch(s: MatchState) {
  const byId = new Map(s.toys.map((t) => [t.id, t]));
  for (const p of s.players) {
    if (p.inBasket) endRun(s, p);
    p.stats.wastedValue = chainValue(s, p, byId);
  }
  if (s.goals.length) awardGoals(s);
  scoring(s);
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.phaseEnd = s.t;
  s.event = null;
  for (const b of s.bombs) {
    b.state = "pending";
    b.holder = -1;
  }
  s.ranks = computeRanks(s);
  emit(s, { k: "over" });
}

export function timeLeft(s: MatchState): number {
  if (s.phase === "countdown" || (s.phase === "augment" && s.aug?.resume === "countdown")) return s.fightEnd - s.fightStart;
  if (s.phase === "gameOver") return 0;
  return Math.max(0, s.fightEnd - s.t);
}
