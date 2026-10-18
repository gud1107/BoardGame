/**
 * Pure "와르르 타워(Wobble Tower)" rules engine — no React, no I/O.
 * Implements boardGameRule/와르르타워/와르르타워.md (section numbers below
 * refer to it). A tower of 18 levels × 3 blocks; on your turn you pull one
 * legal block (§4) with a skill-scored pull (§5) and place it on top (§6).
 * Whoever collapses the tower loses the round (§7, §8).
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s. The only client-measured input is the pull
 * `quality` (0..1) from the drag minigame (pull.ts) — everything else
 * (structure, collapse rolls) is derived here from state + seed.
 *
 * Geometry (block widths): a block is 3 long × 1 wide × 0.6 tall. Level i is
 * "even" (long along x, slots spread along z) when i % 2 === 0, else "odd"
 * (long along z, slots along x). Slot s sits at offset s - 1 on its slot axis.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

export type Seat = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const START_LEVELS = 18;
export const SLOTS = 3;
/** §10 */
export const PULL_TIMEOUT_MS = 40_000;
export const PLACE_TIMEOUT_MS = 20_000;
/** §10 "떨리는 손" */
export const TIMEOUT_QUALITY = 0.35;

export interface Block {
  id: number;
  /** §1 hidden looseness 0 (stuck) .. 1 (falls out). */
  loose: number;
}

/** slots[s] = the block in slot s, or null when it was pulled. */
export interface Level {
  slots: (Block | null)[];
}

export interface GameOptions {
  /** §2 */
  rounds: 1 | 3;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 1 };

export type Phase = "pull" | "place" | "collapsed" | "ended";

export interface Coord {
  level: number;
  slot: number;
}

/** What just happened — the board animates from this (keyed by `turn`). */
export type TowerEvent =
  | { kind: "pull"; turn: number; seat: Seat; at: Coord; blockId: number; quality: number; difficulty: number; jolt: number; collapsed: boolean; timeout: boolean }
  | { kind: "place"; turn: number; seat: Seat; at: Coord; blockId: number; collapsed: boolean; timeout: boolean };

export interface Collapse {
  seat: Seat;
  cause: "structure" | "wobble";
  during: "pull" | "place";
  /** Blocks on levels ABOVE this one fall first (−1 = the whole tower from the table). */
  level: number;
  /** Unit direction (x, z) the tower tips toward. */
  dir: { x: number; z: number };
}

export interface RoundRecord {
  loser: Seat;
  lastBuilder: Seat | null;
  pulls: number;
  levels: number;
}

export interface WobbleTowerState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  round: number;
  levels: Level[];
  activeSeat: Seat;
  phase: Phase;
  /** Monotonic action counter — rng salt and animation key. */
  turn: number;
  held: (Block & { from: Coord }) | null;
  /** §7 누적 흔들림 */
  sway: number;
  lastEvent: TowerEvent | null;
  /** Seat that last completed a full pull+place this round. */
  lastBuilder: Seat | null;
  roundPulls: number;
  collapse: Collapse | null;
  scores: number[];
  collapses: number[];
  pulls: number[];
  history: RoundRecord[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "pull"; seat: Seat; level: number; slot: number; quality: number }
  | { type: "place"; seat: Seat; slot: number }
  | { type: "timeout"; seat: Seat; turn: number }
  | { type: "next"; seat?: Seat };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function mix(seed: number, salt: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(salt + 1, 40503)) | 0;
}

/** §1 — looseness skews toward "normal" with a few very loose / very stuck blocks. */
function buildTower(seed: number, round: number): Level[] {
  const rng = seededRng(mix(seed, 1000 + round));
  const levels: Level[] = [];
  let id = 0;
  for (let i = 0; i < START_LEVELS; i++) {
    const slots: Block[] = [];
    for (let s = 0; s < SLOTS; s++) {
      const r = (rng() + rng()) / 2;
      const loose = Math.round(Math.min(1, Math.max(0, r * 1.15 - 0.075 + (rng() < 0.12 ? 0.3 : 0))) * 100) / 100;
      slots.push({ id: id++, loose });
    }
    levels.push({ slots });
  }
  return levels;
}

export function startGame(playerCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): WobbleTowerState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const rng = seededRng(mix(seed, 7));
  return {
    seed,
    playerCount: count,
    options: { rounds: options.rounds === 3 ? 3 : 1 },
    round: 0,
    levels: buildTower(seed, 0),
    activeSeat: Math.floor(rng() * count),
    phase: "pull",
    turn: 0,
    held: null,
    sway: 0,
    lastEvent: null,
    lastBuilder: null,
    roundPulls: 0,
    collapse: null,
    scores: Array(count).fill(0),
    collapses: Array(count).fill(0),
    pulls: Array(count).fill(0),
    history: [],
    statTally: {},
  };
}

// ---------------------------------------------------------------------------
// Geometry & structure (§7.1)
// ---------------------------------------------------------------------------

export function blockCenter(level: number, slot: number): { x: number; z: number } {
  const off = slot - 1;
  return level % 2 === 0 ? { x: 0, z: off } : { x: off, z: 0 };
}

function occupied(level: Level): number[] {
  const out: number[] = [];
  level.slots.forEach((b, s) => {
    if (b) out.push(s);
  });
  return out;
}

export function blockCount(level: Level): number {
  return level.slots.reduce((n, b) => n + (b ? 1 : 0), 0);
}

/** Slot-axis span [min, max] of a level's blocks. */
function slotSpan(level: Level): [number, number] | null {
  const occ = occupied(level);
  if (occ.length === 0) return null;
  return [Math.min(...occ) - 1.5, Math.max(...occ) - 0.5];
}

export interface Interface {
  /** Interface between `level` and `level + 1` (−1 = table / level 0). */
  level: number;
  margin: number;
  /** Blocks resting on this interface. */
  load: number;
  /** COM of everything above, and how far outside (negative margin) toward which side. */
  com: { x: number; z: number };
  dir: { x: number; z: number };
}

/**
 * For every interface, the signed distance from the COM of the stack above
 * to the nearest edge of the contact rectangle (negative = outside → falls).
 */
export function interfaces(levels: readonly Level[]): Interface[] {
  const n = levels.length;
  // suffix sums of block centers
  const sumX = Array(n + 1).fill(0);
  const sumZ = Array(n + 1).fill(0);
  const cnt = Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    sumX[i] = sumX[i + 1];
    sumZ[i] = sumZ[i + 1];
    cnt[i] = cnt[i + 1];
    levels[i].slots.forEach((b, s) => {
      if (!b) return;
      const c = blockCenter(i, s);
      sumX[i] += c.x;
      sumZ[i] += c.z;
      cnt[i] += 1;
    });
  }
  const out: Interface[] = [];
  for (let L = -1; L < n - 1; L++) {
    const above = L + 1;
    if (cnt[above] === 0) continue;
    const com = { x: sumX[above] / cnt[above], z: sumZ[above] / cnt[above] };
    // contact rect: x-range and z-range
    let xr: [number, number] = [-1.5, 1.5];
    let zr: [number, number] = [-1.5, 1.5];
    const apply = (lv: number) => {
      const span = slotSpan(levels[lv]);
      if (!span) {
        xr = [0, 0];
        zr = [0, 0];
        return;
      }
      if (lv % 2 === 0) zr = [Math.max(zr[0], span[0]), Math.min(zr[1], span[1])];
      else xr = [Math.max(xr[0], span[0]), Math.min(xr[1], span[1])];
    };
    if (L >= 0) apply(L);
    apply(above);
    const dx0 = com.x - xr[0];
    const dx1 = xr[1] - com.x;
    const dz0 = com.z - zr[0];
    const dz1 = zr[1] - com.z;
    const margin = Math.min(dx0, dx1, dz0, dz1);
    let dir = { x: 0, z: 0 };
    if (margin === dx0) dir = { x: -1, z: 0 };
    else if (margin === dx1) dir = { x: 1, z: 0 };
    else if (margin === dz0) dir = { x: 0, z: -1 };
    else dir = { x: 0, z: 1 };
    out.push({ level: L, margin, load: cnt[above], com, dir });
  }
  return out;
}

export function weakestInterface(levels: readonly Level[]): Interface | null {
  let worst: Interface | null = null;
  for (const f of interfaces(levels)) if (!worst || f.margin < worst.margin) worst = f;
  return worst;
}

/** Levels below the top two with a missing block (§7.2 약한 층). */
export function weakLevels(levels: readonly Level[]): number {
  let n = 0;
  for (let i = 0; i < levels.length - 2; i++) if (blockCount(levels[i]) < SLOTS) n++;
  return n;
}

/** Missing blocks below the top two levels. */
export function holes(levels: readonly Level[]): number {
  let n = 0;
  for (let i = 0; i < levels.length - 2; i++) n += SLOTS - blockCount(levels[i]);
  return n;
}

/** Overall center-of-mass offset of the whole tower (board leans with it). */
export function towerLean(levels: readonly Level[]): { x: number; z: number } {
  const f = interfaces(levels).find((i) => i.level === -1);
  return f ? f.com : { x: 0, z: 0 };
}

/** §7.2 instability ingredients for a tower state. */
export function instability(levels: readonly Level[], sway: number): number {
  // a narrow contact only matters when it carries real weight (a lone block on top is harmless)
  let structural = 0;
  for (const f of interfaces(levels)) structural = Math.max(structural, Math.max(0, Math.min(1, (1.05 - f.margin) / 1.05)) * Math.min(1, f.load / 12));
  const height = Math.max(0, levels.length - START_LEVELS) * 0.022;
  return structural * 0.5 + holes(levels) * 0.016 + sway + height;
}

// ---------------------------------------------------------------------------
// Legality (§4) & difficulty (§5)
// ---------------------------------------------------------------------------

export function topIndex(levels: readonly Level[]): number {
  return levels.length - 1;
}

/** Highest level index (exclusive) that may be pulled from. */
function pullCeiling(levels: readonly Level[]): number {
  const top = topIndex(levels);
  return blockCount(levels[top]) === SLOTS ? top : top - 1;
}

export function canPull(state: WobbleTowerState, level: number, slot: number): boolean {
  if (state.phase !== "pull") return false;
  if (level < 0 || level >= pullCeiling(state.levels)) return false;
  const lv = state.levels[level];
  if (!lv?.slots[slot]) return false;
  return blockCount(lv) > 1;
}

export function legalPulls(state: WobbleTowerState): Coord[] {
  const out: Coord[] = [];
  const ceil = pullCeiling(state.levels);
  for (let level = 0; level < ceil; level++) {
    const lv = state.levels[level];
    if (blockCount(lv) <= 1) continue;
    for (let slot = 0; slot < SLOTS; slot++) if (lv.slots[slot]) out.push({ level, slot });
  }
  return out;
}

/** The level the held block will go to and its empty slots. */
export function placeTarget(levels: readonly Level[]): { level: number; slots: number[] } {
  const top = topIndex(levels);
  if (blockCount(levels[top]) === SLOTS) return { level: top + 1, slots: [0, 1, 2] };
  return { level: top, slots: [0, 1, 2].filter((s) => !levels[top].slots[s]) };
}

/** §5 — how hard this block is to pull, 0..1 (drives the minigame and the jolt). */
export function pullDifficulty(levels: readonly Level[], level: number, slot: number, knowLoose = true): number {
  const lv = levels[level];
  const b = lv.slots[slot];
  if (!b) return 1;
  const above = levels.length - 1 - level;
  const load = Math.min(1, above / 17);
  const count = blockCount(lv);
  const edge = slot !== 1;
  const pos = count === SLOTS ? (edge ? 0.16 : 0) : 0.2;
  const tight = 1 - (knowLoose ? b.loose : 0.5);
  return Math.max(0.03, Math.min(1, 0.05 + 0.3 * load + pos + 0.42 * tight - 0.08));
}

export function looseLabel(loose: number): "헐렁해요" | "보통" | "뻑뻑해요" {
  return loose >= 0.62 ? "헐렁해요" : loose <= 0.35 ? "뻑뻑해요" : "보통";
}

function removeBlock(levels: readonly Level[], at: Coord): Level[] {
  return levels.map((lv, i) => (i === at.level ? { slots: lv.slots.map((b, s) => (s === at.slot ? null : b)) } : lv));
}

function addBlock(levels: readonly Level[], slot: number, block: Block): Level[] {
  const target = placeTarget(levels);
  const next = levels.map((lv) => ({ slots: [...lv.slots] }));
  if (target.level === levels.length) next.push({ slots: [null, null, null] });
  next[target.level].slots[slot] = block;
  return next;
}

/** §7.2 — probability the tower falls on this pull (given the post-pull tower). */
export function pullCollapseChance(levels: readonly Level[], sway: number, at: Coord, quality: number, knowLoose = true): { p: number; jolt: number; difficulty: number; structural: Interface | null } {
  const difficulty = pullDifficulty(levels, at.level, at.slot, knowLoose);
  const jolt = (1 - Math.max(0, Math.min(1, quality))) * (0.35 + 0.65 * difficulty);
  const after = removeBlock(levels, at);
  const w = weakestInterface(after);
  if (w && w.margin < 0) return { p: 1, jolt, difficulty, structural: w };
  const inst = instability(after, sway);
  const hazard = 0.8 * jolt ** 3 + 0.4 * jolt * inst ** 1.4 + 0.012 * inst ** 3;
  return { p: Math.min(1, 1 - Math.exp(-hazard)), jolt, difficulty, structural: null };
}

/** §6 — probability the tower falls while placing into `slot`. */
export function placeCollapseChance(levels: readonly Level[], sway: number, slot: number, block: Block): { p: number; structural: Interface | null } {
  const after = addBlock(levels, slot, block);
  const w = weakestInterface(after);
  if (w && w.margin < 0) return { p: 1, structural: w };
  const margin = w ? w.margin : 1.5;
  const p = 0.22 * Math.max(0, Math.min(1, (0.32 - margin) / 0.32)) + 0.04 * sway;
  return { p: Math.min(1, p), structural: null };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function rollFor(state: WobbleTowerState): number {
  return seededRng(mix(state.seed, 50_000 + state.round * 5000 + state.turn))();
}

function dirFor(state: WobbleTowerState): { x: number; z: number } {
  const r = seededRng(mix(state.seed, 90_000 + state.turn))();
  const a = r * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}

function nextSeat(state: WobbleTowerState, seat: Seat): Seat {
  return (seat + 1) % state.playerCount;
}

function collapseRound(state: WobbleTowerState, collapse: Collapse, levels: Level[], event: TowerEvent): WobbleTowerState {
  const seat = collapse.seat;
  const scores = [...state.scores];
  for (let s = 0; s < state.playerCount; s++) if (s !== seat) scores[s] += 1;
  const lastBuilder = state.lastBuilder !== null && state.lastBuilder !== seat ? state.lastBuilder : null;
  if (lastBuilder !== null) scores[lastBuilder] += 1;
  const collapses = [...state.collapses];
  collapses[seat] += 1;
  let tally = tallyAdd(state.statTally, seat, "collapses");
  if (lastBuilder !== null) tally = tallyAdd(tally, lastBuilder, "lastBuilder");
  const height = Math.max(levels.length, state.levels.length);
  for (let s = 0; s < state.playerCount; s++) tally = tallyMax(tally, s, "maxLevels", height);
  const record: RoundRecord = { loser: seat, lastBuilder, pulls: state.roundPulls, levels: height };
  return {
    ...state,
    levels,
    held: null,
    phase: "collapsed",
    turn: state.turn + 1,
    collapse,
    lastEvent: event,
    scores,
    collapses,
    history: [...state.history, record],
    statTally: tally,
  };
}

function doPull(state: WobbleTowerState, seat: Seat, at: Coord, quality: number, timeout: boolean): WobbleTowerState {
  if (seat !== state.activeSeat || !canPull(state, at.level, at.slot)) return state;
  const q = Math.round(Math.max(0, Math.min(1, Number.isFinite(quality) ? quality : 0)) * 100) / 100;
  const block = state.levels[at.level].slots[at.slot]!;
  const weakBefore = blockCount(state.levels[at.level]) < SLOTS;
  const { p, jolt, difficulty, structural } = pullCollapseChance(state.levels, state.sway, at, q);
  const collapsed = rollFor(state) < p;
  const levels = removeBlock(state.levels, at);
  const event: TowerEvent = { kind: "pull", turn: state.turn, seat, at, blockId: block.id, quality: q, difficulty, jolt, collapsed, timeout };
  if (collapsed) {
    const collapse: Collapse = structural
      ? { seat, cause: "structure", during: "pull", level: structural.level, dir: structural.dir }
      : { seat, cause: "wobble", during: "pull", level: Math.max(-1, at.level - 1), dir: dirFor(state) };
    return collapseRound(state, collapse, levels, event);
  }
  let tally = tallyAdd(state.statTally, seat, "pulls");
  if (q >= 0.95) tally = tallyAdd(tally, seat, "perfectPulls");
  if (weakBefore) tally = tallyAdd(tally, seat, "riskyPulls");
  tally = tallyMax(tally, seat, "bestQuality", Math.round(q * 100));
  const pulls = [...state.pulls];
  pulls[seat] += 1;
  return {
    ...state,
    levels,
    held: { ...block, from: at },
    phase: "place",
    turn: state.turn + 1,
    sway: Math.min(0.6, state.sway + jolt * 0.3),
    lastEvent: event,
    roundPulls: state.roundPulls + 1,
    pulls,
    statTally: tally,
  };
}

function doPlace(state: WobbleTowerState, seat: Seat, slot: number, timeout: boolean): WobbleTowerState {
  if (state.phase !== "place" || seat !== state.activeSeat || !state.held) return state;
  const target = placeTarget(state.levels);
  if (!target.slots.includes(slot)) return state;
  const block: Block = { id: state.held.id, loose: state.held.loose };
  const { p, structural } = placeCollapseChance(state.levels, state.sway, slot, block);
  const collapsed = rollFor(state) < p;
  const levels = addBlock(state.levels, slot, block);
  const event: TowerEvent = { kind: "place", turn: state.turn, seat, at: { level: target.level, slot }, blockId: block.id, collapsed, timeout };
  if (collapsed) {
    const collapse: Collapse = structural
      ? { seat, cause: "structure", during: "place", level: structural.level, dir: structural.dir }
      : { seat, cause: "wobble", during: "place", level: Math.max(-1, levels.length - 4), dir: dirFor(state) };
    return collapseRound(state, collapse, levels, event);
  }
  return {
    ...state,
    levels,
    held: null,
    phase: "pull",
    activeSeat: nextSeat(state, seat),
    turn: state.turn + 1,
    sway: state.sway * 0.75,
    lastEvent: event,
    lastBuilder: seat,
    statTally: tallyMax(state.statTally, seat, "maxLevels", levels.length),
  };
}

function nextRound(state: WobbleTowerState): WobbleTowerState {
  if (state.phase !== "collapsed" || !state.collapse) return state;
  if (state.round + 1 >= state.options.rounds) return { ...state, phase: "ended", turn: state.turn + 1 };
  const round = state.round + 1;
  return {
    ...state,
    round,
    levels: buildTower(state.seed, round),
    activeSeat: state.collapse.seat,
    phase: "pull",
    turn: state.turn + 1,
    held: null,
    sway: 0,
    lastEvent: null,
    lastBuilder: null,
    roundPulls: 0,
    collapse: null,
  };
}

/** §10 — the safest pull at "떨리는 손" quality, or the best-balanced slot. */
export function timeoutAction(state: WobbleTowerState): EngineAction | null {
  if (state.phase === "pull") {
    let best: { c: Coord; p: number } | null = null;
    for (const c of legalPulls(state)) {
      const p = pullCollapseChance(state.levels, state.sway, c, TIMEOUT_QUALITY).p;
      if (!best || p < best.p) best = { c, p };
    }
    return best ? { type: "pull", seat: state.activeSeat, level: best.c.level, slot: best.c.slot, quality: TIMEOUT_QUALITY } : null;
  }
  if (state.phase === "place" && state.held) return { type: "place", seat: state.activeSeat, slot: bestPlaceSlot(state) };
  return null;
}

export function applyAction(state: WobbleTowerState, action: EngineAction): WobbleTowerState {
  switch (action.type) {
    case "pull":
      return doPull(state, action.seat, { level: action.level, slot: action.slot }, action.quality, false);
    case "place":
      return doPlace(state, action.seat, action.slot, false);
    case "timeout": {
      if (action.turn !== state.turn || action.seat !== state.activeSeat) return state;
      const auto = timeoutAction(state);
      if (!auto) return state;
      if (auto.type === "pull") return doPull(state, auto.seat, { level: auto.level, slot: auto.slot }, auto.quality, true);
      if (auto.type === "place") return doPlace(state, auto.seat, auto.slot, true);
      return state;
    }
    case "next":
      return nextRound(state);
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

export function computeRankings(state: WobbleTowerState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => [state.scores[s], -state.collapses[s], state.pulls[s]];
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

// ---------------------------------------------------------------------------
// Bots (§12)
// ---------------------------------------------------------------------------

/** Mean pull quality a bot of this level achieves on a block of difficulty d. */
export function botQualityMean(level: BotLevel, difficulty: number): number {
  const l = clampBotLevel(level);
  return Math.max(0.2, Math.min(0.97, 0.66 + 0.029 * l - difficulty * (0.3 - 0.015 * l)));
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function botQuality(level: BotLevel, difficulty: number, rng: () => number = Math.random): number {
  const l = clampBotLevel(level);
  const sd = 0.15 - 0.009 * l;
  let q = botQualityMean(l, difficulty) + gaussian(rng) * sd;
  // novices sometimes yank
  if (rng() < 0.06 - 0.005 * l) q -= 0.35;
  return Math.round(Math.max(0, Math.min(1, q)) * 100) / 100;
}

export function bestPlaceSlot(state: WobbleTowerState): number {
  const target = placeTarget(state.levels);
  const block = state.held ?? { id: -1, loose: 0.5 };
  let best = target.slots[0];
  let bestMargin = -Infinity;
  for (const s of target.slots) {
    const w = weakestInterface(addBlock(state.levels, s, block));
    const m = w ? w.margin : 1.5;
    // prefer the middle slot on ties (keeps COM centered next time too)
    const score = m + (s === 1 ? 0.001 : 0);
    if (score > bestMargin) {
      bestMargin = score;
      best = s;
    }
  }
  return best;
}

export function chooseBotAction(state: WobbleTowerState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.activeSeat !== seat) return null;
  const l = clampBotLevel(level);
  if (state.phase === "place") {
    if (!state.held) return null;
    const target = placeTarget(state.levels);
    const slot = l >= 7 ? bestPlaceSlot(state) : pickByLevel(target.slots.map((s) => ({ move: s, score: -Math.abs(s - 1) * 0.5 + rng() * 0.3 })), l, rng);
    return { type: "place", seat, slot };
  }
  if (state.phase !== "pull") return null;
  const options = legalPulls(state);
  if (options.length === 0) return null;
  const knowLoose = l >= 6;
  const scored = options.map((c) => {
    const d = pullDifficulty(state.levels, c.level, c.slot, knowLoose);
    const q = botQualityMean(l, d);
    const { p } = pullCollapseChance(state.levels, state.sway, c, q, knowLoose);
    return { move: c, score: -p * 100, p };
  });
  // any bot can see a pull that leaves the tower standing on nothing
  const sane = scored.some((x) => x.p < 1) ? scored.filter((x) => x.p < 1) : scored;
  if (l >= 9) {
    // §12 — among the few safest pulls, leave the next player fewer safe options (tie-breaker only)
    const top = [...sane].sort((a, b) => b.score - a.score).slice(0, 5);
    for (const t of top) {
      const after = removeBlock(state.levels, t.move);
      const next = { ...state, levels: after };
      const safe = legalPulls(next).filter((o) => pullCollapseChance(after, state.sway, o, 0.8).p < 0.05).length;
      t.score -= safe * 0.01;
    }
  }
  const pick = pickByLevel(sane, l, rng);
  const d = pullDifficulty(state.levels, pick.level, pick.slot);
  return { type: "pull", seat, level: pick.level, slot: pick.slot, quality: botQuality(l, d, rng) };
}

/** Whose decision bots/timeouts drive right now. */
export function currentActor(state: WobbleTowerState): Seat | null {
  return state.phase === "pull" || state.phase === "place" ? state.activeSeat : null;
}
