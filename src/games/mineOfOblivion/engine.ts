/**
 * Pure "망각의 지뢰 (Mine of Oblivion)" rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/망각의 지뢰/망각의 지뢰.md`, rewritten wholesale for
 * this session's brief — an **11×11 minesweeper-style exploration race**,
 * replacing the previous 5×5 "forced-retreat forfeit" house rule entirely.
 * Several design points weren't derivable from the brief alone and were
 * confirmed via `AskUserQuestion` (Strict No-Assumption Rule) before writing
 * a line of engine code:
 *
 *  - **지뢰 배치 방식**: kept as each seat's own *secret* mine burial (not a
 *    system-random minefield) — the bluffing/memory element from the
 *    original game survives, it's just that the adjacent-8-tile mine count
 *    is now a *scoring* mechanic (and a public deduction clue once a tile is
 *    first visited) instead of a pure hazard-avoidance one.
 *  - **보물 배치**: fixed coordinates, scaled up from the old 5×5 layout's
 *    "두 대각선 코너가 시작칸, 남은 두 코너 + 정중앙이 보물" pattern — start
 *    tiles are the two ends of one diagonal (`A1`/`K11`), treasures are the
 *    other diagonal's two corners (`A11`/`K1`) plus dead center (`F6`).
 *  - **리스폰 우선순위**: nearest-first — search Chebyshev-distance rings
 *    outward from the seat's own start tile (0, 1, 2, 3, then keep
 *    expanding only if truly necessary), collect every tile in the nearest
 *    non-empty ring that is both mine-free and unoccupied, and pick among
 *    those uniformly. Because `applyAction` must stay a pure, no-I/O
 *    function of `(state, action)` for this project's lockstep online-sync
 *    architecture (every peer replays the exact same broadcast actions and
 *    must land on bit-identical state — see `<Game>.tsx`'s module doc), the
 *    "random" pick can't call `Math.random()` inside the reducer. It's a
 *    deterministic FNV-1a hash of the mine-hit tile + seat + the match's
 *    running `actionsPlayed` counter instead (`deterministicPick`) — looks
 *    and feels random across a match/replay, reproduces identically on
 *    every peer.
 *  - **참여 인원**: kept 2-player-exclusive, same `"p1" | "p2"` seat
 *    convention as every other 2-player-only online game here (lostCities,
 *    malDalliJa, the pre-rewrite version of this game).
 *
 * One more call made without a fresh confirmation round, flagged here
 * explicitly rather than silently: the previous build's "🔭 정찰(radar)"
 * item was itself never part of any rulebook — it was a platform extension
 * added on top of the old 5×5 house rule specifically because that rule had
 * zero built-in deduction mechanism. The new adjacent-8-tile mine-count
 * score *is* that deduction mechanism (numbers become public the instant a
 * tile is first visited by either seat), and the new brief's turn model
 * describes exactly one action per turn ("이동하기") with no second item
 * action — so radar is dropped rather than carried forward. Likewise, no
 * turn cap: the old 5×5 build's `TURN_CAP` was itself a confirmed house
 * rule bolted on for a win condition ("보드판 변수 소진") that no longer
 * exists — the new sole end condition (3rd treasure claimed) is reachable
 * in finite time on a fixed 121-tile board with two seats, so nothing here
 * reintroduces an unrequested cap.
 *
 * Mine count per seat: not specified in the brief, chosen as a tuned
 * parameter rather than a house-rule ambiguity worth a question round — see
 * `MINES_PER_PLAYER`'s own doc for the reasoning.
 *
 * Everything else follows the new brief verbatim: 11×11 grid (`A1`..`K11`),
 * 8-directional single-tile moves, no two seats ever standing on the same
 * tile, first arrival at an unvisited non-mined tile scores the count of
 * still-armed mines among its 8 neighbors (0 for a tile either seat has
 * already visited), a mine hit is a flat **−5** regardless of how many
 * mines were stacked on that tile (both/all of that tile's mines detonate
 * and are permanently removed together), and the three treasures pay out
 * 10 / 15 / 20 in claim order with the match ending the instant the 3rd is
 * claimed — highest total score wins (there is no forfeiting a claimed
 * treasure back; once scored, a seat keeps those points for the rest of
 * the match, unlike the old build's "hand it back on your next mine hit").
 */

import { seededRng } from "@/lib/rng";
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

// ---------------------------------------------------------------------------
// Board geometry (11×11, "A1".."K11")
// ---------------------------------------------------------------------------

export type TileId = string;

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
/** Exported purely for UI grid layout — not used by any rule logic below, which only ever deals in `TileId` strings. */
export const BOARD_COLS: readonly string[] = COLS;
export const BOARD_ROWS: readonly number[] = ROWS;
export const GRID_SIZE = 11;

export const ALL_TILES: readonly TileId[] = COLS.flatMap((c) => ROWS.map((r) => `${c}${r}`));

/** Two ends of one board diagonal — confirmed layout (see module doc). */
export const START_TILE: Record<Seat, TileId> = { p1: "A1", p2: "K11" };
/** The other diagonal's two corners + dead center — confirmed layout. */
export const TREASURE_TILES: readonly TileId[] = ["A11", "K1", "F6"];

/**
 * Mines each seat secretly buries. Not specified by the brief, so tuned
 * rather than assumed-and-shipped silently: the old 5×5 build used 4 mines
 * per seat on 25 tiles (~16% of the board, per seat, ignoring overlap).
 * Carrying that same *absolute* count forward unchanged (8 = 2×4, doubled
 * because the new board has 2 legal 11-tile edges instead of 1 and a much
 * larger safe-exploration middle) would still only cover ~7% of 121 tiles
 * per seat — deliberately less dense than the old game, because unlike the
 * old build (where a hit was a full turn write-off but no lasting harm),
 * every tile here is worth real points, and a board so dense that safe
 * exploration became rare would gut the scoring layer this whole rewrite
 * adds. 8/seat keeps genuine memory/bluffing tension without turning most
 * of the map into a minefield.
 */
export const MINES_PER_PLAYER = 8;

function colIndex(tile: TileId): number {
  return COLS.indexOf(tile[0] as (typeof COLS)[number]);
}
function rowIndex(tile: TileId): number {
  return ROWS.indexOf(Number(tile.slice(1)) as (typeof ROWS)[number]);
}

/** Chebyshev (king-move) distance — the natural metric once movement is 8-directional. */
export function chebyshevDistance(a: TileId, b: TileId): number {
  return Math.max(Math.abs(colIndex(a) - colIndex(b)), Math.abs(rowIndex(a) - rowIndex(b)));
}

/** True iff `b` is one of `a`'s 8 surrounding tiles (orthogonal or diagonal), never `a` itself. */
export function isEightDirectionAdjacent(a: TileId, b: TileId): boolean {
  if (a === b) return false;
  return chebyshevDistance(a, b) === 1;
}

/** Up to 8 surrounding tiles, clipped at the board edge (corner = 3, edge = 5, interior = 8). */
export function eightDirectionNeighbors(tile: TileId): TileId[] {
  const c = colIndex(tile);
  const r = rowIndex(tile);
  const out: TileId[] = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < COLS.length && nr >= 0 && nr < ROWS.length) out.push(`${COLS[nc]}${ROWS[nr]}`);
    }
  }
  return out;
}

/** Every tile at exactly Chebyshev distance `radius` from `center` (a hollow square ring; `radius` 0 is just `center` itself), sorted for deterministic iteration. */
function chebyshevRing(center: TileId, radius: number): TileId[] {
  const c = colIndex(center);
  const r = rowIndex(center);
  const out: TileId[] = [];
  for (let dc = -radius; dc <= radius; dc++) {
    for (let dr = -radius; dr <= radius; dr++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < COLS.length && nr >= 0 && nr < ROWS.length) out.push(`${COLS[nc]}${ROWS[nr]}`);
    }
  }
  return out.sort();
}

/** Deterministic FNV-1a-hash pick — see module doc's "리스폰 우선순위" note on why this can't be `Math.random()`. */
function deterministicPick<T extends string>(items: readonly T[], seed: string): T {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const idx = Math.abs(h) % items.length;
  return items[idx];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Treasure {
  tileId: TileId;
  holder: Seat | null;
  /** Claim order (1st/2nd/3rd) — determines the payout below. `null` while unclaimed. */
  order: 1 | 2 | 3 | null;
  /** 10 / 15 / 20 respectively — frozen at claim time. `null` while unclaimed. */
  points: number | null;
}

export interface PlayerState {
  position: TileId;
  /** Total score — can go negative (repeated mine hits with little exploration). */
  score: number;
  /** How many of the 3 treasures this seat personally claimed (0..3) — a stat, not itself the win condition (total score is). */
  treasuresClaimed: number;
  mineHitsTaken: number;
}

export type EventKind = "reveal" | "treasure" | "mine";

export interface LastEvent {
  kind: EventKind;
  actor: Seat;
  tile: TileId;
  /** `"reveal"` only — the adjacent-mine-count score just awarded (0 if `alreadyVisited`). */
  scoreGained?: number;
  /** `"reveal"` only — true if this tile had already been visited by either seat before (score is always 0 in that case). */
  alreadyVisited?: boolean;
  /** `"mine"` only — whose mine(s) detonated (usually one seat; both if the two seats happened to mine the same tile). */
  mineOwners?: Seat[];
  /** `"mine"` only — where the mover was forced to respawn. */
  respawnTile?: TileId;
  /** `"treasure"` only. */
  treasureOrder?: 1 | 2 | 3;
  treasurePoints?: number;
}

export type Phase = "SETUP_MINE" | "PLAYER_MOVE" | "REVEAL_STEP" | "GAME_OVER";

export interface MineOfOblivionState {
  phase: Phase;
  /** Secret mine layouts — full state carries both seats' (UI-level-only secrecy, same convention as every hidden-hand game in this catalog: `MineOfOblivionBoard.tsx` never renders the opponent's un-triggered mines). */
  mines: Record<Seat, TileId[]>;
  /** Per-seat tiles whose mine has already detonated and is gone — checked against `mines[seat]` to know which are still armed. */
  disarmed: Record<Seat, TileId[]>;
  mineReady: Record<Seat, boolean>;
  /** Every tile either seat has ever landed on (as a real move, not a forced mine respawn) — global, first-come-first-served for the reveal score. */
  visitedTiles: TileId[];
  /** Adjacent-mine-count score frozen at the moment each tile in `visitedTiles` was *first* visited — the public deduction clue every subsequent viewer (both seats) can see, keyed by tile. Treasure tiles are tracked in `visitedTiles` but never get an entry here (claiming pays the sequential treasure bonus instead, not a mine-count score). */
  revealedCounts: Partial<Record<TileId, number>>;
  treasures: Treasure[];
  /** 0 → 3; the moment this hits 3 the match is over. */
  treasureClaimCount: number;
  players: Record<Seat, PlayerState>;
  activeSeat: Seat;
  /** Total moves taken across both seats since PLAYER_MOVE started. */
  actionsPlayed: number;
  lastEvent: LastEvent | null;
  /** Computed the instant the deciding event happens, but not "official" until the REVEAL_STEP's `READY_NEXT_ROUND` acknowledgement flips `phase` to `GAME_OVER` — same "reveal, then confirm" two-step every other dramatic-reveal game in this catalog uses. */
  pendingGameOver: boolean;
  winner: Seat | null;
  isDraw: boolean;
}

/**
 * Which seat(s) currently have an armed (not-yet-triggered) mine at `tile`.
 * Exported for UI use, but ONLY safe to call for a tile the viewer is
 * actually entitled to know about right now (their own mines via
 * `ownArmedMines`, or any tile in `revealedCounts`/`publiclyDisarmedTiles`,
 * which are public once revealed) — calling it for an arbitrary
 * still-secret tile and rendering the result would leak the opponent's
 * hidden mine layout.
 */
export function armedMineOwnersAt(state: Pick<MineOfOblivionState, "mines" | "disarmed">, tile: TileId): Seat[] {
  return (["p1", "p2"] as const).filter((seat) => state.mines[seat].includes(tile) && !state.disarmed[seat].includes(tile));
}

/** Sum of still-armed mines (either seat, counted individually) across `tile`'s up-to-8 neighbors — the score a first visit to `tile` awards. */
function computeAdjacentMineScore(state: Pick<MineOfOblivionState, "mines" | "disarmed">, tile: TileId): number {
  return eightDirectionNeighbors(tile).reduce((sum, n) => sum + armedMineOwnersAt(state, n).length, 0);
}

/**
 * True iff `tile` is a legal spot for `seat` to bury a mine — not a treasure
 * tile, and not a tile either seat currently occupies.
 *
 * **2026-09-01 reversal, confirmed via `AskUserQuestion`**: the original
 * 2026-08-31 rewrite deliberately *allowed* mining the opponent's start tile
 * (only `seat`'s own start tile was forbidden). A follow-up request asked to
 * block mining any tile "the opponent is currently standing on," which the
 * user confirmed should flip that decision — mining the opponent's start
 * tile is now forbidden too. `SETUP_MINE` is the one phase where mines are
 * ever placed, and it always runs before any `SELECT_TILE_STEP` has moved
 * either seat off `START_TILE` — so "every tile a seat currently occupies"
 * is exactly `{START_TILE.p1, START_TILE.p2}` for the entire lifetime of
 * this check, with no need to thread live `players[seat].position` state
 * through a currently-pure `(seat, tile) -> boolean` signature.
 */
export function canPlaceMine(seat: Seat, tile: TileId): boolean {
  if (!ALL_TILES.includes(tile)) return false;
  if (TREASURE_TILES.includes(tile)) return false;
  if (tile === START_TILE.p1 || tile === START_TILE.p2) return false;
  void seat; // kept in the signature: every call site passes it, and a future per-seat exception (were one ever confirmed) would need it again.
  return true;
}

export function startGame(rng: () => number = Math.random): MineOfOblivionState {
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    phase: "SETUP_MINE",
    mines: { p1: [], p2: [] },
    disarmed: { p1: [], p2: [] },
    mineReady: { p1: false, p2: false },
    visitedTiles: [],
    revealedCounts: {},
    treasures: TREASURE_TILES.map((tileId) => ({ tileId, holder: null, order: null, points: null })),
    treasureClaimCount: 0,
    players: {
      p1: { position: START_TILE.p1, score: 0, treasuresClaimed: 0, mineHitsTaken: 0 },
      p2: { position: START_TILE.p2, score: 0, treasuresClaimed: 0, mineHitsTaken: 0 },
    },
    activeSeat: firstSeat,
    actionsPlayed: 0,
    lastEvent: null,
    pendingGameOver: false,
    winner: null,
    isDraw: false,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EngineAction =
  | { type: "SET_MINE_POSITION"; seat: Seat; tiles: TileId[] }
  | { type: "SELECT_TILE_STEP"; seat: Seat; tile: TileId }
  /** Acknowledges the current REVEAL_STEP overlay and advances the game. Carries no seat: any client may fire it (shared skip button), and it's a no-op once `phase` has already moved past REVEAL_STEP. */
  | { type: "READY_NEXT_ROUND" };

/** True iff `tile` is safe to force-respawn a mover onto right now: no armed mine (either seat) and not the other seat's current position. */
function tileSafeForRespawn(state: MineOfOblivionState, tile: TileId, mover: Seat): boolean {
  if (armedMineOwnersAt(state, tile).length > 0) return false;
  const other = otherSeat(mover);
  return state.players[other].position !== tile;
}

/** Nearest-first (Chebyshev rings expanding from `mover`'s own start tile), random-among-ties respawn pick — see module doc. `seedTile`/`state.actionsPlayed` make the "random" pick deterministic and reproducible for lockstep replay. */
function chooseRespawnTile(state: MineOfOblivionState, mover: Seat, seedTile: TileId): TileId {
  const start = START_TILE[mover];
  const maxRadius = COLS.length + ROWS.length; // generous upper bound, never actually reached in practice
  for (let radius = 0; radius <= maxRadius; radius++) {
    const ring = chebyshevRing(start, radius).filter((t) => tileSafeForRespawn(state, t, mover));
    if (ring.length > 0) {
      return deterministicPick(ring, `${mover}:${seedTile}:${state.actionsPlayed}:${radius}`);
    }
  }
  return start; // unreachable in practice (board has 121 tiles, at most 16 mines total)
}

function resolveWinner(state: MineOfOblivionState): { winner: Seat | null; isDraw: boolean } {
  const p1 = state.players.p1.score;
  const p2 = state.players.p2.score;
  if (p1 === p2) return { winner: null, isDraw: true };
  return { winner: p1 > p2 ? "p1" : "p2", isDraw: false };
}

function applySetMines(state: MineOfOblivionState, seat: Seat, tiles: TileId[]): MineOfOblivionState {
  if (state.phase !== "SETUP_MINE" || state.mineReady[seat]) return state;
  if (tiles.length !== MINES_PER_PLAYER) return state;
  if (new Set(tiles).size !== tiles.length) return state;
  if (!tiles.every((t) => canPlaceMine(seat, t))) return state;

  const mines = { ...state.mines, [seat]: tiles };
  const mineReady = { ...state.mineReady, [seat]: true };
  const bothReady = mineReady.p1 && mineReady.p2;
  return { ...state, mines, mineReady, phase: bothReady ? "PLAYER_MOVE" : "SETUP_MINE" };
}

/** Win condition (3rd treasure claimed) + the shared REVEAL_STEP gate — the sole entry/exit point every move funnels through. */
function finalizeAction(state: MineOfOblivionState, mover: Seat): MineOfOblivionState {
  void mover;
  if (state.treasureClaimCount >= 3) {
    const { winner, isDraw } = resolveWinner(state);
    return { ...state, phase: "REVEAL_STEP", pendingGameOver: true, winner, isDraw };
  }
  return { ...state, phase: "REVEAL_STEP", pendingGameOver: false };
}

/** Shared arrival resolution for a legal step onto `tile` — mine/treasure/reveal judgment and the REVEAL_STEP gate every move goes through. */
function resolveArrival(state: MineOfOblivionState, mover: Seat, tile: TileId): MineOfOblivionState {
  const triggeredOwners = armedMineOwnersAt(state, tile);
  let next: MineOfOblivionState = {
    ...state,
    players: { ...state.players, [mover]: { ...state.players[mover], position: tile } },
    actionsPlayed: state.actionsPlayed + 1,
  };

  if (triggeredOwners.length > 0) {
    const disarmed = { ...next.disarmed };
    for (const owner of triggeredOwners) disarmed[owner] = [...disarmed[owner], tile];
    next = { ...next, disarmed };

    const respawnTile = chooseRespawnTile(next, mover, tile);
    const mover_ = next.players[mover];
    next = {
      ...next,
      players: {
        ...next.players,
        [mover]: { ...mover_, position: respawnTile, score: mover_.score - 5, mineHitsTaken: mover_.mineHitsTaken + 1 },
      },
      lastEvent: { kind: "mine", actor: mover, tile, mineOwners: triggeredOwners, respawnTile },
    };
  } else {
    const treasureIdx = next.treasures.findIndex((t) => t.tileId === tile && t.holder === null);
    if (treasureIdx !== -1) {
      const order = (next.treasureClaimCount + 1) as 1 | 2 | 3;
      const points = order === 1 ? 10 : order === 2 ? 15 : 20;
      const treasures = next.treasures.map((t, i) => (i === treasureIdx ? { ...t, holder: mover, order, points } : t));
      const mover_ = next.players[mover];
      next = {
        ...next,
        treasures,
        treasureClaimCount: next.treasureClaimCount + 1,
        visitedTiles: next.visitedTiles.includes(tile) ? next.visitedTiles : [...next.visitedTiles, tile],
        players: { ...next.players, [mover]: { ...mover_, score: mover_.score + points, treasuresClaimed: mover_.treasuresClaimed + 1 } },
        lastEvent: { kind: "treasure", actor: mover, tile, treasureOrder: order, treasurePoints: points },
      };
    } else {
      const alreadyVisited = next.visitedTiles.includes(tile);
      const scoreGained = alreadyVisited ? 0 : computeAdjacentMineScore(next, tile);
      const mover_ = next.players[mover];
      next = {
        ...next,
        visitedTiles: alreadyVisited ? next.visitedTiles : [...next.visitedTiles, tile],
        revealedCounts: alreadyVisited ? next.revealedCounts : { ...next.revealedCounts, [tile]: scoreGained },
        players: { ...next.players, [mover]: { ...mover_, score: mover_.score + scoreGained } },
        lastEvent: { kind: "reveal", actor: mover, tile, scoreGained, alreadyVisited },
      };
    }
  }

  return finalizeAction(next, mover);
}

function applyStep(state: MineOfOblivionState, seat: Seat, tile: TileId): MineOfOblivionState {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return state;
  if (!isEightDirectionAdjacent(state.players[seat].position, tile)) return state;
  if (state.players[otherSeat(seat)].position === tile) return state; // 동일 칸 진입 금지
  return resolveArrival(state, seat, tile);
}

function applyReadyNextRound(state: MineOfOblivionState): MineOfOblivionState {
  if (state.phase !== "REVEAL_STEP") return state;
  if (state.pendingGameOver) {
    return { ...state, phase: "GAME_OVER" };
  }
  return { ...state, phase: "PLAYER_MOVE", activeSeat: otherSeat(state.activeSeat) };
}

/** Single entry point applying any `EngineAction` to a state — illegal actions are no-ops (return `state` unchanged), same defensive idiom every other engine in this project uses. */
export function applyAction(state: MineOfOblivionState, action: EngineAction): MineOfOblivionState {
  switch (action.type) {
    case "SET_MINE_POSITION":
      return applySetMines(state, action.seat, action.tiles);
    case "SELECT_TILE_STEP":
      return applyStep(state, action.seat, action.tile);
    case "READY_NEXT_ROUND":
      return applyReadyNextRound(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// UI helpers — what a fair viewer of `seat` may see (mirrors the bot's own
// information boundary just below).
// ---------------------------------------------------------------------------

/** `seat`'s own armed mine tiles — always visible to that seat's own viewer. */
export function ownArmedMines(state: MineOfOblivionState, seat: Seat): TileId[] {
  return state.mines[seat].filter((t) => !state.disarmed[seat].includes(t));
}

/** Tiles now publicly known safe forever (any detonated mine, from either seat). */
export function publiclyDisarmedTiles(state: MineOfOblivionState): TileId[] {
  return [...state.disarmed.p1, ...state.disarmed.p2];
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Information fairness: the bot
// never reads the opponent's un-triggered mine tiles — only its own mines
// (`ownArmedMines`), tiles publicly known safe because a mine already
// detonated there (`publiclyDisarmedTiles`), and the public adjacent-count
// numbers on every already-visited tile (`state.revealedCounts` / `state.
// visitedTiles`, both public by construction the instant either seat
// reveals them) — exactly what a human in that seat could legitimately know.
// ---------------------------------------------------------------------------

type ScorableMove = Extract<EngineAction, { type: "SELECT_TILE_STEP" }>;

export function getValidMoves(state: MineOfOblivionState, seat: Seat): ScorableMove[] {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return [];
  return eightDirectionNeighbors(state.players[seat].position)
    .filter((tile) => state.players[otherSeat(seat)].position !== tile)
    .map((tile) => ({ type: "SELECT_TILE_STEP", seat, tile }));
}

export function scoreMove(state: MineOfOblivionState, seat: Seat, move: ScorableMove, tier: BotTier): number {
  if (tier === "novice") return 0; // uniform over every legal move, per the shared novice-tier convention

  const { tile } = move;
  if (ownArmedMines(state, seat).includes(tile)) return -1000; // never knowingly step on a known mine

  const remainingTreasures = state.treasures.filter((t) => t.holder === null).map((t) => t.tileId);
  const nearestTreasureDist = remainingTreasures.length === 0 ? 0 : Math.min(...remainingTreasures.map((t) => chebyshevDistance(tile, t)));

  let score = 0;
  if (remainingTreasures.includes(tile)) {
    const prospectiveOrder = state.treasureClaimCount + 1;
    const prospectivePoints = prospectiveOrder === 1 ? 10 : prospectiveOrder === 2 ? 15 : 20;
    score += 80 + prospectivePoints; // grabbing a treasure outright, weighted by its payout
  }
  score += (GRID_SIZE - nearestTreasureDist) * 3; // pull toward the nearest unclaimed treasure
  if (!state.visitedTiles.includes(tile)) score += 4; // unvisited ground still has a score to offer
  else score -= 2; // a revisited tile is worth nothing — mildly avoid unless it's the only useful step

  if (tier === "expert") {
    // A tile whose already-public adjacent count came back high hints at
    // more armed mines still hiding one ring further out — nudge the
    // expert bot to lean away from that neighborhood once it has other
    // options, same "read the public numbers" deduction a sharp human
    // opponent would do.
    const hotNeighbors = eightDirectionNeighbors(tile).filter((n) => (state.revealedCounts[n] ?? 0) >= 3);
    if (hotNeighbors.length > 0 && !remainingTreasures.includes(tile)) score -= hotNeighbors.length * 2;
  }
  return score;
}

/** Heuristic mine placement for the bot's `SETUP_MINE` submission — a whole `MINES_PER_PLAYER`-tile combination, not one atomic choice among a short list, so it doesn't go through `getValidMoves`/`scoreMove`/`pickByLevel`. Biases lightly toward guarding tiles a couple of steps out from the treasures (where an opponent is likely to path through) while keeping some randomness so mine layouts don't become a predictable rote pattern across bot levels. */
export function chooseBotMinePlacement(seat: Seat, level: BotLevel, rng: () => number = Math.random): TileId[] {
  const candidates = ALL_TILES.filter((t) => canPlaceMine(seat, t));
  const tier = botTier(level);
  const weight = (tile: TileId): number => {
    if (tier === "novice") return 1;
    const distToTreasure = Math.min(...TREASURE_TILES.map((t) => chebyshevDistance(tile, t)));
    const distToOwnStart = chebyshevDistance(tile, START_TILE[seat]);
    return 1 + Math.max(0, 3 - Math.abs(distToTreasure - 2)) + (tier === "expert" ? Math.max(0, distToOwnStart - 1) * 0.2 : 0);
  };
  const pool = candidates.map((tile) => ({ tile, weight: weight(tile) }));
  const chosen: TileId[] = [];
  for (let i = 0; i < MINES_PER_PLAYER && pool.length > 0; i++) {
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let roll = rng() * total;
    let pickIdx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j].weight;
      if (roll <= 0) {
        pickIdx = j;
        break;
      }
    }
    chosen.push(pool[pickIdx].tile);
    pool.splice(pickIdx, 1);
  }
  return chosen;
}

/**
 * `REVEAL_STEP` is deliberately NOT handled here — advancing past it is a
 * shared-clock, no-one-seat's-decision action (`READY_NEXT_ROUND` carries no
 * seat), driven by the room host's own timer, not by any bot seat's turn.
 * See `<Game>.tsx`'s host-only reveal-timer effect.
 */
export function chooseBotAction(state: MineOfOblivionState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase === "SETUP_MINE") {
    if (state.mineReady[seat]) return null;
    return { type: "SET_MINE_POSITION", seat, tiles: chooseBotMinePlacement(seat, level, rng) };
  }
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
