/**
 * Pure "Perudo" (a.k.a. Liar's Dice / Dudo) rules engine — no React, no I/O.
 * Implements the 코리아보드게임즈 공식 룰북 (see boardGameRule/페루도/페루도.md):
 * every alive player hides 5 dice under a cup, the round's leader opens a bid
 * on "at least N dice showing face F across the whole table", each following
 * player must either raise the bid, call "페루도!" (dudo — doubt the bid) or
 * call "맞아!" (calza — claim the bid is exactly right), and 1s ("페루도" the
 * face, not to be confused with the "페루도!" doubt call above) always act as
 * wild jokers for every other face.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (every seat's
 * hidden dice) from a shared RNG seed plus replayed `EngineAction`s — there
 * is no server authority. See README for the accepted trust trade-off.
 *
 * One documented, intentional interpretation of the rulebook: "맞아!(calza)"
 * is written as "차례와 상관없이" (regardless of turn order). This engine
 * honors that literally: `calza` may be submitted by ANY alive seat at any
 * time there's a pending bid, not just the active seat — unlike `raise`/
 * `dudo`, which are turn-restricted.
 *
 * 2026-08-17 룰북 정리 세션 — 최신 룰북(boardGameRule/페루도/페루도.md) 기준
 * 3가지 확정 반영:
 * (1) "맞아!" 성공 시 되찾는 주사위에 더 이상 상한이 없다(이전엔 물리 박스의
 *     색상별 주사위 5개 한도를 반영해 `MAX_DICE=5` 캡을 뒀으나, 최신 룰북
 *     문구 "최대 개수 제한없음"에 맞춰 완전히 제거).
 * (2) "팔라피코(Palafico)" 특수 라운드를 완전히 삭제 — 이전엔 라운드 선의
 *     주사위가 1개일 때 조커 무효화/눈금 고정/맞아! 금지 세 가지 특수 규칙이
 *     발동했으나, 최신 룰북에 해당 절이 통째로 빠져 있어 전부 제거(구
 *     `isPalafico`/`wasPalafico`/palafico 분기는 이제 이 파일 어디에도 없다).
 * (3) 일반↔페루도(1) 전환 비딩 공식은 원래의 `⌈Q/2⌉`(일반→페루도)/`2Q+1`
 *     (페루도→일반)을 그대로 유지했다 — 최신 룰북 본문에 잠깐 등장한
 *     "숫자3→페루도2, 숫자4→페루도3"류 하드코딩 케이스는 숫자 5·6이나
 *     역방향(페루도→일반) 공식이 전혀 빠진 불완전한 예외 조항이라 반영하지
 *     않았다(같은 룰북 파일의 하단 "핵심 가이드 표"는 이 세션 시점에도 여전히
 *     원래의 일반 공식을 그대로 싣고 있어, 그쪽을 "최신 룰북 기준"으로
 *     채택 — 사용자 확인 완료).
 *
 * 2026-08-19 보드 트랙 개편 세션 — 하나의 고정 순서 배열
 * `BOARD_TRACK_SEQUENCE`(칸 37개, 사용자가 실제 보드 사진을 보고 직접 지정한
 * 라벨 시퀀스, 라벨이 커졌다 작아지는 비단조 구간 포함)로 비딩 유효성 판정을
 * 완전히 대체하는 하우스룰을 도입했었다 — 유효성은 그 배열의 **인덱스**만
 * 비교(`isValidBid`)하고 숫자 라벨은 무시했다.
 *
 * 2026-08-20 트랙 하우스룰 폐지 세션 — 그 인덱스 비교 방식이 공식 룰북 §3의
 * "동일 수량이면 눈금만 상향 가능" 규칙과 근본적으로 양립 불가능함이
 * 드러나(고정 배열은 수량 하나당 칸을 하나만 두고 눈금 2~6을 전부 그 한
 * 칸으로 묶어버려, 수량은 그대로 두고 눈금만 올리는 비딩이 애초에 표현될 수
 * 없었다 — `boardGameRule/페루도/버그.png`가 신고한 증상의 근본 원인) 일단
 * 트랙 시스템 자체를 통째로 걷어내고 `validateRaise`를 아래 (3)의 공식
 * 수량/눈금 공식으로 되돌렸었다.
 *
 * 2026-08-20 같은 날 트랙/마커 재도입 세션 — 사용자가 "버그2" 스크린샷을
 * 근거로 트랙·마커 시각 요소를 다시 요청(`AskUserQuestion`으로 롤백 범위·칸
 * 의미·파일 구조 3가지를 확인받은 뒤 진행, 칸 라벨 의미는 "로직을 알아서
 * 재설계"로 위임받음). 그래서 이번엔 트랙을 **판정 권한이 없는 순수 시각
 * 요소**로만 재도입했다:
 * - `validateRaise`는 여전히 (3)의 공식 수량/눈금 공식이 유일한 판정
 *   근거다 — 트랙 칸/인덱스는 이제 그 판정 결과를 절대 좌우하지 않는다.
 * - 마커가 표시될 칸은 `trackCellForBid({quantity, face})`라는 순수 함수로
 *   **그때그때 직접 계산**한다(옛 `trackIndexForBid`처럼 "현재 칸 이후 가장
 *   가까운 칸을 탐색"하는 상태 의존적 방식이 아니다 — 그 "가장 가까운 칸"
 *   탐색 방식 자체가 옛 세션에서 실제 확정 비딩과 다른 칸에 마커가 앉는
 *   버그의 원인이었다). 공식: `index = (quantity-1)*2 + (face===1?1:0)` —
 *   수량 1의 일반 칸, 수량 1의 [페루도] 칸, 수량 2의 일반 칸, ... 순서로
 *   단조 증가하는 무한 시퀀스라 옛 배열의 비단조 반복 라벨 문제도, 고정
 *   37칸이라는 상한 문제(맞아! 성공 시 주사위 상한 없음 — 위 (1) 참고 — 이라
 *   수량도 이론상 무한정 커질 수 있음)도 함께 해소된다. **face:1(조커)일
 *   때만 [페루도] 칸에 매핑되고, face:2~6은 전부 "일반" 칸에 매핑된다** —
 *   버그2가 신고한 "얼굴 2, 수량 1 비딩인데 마커가 [페루도] 칸에 있다" 증상은
 *   이 매핑이 결정적(deterministic)이라 구조적으로 재발할 수 없다.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
// The physical box only ships 6 colored cups, but this digital implementation
// deliberately extends beyond that hardware limit — 8 is a common house-rule
// cap for Perudo/Dudo when playing with more dice sets pooled together.
export const MAX_PLAYERS = 8;
export const STARTING_DICE = 5;

/** 1 is "페루도" — a joker face marked with the game's own crest, not a plain pip. */
export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export interface Bid {
  seat: SeatIndex;
  quantity: number;
  face: Face;
}

// ---------------------------------------------------------------------------
// Board track (2026-08-20 재도입 — module doc note above) — a purely visual,
// derived-on-demand cell sequence for rendering the marker; it has NO say in
// whether a raise is legal (`validateRaise` below is the only judge of
// that). Not a stored array: `trackCellForBid`/`trackCellAt` are plain pure
// functions of (quantity, face) / (index), so there is nothing here that can
// drift out of sync with a confirmed or draft bid the way the old
// state-dependent "nearest cell after the current one" search could.
// ---------------------------------------------------------------------------

export type TrackCellKind = "normal" | "perudo";

export interface TrackCell {
  index: number;
  kind: TrackCellKind;
  /** The number printed on the cell — for "perudo" cells this is the 페루도 N ordinal (== that bid's quantity when face is the joker); for "normal" cells it's the bid quantity shared by every non-joker face 2-6. */
  quantity: number;
}

/**
 * The exact cell a `{ quantity, face }` bid sits on — face 1 (조커) always
 * maps to a "perudo" cell, faces 2-6 always map to a "normal" cell (they
 * share one cell per quantity, same as before; the track was never meant to
 * distinguish among 2-6, only joker vs. non-joker — see module doc). Pure
 * and total (never null): every `(quantity >= 1, face)` pair has exactly one
 * cell, so the UI never has to handle a "no such cell" case the way the old
 * fixed-length array's search could.
 */
export function trackCellForBid(bid: { quantity: number; face: Face }): TrackCell {
  const kind: TrackCellKind = bid.face === 1 ? "perudo" : "normal";
  const index = (bid.quantity - 1) * 2 + (bid.face === 1 ? 1 : 0);
  return { index, kind, quantity: bid.quantity };
}

/** Inverse of `trackCellForBid` — the cell at board position `index` (>= 0), for rendering an arbitrary window of the (conceptually unbounded — dice counts have no upper cap, see module doc) track. */
export function trackCellAt(index: number): TrackCell {
  const quantity = Math.floor(index / 2) + 1;
  const kind: TrackCellKind = index % 2 === 0 ? "normal" : "perudo";
  return { index, kind, quantity };
}

export interface PlayerState {
  seat: SeatIndex;
  diceCount: number;
  /** The player's current hidden roll — always `diceCount` values long once a round has been rolled. Only cleared to `[]` once eliminated. */
  dice: number[];
}

export type Phase = "playing" | "reveal" | "gameOver";

export interface RoundResolution {
  kind: "dudo" | "calza";
  /** Seat that called "페루도!" or "맞아!". */
  actorSeat: SeatIndex;
  bid: Bid;
  /** True dice count of `bid.face` across the whole table (wilds included — see module doc, 1s are always wild). */
  actualCount: number;
  /** Seat whose dice count just changed as a result of this call. */
  affectedSeat: SeatIndex;
  /**
   * Signed change applied to `affectedSeat`'s `diceCount` (before the
   * `>= 0` floor — no upper cap, see module doc). Differential-penalty rules
   * (see module doc): a losing call can cost more than 1 die depending on
   * how far off the bid was, while a successful "맞아!" always regains
   * exactly 1 (uncapped — can push a seat's dice count past its original 5).
   */
  diceDelta: number;
  /** Full table reveal at the moment of the call, captured before any reroll — seat -> that seat's dice. */
  revealedDice: Record<SeatIndex, number[]>;
}

export interface PerudoState {
  playerCount: number;
  players: PlayerState[];
  /** Null only at the very start of a round, before the leader's opening bid. */
  currentBid: Bid | null;
  activeSeat: SeatIndex;
  /** Who opened the current round — leads the next round while `phase` is "reveal". */
  roundStarter: SeatIndex;
  roundNumber: number;
  phase: Phase;
  /** Outcome of the most recent dudo/calza call, kept around through "reveal"/"gameOver" for the UI to render a showdown. Null until the first call of the game. */
  lastResolution: RoundResolution | null;
  /** Seats in the order they were eliminated (dice hit 0) — needed for final rankings, since dice counts alone don't record *when* someone dropped out. */
  eliminationOrder: SeatIndex[];
  winnerSeat: SeatIndex | null;
}

export type EngineAction =
  | { type: "raise"; seat: SeatIndex; quantity: number; face: Face }
  | { type: "dudo"; seat: SeatIndex }
  | { type: "calza"; seat: SeatIndex }
  | { type: "continue"; seed: number };

/** Deterministic PRNG, shared across every engine — see src/lib/rng.ts. */
import { seededRng } from "@/lib/rng";
export { seededRng };

function rollDice(rng: () => number, count: number): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * 6));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): PerudoState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    diceCount: STARTING_DICE,
    dice: rollDice(rng, STARTING_DICE),
  }));
  // The rulebook's "roll one die each, highest starts" tiebreak has no
  // meaning at a fresh table, so — same convention as Avalon/No Thanks —
  // the starting player is picked from the shared seed for determinism.
  const starter = Math.floor(rng() * playerCount);

  return {
    playerCount,
    players,
    currentBid: null,
    activeSeat: starter,
    roundStarter: starter,
    roundNumber: 1,
    phase: "playing",
    lastResolution: null,
    eliminationOrder: [],
    winnerSeat: null,
  };
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function aliveSeats(state: PerudoState): SeatIndex[] {
  return state.players.filter((p) => p.diceCount > 0).map((p) => p.seat);
}

export function totalDiceInPlay(state: PerudoState): number {
  return state.players.reduce((sum, p) => sum + p.diceCount, 0);
}

function nextAliveSeat(seat: SeatIndex, players: PlayerState[], playerCount: number): SeatIndex {
  let next = (seat + 1) % playerCount;
  for (let i = 0; i < playerCount; i++) {
    const player = players.find((p) => p.seat === next);
    if (player && player.diceCount > 0) return next;
    next = (next + 1) % playerCount;
  }
  return seat; // unreachable once the game hasn't already ended, kept only as a safe fallback
}

/**
 * Whether `next` is a legal raise over `prev` (null = the round's opening
 * bid, always legal). The sole authority on bid legality — the board track
 * above never gates this (see module doc). Implements the rulebook §3
 * formulas exactly:
 * - normal(2-6) -> normal: quantity must strictly increase, OR stay equal
 *   while the face strictly increases.
 * - normal -> paco(1): quantity >= ceil(prev quantity / 2).
 * - paco -> normal: quantity >= prev quantity * 2 + 1.
 * - paco -> paco: quantity must strictly increase (face is fixed at 1).
 */
export function validateRaise(prev: Bid | null, next: { quantity: number; face: Face }): boolean {
  if (!Number.isInteger(next.quantity) || next.quantity < 1) return false;
  if (!Number.isInteger(next.face) || next.face < 1 || next.face > 6) return false;
  if (prev === null) return true;
  if (prev.face === 1 && next.face === 1) return next.quantity > prev.quantity;
  if (prev.face === 1 && next.face !== 1) return next.quantity >= prev.quantity * 2 + 1;
  if (prev.face !== 1 && next.face === 1) return next.quantity >= Math.ceil(prev.quantity / 2);
  return next.quantity > prev.quantity || (next.quantity === prev.quantity && next.face > prev.face);
}

/**
 * The smallest `quantity` that would make `{ quantity, face }` a legal raise
 * over `prev` — used by the UI to pre-fill/clamp its quantity stepper for a
 * chosen face. Brute forces upward from 1 through `validateRaise` rather
 * than re-deriving the §3 formulas a second time, so there's exactly one
 * place they can drift out of sync.
 */
export function minValidQuantityForFace(prev: Bid | null, face: Face): number | null {
  if (prev === null) return 1;
  for (let quantity = 1; quantity <= 500; quantity++) {
    if (validateRaise(prev, { quantity, face })) return quantity;
  }
  return null;
}

/** How many dice on the table currently show `face` — 1s always count as wild for every other face (module doc: no more Palafico exception). */
export function countMatching(players: PlayerState[], face: Face): number {
  let count = 0;
  for (const player of players) {
    for (const die of player.dice) {
      if (die === face) count++;
      else if (face !== 1 && die === 1) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function raise(state: PerudoState, seat: SeatIndex, quantity: number, face: Face): PerudoState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || player.diceCount <= 0) return state;
  if (!validateRaise(state.currentBid, { quantity, face })) return state;

  return {
    ...state,
    currentBid: { seat, quantity, face },
    activeSeat: nextAliveSeat(seat, state.players, state.playerCount),
  };
}

/**
 * Shared tail end of both `dudo` and `calza`: apply the dice-count change,
 * capture the full reveal, and either end the game (one seat left standing)
 * or hand off to "reveal" phase for the next round's leader to be shown
 * before dice are rerolled (see `continueRound`).
 */
function applyResolution(
  state: PerudoState,
  affectedSeat: SeatIndex,
  delta: number,
  meta: { kind: "dudo" | "calza"; actorSeat: SeatIndex; bid: Bid; actualCount: number },
): PerudoState {
  const revealedDice: Record<SeatIndex, number[]> = {};
  for (const p of state.players) revealedDice[p.seat] = p.dice;

  // No upper cap — a successful "맞아!" can push a seat's dice count past its
  // original 5 (module doc, 2026-08-17 룰북 정리). A losing call can still
  // only ever floor at 0.
  const players = state.players.map((p) =>
    p.seat === affectedSeat ? { ...p, diceCount: Math.max(0, p.diceCount + delta) } : p,
  );
  const affectedNowDice = players.find((p) => p.seat === affectedSeat)!.diceCount;
  const justEliminated = delta < 0 && affectedNowDice === 0;
  const eliminationOrder = justEliminated ? [...state.eliminationOrder, affectedSeat] : state.eliminationOrder;

  const resolution: RoundResolution = { ...meta, affectedSeat, diceDelta: delta, revealedDice };
  const alive = players.filter((p) => p.diceCount > 0).map((p) => p.seat);

  if (alive.length <= 1) {
    return {
      ...state,
      players,
      phase: "gameOver",
      lastResolution: resolution,
      eliminationOrder,
      winnerSeat: alive[0] ?? null,
    };
  }

  const nextStarter = affectedNowDice > 0 ? affectedSeat : nextAliveSeat(affectedSeat, players, state.playerCount);
  return {
    ...state,
    players,
    phase: "reveal",
    lastResolution: resolution,
    eliminationOrder,
    roundStarter: nextStarter,
    activeSeat: nextStarter,
  };
}

/**
 * "페루도!" — doubt the current bid. Turn-restricted like `raise` (rulebook
 * §4①: "자기 차례에 외칩니다"). Differential penalty (rulebook §4① 판정): the
 * loser doesn't just drop 1 die flat — they lose exactly as many dice as
 * their call was wrong by.
 * - Bid was too high (actualCount < bid.quantity): the bidder loses
 *   `bid.quantity - actualCount` dice.
 * - Bid held up (actualCount >= bid.quantity): the doubter loses
 *   `actualCount - bid.quantity + 1` dice (always >= 1, even for an exact
 *   match, since doubting a dead-on bid is still a bad call).
 */
function dudo(state: PerudoState, seat: SeatIndex): PerudoState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  const bid = state.currentBid;
  if (!bid) return state;

  const actualCount = countMatching(state.players, bid.face);
  const bidWasTooHigh = actualCount < bid.quantity;
  const affected = bidWasTooHigh ? bid.seat : seat;
  const loss = bidWasTooHigh ? bid.quantity - actualCount : actualCount - bid.quantity + 1;
  return applyResolution(state, affected, -loss, { kind: "dudo", actorSeat: seat, bid, actualCount });
}

/**
 * "맞아!" — claim the current bid is exactly right. Deliberately NOT
 * turn-restricted, see module doc. Differential penalty (rulebook §4② 판정):
 * a correct call always regains exactly 1 die — no upper cap, see module doc
 * (2026-08-17 룰북 정리: previously capped at `MAX_DICE`, now unbounded) —
 * but a wrong call costs the caller `|actualCount - bid.quantity|` dice —
 * the exact margin they misjudged by, in either direction.
 */
function calza(state: PerudoState, seat: SeatIndex): PerudoState {
  if (state.phase !== "playing") return state;
  const bid = state.currentBid;
  if (!bid) return state;
  const caller = state.players.find((p) => p.seat === seat);
  if (!caller || caller.diceCount <= 0) return state;

  const actualCount = countMatching(state.players, bid.face);
  const exact = actualCount === bid.quantity;
  const delta = exact ? 1 : -Math.abs(actualCount - bid.quantity);
  return applyResolution(state, seat, delta, { kind: "calza", actorSeat: seat, bid, actualCount });
}

/** Rerolls every alive player's dice and opens the next round — only valid once a dudo/calza call has moved the game to "reveal". */
function continueRound(state: PerudoState, seed: number): PerudoState {
  if (state.phase !== "reveal") return state;
  const rng = seededRng(seed);
  const players = state.players.map((p) => (p.diceCount > 0 ? { ...p, dice: rollDice(rng, p.diceCount) } : { ...p, dice: [] }));
  return {
    ...state,
    players,
    currentBid: null,
    phase: "playing",
    roundNumber: state.roundNumber + 1,
    activeSeat: state.roundStarter,
  };
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat). Levels
// 1–10 route through the shared `pickByLevel` noise curve (botDifficulty.ts)
// on top of `scoreMove` below.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/** The cheapest legal raise for each face right now — never more than 6 candidates. */
function raiseMoves(state: PerudoState): EngineAction[] {
  const moves: EngineAction[] = [];
  for (let face = 1; face <= 6; face++) {
    const quantity = minValidQuantityForFace(state.currentBid, face as Face);
    if (quantity === null) continue;
    moves.push({ type: "raise", seat: state.activeSeat, quantity, face: face as Face });
  }
  return moves;
}

/**
 * Every legal `EngineAction` `seat` may submit right now. Deliberately
 * narrower than the human UI in one documented way: the rulebook lets ANY
 * seat call "맞아!(calza)" out of turn (see module doc), but bots here only
 * ever act on their own turn — out-of-turn calza-sniping is left as a
 * human-only tactic, not modeled for bots.
 */
export function getValidMoves(state: PerudoState, seat: SeatIndex): EngineAction[] {
  if (state.phase !== "playing" || seat !== state.activeSeat) return [];
  const player = state.players.find((p) => p.seat === seat);
  if (!player || player.diceCount <= 0) return [];
  const moves = raiseMoves(state);
  if (state.currentBid) {
    moves.push({ type: "dudo", seat });
    moves.push({ type: "calza", seat });
  }
  return moves;
}

/**
 * How many dice on the table are expected to show `face`, using ONLY
 * information `seat` could fairly know (their own hidden dice + the
 * publicly-known dice counts of everyone else) — deliberately never reads
 * another seat's `dice` array, even though this client's state technically
 * holds it (see engine module doc's trust-model note), so the bot doesn't
 * play with information a human opponent wouldn't have.
 */
function estimateExpectedCount(state: PerudoState, seat: SeatIndex, face: Face): number {
  const me = state.players.find((p) => p.seat === seat)!;
  const ownMatches = countMatching([me], face);
  const othersDice = totalDiceInPlay(state) - me.diceCount;
  const p = face !== 1 ? 1 / 3 : 1 / 6;
  return ownMatches + othersDice * p;
}

function nCr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  const k = Math.min(r, n - r);
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  return nCr(n, k) * p ** k * (1 - p) ** (n - k);
}

/**
 * P(table-wide count of `face` >= `quantity`), computed as a true binomial
 * tail probability over just the *other* seats' dice (own dice are exactly
 * known, never guessed) — same "only fairly-known info" rule as
 * `estimateExpectedCount`, just a properly-integrated distribution instead
 * of a linear mean-gap approximation. Lv.8+ routes through this for a real
 * EV read on how safe a bid is instead of the core heuristic's rough mean.
 */
function holdProbability(state: PerudoState, seat: SeatIndex, quantity: number, face: Face): number {
  const me = state.players.find((p) => p.seat === seat)!;
  const ownMatches = countMatching([me], face);
  const othersDice = totalDiceInPlay(state) - me.diceCount;
  const need = quantity - ownMatches;
  if (need <= 0) return 1;
  if (need > othersDice) return 0;
  const p = face !== 1 ? 1 / 3 : 1 / 6;
  let total = 0;
  for (let k = need; k <= othersDice; k++) total += binomialPmf(othersDice, k, p);
  return total;
}

/** P(table-wide count of `face` === `quantity` exactly) — what "맞아!(calza)" actually needs to be right about. */
function exactProbability(state: PerudoState, seat: SeatIndex, quantity: number, face: Face): number {
  const me = state.players.find((p) => p.seat === seat)!;
  const ownMatches = countMatching([me], face);
  const othersDice = totalDiceInPlay(state) - me.diceCount;
  const need = quantity - ownMatches;
  if (need < 0 || need > othersDice) return 0;
  const p = face !== 1 ? 1 / 3 : 1 / 6;
  return binomialPmf(othersDice, need, p);
}

/**
 * How good `move` looks for `seat` — higher is better. Lv.1–7 use a simple
 * expected-value heuristic (mean-gap, not full Bayesian play). Lv.8–10
 * (`botTier(level) === "expert"`) instead score every move on the same 0–1
 * true-probability scale (`holdProbability`/`exactProbability`), which is
 * directly comparable across raise/dudo/calza instead of mixing three
 * differently-scaled formulas.
 */
function scoreMove(state: PerudoState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  const expert = botTier(level) === "expert";
  switch (move.type) {
    case "raise": {
      if (expert) return holdProbability(state, seat, move.quantity, move.face);
      const expected = estimateExpectedCount(state, seat, move.face);
      // A credible raise is one the bot's own estimate still supports.
      return expected - move.quantity;
    }
    case "dudo": {
      const bid = state.currentBid!;
      if (expert) return 1 - holdProbability(state, seat, bid.quantity, bid.face);
      const expected = estimateExpectedCount(state, seat, bid.face);
      // The more the bid outstrips the estimate, the better a dudo call looks.
      return bid.quantity - expected;
    }
    case "calza": {
      const bid = state.currentBid!;
      if (expert) return exactProbability(state, seat, bid.quantity, bid.face);
      const expected = estimateExpectedCount(state, seat, bid.face);
      // Best right when the bid looks exactly on the money.
      return 3 - Math.abs(expected - bid.quantity) * 4;
    }
    default:
      return -Infinity;
  }
}

// ---------------------------------------------------------------------------
// Level 8-10 "expert" bot: Information Set Monte Carlo Tree Search
// (ISMCTS)-lite + live regret-matching bluff mixing.
//
// A full ISMCTS builds and revisits a tree of information sets across many
// iterations; what's implemented here is its determinization step (sample N
// plausible worlds for the opponents' hidden dice, consistent only with
// their publicly-known dice *counts*) paired with a single-ply Monte Carlo
// rollout per candidate move (see `simulateRoundValue`) instead of a
// persistent tree — the same practical simplification `montecarlo.ts`'s doc
// makes for PIMC, and for the same reason (a real per-node tree revisited
// over hundreds of iterations is a different, much heavier project than a
// per-turn decision function). The bluffing half of the spec — mixed
// strategies instead of a deterministic argmax — comes from
// `regretMatching.ts`: every candidate's simulated value feeds a live
// regret-matching distribution, and the actual move is *sampled* from it
// (see regretMatching.ts's doc on why this is real-time regret matching,
// not a fully-trained CFR equilibrium).
// ---------------------------------------------------------------------------

import { evaluateMovesByDeterminization } from "@/games/shared/bot/montecarlo";
import { regretMatchingDistribution, sampleFromDistribution } from "@/games/shared/bot/regretMatching";

export const DEFAULT_ISMCTS_TRIALS = 120;
const ISMCTS_ROLLOUT_TURN_GUARD = 40; // defensive cap — raises strictly increase quantity/face each turn, so a round is structurally bounded, but a hard guard keeps a rollout from ever looping.

/** One determinized world: every OTHER alive seat's hidden dice are re-rolled uniformly at random, sized to their real (public) `diceCount` — `seat`'s own dice are left untouched, never guessed. */
function determinizeOpponentDice(state: PerudoState, seat: SeatIndex, rng: () => number): PerudoState {
  const players = state.players.map((p) => (p.seat === seat || p.diceCount === 0 ? p : { ...p, dice: rollDice(rng, p.diceCount) }));
  return { ...state, players };
}

/** Fast deterministic policy (argmax of the existing expert-tier `scoreMove`) used to roll every seat's *subsequent* turns forward inside an ISMCTS trial. */
function fastRolloutMove(state: PerudoState, seat: SeatIndex): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(state, seat, move, 10);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/**
 * Plays `firstMove` in `world`, then rolls subsequent turns forward with
 * `fastRolloutMove` until the round resolves (phase leaves "playing" — a
 * dudo/calza call, or the round/game ending outright). The payoff is
 * `seat`'s dice-count swing over that span, plus a flat bonus/penalty for an
 * outright win/loss — comparably scaled with the raw dice delta so a genuine
 * game-ending result isn't drowned out by (nor dwarfs) an ordinary round.
 */
function simulateRoundValue(world: PerudoState, seat: SeatIndex, firstMove: EngineAction): number {
  let s = applyAction(world, firstMove);
  const before = world.players.find((p) => p.seat === seat)!.diceCount;
  let guard = 0;
  while (s.phase === "playing" && guard < ISMCTS_ROLLOUT_TURN_GUARD) {
    const move = fastRolloutMove(s, s.activeSeat);
    if (!move) break;
    s = applyAction(s, move);
    guard++;
  }
  const after = s.players.find((p) => p.seat === seat)?.diceCount ?? 0;
  let value = after - before;
  if (s.phase === "gameOver") value += s.winnerSeat === seat ? 5 : -5;
  return value;
}

/**
 * Combines the existing analytical "expert" `scoreMove` (holdProbability /
 * exactProbability — an exact 0-1 closed-form probability, not an
 * approximation) with a bounded ISMCTS-lite rollout nudge, rather than
 * replacing one with the other. Empirically (see the self-play benchmark),
 * the closed-form probability alone is a MORE precise read on "does this
 * exact bid hold" than a 25-120 trial Monte Carlo rollout can be — the
 * rollout also has to simulate several subsequent turns of a heuristic
 * opponent policy, so its noise compounds beyond just the dice draw. What a
 * rollout genuinely adds beyond the single-bid probability is a forward-
 * looking read on how the position *develops* (e.g. among several
 * similarly-safe raises, which one leaves the round in the best shape one
 * or two turns out) — exactly the kind of thing a static probability can't
 * see. So the rollout is folded in as a small, tanh-bounded adjustment on
 * top of the analytical score: never large enough to flip a clearly-correct
 * call into a clearly-wrong one, but enough to break ties between options
 * the analytical formula alone can't distinguish (which is also where a
 * genuine bluff should live, per the regret-matching sampling below).
 */
function ismctsScoreMoves(state: PerudoState, seat: SeatIndex, moves: EngineAction[], rng: () => number, trials: number) {
  const rolled = evaluateMovesByDeterminization(moves, {
    determinize: (r) => determinizeOpponentDice(state, seat, r),
    evaluateInWorld: (world, move) => simulateRoundValue(world, seat, move),
    trials,
    rng,
  });
  return rolled.map((r) => {
    const analytical = scoreMove(state, seat, r.move, 10);
    const nudge = Math.tanh(r.averageValue / 5) * 0.15;
    return { move: r.move, averageValue: analytical + nudge };
  });
}

/**
 * Picks a move for `seat`. Levels 1-7 use the shared Level 1–10 curve
 * (`pickByLevel`, botDifficulty.ts): score every legal move with
 * `scoreMove`, then let the level decide how reliably the best-scored one
 * actually gets played. Levels 8-10 (expert tier) bypass that curve
 * entirely in favor of ISMCTS-lite + regret-matching sampling (see above) —
 * `pickByLevel`'s expert tier is a *deterministic* argmax (0% mistake
 * chance, 0 tie margin), which is exactly wrong for a bluffing game: a
 * bot that always plays its single highest-scored move is fully
 * predictable and can never credibly bluff. `rng` defaults to
 * `Math.random` either way — bot decisions are local UX, not part of the
 * deterministic engine contract; the resulting `EngineAction` still runs
 * through the ordinary, fully deterministic `applyAction`.
 */
export function chooseBotAction(
  state: PerudoState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
  opts?: { ismctsTrials?: number },
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;

  if (botTier(level) === "expert") {
    const evaluated = ismctsScoreMoves(state, seat, moves, rng, opts?.ismctsTrials ?? DEFAULT_ISMCTS_TRIALS);
    // sharpness=2: see regretMatching.ts's doc — keeps genuine bluffing among
    // genuinely close candidates without diluting an already-clear best call.
    const distribution = regretMatchingDistribution(evaluated.map((e) => ({ move: e.move, value: e.averageValue })), 2);
    return sampleFromDistribution(distribution, rng);
  }

  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: PerudoState, action: EngineAction): PerudoState {
  switch (action.type) {
    case "raise":
      return raise(state, action.seat, action.quantity, action.face);
    case "dudo":
      return dudo(state, action.seat);
    case "calza":
      return calza(state, action.seat);
    case "continue":
      return continueRound(state, action.seed);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Final rankings
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. The winner is rank 1;
 * everyone else is ranked by reverse elimination order (last eliminated =
 * 2nd place, first eliminated = last place) — never tied, since exactly one
 * seat is penalized per round.
 */
export function computeRankings(state: PerudoState): RankedSeat[] {
  const ranks: RankedSeat[] = [];
  if (state.winnerSeat !== null) ranks.push({ seat: state.winnerSeat, rank: 1 });
  [...state.eliminationOrder].reverse().forEach((seat, i) => ranks.push({ seat, rank: i + 2 }));
  return ranks;
}
