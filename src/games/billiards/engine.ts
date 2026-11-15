/**
 * Pure "당구 파티(Billiards Party)" rules engine — no React, no I/O.
 * Implements boardGameRule/당구파티/당구파티.md (section numbers below refer
 * to it). Two modes on the same deterministic table (physics.ts):
 *
 * - 🎱 럭키 포켓 (§6): nine numbered balls; the cue must touch the lowest
 *   number first; every legally pocketed ball scores (⭐9 = 3), the glowing
 *   lucky pocket doubles it, and a pot lets you shoot again. Fouls cost a
 *   point and hand the next player the cue ball.
 * - 🎯 캐롬 파티 (§7): no pockets; one shared white cue ball, two reds and a
 *   yellow spoiler. Touch both reds without the yellow = +1 and again
 *   (3+ cushions before the second red = ⭐ +2); touching the yellow = −1.
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s; a `shoot` only carries integers, the
 * outcome comes from re-simulating the physics.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { HALF_H, HALF_W, POCKETS, R, simulate, spotFree, V_MAX, type SimBall, type SimPot, type SimResult } from "./physics";

export type Seat = number;
export type Mode = "pocket" | "carom";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** §4 */
export const AIM_TIMEOUT_MS = 40_000;
/** §6 — a pocket game ends after this many shots even if balls remain. */
export const POCKET_SHOT_LIMIT = 90;
/** §7 */
export const CAROM_SHOT_LIMIT = 70;
export const CAROM_TARGETS = [3, 5, 8] as const;
export const FOUL_PENALTY = 1;
/** Ball 9 (⭐ gold) value; every other numbered ball is worth 1. */
export const GOLD_POINTS = 3;
export const THREE_CUSHION_POINTS = 2;

export const CUE_ID = 0;
/** Carom ball ids. */
export const RED_A = 1;
export const RED_B = 2;
export const YELLOW = 3;

export interface GameOptions {
  mode: Mode;
  /** Pocket mode: racks to play (scores add up). */
  racks: 1 | 2 | 3;
  /** Carom mode: first to this many points. */
  target: number;
  /** Long guide (object-ball path + cue deflection) or only the ghost ball. */
  guide: "long" | "short";
}

export const DEFAULT_OPTIONS: GameOptions = { mode: "pocket", racks: 1, target: 5, guide: "long" };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const mode: Mode = o?.mode === "carom" ? "carom" : "pocket";
  const racks = o?.racks === 2 || o?.racks === 3 ? o.racks : 1;
  const t = Number(o?.target);
  const target = (CAROM_TARGETS as readonly number[]).includes(t) ? t : 5;
  return { mode, racks, target, guide: o?.guide === "short" ? "short" : "long" };
}

export interface Ball {
  id: number;
  x: number;
  y: number;
}

/** What one resolved shot did — the board replays it from `before`. */
export interface ShotRecord {
  turn: number;
  seat: Seat;
  vx: number;
  vy: number;
  spin: number;
  side: number;
  /** Cue ball spot when it was placed by hand this shot (else null). */
  placed: { x: number; y: number } | null;
  before: Ball[];
  /** Ids pocketed, in order. */
  potted: number[];
  /** Points gained (can be negative). */
  points: number;
  foul: FoulKind | null;
  /** Pocket mode: balls that scored and their value (after the lucky ×2). */
  scored: { id: number; pts: number; lucky: boolean }[];
  /** Carom: both reds were touched cleanly. */
  carom: boolean;
  /** Carom: cushions before the second red (≥3 = ⭐). */
  cushions: number;
  /** Gold 9 put back on its spot after a foul. */
  respotted: boolean;
  /** Shooter keeps the cue. */
  again: boolean;
  /** First ball the cue touched (−1 = none). */
  firstHit: number;
  steps: number;
}

export type FoulKind = "scratch" | "miss" | "wrongFirst" | "yellow";

export interface RackRecord {
  rack: number;
  scores: number[];
  shots: number;
  limitHit: boolean;
}

export type Phase = "aim" | "rackOver" | "ended";

export interface BilliardsState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  rack: number;
  balls: Ball[];
  activeSeat: Seat;
  phase: Phase;
  /** Monotonic action counter — animation key and stale-timeout guard. */
  turn: number;
  /** Shots this rack (pocket) / this game (carom). */
  shots: number;
  /** The active player may place the cue ball anywhere first (after a foul). */
  ballInHand: boolean;
  /** Pocket mode: index into POCKETS of the glowing ×2 pocket (−1 = carom). */
  lucky: number;
  scores: number[];
  /** Balls pocketed (legally) per seat — tiebreak. */
  potted: number[];
  fouls: number[];
  /** Pocket mode: rack wins (most points that rack). */
  rackWins: number[];
  lastShot: ShotRecord | null;
  lastPass: { turn: number; seat: Seat } | null;
  history: RackRecord[];
  /** Per-rack score snapshot at its start (to compute each rack's points). */
  rackStart: number[];
  /** Carom: seat that reached the target first (−1 = none yet). */
  winner: Seat;
  /** Carom: who opened the game — an "inning" is one pass of turns starting here. */
  openSeat: Seat;
  /** Carom: someone reached the target, the rest of this inning still gets to shoot (equal innings, §7). */
  finalInning: boolean;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "shoot"; seat: Seat; vx: number; vy: number; spin: number; side: number; place?: { x: number; y: number } | null }
  | { type: "timeout"; seat: Seat; turn: number }
  | { type: "next"; seat?: Seat };

// ---------------------------------------------------------------------------
// Setup (§3)
// ---------------------------------------------------------------------------

/** Head spot (cue ball start) and foot spot (rack apex). */
export const HEAD_X = -HALF_W * 0.5;
export const FOOT_X = HALF_W * 0.5;

/** Nine-ball diamond: 1 at the apex, 9 in the middle, the rest shuffled by seed. */
export function rackPocket(seed: number): Ball[] {
  const rng = seededRng(seed ^ 0x9b17);
  const rest = [2, 3, 4, 5, 6, 7, 8];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // rows of the diamond (along +x): 1, 2, 3, 2, 1
  const gap = 2 * R * 1.004;
  const rowDx = gap * 0.8660254037844386;
  const rows = [1, 2, 3, 2, 1];
  const out: Ball[] = [];
  let k = 0;
  rows.forEach((cnt, r) => {
    for (let c = 0; c < cnt; c++) {
      const yv = (c - (cnt - 1) / 2) * gap;
      let id: number;
      if (r === 0) id = 1;
      else if (r === 2 && c === 1) id = 9;
      else id = rest[k++];
      out.push({ id, x: Math.round((FOOT_X + r * rowDx) * 1e6) / 1e6, y: Math.round(yv * 1e6) / 1e6 });
    }
  });
  out.push({ id: CUE_ID, x: HEAD_X, y: 0 });
  return out.sort((a, b) => a.id - b.id);
}

/** Carom opening: cue at the head spot, a red on the foot spot, the other red and the yellow beside the head. */
export function rackCarom(): Ball[] {
  return [
    { id: CUE_ID, x: HEAD_X, y: -1.6 },
    { id: RED_A, x: FOOT_X, y: 0 },
    { id: RED_B, x: HEAD_X, y: 0 },
    { id: YELLOW, x: HEAD_X, y: 1.6 },
  ];
}

function luckyFor(seed: number, shotNo: number): number {
  const r = seededRng((seed ^ 0x1c4a) + shotNo * 7919)();
  return Math.floor(r * POCKETS.length);
}

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): BilliardsState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts = sanitizeOptions(options);
  const first = Math.floor(seededRng(seed ^ 0x51ed)() * n);
  return {
    seed,
    playerCount: n,
    options: opts,
    rack: 0,
    balls: opts.mode === "pocket" ? rackPocket(seed) : rackCarom(),
    activeSeat: first,
    phase: "aim",
    turn: 0,
    shots: 0,
    ballInHand: false,
    lucky: opts.mode === "pocket" ? luckyFor(seed, 0) : -1,
    scores: Array(n).fill(0),
    potted: Array(n).fill(0),
    fouls: Array(n).fill(0),
    rackWins: Array(n).fill(0),
    lastShot: null,
    lastPass: null,
    history: [],
    rackStart: Array(n).fill(0),
    winner: -1,
    openSeat: first,
    finalInning: false,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const isPocket = (s: Pick<BilliardsState, "options">) => s.options.mode === "pocket";

export function ballValue(id: number): number {
  return id === 9 ? GOLD_POINTS : 1;
}

/** Pocket mode: the lowest-numbered ball on the table (−1 = none). */
export function lowestBall(balls: readonly Ball[]): number {
  let m = 99;
  for (const b of balls) if (b.id !== CUE_ID && b.id < m) m = b.id;
  return m === 99 ? -1 : m;
}

export function toSim(balls: readonly Ball[]): SimBall[] {
  return balls.map((b) => ({ id: b.id, x: b.x, y: b.y }));
}

export function nextSeat(state: Pick<BilliardsState, "playerCount">, from: Seat): Seat {
  return (from + 1) % state.playerCount;
}

/** Quantised shot the action carries (milli-units/s, magnitude ≤ V_MAX). */
export function quantizeShot(vx: number, vy: number): { vx: number; vy: number } {
  const s = Math.sqrt(vx * vx + vy * vy);
  const k = s > V_MAX ? V_MAX / s : 1;
  return { vx: Math.round(vx * k * 1000), vy: Math.round(vy * k * 1000) };
}

export const quantizeSpin = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 1000);

export function shotVelocity(vxMilli: number, vyMilli: number): { vx: number; vy: number } {
  const vx = vxMilli / 1000;
  const vy = vyMilli / 1000;
  const s = Math.sqrt(vx * vx + vy * vy);
  if (s > V_MAX) return { vx: (vx * V_MAX) / s, vy: (vy * V_MAX) / s };
  return { vx, vy };
}

/** Where a hand-placed cue ball may go (pocket: anywhere free; carom never places). */
export function canPlace(state: BilliardsState, x: number, y: number): boolean {
  if (!state.ballInHand) return false;
  return spotFree(toSim(state.balls), x, y, CUE_ID);
}

/** The free spot nearest to (x, y) on the head-to-foot line — used for re-spotting. */
export function freeSpotNear(balls: readonly Ball[], x: number, y: number, ignore = -1): { x: number; y: number } {
  const sims = toSim(balls);
  if (spotFree(sims, x, y, ignore)) return { x, y };
  for (let k = 1; k < 60; k++) {
    for (const sign of [-1, 1]) {
      const tx = x + sign * k * R * 0.5;
      if (spotFree(sims, tx, y, ignore)) return { x: tx, y };
    }
    for (const sign of [-1, 1]) {
      const ty = y + sign * k * R * 0.5;
      if (spotFree(sims, x, ty, ignore)) return { x, y: ty };
    }
  }
  return { x: HEAD_X, y: 0 };
}

export interface ShotOutcome {
  balls: Ball[];
  sim: SimResult;
}

/** Runs the physics for `shot` from `balls` (cue ball already placed). */
export function runShot(balls: readonly Ball[], mode: Mode, vxM: number, vyM: number, spinM: number, sideM: number, record = false): SimResult {
  const v = shotVelocity(vxM, vyM);
  return simulate(toSim(balls), { cue: CUE_ID, vx: v.vx, vy: v.vy, spin: spinM / 1000, side: sideM / 1000 }, mode === "pocket", record);
}

// ---------------------------------------------------------------------------
// Judging a shot (§6, §7) — shared by the engine and the bot
// ---------------------------------------------------------------------------

export interface Judgement {
  foul: FoulKind | null;
  firstHit: number;
  points: number;
  scored: { id: number; pts: number; lucky: boolean }[];
  again: boolean;
  carom: boolean;
  cushions: number;
  /** Ids that should be re-spotted (gold 9 on a foul). */
  respot: number[];
  potted: number[];
}

export function judge(state: Pick<BilliardsState, "options" | "lucky">, before: readonly Ball[], sim: SimResult): Judgement {
  const firstContact = sim.contacts.find((c) => c.a === CUE_ID || c.b === CUE_ID);
  const firstHit = firstContact ? (firstContact.a === CUE_ID ? firstContact.b : firstContact.a) : -1;
  const potted = sim.pots.map((p) => p.id);
  if (state.options.mode === "pocket") {
    const low = lowestBall(before);
    let foul: FoulKind | null = null;
    if (potted.includes(CUE_ID)) foul = "scratch";
    else if (firstHit < 0) foul = "miss";
    else if (firstHit !== low) foul = "wrongFirst";
    const objPots: SimPot[] = sim.pots.filter((p) => p.id !== CUE_ID);
    if (foul) {
      return { foul, firstHit, points: -FOUL_PENALTY, scored: [], again: false, carom: false, cushions: 0, respot: objPots.filter((p) => p.id === 9).map((p) => p.id), potted };
    }
    const scored = objPots.map((p) => {
      const lucky = p.pocket === state.lucky;
      return { id: p.id, pts: ballValue(p.id) * (lucky ? 2 : 1), lucky };
    });
    const points = scored.reduce((a, s) => a + s.pts, 0);
    return { foul: null, firstHit, points, scored, again: scored.length > 0, carom: false, cushions: 0, respot: [], potted };
  }
  // carom: which reds did the cue touch, and when; the yellow spoils the shot
  const cueContacts = sim.contacts.filter((c) => c.a === CUE_ID || c.b === CUE_ID);
  const other = (c: { a: number; b: number }) => (c.a === CUE_ID ? c.b : c.a);
  const touchedYellow = cueContacts.some((c) => other(c) === YELLOW);
  let secondRedStep = -1;
  const seen = new Set<number>();
  for (const c of cueContacts) {
    const o = other(c);
    if (o !== RED_A && o !== RED_B) continue;
    seen.add(o);
    if (seen.size === 2) {
      secondRedStep = c.step;
      break;
    }
  }
  if (touchedYellow) {
    return { foul: "yellow", firstHit, points: -FOUL_PENALTY, scored: [], again: false, carom: false, cushions: 0, respot: [], potted };
  }
  if (secondRedStep >= 0) {
    const cushions = sim.rails.filter((r) => r.id === CUE_ID && r.step <= secondRedStep).length;
    const pts = cushions >= 3 ? THREE_CUSHION_POINTS : 1;
    return { foul: null, firstHit, points: pts, scored: [], again: true, carom: true, cushions, respot: [], potted };
  }
  return { foul: firstHit < 0 ? "miss" : null, firstHit, points: 0, scored: [], again: false, carom: false, cushions: 0, respot: [], potted };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function clampInt(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function doShoot(state: BilliardsState, a: Extract<EngineAction, { type: "shoot" }>): BilliardsState {
  if (state.phase !== "aim" || a.seat !== state.activeSeat) return state;
  const vx = clampInt(a.vx, -1e6, 1e6);
  const vy = clampInt(a.vy, -1e6, 1e6);
  const spin = clampInt(a.spin, -1000, 1000) ?? 0;
  const side = clampInt(a.side, -1000, 1000) ?? 0;
  if (vx === null || vy === null || (vx === 0 && vy === 0)) return state;

  let before = state.balls;
  let placed: { x: number; y: number } | null = null;
  if (a.place && state.ballInHand) {
    const px = clampInt(a.place.x, -HALF_W * 1000, HALF_W * 1000);
    const py = clampInt(a.place.y, -HALF_H * 1000, HALF_H * 1000);
    if (px !== null && py !== null && canPlace(state, px / 1000, py / 1000)) {
      placed = { x: px / 1000, y: py / 1000 };
      before = state.balls.map((b) => (b.id === CUE_ID ? { ...b, x: placed!.x, y: placed!.y } : b));
    }
  }
  if (!before.some((b) => b.id === CUE_ID)) return state;

  const sim = runShot(before, state.options.mode, vx, vy, spin, side);
  const j = judge(state, before, sim);
  const pos = new Map(sim.rest.map((r) => [r.id, r]));
  let balls: Ball[] = before.filter((b) => pos.has(b.id)).map((b) => ({ id: b.id, x: pos.get(b.id)!.x, y: pos.get(b.id)!.y }));
  // scratch: the cue ball comes back for the next player's ball-in-hand
  if (!balls.some((b) => b.id === CUE_ID)) {
    const spot = freeSpotNear(balls, HEAD_X, 0);
    balls = [...balls, { id: CUE_ID, ...spot }];
  }
  let respotted = false;
  for (const id of j.respot) {
    const spot = freeSpotNear(balls, FOOT_X, 0);
    balls = [...balls, { id, ...spot }];
    respotted = true;
  }
  balls.sort((p, q) => p.id - q.id);

  const seat = a.seat;
  const scores = [...state.scores];
  scores[seat] = Math.max(0, scores[seat] + j.points);
  const potted = [...state.potted];
  potted[seat] += j.scored.length;
  const fouls = [...state.fouls];
  if (j.foul && j.foul !== "miss") fouls[seat] += 1;
  else if (j.foul === "miss" && state.options.mode === "pocket") fouls[seat] += 1;

  // stats (§13)
  let tally = state.statTally;
  tally = tallyAdd(tally, seat, "shots");
  if (j.foul && (state.options.mode === "pocket" || j.foul === "yellow")) tally = tallyAdd(tally, seat, "fouls");
  if (j.foul === "scratch") tally = tallyAdd(tally, seat, "scratches");
  if (j.scored.length > 0) {
    tally = tallyAdd(tally, seat, "pots", j.scored.length);
    tally = tallyMax(tally, seat, "bestShot", j.scored.length);
    if (j.scored.length >= 2) tally = tallyAdd(tally, seat, "multiPots");
    if (j.scored.some((s) => s.id === 9)) tally = tallyAdd(tally, seat, "golds");
    if (j.scored.some((s) => s.lucky)) tally = tallyAdd(tally, seat, "luckyPots");
  }
  if (j.carom) {
    tally = tallyAdd(tally, seat, "caroms");
    if (j.cushions >= 3) tally = tallyAdd(tally, seat, "threeCushions");
  }

  const shot: ShotRecord = {
    turn: state.turn,
    seat,
    vx,
    vy,
    spin,
    side,
    placed,
    before,
    potted: j.potted,
    points: j.points,
    foul: j.foul,
    scored: j.scored,
    carom: j.carom,
    cushions: j.cushions,
    respotted,
    again: j.again,
    firstHit: j.firstHit,
    steps: sim.steps,
  };

  const shots = state.shots + 1;
  // streak (consecutive scoring shots by the same player)
  const streak = j.again && state.lastShot && state.lastShot.seat === seat && state.lastShot.again ? tallyGet(state.statTally, seat, "curStreak") + 1 : j.again ? 1 : 0;
  tally = setTally(tally, seat, "curStreak", streak);
  tally = tallyMax(tally, seat, "bestRun", streak);

  const base: BilliardsState = {
    ...state,
    balls,
    turn: state.turn + 1,
    shots,
    scores,
    potted,
    fouls,
    lastShot: shot,
    lastPass: null,
    statTally: tally,
    ballInHand: state.options.mode === "pocket" && !!j.foul,
    lucky: state.options.mode === "pocket" ? luckyFor(state.seed + state.rack * 101, shots) : -1,
  };

  if (state.options.mode === "pocket") {
    const left = balls.filter((b) => b.id !== CUE_ID).length;
    if (left === 0) return endRack(base, false);
    if (shots >= POCKET_SHOT_LIMIT) return endRack(base, true);
  } else {
    if (shots >= CAROM_SHOT_LIMIT) return endCarom(base);
    // §7 equal innings: reaching the target ends your turn; everyone after you in this inning still shoots
    const reached = scores[seat] >= state.options.target;
    if (reached && !state.finalInning) {
      const next = nextSeat(state, seat);
      if (next === state.openSeat) return endCarom({ ...base, winner: seat, finalInning: true });
      return { ...base, winner: seat, finalInning: true, activeSeat: next };
    }
    if (state.finalInning && !j.again) {
      const next = nextSeat(state, seat);
      if (next === state.openSeat) return endCarom(base);
      return { ...base, activeSeat: next };
    }
  }
  if (j.again) return base;
  return { ...base, activeSeat: nextSeat(state, seat) };
}

function tallyGet(t: StatTally | undefined, seat: number, key: string): number {
  return t?.[String(seat)]?.[key] ?? 0;
}
function setTally(t: StatTally | undefined, seat: number, key: string, value: number): StatTally {
  const cur = tallyGet(t, seat, key);
  return tallyAdd(t, seat, key, value - cur);
}

function endRack(state: BilliardsState, limitHit: boolean): BilliardsState {
  const rackScores = state.scores.map((s, i) => s - state.rackStart[i]);
  const best = Math.max(...rackScores);
  const rackWins = [...state.rackWins];
  let tally = state.statTally;
  rackScores.forEach((s, i) => {
    if (s === best && best > 0) {
      rackWins[i] += 1;
      tally = tallyAdd(tally, i, "rackWins");
    }
  });
  return {
    ...state,
    phase: "rackOver",
    rackWins,
    statTally: tally,
    history: [...state.history, { rack: state.rack, scores: rackScores, shots: state.shots, limitHit }],
  };
}

function endCarom(state: BilliardsState): BilliardsState {
  return { ...state, phase: "ended", history: [...state.history, { rack: 0, scores: [...state.scores], shots: state.shots, limitHit: state.winner < 0 }] };
}

function nextRack(state: BilliardsState): BilliardsState {
  if (state.phase !== "rackOver") return state;
  if (state.rack + 1 >= state.options.racks) return { ...state, phase: "ended", turn: state.turn + 1 };
  // the trailing player breaks the next rack
  let low = 0;
  for (let s = 1; s < state.playerCount; s++) if (state.scores[s] < state.scores[low]) low = s;
  const rack = state.rack + 1;
  const seed = state.seed + rack * 101;
  return {
    ...state,
    rack,
    balls: rackPocket(seed),
    activeSeat: low,
    phase: "aim",
    turn: state.turn + 1,
    shots: 0,
    ballInHand: false,
    lucky: luckyFor(seed, 0),
    lastShot: null,
    lastPass: null,
    rackStart: [...state.scores],
  };
}

function doTimeout(state: BilliardsState, seat: Seat, turn: number): BilliardsState {
  if (state.phase !== "aim" || turn !== state.turn || seat !== state.activeSeat) return state;
  const next = nextSeat(state, seat);
  if (state.options.mode === "carom" && state.finalInning && next === state.openSeat) return endCarom({ ...state, turn: state.turn + 1, lastPass: { turn: state.turn, seat } });
  return {
    ...state,
    turn: state.turn + 1,
    activeSeat: next,
    // a skipped shot in pocket mode hands the next player the cue ball, like a foul without the point
    ballInHand: state.options.mode === "pocket",
    lastPass: { turn: state.turn, seat },
  };
}

export function applyAction(state: BilliardsState, action: EngineAction): BilliardsState {
  switch (action?.type) {
    case "shoot":
      return doShoot(state, action);
    case "timeout":
      return doTimeout(state, action.seat, action.turn);
    case "next":
      return nextRack(state);
    default:
      return state;
  }
}

export function currentActor(state: BilliardsState): Seat | null {
  return state.phase === "aim" ? state.activeSeat : null;
}

// ---------------------------------------------------------------------------
// Rankings (§9)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

export function computeRankings(state: BilliardsState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => (state.options.mode === "carom" ? [state.scores[s], -state.fouls[s]] : [state.scores[s], state.potted[s], -state.fouls[s]]);
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

export { HALF_H, HALF_W, R, POCKETS };
