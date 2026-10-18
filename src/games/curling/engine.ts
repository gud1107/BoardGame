/**
 * Pure "컬링 파티 (Curling Party)" rules engine — no React, no I/O.
 * Implements boardGameRule/컬링파티/컬링파티.md (section numbers below refer to it).
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s. A throw action carries everything the
 * deterministic physics (physics.ts) needs — aim, weight, spin, party stone,
 * and the per-0.1 s sweep values recorded live by the client that ran the
 * throw — so every device lands every stone on exactly the same spot.
 *
 * Sides: in 팀전 (team) seats alternate between two sides (seat % 2); in
 * 개인전 (ffa) every seat is its own side. Scores are kept per side.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import {
  BUTTON_R,
  distToButton,
  inFreeGuardZone,
  inHouse,
  PARTY_KINDS,
  quantize,
  runThrow,
  STONE_R,
  TICKS_PER_FRAME,
  MAX_TICKS,
  weightForTravel,
  type PartyKind,
  type Stone,
  type ThrowParams,
  type ThrowSim,
} from "./physics";

export type Seat = number;
export type Mode = "team" | "ffa";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const FFA_MIN = 3;
export const FFA_MAX = 6;
/** §10 — choosing aim/spin and releasing the gauge. */
export const AIM_TIMEOUT_MS = 40_000;
/** §10 — extra time once a live throw has started (the stone is sliding). */
export const RUN_GRACE_MS = 30_000;
/** Pause on the end-result screen before the next end starts by itself. */
export const SCORE_PAUSE_MS = 8_000;
/** §11 — at most this many extra ends to break a tie for first. */
export const MAX_EXTRA_ENDS = 1;
export const AIM_LIMIT = 2.2;
const MAX_FRAMES = Math.ceil(MAX_TICKS / TICKS_PER_FRAME);

export interface GameOptions {
  mode: Mode;
  /** §2 */
  ends: 1 | 3 | 5;
  /** 팀전: stones per side per end (§3). 개인전 ignores it (§3 table). */
  stones: 4 | 6 | 8;
  /** §7 파티 스톤 */
  party: boolean;
  /** §8 프리 가드 존 */
  fgz: boolean;
  /** §21 🔰 초보 도우미 — display only (curved path preview, live scoring numbers); the engine never reads it. */
  guide: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { mode: "team", ends: 3, stones: 4, party: true, fgz: true, guide: true };

export type Phase = "aim" | "scored" | "ended";

export type ShotKey =
  | "fgz"
  | "hog"
  | "side"
  | "through"
  | "bomb"
  | "triple"
  | "double"
  | "hitStay"
  | "takeout"
  | "ownGoal"
  | "raise"
  | "stick"
  | "button"
  | "freeze"
  | "shot"
  | "house"
  | "guard"
  | "nudge";

export interface ShotCall {
  key: ShotKey;
  /** Opponent stones knocked out by this throw. */
  removedOpp: number;
  removedOwn: number;
}

export interface ThrowRecord {
  turn: number;
  seat: Seat;
  side: number;
  stoneId: number;
  params: ThrowParams;
  own: number[];
  opp: number[];
  /** Stones before the throw — with params + sweep, enough to replay the animation. */
  before: Stone[];
  call: ShotCall;
  fgzReset: boolean;
  auto: boolean;
}

export interface EndRecord {
  end: number;
  /** Scoring side, or null for a blank end. */
  scorer: number | null;
  points: number;
  /** Stone ids that counted, closest first. */
  counting: number[];
  stones: Stone[];
  hammer: number;
  extra: boolean;
}

export interface CurlingState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  sides: number;
  /** seat → side */
  sideOf: number[];
  /** side → seats (throwing rotation order) */
  members: Seat[][];
  end: number;
  extraEnds: number;
  phase: Phase;
  stones: Stone[];
  /** side of each throw this end, in order */
  order: number[];
  throwIndex: number;
  /** side → how many stones that side has thrown in total (picks the next member) */
  rotation: number[];
  /** 팀전: side throwing last this end. 개인전: last seat in the order. */
  hammer: number;
  scores: number[];
  history: EndRecord[];
  /** side → unused party stone this end */
  cards: (PartyKind | null)[];
  nextStoneId: number;
  /** Monotonic action counter — rng salt, animation key, stale-action guard. */
  turn: number;
  lastThrow: ThrowRecord | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "throw"; seat: Seat; turn: number; aim: number; weight: number; spin: 1 | -1; useCard: boolean; own: number[]; opp: number[] }
  | { type: "timeout"; seat: Seat; turn: number }
  | { type: "next"; turn: number };

// ---------------------------------------------------------------------------
// Setup (§2, §3)
// ---------------------------------------------------------------------------

function mix(seed: number, salt: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(salt + 1, 40503)) | 0;
}

export function normalizeOptions(playerCount: number, o: Partial<GameOptions> = {}): GameOptions {
  const mode: Mode = o.mode === "ffa" && playerCount >= FFA_MIN && playerCount <= FFA_MAX ? "ffa" : "team";
  return {
    mode,
    ends: o.ends === 1 || o.ends === 5 ? o.ends : 3,
    stones: o.stones === 6 || o.stones === 8 ? o.stones : 4,
    party: o.party !== false,
    fgz: o.fgz !== false,
    guide: o.guide !== false,
  };
}

/** §3 — stones each side throws per end. */
export function stonesPerSide(state: Pick<CurlingState, "options" | "playerCount">): number {
  if (state.options.mode === "team") return state.options.stones;
  return state.playerCount <= 3 ? 3 : 2;
}

/** §8 — how many throws at the start of an end are protected by the free guard zone. */
export function fgzThrows(state: Pick<CurlingState, "options" | "playerCount" | "sides">): number {
  if (!state.options.fgz) return 0;
  const total = stonesPerSide(state) * state.sides;
  return Math.round((total * 5) / 16);
}

function buildOrder(state: Pick<CurlingState, "options" | "playerCount" | "sides">, hammer: number): number[] {
  const per = stonesPerSide(state);
  const order: number[] = [];
  if (state.options.mode === "team") {
    const first = 1 - hammer;
    for (let i = 0; i < per * 2; i++) order.push(i % 2 === 0 ? first : hammer);
  } else {
    const n = state.sides;
    const start = (hammer + 1) % n;
    for (let r = 0; r < per; r++) for (let i = 0; i < n; i++) order.push((start + i) % n);
  }
  return order;
}

function drawCards(seed: number, end: number, sides: number, party: boolean): (PartyKind | null)[] {
  if (!party) return Array(sides).fill(null);
  const rng = seededRng(mix(seed, 3000 + end));
  return Array.from({ length: sides }, () => PARTY_KINDS[Math.floor(rng() * PARTY_KINDS.length)]);
}

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): CurlingState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const opts = normalizeOptions(count, options);
  const sides = opts.mode === "team" ? 2 : count;
  const sideOf = Array.from({ length: count }, (_, s) => (opts.mode === "team" ? s % 2 : s));
  const members: Seat[][] = Array.from({ length: sides }, (_, side) => sideOf.map((sd, seat) => (sd === side ? seat : -1)).filter((s) => s >= 0));
  const rng = seededRng(mix(seed, 7));
  const hammer = Math.floor(rng() * sides);
  const base = { options: opts, playerCount: count, sides };
  return {
    seed,
    playerCount: count,
    options: opts,
    sides,
    sideOf,
    members,
    end: 0,
    extraEnds: 0,
    phase: "aim",
    stones: [],
    order: buildOrder(base, hammer),
    throwIndex: 0,
    rotation: Array(sides).fill(0),
    hammer,
    scores: Array(sides).fill(0),
    history: [],
    cards: drawCards(seed, 0, sides, opts.party),
    nextStoneId: 0,
    turn: 0,
    lastThrow: null,
    statTally: {},
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentSide(state: CurlingState): number {
  return state.order[state.throwIndex] ?? 0;
}

/** Whose throw it is (null between ends). */
export function currentThrower(state: CurlingState): Seat | null {
  if (state.phase !== "aim") return null;
  const side = currentSide(state);
  const m = state.members[side];
  return m[state.rotation[side] % m.length];
}

export const currentActor = currentThrower;

/** Stones each side still has to throw this end. */
export function stonesLeft(state: CurlingState): number[] {
  const left = Array(state.sides).fill(0);
  for (let i = state.throwIndex; i < state.order.length; i++) left[state.order[i]] += 1;
  return left;
}

export function isLastStone(state: CurlingState): boolean {
  return state.throwIndex === state.order.length - 1;
}

/** §9 — who would score if the end stopped right now. */
export function measure(stones: readonly Stone[]): { scorer: number | null; points: number; counting: number[]; ranked: { stone: Stone; dist: number }[] } {
  const ranked = stones
    .filter((s) => inHouse(s))
    .map((stone) => ({ stone, dist: distToButton(stone.x, stone.y) }))
    .sort((a, b) => a.dist - b.dist || a.stone.id - b.stone.id);
  if (ranked.length === 0) return { scorer: null, points: 0, counting: [], ranked };
  const top = ranked[0];
  const scorer = top.stone.side;
  // two sides equally close → nobody scores (§9 동률)
  if (ranked.some((r) => r.stone.side !== scorer && r.dist === top.dist)) return { scorer: null, points: 0, counting: [], ranked };
  const rival = ranked.find((r) => r.stone.side !== scorer);
  const counting = ranked.filter((r) => r.stone.side === scorer && (!rival || r.dist < rival.dist)).map((r) => r.stone.id);
  return { scorer, points: counting.length, counting, ranked };
}

// ---------------------------------------------------------------------------
// Throw resolution (§4–§8)
// ---------------------------------------------------------------------------

function sanitizeSweep(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_FRAMES).map((x) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(10, Math.round(x))) : 0));
}

export function sanitizeParams(aim: unknown, weight: unknown, spin: unknown): Omit<ThrowParams, "kind"> {
  const a = typeof aim === "number" && Number.isFinite(aim) ? aim : 0;
  const w = typeof weight === "number" && Number.isFinite(weight) ? weight : 0.4;
  return {
    aim: quantize(Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, a)), 0.005),
    weight: quantize(Math.max(0, Math.min(1, w)), 0.001),
    spin: spin === -1 ? -1 : 1,
  };
}

/**
 * §8 — the stones that stay after a throw: the simulation's resting stones,
 * or (free-guard-zone violation) the stones from before with the delivered
 * stone removed. Shared with the bots so they never plan an illegal takeout.
 */
export function resolveStones(state: CurlingState, side: number, before: readonly Stone[], sim: ThrowSim): { stones: Stone[]; fgzReset: boolean } {
  const after = sim.restingStones();
  if (state.throwIndex < fgzThrows(state)) {
    const alive = new Set(after.map((s) => s.id));
    const violated = before.some((s) => s.side !== side && inFreeGuardZone(s) && !alive.has(s.id));
    if (violated) return { stones: before.map((s) => ({ ...s })), fgzReset: true };
  }
  return { stones: after, fgzReset: false };
}

function classify(before: readonly Stone[], sim: ThrowSim, after: readonly Stone[], side: number, fgzReset: boolean): ShotCall {
  const d = sim.deliveredStone();
  const alive = new Set(after.map((s) => s.id));
  const removedOpp = before.filter((s) => s.side !== side && !alive.has(s.id)).length;
  const removedOwn = before.filter((s) => s.side === side && !alive.has(s.id)).length;
  const call = (key: ShotKey): ShotCall => ({ key, removedOpp, removedOwn });
  if (fgzReset) return { key: "fgz", removedOpp: 0, removedOwn: 0 };
  if (sim.events.some((e) => e.kind === "bomb")) return call("bomb");
  if (removedOpp >= 3) return call("triple");
  if (removedOpp === 2) return call("double");
  const stayed = d.out === null;
  if (removedOpp === 1) return call(stayed && inHouse(d) ? "hitStay" : "takeout");
  if (removedOwn > 0) return call("ownGoal");
  if (sim.events.some((e) => e.kind === "stick")) return call("stick");
  if (d.out === "hog") return call("hog");
  if (d.out === "side") return call("side");
  if (d.out === "back") return call(sim.contact ? "nudge" : "through");
  if (sim.contact) {
    // raise: an own stone we hit ended up in the house
    const hitOwn = sim.events.some((e) => {
      if (e.kind !== "hit") return false;
      const other = e.a === d.id ? e.b : e.b === d.id ? e.a : null;
      if (other === null) return false;
      const o = after.find((s) => s.id === other);
      const was = before.find((s) => s.id === other);
      return !!o && !!was && o.side === side && inHouse(o) && distToButton(o.x, o.y) < distToButton(was.x, was.y) - 0.3;
    });
    if (hitOwn) return call("raise");
  }
  if (inHouse(d)) {
    if (distToButton(d.x, d.y) <= BUTTON_R + STONE_R * 0.5) return call("button");
    if (after.some((s) => s.id !== d.id && (s.x - d.x) * (s.x - d.x) + (s.y - d.y) * (s.y - d.y) <= (2 * STONE_R + 0.03) * (2 * STONE_R + 0.03))) return call("freeze");
    const m = measure(after);
    if (m.ranked[0]?.stone.id === d.id) return call("shot");
    return call("house");
  }
  if (sim.contact) return call("nudge");
  return call("guard");
}

function sideSeats(state: CurlingState, side: number): Seat[] {
  return state.members[side] ?? [];
}

function doThrow(state: CurlingState, seat: Seat, params: Omit<ThrowParams, "kind">, useCard: boolean, own: number[], opp: number[], auto: boolean): CurlingState {
  if (state.phase !== "aim" || currentThrower(state) !== seat) return state;
  const side = currentSide(state);
  const kind = useCard && state.options.party ? state.cards[side] : null;
  const full: ThrowParams = { ...params, kind };
  const before = state.stones.map((s) => ({ ...s }));
  const stoneId = state.nextStoneId;
  const sim = runThrow(before, full, side, stoneId, own, opp);
  const { stones, fgzReset } = resolveStones(state, side, before, sim);
  const call = classify(before, sim, stones, side, fgzReset);

  let tally = tallyAdd(state.statTally, seat, "throws");
  if (call.key === "button") tally = tallyAdd(tally, seat, "buttons");
  if (call.removedOpp > 0) tally = tallyAdd(tally, seat, "takeouts", call.removedOpp);
  if (call.removedOpp >= 2) tally = tallyAdd(tally, seat, "doubles");
  if (call.key === "freeze") tally = tallyAdd(tally, seat, "freezes");
  if (kind) tally = tallyAdd(tally, seat, "partyStones");
  if (call.key === "hog") tally = tallyAdd(tally, seat, "hogs");
  tally = tallyMax(tally, seat, "maxRemoved", call.removedOpp);

  const cards = [...state.cards];
  if (kind) cards[side] = null;
  const rotation = [...state.rotation];
  rotation[side] += 1;
  const record: ThrowRecord = { turn: state.turn, seat, side, stoneId, params: full, own, opp, before, call, fgzReset, auto };
  const next: CurlingState = {
    ...state,
    stones,
    cards,
    rotation,
    throwIndex: state.throwIndex + 1,
    nextStoneId: stoneId + 1,
    turn: state.turn + 1,
    lastThrow: record,
    statTally: tally,
  };
  return next.throwIndex >= next.order.length ? scoreEnd(next) : next;
}

/** §9 — count the end. */
function scoreEnd(state: CurlingState): CurlingState {
  const m = measure(state.stones);
  const scores = [...state.scores];
  let tally = state.statTally;
  if (m.scorer !== null) {
    scores[m.scorer] += m.points;
    for (const seat of sideSeats(state, m.scorer)) {
      tally = tallyAdd(tally, seat, "endsWon");
      tally = tallyAdd(tally, seat, "points", m.points);
      tally = tallyMax(tally, seat, "maxEnd", m.points);
      if (state.options.mode === "team" && m.scorer !== state.hammer) tally = tallyAdd(tally, seat, "steals");
    }
  }
  const record: EndRecord = {
    end: state.end,
    scorer: m.scorer,
    points: m.points,
    counting: m.counting,
    stones: state.stones.map((s) => ({ ...s })),
    hammer: state.hammer,
    extra: state.end >= state.options.ends,
  };
  return { ...state, scores, phase: "scored", history: [...state.history, record], statTally: tally };
}

function leadersTied(scores: readonly number[]): boolean {
  const top = Math.max(...scores);
  return scores.filter((s) => s === top).length > 1;
}

/** §11 — next end, extra end, or game over. */
function nextEnd(state: CurlingState): CurlingState {
  if (state.phase !== "scored") return state;
  const played = state.end + 1;
  const regulationOver = played >= state.options.ends;
  let extraEnds = state.extraEnds;
  if (regulationOver) {
    if (!leadersTied(state.scores) || state.extraEnds >= MAX_EXTRA_ENDS) return { ...state, phase: "ended", turn: state.turn + 1 };
    extraEnds += 1;
  }
  const last = state.history[state.history.length - 1];
  let hammer = state.hammer;
  if (state.options.mode === "team") {
    // the scoring side throws first next end; a blank end keeps the hammer (§9)
    if (last?.scorer !== null && last?.scorer !== undefined) hammer = 1 - last.scorer;
  } else {
    // 개인전: the scorer throws first (its predecessor holds the hammer); blank → rotate one seat
    const n = state.sides;
    if (last?.scorer !== null && last?.scorer !== undefined) hammer = (last.scorer + n - 1) % n;
    else hammer = (hammer + 1) % n;
  }
  const end = state.end + 1;
  return {
    ...state,
    end,
    extraEnds,
    phase: "aim",
    stones: [],
    order: buildOrder(state, hammer),
    throwIndex: 0,
    hammer,
    cards: drawCards(state.seed, end, state.sides, state.options.party),
    turn: state.turn + 1,
    lastThrow: null,
  };
}

/** §10 "얼어붙은 손": a plain center guard, no sweep, no party stone. */
export const TIMEOUT_THROW: Omit<ThrowParams, "kind"> = { aim: -0.4, weight: quantize(weightForTravel(24.2), 0.001), spin: 1 };

export function applyAction(state: CurlingState, action: EngineAction): CurlingState {
  switch (action.type) {
    case "throw": {
      if (action.turn !== state.turn) return state;
      const p = sanitizeParams(action.aim, action.weight, action.spin);
      return doThrow(state, action.seat, p, action.useCard === true, sanitizeSweep(action.own), sanitizeSweep(action.opp), false);
    }
    case "timeout": {
      if (action.turn !== state.turn || currentThrower(state) !== action.seat) return state;
      return doThrow(state, action.seat, TIMEOUT_THROW, false, [], [], true);
    }
    case "next":
      if (action.turn !== state.turn) return state;
      return nextEnd(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Rankings (§12)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

/** Side ranks by total score; ties share a rank. */
export function sideRanks(state: CurlingState): number[] {
  return state.scores.map((sc) => 1 + state.scores.filter((o) => o > sc).length);
}

export function computeRankings(state: CurlingState): RankedSeat[] {
  const ranks = sideRanks(state);
  return Array.from({ length: state.playerCount }, (_, seat) => ({ seat, rank: ranks[state.sideOf[seat]] })).sort((a, b) => a.rank - b.rank || a.seat - b.seat);
}

