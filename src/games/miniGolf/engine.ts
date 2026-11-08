/**
 * Pure "미니골프 파티(Mini Golf Party)" rules engine — no React, no I/O.
 * Implements boardGameRule/미니골프파티/미니골프파티.md (section numbers
 * below refer to it): 3/6/9 floating-island holes, one stroke at a time in
 * turn order, penalties for falling off, a stroke cap per hole, and the
 * comeback rule — after each hole the player in last place picks the next
 * hole's obstacle (§8) and tees off last.
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s. A `shot` carries the hit as integers
 * (mm/s and the windmill clock in ms); where the balls end up comes from
 * the deterministic physics in physics.ts, so no client reports a result.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyOf, type StatTally } from "@/games/shared/statTally";
import { HOLE_SETS, HOLES, layoutFor, OBSTACLE_KINDS, type ObstacleKind } from "./course";
import { simulate, V_MAX, WINDMILL_PERIOD, type Layout, type SimBall } from "./physics";

export type Seat = number;

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;
/** §5 — a stroke must be played within this after the balls settle. */
export const SHOT_TIMEOUT_MS = 40_000;
/** §8 — last place has this long to pick the next obstacle. */
export const PICK_TIMEOUT_MS = 20_000;
export const HOLE_CHOICES = [3, 6, 9] as const;
export type HoleCount = (typeof HOLE_CHOICES)[number];
/** §4 — after this many times par without holing out, the ball is picked up. */
export const CAP_MULT = 2;
/** The windup before the ball starts rolling (s) — the windmill clock in a shot is read at the hit. */
export const WINDUP_S = 0.75;

export interface GameOptions {
  holes: HoleCount;
  /** §8 — last place picks the next hole's obstacle. */
  obstacles: boolean;
  /** §6 — balls on the course knock each other. Off: only your own ball is on the course while you play. */
  collisions: boolean;
  /** §5 — 🔰 show the predicted roll while aiming. */
  helper: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { holes: 9, obstacles: true, collisions: true, helper: false };

export type BallStatus = "hand" | "rest" | "holed" | "picked";

export interface Ball {
  x: number;
  y: number;
  status: BallStatus;
}

/** One resolved stroke — the board replays it from `balls` on `hole` + `obstacle`. */
export interface ShotRecord {
  turn: number;
  seat: Seat;
  /** Index into `state.holes`. */
  holeIdx: number;
  holeId: number;
  obstacle: ObstacleKind | null;
  /** This seat's stroke number on the hole (penalties included). */
  stroke: number;
  vx: number;
  vy: number;
  wm: number;
  /** Balls on the course when the stroke was played; `shooter` indexes it. */
  balls: SimBall[];
  shooter: number;
  /** Where the shooter played from (where it goes back to after a fall). */
  from: { x: number; y: number };
  holed: boolean;
  /** The shooter fell off the island (+1 penalty, back to `from`). */
  out: boolean;
  /** Other balls knocked off (they go back where they were) / knocked in (holed!). */
  knockedOut: Seat[];
  knockedIn: Seat[];
  /** The stroke cap was reached — picked up. */
  picked: boolean;
  /** Ran out of time — a whiff (+1 stroke, ball doesn't move). */
  timeout: boolean;
  jumped: boolean;
  windmillPass: boolean;
  windmillHit: boolean;
  /** The seat's score on the hole once it's done (holed or picked up), else null. */
  score: number | null;
  /** The hole is over after this stroke. */
  holeDone: boolean;
  steps: number;
}

export interface PickRecord {
  turn: number;
  seat: Seat;
  kind: ObstacleKind;
  holeIdx: number;
  auto: boolean;
}

export type Phase = "play" | "pick" | "ended";

export interface MiniGolfState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  /** Hole ids in play order. */
  holes: number[];
  /** Obstacle per hole (index matches `holes`). */
  obstacles: (ObstacleKind | null)[];
  holeIdx: number;
  phase: Phase;
  /** Tee order on this hole; strokes go round it, skipping finished balls. */
  order: Seat[];
  activeSeat: Seat;
  /** Picks the next obstacle in the "pick" phase. */
  picker: Seat | null;
  balls: Ball[];
  /** Strokes on the current hole (penalties included). */
  strokes: number[];
  /** scores[seat][holeIdx] — strokes once the hole is done, else null. */
  scores: (number | null)[][];
  turn: number;
  lastShot: ShotRecord | null;
  lastPick: PickRecord | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "shot"; seat: Seat; vx: number; vy: number; wm: number }
  | { type: "pick"; seat: Seat; kind: ObstacleKind }
  | { type: "timeout"; seat: Seat; turn: number };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): MiniGolfState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!HOLE_CHOICES.includes(opts.holes)) opts.holes = DEFAULT_OPTIONS.holes;
  const holes = [...HOLE_SETS[opts.holes]];
  const order = Array.from({ length: n }, (_, s) => s);
  return {
    seed,
    playerCount: n,
    options: opts,
    holes,
    obstacles: holes.map(() => null),
    holeIdx: 0,
    phase: "play",
    order,
    activeSeat: order[0],
    picker: null,
    balls: freshBalls(n),
    strokes: Array(n).fill(0),
    scores: Array.from({ length: n }, () => holes.map(() => null)),
    turn: 0,
    lastShot: null,
    lastPick: null,
  };
}

function freshBalls(n: number): Ball[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, status: "hand" as BallStatus }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentHole(state: MiniGolfState) {
  return HOLES[state.holes[state.holeIdx]];
}

export function parOf(state: MiniGolfState, idx = state.holeIdx): number {
  return HOLES[state.holes[idx]].par;
}

export function capOf(par: number): number {
  return par * CAP_MULT;
}

export function currentLayout(state: MiniGolfState): Layout {
  return layoutFor(state.holes[state.holeIdx], state.obstacles[state.holeIdx]);
}

/** Where the seat plays its next stroke from. */
export function ballSpot(state: MiniGolfState, seat: Seat): { x: number; y: number } {
  const b = state.balls[seat];
  if (!b || b.status === "hand") return { ...currentHole(state).tee };
  return { x: b.x, y: b.y };
}

/** Total strokes so far (finished holes + the current one in progress). */
export function totalOf(state: Pick<MiniGolfState, "scores">, seat: Seat): number {
  return (state.scores[seat] ?? []).reduce<number>((a, s) => a + (s ?? 0), 0);
}

export function liveTotal(state: MiniGolfState, seat: Seat): number {
  const cur = state.scores[seat]?.[state.holeIdx];
  return totalOf(state, seat) + (cur === null || cur === undefined ? (state.phase === "play" ? state.strokes[seat] : 0) : 0);
}

/** Par of the holes the seat has finished — for "−2" style to-par. */
export function parPlayed(state: MiniGolfState, seat: Seat): number {
  let p = 0;
  state.scores[seat]?.forEach((s, i) => {
    if (s !== null) p += parOf(state, i);
  });
  return p;
}

export function toPar(state: MiniGolfState, seat: Seat): number {
  return totalOf(state, seat) - parPlayed(state, seat);
}

export function holeDone(state: MiniGolfState, seat: Seat): boolean {
  const s = state.balls[seat]?.status;
  return s === "holed" || s === "picked";
}

/** Whose decision bots/timeouts drive right now. */
export function currentActor(state: MiniGolfState): Seat | null {
  if (state.phase === "play") return state.activeSeat;
  if (state.phase === "pick") return state.picker;
  return null;
}

/** Shot velocity clamp: the action's integers → m/s. */
export function shotOf(a: { vx: number; vy: number }): { vx: number; vy: number } {
  let vx = Number.isFinite(a.vx) ? a.vx / 1000 : 0;
  let vy = Number.isFinite(a.vy) ? a.vy / 1000 : 0;
  const s = Math.sqrt(vx * vx + vy * vy);
  if (s > V_MAX) {
    vx = (vx * V_MAX) / s;
    vy = (vy * V_MAX) / s;
  }
  return { vx, vy };
}

/** Windmill clock (s) from the action's ms — wraps to one turn, the windup added. */
export function windmillClock(wmMs: number): number {
  const ms = Number.isFinite(wmMs) ? Math.round(wmMs) : 0;
  const period = Math.round(WINDMILL_PERIOD * 1000);
  const m = ((ms % period) + period) % period;
  return m / 1000 + WINDUP_S;
}

export function quantizeShot(vx: number, vy: number, wmS: number): { vx: number; vy: number; wm: number } {
  const period = WINDMILL_PERIOD * 1000;
  const ms = Math.round(((wmS * 1000) % period + period) % period);
  return { vx: Math.round(vx * 1000), vy: Math.round(vy * 1000), wm: ms };
}

/** The balls a stroke plays among: the shooter at its spot, plus (with collisions) every ball resting on the course. */
export function shotBalls(state: MiniGolfState, seat: Seat): { balls: SimBall[]; shooter: number } {
  const balls: SimBall[] = [];
  const from = ballSpot(state, seat);
  balls.push({ id: seat, x: from.x, y: from.y });
  if (state.options.collisions) {
    for (let s = 0; s < state.playerCount; s++) {
      if (s === seat) continue;
      const b = state.balls[s];
      if (b.status === "rest") balls.push({ id: s, x: b.x, y: b.y });
    }
  }
  return { balls, shooter: 0 };
}

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

function nextShooter(state: MiniGolfState, after: Seat): Seat | null {
  const i = state.order.indexOf(after);
  for (let k = 1; k <= state.order.length; k++) {
    const s = state.order[(i + k) % state.order.length];
    if (!holeDone(state, s)) return s;
  }
  return null;
}

function finishStroke(state: MiniGolfState, rec: Omit<ShotRecord, "score" | "holeDone" | "picked">, balls: Ball[], strokes: number[], tally: StatTally | undefined): MiniGolfState {
  const seat = rec.seat;
  const par = parOf(state);
  const cap = capOf(par);
  const scores = state.scores.map((r) => [...r]);
  let picked = false;
  // others knocked in finish the hole on their current count
  for (const s of rec.knockedIn) {
    scores[s][state.holeIdx] = strokes[s];
    tally = scoreTally(tally, s, strokes[s], par);
    tally = tallyAdd(tally, s, "luckyIn");
  }
  if (rec.holed) {
    scores[seat][state.holeIdx] = strokes[seat];
    tally = scoreTally(tally, seat, strokes[seat], par);
  } else if (strokes[seat] >= cap) {
    // §4 — capped: picked up, scored cap + 1
    picked = true;
    balls[seat] = { ...balls[seat], status: "picked" };
    scores[seat][state.holeIdx] = cap + 1;
    tally = tallyAdd(tally, seat, "pickups");
    tally = scoreTally(tally, seat, cap + 1, par);
  }
  const record: ShotRecord = { ...rec, picked, score: scores[seat][state.holeIdx], holeDone: false };
  let next: MiniGolfState = { ...state, balls, strokes, scores, turn: state.turn + 1, lastShot: record, statTally: tally };
  const after = nextShooter(next, seat);
  if (after === null) {
    record.holeDone = true;
    next = endHole(next);
  } else next = { ...next, activeSeat: after };
  return next;
}

function scoreTally(t: StatTally | undefined, seat: Seat, score: number, par: number): StatTally | undefined {
  t = tallyAdd(t, seat, "holes");
  const d = score - par;
  if (score === 1) t = tallyAdd(t, seat, "holeInOnes");
  if (d <= -2) t = tallyAdd(t, seat, "eagles");
  else if (d === -1) t = tallyAdd(t, seat, "birdies");
  else if (d === 0) t = tallyAdd(t, seat, "pars");
  else t = tallyAdd(t, seat, "bogeys");
  return t;
}

function doShot(state: MiniGolfState, seat: Seat, a: { vx: number; vy: number; wm: number }): MiniGolfState {
  if (state.phase !== "play" || seat !== state.activeSeat || holeDone(state, seat)) return state;
  if (![a.vx, a.vy, a.wm].every((v) => Number.isFinite(v))) return state;
  const q = { vx: Math.round(a.vx), vy: Math.round(a.vy), wm: Math.round(a.wm) };
  const v = shotOf(q);
  const L = currentLayout(state);
  const { balls: simBalls, shooter } = shotBalls(state, seat);
  const from = { x: simBalls[shooter].x, y: simBalls[shooter].y };
  const res = simulate(L, simBalls, { shooter, vx: v.vx, vy: v.vy, wm: windmillClock(q.wm) });

  const balls = state.balls.map((b) => ({ ...b }));
  const strokes = [...state.strokes];
  strokes[seat] += 1;
  let tally = tallyAdd(state.statTally, seat, "strokes");
  const knockedOut: Seat[] = [];
  const knockedIn: Seat[] = [];
  let holed = false;
  let out = false;
  for (const r of res.balls) {
    if (r.id === seat) {
      if (r.end === "holed") {
        holed = true;
        balls[seat] = { x: r.x, y: r.y, status: "holed" };
      } else if (r.end === "out") {
        out = true;
        strokes[seat] += 1;
        balls[seat] = { x: from.x, y: from.y, status: "rest" };
        tally = tallyAdd(tally, seat, "falls");
      } else balls[seat] = { x: r.x, y: r.y, status: "rest" };
      continue;
    }
    const before = state.balls[r.id];
    if (r.end === "holed") {
      knockedIn.push(r.id);
      balls[r.id] = { x: r.x, y: r.y, status: "holed" };
    } else if (r.end === "out") {
      knockedOut.push(r.id);
      balls[r.id] = { ...before };
    } else {
      const moved = Math.abs(r.x - before.x) + Math.abs(r.y - before.y) > 1e-6;
      balls[r.id] = { x: r.x, y: r.y, status: "rest" };
      if (moved) tally = tallyAdd(tally, seat, "bumps");
    }
  }
  if (knockedOut.length) tally = tallyAdd(tally, seat, "knockOffs", knockedOut.length);
  if (knockedIn.length) tally = tallyAdd(tally, seat, "gifts", knockedIn.length);
  if (res.jumped && !out) tally = tallyAdd(tally, seat, "jumps");
  if (res.windmillPass) tally = tallyAdd(tally, seat, "windmillPasses");
  if (holed && state.obstacles[state.holeIdx] && L.ramps.length + (L.windmill ? 1 : 0) + L.magnets.length > 0) tally = tallyAdd(tally, seat, "obstacleHoles");
  return finishStroke(
    state,
    {
      turn: state.turn,
      seat,
      holeIdx: state.holeIdx,
      holeId: state.holes[state.holeIdx],
      obstacle: state.obstacles[state.holeIdx],
      stroke: state.strokes[seat] + 1,
      vx: q.vx,
      vy: q.vy,
      wm: q.wm,
      balls: simBalls,
      shooter,
      from,
      holed,
      out,
      knockedOut,
      knockedIn,
      timeout: false,
      jumped: res.jumped,
      windmillPass: res.windmillPass,
      windmillHit: res.windmillHit,
      steps: res.steps,
    },
    balls,
    strokes,
    tally,
  );
}

function doTimeout(state: MiniGolfState, seat: Seat, turn: number): MiniGolfState {
  if (turn !== state.turn) return state;
  if (state.phase === "pick" && seat === state.picker) {
    const rng = seededRng((state.seed ^ 0x51c7) + state.holeIdx * 131);
    return doPick(state, seat, OBSTACLE_KINDS[Math.floor(rng() * OBSTACLE_KINDS.length)], true);
  }
  if (state.phase !== "play" || seat !== state.activeSeat || holeDone(state, seat)) return state;
  const balls = state.balls.map((b) => ({ ...b }));
  const strokes = [...state.strokes];
  strokes[seat] += 1;
  const from = ballSpot(state, seat);
  // a whiff at the tee still puts the ball down on the tee
  if (balls[seat].status === "hand") balls[seat] = { x: from.x, y: from.y, status: "rest" };
  const tally = tallyAdd(tallyAdd(state.statTally, seat, "strokes"), seat, "timeouts");
  return finishStroke(
    state,
    {
      turn: state.turn,
      seat,
      holeIdx: state.holeIdx,
      holeId: state.holes[state.holeIdx],
      obstacle: state.obstacles[state.holeIdx],
      stroke: strokes[seat],
      vx: 0,
      vy: 0,
      wm: 0,
      balls: [{ id: seat, x: from.x, y: from.y }],
      shooter: 0,
      from,
      holed: false,
      out: false,
      knockedOut: [],
      knockedIn: [],
      timeout: true,
      jumped: false,
      windmillPass: false,
      windmillHit: false,
      steps: 0,
    },
    balls,
    strokes,
    tally,
  );
}

// ---------------------------------------------------------------------------
// Between holes (§7, §8)
// ---------------------------------------------------------------------------

/** Last place right now (most strokes; ties → worse on the latest hole → later in the tee order). */
export function lastPlace(state: MiniGolfState): Seat {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const latest = (s: Seat) => state.scores[s][state.holeIdx] ?? 0;
  const pos = (s: Seat) => state.order.indexOf(s);
  return [...seats].sort((a, b) => totalOf(state, b) - totalOf(state, a) || latest(b) - latest(a) || pos(b) - pos(a))[0];
}

function endHole(state: MiniGolfState): MiniGolfState {
  if (state.holeIdx >= state.holes.length - 1) return { ...state, phase: "ended", picker: null };
  if (state.options.obstacles) return { ...state, phase: "pick", picker: lastPlace(state) };
  return startHole(state, state.holeIdx + 1, null);
}

/** Tee order for the next hole: best total first (ties keep the old order), the picker always last. */
export function teeOrder(state: MiniGolfState, picker: Seat | null): Seat[] {
  const pos = (s: Seat) => state.order.indexOf(s);
  const seats = Array.from({ length: state.playerCount }, (_, s) => s).sort((a, b) => totalOf(state, a) - totalOf(state, b) || pos(a) - pos(b));
  if (picker === null) return seats;
  return [...seats.filter((s) => s !== picker), picker];
}

function startHole(state: MiniGolfState, idx: number, picker: Seat | null): MiniGolfState {
  const order = teeOrder(state, picker);
  return {
    ...state,
    holeIdx: idx,
    phase: "play",
    picker: null,
    order,
    activeSeat: order[0],
    balls: freshBalls(state.playerCount),
    strokes: Array(state.playerCount).fill(0),
    turn: state.turn + 1,
  };
}

function doPick(state: MiniGolfState, seat: Seat, kind: ObstacleKind, auto = false): MiniGolfState {
  if (state.phase !== "pick" || seat !== state.picker || !OBSTACLE_KINDS.includes(kind)) return state;
  const idx = state.holeIdx + 1;
  const obstacles = [...state.obstacles];
  obstacles[idx] = kind;
  let tally = state.statTally;
  if (!auto) tally = tallyAdd(tally, seat, "picks");
  const next = startHole({ ...state, obstacles, statTally: tally, lastPick: { turn: state.turn, seat, kind, holeIdx: idx, auto } }, idx, seat);
  return next;
}

export function applyAction(state: MiniGolfState, action: EngineAction): MiniGolfState {
  switch (action?.type) {
    case "shot":
      return doShot(state, action.seat, action);
    case "pick":
      return doPick(state, action.seat, action.kind);
    case "timeout":
      return doTimeout(state, action.seat, action.turn);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Rankings (§9)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

export function holeInOnesOf(state: MiniGolfState, seat: Seat): number {
  return tallyOf(state.statTally, seat).holeInOnes ?? 0;
}

/** Holes at par or better. */
export function goodHolesOf(state: MiniGolfState, seat: Seat): number {
  const t = tallyOf(state.statTally, seat);
  return (t.eagles ?? 0) + (t.birdies ?? 0) + (t.pars ?? 0);
}

/** Fewest strokes wins; ties → more hole-in-ones → more holes at par or better. */
export function computeRankings(state: MiniGolfState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => [-liveTotal(state, s), holeInOnesOf(state, s), goodHolesOf(state, s)];
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

/** Golf names for a hole score against par. */
export function scoreName(score: number, par: number): string {
  if (score === 1) return "홀인원";
  const d = score - par;
  if (d <= -3) return "알바트로스";
  if (d === -2) return "이글";
  if (d === -1) return "버디";
  if (d === 0) return "파";
  if (d === 1) return "보기";
  if (d === 2) return "더블 보기";
  if (d === 3) return "트리플 보기";
  return `+${d}`;
}

export { OBSTACLE_KINDS, type ObstacleKind };
