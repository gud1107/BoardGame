/**
 * Pure "운명전쟁39" rules engine — no React, no I/O. Implements the rulebook
 * at boardGameRule/운명전쟁39/운명전쟁39.md (Version 2.2, 공식 확정본).
 *
 * Same online-multiplayer trust model as every other game in this project
 * (see Coyote/Avalon's module docs): every connected client independently
 * computes the FULL state from a shared RNG seed plus replayed
 * `EngineAction`s — there is no server-authoritative engine. Hidden
 * predictions are never actually hidden inside `DestinyWar39State` itself;
 * secrecy is enforced only at the read layer via `visibleCurrentPrediction`/
 * `visiblePastPrediction` below, exactly like Coyote's `getPlayerView`.
 *
 * Core structure (all confirmed via extensive back-and-forth with the
 * product owner — see the rulebook's §0 changelog):
 *  - Four selectable player counts, 5/6/7/8 (rulebook §2) — chosen once at
 *    room creation (same `startGame(playerCount, seed)` + host-picks-target
 *    pattern as coup/engine.ts), fixed for the whole game. 9 rounds either
 *    way. Round R deals each player R cards (freshly reshuffled from the
 *    mode's full deck every round — nothing is ever discarded) and consists
 *    of R turns. A turn = all `playerCount` players reveal one card; a
 *    round's "actual win count" is how many of its R turns a player won
 *    (0..R).
 *  - Round 1 is simultaneous reveal (no lead order). From round 2 on, each
 *    turn's winner immediately becomes the next turn's leader — this chains
 *    across round boundaries too (round R's turn-1 leader = round R-1's
 *    last-turn winner), so there is no separate "round winner" concept.
 *  - Turn resolution: reverse is active iff the count of reverse cards
 *    (multiples of 11 up to the mode's max number — 11/22/33 for 5-player,
 *    11/22/33/44 for 6-player, 11/22/33/44/55 for 7- and 8-player) among
 *    that turn's cards is odd. Death card is normally the strongest card
 *    but loses outright to 0 when reverse is inactive — that counter is
 *    narrowly scoped to the Death-vs-0 matchup only: with reverse inactive
 *    and no Death in play, 0 is just the weakest ordinary number (highest
 *    number wins as usual). When reverse is active the Death/0 exception is
 *    cancelled and Death is strongest again (beats 0 too), and 0 becomes
 *    the strongest ordinary number (lowest value wins). Ties are only
 *    possible among 0 cards (every other number value is unique in the
 *    deck) or, in 8-player mode only (the sole mode with 2 Death cards),
 *    among the deck's Death cards if both land in the same turn — both
 *    cases break by whoever revealed earliest (product owner's explicit
 *    call: same convention as the 0-tie rule) — the fixed random seat order
 *    for round 1's simultaneous reveal, or the turn's actual reveal
 *    sequence otherwise.
 *  - Each player predicts a fresh win count (0..R) every round, independent
 *    of prior rounds. Score per round: P>=1 → success +P*2 / fail
 *    -|P-A|*2 (R irrelevant). P==0 → success +R / fail -R.
 *  - Hidden: each player may use it at most once across the whole game, on
 *    any round of their choosing; the prediction is still locked in before
 *    that round's turns start, just not shown to opponents until the game
 *    ends (all 9 rounds resolved).
 *  - Final ranking: sum of the 9 per-round scores, highest wins; ties share
 *    the same rank (standard "competition ranking" — no tiebreaker).
 */

export type SeatIndex = number;

export const TOTAL_ROUNDS = 9;

/** The four selectable table sizes (rulebook §2) — chosen once at room creation, fixed for the whole game. */
export const SUPPORTED_PLAYER_COUNTS = [5, 6, 7, 8] as const;
export type PlayerCount = (typeof SUPPORTED_PLAYER_COUNTS)[number];
export const DEFAULT_PLAYER_COUNT: PlayerCount = 5;
export const MIN_PLAYERS: PlayerCount = 5;
export const MAX_PLAYERS: PlayerCount = 8;

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

// ---------------------------------------------------------------------------
// Deck (rulebook §3) — per-mode composition, deck size always
// playerCount × TOTAL_ROUNDS (round 9 deals the full deck out with nothing
// left over): 5-player = 45 cards (0×5, 1..39×1, Death×1), 6-player = 54
// cards (0×6, 1..47×1, Death×1), 7-player = 63 cards (0×7, 1..55×1,
// Death×1), 8-player = 72 cards (0×8, 1..62×1, Death×2).
// ---------------------------------------------------------------------------

export type CardKind = "number" | "death";

export interface Card {
  id: number;
  kind: CardKind;
  /** Meaningful only for kind === "number" (0..maxNumber for the mode); unused (-1) for "death". */
  value: number;
}

export interface DeckModeConfig {
  playerCount: PlayerCount;
  zeroCount: number;
  deathCount: number;
  /** Highest ordinary number card in the deck (1..maxNumber, one of each). */
  maxNumber: number;
}

const DECK_MODE_CONFIG: Record<PlayerCount, DeckModeConfig> = {
  5: { playerCount: 5, zeroCount: 5, deathCount: 1, maxNumber: 39 },
  6: { playerCount: 6, zeroCount: 6, deathCount: 1, maxNumber: 47 },
  7: { playerCount: 7, zeroCount: 7, deathCount: 1, maxNumber: 55 },
  8: { playerCount: 8, zeroCount: 8, deathCount: 2, maxNumber: 62 },
};

export function deckModeConfig(playerCount: PlayerCount): DeckModeConfig {
  return DECK_MODE_CONFIG[playerCount];
}

/** Reverse cards are every multiple of 11 up to the mode's max number — 11/22/33 for 5-player (max 39), plus 44/55 for 8-player (max 62). */
export function reverseValuesFor(playerCount: PlayerCount): number[] {
  const { maxNumber } = deckModeConfig(playerCount);
  const values: number[] = [];
  for (let v = 11; v <= maxNumber; v += 11) values.push(v);
  return values;
}

/** 11/22/33(/44/55 in 8-player mode) are ordinary number cards that also count toward that turn's reverse parity (rulebook §3, §6.1). */
export function isReverseCard(card: Card, playerCount: PlayerCount): boolean {
  if (card.kind !== "number" || card.value === 0) return false;
  return card.value % 11 === 0 && card.value <= deckModeConfig(playerCount).maxNumber;
}

export function buildDeck(playerCount: PlayerCount = DEFAULT_PLAYER_COUNT): Card[] {
  const { zeroCount, deathCount, maxNumber } = deckModeConfig(playerCount);
  const cards: Card[] = [];
  let id = 0;
  for (let i = 0; i < zeroCount; i++) cards.push({ id: id++, kind: "number", value: 0 });
  for (let v = 1; v <= maxNumber; v++) cards.push({ id: id++, kind: "number", value: v });
  for (let i = 0; i < deathCount; i++) cards.push({ id: id++, kind: "death", value: -1 });
  return cards;
}

export function deckSizeFor(playerCount: PlayerCount): number {
  return buildDeck(playerCount).length;
}

/** Kept for the classic 5-player mode (still `45`, verified in DestinyWar39.test.ts). Use `deckSizeFor` for other modes. */
export const DECK_SIZE = deckSizeFor(DEFAULT_PLAYER_COUNT);

// ---------------------------------------------------------------------------
// Scoring (rulebook §9 — confirmed formula, do not alter without re-checking
// the §9.2 test vectors). Player-count independent — only R, P, A matter.
// ---------------------------------------------------------------------------

export function scoreRound(prediction: number, actual: number, roundNumber: number): number {
  if (prediction === 0) {
    return actual === 0 ? roundNumber : -roundNumber;
  }
  if (prediction === actual) return prediction * 2;
  return -Math.abs(prediction - actual) * 2;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerRecord {
  seat: SeatIndex;
  hiddenUsed: boolean;
  /** 1-indexed round the lifetime hidden token was spent on, or null if unused. */
  hiddenRound: number | null;
  /** Index r (0-based) holds round (r+1)'s prediction, filled in once that round finishes. */
  predictions: (number | null)[];
  /** Index r holds whether round (r+1)'s prediction was submitted via hidden. */
  hidden: boolean[];
  /** Index r holds round (r+1)'s actual win count (0..r+1). */
  actualWins: (number | null)[];
  /** Index r holds round (r+1)'s scoreRound() result. */
  scores: (number | null)[];
}

export interface TurnPlay {
  seat: SeatIndex;
  card: Card;
}

export interface TurnRecord {
  turnNumber: number;
  /** All `playerCount` plays, in reveal order (see resolveTurn's revealOrder param). */
  plays: TurnPlay[];
  reverseActive: boolean;
  winnerSeat: SeatIndex;
}

export interface RoundState {
  roundNumber: number;
  /** Each seat's remaining (unplayed) cards for this round — starts at length roundNumber, shrinks by 1 per turn played. */
  hands: Record<SeatIndex, Card[]>;
  predictions: Record<SeatIndex, number | null>;
  hiddenThisRound: Record<SeatIndex, boolean>;
  turnNumber: number;
  /** Who reveals first this turn. Meaningless for roundNumber === 1 (simultaneous reveal). */
  turnLeader: SeatIndex;
  playsThisTurn: TurnPlay[];
  turnRecords: TurnRecord[];
  winsThisRound: Record<SeatIndex, number>;
}

export type Phase = "predicting" | "playing" | "roundEnd" | "gameOver";

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
}

export interface DestinyWar39State {
  phase: Phase;
  /** Table size chosen at room creation (rulebook §2) — fixed for the whole game. */
  playerCount: PlayerCount;
  /** Fixed clockwise seating, randomized once at game start — doubles as round 1's tie-break priority order (rulebook §5.1, §6.3). */
  seatOrder: SeatIndex[];
  round: RoundState;
  players: PlayerRecord[];
  finalScores: Record<SeatIndex, number> | null;
  finalRankings: RankedSeat[] | null;
  /**
   * Snapshot of the most recently *completed* round (all its `turnRecords`
   * included), kept around after `nextRound`/game-over moves `round` on to
   * the next one — the sole source for the UI's "직전 라운드 카드 조합"
   * history view, so it stays inspectable at any point in the following
   * round instead of vanishing the instant dealing resets `round`. Null
   * only before round 1 has finished.
   */
  lastCompletedRound: RoundState | null;
}

export type EngineAction =
  | { type: "predict"; seat: SeatIndex; value: number; hidden: boolean }
  | { type: "play"; seat: SeatIndex; cardId: number }
  | { type: "nextRound"; seed: number };

// ---------------------------------------------------------------------------
// Setup / dealing (rulebook §4.1 — full-deck reshuffle every round, no discard)
// ---------------------------------------------------------------------------

function dealRound(roundNumber: number, rng: () => number, playerCount: PlayerCount): Record<SeatIndex, Card[]> {
  const deck = shuffle(buildDeck(playerCount), rng);
  const hands: Record<SeatIndex, Card[]> = {};
  let idx = 0;
  for (let seat = 0; seat < playerCount; seat++) {
    hands[seat] = deck.slice(idx, idx + roundNumber);
    idx += roundNumber;
  }
  return hands;
}

function freshRound(roundNumber: number, rng: () => number, turnLeader: SeatIndex, playerCount: PlayerCount): RoundState {
  const hands = dealRound(roundNumber, rng, playerCount);
  const predictions: Record<SeatIndex, number | null> = {};
  const hiddenThisRound: Record<SeatIndex, boolean> = {};
  const winsThisRound: Record<SeatIndex, number> = {};
  for (let seat = 0; seat < playerCount; seat++) {
    predictions[seat] = null;
    hiddenThisRound[seat] = false;
    winsThisRound[seat] = 0;
  }
  return {
    roundNumber,
    hands,
    predictions,
    hiddenThisRound,
    turnNumber: 1,
    turnLeader,
    playsThisTurn: [],
    turnRecords: [],
    winsThisRound,
  };
}

export function startGame(playerCount: PlayerCount, seed: number): DestinyWar39State {
  const rng = seededRng(seed);
  const seatOrder = shuffle(
    Array.from({ length: playerCount }, (_, i) => i),
    rng,
  );
  // Round 1 is simultaneous — turnLeader is set but unused (see `play` below).
  const round = freshRound(1, rng, seatOrder[0], playerCount);
  const players: PlayerRecord[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    hiddenUsed: false,
    hiddenRound: null,
    predictions: Array(TOTAL_ROUNDS).fill(null),
    hidden: Array(TOTAL_ROUNDS).fill(false),
    actualWins: Array(TOTAL_ROUNDS).fill(null),
    scores: Array(TOTAL_ROUNDS).fill(null),
  }));
  return {
    phase: "predicting",
    playerCount,
    seatOrder,
    round,
    players,
    finalScores: null,
    finalRankings: null,
    lastCompletedRound: null,
  };
}

// ---------------------------------------------------------------------------
// Turn resolution (rulebook §6)
// ---------------------------------------------------------------------------

function computeReverseActive(plays: TurnPlay[], playerCount: PlayerCount): boolean {
  const count = plays.filter((p) => isReverseCard(p.card, playerCount)).length;
  return count % 2 === 1;
}

/** Earliest-in-`order` seat among `candidates` — used to break 0-card ties, and (8-player mode only) Death-card ties. */
function firstByOrder(candidates: TurnPlay[], order: SeatIndex[]): SeatIndex {
  for (const seat of order) {
    const found = candidates.find((p) => p.seat === seat);
    if (found) return found.seat;
  }
  return candidates[0].seat; // unreachable given non-empty candidates and a full seat order, kept as a safe fallback
}

export interface TurnOutcome {
  reverseActive: boolean;
  winnerSeat: SeatIndex;
}

/**
 * §6.2's decision table. `revealOrder` is the reference order used to break
 * ties (§6.3) — the round 1 fixed seat order for simultaneous reveals, or
 * that turn's actual sequential reveal order otherwise.
 *
 * The 0-vs-Death counter is narrowly scoped: 0 only beats Death, never
 * ordinary numbers. With reverse inactive and no Death in play, 0 is just
 * the weakest ordinary number and loses to whatever is highest (e.g. 35
 * beats 0). Reverse flips the ordinary-number comparison (lowest wins),
 * which is what makes 0 the strongest *ordinary* card once reverse is
 * active — that is a side effect of the flip, not a separate 0 rule.
 *
 * 8-player mode ships 2 Death cards, so two different players can reveal
 * Death in the same turn — a situation the 5-player rulebook never had to
 * cover. Confirmed with the product owner: it resolves exactly like a
 * multi-0 tie (§6.3) — whoever revealed Death earliest in `revealOrder`
 * wins, whether Death is winning outright (reverse active, or reverse
 * inactive with no 0 in play) or off the board entirely (reverse inactive
 * with a 0 present, which still just goes to that 0's own §6.3 tie-break).
 */
export function resolveTurn(plays: TurnPlay[], revealOrder: SeatIndex[], playerCount: PlayerCount): TurnOutcome {
  const reverseActive = computeReverseActive(plays, playerCount);
  const zeroPlays = plays.filter((p) => p.card.kind === "number" && p.card.value === 0);
  const deathPlays = plays.filter((p) => p.card.kind === "death");
  const numberPlays = plays.filter((p) => p.card.kind === "number");

  let winnerSeat: SeatIndex;
  if (!reverseActive) {
    if (deathPlays.length > 0) {
      // 0's sole counter: beats Death specifically, even though 0 is
      // otherwise the weakest ordinary number in this (non-reverse) state.
      if (zeroPlays.length > 0) {
        winnerSeat = firstByOrder(zeroPlays, revealOrder);
      } else {
        winnerSeat = deathPlays.length > 1 ? firstByOrder(deathPlays, revealOrder) : deathPlays[0].seat;
      }
    } else {
      const maxValue = Math.max(...numberPlays.map((p) => p.card.value));
      winnerSeat = numberPlays.find((p) => p.card.value === maxValue)!.seat;
    }
  } else {
    if (deathPlays.length > 0) {
      winnerSeat = deathPlays.length > 1 ? firstByOrder(deathPlays, revealOrder) : deathPlays[0].seat;
    } else {
      const minValue = Math.min(...numberPlays.map((p) => p.card.value));
      const minPlays = numberPlays.filter((p) => p.card.value === minValue);
      winnerSeat = minPlays.length > 1 ? firstByOrder(minPlays, revealOrder) : minPlays[0].seat;
    }
  }
  return { reverseActive, winnerSeat };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setAt<T>(arr: T[], i: number, v: T): T[] {
  const copy = [...arr];
  copy[i] = v;
  return copy;
}

/** "예측 결정" (rulebook §7) — once per seat per round, value must be 0..roundNumber. Hidden requires the lifetime token to still be unspent. */
function predict(state: DestinyWar39State, seat: SeatIndex, value: number, hidden: boolean): DestinyWar39State {
  if (state.phase !== "predicting") return state;
  const round = state.round;
  if (round.predictions[seat] !== null) return state;
  if (!Number.isInteger(value) || value < 0 || value > round.roundNumber) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || (hidden && player.hiddenUsed)) return state;

  const predictions = { ...round.predictions, [seat]: value };
  const hiddenThisRound = { ...round.hiddenThisRound, [seat]: hidden };
  const players = hidden
    ? state.players.map((p) => (p.seat === seat ? { ...p, hiddenUsed: true, hiddenRound: round.roundNumber } : p))
    : state.players;

  const allSubmitted = Object.values(predictions).every((v) => v !== null);
  return {
    ...state,
    round: { ...round, predictions, hiddenThisRound },
    players,
    phase: allSubmitted ? "playing" : "predicting",
  };
}

/** Fixed-order helper: the first seat in `seatOrder` starting from `from` that isn't in `exclude`. */
function clockwiseFrom(seatOrder: SeatIndex[], from: SeatIndex, exclude: ReadonlySet<SeatIndex>): SeatIndex {
  const startIdx = seatOrder.indexOf(from);
  for (let i = 0; i < seatOrder.length; i++) {
    const candidate = seatOrder[(startIdx + i) % seatOrder.length];
    if (!exclude.has(candidate)) return candidate;
  }
  return from; // unreachable once at least one seat is un-excluded
}

/** Whose turn it is to reveal, or null once everyone's revealed this turn. Round 1 has no fixed order (any not-yet-played seat may act) — callers needing a single actor (bot autoplay) should instead scan seats in order, same convention Avalon's simultaneous-vote phase uses. */
export function nextToActInTurn(state: DestinyWar39State): SeatIndex | null {
  if (state.phase !== "playing") return null;
  const round = state.round;
  const played = new Set(round.playsThisTurn.map((p) => p.seat));
  if (played.size >= state.playerCount) return null;
  if (round.roundNumber === 1) {
    for (let s = 0; s < state.playerCount; s++) if (!played.has(s)) return s;
    return null;
  }
  return clockwiseFrom(state.seatOrder, round.turnLeader, played);
}

/** "카드 선택→공개" (rulebook §4.2, §5, §6). */
function play(state: DestinyWar39State, seat: SeatIndex, cardId: number): DestinyWar39State {
  if (state.phase !== "playing") return state;
  const round = state.round;
  if (round.playsThisTurn.some((p) => p.seat === seat)) return state;
  if (round.roundNumber >= 2) {
    const played = new Set(round.playsThisTurn.map((p) => p.seat));
    const acting = clockwiseFrom(state.seatOrder, round.turnLeader, played);
    if (seat !== acting) return state;
  }
  const hand = round.hands[seat];
  const card = hand?.find((c) => c.id === cardId);
  if (!card) return state;

  const hands = { ...round.hands, [seat]: hand.filter((c) => c.id !== cardId) };
  const playsThisTurn = [...round.playsThisTurn, { seat, card }];

  if (playsThisTurn.length < state.playerCount) {
    return { ...state, round: { ...round, hands, playsThisTurn } };
  }
  return resolveTurnAndAdvance(state, { ...round, hands, playsThisTurn });
}

/** Completes the just-finished turn, then either starts the round's next turn or finalizes the round (rulebook §5.3, §6, §9, §11). */
function resolveTurnAndAdvance(state: DestinyWar39State, round: RoundState): DestinyWar39State {
  const revealOrder = round.roundNumber === 1 ? state.seatOrder : round.playsThisTurn.map((p) => p.seat);
  const { reverseActive, winnerSeat } = resolveTurn(round.playsThisTurn, revealOrder, state.playerCount);

  const winsThisRound = { ...round.winsThisRound, [winnerSeat]: (round.winsThisRound[winnerSeat] ?? 0) + 1 };
  const turnRecords = [...round.turnRecords, { turnNumber: round.turnNumber, plays: round.playsThisTurn, reverseActive, winnerSeat }];

  if (round.turnNumber < round.roundNumber) {
    return {
      ...state,
      round: { ...round, turnNumber: round.turnNumber + 1, turnLeader: winnerSeat, playsThisTurn: [], turnRecords, winsThisRound },
    };
  }

  // Round complete — fold this round's prediction/actual/score into each player's permanent record.
  const R = round.roundNumber;
  const players = state.players.map((p) => {
    const A = winsThisRound[p.seat] ?? 0;
    const P = round.predictions[p.seat]!;
    const score = scoreRound(P, A, R);
    return {
      ...p,
      predictions: setAt(p.predictions, R - 1, P),
      hidden: setAt(p.hidden, R - 1, round.hiddenThisRound[p.seat]),
      actualWins: setAt(p.actualWins, R - 1, A),
      scores: setAt(p.scores, R - 1, score),
    };
  });
  const finishedRound: RoundState = { ...round, turnRecords, winsThisRound };

  if (R === TOTAL_ROUNDS) {
    const finalScores: Record<SeatIndex, number> = {};
    for (const p of players) finalScores[p.seat] = p.scores.reduce((sum: number, v) => sum + (v ?? 0), 0);
    return {
      ...state,
      round: finishedRound,
      players,
      phase: "gameOver",
      finalScores,
      finalRankings: computeRankings(finalScores),
      lastCompletedRound: finishedRound,
    };
  }
  return { ...state, round: finishedRound, players, phase: "roundEnd", lastCompletedRound: finishedRound };
}

/** Deals the next round (needs a fresh seed since dealing must stay a pure function of the broadcast action for online lockstep sync — see Coyote's `continueRound` for the same pattern). Any connected client may trigger this from the "roundEnd" summary screen. */
function nextRound(state: DestinyWar39State, seed: number): DestinyWar39State {
  if (state.phase !== "roundEnd") return state;
  const rng = seededRng(seed);
  const lastTurn = state.round.turnRecords[state.round.turnRecords.length - 1];
  const round = freshRound(state.round.roundNumber + 1, rng, lastTurn.winnerSeat, state.playerCount);
  return { ...state, round, phase: "predicting" };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: DestinyWar39State, action: EngineAction): DestinyWar39State {
  switch (action.type) {
    case "predict":
      return predict(state, action.seat, action.value, action.hidden);
    case "play":
      return play(state, action.seat, action.cardId);
    case "nextRound":
      return nextRound(state, action.seed);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hidden-prediction secrecy (rulebook §8, §12) — nothing is ever actually
// hidden inside `DestinyWar39State`; these projections redact it at read
// time, exactly like Coyote's `getPlayerView`.
// ---------------------------------------------------------------------------

export type VisiblePrediction = number | "hidden" | "pending";

/** The current (in-progress) round's prediction for `targetSeat`, as `viewerSeat` is allowed to see it right now. */
export function visibleCurrentPrediction(state: DestinyWar39State, viewerSeat: SeatIndex, targetSeat: SeatIndex): VisiblePrediction {
  const value = state.round.predictions[targetSeat];
  if (value === null) return "pending";
  if (!state.round.hiddenThisRound[targetSeat]) return value;
  if (targetSeat === viewerSeat) return value;
  return "hidden";
}

/** A already-finished round's prediction for `targetSeat` (1-indexed `roundNumber`), as `viewerSeat` is allowed to see it. Hidden predictions stay redacted until `state.phase === "gameOver"` (rulebook §8: "게임의 모든 결과가 전부 공개된 시점"). */
export function visiblePastPrediction(
  state: DestinyWar39State,
  viewerSeat: SeatIndex,
  targetSeat: SeatIndex,
  roundNumber: number,
): VisiblePrediction {
  const player = state.players.find((p) => p.seat === targetSeat)!;
  const idx = roundNumber - 1;
  const value = player.predictions[idx];
  if (value === null) return "pending";
  if (!player.hidden[idx] || targetSeat === viewerSeat || state.phase === "gameOver") return value;
  return "hidden";
}

// ---------------------------------------------------------------------------
// Final rankings (rulebook §10 — co-rank, no tiebreaker)
// ---------------------------------------------------------------------------

export function computeRankings(finalScores: Record<SeatIndex, number>): RankedSeat[] {
  const seats = Object.keys(finalScores).map(Number);
  return seats
    .map((seat) => ({
      seat,
      rank: 1 + seats.filter((other) => finalScores[other] > finalScores[seat]).length,
    }))
    .sort((a, b) => a.rank - b.rank || a.seat - b.seat);
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7.1) — Levels 1-10 route through the
// shared `pickByLevel` noise curve on top of `scoreMove` below.
//
// Documented simplification: bots never use their lifetime hidden token
// (`getValidMoves` only ever offers `hidden: false` predictions). Hidden is
// an optional strategic layer, not required to play a legal/complete game —
// a bot that always predicts openly is still a fully valid opponent.
// ---------------------------------------------------------------------------

import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/** Rough 0..1 "how likely this card is to win a turn against unknown opponents" proxy — ignores reverse dynamics entirely (documented simplification; still gives bots a sane death/high-number/0 preference ordering). Normalized against the mode's max number card so it stays 0..1 in both 5- and 8-player decks. */
function cardStrength(card: Card, playerCount: PlayerCount): number {
  if (card.kind === "death") return 1; // strongest overall in the common (non-reverse) case; the 0 counter is rare and ignored by this proxy
  if (card.value === 0) return 0; // weakest ordinary number outside its narrow Death-counter upside, which this proxy ignores
  return card.value / deckModeConfig(playerCount).maxNumber;
}

function estimatedWinsForHand(hand: Card[], playerCount: PlayerCount): number {
  return hand.reduce((sum, c) => sum + Math.pow(cardStrength(c, playerCount), 4), 0);
}

export function getValidMoves(state: DestinyWar39State, seat: SeatIndex): EngineAction[] {
  if (state.phase === "predicting") {
    if (state.round.predictions[seat] !== null) return [];
    const R = state.round.roundNumber;
    return Array.from({ length: R + 1 }, (_, value) => ({ type: "predict" as const, seat, value, hidden: false }));
  }
  if (state.phase === "playing") {
    const round = state.round;
    if (round.playsThisTurn.some((p) => p.seat === seat)) return [];
    if (round.roundNumber >= 2) {
      const played = new Set(round.playsThisTurn.map((p) => p.seat));
      const acting = clockwiseFrom(state.seatOrder, round.turnLeader, played);
      if (seat !== acting) return [];
    }
    return (round.hands[seat] ?? []).map((c) => ({ type: "play" as const, seat, cardId: c.id }));
  }
  return [];
}

function scoreMove(state: DestinyWar39State, seat: SeatIndex, move: EngineAction): number {
  if (move.type === "predict") {
    const estimate = estimatedWinsForHand(state.round.hands[seat] ?? [], state.playerCount);
    return -Math.abs(move.value - estimate);
  }
  if (move.type === "play") {
    const round = state.round;
    const card = round.hands[seat].find((c) => c.id === move.cardId)!;
    const strength = cardStrength(card, state.playerCount);
    const currentWins = round.winsThisRound[seat] ?? 0;
    const prediction = round.predictions[seat] ?? 0;
    const remainingTurns = round.roundNumber - round.turnNumber + 1;
    const needed = prediction - currentWins;

    if (needed <= 0) return -strength; // prediction already met (or blown) — try to lose the rest
    if (needed >= remainingTurns) return strength; // must win every remaining turn — play strongest
    const targetPercentile = needed / remainingTurns;
    return -Math.abs(strength - targetPercentile); // aim for a "medium" card matching the needed win rate
  }
  return 0;
}

/** getValidMoves 중 level(1~10)에 맞는 액션을 고른다 — 점수 매기기+노이즈는 botDifficulty.ts의 공용 커브. seat가 지금 할 게 없으면 null. */
export function chooseBotAction(
  state: DestinyWar39State,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move) }));
  return pickByLevel(scored, level, rng);
}
