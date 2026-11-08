import { seededRng } from "@/lib/rng";
import { AUG_BY_ID, AUG_N, AUG_REROLLS, AUG_ROUNDS, rollAugOffer, rollAugTier, type AugId, type AugTier } from "./augments";

/**
 * 죽은척 대작전 — 전장에서 동시에 장전·엄폐·사격을 내는 2~6인 게임에 "죽은 척"을 얹었다.
 * 룰 원전: boardGameRule/죽은척대작전/죽은척대작전.md (자체 창작 룰).
 *
 * 핵심
 * - 매 라운드 모두 비공개로 행동을 고르고(커밋) 동시에 공개(리빌)한다.
 * - 서 있으면: 장전 / 엄폐 / 사격(1발) / 연사(2발) / 수류탄(3발) / 쓰러진 사람에게 탄약 뺏기·확인사살.
 * - 피해를 받으면 살았든 죽었든 **무조건 쓰러진다**. 목숨은 모두 3(공개)이지만 연사·수류탄
 *   등의 피해량은 범위(예: 1~2)만 공개되고 실제 값은 맞은 사람만 안다 — 쓰러진 사람이 진짜
 *   죽었는지는 공개된 피해 범위로 추리할 수밖에 없다. (처음엔 목숨 카드 2/3을 비공개로 나눴지만
 *   셀프플레이에서 목숨 3 카드의 승률 비중이 4인 83%로 운 의존이 커서, 운을 매 타격에 나눴다.)
 * - 쓰러져 있으면: 숨죽이기 / 일어나기 / 벌떡 기습. 진짜 죽은 사람도 똑같은 메뉴를 받고
 *   (아무 효과 없음) 똑같이 제출해야 해서 타이밍으로도 정체가 새지 않는다.
 * - 3라운드를 연달아 누워 있으면 숨이 차서 강제로 일어난다(살아 있다는 게 드러남).
 * - 소생: 쓰러진 채 🩹 붕대(탄약 2발)를 감거나 🎁 구급상자가 떨어지면 — 진짜 시체는 50%로 목숨 1로
 *   살아나고, 살아 있던 사람은 목숨 +1. 겉으로는 똑같이 누워 있고 "치료 시도"만 공개된다 — 공개 확률
 *   (`survivalChance`)이 치료 시점까지 그대로 반영해서 정확히 맞는다.
 * - 실제 생존자가 1명 이하가 되면(또는 최대 라운드) 끝, 모든 정체 공개.
 *
 * 신뢰 모델: 락스텝이라 각 기기가 전체 상태(목숨 포함)를 들고 있다 — 다른 락스텝 게임과 같은
 * 문서화된 한계(docs/architecture.md §2). 화면과 봇은 공개 정보만 쓴다(`publicView`).
 */

export type Seat = number;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_AMMO = 5;
export const MAX_COVER_STREAK = 1;
export const MAX_LIE = 3;
/**
 * "총공세": 8라운드부터 모든 피해 범위 +1, 이후 4라운드마다 +1 더. 판이 늘어지지 않게 —
 * 셀프플레이(레벨 7 봇)에서 총공세 없이는 6인전 99%가 최대 라운드까지 갔다.
 */
export const SURGE_ROUND = 8;
export const SURGE_STEP = 4;
export function surgeAt(round: number): number {
  return round < SURGE_ROUND ? 0 : 1 + Math.floor((round - SURGE_ROUND) / SURGE_STEP);
}

export type MoveKind = "reload" | "cover" | "shot" | "burst" | "grenade" | "loot" | "finish" | "hold" | "rise" | "ambush" | "bandage";
export interface Move {
  kind: MoveKind;
  target?: Seat;
}

export const START_HP = 3;
/** 공격: 탄약 비용 = 화력 등급 (서로 쏘면 화력이 센 쪽이 제압, 같으면 맞사격으로 둘 다 빗나감) */
export const BLAST_TIER: Partial<Record<MoveKind, number>> = { shot: 1, burst: 2, grenade: 3 };
export const FINISH_COST = 1;
/** 🩹 붕대: 쓰러진 채 탄약을 써서 지혈 — 진짜 시체면 REVIVE_CHANCE로 소생, 살아 있으면 목숨 +1 */
export const BANDAGE_COST = 2;
export const REVIVE_CHANCE = 0.5;
/** 🎁 구급상자 낙하: 이 라운드부터 MEDKIT_STEP마다, 쓰러진 몸 하나(무작위)에 떨어진다 */
export const MEDKIT_ROUND = 5;
export const MEDKIT_STEP = 6;
export function isMedkitRound(round: number): boolean {
  return round >= MEDKIT_ROUND && (round - MEDKIT_ROUND) % MEDKIT_STEP === 0;
}
export function nextMedkitRound(round: number): number {
  return round <= MEDKIT_ROUND ? MEDKIT_ROUND : MEDKIT_ROUND + Math.ceil((round - MEDKIT_ROUND) / MEDKIT_STEP) * MEDKIT_STEP;
}
export const LOOT_TAKE = 2;
/** 피해 범위 [최소, 최대] — 범위는 공개, 실제 값은 맞은 사람만 안다 */
export type DmgRange = readonly [number, number];
export const DMG: Record<"shot" | "burst" | "grenade" | "pierce" | "ambush" | "ambushLooter" | "finish", DmgRange> = {
  shot: [1, 1],
  burst: [1, 2],
  grenade: [2, 3],
  pierce: [1, 1],
  ambush: [1, 2],
  ambushLooter: [2, 3],
  finish: [1, 2],
};

export interface GameOptions {
  /** 행동 고르기 제한 시간(초). 0 = 무제한 */
  chooseSeconds: number;
  /** 0 = 인원에 맞춰 자동 (`maxRoundsFor`) */
  maxRounds: number;
  /** 🧬 증강(정해진 라운드 전에 3장 중 1장). 빠진 값 = 꺼짐(구버전 방장 호환) */
  augments?: boolean;
}
export const DEFAULT_OPTIONS: GameOptions = { chooseSeconds: 15, maxRounds: 0, augments: false };

/** 인원이 많을수록 다 쓰러뜨리는 데 오래 걸린다 — 셀프플레이로 맞춘 최대 라운드 (5·6인은 소생 규칙 뒤 21·22: 레벨 7 봇 6인전 최대 라운드 도달 29%→33%) */
export function maxRoundsFor(seatCount: number): number {
  return seatCount <= 3 ? 15 : seatCount === 4 ? 18 : seatCount === 5 ? 21 : 22;
}

export interface SeatState {
  /** 비공개: 남은 목숨 */
  hp: number;
  ammo: number;
  down: boolean;
  dead: boolean;
  /** 확인사살로 사망이 공개됨 — 더 이상 행동하지 않는다 */
  confirmed: boolean;
  /** 연달아 누워 있은 라운드 수(공개) */
  lie: number;
  coverStreak: number;
  /** 공개 정보: 지금까지 맞은 타격들의 피해 범위 */
  hits: DmgRange[];
  /** 공개: 치료 시도(붕대·구급상자) 시점 — 그때까지 맞은 타격 수. 빠진 값 = 없음(구버전 상태) */
  heals?: number[];
  diedRound: number | null;
  /** 개인 기록용 집계 */
  tally: Tally;
  /** 공개: 고른 증강 */
  augs: AugId[];
  /** 공개: 남은 "다음 타격 피해 −1" 횟수(방탄모·방탄조끼) */
  shield: number;
  rerollsUsed: number;
  /** 🩺 청진기로 몰래 안 생사 — 이 자리 화면/봇만 쓴다. hits = 알아낸 때의 맞은 횟수 */
  intel: Record<number, { dead: boolean; hits: number }>;
}

export interface Tally {
  /** 내 타격이 들어간 라운드에 상대가 실제로 죽은 횟수 */
  kills: number;
  blastHits: number;
  ambushHits: number;
  /** 확인사살로 죽은 척을 폭로 */
  exposes: number;
  /** 탄약 뺏기로 챙긴 탄약 */
  ammoLooted: number;
  /** 살아서 누워 있던(연기한) 라운드 */
  fakeRounds: number;
}
const EMPTY_TALLY: Tally = { kills: 0, blastHits: 0, ambushHits: 0, exposes: 0, ammoLooted: 0, fakeRounds: 0 };

export type RoundEvent =
  | { t: "reload"; seat: Seat }
  | { t: "cover"; seat: Seat }
  | { t: "blast"; seat: Seat; target: Seat; tier: number; result: "hit" | "blocked" | "pierce" | "clash" | "overpowered"; hit?: Hit }
  | { t: "ambush"; seat: Seat; target: Seat; result: "hit" | "blocked" | "looter"; hit?: Hit }
  | { t: "loot"; seat: Seat; target: Seat; took: number; foiled: boolean }
  | { t: "finish"; seat: Seat; target: Seat; result: "dead" | "exposed" | "countered"; hit?: Hit }
  | { t: "rise"; seat: Seat; reason: "choice" | "breath" }
  | { t: "fall"; seats: Seat[] }
  /** 증강 효과로 들어간 타격: 부비트랩(seat=누운 몸 → target=턴 사람), 카운터 저격, 파편 */
  | { t: "aug"; id: AugId; seat: Seat; target: Seat; hit: Hit }
  /**
   * 치료 시도(공개). `result`는 숨은 정보 — 그 자리 화면에만 쓴다:
   * revived = 시체였는데 살아남, failed = 시체 그대로, healed = 살아 있었고 목숨 +1(최대면 그대로)
   */
  | { t: "heal"; seat: Seat; source: "bandage" | "medkit"; result: "revived" | "failed" | "healed" };

/** 한 번의 타격: 공개 범위 lo~hi, 실제 값 dmg(맞은 사람 화면에만 보여 준다) */
export interface Hit {
  lo: number;
  hi: number;
  dmg: number;
}

export type Phase = "augment" | "choosing" | "revealing" | "resolved" | "ended";

/** 증강 고르기 회차 — 같은 등급, 자리별 3장 */
export interface AugRound {
  tier: AugTier;
  offers: AugId[][];
  /** 고른 카드(전원이 다 고르기 전엔 화면이 남의 것을 보여 주지 않는다) */
  picks: (AugId | null)[];
  done: boolean[];
}

export interface GameState {
  seed: number;
  seatCount: number;
  options: GameOptions;
  seats: SeatState[];
  round: number;
  phase: Phase;
  /** 단계가 바뀔 때마다 +1 — 타이머/재접속 판정용 */
  stage: number;
  commits: (string | null)[];
  moves: (Move | null)[];
  /** 직전 라운드에 공개된 행동(쓰러진 사람의 행동은 결과로만 드러난다) */
  lastMoves: (Move | null)[];
  events: RoundEvent[];
  ready: boolean[];
  idleStreak: number[];
  /** 증강 고르기 중일 때만 */
  aug?: AugRound | null;
}

export type EngineAction =
  | { type: "COMMIT"; seat: Seat; round: number; hash: string }
  | { type: "REVEAL"; seat: Seat; round: number; move: Move; salt: string }
  | { type: "READY"; seat: Seat; round: number }
  | { type: "AUG_PICK"; seat: Seat; round: number; id: AugId }
  | { type: "AUG_REROLL"; seat: Seat; round: number }
  | { type: "TIMEOUT"; stage: number };

// ---------------------------------------------------------------------------
// 해시 (커밋-공개용, cyrb53)

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function moveHash(move: Move, salt: string): string {
  const body = `${move.kind}:${move.target ?? -1}`;
  return `${cyrb53(body + "|" + salt, 7)}${cyrb53(salt + "|" + body, 13)}`;
}

// ---------------------------------------------------------------------------
// 시작

export function startGame(seatCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, seatCount));
  const state: GameState = {
    seed,
    seatCount: n,
    options: { ...options, maxRounds: options.maxRounds > 0 ? options.maxRounds : maxRoundsFor(n) },
    seats: Array.from({ length: n }, () => ({
      hp: START_HP,
      ammo: 0,
      down: false,
      dead: false,
      confirmed: false,
      lie: 0,
      coverStreak: 0,
      hits: [],
      heals: [],
      diedRound: null,
      tally: { ...EMPTY_TALLY },
      augs: [],
      shield: 0,
      rerollsUsed: 0,
      intel: {},
    })),
    round: 1,
    phase: "choosing",
    stage: 0,
    commits: Array(n).fill(null),
    moves: Array(n).fill(null),
    lastMoves: Array(n).fill(null),
    events: [],
    ready: Array(n).fill(false),
    idleStreak: Array(n).fill(0),
    aug: null,
  };
  return isAugRound(state, 1) ? openAug(state) : state;
}

// ---------------------------------------------------------------------------
// 증강

export function hasAug(s: SeatState, id: AugId): boolean {
  return !!s.augs?.includes(id);
}
export function maxAmmoOf(s: SeatState): number {
  return hasAug(s, "bandolier") ? AUG_N.bandolierMax : MAX_AMMO;
}
/** 공격 탄약 비용(화력 등급과 별개 — 중화기는 수류탄을 2발에 던진다) */
export function costOf(s: SeatState, kind: MoveKind): number {
  if (kind === "grenade" && hasAug(s, "heavy")) return AUG_N.heavyGrenadeCost;
  if (kind === "finish") return hasAug(s, "coroner") ? 0 : FINISH_COST;
  return BLAST_TIER[kind] ?? 0;
}
export function coverLimitOf(s: SeatState): number {
  return hasAug(s, "coverPro") ? AUG_N.coverProStreak : MAX_COVER_STREAK;
}
/** 공개: 이 자리가 누워 버틸 수 있는 라운드 수 — 넘게 누워 있으면 시체 */
export function lieLimitOf(s: SeatState): number {
  return MAX_LIE + (hasAug(s, "camo") ? AUG_N.camoLie : 0) + (hasAug(s, "understudy") ? AUG_N.understudyLie : 0);
}
/** 쓰러졌다 일어날 때 받는 탄약(아드레날린·위장복) */
export function riseAmmo(s: SeatState): number {
  return (hasAug(s, "adrenaline") ? AUG_N.adrenalineAmmo : 0) + (hasAug(s, "camo") ? AUG_N.camoRiseAmmo : 0);
}
/** 확인사살로 받는 피해 범위(위장복 −1, 최소 1) */
export function finishRange(s: SeatState): DmgRange {
  return hasAug(s, "camo") ? [Math.max(1, DMG.finish[0] - 1), Math.max(1, DMG.finish[1] - 1)] : DMG.finish;
}
export function reloadGain(s: SeatState): number {
  return hasAug(s, "ammoCrate") && s.ammo <= AUG_N.ammoCrateBelow ? AUG_N.ammoCrateReload : 1;
}
export function lootTakeOf(s: SeatState): number {
  return LOOT_TAKE + (hasAug(s, "pickpocket") ? AUG_N.pickpocketTake : 0);
}
/** 내가 쓰는 공격의 기본 피해 범위(총공세 전) */
export function attackRange(s: SeatState, kind: "shot" | "burst" | "grenade" | "ambush" | "ambushLooter"): DmgRange {
  if (kind === "shot") return hasAug(s, "sniper") ? [1, 2] : DMG.shot;
  if (kind === "burst" || kind === "grenade") return DMG[kind];
  const plus = (hasAug(s, "ambusher") ? AUG_N.ambusherDmg : 0) + (hasAug(s, "understudy") ? AUG_N.understudyDmg : 0);
  const base = DMG[kind];
  return [base[0] + plus, base[1] + plus];
}
/** 공개: 다음 타격이 이 자리에 실제로 들어올 범위(방탄판·방탄모 반영) */
export function defendedRange(s: SeatState, range: DmgRange): DmgRange {
  let [lo, hi] = range;
  if (hasAug(s, "plate")) hi = Math.max(lo, hi - 1);
  if (shieldApplies(s, [lo, hi])) [lo, hi] = [Math.max(1, lo - 1), hi - 1];
  return [lo, hi];
}
/** 방탄모·조끼는 2 이상 들어올 수 있는 타격에만 쓰인다(1짜리 사격에 낭비되지 않게) */
function shieldApplies(s: SeatState, range: DmgRange): boolean {
  const r = hasAug(s, "plate") ? Math.max(range[0], range[1] - 1) : range[1];
  return s.shield > 0 && r >= AUG_N.shieldFrom;
}

function isAugRound(state: GameState, round: number): boolean {
  return !!state.options.augments && (AUG_ROUNDS as readonly number[]).includes(round);
}

function openAug(state: GameState): GameState {
  const tier = rollAugTier(state.seed, state.round);
  const offers = state.seats.map((s, i) => (s.confirmed ? [] : rollAugOffer(state.seed, state.round, i, tier, s.augs, 0)));
  return {
    ...state,
    phase: "augment",
    aug: { tier, offers, picks: state.seats.map(() => null), done: state.seats.map((s, i) => s.confirmed || offers[i].length === 0) },
  };
}

/** 전원이 고르면 효과를 한꺼번에 적용하고 행동 고르기로 */
function finishAug(state: GameState): GameState {
  const aug = state.aug!;
  const seats = state.seats.map((s, i) => {
    const id = aug.picks[i];
    if (!id) return s;
    const next = { ...s, augs: [...s.augs, id] };
    if (id === "bandolier") next.ammo = Math.min(maxAmmoOf(next), next.ammo + AUG_N.bandolierNow);
    if (id === "supply") next.ammo = Math.min(maxAmmoOf(next), next.ammo + AUG_N.supplyNow);
    if (id === "helmet") next.shield += AUG_N.helmetHits;
    if (id === "vest") next.shield += AUG_N.vestHits;
    return next;
  });
  return { ...toChoosing({ ...state, seats }), aug: null };
}

function toChoosing(state: GameState): GameState {
  const n = state.seatCount;
  return {
    ...state,
    phase: "choosing",
    stage: state.stage + 1,
    commits: state.seats.map((s) => (s.confirmed ? "x" : null)),
    moves: Array(n).fill(null),
    events: [],
    ready: Array(n).fill(false),
  };
}

// ---------------------------------------------------------------------------
// 합법 행동

/** 행동을 제출해야 하는 자리: 사망이 공개된 자리만 빠진다(진짜 죽었어도 공개 전엔 제출한다) */
export function isActing(state: GameState, seat: Seat): boolean {
  const s = state.seats[seat];
  return !!s && !s.confirmed;
}

export function legalMoves(state: GameState, seat: Seat): Move[] {
  const me = state.seats[seat];
  if (!me || me.confirmed) return [];
  const others = state.seats.map((_, i) => i).filter((i) => i !== seat);
  const standing = others.filter((i) => !state.seats[i].down);
  const bodies = others.filter((i) => state.seats[i].down && !state.seats[i].confirmed);
  if (me.down) {
    const down: Move[] = [{ kind: "hold" }, { kind: "rise" }, ...standing.map((target) => ({ kind: "ambush" as const, target }))];
    if (canBandage(me)) down.push({ kind: "bandage" });
    return down;
  }
  const out: Move[] = [{ kind: "reload" }];
  if (me.coverStreak < coverLimitOf(me)) out.push({ kind: "cover" });
  for (const kind of ["shot", "burst", "grenade"] as const) {
    if (me.ammo >= costOf(me, kind)) for (const target of standing) out.push({ kind, target });
  }
  for (const target of bodies) {
    out.push({ kind: "loot", target });
    if (me.ammo >= costOf(me, "finish")) out.push({ kind: "finish", target });
  }
  return out;
}

/**
 * 붕대는 숨 참기 한도 전에만(이번 라운드를 누워 보내고도 한도가 남을 때) — 그래야 "한도보다 오래
 * 누워 있으면 시체" 규칙이 소생 뒤에도 그대로 맞는다. 조건이 전부 공개 정보라 시체도 똑같이 받는다.
 */
export function canBandage(s: SeatState): boolean {
  return s.down && !s.confirmed && s.ammo >= BANDAGE_COST && s.lie + 1 < lieLimitOf(s);
}

export function isLegal(state: GameState, seat: Seat, move: Move): boolean {
  return legalMoves(state, seat).some((m) => m.kind === move.kind && (m.target ?? -1) === (move.target ?? -1));
}

/** 시간 초과/무효 제출의 기본 행동 */
export function defaultMove(state: GameState, seat: Seat): Move {
  return state.seats[seat].down ? { kind: "hold" } : { kind: "reload" };
}

// ---------------------------------------------------------------------------
// 판정

function resolveRound(state: GameState): GameState {
  const n = state.seatCount;
  const moves: Move[] = state.seats.map((s, i) => {
    if (s.confirmed) return { kind: "hold" };
    const m = state.moves[i];
    return m && isLegal(state, i, m) ? m : defaultMove(state, i);
  });
  const seats = state.seats.map((s) => ({ ...s, tally: { ...s.tally }, intel: { ...s.intel } }));
  /** 이번 라운드에 누가 누구를 때렸나 (처치 집계용) */
  const strikers: Seat[][] = state.seats.map(() => []);
  const startDown = seats.map((s) => s.down);
  const events: RoundEvent[] = [];
  const dmg = Array(n).fill(0);
  const newHits: DmgRange[][] = seats.map(() => []);
  // 피해 굴림은 시드+라운드로 결정 — 모든 기기가 같은 값을 얻는다
  const roll = seededRng((state.seed ^ Math.imul(state.round, 2654435761)) >>> 0);
  const surge = surgeAt(state.round);
  const struck = Array(n).fill(false);
  /** 증강으로 얻는 탄약(전리품·아드레날린·엄폐 보급) — 장전 뒤에 한꺼번에 */
  const bonusAmmo = Array(n).fill(0);
  const strike = (target: Seat, base: DmgRange, by: Seat): Hit => {
    strikers[target].push(by);
    // 방탄 효과는 공개 범위 자체를 줄여 기록한다 — 증강이 공개라 추리도 그대로 맞는다
    const raw: DmgRange = [base[0] + surge, base[1] + surge];
    const range = defendedRange(seats[target], raw);
    // 방탄은 다음 타격에 무조건 소모된다(작은 타격이면 효과 없이)
    if (seats[target].shield > 0) seats[target].shield -= 1;
    const [lo, hi] = range;
    const value = lo + Math.floor(roll() * (hi - lo + 1));
    dmg[target] += value;
    struck[target] = true;
    newHits[target].push(range);
    return { lo, hi, dmg: value };
  };
  const augStrike = (id: AugId, owner: Seat, target: Seat, base: DmgRange | readonly [number, number]) => {
    events.push({ t: "aug", id, seat: owner, target, hit: strike(target, base, owner) });
  };
  /** 엄폐로 막아 냈을 때의 증강 (라운드당 한 번씩) */
  const blockedOnce = Array(n).fill(false);
  const onBlocked = (owner: Seat, shooter: Seat) => {
    if (hasAug(seats[owner], "riposte") && !blockedOnce[owner]) bonusAmmo[owner] += AUG_N.ripostePlus;
    if (hasAug(seats[owner], "counterSniper") && !blockedOnce[owner]) augStrike("counterSniper", owner, shooter, AUG_N.counterSniperDmg);
    if (hasAug(seats[owner], "coverPro") && !blockedOnce[owner]) seats[shooter].ammo = Math.max(0, seats[shooter].ammo - AUG_N.coverProDrain);
    blockedOnce[owner] = true;
  };
  const rose = Array(n).fill(false);
  const blocking = moves.map((m, i) => !startDown[i] && m.kind === "cover");
  // 진짜 죽은 사람(미공개)은 무엇을 골랐든 가만히 누워 있다
  const eff = moves.map((m, i) => (seats[i].dead ? ({ kind: "hold" } as Move) : m));

  // 비용 지불 (공개 정보)
  moves.forEach((m, i) => {
    if (startDown[i]) {
      // 🩹 붕대 값은 시체도 똑같이 낸다(공개 탄약이 정체를 흘리지 않게)
      if (m.kind === "bandage" && !seats[i].confirmed) seats[i].ammo -= BANDAGE_COST;
      return;
    }
    if (BLAST_TIER[m.kind] || m.kind === "finish") seats[i].ammo -= costOf(seats[i], m.kind);
  });
  /** 이번 라운드 끝에 붕대를 감는 몸(확인사살·기습 간파로 끊기지 않은) */
  const bandaging = Array(n).fill(false);

  // 1) 쓰러진 사람을 둘러싼 일
  for (let k = 0; k < n; k++) {
    if (!startDown[k] || seats[k].confirmed) continue;
    const looters = moves.map((m, i) => (!startDown[i] && m.kind === "loot" && m.target === k ? i : -1)).filter((i) => i >= 0);
    const finishers = moves.map((m, i) => (!startDown[i] && m.kind === "finish" && m.target === k ? i : -1)).filter((i) => i >= 0);
    const fm = eff[k];
    if (seats[k].dead) {
      if (finishers.length) {
        seats[k].confirmed = true;
        for (const f of finishers) events.push({ t: "finish", seat: f, target: k, result: "dead" });
        if (hasAug(seats[k], "tripwire")) for (const f of finishers) augStrike("tripwire", k, f, AUG_N.tripwireDmg);
      }
      lootBody(seats, k, looters, events);
      if (looters.length && hasAug(seats[k], "tripwire")) for (const l of looters) augStrike("tripwire", k, l, AUG_N.tripwireDmg);
      if (!finishers.length && moves[k].kind === "bandage") bandaging[k] = true;
      continue;
    }
    if (fm.kind === "ambush" && finishers.includes(fm.target!)) {
      rose[k] = true;
      events.push({ t: "finish", seat: fm.target!, target: k, result: "countered", hit: strike(k, finishRange(seats[k]), fm.target!) });
      for (const l of looters) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
      continue;
    }
    if (fm.kind === "ambush" && looters.includes(fm.target!) && finishers.length === 0) {
      rose[k] = true;
      events.push({ t: "ambush", seat: k, target: fm.target!, result: "looter", hit: strike(fm.target!, attackRange(seats[k], "ambushLooter"), k) });
      seats[k].tally.ambushHits++;
      for (const l of looters) if (l !== fm.target) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
      continue;
    }
    if (finishers.length) {
      // 살아 있었다 — 정체 폭로, 맞고 다시 쓰러진다
      rose[k] = true;
      const hit = strike(k, finishRange(seats[k]), finishers[0]);
      for (const f of finishers) seats[f].tally.exposes++;
      if (hasAug(seats[k], "tripwire")) for (const f of finishers) augStrike("tripwire", k, f, AUG_N.tripwireDmg);
      finishers.forEach((f, idx) => events.push({ t: "finish", seat: f, target: k, result: "exposed", ...(idx === 0 ? { hit } : {}) }));
      for (const l of looters) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
      continue;
    }
    if (fm.kind === "hold" || fm.kind === "bandage") {
      lootBody(seats, k, looters, events);
      if (looters.length && hasAug(seats[k], "tripwire")) for (const l of looters) augStrike("tripwire", k, l, AUG_N.tripwireDmg);
      if (fm.kind === "bandage") bandaging[k] = true;
    } else for (const l of looters) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
    if (fm.kind === "rise") {
      rose[k] = true;
      events.push({ t: "rise", seat: k, reason: "choice" });
    } else if (fm.kind === "ambush") {
      rose[k] = true;
      const t = fm.target!;
      if (blocking[t] && hasAug(seats[k], "ambusher")) {
        // 매복: 엄폐해도 1
        events.push({ t: "ambush", seat: k, target: t, result: "hit", hit: strike(t, DMG.pierce, k) });
        seats[k].tally.ambushHits++;
      } else if (blocking[t]) {
        events.push({ t: "ambush", seat: k, target: t, result: "blocked" });
        onBlocked(t, k);
      } else {
        events.push({ t: "ambush", seat: k, target: t, result: "hit", hit: strike(t, attackRange(seats[k], "ambush"), k) });
        seats[k].tally.ambushHits++;
      }
    }
  }

  // 2) 서 있는 사람들의 사격
  const blasts = moves.map((m, i) => (!startDown[i] && BLAST_TIER[m.kind] ? { seat: i, target: m.target!, tier: BLAST_TIER[m.kind]! } : null));
  const cancelled = Array(n).fill(false);
  for (const b of blasts) {
    if (!b || cancelled[b.seat]) continue;
    const back = blasts[b.target];
    if (!back || back.target !== b.seat || cancelled[b.target]) continue;
    const qa = hasAug(seats[b.seat], "quickdraw");
    const qb = hasAug(seats[back.seat], "quickdraw");
    if (back.tier === b.tier && qa !== qb) {
      // 속사: 같은 화력이면 먼저 쏜다
      const lo = qa ? back : b;
      cancelled[lo.seat] = true;
      events.push({ t: "blast", seat: lo.seat, target: lo.target, tier: lo.tier, result: "overpowered" });
    } else if (back.tier === b.tier) {
      cancelled[b.seat] = cancelled[b.target] = true;
      events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "clash" });
    } else {
      const lo = back.tier < b.tier ? back : b;
      cancelled[lo.seat] = true;
      events.push({ t: "blast", seat: lo.seat, target: lo.target, tier: lo.tier, result: "overpowered" });
    }
  }
  for (const b of blasts) {
    if (!b || cancelled[b.seat]) continue;
    const pierces = b.tier >= 3 || (b.tier === 2 && hasAug(seats[b.seat], "apRounds"));
    const kind = b.tier === 1 ? "shot" : b.tier === 2 ? "burst" : "grenade";
    if (blocking[b.target] && pierces) events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "pierce", hit: strike(b.target, DMG.pierce, b.seat) });
    else if (blocking[b.target]) {
      events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "blocked" });
      onBlocked(b.target, b.seat);
    } else events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "hit", hit: strike(b.target, attackRange(seats[b.seat], kind), b.seat) });
    if (!blocking[b.target] || pierces) {
      seats[b.seat].tally.blastHits++;
      if (b.tier >= 2 && hasAug(seats[b.seat], "scavenger")) bonusAmmo[b.seat] += AUG_N.scavengerAmmo;
      if (b.tier === 3 && hasAug(seats[b.seat], "frag")) {
        const near = seats.map((_, i) => i).filter((i) => i !== b.seat && i !== b.target && !startDown[i] && !blocking[i] && !seats[i].confirmed);
        for (const t of near) augStrike("frag", b.seat, t, [AUG_N.fragDmg, AUG_N.fragDmg]);
      }
    }
  }

  // 3) 장전 / 엄폐 기록
  moves.forEach((m, i) => {
    if (startDown[i]) return;
    if (m.kind === "reload") {
      seats[i].ammo = Math.min(maxAmmoOf(seats[i]), seats[i].ammo + (reloadGain(seats[i])));
      events.push({ t: "reload", seat: i });
    }
    // 엄폐 보급: 막아 냈으면 다음 라운드에도 엄폐 가능
    seats[i].coverStreak = m.kind === "cover" && !(blockedOnce[i] && hasAug(seats[i], "riposte")) ? seats[i].coverStreak + 1 : 0;
    if (m.kind === "cover") events.push({ t: "cover", seat: i });
  });

  // 4) 일어나기·숨 참기
  for (let i = 0; i < n; i++) {
    if (rose[i]) {
      seats[i].down = false;
      seats[i].lie = 0;
      bonusAmmo[i] += riseAmmo(seats[i]);
    } else if (startDown[i] && !seats[i].dead && !seats[i].confirmed) {
      seats[i].lie += 1;
      seats[i].tally.fakeRounds++;
      if (seats[i].lie >= lieLimitOf(seats[i]) && !struck[i]) {
        seats[i].down = false;
        seats[i].lie = 0;
        bonusAmmo[i] += riseAmmo(seats[i]);
        events.push({ t: "rise", seat: i, reason: "breath" });
      }
    } else if (startDown[i] && seats[i].dead && !seats[i].confirmed) {
      // 진짜 시체도 공개 카운터는 똑같이 오른다
      seats[i].lie += 1;
    }
  }

  // 🎭 명배우: 누워 있던 라운드마다 탄약 — 시체도 똑같이 받아서 정체가 새지 않는다
  for (let i = 0; i < n; i++) if (startDown[i] && !rose[i] && !seats[i].confirmed && hasAug(seats[i], "understudy")) seats[i].ammo = Math.min(maxAmmoOf(seats[i]), seats[i].ammo + AUG_N.understudyAmmo);
  for (let i = 0; i < n; i++) if (bonusAmmo[i] > 0 && !seats[i].dead) seats[i].ammo = Math.min(maxAmmoOf(seats[i]), seats[i].ammo + bonusAmmo[i]);

  // 5) 피해 → 무조건 쓰러짐 (방탄으로 0이 돼도 맞았으면 쓰러진다)
  const fallen: Seat[] = [];
  for (let i = 0; i < n; i++) {
    if (!struck[i]) continue;
    seats[i].hits = [...seats[i].hits, ...newHits[i]];
    seats[i].hp = Math.max(0, seats[i].hp - dmg[i]);
    if (!seats[i].down) fallen.push(i);
    seats[i].down = true;
    seats[i].lie = 0;
    if (seats[i].hp <= 0 && !seats[i].dead) {
      seats[i].dead = true;
      seats[i].diedRound = state.round;
      for (const by of new Set(strikers[i])) if (by !== i) seats[by].tally.kills++;
    }
  }
  if (fallen.length) events.push({ t: "fall", seats: fallen });

  // 5½) 💓 치료 시도 — 🩹 붕대, 그다음 🎁 구급상자. 몸은 그대로 누워 있다(소생해도 겉보기 같음)
  const heal = (i: Seat, source: "bandage" | "medkit") => {
    const s = seats[i];
    s.heals = [...(s.heals ?? []), s.hits.length];
    const r = roll();
    let result: "revived" | "failed" | "healed";
    if (s.dead) {
      if (r < REVIVE_CHANCE) {
        s.dead = false;
        s.hp = 1;
        s.diedRound = null;
        result = "revived";
      } else result = "failed";
    } else {
      s.hp = Math.min(START_HP, s.hp + 1);
      result = "healed";
    }
    events.push({ t: "heal", seat: i, source, result });
  };
  for (let i = 0; i < n; i++) if (bandaging[i] && seats[i].down && !seats[i].confirmed) heal(i, "bandage");
  if (isMedkitRound(state.round)) {
    const bodies = seats.map((_, k) => k).filter((k) => seats[k].down && !seats[k].confirmed && seats[k].lie < lieLimitOf(seats[k]));
    if (bodies.length) heal(bodies[Math.floor(roll() * bodies.length)], "medkit");
  }

  // 6) 🩺 청진기 — 쓰러진 상대 중 아직 모르는 1명의 생사를 몰래
  for (let i = 0; i < n; i++) {
    if (!hasAug(seats[i], "stethoscope") || seats[i].confirmed) continue;
    const unknown = seats.map((_, k) => k).filter((k) => k !== i && seats[k].down && !seats[k].confirmed && !intelValid(seats[i], k, seats[k]));
    if (!unknown.length) continue;
    const k = unknown[Math.floor(roll() * unknown.length)];
    seats[i].intel[k] = { dead: seats[k].dead, hits: opsOf(seats[k]) };
  }

  const lastMoves = moves.map((m, i) => (startDown[i] || state.seats[i].confirmed ? null : m));
  const alive = seats.filter((s) => !s.dead).length;
  const ended = alive <= 1 || state.round >= state.options.maxRounds;
  return {
    ...state,
    seats,
    moves: Array(n).fill(null),
    lastMoves,
    events,
    phase: ended ? "ended" : "resolved",
    stage: state.stage + 1,
    ready: seats.map((s) => s.confirmed),
  };
}

/** 공개된 타격·치료 횟수 — 이게 바뀌면 그 몸의 생사가 바뀌었을 수 있다 */
function opsOf(s: SeatState): number {
  return s.hits.length + (s.heals?.length ?? 0);
}

/** 청진기로 안 정보가 아직 맞는가 — 그 뒤로 맞거나 치료받지 않았을 때만(시체도 소생할 수 있다) */
export function intelValid(viewer: SeatState, seat: Seat, target: SeatState): boolean {
  const it = viewer.intel?.[seat];
  if (!it) return false;
  return it.hits === opsOf(target);
}

function lootBody(seats: SeatState[], k: Seat, looters: Seat[], events: RoundEvent[]) {
  for (const l of looters) {
    // 🌿 위장복: 누운 몸에서 탄약을 못 찾는다(시체여도 똑같이)
    const took = hasAug(seats[k], "camo") ? 0 : Math.max(0, Math.min(lootTakeOf(seats[l]), seats[k].ammo, maxAmmoOf(seats[l]) - seats[l].ammo));
    seats[k].ammo -= took;
    seats[l].ammo += took;
    seats[l].tally.ammoLooted += took;
    events.push({ t: "loot", seat: l, target: k, took, foiled: false });
  }
}

function toRevealing(state: GameState): GameState {
  return maybeResolve({ ...state, phase: "revealing", stage: state.stage + 1 });
}

function maybeResolve(state: GameState): GameState {
  // "x" = 커밋 없이 넘어간 자리(사망 공개 / 시간 초과 기본 행동)
  const waiting = state.commits.some((c, i) => c !== null && c !== "x" && state.moves[i] === null);
  return waiting ? state : resolveRound(state);
}

function nextRound(state: GameState): GameState {
  const next = { ...state, round: state.round + 1 };
  if (isAugRound(next, next.round)) {
    const n = state.seatCount;
    return openAug({ ...next, stage: state.stage + 1, commits: Array(n).fill(null), moves: Array(n).fill(null), events: [], ready: Array(n).fill(false) });
  }
  return toChoosing(next);
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "AUG_PICK": {
      const aug = state.aug;
      if (state.phase !== "augment" || !aug || action.round !== state.round || aug.done[action.seat] !== false) return state;
      if (!aug.offers[action.seat]?.includes(action.id) || !AUG_BY_ID[action.id]) return state;
      const next: AugRound = {
        ...aug,
        picks: aug.picks.map((p, i) => (i === action.seat ? action.id : p)),
        done: aug.done.map((d, i) => (i === action.seat ? true : d)),
      };
      const idleStreak = state.idleStreak.map((v, i) => (i === action.seat ? 0 : v));
      const s = { ...state, aug: next, idleStreak };
      return next.done.every(Boolean) ? finishAug(s) : s;
    }
    case "AUG_REROLL": {
      const aug = state.aug;
      const me = state.seats[action.seat];
      if (state.phase !== "augment" || !aug || !me || action.round !== state.round || aug.done[action.seat] !== false) return state;
      if (me.rerollsUsed >= AUG_REROLLS) return state;
      const offer = rollAugOffer(state.seed, state.round, action.seat, aug.tier, me.augs, 1 + me.rerollsUsed, aug.offers[action.seat]);
      return {
        ...state,
        seats: state.seats.map((s, i) => (i === action.seat ? { ...s, rerollsUsed: s.rerollsUsed + 1 } : s)),
        aug: { ...aug, offers: aug.offers.map((o, i) => (i === action.seat ? offer : o)) },
      };
    }
    case "COMMIT": {
      if (state.phase !== "choosing" || action.round !== state.round) return state;
      if (!isActing(state, action.seat) || state.commits[action.seat] !== null) return state;
      const commits = state.commits.map((c, i) => (i === action.seat ? String(action.hash) : c));
      const idleStreak = state.idleStreak.map((v, i) => (i === action.seat ? 0 : v));
      const next = { ...state, commits, idleStreak };
      return commits.every((c) => c !== null) ? toRevealing(next) : next;
    }
    case "REVEAL": {
      if (state.phase !== "revealing" || action.round !== state.round) return state;
      const hash = state.commits[action.seat];
      if (!hash || hash === "x" || state.moves[action.seat] !== null) return state;
      const ok = moveHash(action.move, action.salt) === hash && isLegal(state, action.seat, action.move);
      const move = ok ? { kind: action.move.kind, ...(action.move.target !== undefined ? { target: action.move.target } : {}) } : defaultMove(state, action.seat);
      const moves = state.moves.map((m, i) => (i === action.seat ? move : m));
      return maybeResolve({ ...state, moves });
    }
    case "READY": {
      if (state.phase !== "resolved" || action.round !== state.round || state.ready[action.seat]) return state;
      const ready = state.ready.map((r, i) => (i === action.seat ? true : r));
      return ready.every(Boolean) ? nextRound({ ...state, ready }) : { ...state, ready };
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      if (state.phase === "augment" && state.aug) {
        const aug = state.aug;
        const idleStreak = state.idleStreak.map((v, i) => (aug.done[i] ? v : v + 1));
        const picks = aug.picks.map((p, i) => (aug.done[i] ? p : (aug.offers[i][0] ?? null)));
        return finishAug({ ...state, idleStreak, aug: { ...aug, picks, done: aug.done.map(() => true) } });
      }
      if (state.phase === "choosing") {
        const idleStreak = state.idleStreak.map((v, i) => (state.commits[i] === null ? v + 1 : v));
        const moves = state.moves.map((m, i) => (state.commits[i] === null ? defaultMove(state, i) : m));
        const commits = state.commits.map((c) => c ?? "x");
        return toRevealing({ ...state, idleStreak, moves, commits });
      }
      if (state.phase === "revealing") return resolveRound(state);
      if (state.phase === "resolved") return nextRound(state);
      return state;
    }
  }
  return state;
}

/** 지금 무언가를 기다리는 자리 */
export function pendingSeats(state: GameState): Seat[] {
  const all = state.seats.map((_, i) => i);
  switch (state.phase) {
    case "augment":
      return all.filter((i) => state.aug?.done[i] === false);
    case "choosing":
      return all.filter((i) => state.commits[i] === null);
    case "revealing":
      return all.filter((i) => state.commits[i] !== null && state.commits[i] !== "x" && state.moves[i] === null);
    case "resolved":
      return all.filter((i) => !state.ready[i]);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 공개 정보 / 결과

/**
 * 맞은 타격들의 피해 범위로 본 "합계 < 목숨" 확률 (각 타격은 범위 안에서 균등).
 * `heals` = 치료 시도 시점(그때까지의 타격 수): 시체면 REVIVE_CHANCE로 목숨 1, 살아 있으면 피해 −1.
 */
export function survivalChance(hits: readonly DmgRange[], hp = START_HP, heals: readonly number[] = []): number {
  let dist = new Map<number, number>([[0, 1]]);
  const add = (m: Map<number, number>, k: number, p: number) => m.set(k, (m.get(k) ?? 0) + p);
  const healAt = (i: number) => {
    for (const h of heals) {
      if (h !== i) continue;
      const nextDist = new Map<number, number>();
      for (const [sum, p] of dist) {
        if (sum >= hp) {
          add(nextDist, hp - 1, p * REVIVE_CHANCE);
          add(nextDist, hp, p * (1 - REVIVE_CHANCE));
        } else add(nextDist, Math.max(0, sum - 1), p);
      }
      dist = nextDist;
    }
  };
  hits.forEach(([lo, hi], i) => {
    healAt(i);
    const nextDist = new Map<number, number>();
    const w = 1 / (hi - lo + 1);
    for (const [sum, p] of dist) for (let d = lo; d <= hi; d++) add(nextDist, Math.min(hp, sum + d), p * w);
    dist = nextDist;
  });
  healAt(hits.length);
  let alive = 0;
  for (const [sum, p] of dist) if (sum < hp) alive += p;
  return alive;
}

/** 한 자리의 공개 생존 확률(타격·치료 기록) — `extra`는 가정한 추가 타격 */
export function survivalOf(s: SeatState, extra?: DmgRange): number {
  return survivalChance(extra ? [...s.hits, extra] : s.hits, START_HP, s.heals ?? []);
}

/** 공개 정보만으로 본 "이 자리가 아직 살아 있을 확률" (viewer 자신은 자기 상태를 안다) */
export function aliveChance(state: GameState, seat: Seat, viewer?: Seat): number {
  const s = state.seats[seat];
  if (viewer === seat) return s.dead ? 0 : 1;
  if (s.confirmed) return 0;
  if (!s.down) return 1;
  // 살아 있으면 숨 참기 한도에서 강제로 일어난다 — 그 이상 누워 있으면 시체
  if (s.lie >= lieLimitOf(s)) return 0;
  // 🩺 청진기로 몰래 안 생사
  if (viewer !== undefined && state.seats[viewer] && intelValid(state.seats[viewer], seat, s)) return state.seats[viewer].intel[seat].dead ? 0 : 1;
  return survivalOf(s);
}

/** 공개된 최소/최대 누적 피해 */
export function takenRange(s: SeatState): [number, number] {
  return [s.hits.reduce((a, h) => a + h[0], 0), s.hits.reduce((a, h) => a + h[1], 0)];
}

export function aliveCount(state: GameState): number {
  return state.seats.filter((s) => !s.dead).length;
}

export interface Ranking {
  seat: Seat;
  rank: number;
}

/** 생존자 1위(여럿이면 남은 목숨 → 탄약 순), 사망자는 늦게 죽을수록 위 */
export function computeRankings(state: GameState): Ranking[] {
  const key = (i: Seat) => {
    const s = state.seats[i];
    return s.dead ? -1000 + (s.diedRound ?? 0) : s.hp * 10 + s.ammo;
  };
  const order = state.seats.map((_, i) => i).sort((a, b) => key(b) - key(a));
  const out: Ranking[] = [];
  order.forEach((seat, idx) => {
    const prev = out[idx - 1];
    const rank = prev && key(order[idx - 1]) === key(seat) ? prev.rank : idx + 1;
    out.push({ seat, rank });
  });
  return out;
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state).filter((r) => r.rank === 1).map((r) => r.seat);
}
