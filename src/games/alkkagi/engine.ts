/**
 * Pure "알까기 대전(Alkkagi Battle)" rules engine — no React, no I/O.
 * Implements boardGameRule/알까기대전/알까기대전.md (section numbers below
 * refer to it). Each player flicks one of their stones per shot; stones
 * whose center leaves the board fall (§5). Last player with stones wins the
 * round (§7).
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s. A `flick` carries the launch velocity as
 * integers (milli-units/s) and the outcome comes from the deterministic
 * physics in physics.ts, so no client ever reports a result.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { EDGE, KING_GRIP, KING_MASS, KING_R, simulate, STONE_MASS, STONE_R, V_MAX, type SimFall, type SimStone } from "./physics";

export type Seat = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** §4 */
export const AIM_TIMEOUT_MS = 30_000;
/** §6 — shots per turn including the first. */
export const MAX_CHAIN = 3;
/** §7 */
export const ROUND_SHOT_LIMIT = 60;

export type StoneCount = "few" | "normal" | "many";

export interface GameOptions {
  stones: StoneCount;
  rounds: 1 | 3;
  king: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { stones: "normal", rounds: 1, king: false };

export interface Stone {
  id: number;
  owner: Seat;
  x: number;
  y: number;
  king: boolean;
}

/** One resolved shot — the board replays it from `before` (keyed by `turn`). */
export interface ShotRecord {
  turn: number;
  seat: Seat;
  stoneId: number;
  vx: number;
  vy: number;
  /** Stones on the board right before the shot (positions the replay starts from). */
  before: Stone[];
  /** Ids that fell, in fall order. */
  fallen: number[];
  /** Opponent stones this shot knocked off. */
  knocked: number;
  /** Own stones lost (shooter included). */
  lost: number;
  shooterFell: boolean;
  /** Seats eliminated by this shot (in elimination order: earliest out first). */
  eliminated: Seat[];
  /** Kings that fell (king mode). */
  kingsDown: Seat[];
  bonus: boolean;
  steps: number;
}

export interface RoundRecord {
  /** Seats in finishing order, 1st first (`places[i]` may share a rank, see `ranks`). */
  places: Seat[];
  ranks: number[];
  shots: number;
  limitHit: boolean;
}

export type Phase = "aim" | "roundOver" | "ended";

export interface AlkkagiState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  round: number;
  stones: Stone[];
  activeSeat: Seat;
  phase: Phase;
  /** Monotonic action counter — animation key and stale-timeout guard. */
  turn: number;
  /** Shots taken in the current turn (1..MAX_CHAIN once someone has flicked). */
  chain: number;
  roundShots: number;
  /** Elimination order this round (earliest out first). */
  outOrder: Seat[];
  /** Opponent stones knocked this round per seat (§7 limit tiebreak). */
  roundKnocks: number[];
  lastShot: ShotRecord | null;
  /** The last turn passed without a flick (timeout) — for the HUD. */
  lastPass: { turn: number; seat: Seat } | null;
  scores: number[];
  roundWins: number[];
  knocks: number[];
  history: RoundRecord[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "flick"; seat: Seat; stone: number; vx: number; vy: number }
  | { type: "timeout"; seat: Seat; turn: number }
  | { type: "next"; seat?: Seat };

// ---------------------------------------------------------------------------
// Setup (§3)
// ---------------------------------------------------------------------------

export function stoneCountFor(playerCount: number, opt: StoneCount): number {
  const table = playerCount <= 2 ? { few: 5, normal: 7, many: 9 } : { few: 4, normal: 5, many: 6 };
  return table[opt];
}

/** Board sides by player count: 0 = south (−y), 1 = west (−x), 2 = north (+y), 3 = east (+x). */
export function sidesFor(playerCount: number): number[] {
  if (playerCount <= 2) return [0, 2];
  if (playerCount === 3) return [0, 1, 3];
  return [0, 1, 2, 3];
}

export function sideOf(state: { playerCount: number }, seat: Seat): number {
  return sidesFor(state.playerCount)[seat] ?? 0;
}

/** Maps a side-local point (u along the side, depth from center) to board coords. */
function placeOnSide(side: number, u: number, depth: number): { x: number; y: number } {
  switch (side) {
    case 0:
      return { x: u, y: -depth };
    case 1:
      return { x: -depth, y: -u };
    case 2:
      return { x: -u, y: depth };
    default:
      return { x: depth, y: u };
  }
}

export function setupStones(playerCount: number, options: GameOptions): Stone[] {
  const count = stoneCountFor(playerCount, options.stones);
  const depth = playerCount <= 2 ? 6 : 7;
  const span = playerCount <= 2 ? 8 : 4.5;
  const gap = count > 1 ? Math.min(2, (2 * span) / (count - 1)) : 0;
  const sides = sidesFor(playerCount);
  const stones: Stone[] = [];
  let id = 0;
  for (let seat = 0; seat < playerCount; seat++) {
    const mid = (count - 1) / 2;
    for (let k = 0; k < count; k++) {
      const u = Math.round((k - mid) * gap * 1000) / 1000;
      const p = placeOnSide(sides[seat], u, depth);
      stones.push({ id: id++, owner: seat, x: p.x, y: p.y, king: options.king && k === Math.floor(mid) });
    }
  }
  return stones;
}

export function startGame(playerCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): AlkkagiState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  const first = Math.floor(seededRng(seed ^ 0x51ed)() * n);
  return {
    seed,
    playerCount: n,
    options: opts,
    round: 0,
    stones: setupStones(n, opts),
    activeSeat: first,
    phase: "aim",
    turn: 0,
    chain: 0,
    roundShots: 0,
    outOrder: [],
    roundKnocks: Array(n).fill(0),
    lastShot: null,
    lastPass: null,
    scores: Array(n).fill(0),
    roundWins: Array(n).fill(0),
    knocks: Array(n).fill(0),
    history: [],
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const radiusOf = (s: Pick<Stone, "king">) => (s.king ? KING_R : STONE_R);
export const massOf = (s: Pick<Stone, "king">) => (s.king ? KING_MASS : STONE_MASS);

export function toSim(stones: readonly Stone[]): SimStone[] {
  return stones.map((s) => ({ id: s.id, x: s.x, y: s.y, r: radiusOf(s), m: massOf(s), mu: s.king ? KING_GRIP : 1 }));
}

export function aliveCount(state: Pick<AlkkagiState, "stones">, seat: Seat): number {
  let n = 0;
  for (const s of state.stones) if (s.owner === seat) n++;
  return n;
}

export function isAlive(state: Pick<AlkkagiState, "stones">, seat: Seat): boolean {
  return state.stones.some((s) => s.owner === seat);
}

export function aliveSeats(state: Pick<AlkkagiState, "stones" | "playerCount">): Seat[] {
  const out: Seat[] = [];
  for (let s = 0; s < state.playerCount; s++) if (isAlive(state, s)) out.push(s);
  return out;
}

/** Distance from a point to the nearest board edge (negative = off the board). */
export function edgeDistance(x: number, y: number): number {
  return EDGE - Math.max(Math.abs(x), Math.abs(y));
}

function nextSeat(state: AlkkagiState, from: Seat, stones: readonly Stone[]): Seat {
  for (let k = 1; k <= state.playerCount; k++) {
    const s = (from + k) % state.playerCount;
    if (stones.some((st) => st.owner === s)) return s;
  }
  return from;
}

/** Quantized launch velocity the action carries (milli-units/s, magnitude ≤ V_MAX). */
export function quantizeShot(vx: number, vy: number): { vx: number; vy: number } {
  const s = Math.sqrt(vx * vx + vy * vy);
  const k = s > V_MAX ? V_MAX / s : 1;
  return { vx: Math.round(vx * k * 1000), vy: Math.round(vy * k * 1000) };
}

/** Velocity a `flick` action stands for (clamped). */
export function shotVelocity(vxMilli: number, vyMilli: number): { vx: number; vy: number } {
  const vx = vxMilli / 1000;
  const vy = vyMilli / 1000;
  const s = Math.sqrt(vx * vx + vy * vy);
  if (s > V_MAX) return { vx: (vx * V_MAX) / s, vy: (vy * V_MAX) / s };
  return { vx, vy };
}

export interface ShotOutcome {
  stones: Stone[];
  falls: SimFall[];
  steps: number;
}

/** Runs the physics and applies falls (§5) + king-mode surrender (§9). */
export function resolveShot(stones: readonly Stone[], stoneId: number, vxMilli: number, vyMilli: number, kingMode: boolean): ShotOutcome & { surrendered: number[] } {
  const v = shotVelocity(vxMilli, vyMilli);
  const res = simulate(toSim(stones), stoneId, v.vx, v.vy);
  const pos = new Map(res.rest.map((r) => [r.id, r]));
  let next = stones.filter((s) => pos.has(s.id)).map((s) => ({ ...s, x: pos.get(s.id)!.x, y: pos.get(s.id)!.y }));
  const surrendered: number[] = [];
  if (kingMode) {
    const fallenKings = new Set(res.falls.map((f) => stones.find((s) => s.id === f.id)!).filter((s) => s.king).map((s) => s.owner));
    if (fallenKings.size > 0) {
      for (const s of next) if (fallenKings.has(s.owner)) surrendered.push(s.id);
      next = next.filter((s) => !fallenKings.has(s.owner));
    }
  }
  return { stones: next, falls: res.falls, steps: res.steps, surrendered };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function doFlick(state: AlkkagiState, seat: Seat, stoneId: number, vxM: number, vyM: number): AlkkagiState {
  if (state.phase !== "aim" || seat !== state.activeSeat) return state;
  const shooter = state.stones.find((s) => s.id === stoneId);
  if (!shooter || shooter.owner !== seat) return state;
  if (!Number.isFinite(vxM) || !Number.isFinite(vyM) || (vxM === 0 && vyM === 0)) return state;
  const vx = Math.round(vxM);
  const vy = Math.round(vyM);

  const before = state.stones;
  const out = resolveShot(before, stoneId, vx, vy, state.options.king);
  const byId = new Map(before.map((s) => [s.id, s]));
  const fallen = out.falls.map((f) => f.id);
  let knocked = 0;
  let lost = 0;
  const kingsDown: Seat[] = [];
  for (const id of fallen) {
    const st = byId.get(id)!;
    if (st.owner === seat) lost++;
    else knocked++;
    if (st.king) kingsDown.push(st.owner);
  }
  const shooterFell = fallen.includes(stoneId);

  // §7 — who went out, ordered by when their last stone left the board
  const lastFall = new Map<Seat, number>();
  for (const f of out.falls) lastFall.set(byId.get(f.id)!.owner, f.step);
  const wasAlive = aliveSeats(state);
  const nowAlive = new Set(aliveSeats({ stones: out.stones, playerCount: state.playerCount }));
  const eliminated = wasAlive
    .filter((s) => !nowAlive.has(s))
    .sort((a, b) => {
      // a king-mode surrender counts as leaving when the king fell
      const fa = lastFall.get(a) ?? -1;
      const fb = lastFall.get(b) ?? -1;
      if (fa !== fb) return fa - fb;
      if (a === seat) return -1;
      if (b === seat) return 1;
      return a - b;
    });

  // stats (§15)
  let tally = state.statTally;
  if (knocked > 0) tally = tallyAdd(tally, seat, "knocked", knocked);
  if (knocked >= 2) tally = tallyAdd(tally, seat, "multiKnocks");
  tally = tallyMax(tally, seat, "bestShot", knocked);
  if (shooterFell) tally = tallyAdd(tally, seat, "selfFalls");
  for (const k of kingsDown) if (k !== seat) tally = tallyAdd(tally, seat, "kingKills");
  for (const id of fallen) {
    const owner = byId.get(id)!.owner;
    tally = tallyAdd(tally, owner, "lost");
  }
  tally = tallyAdd(tally, seat, "shots");

  const knocks = [...state.knocks];
  knocks[seat] += knocked;
  const roundKnocks = [...state.roundKnocks];
  roundKnocks[seat] += knocked;
  const outOrder = [...state.outOrder, ...eliminated];
  const roundShots = state.roundShots + 1;
  const alive = aliveSeats({ stones: out.stones, playerCount: state.playerCount });
  const bonus = knocked > 0 && !shooterFell && nowAlive.has(seat) && alive.length > 1 && state.chain + 1 < MAX_CHAIN;

  const shot: ShotRecord = {
    turn: state.turn,
    seat,
    stoneId,
    vx,
    vy,
    before,
    fallen: [...fallen, ...out.surrendered],
    knocked,
    lost,
    shooterFell,
    eliminated,
    kingsDown,
    bonus,
    steps: out.steps,
  };

  const base: AlkkagiState = {
    ...state,
    stones: out.stones,
    turn: state.turn + 1,
    roundShots,
    outOrder,
    roundKnocks,
    knocks,
    lastShot: shot,
    statTally: tally,
  };

  if (alive.length <= 1) return endRound(base, alive, false);
  if (roundShots >= ROUND_SHOT_LIMIT) return endRound(base, alive, true);
  if (bonus) return { ...base, chain: state.chain + 1 };
  return { ...base, chain: 0, activeSeat: nextSeat(state, seat, out.stones) };
}

/** Value of a stone for the §7 limit tiebreak. */
function stoneWorth(s: Stone): number {
  return s.king ? 2 : 1;
}

function endRound(state: AlkkagiState, alive: Seat[], limitHit: boolean): AlkkagiState {
  const n = state.playerCount;
  // survivors first (ranked by §7 limit rules when several remain), then the out-order reversed
  const worth = (seat: Seat) => state.stones.filter((s) => s.owner === seat).reduce((a, s) => a + stoneWorth(s), 0);
  const survivors = [...alive].sort((a, b) => worth(b) - worth(a) || state.roundKnocks[b] - state.roundKnocks[a] || a - b);
  const places = [...survivors, ...[...state.outOrder].reverse()];
  const ranks: number[] = [];
  places.forEach((seat, i) => {
    if (i > 0 && i < survivors.length) {
      const prev = places[i - 1];
      if (worth(prev) === worth(seat) && state.roundKnocks[prev] === state.roundKnocks[seat]) {
        ranks.push(ranks[i - 1]);
        return;
      }
    }
    ranks.push(i + 1);
  });
  const scores = [...state.scores];
  const roundWins = [...state.roundWins];
  let tally = state.statTally;
  places.forEach((seat, i) => {
    scores[seat] += n - ranks[i];
    if (ranks[i] === 1) {
      roundWins[seat] += 1;
      tally = tallyAdd(tally, seat, "roundWins");
    }
  });
  // flawless = won the round without losing a stone this round
  const startCount = stoneCountFor(n, state.options.stones);
  for (let i = 0; i < places.length; i++) {
    if (ranks[i] !== 1) continue;
    const seat = places[i];
    if (aliveCount(state, seat) === startCount) tally = tallyAdd(tally, seat, "flawless");
  }
  return {
    ...state,
    phase: "roundOver",
    chain: 0,
    scores,
    roundWins,
    statTally: tally,
    history: [...state.history, { places, ranks, shots: state.roundShots, limitHit }],
  };
}

function nextRound(state: AlkkagiState): AlkkagiState {
  if (state.phase !== "roundOver") return state;
  if (state.round + 1 >= state.options.rounds) return { ...state, phase: "ended", turn: state.turn + 1 };
  const rec = state.history[state.history.length - 1];
  const lastPlace = rec ? rec.places[rec.places.length - 1] : 0;
  return {
    ...state,
    round: state.round + 1,
    stones: setupStones(state.playerCount, state.options),
    activeSeat: lastPlace,
    phase: "aim",
    turn: state.turn + 1,
    chain: 0,
    roundShots: 0,
    outOrder: [],
    roundKnocks: Array(state.playerCount).fill(0),
    lastShot: null,
    lastPass: null,
  };
}

function doTimeout(state: AlkkagiState, seat: Seat, turn: number): AlkkagiState {
  if (state.phase !== "aim" || turn !== state.turn || seat !== state.activeSeat) return state;
  return {
    ...state,
    turn: state.turn + 1,
    chain: 0,
    activeSeat: nextSeat(state, seat, state.stones),
    lastPass: { turn: state.turn, seat },
  };
}

export function applyAction(state: AlkkagiState, action: EngineAction): AlkkagiState {
  switch (action.type) {
    case "flick":
      return doFlick(state, action.seat, action.stone, action.vx, action.vy);
    case "timeout":
      return doTimeout(state, action.seat, action.turn);
    case "next":
      return nextRound(state);
    default:
      return state;
  }
}

/** Whose decision bots/timeouts drive right now. */
export function currentActor(state: AlkkagiState): Seat | null {
  return state.phase === "aim" ? state.activeSeat : null;
}

// ---------------------------------------------------------------------------
// Rankings (§8)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

export function computeRankings(state: AlkkagiState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => [state.scores[s], state.roundWins[s], state.knocks[s]];
  const cmp = (a: Seat, b: Seat) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...seats].sort((a, b) => cmp(a, b) || a - b);
  const out: RankedSeat[] = [];
  sorted.forEach((s, i) => {
    const prev = out[i - 1];
    out.push({ seat: s, rank: prev && cmp(sorted[i - 1], s) === 0 ? prev.rank : i + 1 });
  });
  return out;
}
