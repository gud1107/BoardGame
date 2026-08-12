/**
 * Pure "코요테(Coyote)" rules engine — no React, no I/O. Implements the
 * rulebook at boardGameRule/코요테/코요테.md: an Indian-poker-style bluffing
 * game where every player wears one card face-out on their forehead — they
 * can see everyone else's card but never their own — and take turns either
 * declaring a strictly higher guess at the table's total sum, or shouting
 * "코요테!" to challenge the previous declaration.
 *
 * Same online-multiplayer trust model as every other game in this project
 * (see Perudo/Avalon's module docs): every connected client computes and
 * holds the FULL state (every seat's forehead card) from a shared RNG seed
 * plus replayed `EngineAction`s — there is no server authority. The
 * "이마 카드" secrecy (a seat can't see its own card) is enforced purely at
 * the view layer via `getPlayerView` below, exactly like Avalon's
 * `getKnowledge` — nothing is ever actually hidden inside `CoyoteState`
 * itself.
 *
 * Documented assumptions/inferences (the rulebook doesn't spell these out):
 * 1. **36-card deck's exact per-value breakdown.** The local rulebook only
 *    lists which face values exist (1/2/3/4/5/10/15/20, -5/-10, 0,
 *    0(선 교체), x2, MAX→0, ?) without giving counts. Cross-checked against
 *    the real "코요테" board game's published composition (나무위키: 26장
 *    "코요테카드" across those 8 positive values + 3× "인디언 소년" 0 + 2×
 *    "도둑" -5 + 1× "몬스터" -10 + 1× "밤" 0(선 교체) + 1× "보물상자" ? + 1×
 *    "인디언 소녀" MAX→0 + 1× "인디언 추장" x2 = 36 total, see `NUMBER_CARD_SPEC`
 *    below). The 26-card split across the 8 positive values isn't published
 *    anywhere found — only the category totals are sourced, the exact split
 *    among 1/2/3/4/5/10/15/20 (4/4/4/3/3/3/3/2) is this engine's own
 *    reasonable low-to-high-weighted default.
 * 2. **Deck lifecycle across rounds.** The rulebook only describes a single
 *    round's flow (deal → bid → coyote → showdown) and never says whether
 *    the shared deck persists across rounds or reshuffles. This engine
 *    reshuffles the full 36-card deck fresh at the start of every round
 *    (`startGame`/`continueRound` both call `dealRound`) — the same "fresh
 *    full reroll every round" convention Perudo uses for its dice rather
 *    than tracking cross-round leftover-deck state (파생 상태 금지 원칙,
 *    docs/architecture.md §1.4).
 * 3. **"0(선 플레이어 교체)" card's actual effect.** The composition list
 *    names it but §3's calculation-order section never elaborates beyond
 *    the other three specials. Read literally by name: it contributes 0 to
 *    the sum (same as a plain 0) and its holder becomes the next round's
 *    starting/declaring player instead of the usual "next alive seat after
 *    whoever just lost a heart" rotation — see `resolveCoyoteCall`/
 *    `continueRound`.
 * 4. **MAX→0 target selection.** Only cards of kind "number" are eligible
 *    (specials themselves never compete to be "the highest card"). Ties are
 *    broken toward the lowest forehead seat index holding the max value; if
 *    the unique max only exists among cards drawn via a "?" chain (never
 *    assigned to any seat), that drawn card is zeroed instead.
 * 5. **Heart (life) count.** The task brief frames this as "each player
 *    starts with some lives and loses them", while the rulebook frames it as
 *    "accumulate 3 벌점 토큰 → eliminated" — mathematically identical in
 *    shape. This engine models it as `hearts` starting at `STARTING_HEARTS`
 *    and decrementing on a loss, elimination at 0. **Deliberate house-rule
 *    deviation from the rulebook's literal "3 tokens"**: per explicit
 *    product request the UI theme was changed from "깃털(feather)" to
 *    "하트(heart)" and the starting count lowered to 2 — a player is now
 *    eliminated after their *second* penalty instead of their third.
 * 6. **Player count.** 3~6 per rulebook §1 (추천 4~6) — no conflict with the
 *    task brief here.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
/** House-rule value (rulebook's literal reading is 3 벌점 토큰) — see module doc assumption #5. */
export const STARTING_HEARTS = 2;

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export type CardKind = "number" | "night" | "question" | "maxZero" | "double";

export interface Card {
  id: number;
  kind: CardKind;
  /**
   * Numeric face value contributed directly to the sum — 0 for every
   * non-"number"/"night" special (they act through side effects in
   * `resolveCoyoteCall` instead of a face value). "night" is always 0.
   */
  value: number;
}

/** [value, count][] for the 26 "코요테카드" positive/zero/negative faces + the 6-card "0/-5/-10" family — see module doc assumption #1. */
const NUMBER_CARD_SPEC: [value: number, count: number][] = [
  [1, 4],
  [2, 4],
  [3, 4],
  [4, 3],
  [5, 3],
  [10, 3],
  [15, 3],
  [20, 2], // 26 "코요테카드" total
  [0, 3], // 인디언 소년 카드
  [-5, 2], // 도둑 카드
  [-10, 1], // 몬스터 카드
];

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const [value, count] of NUMBER_CARD_SPEC) {
    for (let i = 0; i < count; i++) cards.push({ id: id++, kind: "number", value });
  }
  cards.push({ id: id++, kind: "night", value: 0 }); // 밤 카드 — 0(선 플레이어 교체)
  cards.push({ id: id++, kind: "question", value: 0 }); // 보물상자 카드 — ?
  cards.push({ id: id++, kind: "maxZero", value: 0 }); // 인디언 소녀 카드 — MAX→0
  cards.push({ id: id++, kind: "double", value: 0 }); // 인디언 추장 카드 — x2
  return cards;
}

export const DECK_SIZE = buildDeck().length; // 36, verified in Coyote.test.ts

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerState {
  seat: SeatIndex;
  hearts: number;
}

export interface Bid {
  seat: SeatIndex;
  number: number;
}

export type Phase = "playing" | "reveal" | "gameOver";

export interface Resolution {
  bid: Bid;
  callerSeat: SeatIndex;
  /** Snapshot of this round's forehead cards at the moment of the call — seat -> card, every alive seat included. */
  tableCards: Record<SeatIndex, Card>;
  /** Cards drawn from the round deck due to a "?" chain (in draw order); empty if no "?" was in play. */
  extraDrawnCards: Card[];
  /** Which card the MAX→0 special zeroed, if any — see module doc assumption #4. */
  maxZeroTarget: { seat: SeatIndex | null; card: Card | null };
  doubled: boolean;
  finalTotal: number;
  loserSeat: SeatIndex;
  /** true = the previous declarer overbid and lost a heart; false = the coyote-caller misjudged a safe bid and lost one instead. */
  loserWasBidder: boolean;
  /** This round's "밤 카드" holder (an alive forehead), if any — becomes next round's starter per module doc assumption #3. */
  nightCardHolderSeat: SeatIndex | null;
}

export interface CoyoteState {
  playerCount: number;
  players: PlayerState[];
  /** Forehead cards for every currently-alive seat this round. */
  tableCards: Record<SeatIndex, Card>;
  /** Cards left in this round's deck, available for "?" draws. */
  roundDeck: Card[];
  /** Null until the round starter makes their opening declaration. */
  currentBid: Bid | null;
  activeSeat: SeatIndex;
  /** Who opens each round's bidding — the seat forced to declare first (no prior bid to challenge). */
  roundStarter: SeatIndex;
  roundNumber: number;
  phase: Phase;
  /** Outcome of the most recent "코요테!" call, kept around through "reveal"/"gameOver" for the UI to render a showdown. Null until the first call of the game. */
  lastResolution: Resolution | null;
  /** Seats in the order they were eliminated (hearts hit 0) — needed for final rankings. */
  eliminationOrder: SeatIndex[];
  winnerSeat: SeatIndex | null;
}

export type EngineAction =
  | { type: "declare"; seat: SeatIndex; number: number }
  | { type: "coyote"; seat: SeatIndex }
  | { type: "continue"; seed: number };

// ---------------------------------------------------------------------------
// Setup / dealing
// ---------------------------------------------------------------------------

function dealRound(aliveSeats: SeatIndex[], rng: () => number): { tableCards: Record<SeatIndex, Card>; roundDeck: Card[] } {
  const deck = shuffle(buildDeck(), rng);
  const tableCards: Record<SeatIndex, Card> = {};
  aliveSeats.forEach((seat, i) => {
    tableCards[seat] = deck[i];
  });
  return { tableCards, roundDeck: deck.slice(aliveSeats.length) };
}

export function startGame(playerCount: number, seed: number): CoyoteState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const seats = Array.from({ length: playerCount }, (_, seat) => seat);
  const { tableCards, roundDeck } = dealRound(seats, rng);
  // No physical tiebreak has meaning at a fresh table — same convention as
  // Avalon/Perudo/No Thanks: pick the starter from the shared seed.
  const starter = Math.floor(rng() * playerCount);

  return {
    playerCount,
    players: seats.map((seat) => ({ seat, hearts: STARTING_HEARTS })),
    tableCards,
    roundDeck,
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

export function aliveSeats(state: CoyoteState): SeatIndex[] {
  return state.players.filter((p) => p.hearts > 0).map((p) => p.seat);
}

function nextAliveSeat(seat: SeatIndex, players: PlayerState[], playerCount: number): SeatIndex {
  let next = (seat + 1) % playerCount;
  for (let i = 0; i < playerCount; i++) {
    const p = players.find((pl) => pl.seat === next);
    if (p && p.hearts > 0) return next;
    next = (next + 1) % playerCount;
  }
  return seat; // unreachable once the game hasn't already ended, kept only as a safe fallback
}

/**
 * What `viewerSeat` is allowed to see of the table right now — the "이마
 * 카드" mechanic (task brief §"정보 격리 검증"). While the round is live
 * (`phase === "playing"`), the viewer's own forehead card is redacted to
 * `null`; every other seat's card is always visible, and once the round
 * moves to "reveal"/"gameOver" every seat (including the viewer's own) is
 * revealed. Mirrors Avalon's `getKnowledge` — the underlying `CoyoteState`
 * never actually hides anything, this is purely a read-side projection.
 */
export interface VisibleTableCard {
  seat: SeatIndex;
  card: Card | null;
}

export function getPlayerView(state: CoyoteState, viewerSeat: SeatIndex): VisibleTableCard[] {
  const seats = Object.keys(state.tableCards)
    .map(Number)
    .sort((a, b) => a - b);
  return seats.map((seat) => ({
    seat,
    card: state.phase === "playing" && seat === viewerSeat ? null : state.tableCards[seat],
  }));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * "숫자 선언하기" — must strictly exceed the current bid (rulebook §2 행동
 * A). The round's opening declaration (`currentBid === null`) has no floor
 * to beat, same minimal-constraint convention as Perudo's opening bid.
 */
function declare(state: CoyoteState, seat: SeatIndex, number: number): CoyoteState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || player.hearts <= 0) return state;
  if (!Number.isInteger(number)) return state;
  if (state.currentBid !== null && number <= state.currentBid.number) return state;

  return {
    ...state,
    currentBid: { seat, number },
    activeSeat: nextAliveSeat(seat, state.players, state.playerCount),
  };
}

/**
 * "코요테!" — challenge the previous declaration (rulebook §2 행동 B / §3-4).
 * Requires a pending bid: the round starter can never call coyote on their
 * own opening turn since there is nothing yet to challenge.
 */
function callCoyote(state: CoyoteState, seat: SeatIndex): CoyoteState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  const bid = state.currentBid;
  if (!bid) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || player.hearts <= 0) return state;

  return resolveCoyoteCall(state, seat, bid);
}

/**
 * Showdown (rulebook §3): reveal every forehead card, resolve "?" draws (in
 * order, chaining if the drawn card is itself another "?"), apply MAX→0,
 * then x2 — exactly the §3 계산 순서 order. Compares the result against the
 * challenged bid (§4) to decide who loses a heart, and applies it.
 */
function resolveCoyoteCall(state: CoyoteState, callerSeat: SeatIndex, bid: Bid): CoyoteState {
  const tableCards = { ...state.tableCards };
  const cards: Card[] = Object.values(tableCards);

  // "?" — draw from the round deck, chaining on another "?".
  const deck = [...state.roundDeck];
  const extraDrawnCards: Card[] = [];
  let pendingQuestions = cards.filter((c) => c.kind === "question").length;
  while (pendingQuestions > 0 && deck.length > 0) {
    const drawn = deck.shift()!;
    extraDrawnCards.push(drawn);
    cards.push(drawn);
    pendingQuestions -= 1;
    if (drawn.kind === "question") pendingQuestions += 1;
  }

  // MAX→0 — zero out the single highest "number" card in play (module doc assumption #4).
  const hasMaxZero = cards.some((c) => c.kind === "maxZero");
  let maxZeroTarget: { seat: SeatIndex | null; card: Card | null } = { seat: null, card: null };
  let zeroedValue = 0;
  if (hasMaxZero) {
    const numberCards = cards.filter((c) => c.kind === "number");
    if (numberCards.length > 0) {
      const maxValue = Math.max(...numberCards.map((c) => c.value));
      const candidates = numberCards.filter((c) => c.value === maxValue);
      let target: Card | null = null;
      let targetSeat: SeatIndex | null = null;
      for (const seat of Object.keys(tableCards)
        .map(Number)
        .sort((a, b) => a - b)) {
        if (candidates.includes(tableCards[seat])) {
          target = tableCards[seat];
          targetSeat = seat;
          break;
        }
      }
      if (!target) target = candidates[0]; // unique max only exists among extra-drawn cards
      maxZeroTarget = { seat: targetSeat, card: target };
      zeroedValue = target.value;
    }
  }

  // x2 — doubles the final total after MAX→0 is applied.
  const hasDouble = cards.some((c) => c.kind === "double");
  const rawSum = cards.reduce((sum, c) => sum + c.value, 0);
  const finalTotal = hasDouble ? (rawSum - zeroedValue) * 2 : rawSum - zeroedValue;

  // §4 판정: bid overshot the real total -> bidder loses; bid was safe -> caller loses.
  const bidderOver = finalTotal < bid.number;
  const loserSeat = bidderOver ? bid.seat : callerSeat;

  const nightEntry = Object.entries(tableCards).find(([, c]) => c.kind === "night");
  const nightCardHolderSeat = nightEntry ? Number(nightEntry[0]) : null;

  const players = state.players.map((p) => (p.seat === loserSeat ? { ...p, hearts: p.hearts - 1 } : p));
  const justEliminated = players.find((p) => p.seat === loserSeat)!.hearts <= 0;
  const eliminationOrder = justEliminated ? [...state.eliminationOrder, loserSeat] : state.eliminationOrder;

  const resolution: Resolution = {
    bid,
    callerSeat,
    tableCards,
    extraDrawnCards,
    maxZeroTarget,
    doubled: hasDouble,
    finalTotal,
    loserSeat,
    loserWasBidder: bidderOver,
    nightCardHolderSeat,
  };

  const alive = players.filter((p) => p.hearts > 0).map((p) => p.seat);
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

  return { ...state, players, phase: "reveal", lastResolution: resolution, eliminationOrder };
}

/**
 * Deals a fresh round (module doc assumption #2) once a showdown has moved
 * the game to "reveal". The next round's starter is the "밤 카드" holder if
 * that seat is still alive (module doc assumption #3), otherwise the next
 * alive seat after whoever just lost a heart.
 */
function continueRound(state: CoyoteState, seed: number): CoyoteState {
  if (state.phase !== "reveal") return state;
  const res = state.lastResolution!;
  const rng = seededRng(seed);
  const alive = aliveSeats(state).sort((a, b) => a - b);
  const { tableCards, roundDeck } = dealRound(alive, rng);

  const nightHolderAlive = res.nightCardHolderSeat !== null && alive.includes(res.nightCardHolderSeat);
  const nextStarter = nightHolderAlive ? res.nightCardHolderSeat! : nextAliveSeat(res.loserSeat, state.players, state.playerCount);

  return {
    ...state,
    tableCards,
    roundDeck,
    currentBid: null,
    activeSeat: nextStarter,
    roundStarter: nextStarter,
    roundNumber: state.roundNumber + 1,
    phase: "playing",
  };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: CoyoteState, action: EngineAction): CoyoteState {
  switch (action.type) {
    case "declare":
      return declare(state, action.seat, action.number);
    case "coyote":
      return callCoyote(state, action.seat);
    case "continue":
      return continueRound(state, action.seed);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat). Levels
// 1–10 route through the shared `pickByLevel` noise curve (botDifficulty.ts)
// on top of `scoreMove` below.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/**
 * "숫자 선언하기" has no rule-mandated ceiling (any integer strictly greater
 * than the current bid is legal), so a truly exhaustive `getValidMoves` is
 * impossible to enumerate. This returns a representative finite sample —
 * small conservative raises (+1..+6) through larger bluffing jumps
 * (+10/+20/+30/+50) above the current bid — which is what every level's
 * `chooseBotAction` actually picks from. Documented simplification, same
 * spirit as Perudo's dice-bounded bid enumeration but Coyote's declare has
 * no natural cap to enumerate exhaustively.
 */
function declareCandidates(state: CoyoteState): number[] {
  const floor = state.currentBid?.number ?? -20; // opening declare has no floor at all; -20 covers the worst-case all-negative-specials table
  const offsets = [1, 2, 3, 4, 5, 6, 10, 20, 30, 50];
  return offsets.map((o) => floor + o);
}

/** seat가 지금 제출할 수 있는 모든 합법 EngineAction(대표 표본) — declare/coyote의 가드를 그대로 반영. */
export function getValidMoves(state: CoyoteState, seat: SeatIndex): EngineAction[] {
  if (state.phase !== "playing" || seat !== state.activeSeat) return [];
  const player = state.players.find((p) => p.seat === seat);
  if (!player || player.hearts <= 0) return [];
  const moves: EngineAction[] = declareCandidates(state).map((number) => ({ type: "declare", seat, number }));
  if (state.currentBid) moves.push({ type: "coyote", seat });
  return moves;
}

/**
 * Expected value of the table's true total, using ONLY what `seat` can
 * legally see (info fairness — never reads `state.tableCards[seat]` itself,
 * only `getPlayerView`'s redaction of it). The seat's own hidden card (and
 * every card still in the undrawn round deck) is unknown, so its expected
 * value is approximated as the mean of the full 36-card deck composition
 * minus whatever's visible to this seat — legitimate deck-counting since
 * `buildDeck()`'s composition is public knowledge, not another seat's
 * private info.
 *
 * `applySpecials` gates whether the maxZero/double specials' *behavioral*
 * effect (not just their at-rest value of 0) gets folded in — Level 8–10
 * ("특수 카드 적용 기대값을 수학적으로 합산") does; core levels use the flatter
 * raw-sum estimate.
 */
function estimateTotal(state: CoyoteState, seat: SeatIndex, applySpecials: boolean): number {
  const view = getPlayerView(state, seat);
  const visibleCards = view.filter((v): v is { seat: SeatIndex; card: Card } => v.card !== null).map((v) => v.card);
  const visibleSum = visibleCards.reduce((s, c) => s + c.value, 0);

  const fullDeck = buildDeck();
  const seenIds = new Set(visibleCards.map((c) => c.id));
  const unseenDeck = fullDeck.filter((c) => !seenIds.has(c.id));
  const avgUnseenValue = unseenDeck.length > 0 ? unseenDeck.reduce((s, c) => s + c.value, 0) / unseenDeck.length : 0;

  let total = visibleSum + avgUnseenValue; // + this seat's own unknown card, approximated by the pool average

  if (!applySpecials) return total;

  const hasDouble = visibleCards.some((c) => c.kind === "double");
  if (hasDouble) total *= 2;

  const hasMaxZero = visibleCards.some((c) => c.kind === "maxZero");
  if (hasMaxZero) {
    const visibleMax = Math.max(0, ...visibleCards.filter((c) => c.kind === "number").map((c) => c.value));
    total -= Math.max(visibleMax, avgUnseenValue);
  }

  return total;
}

function scoreMove(state: CoyoteState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  const expert = botTier(level) === "expert";
  const total = estimateTotal(state, seat, expert);

  if (move.type === "coyote") {
    const bid = state.currentBid!;
    // "무리하지 않은 sharp한 코요테" — only worth calling when the declared
    // number plausibly overshoots the estimated true total.
    return bid.number - total;
  }
  if (move.type !== "declare") return 0;

  const base = state.currentBid?.number ?? -20;
  const margin = total - move.number; // positive = still believably under the true total (safe)
  const efficiencyPenalty = (move.number - base) * 0.1; // prefer the smallest raise that's still plausible
  return margin - efficiencyPenalty;
}

/** getValidMoves 중 level(1~10)에 맞는 액션을 고른다 — 점수 매기기+노이즈는 botDifficulty.ts의 공용 커브. seat가 지금 할 게 없으면 null. */
export function chooseBotAction(
  state: CoyoteState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
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
export function computeRankings(state: CoyoteState): RankedSeat[] {
  const ranks: RankedSeat[] = [];
  if (state.winnerSeat !== null) ranks.push({ seat: state.winnerSeat, rank: 1 });
  [...state.eliminationOrder].reverse().forEach((seat, i) => ranks.push({ seat, rank: i + 2 }));
  return ranks;
}
