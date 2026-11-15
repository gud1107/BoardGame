/**
 * Pure "도미노 연쇄(Domino Chain)" rules engine — no React, no I/O.
 * Implements boardGameRule/도미노연쇄/도미노연쇄.md (section numbers below
 * refer to it).
 *
 * A round has two halves:
 * 1. 🧱 쌓기 (§4) — players take turns standing dominoes on a shared grid.
 *    A new piece must stand on a cell one of your own standing pieces would
 *    fall onto (your chain's open ends), facing anywhere from 90° left to
 *    90° right of the way the chain arrives. One 🔀 split (falls onto both
 *    forward diagonals) and one 🧱 wall per round.
 * 2. 💥 와르르 (§5) — every player's pusher falls at the same instant and
 *    the chains run on a shared clock (straight fall 2 ticks, diagonal 3).
 *    Whoever's chain reaches a piece FIRST owns it from then on, so a chain
 *    that runs into a rival's line steals the rest of that line. Bells score
 *    for whoever rings them, a 💣 bomb costs 2 but knocks its 8 neighbours
 *    over, and the biggest chain earns a bonus.
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s. The topple is a pure function of the
 * board, so the board animation re-derives it from `result.events`.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";

export type Seat = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** §4 */
export const TURN_TIMEOUT_MS = 45_000;
export const PLACEMENTS_PER_TURN = 2;
/** §4 — the round's first builder opens with a single piece (evens out moving first, like a 1-2-2 opening). */
export const OPENING_PLACEMENTS = 1;
/** §5 */
export const ORTHO_TICKS = 2;
export const DIAG_TICKS = 3;
export const BOMB_PENALTY = 2;
export const LONGEST_BONUS = 2;
/** One tick of the topple clock on screen (ms). */
export const TICK_MS = 110;

/** 0 E · 1 SE · 2 S · 3 SW · 4 W · 5 NW · 6 N · 7 NE (row grows southward). */
export const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
export const DIR_ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"] as const;
export const isDiag = (d: number) => d % 2 === 1;
export const ticksFor = (d: number) => (isDiag(d) ? DIAG_TICKS : ORTHO_TICKS);
export const turnDir = (d: number, k: number) => (((d + k) % 8) + 8) % 8;

export type PieceKind = "pusher" | "domino" | "split" | "wall";
export type FeatureKind = "bell" | "bomb" | "rock";

export interface Piece {
  kind: PieceKind;
  owner: Seat;
  dir: number;
}

export interface Feature {
  kind: FeatureKind;
  /** Bell value (1–3); 0 for the others. */
  value: number;
}

export interface Cell {
  piece: Piece | null;
  feature: Feature | null;
}

export interface GameOptions {
  rounds: 1 | 3;
  /** Building turns per player per round (0 = auto by player count). */
  turns: number;
  /** 🔮 Preview of who would own what if it all fell now (display only, but host-wide so everyone sees the same). */
  preview: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 3, turns: 0, preview: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const t = Math.round(Number(o?.turns));
  return { rounds: o?.rounds === 1 ? 1 : 3, turns: Number.isFinite(t) && t >= 3 && t <= 8 ? t : 0, preview: o?.preview !== false };
}

export function boardSizeFor(playerCount: number): number {
  return playerCount <= 2 ? 11 : 13;
}

export function turnsFor(playerCount: number, opt: GameOptions): number {
  if (opt.turns) return opt.turns;
  return playerCount <= 2 ? 6 : playerCount === 3 ? 5 : 4;
}

/** Board sides by seat: 0 = south (pushing north), 1 = west, 2 = north, 3 = east (4p); 2p uses south/north; 3p south/west/east. */
export function sidesFor(playerCount: number): number[] {
  if (playerCount <= 2) return [0, 2];
  if (playerCount === 3) return [0, 1, 3];
  return [0, 1, 2, 3];
}

export function pusherOf(size: number, side: number): { c: number; r: number; dir: number } {
  const m = (size - 1) / 2;
  switch (side) {
    case 0:
      return { c: m, r: size - 1, dir: 6 };
    case 1:
      return { c: 0, r: m, dir: 0 };
    case 2:
      return { c: m, r: 0, dir: 2 };
    default:
      return { c: size - 1, r: m, dir: 4 };
  }
}

export interface ToppleEvent {
  /** Tick it happens. */
  t: number;
  cell: number;
  kind: "fall" | "ring" | "boom";
  /** Chain owner that claimed it (−1 = shared tie on a bell, see `owners`). */
  owner: Seat;
  /** All claimants (bells rung by several chains at once score for each). */
  owners: Seat[];
  /** Fall direction for "fall". */
  dir: number;
  /** Piece colour before the hit (a steal shows the colour flip). */
  was: Seat;
}

export interface RoundResult {
  round: number;
  events: ToppleEvent[];
  /** Last event tick (animation length). */
  ticks: number;
  /** Points per seat this round (bells + bonus − bombs). */
  points: number[];
  bells: number[];
  bombs: number[];
  /** Pieces each chain toppled (pushers excluded). */
  chain: number[];
  /** Rival pieces each chain stole. */
  steals: number[];
  longest: Seat[];
}

export type Phase = "build" | "topple" | "ended";

export interface DominoState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  size: number;
  round: number;
  cells: Cell[];
  phase: Phase;
  activeSeat: Seat;
  /** Seat that opened this round's building (rotates). */
  firstSeat: Seat;
  /** Placements still allowed this turn. */
  placementsLeft: number;
  /** Building turns left per seat. */
  turnsLeft: number[];
  splitsLeft: number[];
  wallsLeft: number[];
  scores: number[];
  /** Monotonic action counter. */
  turn: number;
  /** Last piece placed (for highlight / sound). */
  lastPlace: { seat: Seat; cell: number; kind: PieceKind; turn: number } | null;
  lastPass: { seat: Seat; turn: number; timeout: boolean } | null;
  result: RoundResult | null;
  history: RoundResult[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "place"; seat: Seat; cell: number; kind: "domino" | "split" | "wall"; dir: number }
  | { type: "pass"; seat: Seat }
  | { type: "timeout"; seat: Seat; turn: number }
  | { type: "next"; seat?: Seat };

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

export const idx = (size: number, c: number, r: number) => c + r * size;
export const colOf = (size: number, i: number) => i % size;
export const rowOf = (size: number, i: number) => Math.floor(i / size);

/** Cell one step from `i` toward `d`, or −1 off the board. */
export function stepCell(size: number, i: number, d: number): number {
  const c = colOf(size, i) + DIRS[d][0];
  const r = rowOf(size, i) + DIRS[d][1];
  if (c < 0 || r < 0 || c >= size || r >= size) return -1;
  return idx(size, c, r);
}

/** Directions a piece falls onto (domino/pusher: forward; split: both forward diagonals). */
export function fallDirs(p: Piece): number[] {
  if (p.kind === "split") return [turnDir(p.dir, -1), turnDir(p.dir, 1)];
  if (p.kind === "wall") return [];
  return [p.dir];
}

export function isEmpty(cell: Cell): boolean {
  return !cell.piece && !cell.feature;
}

/**
 * Open ends of `seat`'s chains (§4): empty cells a standing piece of theirs
 * would fall onto, with the arrival directions that reach them.
 */
export function frontier(state: Pick<DominoState, "cells" | "size">, seat: Seat): Map<number, number[]> {
  const out = new Map<number, number[]>();
  state.cells.forEach((cell, i) => {
    const p = cell.piece;
    if (!p || p.owner !== seat || p.kind === "wall") return;
    for (const d of fallDirs(p)) {
      let j = stepCell(state.size, i, d);
      // a bell rings and lets the fall carry on through it (§5)
      while (j >= 0 && !state.cells[j].piece && state.cells[j].feature?.kind === "bell") j = stepCell(state.size, j, d);
      if (j < 0 || !isEmpty(state.cells[j])) continue;
      const arr = out.get(j) ?? [];
      if (!arr.includes(d)) arr.push(d);
      out.set(j, arr);
    }
  });
  return out;
}

/** Facings allowed for a new piece on `cell` (90° left … 90° right of each arrival). */
export function allowedDirs(state: Pick<DominoState, "cells" | "size">, seat: Seat, cell: number): number[] {
  const arr = frontier(state, seat).get(cell);
  if (!arr) return [];
  const set = new Set<number>();
  for (const a of arr) for (let k = -2; k <= 2; k++) set.add(turnDir(a, k));
  return [...set].sort((x, y) => x - y);
}

/** A wall may go on any empty cell at least 2 steps (king moves) from every pusher. */
export function canWall(state: Pick<DominoState, "cells" | "size">, cell: number): boolean {
  if (cell < 0 || cell >= state.cells.length || !isEmpty(state.cells[cell])) return false;
  const c = colOf(state.size, cell);
  const r = rowOf(state.size, cell);
  for (let i = 0; i < state.cells.length; i++) {
    const p = state.cells[i].piece;
    if (p?.kind !== "pusher") continue;
    if (Math.max(Math.abs(colOf(state.size, i) - c), Math.abs(rowOf(state.size, i) - r)) < 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Setup (§3)
// ---------------------------------------------------------------------------

function rotate(size: number, c: number, r: number, k: number): [number, number] {
  let x = c;
  let y = r;
  for (let i = 0; i < k; i++) {
    const nx = size - 1 - y;
    y = x;
    x = nx;
  }
  return [x, y];
}

/** Seeded, symmetric layout of bells / bombs / rocks plus every seat's pusher. */
export function makeBoard(playerCount: number, seed: number): Cell[] {
  const size = boardSizeFor(playerCount);
  const cells: Cell[] = Array.from({ length: size * size }, () => ({ piece: null, feature: null }));
  const sides = sidesFor(playerCount);
  const pushers = sides.map((side) => pusherOf(size, side));
  sides.forEach((side, seat) => {
    const p = pushers[seat];
    cells[idx(size, p.c, p.r)].piece = { kind: "pusher", owner: seat, dir: p.dir };
  });
  // every pusher of the full symmetric set keeps its first two cells clear (also the unused north side in 3p)
  const allPushers = (playerCount <= 2 ? [0, 2] : [0, 1, 2, 3]).map((side) => pusherOf(size, side));
  const reserved = new Set<number>();
  for (const p of allPushers) {
    for (let dc = -1; dc <= 1; dc++)
      for (let k = 0; k <= 2; k++) {
        const c = p.c + DIRS[p.dir][0] * k + (DIRS[p.dir][0] === 0 ? dc : 0);
        const r = p.r + DIRS[p.dir][1] * k + (DIRS[p.dir][1] === 0 ? dc : 0);
        if (c >= 0 && r >= 0 && c < size && r < size) reserved.add(idx(size, c, r));
      }
  }
  const rng = seededRng(seed ^ 0x0d0e1);
  const m = (size - 1) / 2;
  const sym = playerCount <= 2 ? [0, 2] : [0, 1, 2, 3];
  const taken = new Set<number>(reserved);
  const put = (c: number, r: number, f: Feature): boolean => {
    const orbit = sym.map((k) => rotate(size, c, r, k)).map(([x, y]) => idx(size, x, y));
    if (orbit.some((i) => taken.has(i))) return false;
    // never two features touching inside one orbit draw (keeps lines between them)
    for (const i of orbit) {
      taken.add(i);
      cells[i].feature = { ...f };
    }
    return true;
  };
  cells[idx(size, m, m)].feature = { kind: "bell", value: 3 };
  taken.add(idx(size, m, m));
  const tryOrbits = (count: number, make: (c: number, r: number) => Feature | null) => {
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < count; attempt++) {
      const c = Math.floor(rng() * size);
      const r = Math.floor(rng() * size);
      const f = make(c, r);
      if (!f) continue;
      if (put(c, r, f)) placed++;
    }
  };
  const dist = (c: number, r: number) => Math.max(Math.abs(c - m), Math.abs(r - m));
  // 2-point bells near the middle, 1-point bells further out
  tryOrbits(1, (c, r) => (dist(c, r) >= 2 && dist(c, r) <= 3 ? { kind: "bell", value: 2 } : null));
  tryOrbits(playerCount <= 2 ? 2 : 2, (c, r) => (dist(c, r) >= 3 && dist(c, r) <= m - 1 ? { kind: "bell", value: 1 } : null));
  tryOrbits(1, (c, r) => (dist(c, r) >= 2 && dist(c, r) <= m - 1 ? { kind: "bomb", value: 0 } : null));
  tryOrbits(playerCount <= 2 ? 2 : 1, (c, r) => (dist(c, r) >= 1 && dist(c, r) <= m ? { kind: "rock", value: 0 } : null));
  if (playerCount === 3) {
    // nobody pushes from the north in 3p: its quarter would be a free bonus for west/east, so it stays bare
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        if (r < c && r < size - 1 - c && cells[idx(size, c, r)].feature?.kind !== "rock") cells[idx(size, c, r)].feature = null;
      }
  }
  return cells;
}

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): DominoState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts = sanitizeOptions(options);
  const first = Math.floor(seededRng(seed ^ 0x51ed)() * n);
  return {
    seed,
    playerCount: n,
    options: opts,
    size: boardSizeFor(n),
    round: 0,
    cells: makeBoard(n, seed),
    phase: "build",
    activeSeat: first,
    firstSeat: first,
    placementsLeft: OPENING_PLACEMENTS,
    turnsLeft: Array(n).fill(turnsFor(n, opts)),
    splitsLeft: Array(n).fill(1),
    wallsLeft: Array(n).fill(1),
    scores: Array(n).fill(0),
    turn: 0,
    lastPlace: null,
    lastPass: null,
    result: null,
    history: [],
  };
}

// ---------------------------------------------------------------------------
// The topple (§5)
// ---------------------------------------------------------------------------

interface Hit {
  cell: number;
  owner: Seat;
  /** Direction the hit travels (a bell passes it on). */
  dir: number;
}

/**
 * Runs every chain on the shared clock. Pure: the same board always gives
 * the same events. `firstSeat` breaks exact ties for a rival's piece (the
 * seat order starting there), matching the rulebook's "순서상 먼저".
 */
export function topple(cells: readonly Cell[], size: number, playerCount: number, firstSeat: Seat, round = 0): RoundResult {
  const fallen = new Uint8Array(cells.length);
  const rung = new Uint8Array(cells.length);
  const boomed = new Uint8Array(cells.length);
  const events: ToppleEvent[] = [];
  const queue = new Map<number, Hit[]>();
  const push = (t: number, h: Hit) => {
    const arr = queue.get(t);
    if (arr) arr.push(h);
    else queue.set(t, [h]);
  };
  const order = (s: Seat) => (s - firstSeat + playerCount) % playerCount;
  const fallFrom = (t: number, i: number, p: Piece, owner: Seat) => {
    for (const d of fallDirs(p)) {
      const j = stepCell(size, i, d);
      if (j >= 0) push(t + ticksFor(d), { cell: j, owner, dir: d });
    }
  };
  cells.forEach((c, i) => {
    if (c.piece?.kind === "pusher") {
      fallen[i] = 1;
      events.push({ t: 0, cell: i, kind: "fall", owner: c.piece.owner, owners: [c.piece.owner], dir: c.piece.dir, was: c.piece.owner });
      fallFrom(0, i, c.piece, c.piece.owner);
    }
  });
  const points = Array(playerCount).fill(0);
  const bells = Array(playerCount).fill(0);
  const bombs = Array(playerCount).fill(0);
  const chain = Array(playerCount).fill(0);
  const steals = Array(playerCount).fill(0);
  let ticks = 0;
  for (let guard = 0; guard < 4000 && queue.size > 0; guard++) {
    const t = Math.min(...queue.keys());
    const hits = queue.get(t)!;
    queue.delete(t);
    // group claims per cell (everything that lands on one tick lands together)
    const byCell = new Map<number, Seat[]>();
    const dirsAt = new Map<number, Hit[]>();
    for (const h of hits) {
      const arr = byCell.get(h.cell) ?? [];
      if (!arr.includes(h.owner)) arr.push(h.owner);
      byCell.set(h.cell, arr);
      const hs = dirsAt.get(h.cell) ?? [];
      if (!hs.some((x) => x.owner === h.owner && x.dir === h.dir)) hs.push(h);
      dirsAt.set(h.cell, hs);
    }
    const cellsNow = [...byCell.keys()].sort((a, b) => a - b);
    for (const i of cellsNow) {
      const claims = byCell.get(i)!.sort((a, b) => order(a) - order(b));
      const cell = cells[i];
      const p = cell.piece;
      if (p && (p.kind === "domino" || p.kind === "split") && !fallen[i]) {
        fallen[i] = 1;
        const owner = claims.includes(p.owner) ? p.owner : claims[0];
        chain[owner] += 1;
        if (owner !== p.owner) steals[owner] += 1;
        events.push({ t, cell: i, kind: "fall", owner, owners: [owner], dir: p.dir, was: p.owner });
        fallFrom(t, i, p, owner);
        ticks = Math.max(ticks, t + 2);
      } else if (cell.feature?.kind === "bell" && !p) {
        if (!rung[i]) {
          rung[i] = 1;
          for (const o of claims) {
            points[o] += cell.feature.value;
            bells[o] += 1;
          }
          events.push({ t, cell: i, kind: "ring", owner: claims.length === 1 ? claims[0] : -1, owners: claims, dir: 0, was: -1 });
          ticks = Math.max(ticks, t + 3);
        }
        // the fall carries on through the bell, same direction
        for (const h of dirsAt.get(i)!) {
          const j = stepCell(size, i, h.dir);
          if (j >= 0) push(t + ticksFor(h.dir), { cell: j, owner: h.owner, dir: h.dir });
        }
      } else if (cell.feature?.kind === "bomb" && !boomed[i]) {
        boomed[i] = 1;
        const o = claims[0];
        points[o] -= BOMB_PENALTY;
        bombs[o] += 1;
        events.push({ t, cell: i, kind: "boom", owner: o, owners: claims, dir: 0, was: -1 });
        for (let d = 0; d < 8; d++) {
          const j = stepCell(size, i, d);
          if (j >= 0) push(t + ticksFor(d), { cell: j, owner: o, dir: d });
        }
        ticks = Math.max(ticks, t + 4);
      }
    }
  }
  // biggest chain bonus (§6)
  const best = Math.max(...chain);
  const longest: Seat[] = [];
  if (best > 0) {
    for (let s = 0; s < playerCount; s++) if (chain[s] === best) longest.push(s);
    for (const s of longest) points[s] += longest.length === 1 ? LONGEST_BONUS : 1;
  }
  events.sort((a, b) => a.t - b.t || a.cell - b.cell);
  return { round, events, ticks, points, bells, bombs, chain, steals, longest };
}

/** "If it all fell now" (🔮 preview + bots). */
export function previewTopple(state: DominoState): RoundResult {
  return topple(state.cells, state.size, state.playerCount, state.firstSeat, state.round);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function canPlay(state: DominoState, seat: Seat): boolean {
  return state.phase === "build" && seat === state.activeSeat;
}

export function legalPlace(state: DominoState, a: Extract<EngineAction, { type: "place" }>): boolean {
  if (!canPlay(state, a.seat) || state.placementsLeft <= 0) return false;
  if (!Number.isInteger(a.cell) || a.cell < 0 || a.cell >= state.cells.length) return false;
  if (a.kind === "wall") return state.wallsLeft[a.seat] > 0 && canWall(state, a.cell);
  if (!Number.isInteger(a.dir) || a.dir < 0 || a.dir > 7) return false;
  if (a.kind === "split" && state.splitsLeft[a.seat] <= 0) return false;
  if (a.kind !== "domino" && a.kind !== "split") return false;
  return allowedDirs(state, a.seat, a.cell).includes(a.dir);
}

function endTurn(state: DominoState, seat: Seat): DominoState {
  const turnsLeft = [...state.turnsLeft];
  turnsLeft[seat] = Math.max(0, turnsLeft[seat] - 1);
  if (turnsLeft.every((t) => t <= 0)) return runTopple({ ...state, turnsLeft });
  let next = seat;
  for (let k = 1; k <= state.playerCount; k++) {
    const s = (seat + k) % state.playerCount;
    if (turnsLeft[s] > 0) {
      next = s;
      break;
    }
  }
  return { ...state, turnsLeft, activeSeat: next, placementsLeft: PLACEMENTS_PER_TURN };
}

function runTopple(state: DominoState): DominoState {
  const result = topple(state.cells, state.size, state.playerCount, state.firstSeat, state.round);
  const scores = state.scores.map((s, i) => s + result.points[i]);
  let tally = state.statTally;
  for (let s = 0; s < state.playerCount; s++) {
    if (result.bells[s]) tally = tallyAdd(tally, s, "bells", result.bells[s]);
    if (result.bombs[s]) tally = tallyAdd(tally, s, "bombs", result.bombs[s]);
    if (result.steals[s]) tally = tallyAdd(tally, s, "steals", result.steals[s]);
    tally = tallyAdd(tally, s, "toppled", result.chain[s]);
    tally = tallyMax(tally, s, "maxChain", result.chain[s]);
    tally = tallyMax(tally, s, "bestRound", result.points[s]);
    if (result.longest.includes(s)) tally = tallyAdd(tally, s, "longest");
    const bigBell = result.events.some((e) => e.kind === "ring" && e.owners.includes(s) && state.cells[e.cell].feature?.value === 3);
    if (bigBell) tally = tallyAdd(tally, s, "bigBells");
  }
  const best = Math.max(...result.points);
  for (let s = 0; s < state.playerCount; s++) if (result.points[s] === best && best > 0) tally = tallyAdd(tally, s, "roundWins");
  return { ...state, phase: "topple", scores, result, history: [...state.history, result], statTally: tally, placementsLeft: 0 };
}

function doPlace(state: DominoState, a: Extract<EngineAction, { type: "place" }>): DominoState {
  if (!legalPlace(state, a)) return state;
  const cells = state.cells.slice();
  cells[a.cell] = { ...cells[a.cell], piece: { kind: a.kind, owner: a.seat, dir: a.kind === "wall" ? 0 : a.dir } };
  const splitsLeft = [...state.splitsLeft];
  const wallsLeft = [...state.wallsLeft];
  if (a.kind === "split") splitsLeft[a.seat] -= 1;
  if (a.kind === "wall") wallsLeft[a.seat] -= 1;
  let tally = state.statTally;
  tally = tallyAdd(tally, a.seat, a.kind === "domino" ? "placed" : a.kind === "split" ? "splits" : "walls");
  const placed: DominoState = {
    ...state,
    cells,
    splitsLeft,
    wallsLeft,
    statTally: tally,
    turn: state.turn + 1,
    placementsLeft: state.placementsLeft - 1,
    lastPlace: { seat: a.seat, cell: a.cell, kind: a.kind, turn: state.turn },
    lastPass: null,
  };
  if (placed.placementsLeft > 0 && hasAnyMove(placed, a.seat)) return placed;
  return endTurn(placed, a.seat);
}

/** Anything left to place this turn (a frontier cell, or a wall still in hand). */
export function hasAnyMove(state: DominoState, seat: Seat): boolean {
  if (frontier(state, seat).size > 0) return true;
  if (state.wallsLeft[seat] > 0) return state.cells.some((_, i) => canWall(state, i));
  return false;
}

function doPass(state: DominoState, seat: Seat, timeout: boolean): DominoState {
  if (!canPlay(state, seat)) return state;
  const s = endTurn({ ...state, turn: state.turn + 1, lastPass: { seat, turn: state.turn, timeout } }, seat);
  return s;
}

function nextRound(state: DominoState): DominoState {
  if (state.phase !== "topple") return state;
  if (state.round + 1 >= state.options.rounds) return { ...state, phase: "ended", turn: state.turn + 1 };
  const round = state.round + 1;
  // §4 — the leader builds first next round (opening with one piece is the weaker spot); ties rotate on
  const best = Math.max(...state.scores);
  let first = (state.firstSeat + 1) % state.playerCount;
  for (let k = 0; k < state.playerCount; k++) {
    const s = (state.firstSeat + 1 + k) % state.playerCount;
    if (state.scores[s] === best) {
      first = s;
      break;
    }
  }
  return {
    ...state,
    round,
    cells: makeBoard(state.playerCount, state.seed + round * 7919),
    phase: "build",
    activeSeat: first,
    firstSeat: first,
    placementsLeft: OPENING_PLACEMENTS,
    turnsLeft: Array(state.playerCount).fill(turnsFor(state.playerCount, state.options)),
    splitsLeft: Array(state.playerCount).fill(1),
    wallsLeft: Array(state.playerCount).fill(1),
    turn: state.turn + 1,
    lastPlace: null,
    lastPass: null,
    result: null,
  };
}

export function applyAction(state: DominoState, action: EngineAction): DominoState {
  switch (action?.type) {
    case "place":
      return doPlace(state, action);
    case "pass":
      return doPass(state, action.seat, false);
    case "timeout":
      if (action.turn !== state.turn) return state;
      return doPass(state, action.seat, true);
    case "next":
      return nextRound(state);
    default:
      return state;
  }
}

export function currentActor(state: DominoState): Seat | null {
  return state.phase === "build" ? state.activeSeat : null;
}

// ---------------------------------------------------------------------------
// Rankings (§7)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

export function totals(state: DominoState, seat: Seat): { bells: number; chain: number } {
  return state.history.reduce((a, r) => ({ bells: a.bells + r.bells[seat], chain: a.chain + r.chain[seat] }), { bells: 0, chain: 0 });
}

export function computeRankings(state: DominoState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => {
    const t = totals(state, s);
    return [state.scores[s], t.bells, t.chain];
  };
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
