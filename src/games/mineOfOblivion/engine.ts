/**
 * Pure "망각의 지뢰 (Mine of Oblivion)" rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/망각의 지뢰/망각의 지뢰.md` (넷플릭스 데스게임 테마,
 * 단판 승부 하우스 룰). Several design points were confirmed via
 * `AskUserQuestion` (Strict No-Assumption Rule in the task brief) before
 * implementation, since they weren't derivable from the rulebook alone:
 *
 *  - **Board coordinates**: start tiles = corner "A1"(p1) / "E5"(p2); the 3
 *    treasure tiles = center "C3" + the two other corners "A5"/"E1".
 *  - **정찰(radar) 아이템**: NOT in the original rulebook (which has zero item
 *    system — pure memory/bluffing). Added as a platform extension per the
 *    confirmed answer: once per game, instead of moving, a seat may reveal
 *    whether one tile orthogonally adjacent to their pawn currently holds an
 *    *armed* mine (from either seat) — costs the turn, same as a move.
 *  - **턴 제한시간**: none — untimed, matching the rulebook's turn-based flow.
 *    Disconnect/idle→bot takeover is handled entirely by the shared
 *    `botTakeover.ts` module in `<Game>.tsx`, independent of this engine.
 *  - **승리조건 B 종료 시점**: the rulebook's "보드판 변수 소진" is undefined for
 *    an open grid with no movement-blocking (a player can always step
 *    somewhere), so the confirmed house rule caps the match at 20 turns per
 *    seat (40 total actions). If nobody has reached 2 treasures by then: more
 *    treasures wins; tied treasures → fewer mine hits taken wins; still tied
 *    → draw. (A "board fully exhausted without anyone reaching 2" via the
 *    rulebook's *other* clause — "보물이 모두 획득되었을 때" — is mathematically
 *    unreachable with 2 seats and 3 treasures: splitting 3 without anyone
 *    reaching 2 is impossible.)
 *
 * Everything else follows the rulebook verbatim: 5×5 grid, 4 secret mines per
 * seat (never on a treasure tile or the seat's *own* start tile — the
 * opponent's start tile is a legal mine spot, since the rulebook only
 * restricts "본인의 시작 칸"), orthogonal 1-tile moves only, a mine hit forces
 * the mover back to their own start tile + forfeits one held treasure (if
 * any) back onto its home tile, and the triggered mine itself detonates and
 * is permanently removed (that tile is safe forever after, for both seats).
 * "망각(forgetting)" is deliberately NOT an engine mechanic — the rulebook's
 * whole point is that a *human* player might forget where they buried their
 * own mines. There is no timer that blinds/resets tile info; a seat's own
 * mine layout is simply present in `mines[seat]` for the rest of the match,
 * exactly like an opponent's is in `mines[otherSeat]` — the "게임 정보 은닉" the
 * task brief asked for is enforced at the UI layer only (Board.tsx never
 * renders the opponent's un-triggered mine tiles), same convention as every
 * other hidden-hand game in this catalog (Lost Cities' hands, Dalmuti's
 * hands, …) — see `getValidMoves`'s / `scoreMove`'s doc for the matching
 * "bot only reads what a fair human opponent could know" discipline.
 *
 * A mine hit is a *forced retreat*, never a permanent elimination — the
 * rulebook has no "탈락" concept at all (only Win Condition A/B, §4). Forced
 * retreat is a penalty side-effect, not a move action, so it does not itself
 * re-trigger a mine check at the seat's start tile even if the opponent
 * happened to plant a mine there.
 *
 * Seat model follows the same `"p1" | "p2"` convention as every other
 * 2-player-exclusive online game here (lostCities, malDalliJa).
 */

import { seededRng } from "@/lib/rng";
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

// ---------------------------------------------------------------------------
// Board geometry (5×5, "A1".."E5" — same notation the rulebook itself uses)
// ---------------------------------------------------------------------------

export type TileId = string;

const COLS = ["A", "B", "C", "D", "E"] as const;
const ROWS = [1, 2, 3, 4, 5] as const;
/** Exported purely for UI grid layout (`MineOfOblivionBoard.tsx` iterates these to build the 5×5 CSS grid in reading order) — not used by any rule logic below, which only ever deals in `TileId` strings. */
export const BOARD_COLS: readonly string[] = COLS;
export const BOARD_ROWS: readonly number[] = ROWS;

export const ALL_TILES: readonly TileId[] = COLS.flatMap((c) => ROWS.map((r) => `${c}${r}`));

export const START_TILE: Record<Seat, TileId> = { p1: "A1", p2: "E5" };
/** Center + the two non-start corners — confirmed board layout. */
export const TREASURE_TILES: readonly TileId[] = ["C3", "A5", "E1"];

export const MINES_PER_PLAYER = 4;
/** Confirmed house rule: 20 turns/seat = 40 total actions before Win Condition B's tiebreak kicks in. */
export const TURN_CAP = 40;

function colIndex(tile: TileId): number {
  return COLS.indexOf(tile[0] as (typeof COLS)[number]);
}
function rowIndex(tile: TileId): number {
  return ROWS.indexOf(Number(tile.slice(1)) as (typeof ROWS)[number]);
}

export function isOrthogonallyAdjacent(a: TileId, b: TileId): boolean {
  const dc = Math.abs(colIndex(a) - colIndex(b));
  const dr = Math.abs(rowIndex(a) - rowIndex(b));
  return dc + dr === 1;
}

export function orthogonalNeighbors(tile: TileId): TileId[] {
  const c = colIndex(tile);
  const r = rowIndex(tile);
  const deltas = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const out: TileId[] = [];
  for (const [dc, dr] of deltas) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc >= 0 && nc < COLS.length && nr >= 0 && nr < ROWS.length) out.push(`${COLS[nc]}${ROWS[nr]}`);
  }
  return out;
}

function manhattanDistance(a: TileId, b: TileId): number {
  return Math.abs(colIndex(a) - colIndex(b)) + Math.abs(rowIndex(a) - rowIndex(b));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Treasure {
  tileId: TileId;
  /** null while still sitting on the board. */
  holder: Seat | null;
}

export interface PlayerState {
  position: TileId;
  treasureCount: number;
  mineHitsTaken: number;
  radarUsed: boolean;
  /** Tiles this seat has used its one radar charge on — UI-only bookkeeping (own-eyes-only, per the info-fairness note above). */
  radarRevealed: TileId[];
}

export type EventKind = "safe" | "treasure" | "mine" | "radar-safe" | "radar-mine";

export interface LastEvent {
  kind: EventKind;
  actor: Seat;
  tile: TileId;
  /** Only for `"mine"` — whose mine(s) detonated (usually one seat; both if the two seats happened to mine the same tile). */
  mineOwners?: Seat[];
  treasureForfeited?: boolean;
}

export type Phase = "SETUP_MINE" | "PLAYER_MOVE" | "REVEAL_STEP" | "GAME_OVER";

export interface MineOfOblivionState {
  phase: Phase;
  /** Secret mine layouts — full state carries both seats' (see file header re: UI-level-only secrecy). */
  mines: Record<Seat, TileId[]>;
  /** Per-seat tiles whose mine has already detonated and is gone — checked against `mines[seat]` to know which are still armed. */
  disarmed: Record<Seat, TileId[]>;
  mineReady: Record<Seat, boolean>;
  treasures: Treasure[];
  players: Record<Seat, PlayerState>;
  activeSeat: Seat;
  /** Total actions taken across both seats since PLAYER_MOVE started (move or radar alike) — drives the `TURN_CAP` house rule. */
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
 * `ownArmedMines`, or a tile they've already spent their own radar charge
 * on) — calling it for an arbitrary tile and rendering the result would leak
 * the opponent's hidden mine layout, the same trust boundary every other
 * hidden-hand game in this catalog relies on the UI layer to respect.
 */
export function armedMineOwnersAt(state: Pick<MineOfOblivionState, "mines" | "disarmed">, tile: TileId): Seat[] {
  return (["p1", "p2"] as const).filter((seat) => state.mines[seat].includes(tile) && !state.disarmed[seat].includes(tile));
}

/** True iff `tile` is a legal spot for `seat` to bury a mine — not a treasure tile, not `seat`'s own start tile (rulebook §1's two constraints; the opponent's start tile is deliberately allowed). */
export function canPlaceMine(seat: Seat, tile: TileId): boolean {
  if (!ALL_TILES.includes(tile)) return false;
  if (TREASURE_TILES.includes(tile)) return false;
  if (tile === START_TILE[seat]) return false;
  return true;
}

export function startGame(rng: () => number = Math.random): MineOfOblivionState {
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    phase: "SETUP_MINE",
    mines: { p1: [], p2: [] },
    disarmed: { p1: [], p2: [] },
    mineReady: { p1: false, p2: false },
    treasures: TREASURE_TILES.map((tileId) => ({ tileId, holder: null })),
    players: {
      p1: { position: START_TILE.p1, treasureCount: 0, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] },
      p2: { position: START_TILE.p2, treasureCount: 0, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] },
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
  | { type: "USE_RADAR_ITEM"; seat: Seat; tile: TileId }
  /** Acknowledges the current REVEAL_STEP overlay and advances the game — named to match the task brief's event vocabulary, repurposed here as "ready to continue past this reveal" since this house rule is single-round (no next round to ready up for). Carries no seat: any client may fire it (mirrors grid-poker/showMeTheCoin's shared skip button), and it's a no-op once `phase` has already moved past REVEAL_STEP, so a near-simultaneous double-press from both viewers is harmless. */
  | { type: "READY_NEXT_ROUND" };

function resolveWinConditionB(state: MineOfOblivionState): { winner: Seat | null; isDraw: boolean } {
  const p1 = state.players.p1;
  const p2 = state.players.p2;
  if (p1.treasureCount !== p2.treasureCount) {
    return { winner: p1.treasureCount > p2.treasureCount ? "p1" : "p2", isDraw: false };
  }
  if (p1.mineHitsTaken !== p2.mineHitsTaken) {
    return { winner: p1.mineHitsTaken < p2.mineHitsTaken ? "p1" : "p2", isDraw: false };
  }
  return { winner: null, isDraw: true };
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

/** Shared arrival resolution for a legal step onto `tile` — mine/treasure/safe judgment, retreat/forfeit penalty, and the `REVEAL_STEP` + turn-cap bookkeeping every move-consuming action goes through. */
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
    const mover_ = next.players[mover];
    const hadTreasure = mover_.treasureCount > 0;
    let treasures = next.treasures;
    if (hadTreasure) {
      const idx = treasures.findIndex((t) => t.holder === mover);
      if (idx !== -1) treasures = treasures.map((t, i) => (i === idx ? { ...t, holder: null } : t));
    }
    next = {
      ...next,
      disarmed,
      treasures,
      players: {
        ...next.players,
        [mover]: {
          ...mover_,
          position: START_TILE[mover],
          treasureCount: hadTreasure ? mover_.treasureCount - 1 : mover_.treasureCount,
          mineHitsTaken: mover_.mineHitsTaken + 1,
        },
      },
      lastEvent: { kind: "mine", actor: mover, tile, mineOwners: triggeredOwners, treasureForfeited: hadTreasure },
    };
  } else {
    const treasureIdx = next.treasures.findIndex((t) => t.tileId === tile && t.holder === null);
    if (treasureIdx !== -1) {
      const treasures = next.treasures.map((t, i) => (i === treasureIdx ? { ...t, holder: mover } : t));
      const treasureCount = next.players[mover].treasureCount + 1;
      next = {
        ...next,
        treasures,
        players: { ...next.players, [mover]: { ...next.players[mover], treasureCount } },
        lastEvent: { kind: "treasure", actor: mover, tile },
      };
    } else {
      next = { ...next, lastEvent: { kind: "safe", actor: mover, tile } };
    }
  }

  return finalizeAction(next, mover);
}

/** Win Condition A (2 treasures) and the `TURN_CAP` tiebreak (Win Condition B), then the shared REVEAL_STEP gate. */
function finalizeAction(state: MineOfOblivionState, mover: Seat): MineOfOblivionState {
  if (state.players[mover].treasureCount >= 2) {
    return { ...state, phase: "REVEAL_STEP", pendingGameOver: true, winner: mover, isDraw: false };
  }
  if (state.actionsPlayed >= TURN_CAP) {
    const { winner, isDraw } = resolveWinConditionB(state);
    return { ...state, phase: "REVEAL_STEP", pendingGameOver: true, winner, isDraw };
  }
  return { ...state, phase: "REVEAL_STEP", pendingGameOver: false };
}

function applyStep(state: MineOfOblivionState, seat: Seat, tile: TileId): MineOfOblivionState {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return state;
  if (!isOrthogonallyAdjacent(state.players[seat].position, tile)) return state;
  return resolveArrival(state, seat, tile);
}

function applyRadar(state: MineOfOblivionState, seat: Seat, tile: TileId): MineOfOblivionState {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return state;
  if (state.players[seat].radarUsed) return state;
  if (!isOrthogonallyAdjacent(state.players[seat].position, tile)) return state;

  const hasMine = armedMineOwnersAt(state, tile).length > 0;
  const next: MineOfOblivionState = {
    ...state,
    actionsPlayed: state.actionsPlayed + 1,
    players: {
      ...state.players,
      [seat]: { ...state.players[seat], radarUsed: true, radarRevealed: [...state.players[seat].radarRevealed, tile] },
    },
    lastEvent: { kind: hasMine ? "radar-mine" : "radar-safe", actor: seat, tile },
  };
  return finalizeAction(next, seat);
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
    case "USE_RADAR_ITEM":
      return applyRadar(state, action.seat, action.tile);
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
// (`ownArmedMines`), tiles it has spent its own radar charge on
// (`players[seat].radarRevealed`), and tiles publicly known safe because a
// mine already detonated there (`publiclyDisarmedTiles`) — exactly what a
// human in that seat could legitimately know.
// ---------------------------------------------------------------------------

/** `scoreMove` only ever receives what `getValidMoves` produces during `PLAYER_MOVE` — the other two `EngineAction` variants (`SET_MINE_POSITION`, `READY_NEXT_ROUND`) go through different dedicated paths (`chooseBotMinePlacement`, the host's shared reveal timer) and are never scored here. */
type ScorableMove = Extract<EngineAction, { type: "SELECT_TILE_STEP" | "USE_RADAR_ITEM" }>;

export function getValidMoves(state: MineOfOblivionState, seat: Seat): ScorableMove[] {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return [];
  const moves: ScorableMove[] = orthogonalNeighbors(state.players[seat].position).map((tile) => ({ type: "SELECT_TILE_STEP", seat, tile }));
  if (!state.players[seat].radarUsed) {
    for (const tile of orthogonalNeighbors(state.players[seat].position)) {
      moves.push({ type: "USE_RADAR_ITEM", seat, tile });
    }
  }
  return moves;
}

function tileKnownSafe(state: MineOfOblivionState, seat: Seat, tile: TileId): boolean {
  return publiclyDisarmedTiles(state).includes(tile) || state.players[seat].radarRevealed.includes(tile);
}

function tileKnownDangerForSeat(state: MineOfOblivionState, seat: Seat, tile: TileId): boolean {
  if (ownArmedMines(state, seat).includes(tile)) return true;
  if (state.players[seat].radarRevealed.includes(tile)) {
    // Only known-dangerous if this seat's own radar charge (the one charge it
    // ever gets) was spent right here and came back positive.
    return armedMineOwnersAt(state, tile).length > 0;
  }
  return false;
}

export function scoreMove(state: MineOfOblivionState, seat: Seat, move: ScorableMove, tier: BotTier): number {
  if (tier === "novice") return 0; // uniform over every legal move, per the shared novice-tier convention

  const remainingTreasures = state.treasures.filter((t) => t.holder === null).map((t) => t.tileId);
  const nearestTreasureDist = (tile: TileId) => (remainingTreasures.length === 0 ? 0 : Math.min(...remainingTreasures.map((t) => manhattanDistance(tile, t))));

  if (move.type === "SELECT_TILE_STEP") {
    const { tile } = move;
    if (tileKnownDangerForSeat(state, seat, tile)) return -1000; // never knowingly step on a known mine

    let score = 0;
    if (remainingTreasures.includes(tile)) score += 60; // grabbing a treasure outright
    score += (5 - nearestTreasureDist(tile)) * 4; // pull toward the nearest unclaimed treasure
    if (tileKnownSafe(state, seat, tile)) score += 3; // mild preference for confirmed-safe ground

    if (tier === "expert") {
      // Rulebook strategy tip §5.2: a suspiciously roundabout path away from
      // the direct line to a treasure often means the opponent mined that
      // line — nudge the expert bot to occasionally favor a side approach
      // over an untested straight shot once treasures start thinning out.
      if (remainingTreasures.length <= 1 && !tileKnownSafe(state, seat, tile) && !remainingTreasures.includes(tile)) score -= 2;
    }
    return score;
  }

  // USE_RADAR_ITEM
  const { tile } = move;
  if (tileKnownSafe(state, seat, tile) || ownArmedMines(state, seat).includes(tile)) return 1; // nothing new to learn here
  const valueOfKnowing = (5 - nearestTreasureDist(tile)) * 2;
  return tier === "expert" ? valueOfKnowing + 6 : valueOfKnowing;
}

/** Heuristic mine placement for the bot's `SETUP_MINE` submission — this doesn't go through `getValidMoves`/`scoreMove`/`pickByLevel` since a "move" here is a whole 4-tile combination, not one atomic choice among a short list. Biases lightly toward guarding tiles near the treasures (where an opponent is likely to path through) while never fully surrounding a treasure (leaves the bot itself a way to reach it later), and keeps some randomness so mine layouts don't become a predictable rote pattern across bot levels. */
export function chooseBotMinePlacement(seat: Seat, level: BotLevel, rng: () => number = Math.random): TileId[] {
  const candidates = ALL_TILES.filter((t) => canPlaceMine(seat, t));
  const tier = botTier(level);
  const weight = (tile: TileId): number => {
    if (tier === "novice") return 1;
    const distToTreasure = Math.min(...TREASURE_TILES.map((t) => manhattanDistance(tile, t)));
    const distToOwnStart = manhattanDistance(tile, START_TILE[seat]);
    // Favor tiles a couple steps out from a treasure (guarding the approach) over either the treasure's own doorstep or the far edges of the board.
    return 1 + Math.max(0, 3 - Math.abs(distToTreasure - 2)) + (tier === "expert" ? Math.max(0, distToOwnStart - 1) * 0.3 : 0);
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
 * seat), driven by the room host's own timer exactly like grid-poker's
 * `round-result`→`advance-round-result` and showMeTheCoin's showdown, not by
 * any bot seat's turn. See `<Game>.tsx`'s host-only reveal-timer effect.
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
