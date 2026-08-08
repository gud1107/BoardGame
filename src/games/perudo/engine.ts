/**
 * Pure "Perudo" (a.k.a. Liar's Dice / Dudo) rules engine — no React, no I/O.
 * Implements the 코리아보드게임즈 공식 룰북 (see boardGameRule/Perudo.md): every
 * alive player hides 5 dice under a cup, the round's leader opens a bid on
 * "at least N dice showing face F across the whole table", each following
 * player must either raise the bid, call "페루도!" (dudo — doubt the bid) or
 * call "맞아!" (calza — claim the bid is exactly right), and 1s ("페루도" the
 * face, not to be confused with the "페루도!" doubt call above) act as wild
 * jokers for every face except during a "팔라피코" round.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (every seat's
 * hidden dice) from a shared RNG seed plus replayed `EngineAction`s — there
 * is no server authority. See README for the accepted trust trade-off.
 *
 * Two documented, intentional interpretations of the rulebook:
 * - "맞아!(calza)" is written as "차례와 상관없이" (regardless of turn order).
 *   This engine honors that literally: `calza` may be submitted by ANY alive
 *   seat at any time there's a pending bid (outside a Palafico round), not
 *   just the active seat — unlike `raise`/`dudo`, which are turn-restricted.
 * - "팔라피코(Palafico)" triggers per the rulebook's own definition ("주사위
 *   1개 남은 플레이어가 라운드의 선일 때") as a pure function of
 *   `roundStarter`'s current dice count, rather than a separately tracked
 *   one-time flag — consistent with this project's "파생 상태 금지" principle
 *   (see docs/architecture.md §1.4): nothing needs to remember "did this
 *   already happen for this player", since a starter can only ever hold
 *   exactly 1 die immediately after being penalized down to it.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
// The physical box only ships 6 colored cups, but this digital implementation
// deliberately extends beyond that hardware limit — 8 is a common house-rule
// cap for Perudo/Dudo when playing with more dice sets pooled together.
export const MAX_PLAYERS = 8;
export const STARTING_DICE = 5;
export const MAX_DICE = 5;

/** 1 is "페루도" — a joker face marked with the game's own crest, not a plain pip. */
export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export interface Bid {
  seat: SeatIndex;
  quantity: number;
  face: Face;
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
  /** True dice count of `bid.face` across the whole table (wilds included unless it was a Palafico round). */
  actualCount: number;
  /** Seat whose dice count just changed as a result of this call. */
  affectedSeat: SeatIndex;
  /**
   * Signed change applied to `affectedSeat`'s `diceCount` (before the
   * [0, MAX_DICE] clamp). Differential-penalty rules (see module doc): a
   * losing call can cost more than 1 die depending on how far off the bid
   * was, while a successful "맞아!" always regains exactly 1.
   */
  diceDelta: number;
  /** Full table reveal at the moment of the call, captured before any reroll — seat -> that seat's dice. */
  revealedDice: Record<SeatIndex, number[]>;
  wasPalafico: boolean;
}

export interface PerudoState {
  playerCount: number;
  players: PlayerState[];
  /** Null only at the very start of a round, before the leader's opening bid. */
  currentBid: Bid | null;
  activeSeat: SeatIndex;
  /** Who opened the current round — determines Palafico (see module doc) and who leads the next round while `phase` is "reveal". */
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

/** Deterministic PRNG (mulberry32) — same technique as every other engine in this project. */
export function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollDice(rng: () => number, count: number): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * 6));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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

/** See module doc — a round is Palafico purely because its starter currently holds exactly 1 die, nothing extra to track. */
export function isPalafico(state: PerudoState): boolean {
  const starter = state.players.find((p) => p.seat === state.roundStarter);
  return starter !== undefined && starter.diceCount === 1;
}

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
 * bid, always legal). Implements the rulebook §3 formulas exactly:
 * - normal(2-6) -> normal: quantity must strictly increase, OR stay equal
 *   while the face strictly increases.
 * - normal -> paco(1): quantity >= ceil(prev quantity / 2).
 * - paco -> normal: quantity >= prev quantity * 2 + 1.
 * - paco -> paco: quantity must strictly increase (face is fixed at 1).
 * - Palafico round (§5): the face is locked to whatever the leader opened
 *   with — only the quantity may increase.
 */
export function validateRaise(prev: Bid | null, next: { quantity: number; face: Face }, palafico: boolean): boolean {
  if (!Number.isInteger(next.quantity) || next.quantity < 1) return false;
  if (!Number.isInteger(next.face) || next.face < 1 || next.face > 6) return false;
  if (prev === null) return true;
  if (palafico) return next.face === prev.face && next.quantity > prev.quantity;
  if (prev.face === 1 && next.face === 1) return next.quantity > prev.quantity;
  if (prev.face === 1 && next.face !== 1) return next.quantity >= prev.quantity * 2 + 1;
  if (prev.face !== 1 && next.face === 1) return next.quantity >= Math.ceil(prev.quantity / 2);
  return next.quantity > prev.quantity || (next.quantity === prev.quantity && next.face > prev.face);
}

/**
 * The smallest `quantity` that would make `{ quantity, face }` a legal raise
 * over `prev` — used by the UI to pre-fill/clamp its quantity stepper for a
 * chosen face. Returns null when `face` can never be raised to right now
 * (only possible during a Palafico round, where the face is locked). Brute
 * forces upward from 1 through `validateRaise` rather than re-deriving the
 * §3 formulas a second time, so there's exactly one place they can drift out
 * of sync.
 */
export function minValidQuantityForFace(prev: Bid | null, face: Face, palafico: boolean): number | null {
  if (prev === null) return 1;
  if (palafico) return face === prev.face ? prev.quantity + 1 : null;
  for (let quantity = 1; quantity <= 500; quantity++) {
    if (validateRaise(prev, { quantity, face }, false)) return quantity;
  }
  return null;
}

/** How many dice on the table currently show `face` — 1s count as wild for every other face unless `wild` is false (Palafico rounds, rulebook §5-1). */
export function countMatching(players: PlayerState[], face: Face, wild: boolean): number {
  let count = 0;
  for (const player of players) {
    for (const die of player.dice) {
      if (die === face) count++;
      else if (wild && face !== 1 && die === 1) count++;
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
  if (!validateRaise(state.currentBid, { quantity, face }, isPalafico(state))) return state;

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

  const wasPalafico = isPalafico(state);
  const players = state.players.map((p) =>
    p.seat === affectedSeat ? { ...p, diceCount: clamp(p.diceCount + delta, 0, MAX_DICE) } : p,
  );
  const affectedNowDice = players.find((p) => p.seat === affectedSeat)!.diceCount;
  const justEliminated = delta < 0 && affectedNowDice === 0;
  const eliminationOrder = justEliminated ? [...state.eliminationOrder, affectedSeat] : state.eliminationOrder;

  const resolution: RoundResolution = { ...meta, affectedSeat, diceDelta: delta, revealedDice, wasPalafico };
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

  const wild = !isPalafico(state);
  const actualCount = countMatching(state.players, bid.face, wild);
  const bidWasTooHigh = actualCount < bid.quantity;
  const affected = bidWasTooHigh ? bid.seat : seat;
  const loss = bidWasTooHigh ? bid.quantity - actualCount : actualCount - bid.quantity + 1;
  return applyResolution(state, affected, -loss, { kind: "dudo", actorSeat: seat, bid, actualCount });
}

/**
 * "맞아!" — claim the current bid is exactly right. Deliberately NOT
 * turn-restricted, see module doc. Unavailable during a Palafico round
 * (rulebook §5-4). Differential penalty (rulebook §4② 판정): a correct call
 * always regains exactly 1 die (capped at MAX_DICE), but a wrong call costs
 * the caller `|actualCount - bid.quantity|` dice — the exact margin they
 * misjudged by, in either direction.
 */
function calza(state: PerudoState, seat: SeatIndex): PerudoState {
  if (state.phase !== "playing") return state;
  if (isPalafico(state)) return state;
  const bid = state.currentBid;
  if (!bid) return state;
  const caller = state.players.find((p) => p.seat === seat);
  if (!caller || caller.diceCount <= 0) return state;

  const actualCount = countMatching(state.players, bid.face, true);
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
