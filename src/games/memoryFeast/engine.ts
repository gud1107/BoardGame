/**
 * Pure 기억의 만찬 (Memory's Feast) rules engine — no React, no I/O.
 *
 * Adapted from `boardGameRule/기억의만찬/기억의만찬.md` (a Netflix <데스게임>
 * house-rule reconstruction). The source doc left several core mechanics
 * ambiguous; the following were confirmed with the user via AskUserQuestion
 * before this engine was written (see the plan file for the full record):
 *
 *  - The 20 (difficulty-scaled) plates are ONE SHARED board — each plate
 *    tracks how much p1 and p2 have separately poured into it.
 *  - Each player always sees their own contribution to every plate. An
 *    opponent's placement is shown to them only as a brief one-shot "flash"
 *    at the moment it happens (`lastFlash`, consumed client-side) — the
 *    actual `p1Count`/`p2Count` fields are always the true values in state
 *    (same trust trade-off as every other lockstep game here, e.g.
 *    hanamikoji's opponent-hand visibility).
 *  - Open (matching) phase can target ANY plate, but only reveals it to the
 *    guesser — so recalling the opponent's half still matters.
 *  - A successful match deducts the matched total from the GUESSER's own
 *    stock pile (rulebook-literal: "자신의 배치 토큰을 소진"). First to 0
 *    wins. Accumulating enough failed-match penalties loses instead.
 *  - Placement (all rounds) completes fully before the open/guessing phase
 *    begins — the two phases never interleave.
 *
 * Derived (not in the source doc, filled in for a clean digital adaptation):
 *  - One round's entire token allotment goes onto a single chosen plate
 *    (matches the rulebook's own worked example).
 *  - Within a round, p1 places first, then p2.
 *  - A revealed plate teaches its TRUE value to whichever player opened it,
 *    permanently — a failed match still leaves you smarter for next time
 *    (classic "concentration" game information gain), even though the UI
 *    re-covers it for everyone else.
 */

export type Seat = "p1" | "p2";

export function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyConfig {
  plateCount: number;
  /** Placement runs from round 1..totalRounds; round R places R tokens. */
  totalRounds: number;
  /** How long an opponent's placement flash stays on screen before re-covering. */
  flashDurationMs: number;
  /** Open-phase per-guess time limit before an automatic failed guess. */
  timeLimitMs: number;
  /** Accumulated failed-guess penalties at which a player loses outright. */
  penaltyLossThreshold: number;
  /** Whether the board offers a personal (client-only, unsynced) memo pad. */
  allowMemoPad: boolean;
}

export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    plateCount: 12,
    totalRounds: 5,
    flashDurationMs: 3000,
    timeLimitMs: 90_000,
    penaltyLossThreshold: 5,
    allowMemoPad: true,
  },
  normal: {
    plateCount: 16,
    totalRounds: 7,
    flashDurationMs: 2000,
    timeLimitMs: 75_000,
    penaltyLossThreshold: 4,
    allowMemoPad: false,
  },
  hard: {
    plateCount: 20,
    totalRounds: 9,
    flashDurationMs: 1500,
    timeLimitMs: 60_000,
    penaltyLossThreshold: 3,
    allowMemoPad: false,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "normal", "hard"];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움 (원작)",
};

/** Sum of 1..totalRounds — every token a player will place over the whole placement phase, and their starting stock. */
export function totalStock(difficulty: Difficulty): number {
  const { totalRounds } = DIFFICULTY_CONFIG[difficulty];
  return (totalRounds * (totalRounds + 1)) / 2;
}

export interface PlateState {
  p1Count: number;
  p2Count: number;
  revealedTo: Record<Seat, boolean>;
}

function emptyPlate(): PlateState {
  return { p1Count: 0, p2Count: 0, revealedTo: { p1: false, p2: false } };
}

export function plateTotal(plate: PlateState): number {
  return plate.p1Count + plate.p2Count;
}

export interface PlacementFlash {
  seat: Seat;
  plateIndex: number;
  amount: number;
  /** Monotonic, unique per flash — lets the UI re-trigger its animation even if the same plate/amount repeats. */
  seq: number;
}

export type GamePhase = "placement" | "open" | "match-end";

export type LoseReason = "stock" | "penalty" | null;

export interface MemoryFeastState {
  difficulty: Difficulty;
  phase: GamePhase;
  plates: PlateState[];
  /** Current placement round, 1-indexed — also this round's per-plate token amount. Meaningless once phase leaves "placement". */
  round: number;
  /** 0 = p1 hasn't placed yet this round, 1 = p1 has placed, waiting on p2. */
  placerTurn: 0 | 1;
  activePlacer: Seat | null;
  stock: Record<Seat, number>;
  penalties: Record<Seat, number>;
  activeGuesser: Seat | null;
  lastFlash: PlacementFlash | null;
  flashSeq: number;
  /** Bumped on every resolved guess/timeout — lets the UI restart its per-turn countdown even across a "연속 턴" (same guesser again after a success). */
  guessSeq: number;
  winner: Seat | null;
  loseReason: LoseReason;
}

export function startGame(difficulty: Difficulty): MemoryFeastState {
  const { plateCount } = DIFFICULTY_CONFIG[difficulty];
  const stock = totalStock(difficulty);
  return {
    difficulty,
    phase: "placement",
    plates: Array.from({ length: plateCount }, emptyPlate),
    round: 1,
    placerTurn: 0,
    activePlacer: "p1",
    stock: { p1: stock, p2: stock },
    penalties: { p1: 0, p2: 0 },
    activeGuesser: null,
    lastFlash: null,
    flashSeq: 0,
    guessSeq: 0,
    winner: null,
    loseReason: null,
  };
}

function seatKey(seat: Seat): "p1Count" | "p2Count" {
  return seat === "p1" ? "p1Count" : "p2Count";
}

export function placeToken(state: MemoryFeastState, plateIndex: number): MemoryFeastState {
  if (state.phase !== "placement" || !state.activePlacer) return state;
  if (plateIndex < 0 || plateIndex >= state.plates.length) return state;
  const active = state.activePlacer;
  const amount = state.round;
  const key = seatKey(active);

  const plates = state.plates.map((p, i) => (i === plateIndex ? { ...p, [key]: p[key] + amount } : p));
  const flashSeq = state.flashSeq + 1;
  const lastFlash: PlacementFlash = { seat: active, plateIndex, amount, seq: flashSeq };

  const { totalRounds } = DIFFICULTY_CONFIG[state.difficulty];

  if (state.placerTurn === 0) {
    // p1 just placed; p2 goes next, same round.
    return { ...state, plates, lastFlash, flashSeq, placerTurn: 1, activePlacer: other(active) };
  }

  // p2 just placed; round is complete.
  if (state.round >= totalRounds) {
    return {
      ...state,
      plates,
      lastFlash,
      flashSeq,
      placerTurn: 0,
      activePlacer: null,
      phase: "open",
      activeGuesser: "p1",
    };
  }
  return {
    ...state,
    plates,
    lastFlash,
    flashSeq,
    round: state.round + 1,
    placerTurn: 0,
    activePlacer: "p1",
  };
}

function revealBoth(plates: PlateState[], plateA: number, plateB: number, to: Seat): PlateState[] {
  return plates.map((p, i) => (i === plateA || i === plateB ? { ...p, revealedTo: { ...p.revealedTo, [to]: true } } : p));
}

function revealForBothSeats(plates: PlateState[], plateA: number, plateB: number): PlateState[] {
  return plates.map((p, i) =>
    i === plateA || i === plateB ? { ...p, revealedTo: { p1: true, p2: true } } : p,
  );
}

export function guess(state: MemoryFeastState, plateA: number, plateB: number): MemoryFeastState {
  if (state.phase !== "open" || !state.activeGuesser) return state;
  if (plateA === plateB) return state;
  const count = state.plates.length;
  if (plateA < 0 || plateA >= count || plateB < 0 || plateB >= count) return state;

  const guesser = state.activeGuesser;
  const totalA = plateTotal(state.plates[plateA]);
  const totalB = plateTotal(state.plates[plateB]);
  const guessSeq = state.guessSeq + 1;

  if (totalA === totalB) {
    const plates = revealForBothSeats(state.plates, plateA, plateB);
    const nextStock = Math.max(0, state.stock[guesser] - totalA);
    const stock = { ...state.stock, [guesser]: nextStock };
    if (nextStock === 0) {
      return {
        ...state,
        plates,
        stock,
        guessSeq,
        phase: "match-end",
        winner: guesser,
        loseReason: "stock",
        activeGuesser: null,
      };
    }
    // Match success grants an extra (연속) turn — same guesser continues.
    return { ...state, plates, stock, guessSeq };
  }

  // Failed match: only the guesser personally learns the true values.
  const plates = revealBoth(state.plates, plateA, plateB, guesser);
  const penalties = { ...state.penalties, [guesser]: state.penalties[guesser] + 1 };
  const { penaltyLossThreshold } = DIFFICULTY_CONFIG[state.difficulty];
  if (penalties[guesser] >= penaltyLossThreshold) {
    return {
      ...state,
      plates,
      penalties,
      guessSeq,
      phase: "match-end",
      winner: other(guesser),
      loseReason: "penalty",
      activeGuesser: null,
    };
  }
  return { ...state, plates, penalties, guessSeq, activeGuesser: other(guesser) };
}

/** A guesser who let the per-turn timer run out — counts as a failed guess with nothing revealed. */
export function timeoutFail(state: MemoryFeastState): MemoryFeastState {
  if (state.phase !== "open" || !state.activeGuesser) return state;
  const guesser = state.activeGuesser;
  const guessSeq = state.guessSeq + 1;
  const penalties = { ...state.penalties, [guesser]: state.penalties[guesser] + 1 };
  const { penaltyLossThreshold } = DIFFICULTY_CONFIG[state.difficulty];
  if (penalties[guesser] >= penaltyLossThreshold) {
    return {
      ...state,
      penalties,
      guessSeq,
      phase: "match-end",
      winner: other(guesser),
      loseReason: "penalty",
      activeGuesser: null,
    };
  }
  return { ...state, penalties, guessSeq, activeGuesser: other(guesser) };
}

/**
 * Every state transition a player (or the client-local turn timer) can
 * trigger, as a serializable message broadcast between the two clients —
 * see hanamikoji's `EngineAction` for the same convention. Unlike several
 * other games here, no action needs a seed: nothing about setup or dealing
 * is randomized (every plate starts empty and placement is entirely
 * player-chosen), so `startGame` takes no rng.
 */
export type EngineAction =
  | { type: "place"; plateIndex: number }
  | { type: "guess"; plateA: number; plateB: number }
  | { type: "timeout-fail" };

/** Single entry point applying any `EngineAction` to a state. */
export function applyAction(state: MemoryFeastState, action: EngineAction): MemoryFeastState {
  switch (action.type) {
    case "place":
      return placeToken(state, action.plateIndex);
    case "guess":
      return guess(state, action.plateA, action.plateB);
    case "timeout-fail":
      return timeoutFail(state);
    default:
      return state;
  }
}

/** Whose decision is pending right now, for `useBotAutoplay`/idle-vote polling — mirrors `getValidMoves`'s own gating. */
export function memoryFeastCurrentActor(state: MemoryFeastState): Seat | null {
  if (state.phase === "placement") return state.activePlacer;
  if (state.phase === "open") return state.activeGuesser;
  return null;
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves + chooseBotAction.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/** All unordered pairs of plate indices [0, count). */
function platePairs(count: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) pairs.push([a, b]);
  }
  return pairs;
}

export function getValidMoves(state: MemoryFeastState, seat: Seat): EngineAction[] {
  if (state.phase === "placement") {
    if (state.activePlacer !== seat) return [];
    return state.plates.map((_, i) => ({ type: "place", plateIndex: i }) as EngineAction);
  }
  if (state.phase === "open") {
    if (state.activeGuesser !== seat) return [];
    return platePairs(state.plates.length).map(
      ([a, b]) => ({ type: "guess", plateA: a, plateB: b }) as EngineAction,
    );
  }
  return [];
}

/**
 * Placement heuristic: novice/core bots mostly avoid piling onto a plate
 * they've already used a lot (spreads their own risk thin, harder for the
 * opponent to memorize a single hot spot) — expert bots weigh this more
 * strongly. The Level 1-10 noise curve (`pickByLevel`) is what actually
 * turns this into "sometimes plays badly at low levels".
 */
function scorePlacement(state: MemoryFeastState, seat: Seat, plateIndex: number, level: BotLevel): number {
  const plate = state.plates[plateIndex];
  const selfSoFar = seat === "p1" ? plate.p1Count : plate.p2Count;
  const weight = botTier(level) === "expert" ? 1.5 : 1;
  return -selfSoFar * weight;
}

/**
 * Guessing heuristic: the bot reasons over the TRUE board state (same trust
 * trade-off as every other lockstep-game bot here, e.g. hanamikoji) — an
 * actual match scores far above any non-match, and among non-matches a
 * closer total is still mildly preferred (a more "informative" reveal).
 * Levels 1-10's built-in mistake-rate/tie-margin curve (`pickByLevel`) is
 * what makes weaker bots miss matches a real human with imperfect memory
 * would also miss — this module doesn't need its own separate noise model.
 */
function scoreGuess(state: MemoryFeastState, plateA: number, plateB: number): number {
  const totalA = plateTotal(state.plates[plateA]);
  const totalB = plateTotal(state.plates[plateB]);
  if (totalA === totalB) return 1000 + totalA;
  return -Math.abs(totalA - totalB);
}

function scoreMove(state: MemoryFeastState, seat: Seat, move: EngineAction, level: BotLevel): number {
  if (move.type === "place") return scorePlacement(state, seat, move.plateIndex, level);
  if (move.type === "guess") return scoreGuess(state, move.plateA, move.plateB);
  return 0;
}

export function chooseBotAction(
  state: MemoryFeastState,
  seat: Seat,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}
