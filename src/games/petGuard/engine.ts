/**
 * 🐶 멍냥 방어선 (Pet Guard) — an original 2~4 player simultaneous
 * "build, then watch the disaster" strategy game.
 * Rules + tuning: boardGameRule/멍냥방어선/멍냥방어선.md.
 *
 * §2 6 rounds. Each round everyone faces the SAME hazard situation on their
 *    own copy of the map (tier 1 → 2 → 3 over the rounds).
 * §3 Design (simultaneous, 90 s): spend the round's 🪙 budget on pieces
 *    and pick one of 3 dealt 🎴 twist cards to send to the NEXT seat.
 * §4 When everyone has submitted, every board is simulated (sim.ts) with the
 *    twist it received from the previous seat.
 * §5 Survive = 10 + unspent 🪙; hit at tick t = ⌊7·t/T⌋. Highest total
 *    after 6 rounds wins; ties → more rounds survived, then fewer 🪙 spent.
 *
 * Lockstep like every other online room (docs/cloud-sync.md): all clients
 * replay the same actions. The simulation is deterministic, so results are
 * computed inside `applyAction` on every client. Submitted layouts travel in
 * the action stream (the board hides other seats until the reveal).
 */
import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { layoutCost, roundScore, runSim, sanitizeLayout, TWISTS, type HitCause, type Piece } from "./sim";
import { SCENARIOS, TIER_OF_ROUND } from "./scenarios";
import { chooseTwist, designLayout } from "./bot";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const ROUNDS = 6;
export const DESIGN_MS = 90_000;
export const HAND = 3;

export interface Submission {
  pieces: Piece[];
  twist: number;
}

export interface SeatResult {
  seat: SeatIndex;
  /** Twist this seat received (from the previous seat). */
  twistIn: number;
  survived: boolean;
  hitTick: number | null;
  cause: HitCause | null;
  ticks: number;
  spent: number;
  score: number;
}

export interface RoundRecord {
  scenario: string;
  seed: number;
  subs: Submission[];
  results: SeatResult[];
}

export type Phase = "design" | "result" | "gameOver";

export interface PetState {
  playerCount: number;
  seed: number;
  phase: Phase;
  round: number;
  /** Scenario id per round, fixed at the start. */
  scenarios: string[];
  /** Dealt twist ids per seat this round. */
  hands: number[][];
  subs: (Submission | null)[];
  history: RoundRecord[];
  scores: number[];
  /** Result phase: seat finished watching (all true → next round starts). */
  ready?: boolean[];
  /** Result phase: seat voted to skip the replay (view-only; the board jumps to the table once a majority of humans voted). */
  skip?: boolean[];
  seq: number;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "submit"; seat: SeatIndex; round: number; pieces: Piece[]; twist: number }
  /** Host: fill every seat that hasn't submitted when the timer ran out (auto layout). */
  | { type: "force"; round: number }
  | { type: "next"; round: number }
  /** Result phase: this seat is done watching. Everyone ready → next round. */
  | { type: "ready"; seat: SeatIndex; round: number }
  /** Result phase: toggle this seat's "skip the replay" vote. */
  | { type: "skip"; seat: SeatIndex; round: number };

export function isStateSyncStale(current: PetState | null, synced: PetState): boolean {
  if (!current) return false;
  if (synced.seed !== current.seed) return false;
  return synced.seq < current.seq;
}

export function roundSeed(state: PetState, round = state.round): number {
  return (Math.imul(state.seed | 0, 7919) + Math.imul(round + 1, 104729)) | 0;
}

export function scenarioOf(state: PetState, round = state.round) {
  return SCENARIOS.find((s) => s.id === state.scenarios[round]) ?? SCENARIOS[0];
}

function dealHands(seed: number, round: number, n: number): number[][] {
  const rng = seededRng((seed ^ Math.imul(round + 3, 0x9e3779b1)) | 0);
  return Array.from({ length: n }, () => shuffle(TWISTS.map((t) => t.id), rng).slice(0, HAND));
}

export function startGame(playerCount: number, seed: number): PetState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const rng = seededRng(seed);
  const scenarios: string[] = [];
  for (const tier of [1, 2, 3] as const) {
    const pool = shuffle(SCENARIOS.filter((s) => s.tier === tier).map((s) => s.id), rng);
    scenarios.push(...pool.slice(0, TIER_OF_ROUND.filter((t) => t === tier).length));
  }
  return {
    playerCount: n,
    seed,
    phase: "design",
    round: 0,
    scenarios,
    hands: dealHands(seed, 0, n),
    subs: Array(n).fill(null),
    history: [],
    scores: Array(n).fill(0),
    seq: 0,
  };
}

/** Lowest seat that still has to submit (simultaneous phase), else null. */
export function currentActor(state: PetState): SeatIndex | null {
  if (state.phase !== "design") return null;
  const i = state.subs.findIndex((s) => s === null);
  return i >= 0 ? i : null;
}

export function pendingSeats(state: PetState): SeatIndex[] {
  if (state.phase !== "design") return [];
  return state.subs.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0);
}

/** Who sends to / receives from whom: seat s sends its twist to s+1. */
export function targetOf(state: PetState, seat: SeatIndex): SeatIndex {
  return (seat + 1) % state.playerCount;
}
export function senderOf(state: PetState, seat: SeatIndex): SeatIndex {
  return (seat - 1 + state.playerCount) % state.playerCount;
}

/** Deterministic auto layout for a seat that ran out of time / a bot. */
export function autoSubmission(state: PetState, seat: SeatIndex, level: number): Submission {
  const sc = scenarioOf(state);
  const rs = roundSeed(state);
  const botSeed = (rs ^ Math.imul(seat + 1, 0x85ebca6b)) | 0;
  const pieces = designLayout(sc, level, rs, botSeed);
  const hand = state.hands[seat] ?? [0];
  return { pieces, twist: chooseTwist(sc, hand, level, rs, botSeed, pieces) };
}

function clone(s: PetState): PetState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    subs: [...s.subs],
    history: [...s.history],
    scores: [...s.scores],
    ready: s.ready ? [...s.ready] : undefined,
    skip: s.skip ? [...s.skip] : undefined,
  };
}

/** Skip votes needed among `humans` people: half or more (1 of 1, 1 of 2, 2 of 3, 2 of 4). */
export function skipNeeded(humans: number): number {
  return Math.ceil(Math.max(1, humans) / 2);
}

function resolveRound(s: PetState) {
  const sc = scenarioOf(s);
  const seed = roundSeed(s);
  const subs = s.subs as Submission[];
  const results: SeatResult[] = subs.map((sub, seat) => {
    const twistIn = subs[senderOf(s, seat)].twist;
    const o = runSim(sc, sub.pieces, twistIn, seed);
    const spent = layoutCost(sub.pieces);
    const score = roundScore(sc, o, spent);
    let t = s.statTally;
    t = tallyAdd(t, seat, "rounds");
    if (o.survived) t = tallyAdd(t, seat, "survived");
    if (o.survived) t = tallyAdd(t, seat, "coinsSaved", Math.max(0, sc.budget - spent));
    t = tallyAdd(t, seat, "pieces", sub.pieces.length);
    t = tallyAdd(t, seat, "drained", o.drained);
    t = tallyAdd(t, seat, "drowned", o.drowned);
    t = tallyAdd(t, seat, "rodCatches", o.rodCatches);
    if (o.survived && sc.tier === 3) t = tallyAdd(t, seat, "tier3Survived");
    if (o.survived && sub.pieces.length === 0) t = tallyAdd(t, seat, "bareSurvived");
    t = tallyMax(t, seat, "maxRound", score);
    s.statTally = t;
    return { seat, twistIn, survived: o.survived, hitTick: o.hitTick, cause: o.cause, ticks: o.ticks, spent, score };
  });
  // the sender gets a "twist landed" stat when the target was hit
  for (const r of results) if (!r.survived) s.statTally = tallyAdd(s.statTally, senderOf(s, r.seat), "twistHits");
  results.forEach((r) => (s.scores[r.seat] += r.score));
  s.history.push({ scenario: sc.id, seed, subs, results });
  s.phase = "result";
  s.ready = Array(s.playerCount).fill(false);
  s.skip = Array(s.playerCount).fill(false);
}

function advance(s: PetState): PetState {
  s.ready = undefined;
  s.skip = undefined;
  if (s.round + 1 >= ROUNDS) {
    s.phase = "gameOver";
    for (const r of computeRankings(s)) {
      s.statTally = tallyMax(s.statTally, r.seat, "maxScore", r.total);
      if (finalRows(s)[r.seat].survived === ROUNDS) s.statTally = tallyAdd(s.statTally, r.seat, "flawless");
    }
    return s;
  }
  s.round++;
  s.phase = "design";
  s.hands = dealHands(s.seed, s.round, s.playerCount);
  s.subs = Array(s.playerCount).fill(null);
  return s;
}

export function applyAction(state: PetState, a: EngineAction): PetState {
  if (state.phase === "gameOver") return state;
  if (a.type === "submit") {
    if (state.phase !== "design" || a.round !== state.round) return state;
    if (!Number.isInteger(a.seat) || a.seat < 0 || a.seat >= state.playerCount || state.subs[a.seat]) return state;
    const hand = state.hands[a.seat];
    const twist = hand.includes(a.twist) ? a.twist : hand[0];
    const s = clone(state);
    s.subs[a.seat] = { pieces: sanitizeLayout(scenarioOf(s), Array.isArray(a.pieces) ? a.pieces : []), twist };
    s.seq++;
    if (s.subs.every((x) => x)) resolveRound(s);
    return s;
  }
  if (a.type === "force") {
    if (state.phase !== "design" || a.round !== state.round) return state;
    const s = clone(state);
    for (let seat = 0; seat < s.playerCount; seat++) {
      if (!s.subs[seat]) {
        s.subs[seat] = autoSubmission(s, seat, 3);
        s.statTally = tallyAdd(s.statTally, seat, "timeouts");
      }
    }
    s.seq++;
    resolveRound(s);
    return s;
  }
  if (a.type === "next") {
    if (state.phase !== "result" || a.round !== state.round) return state;
    const s = clone(state);
    s.seq++;
    return advance(s);
  }
  if (a.type === "ready" || a.type === "skip") {
    if (state.phase !== "result" || a.round !== state.round) return state;
    if (!Number.isInteger(a.seat) || a.seat < 0 || a.seat >= state.playerCount) return state;
    const s = clone(state);
    const ready = s.ready ?? Array(s.playerCount).fill(false);
    const skip = s.skip ?? Array(s.playerCount).fill(false);
    if (a.type === "ready") {
      if (ready[a.seat]) return state;
      ready[a.seat] = true;
    } else skip[a.seat] = !skip[a.seat];
    s.ready = ready;
    s.skip = skip;
    s.seq++;
    if (ready.every(Boolean)) return advance(s);
    return s;
  }
  return state;
}

export interface FinalRow {
  seat: SeatIndex;
  total: number;
  survived: number;
  spent: number;
}

export function finalRows(state: PetState): FinalRow[] {
  return state.scores.map((total, seat) => ({
    seat,
    total,
    survived: state.history.filter((h) => h.results[seat]?.survived).length,
    spent: state.history.reduce((a, h) => a + (h.results[seat]?.spent ?? 0), 0),
  }));
}

export interface RankedSeat {
  seat: SeatIndex;
  total: number;
  rank: number;
}

/** Higher total; ties → more rounds survived, then fewer coins spent; still tied = shared rank. */
export function computeRankings(state: PetState): RankedSeat[] {
  const rows = finalRows(state);
  const cmp = (a: FinalRow, b: FinalRow) => b.total - a.total || b.survived - a.survived || a.spent - b.spent;
  const sorted = [...rows].sort((a, b) => cmp(a, b) || a.seat - b.seat);
  return sorted.map((r) => ({ seat: r.seat, total: r.total, rank: sorted.findIndex((x) => cmp(x, r) === 0) + 1 }));
}
