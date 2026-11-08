/**
 * 🏝️ 섬 개척자 (Island Pioneers) — an original 2~5 player tile-laying game.
 * Full rules + design notes: boardGameRule/섬개척자/섬개척자.md (§ numbers below).
 *
 * §3 Turn: pick one of the 3 face-up 🛶 harbour tiles, place it next to the
 *    island with every touching edge matching, optionally stand one of your 5
 *    🚩 pioneers on a piece of land/sea of that tile nobody has claimed yet.
 * §4.3 Laying a tile with a resource icon gives the placer that resource.
 * §4 A region (connected triangles of one terrain) is complete when no edge of
 *    it is left open. Complete regions score for the pioneer majority (ties all
 *    score): 🌲/🌾 2 per tile, ⛰️ 3 per tile, 🏝️ lagoon (sea enclosed by land)
 *    3 per tile; every owner also collects the region's resource icons. The
 *    pioneers come home.
 * §5 Three public 📜 quests per game: first achiever +5, later ones +2.
 * §6 Tiles with nowhere to go are washed away (🌊) and replaced. When the
 *    harbour is empty the game ends: unfinished claimed regions 1 per tile
 *    (their resources are lost), every resource 1, every full set of 4 kinds +3.
 *
 * Lockstep like every other online room (docs/cloud-sync.md): all clients
 * replay the same actions from the same seed; actions carry `turn` so a
 * duplicate / stale one (two clients' timers) is ignored.
 */
import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { DECK_IDS, distinctRotations, MOUNTAIN, quadTerrain, resourceDir, SEA, START_TILE, type Terrain } from "./tiles";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const BOARD = 11;
export const CENTER = (BOARD * BOARD - 1) / 2; // cell 60 = (5,5)
export const MARKET_SIZE = 3;
export const SETTLERS = 5;
export const TURN_MS = 60_000;
/** Deck size by player count — about 13~20 turns each. */
export const DECK_SIZE: Record<number, number> = { 2: 40, 3: 48, 4: 56, 5: 60 };
/** Points per tile of a completed region by terrain (sea = lagoon). */
export const COMPLETE_POINTS: Record<Terrain, number> = { 0: 2, 1: 2, 2: 3, 3: 3 };
export const INCOMPLETE_POINTS = 1;
export const SET_BONUS = 3;
export const QUEST_FIRST = 5;
export const QUEST_LATER = 2;
export const QUESTS_PER_GAME = 3;

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const cellX = (cell: number) => cell % BOARD;
export const cellY = (cell: number) => Math.floor(cell / BOARD);
export const cellAt = (x: number, y: number) => y * BOARD + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < BOARD && y < BOARD;

/** Neighbour cell on side `dir`, or -1 off the map. */
export function neighbor(cell: number, dir: number): number {
  const x = cellX(cell) + DX[dir];
  const y = cellY(cell) + DY[dir];
  return inBounds(x, y) ? cellAt(x, y) : -1;
}

// ---------------------------------------------------------------------------
// Quests (§5)
// ---------------------------------------------------------------------------

export interface QuestDef {
  id: string;
  emoji: string;
  name: string;
  desc: string;
}

export const QUESTS: readonly QuestDef[] = [
  { id: "forest6", emoji: "🌲", name: "대삼림", desc: "숲 지역을 6타일 이상으로 완성해 점수 받기" },
  { id: "meadow6", emoji: "🌾", name: "끝없는 초원", desc: "초원 지역을 6타일 이상으로 완성해 점수 받기" },
  { id: "peak4", emoji: "⛰️", name: "산맥 개척", desc: "산 지역을 4타일 이상으로 완성해 점수 받기" },
  { id: "lagoon", emoji: "🏝️", name: "비밀 석호", desc: "육지로 둘러싸인 석호를 완성해 점수 받기" },
  { id: "jackpot", emoji: "💰", name: "한몫 잡기", desc: "한 번의 완성으로 12점 이상 받기" },
  { id: "builder3", emoji: "🔨", name: "부지런한 개척", desc: "지역 완성 점수를 3번 받기" },
  { id: "collector", emoji: "🎒", name: "수집가", desc: "🪵🐑💎🐟 자원 4종을 모두 1개 이상 모으기" },
  { id: "hoard7", emoji: "📦", name: "창고 가득", desc: "자원을 7개 이상 모으기" },
];

export const questDef = (id: string) => QUESTS.find((q) => q.id === id)!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Placed {
  tile: number;
  rot: number;
  /** Seat that laid it (-1 = the start camp). */
  by: SeatIndex;
}

export interface Settler {
  seat: SeatIndex;
  cell: number;
  quad: number;
}

export interface RegionScore {
  terrain: Terrain;
  lagoon: boolean;
  tiles: number;
  points: number;
  resources: number[];
  owners: SeatIndex[];
  /** Every seat that had a pioneer there (owners ⊆ claimants). */
  claimants: SeatIndex[];
  /** Cells of the region (for the board's flash). */
  cells: number[];
  /** Pioneers that came home. */
  returned: Settler[];
}

export interface QuestAward {
  seat: SeatIndex;
  quest: string;
  points: number;
  first: boolean;
}

export interface LastEvent {
  seq: number;
  seat: SeatIndex;
  cell: number;
  tile: number;
  rot: number;
  settler: number | null;
  timeout: boolean;
  /** Resource kind the placer picked up from the tile's icon, or -1. */
  picked: number;
  scored: RegionScore[];
  quests: QuestAward[];
  /** Harbour tiles washed away at the end of this turn (no legal spot). */
  washed: number[];
}

export interface FinalRow {
  seat: SeatIndex;
  incomplete: number;
  resources: number;
  sets: number;
  setBonus: number;
  total: number;
}

export type Phase = "playing" | "gameOver";

export interface IslandState {
  playerCount: number;
  seed: number;
  phase: Phase;
  /** BOARD×BOARD cells, row-major. */
  board: (Placed | null)[];
  bag: number[];
  market: number[];
  washed: number[];
  settlers: Settler[];
  scores: number[];
  /** resources[seat][kind] — 🪵🐑💎🐟 */
  resources: number[][];
  quests: string[];
  /** questDone[i] = seats that achieved quests[i], in order. */
  questDone: SeatIndex[][];
  completed: number[];
  active: SeatIndex;
  turn: number;
  seq: number;
  lastEvent: LastEvent | null;
  final: FinalRow[] | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "place"; seat: SeatIndex; turn: number; pick: number; cell: number; rot: number; settler: number | null }
  | { type: "timeout"; seat: SeatIndex; turn: number };

export function isStateSyncStale(current: IslandState | null, synced: IslandState): boolean {
  if (!current) return false;
  if (synced.seed !== current.seed) return false;
  return synced.seq < current.seq;
}

// ---------------------------------------------------------------------------
// Regions (§4)
// ---------------------------------------------------------------------------

export interface Region {
  id: number;
  terrain: Terrain;
  /** node = cell*4 + side */
  nodes: number[];
  cells: number[];
  /** Open edges: sides facing an empty cell (or the open ocean for sea). */
  open: number;
  openCells: number[];
  /** Sea touching the map edge — can never become a lagoon. */
  ocean: boolean;
  resources: number;
  settlers: Settler[];
}

export interface Analysis {
  regionOf: Int32Array;
  regions: Region[];
}

export function terrainAt(board: readonly (Placed | null)[], cell: number, side: number): Terrain {
  const p = board[cell]!;
  return quadTerrain(p.tile, p.rot, side);
}

export function analyze(board: readonly (Placed | null)[], settlers: readonly Settler[]): Analysis {
  const N = BOARD * BOARD * 4;
  const parent = new Int32Array(N).fill(-1);
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) {
      const nx = parent[a];
      parent[a] = r;
      a = nx;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let c = 0; c < board.length; c++) {
    if (!board[c]) continue;
    for (let q = 0; q < 4; q++) parent[c * 4 + q] = c * 4 + q;
  }
  for (let c = 0; c < board.length; c++) {
    const p = board[c];
    if (!p) continue;
    for (let q = 0; q < 4; q++) {
      if (quadTerrain(p.tile, p.rot, q) === quadTerrain(p.tile, p.rot, (q + 1) % 4)) union(c * 4 + q, c * 4 + ((q + 1) % 4));
      const n = neighbor(c, q);
      if (n >= 0 && board[n]) union(c * 4 + q, n * 4 + ((q + 2) % 4));
    }
  }
  const regionOf = new Int32Array(N).fill(-1);
  const regions: Region[] = [];
  const byRoot = new Map<number, Region>();
  for (let c = 0; c < board.length; c++) {
    const p = board[c];
    if (!p) continue;
    const rd = resourceDir(p.tile, p.rot);
    for (let q = 0; q < 4; q++) {
      const node = c * 4 + q;
      const root = find(node);
      let r = byRoot.get(root);
      if (!r) {
        r = { id: regions.length, terrain: quadTerrain(p.tile, p.rot, q), nodes: [], cells: [], open: 0, openCells: [], ocean: false, resources: 0, settlers: [] };
        byRoot.set(root, r);
        regions.push(r);
      }
      regionOf[node] = r.id;
      r.nodes.push(node);
      if (r.cells[r.cells.length - 1] !== c && !r.cells.includes(c)) r.cells.push(c);
      if (rd === q) r.resources++;
      const n = neighbor(c, q);
      if (n < 0) {
        if (r.terrain === SEA) {
          r.open++;
          r.ocean = true;
        }
      } else if (!board[n]) {
        r.open++;
        if (!r.openCells.includes(n)) r.openCells.push(n);
      }
    }
  }
  for (const s of settlers) {
    const id = regionOf[s.cell * 4 + s.quad];
    if (id >= 0) regions[id].settlers.push(s);
  }
  return { regionOf, regions };
}

/** Seats with the most pioneers in the region (empty when unclaimed). */
export function majority(settlers: readonly Settler[]): SeatIndex[] {
  if (settlers.length === 0) return [];
  const count = new Map<SeatIndex, number>();
  for (const s of settlers) count.set(s.seat, (count.get(s.seat) ?? 0) + 1);
  const best = Math.max(...count.values());
  return [...count.entries()].filter(([, n]) => n === best).map(([seat]) => seat).sort((a, b) => a - b);
}

export const isComplete = (r: Region) => r.open === 0;
export const isLagoon = (r: Region) => r.terrain === SEA && r.open === 0;
export const regionPoints = (r: Region) => r.cells.length * COMPLETE_POINTS[r.terrain];

// ---------------------------------------------------------------------------
// Placement (§3)
// ---------------------------------------------------------------------------

export function fits(board: readonly (Placed | null)[], cell: number, tile: number, rot: number): boolean {
  if (cell < 0 || cell >= board.length || board[cell]) return false;
  let touching = 0;
  for (let d = 0; d < 4; d++) {
    const n = neighbor(cell, d);
    if (n < 0 || !board[n]) continue;
    touching++;
    if (terrainAt(board, n, (d + 2) % 4) !== quadTerrain(tile, rot, d)) return false;
  }
  return touching > 0;
}

/** Empty cells next to the island. */
export function frontier(board: readonly (Placed | null)[]): number[] {
  const out: number[] = [];
  for (let c = 0; c < board.length; c++) {
    if (board[c]) continue;
    for (let d = 0; d < 4; d++) {
      const n = neighbor(c, d);
      if (n >= 0 && board[n]) {
        out.push(c);
        break;
      }
    }
  }
  return out;
}

export interface Placement {
  cell: number;
  rot: number;
}

export function legalPlacements(board: readonly (Placed | null)[], tile: number, cells: readonly number[] = frontier(board)): Placement[] {
  const rots = distinctRotations(tile);
  const out: Placement[] = [];
  for (const cell of cells) for (const rot of rots) if (fits(board, cell, tile, rot)) out.push({ cell, rot });
  return out;
}

export const canPlace = (board: readonly (Placed | null)[], tile: number, cells?: readonly number[]) => {
  const fr = cells ?? frontier(board);
  const rots = distinctRotations(tile);
  for (const cell of fr) for (const rot of rots) if (fits(board, cell, tile, rot)) return true;
  return false;
};

/** Pioneers left in this seat's supply. */
export const supplyOf = (state: IslandState, seat: SeatIndex) => SETTLERS - state.settlers.filter((s) => s.seat === seat).length;

/**
 * Sides of the placed tile where a pioneer may stand (one per region, the
 * first side of each free region), given the board after the tile is down.
 */
export function settlerOptions(board: readonly (Placed | null)[], settlers: readonly Settler[], cell: number, an: Analysis = analyze(board, settlers)): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let q = 0; q < 4; q++) {
    const id = an.regionOf[cell * 4 + q];
    if (id < 0 || seen.has(id)) continue;
    seen.add(id);
    if (an.regions[id].settlers.length === 0) out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): IslandState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const rng = seededRng(seed);
  const deck = shuffle([...DECK_IDS], rng).slice(0, DECK_SIZE[count]);
  const quests = shuffle(QUESTS.map((q) => q.id), rng).slice(0, QUESTS_PER_GAME);
  const board: (Placed | null)[] = Array.from({ length: BOARD * BOARD }, () => null);
  board[CENTER] = { tile: START_TILE, rot: Math.floor(rng() * 4), by: -1 };
  const base: IslandState = {
    playerCount: count,
    seed,
    phase: "playing",
    board,
    bag: deck,
    market: [],
    washed: [],
    settlers: [],
    scores: Array.from({ length: count }, () => 0),
    resources: Array.from({ length: count }, () => [0, 0, 0, 0]),
    quests,
    questDone: quests.map(() => []),
    completed: Array.from({ length: count }, () => 0),
    active: Math.floor(rng() * count),
    turn: 0,
    seq: 0,
    lastEvent: null,
    final: null,
    statTally: {},
  };
  const { state } = refillMarket(base);
  return state;
}

/**
 * §6 Tops the harbour up to 3 from the bag, washing away (🌊) any harbour tile
 * that has nowhere to go, until every harbour tile fits somewhere or the bag
 * is empty.
 */
function refillMarket(state: IslandState): { state: IslandState; washed: number[] } {
  let market = [...state.market];
  const bag = [...state.bag];
  const washedNow: number[] = [];
  const fr = frontier(state.board);
  for (;;) {
    while (market.length < MARKET_SIZE && bag.length > 0) market.push(bag.shift()!);
    const dead = market.filter((t) => !canPlace(state.board, t, fr));
    if (dead.length === 0) break;
    market = market.filter((t) => !dead.includes(t));
    washedNow.push(...dead);
    if (bag.length === 0) break;
  }
  return { state: { ...state, market, bag, washed: [...state.washed, ...washedNow] }, washed: washedNow };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function checkQuests(state: IslandState, seat: SeatIndex, scored: RegionScore[], awards: QuestAward[], questDone: SeatIndex[][], firstThisTurn: boolean[]): number {
  let gained = 0;
  state.quests.forEach((id, i) => {
    if (questDone[i].includes(seat)) return;
    const mine = scored.filter((r) => r.owners.includes(seat));
    const res = state.resources[seat];
    const total = res.reduce((a, b) => a + b, 0);
    let ok = false;
    switch (id) {
      case "forest6":
        ok = mine.some((r) => r.terrain === 0 && r.tiles >= 6);
        break;
      case "meadow6":
        ok = mine.some((r) => r.terrain === 1 && r.tiles >= 6);
        break;
      case "peak4":
        ok = mine.some((r) => r.terrain === MOUNTAIN && r.tiles >= 4);
        break;
      case "lagoon":
        ok = mine.some((r) => r.lagoon);
        break;
      case "jackpot":
        ok = mine.some((r) => r.points >= 12);
        break;
      case "builder3":
        ok = state.completed[seat] >= 3;
        break;
      case "collector":
        ok = res.every((n) => n > 0);
        break;
      case "hoard7":
        ok = total >= 7;
        break;
    }
    if (!ok) return;
    const first = questDone[i].length === 0 || firstThisTurn[i];
    if (questDone[i].length === 0) firstThisTurn[i] = true;
    questDone[i] = [...questDone[i], seat];
    const points = first ? QUEST_FIRST : QUEST_LATER;
    awards.push({ seat, quest: id, points, first });
    gained += points;
  });
  return gained;
}

function applyPlace(state: IslandState, seat: SeatIndex, pick: number, cell: number, rot: number, settler: number | null, timeout: boolean): IslandState {
  const tile = state.market[pick];
  if (tile === undefined || !fits(state.board, cell, tile, rot)) return state;
  const board = state.board.slice();
  board[cell] = { tile, rot: ((rot % 4) + 4) % 4, by: seat };
  const scores = [...state.scores];
  const resources = state.resources.map((r) => [...r]);
  const completed = [...state.completed];
  let settlers = state.settlers;
  let an = analyze(board, settlers);
  let placedSettler: number | null = null;
  if (settler !== null) {
    if (!Number.isInteger(settler) || settler < 0 || settler > 3) return state;
    if (supplyOf(state, seat) <= 0 || !settlerOptions(board, settlers, cell, an).some((q) => an.regionOf[cell * 4 + q] === an.regionOf[cell * 4 + settler])) return state;
    settlers = [...settlers, { seat, cell, quad: settler }];
    placedSettler = settler;
    an = analyze(board, settlers);
  }

  const scored: RegionScore[] = [];
  let statTally = tallyAdd(state.statTally, seat, "tilesPlaced");
  // §4.3 a resource icon on the laid tile goes straight to the placer
  const rdir = resourceDir(tile, board[cell]!.rot);
  const picked = rdir >= 0 ? quadTerrain(tile, board[cell]!.rot, rdir) : -1;
  if (picked >= 0) {
    resources[seat][picked]++;
    statTally = tallyAdd(statTally, seat, "resourcesPicked");
  }
  if (placedSettler !== null) statTally = tallyAdd(statTally, seat, "settlersPlaced");
  // §4 score every region of this tile that just closed
  const touched = new Set<number>();
  for (let q = 0; q < 4; q++) touched.add(an.regionOf[cell * 4 + q]);
  const returned = new Set<Settler>();
  for (const id of touched) {
    const r = an.regions[id];
    if (!isComplete(r) || r.settlers.length === 0) continue;
    const owners = majority(r.settlers);
    const points = regionPoints(r);
    const kind = r.terrain;
    for (const o of owners) {
      scores[o] += points;
      resources[o][kind] += r.resources;
      completed[o]++;
      statTally = tallyAdd(statTally, o, "regionsCompleted");
      statTally = tallyAdd(statTally, o, "regionPoints", points);
      statTally = tallyMax(statTally, o, "maxRegionPoints", points);
      statTally = tallyMax(statTally, o, "maxRegionTiles", r.cells.length);
      if (r.resources) statTally = tallyAdd(statTally, o, "resourcesGained", r.resources);
      if (isLagoon(r)) statTally = tallyAdd(statTally, o, "lagoons");
      if (owners.length > 1) statTally = tallyAdd(statTally, o, "sharedRegions");
      const rivals = new Set(r.settlers.map((s) => s.seat).filter((s) => s !== o));
      if (owners.length === 1 && rivals.size > 0) statTally = tallyAdd(statTally, o, "contestsWon");
    }
    for (const s of r.settlers) returned.add(s);
    scored.push({
      terrain: r.terrain,
      lagoon: isLagoon(r),
      tiles: r.cells.length,
      points,
      resources: Array.from({ length: 4 }, (_, k) => (k === kind ? r.resources : 0)),
      owners,
      claimants: [...new Set(r.settlers.map((s) => s.seat))].sort((a, b) => a - b),
      cells: r.cells,
      returned: r.settlers,
    });
  }
  if (returned.size) settlers = settlers.filter((s) => !returned.has(s));

  // §5 quests — the active seat first, then anyone else who scored this turn
  const awards: QuestAward[] = [];
  const questDone = state.questDone.map((d) => [...d]);
  const firstThisTurn = state.quests.map(() => false);
  const mid: IslandState = { ...state, resources, completed };
  const order = [seat, ...Array.from({ length: state.playerCount }, (_, i) => (seat + 1 + i) % state.playerCount).filter((s) => s !== seat)];
  for (const s of order) scores[s] += checkQuests(mid, s, scored, awards, questDone, firstThisTurn);
  for (const a of awards) {
    statTally = tallyAdd(statTally, a.seat, "questsDone");
    if (a.first) statTally = tallyAdd(statTally, a.seat, "questsFirst");
  }

  const seq = state.seq + 1;
  let next: IslandState = {
    ...state,
    board,
    market: state.market.filter((_, i) => i !== pick),
    settlers,
    scores,
    resources,
    completed,
    questDone,
    seq,
    statTally,
  };
  const refilled = refillMarket(next);
  next = refilled.state;
  next = {
    ...next,
    lastEvent: { seq, seat, cell, tile, rot: board[cell]!.rot, settler: placedSettler, timeout, picked, scored, quests: awards, washed: refilled.washed },
  };
  if (next.market.length === 0) return finishGame(next);
  return { ...next, active: (state.active + 1) % state.playerCount, turn: state.turn + 1 };
}

/** §6 final scoring: unfinished claimed regions, resources, sets. */
function finishGame(state: IslandState): IslandState {
  const an = analyze(state.board, state.settlers);
  const scores = [...state.scores];
  const resources = state.resources.map((r) => [...r]);
  const incomplete = Array.from({ length: state.playerCount }, () => 0);
  let statTally = state.statTally;
  for (const r of an.regions) {
    if (r.settlers.length === 0) continue;
    for (const o of majority(r.settlers)) {
      incomplete[o] += r.cells.length * INCOMPLETE_POINTS;
    }
  }
  const final: FinalRow[] = [];
  for (let seat = 0; seat < state.playerCount; seat++) {
    const res = resources[seat].reduce((a, b) => a + b, 0);
    const sets = Math.min(...resources[seat]);
    const setBonus = sets * SET_BONUS;
    scores[seat] += incomplete[seat] + res + setBonus;
    final.push({ seat, incomplete: incomplete[seat], resources: res, sets, setBonus, total: scores[seat] });
    statTally = tallyAdd(statTally, seat, "resourcesTotal", res);
    if (sets) statTally = tallyAdd(statTally, seat, "sets", sets);
    statTally = tallyMax(statTally, seat, "maxScore", scores[seat]);
  }
  return { ...state, scores, resources, final, phase: "gameOver", turn: state.turn + 1, statTally };
}

/**
 * The move a timed-out seat makes: the first harbour tile that fits, at the
 * spot touching the most tiles (then lowest cell / rotation), no pioneer.
 */
export function autoMove(state: IslandState): { pick: number; cell: number; rot: number } | null {
  const fr = frontier(state.board);
  for (let pick = 0; pick < state.market.length; pick++) {
    const moves = legalPlacements(state.board, state.market[pick], fr);
    if (moves.length === 0) continue;
    let best = moves[0];
    let bestN = -1;
    for (const m of moves) {
      let n = 0;
      for (let d = 0; d < 4; d++) {
        const nb = neighbor(m.cell, d);
        if (nb >= 0 && state.board[nb]) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = m;
      }
    }
    return { pick, cell: best.cell, rot: best.rot };
  }
  return null;
}

export function applyAction(state: IslandState, action: EngineAction): IslandState {
  if (state.phase !== "playing" || action.seat !== state.active || action.turn !== state.turn) return state;
  if (action.type === "timeout") {
    const m = autoMove(state);
    if (!m) return finishGame(state);
    return applyPlace(state, action.seat, m.pick, m.cell, m.rot, null, true);
  }
  return applyPlace(state, action.seat, action.pick, action.cell, action.rot, action.settler, false);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentActor(state: IslandState): SeatIndex | null {
  return state.phase === "playing" ? state.active : null;
}

/** Tiles still to come (harbour + bag). */
export const tilesLeft = (state: IslandState) => state.market.length + state.bag.length;

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  score: number;
}

/** Final standings: score, then more resources, then fewer… ties share a rank. */
export function computeRankings(state: IslandState): RankedSeat[] {
  const res = (s: number) => state.resources[s].reduce((a, b) => a + b, 0);
  const order = state.scores.map((score, seat) => ({ seat, score })).sort((a, b) => b.score - a.score || res(b.seat) - res(a.seat) || a.seat - b.seat);
  return order.map((o) => ({ ...o, rank: order.findIndex((x) => x.score === o.score && res(x.seat) === res(o.seat)) + 1 }));
}

/**
 * Preview of a placement for the board (what would score / which pioneer
 * spots open up), computed exactly like the engine does.
 */
export function previewPlacement(state: IslandState, seat: SeatIndex, pick: number, cell: number, rot: number, settler: number | null): IslandState | null {
  const next = applyAction(state, { type: "place", seat, turn: state.turn, pick, cell, rot, settler });
  return next === state ? null : next;
}
