/**
 * 시티 체이스 (City Chase: 경찰 vs 도둑) — pure lockstep engine.
 *
 * Rules source: `boardGameRule/시티체이스 도둑과 경찰/시티체이스 도둑과 경찰.md`.
 * One seat is the thief, every other seat (1~3) is the police team that
 * shares 3 helicopters. 11 rounds of [thief move → 3 helicopter actions].
 *
 * Geometry:
 *  - 25 buildings on a 5×5 grid, `Cell` = r * 5 + c.
 *  - 36 road intersections on a 6×6 lattice, `Point` = i * 6 + j. Point
 *    (i, j) touches the (up to 4) buildings (i-1|i, j-1|j) around it, so a
 *    helicopter always sits on a building corner, never on a building.
 *
 * Hidden information: like every other game in this catalog (docs/cloud-sync.md)
 * every client computes the full state — including `path`, the thief's real
 * route — from replayed actions. The board component is what hides it from
 * police viewers.
 *
 * No randomness lives in the reducer (lockstep determinism). The bots
 * (`chooseBotAction`) run only on the host and may use `Math.random`.
 */

import { pickByLevel, type BotLevel, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export type SeatIndex = number;
export type Cell = number;
export type Point = number;

export const GRID = 5;
export const POINT_GRID = GRID + 1;
export const CELL_COUNT = GRID * GRID;
export const POINT_COUNT = POINT_GRID * POINT_GRID;
export const TOTAL_ROUNDS = 11;
export const HELI_COUNT = 3;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export type TokenColor = "yellow" | "blue" | "red";

export function tokenColor(round: number): TokenColor {
  if (round === 1) return "yellow";
  if (round === TOTAL_ROUNDS) return "red";
  return "blue";
}

export type SearchResult = "empty" | "trail" | "caught";

export interface SearchRecord {
  round: number;
  heli: number;
  seat: SeatIndex;
  cell: Cell;
  result: SearchResult;
  /** Trail tokens seen under the building (not counting the car's own current-round token), oldest first. */
  tokens: TokenColor[];
}

export type CityEvent =
  | { kind: "thiefMove"; round: number }
  | { kind: "heliPlace"; heli: number; at: Point }
  | { kind: "heliMove"; heli: number; from: Point; to: Point }
  | { kind: "search"; heli: number; cell: Cell; result: SearchResult; tokens: TokenColor[] }
  | { kind: "escaped" }
  | { kind: "trapped" };

export interface CityChaseState {
  playerCount: number;
  thiefSeat: SeatIndex;
  /** Police seats in seat order; helicopter h is flown by `policeSeats[h % policeSeats.length]`. */
  policeSeats: SeatIndex[];
  /**
   * Round 1 (house rule, 2026-09-25): the thief hides first, then "deploy" —
   * the police place the 3 helicopters on any free intersections, and that
   * placement IS the police's whole round-1 turn (no search in round 1).
   */
  phase: "thief" | "deploy" | "police" | "gameOver";
  round: number;
  /** path[r - 1] = the building the car sits under during round r. SECRET from police viewers. */
  path: Cell[];
  /** Placed helicopters (empty until the round-1 deploy, then always 3). */
  helis: Point[];
  /** heliHistory[r - 1] = helicopter positions the thief saw when choosing round r's building (public). */
  heliHistory: Point[][];
  /** During the deploy/police phase: which helicopter acts next (0..2). */
  heliTurn: number;
  searches: SearchRecord[];
  winner: "thief" | "police" | null;
  endReason: "caught" | "escaped" | "trapped" | null;
  lastEvent: CityEvent | null;
  /** Monotonic, bumped on every applied action (state-sync race guard, docs/cloud-sync.md §2.3). */
  seq: number;
}

export type EngineAction =
  | { type: "THIEF_MOVE"; seat: SeatIndex; cell: Cell }
  | { type: "HELI_PLACE"; seat: SeatIndex; heli: number; at: Point }
  | { type: "HELI_MOVE"; seat: SeatIndex; heli: number; to: Point }
  | { type: "HELI_SEARCH"; seat: SeatIndex; heli: number; cell: Cell };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function cellOf(r: number, c: number): Cell {
  return r * GRID + c;
}
export function cellRC(cell: Cell): [number, number] {
  return [Math.floor(cell / GRID), cell % GRID];
}
export function pointOf(i: number, j: number): Point {
  return i * POINT_GRID + j;
}
export function pointIJ(p: Point): [number, number] {
  return [Math.floor(p / POINT_GRID), p % POINT_GRID];
}

const CELL_NEIGHBORS: Cell[][] = Array.from({ length: CELL_COUNT }, (_, cell) => {
  const [r, c] = cellRC(cell);
  const out: Cell[] = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) out.push(cellOf(nr, nc));
  }
  return out;
});

const POINT_NEIGHBORS: Point[][] = Array.from({ length: POINT_COUNT }, (_, p) => {
  const [i, j] = pointIJ(p);
  const out: Point[] = [];
  for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const ni = i + di;
    const nj = j + dj;
    if (ni >= 0 && ni < POINT_GRID && nj >= 0 && nj < POINT_GRID) out.push(pointOf(ni, nj));
  }
  return out;
});

const POINT_CELLS: Cell[][] = Array.from({ length: POINT_COUNT }, (_, p) => {
  const [i, j] = pointIJ(p);
  const out: Cell[] = [];
  for (const [r, c] of [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]]) {
    if (r >= 0 && r < GRID && c >= 0 && c < GRID) out.push(cellOf(r, c));
  }
  return out;
});

/** Orthogonally adjacent buildings (no diagonals). */
export function cellNeighbors(cell: Cell): readonly Cell[] {
  return CELL_NEIGHBORS[cell];
}
/** Intersections one road segment away. */
export function pointNeighbors(p: Point): readonly Point[] {
  return POINT_NEIGHBORS[p];
}
/** Buildings touching an intersection (1 at a corner of the board, 2 on an edge, 4 inside). */
export function pointCells(p: Point): readonly Cell[] {
  return POINT_CELLS[p];
}

/** Road steps a helicopter needs before it can search `cell`. */
function heliStepsToCell(p: Point, cell: Cell): number {
  const [i, j] = pointIJ(p);
  const [r, c] = cellRC(cell);
  const di = i < r ? r - i : i > r + 1 ? i - (r + 1) : 0;
  const dj = j < c ? c - j : j > c + 1 ? j - (c + 1) : 0;
  return di + dj;
}

// ---------------------------------------------------------------------------
// Setup / queries
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, thiefSeat: SeatIndex): CityChaseState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const thief = ((thiefSeat % playerCount) + playerCount) % playerCount;
  const policeSeats = Array.from({ length: playerCount }, (_, s) => s).filter((s) => s !== thief);
  return {
    playerCount,
    thiefSeat: thief,
    policeSeats,
    phase: "thief",
    round: 1,
    path: [],
    helis: [],
    heliHistory: [],
    heliTurn: 0,
    searches: [],
    winner: null,
    endReason: null,
    lastEvent: null,
    seq: 0,
  };
}

export function heliController(state: CityChaseState, heli: number): SeatIndex {
  return state.policeSeats[heli % state.policeSeats.length];
}

export function currentActor(state: CityChaseState): SeatIndex | null {
  if (state.phase === "thief") return state.thiefSeat;
  if (state.phase === "police" || state.phase === "deploy") return heliController(state, state.heliTurn);
  return null;
}

export function isStateSyncStale(current: CityChaseState | null, synced: CityChaseState): boolean {
  return current !== null && synced.seq < current.seq;
}

export function thiefCell(state: CityChaseState): Cell | null {
  return state.path.length > 0 ? state.path[state.path.length - 1] : null;
}

/**
 * Buildings the thief may drive to this turn. House rule (2026-09-25, user
 * request): a building the car has already been under can never be entered
 * again, so the route is a self-avoiding walk and the rulebook's "도둑이 더
 * 이상 이동할 수 없으면 경찰 승리" becomes a real way to lose.
 */
export function legalThiefCells(state: CityChaseState): Cell[] {
  if (state.phase !== "thief") return [];
  const at = thiefCell(state);
  if (at === null) return Array.from({ length: CELL_COUNT }, (_, c) => c);
  return cellNeighbors(at).filter((n) => !state.path.includes(n));
}

/** Free intersections the next helicopter may be deployed on (no stacking). */
export function legalPlacements(state: CityChaseState): Point[] {
  if (state.phase !== "deploy") return [];
  return Array.from({ length: POINT_COUNT }, (_, p) => p).filter((p) => !state.helis.includes(p));
}

/** Trail tokens + car currently under `cell` (the thief's private view). */
export function cellContents(state: CityChaseState, cell: Cell): { tokens: TokenColor[]; car: boolean } {
  const tokens: TokenColor[] = [];
  state.path.forEach((c, idx) => {
    if (c === cell) tokens.push(tokenColor(idx + 1));
  });
  return { tokens, car: thiefCell(state) === cell };
}

/** The most recent search of each building, for the police's shared notes. */
export function latestSearchByCell(state: CityChaseState): Map<Cell, SearchRecord> {
  const map = new Map<Cell, SearchRecord>();
  for (const s of state.searches) map.set(s.cell, s);
  return map;
}

export function computeRankings(state: CityChaseState): { seat: SeatIndex; rank: number }[] {
  const thiefWon = state.winner === "thief";
  return Array.from({ length: state.playerCount }, (_, seat) => {
    const isThief = seat === state.thiefSeat;
    return { seat, rank: isThief === thiefWon ? 1 : 2 };
  });
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function contentsAt(path: readonly Cell[], round: number, cell: Cell): { tokens: TokenColor[]; car: boolean } {
  const tokens: TokenColor[] = [];
  for (let s = 1; s < round; s++) if (path[s - 1] === cell) tokens.push(tokenColor(s));
  return { tokens, car: path[round - 1] === cell };
}

function advanceAfterHeli(state: CityChaseState): CityChaseState {
  if (state.heliTurn < HELI_COUNT - 1) return { ...state, heliTurn: state.heliTurn + 1 };
  if (state.round >= TOTAL_ROUNDS) {
    return { ...state, phase: "gameOver", winner: "thief", endReason: "escaped", lastEvent: { kind: "escaped" } };
  }
  const next: CityChaseState = { ...state, round: state.round + 1, phase: "thief", heliTurn: 0 };
  // "도둑이 더 이상 인접한 칸으로 이동할 수 없는 상태에 빠져도 경찰이 승리" — with the
  // no-revisit rule the car can box itself into a dead end.
  if (legalThiefCells(next).length === 0) {
    return { ...next, phase: "gameOver", winner: "police", endReason: "trapped", lastEvent: { kind: "trapped" } };
  }
  return next;
}

export function applyAction(state: CityChaseState, action: EngineAction): CityChaseState {
  if (state.phase === "gameOver") return state;
  if (action.seat !== currentActor(state)) return state;

  switch (action.type) {
    case "THIEF_MOVE": {
      if (state.phase !== "thief") return state;
      if (!legalThiefCells(state).includes(action.cell)) return state;
      return {
        ...state,
        path: [...state.path, action.cell],
        heliHistory: [...state.heliHistory, state.helis.slice()],
        phase: state.round === 1 ? "deploy" : "police",
        heliTurn: 0,
        lastEvent: { kind: "thiefMove", round: state.round },
        seq: state.seq + 1,
      };
    }
    case "HELI_PLACE": {
      if (state.phase !== "deploy" || action.heli !== state.heliTurn) return state;
      if (!legalPlacements(state).includes(action.at)) return state;
      return advanceAfterHeli({
        ...state,
        helis: [...state.helis, action.at],
        lastEvent: { kind: "heliPlace", heli: action.heli, at: action.at },
        seq: state.seq + 1,
      });
    }
    case "HELI_MOVE": {
      if (state.phase !== "police" || action.heli !== state.heliTurn) return state;
      const from = state.helis[action.heli];
      if (!pointNeighbors(from).includes(action.to)) return state;
      const helis = state.helis.slice();
      helis[action.heli] = action.to;
      return advanceAfterHeli({
        ...state,
        helis,
        lastEvent: { kind: "heliMove", heli: action.heli, from, to: action.to },
        seq: state.seq + 1,
      });
    }
    case "HELI_SEARCH": {
      if (state.phase !== "police" || action.heli !== state.heliTurn) return state;
      if (!pointCells(state.helis[action.heli]).includes(action.cell)) return state;
      const { tokens, car } = contentsAt(state.path, state.round, action.cell);
      const result: SearchResult = car ? "caught" : tokens.length > 0 ? "trail" : "empty";
      const record: SearchRecord = { round: state.round, heli: action.heli, seat: action.seat, cell: action.cell, result, tokens };
      const searched: CityChaseState = {
        ...state,
        searches: [...state.searches, record],
        lastEvent: { kind: "search", heli: action.heli, cell: action.cell, result, tokens },
        seq: state.seq + 1,
      };
      if (car) return { ...searched, phase: "gameOver", winner: "police", endReason: "caught" };
      return advanceAfterHeli(searched);
    }
  }
}

// ---------------------------------------------------------------------------
// Police deduction (shared by the police bot, the thief bot and the UI's
// "수사 지도" heat overlay)
// ---------------------------------------------------------------------------

function matchesSearch(path: readonly Cell[], s: SearchRecord): boolean {
  const { tokens, car } = contentsAt(path, s.round, s.cell);
  if (s.result === "caught") return car;
  if (car) return false;
  if (tokens.length !== s.tokens.length) return false;
  // Yellow is the only colour that can differ at equal counts (red is always the car's own).
  return tokens.filter((t) => t === "yellow").length === s.tokens.filter((t) => t === "yellow").length;
}

function coveredCells(helis: readonly Point[]): Uint8Array {
  const covered = new Uint8Array(CELL_COUNT);
  for (const p of helis) for (const c of POINT_CELLS[p]) covered[c] = 1;
  return covered;
}

/** Chance weight a careful thief still drives next to a helicopter when a safe building exists. */
const RISK_LEAK = 0.08;

const ALL_CELLS: Cell[] = Array.from({ length: CELL_COUNT }, (_, c) => c);

/**
 * Where a thief standing on `from` drives next, assuming they avoid buildings
 * a helicopter can lift this turn whenever a safe neighbour exists (the core
 * tension of the rulebook — the car MUST move every round).
 */
function stepWeights(
  from: Cell | null,
  covered: Uint8Array,
  visited: readonly Cell[] = [],
): { cells: readonly Cell[]; weights: number[] } {
  const cells = from === null ? ALL_CELLS : CELL_NEIGHBORS[from].filter((c) => !visited.includes(c));
  const anySafe = cells.some((c) => !covered[c]);
  const weights = cells.map((c) => (!anySafe || !covered[c] ? 1 : RISK_LEAK));
  return { cells, weights };
}

/** Next building for a particle route, or -1 when it has driven into a dead end. */
function sampleStep(path: readonly Cell[], covered: Uint8Array, rng: () => number): Cell {
  const { cells, weights } = stepWeights(path.length ? path[path.length - 1] : null, covered, path);
  if (cells.length === 0) return -1;
  const total = weights.reduce((a, w) => a + w, 0);
  let x = rng() * total;
  for (let i = 0; i < cells.length; i++) {
    x -= weights[i];
    if (x <= 0) return cells[i];
  }
  return cells[cells.length - 1];
}

/**
 * Sequential Monte Carlo over the thief's whole route, using only what the
 * police know (search log + public helicopter history — never `path`).
 * Particles follow the helicopter-avoiding model above; each round's search
 * results prune them and survivors are resampled. A search at round r only
 * depends on the route up to r, so later extensions never invalidate an
 * already-checked particle.
 *
 * Returns the probability of the car being under each building during
 * `upToRound`, or null if no particle survived (callers fall back to flat).
 */
export function policeBelief(
  searches: readonly SearchRecord[],
  heliHistory: readonly (readonly Point[])[],
  upToRound: number,
  particleCount: number,
  rng: () => number = Math.random,
): Float64Array | null {
  if (upToRound < 1) return null;
  const byRound = new Map<number, SearchRecord[]>();
  for (const s of searches) {
    if (s.round > upToRound) continue;
    const list = byRound.get(s.round) ?? [];
    list.push(s);
    byRound.set(s.round, list);
  }
  const coverByRound = Array.from({ length: upToRound }, (_, i) => coveredCells(heliHistory[i] ?? []));
  let particles: Cell[][] = Array.from({ length: particleCount }, () => []);
  for (let r = 1; r <= upToRound; r++) {
    for (const p of particles) p.push(sampleStep(p, coverByRound[r - 1], rng));
    // A route that dead-ended would already have ended the game — drop it too.
    const obs = byRound.get(r) ?? [];
    const alive = particles.filter((p) => p[r - 1] >= 0 && obs.every((s) => matchesSearch(p, s)));
    if (alive.length === 0) return null;
    particles = Array.from({ length: particleCount }, (_, n) => (n < alive.length ? alive[n] : alive[Math.floor(rng() * alive.length)]).slice());
  }
  const belief = new Float64Array(CELL_COUNT);
  for (const p of particles) belief[p[upToRound - 1]] += 1 / particles.length;
  return belief;
}

function flatBelief(excluded: Iterable<Cell>): Float64Array {
  const b = new Float64Array(CELL_COUNT).fill(1);
  for (const c of excluded) b[c] = 0;
  const sum = b.reduce((a, v) => a + v, 0) || 1;
  return b.map((v) => v / sum);
}

/** Next-round car distribution if the helicopters end this turn on `helis`. */
function predictNext(belief: Float64Array, helis: readonly Point[]): Float64Array {
  const covered = coveredCells(helis);
  const out = new Float64Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) {
    if (belief[c] === 0) continue;
    const { cells, weights } = stepWeights(c, covered);
    const total = weights.reduce((a, w) => a + w, 0);
    cells.forEach((n, i) => {
      out[n] += (belief[c] * weights[i]) / total;
    });
  }
  return out;
}

/**
 * Catch chance next round for a helicopter layout: each helicopter lifts its
 * most likely building (never two helicopters on the same one).
 */
function layoutPressure(next: Float64Array, helis: readonly Point[]): number {
  const taken = new Set<Cell>();
  let total = 0;
  const order = helis
    .map((p) => ({ p, best: Math.max(...POINT_CELLS[p].map((c) => next[c])) }))
    .sort((a, b) => b.best - a.best);
  for (const { p } of order) {
    let best = -1;
    let bestCell = -1;
    for (const c of POINT_CELLS[p]) {
      if (!taken.has(c) && next[c] > best) {
        best = next[c];
        bestCell = c;
      }
    }
    if (bestCell >= 0) {
      taken.add(bestCell);
      total += best;
    }
  }
  return total;
}

/** Soft pull toward the probability mass so far-away helicopters still close in. */
function proximity(next: Float64Array, p: Point): number {
  let v = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (next[c] > 0) v += next[c] / (1 + heliStepsToCell(p, c));
  return v;
}

function particlesForLevel(level: BotLevel): number {
  if (level >= 8) return 2500;
  if (level >= 4) return 1000;
  return 250;
}

/** The police team's shared deduction right now (current round, including this turn's searches). */
export function currentPoliceBelief(state: CityChaseState, particleCount = 2000, rng: () => number = Math.random): Float64Array {
  const excluded = state.searches.filter((s) => s.round === state.round).map((s) => s.cell);
  return policeBelief(state.searches, state.heliHistory, state.round, particleCount, rng) ?? flatBelief(excluded);
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

function chooseHeliAction(state: CityChaseState, seat: SeatIndex, level: BotLevel, rng: () => number): EngineAction {
  const heli = state.heliTurn;
  const at = state.helis[heli];
  const belief =
    level >= 3
      ? currentPoliceBelief(state, particlesForLevel(level), rng)
      : flatBelief(state.searches.filter((s) => s.round === state.round).map((s) => s.cell));
  const lastRound = state.round >= TOTAL_ROUNDS;
  const futureWeight = lastRound ? 0 : 0.9;

  const valueOfLayout = (helis: Point[]) => {
    if (lastRound) return 0;
    const next = predictNext(belief, helis);
    return layoutPressure(next, helis) + 0.08 * proximity(next, helis[heli]);
  };

  const candidates: ScoredCandidate<EngineAction>[] = [];
  const stay = valueOfLayout(state.helis);
  for (const cell of pointCells(at)) {
    candidates.push({ move: { type: "HELI_SEARCH", seat, heli, cell }, score: 100 * (belief[cell] + futureWeight * stay) });
  }
  for (const to of pointNeighbors(at)) {
    const helis = state.helis.slice();
    helis[heli] = to;
    candidates.push({ move: { type: "HELI_MOVE", seat, heli, to }, score: 100 * futureWeight * valueOfLayout(helis) });
  }
  return pickByLevel(candidates, level, rng);
}

/** How many helicopters can lift `cell` during the police turn that follows. */
function immediateDanger(state: CityChaseState, cell: Cell): number {
  let d = 0;
  for (const p of state.helis) if (POINT_CELLS[p].includes(cell)) d += 1;
  return d;
}

/**
 * Can a no-revisit route starting on `path`'s last building still last
 * `steps` more moves? Plain DFS — at most 10 steps with ≤3 branches each.
 */
function canKeepMoving(path: Cell[], steps: number): boolean {
  if (steps <= 0) return true;
  const at = path[path.length - 1];
  for (const n of CELL_NEIGHBORS[at]) {
    if (path.includes(n)) continue;
    path.push(n);
    const ok = canKeepMoving(path, steps - 1);
    path.pop();
    if (ok) return true;
  }
  return false;
}

/** Unvisited buildings still reachable from `route`'s end without re-entering the route. */
function openRegion(route: readonly Cell[]): number {
  const seen = new Set<Cell>(route);
  const stack = [route[route.length - 1]];
  let size = 0;
  while (stack.length) {
    const c = stack.pop()!;
    for (const n of CELL_NEIGHBORS[c]) {
      if (seen.has(n)) continue;
      seen.add(n);
      size += 1;
      stack.push(n);
    }
  }
  return size;
}

function chooseThiefMove(state: CityChaseState, seat: SeatIndex, level: BotLevel, rng: () => number): EngineAction | null {
  const options = legalThiefCells(state);
  if (options.length === 0) return null;
  // What the police will believe right after this move (their prediction one step on).
  let predicted: Float64Array | null = null;
  if (level >= 5 && state.round > 1) {
    const prev = policeBelief(state.searches, state.heliHistory, state.round - 1, particlesForLevel(level), rng);
    if (prev) predicted = predictNext(prev, state.helis);
  }
  const stepsLeft = TOTAL_ROUNDS - state.round;
  const candidates: ScoredCandidate<EngineAction>[] = options.map((cell) => {
    let score = -40 * immediateDanger(state, cell);
    if (state.helis.length > 0) {
      let nearest = Infinity;
      for (const p of state.helis) nearest = Math.min(nearest, heliStepsToCell(p, cell));
      score += Math.min(nearest, 4) * 3;
    }
    if (predicted) score -= 80 * predicted[cell];
    const route = [...state.path, cell];
    // Keep escape routes open: unvisited, unwatched buildings next door, and room to roam.
    const exits = cellNeighbors(cell).filter((n) => !route.includes(n));
    score += 3 * exits.filter((n) => immediateDanger(state, n) === 0).length + 1.5 * exits.length;
    score += 1 * Math.min(openRegion(route), stepsLeft + 4);
    // Never drive into a dead end that can't last until round 11.
    if (!canKeepMoving(route, stepsLeft)) score -= 1000;
    return { move: { type: "THIEF_MOVE", seat, cell }, score };
  });
  return pickByLevel(candidates, level, rng);
}

function chooseHeliPlacement(state: CityChaseState, seat: SeatIndex, level: BotLevel, rng: () => number): EngineAction {
  const heli = state.heliTurn;
  // Round 1 gives the police no clue at all: spread out to squeeze the most
  // buildings for round 2, same pressure score the flying bot uses.
  const belief = flatBelief([]);
  const candidates: ScoredCandidate<EngineAction>[] = legalPlacements(state).map((at) => {
    const helis = [...state.helis, at];
    const next = predictNext(belief, helis);
    const overlap = POINT_CELLS[at].filter((c) => state.helis.some((p) => POINT_CELLS[p].includes(c))).length;
    return {
      move: { type: "HELI_PLACE", seat, heli, at },
      score: 100 * layoutPressure(next, helis) + 4 * POINT_CELLS[at].length - 6 * overlap + rng() * 0.5,
    };
  });
  return pickByLevel(candidates, level, rng);
}

export function chooseBotAction(
  state: CityChaseState,
  seat: SeatIndex,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  if (currentActor(state) !== seat) return null;
  if (state.phase === "thief") return chooseThiefMove(state, seat, level, rng);
  if (state.phase === "deploy") return chooseHeliPlacement(state, seat, level, rng);
  if (state.phase === "police") return chooseHeliAction(state, seat, level, rng);
  return null;
}
