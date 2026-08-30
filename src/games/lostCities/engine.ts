/**
 * Pure "로스트 시티 (Lost Cities)" rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/로스트시티/로스트시티.md`. Two design points were
 * confirmed via `AskUserQuestion` (Strict No-Assumption Rule in the task
 * brief) before implementation, since they weren't derivable from the
 * rulebook + this repo's own conventions alone:
 *
 *  - **단판 승부 (single round), not the rulebook's official 3-round
 *    cumulative-score match** (§7 of the rulebook). Every other online card
 *    game in this catalog plays a single deal to immediate results, and the
 *    user picked that shape over the extra round-transition/cumulative-score
 *    UI the official 3-round rule would need. `phase === "gameOver"` is
 *    final — there is no `startNextRound`.
 *  - **No room-linked betting integration** (`bettingRoomLinked`) — that's an
 *    opt-in pilot on 6 other games, not part of the platform-common feature
 *    list this task actually asked for, so it's left out here.
 *
 * Everything else follows the rulebook verbatim: 5 expedition colors × 12
 * cards each (3 investment + number 2–10), 8-card starting hand, the
 * mandatory two-phase turn (play-or-discard, then draw), the "can't
 * immediately re-take the card you just discarded this same turn" restriction
 * (§4), and the exact per-color scoring formula (§6):
 * `(numberSum - 20) × (investCount + 1) + (cardCount >= 8 ? 20 : 0)`, with an
 * empty lane scoring flat 0 (no -20 for a color never touched).
 *
 * Seat model follows the same `"p1" | "p2"` convention as every other
 * 2-player-exclusive online game here (malDalliJa, piecesOfLanguage).
 */

import { seededRng, shuffle } from "@/lib/rng";
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/**
 * The 5 expedition colors. Thematic labels (rulebook intro §1's "히말라야,
 * 열대우림, 사막, 고대 화산, 바다 속 침몰 도시") are attached via
 * `EXPEDITION_THEME` below rather than baked into the color id itself, per
 * the user's confirmed mapping.
 */
export type Color = "white" | "green" | "yellow" | "red" | "blue";
export const COLORS: readonly Color[] = ["white", "green", "yellow", "red", "blue"];

export const EXPEDITION_THEME: Record<Color, { name: string; emoji: string }> = {
  white: { name: "히말라야", emoji: "🏔️" },
  green: { name: "열대우림", emoji: "🌴" },
  yellow: { name: "사막", emoji: "🏜️" },
  red: { name: "화산", emoji: "🌋" },
  blue: { name: "침몰 도시", emoji: "🌊" },
};

export type CardKind = "investment" | "number";

export interface Card {
  id: string;
  color: Color;
  kind: CardKind;
  /** Present only for `kind === "number"`, 2–10. */
  value?: number;
}

export type TurnPhase = "PLAY_OR_DISCARD" | "DRAW";
export type Phase = "playing" | "gameOver";

export interface LostCitiesState {
  /** Draw pile — top of the deck is the *last* element (pop to draw). */
  deck: Card[];
  /** One discard pile per color — top of each pile is the *last* element. */
  discardPiles: Record<Color, Card[]>;
  hands: Record<Seat, Card[]>;
  /** Cards each seat has played to each color's expedition, in play order (always ascending for number cards, per §4's rule — the array order alone captures the lane's full state). */
  expeditions: Record<Seat, Record<Color, Card[]>>;
  activeSeat: Seat;
  turnPhase: TurnPhase;
  /**
   * The color the active seat discarded to earlier *this same turn*, or null.
   * Only meaningful during that seat's own `DRAW` phase — blocks drawing back
   * the exact card just discarded (§4's "즉시 도로 가져올 수 없다"). Cleared
   * the instant the turn passes to the other seat.
   */
  justDiscardedColor: Color | null;
  turnNumber: number; // 1-based, increments every completed (play/discard + draw) turn
  phase: Phase;
  /** Set once, the instant the deck's last card is drawn (§5) — null while `phase === "playing"`. */
  winner: Seat | null;
  isDraw: boolean;
}

function emptyByColor<T>(fill: () => T): Record<Color, T> {
  return { white: fill(), green: fill(), yellow: fill(), red: fill(), blue: fill() };
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of COLORS) {
    for (let i = 0; i < 3; i++) {
      deck.push({ id: `${color}-inv-${i}`, color, kind: "investment" });
    }
    for (let value = 2; value <= 10; value++) {
      deck.push({ id: `${color}-${value}`, color, kind: "number", value });
    }
  }
  return deck;
}

/**
 * Deals a fresh game: shuffles the 60-card deck, deals 8 cards to each seat,
 * and picks who goes first — all derived from the single injected `rng` so
 * every client in an online room reproduces the identical state from one
 * broadcast seed (ARCHITECTURE.md §1 determinism contract).
 */
export function startGame(rng: () => number = Math.random): LostCitiesState {
  const shuffled = shuffle(buildDeck(), rng);
  const p1Hand = shuffled.slice(0, 8);
  const p2Hand = shuffled.slice(8, 16);
  const deck = shuffled.slice(16);
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    deck,
    discardPiles: emptyByColor<Card[]>(() => []),
    hands: { p1: p1Hand, p2: p2Hand },
    expeditions: { p1: emptyByColor<Card[]>(() => []), p2: emptyByColor<Card[]>(() => []) },
    activeSeat: firstSeat,
    turnPhase: "PLAY_OR_DISCARD",
    justDiscardedColor: null,
    turnNumber: 1,
    phase: "playing",
    winner: null,
    isDraw: false,
  };
}

/** True iff `card` may legally be played onto `seat`'s own `color` expedition lane right now (§4's ascending + investment-before-numbers rules). */
export function canPlayToExpedition(state: LostCitiesState, seat: Seat, card: Card): boolean {
  const lane = state.expeditions[seat][card.color];
  if (card.kind === "investment") {
    return !lane.some((c) => c.kind === "number");
  }
  const lastNumber = [...lane].reverse().find((c) => c.kind === "number");
  return !lastNumber || card.value! > lastNumber.value!;
}

// ---------------------------------------------------------------------------
// Scoring (rulebook §6)
// ---------------------------------------------------------------------------

export interface ExpeditionScoreBreakdown {
  color: Color;
  cardCount: number;
  investCount: number;
  numberSum: number;
  multiplier: number;
  /** `(numberSum - 20) × multiplier`, before the 8-card bonus. Only meaningful when `cardCount > 0`. */
  baseScore: number;
  bonus: number; // 0 or 20
  total: number;
}

export function calculateExpeditionBreakdown(color: Color, cards: readonly Card[]): ExpeditionScoreBreakdown {
  const investCount = cards.filter((c) => c.kind === "investment").length;
  const numberSum = cards.reduce((sum, c) => sum + (c.kind === "number" ? c.value! : 0), 0);
  const multiplier = investCount + 1;
  if (cards.length === 0) {
    return { color, cardCount: 0, investCount: 0, numberSum: 0, multiplier: 1, baseScore: 0, bonus: 0, total: 0 };
  }
  const baseScore = (numberSum - 20) * multiplier;
  const bonus = cards.length >= 8 ? 20 : 0;
  return { color, cardCount: cards.length, investCount, numberSum, multiplier, baseScore, bonus, total: baseScore + bonus };
}

/** Per-color score for one lane — the number every UI breakdown/bot heuristic ultimately reduces to. */
export function calculateExpeditionScore(cards: readonly Card[]): number {
  return calculateExpeditionBreakdown("white", cards).total; // color id unused by the arithmetic itself
}

export function calculateTotalScore(state: LostCitiesState, seat: Seat): number {
  return COLORS.reduce((sum, color) => sum + calculateExpeditionScore(state.expeditions[seat][color]), 0);
}

export function scoreBreakdownForSeat(state: LostCitiesState, seat: Seat): ExpeditionScoreBreakdown[] {
  return COLORS.map((color) => calculateExpeditionBreakdown(color, state.expeditions[seat][color]));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EngineAction =
  | { type: "play-expedition"; cardId: string }
  | { type: "discard"; cardId: string }
  | { type: "draw-deck" }
  | { type: "draw-discard"; color: Color };

function removeFromHand(hand: Card[], cardId: string): { card: Card | null; rest: Card[] } {
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return { card: null, rest: hand };
  const card = hand[idx];
  const rest = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  return { card, rest };
}

/** Finalizes the match the instant the deck's last card is drawn (§5) — computes both seats' final totals once and freezes them into `winner`/`isDraw`. */
function finishGame(state: LostCitiesState): LostCitiesState {
  const p1Total = calculateTotalScore(state, "p1");
  const p2Total = calculateTotalScore(state, "p2");
  return {
    ...state,
    phase: "gameOver",
    winner: p1Total === p2Total ? null : p1Total > p2Total ? "p1" : "p2",
    isDraw: p1Total === p2Total,
  };
}

function applyPlayExpedition(state: LostCitiesState, cardId: string): LostCitiesState {
  if (state.phase !== "playing" || state.turnPhase !== "PLAY_OR_DISCARD") return state;
  const seat = state.activeSeat;
  const { card, rest } = removeFromHand(state.hands[seat], cardId);
  if (!card) return state;
  if (!canPlayToExpedition(state, seat, card)) return state;

  const lane = [...state.expeditions[seat][card.color], card];
  return {
    ...state,
    hands: { ...state.hands, [seat]: rest },
    expeditions: { ...state.expeditions, [seat]: { ...state.expeditions[seat], [card.color]: lane } },
    turnPhase: "DRAW",
    justDiscardedColor: null,
  };
}

function applyDiscard(state: LostCitiesState, cardId: string): LostCitiesState {
  if (state.phase !== "playing" || state.turnPhase !== "PLAY_OR_DISCARD") return state;
  const seat = state.activeSeat;
  const { card, rest } = removeFromHand(state.hands[seat], cardId);
  if (!card) return state;

  const pile = [...state.discardPiles[card.color], card];
  return {
    ...state,
    hands: { ...state.hands, [seat]: rest },
    discardPiles: { ...state.discardPiles, [card.color]: pile },
    turnPhase: "DRAW",
    justDiscardedColor: card.color,
  };
}

function applyDrawDeck(state: LostCitiesState): LostCitiesState {
  if (state.phase !== "playing" || state.turnPhase !== "DRAW") return state;
  if (state.deck.length === 0) return state; // defensive no-op — the game already ends the instant this hits 0 below
  const seat = state.activeSeat;
  const card = state.deck[state.deck.length - 1];
  const deck = state.deck.slice(0, -1);
  const nextState: LostCitiesState = {
    ...state,
    deck,
    hands: { ...state.hands, [seat]: [...state.hands[seat], card] },
  };
  if (deck.length === 0) {
    // §5: the round ends the instant the deck's last card is drawn — no
    // further play, straight to scoring.
    return finishGame(nextState);
  }
  return {
    ...nextState,
    activeSeat: otherSeat(seat),
    turnPhase: "PLAY_OR_DISCARD",
    justDiscardedColor: null,
    turnNumber: state.turnNumber + 1,
  };
}

function applyDrawDiscard(state: LostCitiesState, color: Color): LostCitiesState {
  if (state.phase !== "playing" || state.turnPhase !== "DRAW") return state;
  if (color === state.justDiscardedColor) return state; // §4: can't immediately re-take the card you just discarded this same turn
  const pile = state.discardPiles[color];
  if (pile.length === 0) return state;
  const seat = state.activeSeat;
  const card = pile[pile.length - 1];
  return {
    ...state,
    discardPiles: { ...state.discardPiles, [color]: pile.slice(0, -1) },
    hands: { ...state.hands, [seat]: [...state.hands[seat], card] },
    activeSeat: otherSeat(seat),
    turnPhase: "PLAY_OR_DISCARD",
    justDiscardedColor: null,
    turnNumber: state.turnNumber + 1,
  };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. Illegal actions are no-ops (return `state` unchanged), same defensive idiom every other engine in this project uses. */
export function applyAction(state: LostCitiesState, action: EngineAction): LostCitiesState {
  switch (action.type) {
    case "play-expedition":
      return applyPlayExpedition(state, action.cardId);
    case "discard":
      return applyDiscard(state, action.cardId);
    case "draw-deck":
      return applyDrawDeck(state);
    case "draw-discard":
      return applyDrawDiscard(state, action.color);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Information fairness: every
// input `scoreMove` reads (own hand, own+opponent's *played* expeditions,
// public discard piles, deck count) is already public in this game by rule
// — Lost Cities has no hidden per-seat state beyond hand contents, and the
// bot never reads the opponent's hand.
// ---------------------------------------------------------------------------

export function getValidMoves(state: LostCitiesState, seat: Seat): EngineAction[] {
  if (state.phase !== "playing" || state.activeSeat !== seat) return [];
  if (state.turnPhase === "PLAY_OR_DISCARD") {
    const moves: EngineAction[] = [];
    for (const card of state.hands[seat]) {
      if (canPlayToExpedition(state, seat, card)) moves.push({ type: "play-expedition", cardId: card.id });
      moves.push({ type: "discard", cardId: card.id });
    }
    return moves;
  }
  // DRAW
  const moves: EngineAction[] = [];
  if (state.deck.length > 0) moves.push({ type: "draw-deck" });
  for (const color of COLORS) {
    if (color === state.justDiscardedColor) continue;
    if (state.discardPiles[color].length > 0) moves.push({ type: "draw-discard", color });
  }
  return moves;
}

/**
 * Net score a lane would have *if play stopped here* — used to judge both
 * "should I play this card" and "how good is this discard-pile top card to
 * pick up". Investment cards have no standalone value (they only multiply
 * future number cards), so they're judged by the lane's existing number sum.
 */
function projectedLaneValue(lane: readonly Card[], extra?: Card): number {
  const cards = extra ? [...lane, extra] : lane;
  return calculateExpeditionScore(cards);
}

/** How many more cards of `color` a seat holds in hand beyond the one being considered — a rough signal for "is this lane worth committing to". */
function otherHandCardsOfColor(hand: readonly Card[], color: Color, excludeId: string): Card[] {
  return hand.filter((c) => c.color === color && c.id !== excludeId);
}

export function scoreMove(state: LostCitiesState, seat: Seat, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0; // uniform over every legal move, per the shared novice-tier convention (pieces-of-language, etc.)

  const hand = state.hands[seat];

  if (move.type === "play-expedition") {
    const card = hand.find((c) => c.id === move.cardId)!;
    const lane = state.expeditions[seat][card.color];
    const before = projectedLaneValue(lane);
    const after = projectedLaneValue(lane, card);
    let score = after - before; // marginal swing this single card causes if the lane stopped right here
    if (tier === "expert") {
      // Reward committing when the hand still holds more of the same color
      // to build on (public info: the bot's own hand), and reward closing in
      // on the 8-card bonus threshold.
      const reinforcements = otherHandCardsOfColor(hand, card.color, card.id).length;
      score += reinforcements * 2;
      if (lane.length + 1 >= 6) score += 5; // getting close to the 8-card bonus
    }
    return score;
  }

  if (move.type === "discard") {
    const card = hand.find((c) => c.id === move.cardId)!;
    // Prefer discarding cards least useful to *this* seat: low-value number
    // cards for a lane not worth starting, or investment cards for a color
    // whose hand doesn't otherwise support it. Negated so "least useful"
    // sorts highest.
    const lane = state.expeditions[seat][card.color];
    // If this card isn't even legal to play right now, discarding it costs
    // nothing (0), rather than being scored as either great or terrible.
    const wouldHelp = canPlayToExpedition(state, seat, card) ? projectedLaneValue(lane, card) - projectedLaneValue(lane) : 0;
    let score = -wouldHelp;
    if (tier === "expert") {
      // Slightly avoid feeding the opponent's own expedition — a top-of-pile
      // card the opponent could immediately use is public info (their
      // played lanes are visible), even though their hand isn't.
      const opponent = otherSeat(seat);
      const opponentLane = state.expeditions[opponent][card.color];
      if (canPlayToExpedition(state, opponent, card)) {
        score -= projectedLaneValue(opponentLane, card) - projectedLaneValue(opponentLane);
      }
    }
    return score;
  }

  if (move.type === "draw-deck") {
    return 5; // unknown card — flat baseline every discard-pile draw is compared against
  }

  // draw-discard
  const pile = state.discardPiles[move.color];
  const top = pile[pile.length - 1];
  const lane = state.expeditions[seat][move.color];
  if (!canPlayToExpedition(state, seat, top)) return -5; // dead card for now — worse than an unknown deck draw
  return 5 + (projectedLaneValue(lane, top) - projectedLaneValue(lane));
}

export function chooseBotAction(
  state: LostCitiesState,
  seat: Seat,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
