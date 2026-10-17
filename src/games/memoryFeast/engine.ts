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
 *  - Scoring (2026-10-07 rework, replacing the original "first to empty
 *    your own stock" race): a successful match CLAIMS both plates for the
 *    guesser and scores every token on them. Claimed plates leave play, so
 *    the same pair can never score twice. The match ends once no two
 *    unclaimed, non-empty plates share a total; higher score wins, fewer
 *    penalties breaks a tie, otherwise it's a draw. Accumulating enough
 *    failed-match penalties still loses outright.
 *    Why the rework: the stock race was only winnable because matched
 *    plates stayed selectable (re-matching one known pair drained the
 *    whole stock). Without that loophole, all disjoint equal pairs together
 *    hold only ~half of the two players' combined tokens, so emptying your
 *    own stock is structurally impossible.
 *  - Empty plates (total 0) never form a pair — two empty plates used to
 *    count as a free, endless "match". Since 2026-10-18 they stay covered and
 *    pickable like any other plate (a guess including one simply fails):
 *    marking them "빈 접시" leaked which untouched plates the opponent had
 *    used, so in 1-token mode you could pair them without remembering a thing.
 *  - Placement (all rounds) completes fully before the open/guessing phase
 *    begins — the two phases never interleave.
 *  - "한 끗 차이" stages (2026-10-16): when no exact pair is left, the match
 *    no longer ends on the spot (players found that anticlimactic — it could
 *    even end before a single guess). Instead the matching tolerance widens
 *    by one (totals within ±1, then ±2 count as a pair) and the turn goes to
 *    whoever is behind on points. Only once no pair is left even at
 *    `MAX_TOLERANCE` is the match decided on score.
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

/**
 * How many tokens one placement drops (2026-10-17):
 *  - "single": always 1 token, on a bigger board with more rounds — you
 *    memorize WHERE the opponent went (and how often), not ever-growing
 *    amounts. Players found the growing amounts piled up too fast.
 *  - "growing": the original rule — round R drops R tokens.
 */
export type TokenMode = "single" | "growing";

export const TOKEN_MODE_ORDER: TokenMode[] = ["single", "growing"];

export const TOKEN_MODE_LABEL: Record<TokenMode, string> = {
  single: "1개씩",
  growing: "늘어나는 토큰 (원작)",
};

/** Board size / round count for "single" mode — everything else follows the difficulty. Tuned by self-play (see HANDOFF 2026-10-17). */
const SINGLE_LAYOUT: Record<Difficulty, Pick<DifficultyConfig, "plateCount" | "totalRounds">> = {
  easy: { plateCount: 16, totalRounds: 12 },
  normal: { plateCount: 20, totalRounds: 16 },
  hard: { plateCount: 25, totalRounds: 16 },
};

/** The effective config for a difficulty + token mode (a missing mode = an older "growing" state). */
export function configFor(difficulty: Difficulty, mode: TokenMode = "growing"): DifficultyConfig {
  const base = DIFFICULTY_CONFIG[difficulty];
  return mode === "single" ? { ...base, ...SINGLE_LAYOUT[difficulty] } : base;
}

/** Tokens dropped by one placement in the given round. */
export function placementAmount(mode: TokenMode | undefined, round: number): number {
  return mode === "single" ? 1 : round;
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움 (원작)",
};

/** Every token a player will place over the whole placement phase. */
export function tokensPerPlayer(difficulty: Difficulty, mode: TokenMode = "growing"): number {
  const { totalRounds } = configFor(difficulty, mode);
  return mode === "single" ? totalRounds : (totalRounds * (totalRounds + 1)) / 2;
}

export interface PlateState {
  p1Count: number;
  p2Count: number;
  revealedTo: Record<Seat, boolean>;
  /** Who matched (and scored) this plate — claimed plates are out of play. */
  claimedBy: Seat | null;
}

function emptyPlate(): PlateState {
  return { p1Count: 0, p2Count: 0, revealedTo: { p1: false, p2: false }, claimedBy: null };
}

export function plateTotal(plate: PlateState): number {
  return plate.p1Count + plate.p2Count;
}

/** Whether a plate still counts toward a possible pair: unclaimed and not empty. */
export function isPlateInPlay(plate: PlateState): boolean {
  return plate.claimedBy === null && plateTotal(plate) > 0;
}

/** Whether a plate can be picked in the open phase — any unclaimed plate, empty or not (emptiness stays hidden). */
export function isPlateSelectable(plate: PlateState): boolean {
  return plate.claimedBy === null;
}

/** Widest "한 끗 차이" stage: totals up to this far apart still count as a pair. */
export const MAX_TOLERANCE = 2;

/** Whether two totals count as a pair at the given tolerance (0 = exact). */
export function totalsMatch(a: number, b: number, tolerance = 0): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Whether at least one scorable pair is still on the board at this tolerance. */
export function hasRemainingPair(plates: PlateState[], tolerance = 0): boolean {
  const totals = plates.filter(isPlateInPlay).map(plateTotal).sort((a, b) => a - b);
  for (let i = 1; i < totals.length; i++) {
    if (totalsMatch(totals[i - 1], totals[i], tolerance)) return true;
  }
  return false;
}

export interface PlacementFlash {
  seat: Seat;
  plateIndex: number;
  amount: number;
  /** Monotonic, unique per flash — lets the UI re-trigger its animation even if the same plate/amount repeats. */
  seq: number;
}

export type GamePhase = "placement" | "open" | "match-end";

/** "score" = no pairs left, decided on points (winner null = draw); "penalty" = loser hit the threshold. */
export type EndReason = "score" | "penalty" | null;

export interface MemoryFeastState {
  difficulty: Difficulty;
  /** Optional only so states from before 2026-10-17 (always "growing") still load. */
  tokenMode?: TokenMode;
  phase: GamePhase;
  plates: PlateState[];
  /** Current placement round, 1-indexed — also this round's per-plate token amount. Meaningless once phase leaves "placement". */
  round: number;
  /** 0 = p1 hasn't placed yet this round, 1 = p1 has placed, waiting on p2. */
  placerTurn: 0 | 1;
  activePlacer: Seat | null;
  /** Tokens on every plate this seat has claimed. */
  score: Record<Seat, number>;
  penalties: Record<Seat, number>;
  activeGuesser: Seat | null;
  lastFlash: PlacementFlash | null;
  flashSeq: number;
  /** Bumped on every resolved guess/timeout — lets the UI restart its per-turn countdown even across a "연속 턴" (same guesser again after a success). */
  guessSeq: number;
  /** Current "한 끗 차이" stage: plates whose totals differ by at most this much are a pair (0 = exact). */
  tolerance: number;
  /** Every placement in order — lets bots remember (or forget) what they saw instead of reading the true board. */
  placementLog: PlacementFlash[];
  /** Null while playing, and also on a drawn "score" ending. */
  winner: Seat | null;
  endReason: EndReason;
}

export function startGame(difficulty: Difficulty, tokenMode: TokenMode = "growing"): MemoryFeastState {
  const { plateCount } = configFor(difficulty, tokenMode);
  return {
    difficulty,
    tokenMode,
    phase: "placement",
    plates: Array.from({ length: plateCount }, emptyPlate),
    round: 1,
    placerTurn: 0,
    activePlacer: "p1",
    score: { p1: 0, p2: 0 },
    penalties: { p1: 0, p2: 0 },
    activeGuesser: null,
    lastFlash: null,
    flashSeq: 0,
    guessSeq: 0,
    tolerance: 0,
    placementLog: [],
    winner: null,
    endReason: null,
  };
}

/** Decide a "score" ending: more points wins, then fewer penalties, else a draw. */
function endOnScore(state: MemoryFeastState): MemoryFeastState {
  const { score, penalties } = state;
  let winner: Seat | null = null;
  if (score.p1 !== score.p2) winner = score.p1 > score.p2 ? "p1" : "p2";
  else if (penalties.p1 !== penalties.p2) winner = penalties.p1 < penalties.p2 ? "p1" : "p2";
  return { ...state, phase: "match-end", winner, endReason: "score", activeGuesser: null };
}

/**
 * Called whenever the board may have run out of pairs at the current
 * tolerance: widens the tolerance (handing the turn to whoever trails on
 * points, `tieTurn` on a tie) until a pair exists, or ends on score once
 * even `MAX_TOLERANCE` has nothing left.
 */
function advanceStageOrEnd(state: MemoryFeastState, tieTurn: Seat): MemoryFeastState {
  if (hasRemainingPair(state.plates, state.tolerance)) return state;
  let tolerance = state.tolerance;
  while (tolerance < MAX_TOLERANCE) {
    tolerance++;
    if (hasRemainingPair(state.plates, tolerance)) {
      const { score } = state;
      const trailing: Seat = score.p1 === score.p2 ? tieTurn : score.p1 < score.p2 ? "p1" : "p2";
      return { ...state, tolerance, activeGuesser: trailing };
    }
  }
  return endOnScore({ ...state, tolerance });
}

function seatKey(seat: Seat): "p1Count" | "p2Count" {
  return seat === "p1" ? "p1Count" : "p2Count";
}

export function placeToken(state: MemoryFeastState, plateIndex: number): MemoryFeastState {
  if (state.phase !== "placement" || !state.activePlacer) return state;
  if (plateIndex < 0 || plateIndex >= state.plates.length) return state;
  const active = state.activePlacer;
  const amount = placementAmount(state.tokenMode, state.round);
  const key = seatKey(active);

  const plates = state.plates.map((p, i) => (i === plateIndex ? { ...p, [key]: p[key] + amount } : p));
  const flashSeq = state.flashSeq + 1;
  const lastFlash: PlacementFlash = { seat: active, plateIndex, amount, seq: flashSeq };
  const placementLog = [...(state.placementLog ?? []), lastFlash];

  const { totalRounds } = configFor(state.difficulty, state.tokenMode);

  if (state.placerTurn === 0) {
    // p1 just placed; p2 goes next, same round.
    return { ...state, plates, lastFlash, flashSeq, placementLog, placerTurn: 1, activePlacer: other(active) };
  }

  // p2 just placed; round is complete.
  if (state.round >= totalRounds) {
    const opened: MemoryFeastState = {
      ...state,
      plates,
      lastFlash,
      flashSeq,
      placementLog,
      placerTurn: 0,
      activePlacer: null,
      phase: "open",
      activeGuesser: "p1",
      tolerance: 0,
    };
    return advanceStageOrEnd(opened, "p1");
  }
  return {
    ...state,
    plates,
    lastFlash,
    flashSeq,
    placementLog,
    round: state.round + 1,
    placerTurn: 0,
    activePlacer: "p1",
  };
}

function revealBoth(plates: PlateState[], plateA: number, plateB: number, to: Seat): PlateState[] {
  return plates.map((p, i) => (i === plateA || i === plateB ? { ...p, revealedTo: { ...p.revealedTo, [to]: true } } : p));
}

function claimForGuesser(plates: PlateState[], plateA: number, plateB: number, guesser: Seat): PlateState[] {
  return plates.map((p, i) =>
    i === plateA || i === plateB ? { ...p, revealedTo: { p1: true, p2: true }, claimedBy: guesser } : p,
  );
}

export function guess(state: MemoryFeastState, plateA: number, plateB: number): MemoryFeastState {
  if (state.phase !== "open" || !state.activeGuesser) return state;
  if (plateA === plateB) return state;
  const count = state.plates.length;
  if (plateA < 0 || plateA >= count || plateB < 0 || plateB >= count) return state;
  if (!isPlateSelectable(state.plates[plateA]) || !isPlateSelectable(state.plates[plateB])) return state;

  const guesser = state.activeGuesser;
  const totalA = plateTotal(state.plates[plateA]);
  const totalB = plateTotal(state.plates[plateB]);
  const guessSeq = state.guessSeq + 1;

  const tolerance = state.tolerance ?? 0;
  if (totalA > 0 && totalB > 0 && totalsMatch(totalA, totalB, tolerance)) {
    const plates = claimForGuesser(state.plates, plateA, plateB, guesser);
    const score = { ...state.score, [guesser]: state.score[guesser] + totalA + totalB };
    const next = { ...state, plates, score, guessSeq, tolerance };
    // Match success grants an extra (연속) turn — same guesser continues — unless this stage has no pairs left,
    // in which case the next 한 끗 차이 stage opens (trailing player first; on a tie the other player, who's been waiting).
    return advanceStageOrEnd(next, other(guesser));
  }

  // Failed match: only the guesser personally learns the true values.
  const plates = revealBoth(state.plates, plateA, plateB, guesser);
  const penalties = { ...state.penalties, [guesser]: state.penalties[guesser] + 1 };
  const { penaltyLossThreshold } = configFor(state.difficulty, state.tokenMode);
  if (penalties[guesser] >= penaltyLossThreshold) {
    return {
      ...state,
      plates,
      penalties,
      guessSeq,
      phase: "match-end",
      winner: other(guesser),
      endReason: "penalty",
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
  const { penaltyLossThreshold } = configFor(state.difficulty, state.tokenMode);
  if (penalties[guesser] >= penaltyLossThreshold) {
    return {
      ...state,
      penalties,
      guessSeq,
      phase: "match-end",
      winner: other(guesser),
      endReason: "penalty",
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

import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

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
    return platePairs(state.plates.length)
      .filter(([a, b]) => isPlateSelectable(state.plates[a]) && isPlateSelectable(state.plates[b]))
      .map(([a, b]) => ({ type: "guess", plateA: a, plateB: b }) as EngineAction);
  }
  return [];
}

/**
 * Placement style (2026-10-18): the old heuristic always spread onto the
 * plate it had used least, which read as mechanical and, in 1-token mode,
 * filled the board with total-1 plates. Now it mixes like a person does —
 * sometimes stacking onto its own plate, sometimes joining a plate the
 * opponent used (so the opponent must recall both halves), otherwise a
 * fresh random plate. Placement isn't where skill shows, so this is the
 * same for every level.
 */
const STACK_OWN_CHANCE = 0.35;
const JOIN_OPPONENT_CHANCE = 0.2;

function choosePlacement(state: MemoryFeastState, seat: Seat, rng: () => number): EngineAction {
  const mine: number[] = [];
  const theirs: number[] = [];
  state.plates.forEach((p, i) => {
    if ((seat === "p1" ? p.p1Count : p.p2Count) > 0) mine.push(i);
  });
  for (const flash of state.placementLog ?? []) {
    if (flash.seat !== seat && !theirs.includes(flash.plateIndex)) theirs.push(flash.plateIndex);
  }
  const pickFrom = (list: number[]) => list[Math.floor(rng() * list.length)];
  const roll = rng();
  let plateIndex: number;
  if (mine.length && roll < STACK_OWN_CHANCE) plateIndex = pickFrom(mine);
  else if (theirs.length && roll < STACK_OWN_CHANCE + JOIN_OPPONENT_CHANCE) plateIndex = pickFrom(theirs);
  else plateIndex = Math.floor(rng() * state.plates.length);
  return { type: "place", plateIndex };
}

/**
 * Chance a bot of this level still remembers one opponent placement flash
 * when the guessing starts. Before 2026-10-16 bots read the TRUE board, so
 * even a sloppy bot never "forgot" anything and Lv.10 swept the board —
 * players found it far too strong. Now a bot only knows what a person
 * sitting there could know.
 */
export function botRecallChance(level: BotLevel, mode: TokenMode = "growing"): number {
  const l = Math.min(10, Math.max(1, Math.round(level)));
  const [min, max] = RECALL_RANGE[mode];
  return min + ((max - min) * (l - 1)) / 9;
}
/** "single" spreads many 1-token flashes over a bigger board, so a narrow range made every level play alike — it needs a wider spread to keep Lv.1 and Lv.10 distinct. */
const RECALL_RANGE: Record<TokenMode, [number, number]> = {
  growing: [0.2, 0.6],
  single: [0.1, 0.8],
};

/** Stable 0..1 hash so a bot's memory of one flash doesn't flicker between turns (it isn't re-rolled every move). */
function recallRoll(flash: PlacementFlash, seat: Seat): number {
  let h = Math.imul(flash.seq, 0x9e3779b1) ^ Math.imul(flash.plateIndex + 1, 0x85ebca6b) ^ (seat === "p1" ? 0x5bd1e995 : 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * What `seat` believes each plate's total is: its own tokens (always known)
 * plus the opponent placements it remembers — or the exact total for a
 * plate it has opened itself. Forgotten placements simply aren't counted,
 * so a forgetful bot really does make wrong guesses.
 */
export function botBeliefTotals(state: MemoryFeastState, seat: Seat, level: BotLevel): number[] {
  const opp = other(seat);
  const recall = botRecallChance(level, state.tokenMode);
  const believed = state.plates.map((p) => (seat === "p1" ? p.p1Count : p.p2Count));
  for (const flash of state.placementLog ?? []) {
    if (flash.seat === opp && recallRoll(flash, seat) < recall) believed[flash.plateIndex] += flash.amount;
  }
  return state.plates.map((p, i) => (p.revealedTo[seat] ? plateTotal(p) : believed[i]));
}

/**
 * Guessing heuristic over the bot's BELIEVED totals: a (believed) match
 * scores far above any non-match, and among non-matches a closer total is
 * still mildly preferred. `pickByLevel`'s noise curve adds slips on top.
 */
function scoreGuess(believed: number[], tolerance: number, plateA: number, plateB: number): number {
  const totalA = believed[plateA];
  const totalB = believed[plateB];
  // A plate believed empty can never pair — steer well clear of it.
  if (totalA === 0 || totalB === 0) return -500;
  if (totalsMatch(totalA, totalB, tolerance)) return 1000 + totalA + totalB;
  return -Math.abs(totalA - totalB);
}

function scoreMove(state: MemoryFeastState, move: EngineAction, believed: number[]): number {
  if (move.type === "guess") return scoreGuess(believed, state.tolerance ?? 0, move.plateA, move.plateB);
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
  if (state.phase === "placement") return choosePlacement(state, seat, rng);
  const believed = botBeliefTotals(state, seat, level);
  const scored = moves.map((move) => ({ move, score: scoreMove(state, move, believed) }));
  return pickByLevel(scored, level, rng);
}
