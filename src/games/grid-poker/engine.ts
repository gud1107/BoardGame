/**
 * Pure Grid Poker rules engine — no React, no I/O.
 *
 * Deck is 54 cards: ranks 2-10, J, Q, K, A (13 ranks x 4 suits) + 2 Jokers.
 * Every "common card" draw is an *independent uniform pick with replacement*
 * over all 54 cards — the physical card is shown then shuffled straight back
 * in, so the same exact card can recur many times in one game and there is
 * no deck/discard state to track at all.
 *
 * Flow: (1) "placing" phase — 25 rounds, each round one shared card is
 * drawn and every player places it into an empty cell of their own 5x5
 * board, independently. (2) "submitting" phase — once every board is full,
 * players repeatedly blind-pick one of their own still-unused lines (5 rows +
 * 5 cols + 2 diagonals = 12 total); once everyone has picked for the round,
 * hands are revealed and compared, best hand scores a point. 2 players play
 * 10 of the 12 rounds (first to 6 wins ends immediately, 2 lines go
 * unsubmitted by construction); 3+ players play all 12 rounds (immediate end
 * at 7 wins), highest score after the last round wins.
 *
 * Same online-multiplayer trust model as Hanamikoji/Bang: every connected
 * client computes and holds the FULL state (every player's entire board)
 * from a shared seed plus replayed `EngineAction`s — there is no server
 * authority. The view layer only ever *renders* a filtered view (see
 * `visibleOpponentBoard`); a technically inclined player could inspect
 * client state to see the rest. Accepted trade-off, see README.
 */

export type Suit = "S" | "D" | "H" | "C";
export type SeatIndex = number;

export type Card = { id: string } & (
  | { kind: "std"; rank: number; suit: Suit } // rank 2-14 (11=J,12=Q,13=K,14=A)
  | { kind: "joker" }
);

export const BOARD_SIZE = 25;

/** The 12 scoring lines over a flat 0-24 index board: 5 rows, 5 columns, 2 diagonals. */
export const LINES: number[][] = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

export const RANKS: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const SUITS: Suit[] = ["S", "D", "H", "C"];
/** ♠ > ◆ > ♥ > ♣, higher wins — only ever consulted as the last-resort tiebreaker. */
export const SUIT_VALUE: Record<Suit, number> = { S: 4, D: 3, H: 2, C: 1 };
export const RANK_LABEL: Record<number, string> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export interface PlayerState {
  seat: SeatIndex;
  board: (Card | null)[]; // length 25
  firstPlacedCell: number | null;
  /**
   * Cell index this player placed the *current* draft round's common card
   * into, so opponents can see "where they're putting it" live. Cleared back
   * to null the moment a fresh common card is drawn (`draw-common`) — only
   * ever holds this one most-recent placement, never a history.
   */
  lastPlacedCell: number | null;
  usedLines: boolean[]; // length 12
  score: number;
}

export type Phase = "placing" | "submitting" | "game-end";

export interface ResolvedHandCard {
  rank: number;
  suit: Suit;
  fromJoker: boolean;
}

export interface HandResult {
  category: number; // 0=high card ... 8=straight flush (royal is the ace-high case of 8)
  categoryName: string;
  ranks: number[]; // significance-ordered tiebreak vector for this category
  topSuitValue: number; // suit of the single highest-ranked card, for the final tiebreak
  cards: ResolvedHandCard[]; // the concrete 5-card hand actually used (jokers resolved)
}

export interface RoundSubmission {
  seat: SeatIndex;
  lineIndex: number;
  hand: HandResult;
}

export interface RoundResult {
  roundNumber: number;
  submissions: RoundSubmission[];
  winnerSeat: SeatIndex | null; // null = a genuine tie, no point awarded
}

export type TimerMode = "limited" | "unlimited";

/**
 * Room-level per-phase countdown lengths, chosen by the host at room-create
 * time and carried inside `GridPokerState` (set once by `startGame`, then
 * along for the ride via every `{...state, ...}` spread in the reducer) so
 * every client's `useCountdown` reads the exact same numbers without a
 * separate sync channel. The timers themselves stay pure per-client UX (see
 * useCountdown.ts) — only the *lengths* need to be agreed on, not the ticking.
 */
export interface TimerSettings {
  mode: TimerMode;
  /** Countdown length during the "placing" phase (one shared card drafted per round). */
  placingSeconds: number;
  /** Countdown length during the "submitting" phase (blind line pick per scoring round). */
  submittingSeconds: number;
}

export const DEFAULT_PLACING_SECONDS = 40;
export const DEFAULT_SUBMITTING_SECONDS = 30;
export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  mode: "limited",
  placingSeconds: DEFAULT_PLACING_SECONDS,
  submittingSeconds: DEFAULT_SUBMITTING_SECONDS,
};

export interface GridPokerState {
  playerCount: number;
  players: PlayerState[];
  phase: Phase;
  currentCard: Card | null;
  placedThisRound: boolean[];
  drawCount: number;
  submissions: (number | null)[]; // this scoring round's blind line picks, by seat
  roundNumber: number;
  totalScoringRounds: number; // 10 for 2p, 12 for 3+p
  winThreshold: number; // 6 for 2p, 7 for 3+p
  lastRoundResult: RoundResult | null;
  winner: SeatIndex[] | null; // length 1 = clear winner, length >1 = tied
  timerSettings: TimerSettings;
}

export type EngineAction =
  | { type: "draw-common"; seed?: number }
  | { type: "place"; seat: SeatIndex; cellIndex: number }
  | { type: "submit-line"; seat: SeatIndex; lineIndex: number };

/** Deterministic PRNG, shared across every engine — see src/lib/rng.ts. */
import { seededRng } from "@/lib/rng";
export { seededRng };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS): GridPokerState {
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    board: Array(BOARD_SIZE).fill(null),
    firstPlacedCell: null,
    lastPlacedCell: null,
    usedLines: Array(LINES.length).fill(false),
    score: 0,
  }));
  return {
    playerCount,
    players,
    phase: "placing",
    currentCard: null,
    placedThisRound: Array(playerCount).fill(false),
    drawCount: 0,
    submissions: Array(playerCount).fill(null),
    roundNumber: 1,
    totalScoringRounds: playerCount === 2 ? 10 : 12,
    winThreshold: playerCount === 2 ? 6 : 7,
    lastRoundResult: null,
    winner: null,
    timerSettings,
  };
}

// ---------------------------------------------------------------------------
// Placing phase
// ---------------------------------------------------------------------------

function fallbackSeed(state: GridPokerState, salt: number): number {
  return state.drawCount * 999983 + state.roundNumber * 7919 + salt;
}

// `Omit<Card, "id">` isn't usable here: Omit isn't distributive over a
// discriminated union, so it collapses to the fields common to every
// variant (just `kind`) instead of preserving each branch's own fields.
type CardSpec = { kind: "std"; rank: number; suit: Suit } | { kind: "joker" };

function drawRandomCard(rng: () => number): CardSpec {
  const n = Math.floor(rng() * 54); // 0-53, each of the 54 physical cards equally likely
  if (n < 52) {
    const rank = RANKS[Math.floor(n / 4)];
    const suit = SUITS[n % 4];
    return { kind: "std", rank, suit };
  }
  return { kind: "joker" };
}

function withId(spec: CardSpec, id: string): Card {
  return spec.kind === "joker" ? { id, kind: "joker" } : { id, kind: "std", rank: spec.rank, suit: spec.suit };
}

function drawCommon(state: GridPokerState, seed: number | undefined): GridPokerState {
  if (state.phase !== "placing" || state.currentCard !== null) return state;
  const rng = seededRng(seed ?? fallbackSeed(state, 1));
  const drawCount = state.drawCount + 1;
  return {
    ...state,
    currentCard: withId(drawRandomCard(rng), `card-${drawCount}`),
    drawCount,
    placedThisRound: Array(state.playerCount).fill(false),
    // A fresh common card means every "who's placing where" marker from the
    // previous round is now stale — clear it so opponents' boards stop
    // showing last round's placement the instant a new card is drafted.
    players: state.players.map((p) => ({ ...p, lastPlacedCell: null })),
  };
}

function place(state: GridPokerState, seat: SeatIndex, cellIndex: number): GridPokerState {
  if (state.phase !== "placing" || !state.currentCard) return state;
  if (seat < 0 || seat >= state.playerCount) return state;
  if (state.placedThisRound[seat]) return state;
  const player = state.players[seat];
  if (cellIndex < 0 || cellIndex >= BOARD_SIZE || player.board[cellIndex] !== null) return state;

  const board = [...player.board];
  board[cellIndex] = state.currentCard;
  const firstPlacedCell = player.firstPlacedCell ?? cellIndex;
  const players = state.players.map((p, i) =>
    i === seat ? { ...p, board, firstPlacedCell, lastPlacedCell: cellIndex } : p
  );
  const placedThisRound = state.placedThisRound.map((v, i) => (i === seat ? true : v));

  let s: GridPokerState = { ...state, players, placedThisRound };
  if (!placedThisRound.every(Boolean)) return s;

  s = { ...s, currentCard: null };
  const boardFull = s.players[0].board.every((c) => c !== null);
  if (boardFull) {
    s = { ...s, phase: "submitting", submissions: Array(s.playerCount).fill(null) };
  }
  return s;
}

// ---------------------------------------------------------------------------
// Submitting / scoring phase
// ---------------------------------------------------------------------------

function submitLine(state: GridPokerState, seat: SeatIndex, lineIndex: number): GridPokerState {
  if (state.phase !== "submitting") return state;
  if (seat < 0 || seat >= state.playerCount) return state;
  if (lineIndex < 0 || lineIndex >= LINES.length) return state;
  if (state.submissions[seat] !== null) return state;
  if (state.players[seat].usedLines[lineIndex]) return state;

  const submissions = state.submissions.map((v, i) => (i === seat ? lineIndex : v));
  const s: GridPokerState = { ...state, submissions };
  if (!submissions.every((v) => v !== null)) return s;
  return resolveRound(s);
}

function checkGameEnd(state: GridPokerState): SeatIndex[] | null {
  const maxScore = Math.max(...state.players.map((p) => p.score));
  const leaders = state.players.filter((p) => p.score === maxScore).map((p) => p.seat);
  if (maxScore >= state.winThreshold) return leaders;
  if (state.roundNumber > state.totalScoringRounds) return leaders;
  return null;
}

function resolveRound(state: GridPokerState): GridPokerState {
  const submissions: RoundSubmission[] = state.players.map((p, seat) => {
    const lineIndex = state.submissions[seat]!;
    const cards = LINES[lineIndex].map((cellIndex) => p.board[cellIndex]!);
    return { seat, lineIndex, hand: evaluateHand(cards) };
  });

  let bestSeats = [submissions[0].seat];
  let bestHand = submissions[0].hand;
  for (const sub of submissions.slice(1)) {
    const cmp = compareHands(sub.hand, bestHand);
    if (cmp > 0) {
      bestSeats = [sub.seat];
      bestHand = sub.hand;
    } else if (cmp === 0) {
      bestSeats.push(sub.seat);
    }
  }
  const winnerSeat = bestSeats.length === 1 ? bestSeats[0] : null;

  const players = state.players.map((p, seat) => {
    const lineIndex = state.submissions[seat]!;
    const usedLines = p.usedLines.map((v, li) => (li === lineIndex ? true : v));
    return { ...p, usedLines, score: seat === winnerSeat ? p.score + 1 : p.score };
  });

  let s: GridPokerState = {
    ...state,
    players,
    submissions: Array(state.playerCount).fill(null),
    lastRoundResult: { roundNumber: state.roundNumber, submissions, winnerSeat },
    roundNumber: state.roundNumber + 1,
  };

  const winners = checkGameEnd(s);
  if (winners) s = { ...s, phase: "game-end", winner: winners };
  return s;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * What an opponent's board looks like to everyone else: only their
 * first-ever-placed cell, plus any line they've already submitted for
 * scoring (those 5 cards were shown and compared, so they're public from
 * that point on). Everything else renders as hidden even though the full
 * state is present in memory — same UI-level trust trade-off as Hanamikoji's
 * hand-hiding and Bang!'s role-hiding.
 */
export function visibleOpponentBoard(player: PlayerState): (Card | null)[] {
  const revealed = new Set<number>();
  if (player.firstPlacedCell !== null) revealed.add(player.firstPlacedCell);
  player.usedLines.forEach((used, li) => {
    if (used) LINES[li].forEach((cell) => revealed.add(cell));
  });
  return player.board.map((card, i) => (revealed.has(i) ? card : null));
}

/**
 * The one live "here's where they just put this round's common card"
 * marker for an opponent, distinct from (and layered on top of)
 * `visibleOpponentBoard`'s permanent reveals. Only meaningful during the
 * placing phase — `lastPlacedCell` is cleared on every fresh `draw-common`,
 * so this always reflects at most the single most recent placement, never
 * an accumulated history. Returns null once submitting/scoring starts,
 * since there's no more common card being drafted at that point.
 */
export function opponentLiveCell(state: GridPokerState, player: PlayerState): number | null {
  if (state.phase !== "placing") return null;
  return player.lastPlacedCell;
}

// ---------------------------------------------------------------------------
// Hand evaluation (standard poker, wild Jokers)
// ---------------------------------------------------------------------------

export const CATEGORY_NAMES = [
  "하이 카드",
  "원 페어",
  "투 페어",
  "트리플",
  "스트레이트",
  "플러시",
  "풀 하우스",
  "포카드",
  "스트레이트 플러시",
] as const;

interface RankedTriplet {
  category: number;
  ranks: number[];
  topSuitValue: number;
}

function evaluateConcrete(cards: { rank: number; suit: Suit }[]): RankedTriplet {
  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);

  const uniqueDesc = Array.from(new Set(ranksDesc)).sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (uniqueDesc.length === 5) {
    if (uniqueDesc[0] - uniqueDesc[4] === 4) {
      isStraight = true;
      straightHigh = uniqueDesc[0];
    } else if (uniqueDesc[0] === 14 && uniqueDesc[1] === 5 && uniqueDesc[4] === 2) {
      isStraight = true; // wheel: A-2-3-4-5, five-high
      straightHigh = 5;
    }
  }

  const counts = new Map<number, number>();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pattern = groups.map((g) => g[1]);

  let category: number;
  let ranks: number[];
  if (isStraight && isFlush) {
    category = 8;
    ranks = [straightHigh];
  } else if (pattern[0] === 4) {
    category = 7;
    ranks = groups.map((g) => g[0]);
  } else if (pattern[0] === 3 && pattern[1] === 2) {
    category = 6;
    ranks = groups.map((g) => g[0]);
  } else if (isFlush) {
    category = 5;
    ranks = ranksDesc;
  } else if (isStraight) {
    category = 4;
    ranks = [straightHigh];
  } else if (pattern[0] === 3) {
    category = 3;
    ranks = groups.map((g) => g[0]);
  } else if (pattern[0] === 2 && pattern[1] === 2) {
    category = 2;
    ranks = groups.map((g) => g[0]);
  } else if (pattern[0] === 2) {
    category = 1;
    ranks = groups.map((g) => g[0]);
  } else {
    category = 0;
    ranks = ranksDesc;
  }

  const topRank = ranksDesc[0];
  const topSuitValue = Math.max(...cards.filter((c) => c.rank === topRank).map((c) => SUIT_VALUE[c.suit]));
  return { category, ranks, topSuitValue };
}

function compareTriplet(a: RankedTriplet, b: RankedTriplet): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.topSuitValue - b.topSuitValue;
}

/** Compares two already-evaluated hands: category, then rank tiebreak vector, then (only if fully tied) top-card suit. */
export function compareHands(a: HandResult, b: HandResult): number {
  return compareTriplet(a, { category: b.category, ranks: b.ranks, topSuitValue: b.topSuitValue });
}

function rankCombos(n: number): number[][] {
  if (n === 0) return [[]];
  const rest = rankCombos(n - 1);
  const out: number[][] = [];
  for (const r of RANKS) for (const combo of rest) out.push([r, ...combo]);
  return out;
}

/**
 * Best achievable 5-card poker hand from a line's cards, treating Jokers as
 * fully wild (any rank, any suit). Brute-forces every rank assignment for
 * the wild cards (cheap: at most 13^5 combos, and realistically 0-1 wilds
 * per line), and for each, tries every *uniform* suit assignment for the
 * wilds that could possibly be optimal: the suit that completes a flush
 * (when the fixed cards' suits allow one) AND spades (the suit-value
 * maximizer used whenever no flush is in play). Trying only the
 * flush-completing suit is not enough — when a non-flush category (e.g.
 * four of a kind) turns out to beat any flush the wilds could reach, the
 * wild cards' suit no longer needs to match the fixed cards at all, and
 * spades yields a strictly better final suit-tiebreak than reusing the
 * fixed suit would. Both candidates are always safe to compare: mixing
 * suits within a single wild assignment is never better than one of these
 * two uniform choices, since a flush/straight-flush needs every card
 * (including every wild) to share one suit to register at all, while the
 * suit of any wild that isn't part of the hand's top rank never affects
 * the outcome either way.
 */
export function evaluateHand(cards: Card[]): HandResult {
  const fixed: { rank: number; suit: Suit }[] = [];
  let wildCount = 0;
  for (const c of cards) {
    if (c.kind === "joker") wildCount++;
    else fixed.push({ rank: c.rank, suit: c.suit });
  }

  const fixedSuits = Array.from(new Set(fixed.map((c) => c.suit)));
  const flushAchievable = fixedSuits.length <= 1;
  const candidateSuits: Suit[] = flushAchievable
    ? fixedSuits.length === 1
      ? Array.from(new Set<Suit>([fixedSuits[0], "S"]))
      : SUITS
    : ["S"];

  let best: RankedTriplet | null = null;
  let bestCards: { rank: number; suit: Suit }[] | null = null;

  for (const wildRanks of rankCombos(wildCount)) {
    for (const suit of candidateSuits) {
      const trialWilds = wildRanks.map((rank) => ({ rank, suit }));
      const trialCards = [...fixed, ...trialWilds];
      const triplet = evaluateConcrete(trialCards);
      if (!best || compareTriplet(triplet, best) > 0) {
        best = triplet;
        bestCards = trialCards;
      }
    }
  }

  const result = best!;
  const fixedCount = fixed.length;
  // Royal flush (로티플) is the ace-high case of straight-flush (category 8) —
  // it already outranks every other straight flush via the rank tiebreak
  // (ranks=[14] beats any lower straightHigh), so no separate category
  // number is needed for correct comparisons. But the spec names it as its
  // own distinct tier (로티플 > 스티플), and the UI surfaces `categoryName`
  // directly to players, so give it its own label here.
  const categoryName =
    result.category === 8 && result.ranks[0] === 14 ? "로열 스트레이트 플러시" : CATEGORY_NAMES[result.category];
  return {
    category: result.category,
    categoryName,
    ranks: result.ranks,
    topSuitValue: result.topSuitValue,
    // bestCards is always built as [...fixed, ...resolvedWilds], in that order.
    cards: bestCards!.map((c, i) => ({ rank: c.rank, suit: c.suit, fromJoker: i >= fixedCount })),
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyAction(state: GridPokerState, action: EngineAction): GridPokerState {
  switch (action.type) {
    case "draw-common":
      return drawCommon(state, action.seed);
    case "place":
      return place(state, action.seat, action.cellIndex);
    case "submit-line":
      return submitLine(state, action.seat, action.lineIndex);
    default:
      return state;
  }
}
