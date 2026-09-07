/**
 * Pure "망각의 지뢰 2 (Mine of Oblivion 2)" rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/망각의 지뢰 2/망각의 지뢰 2.md`. This is a brand
 * new game built on top of 1편's already-modern 11×11 exploration-race board
 * (`src/games/mineOfOblivion/engine.ts` — NOT the old 5×5 forfeit build, that
 * was fully replaced back in 2026-08-31/09-01). Everything from 1편 — the
 * 11×11 grid, 8-directional movement, secret per-seat mine burial, the public
 * adjacent-mine-count reveal clue, sequential treasure scoring, and mine-hit
 * −5 + forced respawn — carries over unchanged. This file adds exactly one
 * new layer on top: **시한폭탄 (Time Bomb)**, a second secret hazard type
 * with its own turn-based countdown and a 3×3 splash-damage explosion.
 *
 * Per this project's `AGENTS.md`/`ARCHITECTURE.md` §2 "zero cross-game code
 * coupling" convention, this file does NOT import from `../mineOfOblivion/
 * engine.ts` — the shared geometry/respawn helpers are duplicated here
 * (same idiom `useCountdown.ts` already uses across every game in this
 * catalog), so 1편 and 2편 can evolve independently without risk of one
 * game's future edit silently changing the other's rules.
 *
 * Four design points were genuinely ambiguous in the brief and were
 * confirmed via `AskUserQuestion` (Strict No-Assumption Rule) before writing
 * any code:
 *
 *  1. **카운트다운 기준 — 전역 턴**: a time bomb's remaining fuse decrements by
 *     1 on *every* `SELECT_TILE_STEP` move, regardless of which seat made
 *     it — so one full round (both seats moving once) burns 2 ticks off
 *     every live bomb, not 1. See `tickTimeBombs` below.
 *  2. **퓨즈 길이 — 설치자가 매 폭탄마다 3~5턴 중 선택**: not a single fixed
 *     global constant — `TIME_BOMB_FUSE_OPTIONS` bounds it, but each of a
 *     seat's 3 bombs carries its own independently-chosen `fuseTurns`.
 *  3. **아직 안 터진 폭탄 칸을 밟았을 때 — 완전히 무해함**: confirmed
 *     "카운트다운전에는 밟아도 아무 이상 없음". So stepping onto a live time
 *     bomb tile is *indistinguishable* from stepping onto an ordinary tile —
 *     `resolveArrival` below has zero special-casing for it. A bomb can only
 *     ever detonate on its own schedule (`tickTimeBombs`), never by being
 *     stepped on. This also means live time bombs do **not** contribute to
 *     the shared `computeAdjacentMineScore` public clue (a deliberate design
 *     call, not re-confirmed in the same round, but the only reading
 *     consistent with #3 and with the brief's framing of this as a wholly
 *     additional system layered "on top of" 1편's mine/clue mechanic rather
 *     than merged into it — flagged here explicitly rather than silently).
 *  4. **일반 지뢰와 같은 칸에 중첩 설치 — 불가**: within one seat's own
 *     11-tile secret submission (8 mines + 3 bombs), every tile must be
 *     distinct. Cross-seat overlaps are still allowed and independently
 *     resolved (unknowable at simultaneous-secret placement time anyway —
 *     same precedent 1편's mine layer already established for its own
 *     mine-vs-mine overlaps).
 *
 * **2026-09-07 확장 — 원격 수동 격발("즉시 격발") + N턴 예약 안내 UI.** The
 * setup-time fuse *picker* the brief re-requested already existed unchanged
 * (3/4/5턴, confirmed kept as-is rather than narrowed to 1/2/3 per a fresh
 * `AskUserQuestion` round — the brief's "1턴/2턴/3턴" phrasing was a
 * documentation example, not an intended balance change). What's genuinely
 * new is a manual trigger a seat can press on their own turn, confirmed via
 * two `AskUserQuestion` rounds (the brief's "즉시 격발" wording undersold how
 * non-instant the requested behavior actually is):
 *  5. **격발 조건**: available any time on your own turn (`activeSeat`), on
 *     any of your own still-`armed` bombs — NOT gated on the opponent
 *     currently standing in the 3×3 zone, and NOT gated on any minimum time
 *     having elapsed since placement.
 *  6. **턴 소모**: a free action, independent of movement — does not end the
 *     turn, does not bump `actionsPlayed`. A seat may press it on any number
 *     of their own bombs before submitting their `SELECT_TILE_STEP` for the
 *     turn.
 *  7. **격발은 즉시가 아니라 "2턴 후"**: pressing it does not detonate the
 *     bomb on the spot. It only clamps `remaining` down to
 *     `TIME_BOMB_MANUAL_TRIGGER_DELAY` (2) — never up — so the explosion
 *     still fires through the ordinary `tickTimeBombs` path exactly 2 more
 *     global ticks later, identical in every way to a naturally-expired
 *     fuse (same 3×3 blast, same −5/+2 scoring). A bomb already at or below
 *     that delay has nothing left to shorten, so the action is a no-op
 *     (`canManuallyDetonate` — the UI disables the button instead of firing
 *     a silent no-op).
 * The setup fuse range (3/4/5) staying unchanged means point #2 above is
 * unaffected; this only adds a second, player-triggered path onto the same
 * `remaining` countdown. Deliberately NOT extended to the bot AI
 * (`chooseBotAction`) — the brief never asked for bot behavior here, and the
 * bot's existing self-preservation heuristic in `scoreMove` already treats a
 * soon-to-detonate own bomb as a tile to avoid.
 *
 * Two more calls made without a fresh confirmation round, flagged here
 * explicitly:
 *
 *  - **자기 폭탄 자폭**: a bomb's own owner takes the same −5 if they're
 *     standing in its 3×3 blast zone when it goes off — mirrors 1편's
 *     explicit "내 지뢰를 내가 밟아도 동일하게 −5점" rule (`resolveArrival`'s
 *     mine handling never exempts the owner either).
 *  - **폭발 시 강제 리스폰**: any seat caught in a time-bomb blast is
 *     force-respawned to the nearest safe tile near their own start tile,
 *     exactly like a regular mine hit (`chooseRespawnTile`, duplicated
 *     from 1편's identical algorithm) — for consistency, since a 3×3
 *     explosion is strictly more dangerous than a single mine tile, there's
 *     no reason its landing-consequence severity would be *milder*.
 *  - **"안전하게 피했을 때 개당 2점"**: since #3 rules out "stepped near it and
 *     didn't trigger it" as a coherent event (nothing is ever triggered by
 *     stepping), the only self-consistent reading of "avoided" is "went off
 *     on schedule with nobody in the 3×3 zone" — the bomb's owner banks
 *     `TIME_BOMB_SAFE_BONUS` (+2) the instant that resolves harmlessly. A
 *     bomb that never reaches 0 before the match ends (3rd treasure claimed)
 *     simply never resolves — no end-of-game "count remaining armed bombs"
 *     bonus sweep, since the brief only ever describes the bonus as
 *     something computed "when" a bomb is safely avoided, i.e. at its own
 *     detonation instant.
 *
 * Mine/bomb counts per seat: `MINES_PER_PLAYER` (8) kept identical to 1편's
 * own tuned value (still a house-rule choice there, not re-litigated here).
 * `TIME_BOMBS_PER_PLAYER` (3) and the 3–5 fuse range are both given directly
 * by the brief.
 */

import { seededRng } from "@/lib/rng";
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

// ---------------------------------------------------------------------------
// Board geometry (11×11, "A1".."K11") — identical layout to 1편, duplicated
// per the zero-cross-game-coupling convention (see module doc).
// ---------------------------------------------------------------------------

export type TileId = string;

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
export const BOARD_COLS: readonly string[] = COLS;
export const BOARD_ROWS: readonly number[] = ROWS;
export const GRID_SIZE = 11;

export const ALL_TILES: readonly TileId[] = COLS.flatMap((c) => ROWS.map((r) => `${c}${r}`));

export const START_TILE: Record<Seat, TileId> = { p1: "A1", p2: "K11" };
export const TREASURE_TILES: readonly TileId[] = ["A11", "K1", "F6"];

/** Regular secret mines per seat — unchanged from 1편's own tuned value. */
export const MINES_PER_PLAYER = 8;
/** Secret time bombs per seat — given directly by the brief. */
export const TIME_BOMBS_PER_PLAYER = 3;
/** Fuse length a player may choose per bomb, in global ticks (see module doc #1/#2). */
export const TIME_BOMB_FUSE_OPTIONS = [3, 4, 5] as const;
export type TimeBombFuse = (typeof TIME_BOMB_FUSE_OPTIONS)[number];
/** Flat penalty for anyone (owner included) caught in a bomb's 3×3 blast zone at detonation. */
export const TIME_BOMB_BLAST_PENALTY = 5;
/** Bonus the owner banks when their bomb detonates with the blast zone empty ("안전하게 피했을 때"). */
export const TIME_BOMB_SAFE_BONUS = 2;
/** How many global ticks a manual "즉시 격발" press leaves on the fuse — see module doc #7. Pressing the button clamps `remaining` down to this value (never up), so the bomb still detonates through the normal `tickTimeBombs` path. */
export const TIME_BOMB_MANUAL_TRIGGER_DELAY = 2;

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

/** Every tile at exactly Chebyshev distance `radius` from `center` (a hollow square ring), sorted for deterministic iteration. */
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

/**
 * 3×3 blast zone centered on `tile` — the tile itself plus up to 8
 * neighbors, edge-clipped exactly like `eightDirectionNeighbors`. Exported
 * for UI danger-zone guides.
 */
export function blastZone(tile: TileId): TileId[] {
  return [tile, ...eightDirectionNeighbors(tile)];
}

/** Deterministic FNV-1a-hash pick — lockstep online sync requires `applyAction` to stay a pure function of `(state, action)` with no `Math.random()` inside the reducer (see 1편's identical helper's doc for the full rationale). */
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
  order: 1 | 2 | 3 | null;
  points: number | null;
}

export interface PlayerState {
  position: TileId;
  score: number;
  treasuresClaimed: number;
  mineHitsTaken: number;
  /** Times this seat was caught in ANY time-bomb 3×3 blast (own or opponent's). */
  bombHitsTaken: number;
  /** Own bombs that detonated with the blast zone empty — each banked `TIME_BOMB_SAFE_BONUS`. */
  bombsSafelyDetonated: number;
}

export interface TimeBomb {
  id: string;
  seat: Seat;
  tile: TileId;
  fuseTurns: TimeBombFuse;
  /** Counts down from `fuseTurns` to 0 — see `tickTimeBombs`. */
  remaining: number;
  status: "armed" | "exploded";
  /** True once the owner has pressed "즉시 격발" on this bomb (module doc #5-7) — a UI cue only ("🔥 격발됨" badge); detonation mechanics are otherwise identical to a naturally-expired fuse. */
  manuallyTriggered: boolean;
}

export type EventKind = "reveal" | "treasure" | "mine";

export interface LastEvent {
  kind: EventKind;
  actor: Seat;
  tile: TileId;
  scoreGained?: number;
  alreadyVisited?: boolean;
  mineOwners?: Seat[];
  respawnTile?: TileId;
  treasureOrder?: 1 | 2 | 3;
  treasurePoints?: number;
}

/** One time bomb's detonation this move — 0, 1, or several can fire off a single `SELECT_TILE_STEP` (every armed bomb ticks down on every move; several can hit 0 in the same tick). */
export interface BombEvent {
  bombId: string;
  owner: Seat;
  tile: TileId;
  /** Seats caught inside the 3×3 zone at the instant of detonation (0, 1, or 2). */
  hitSeats: Seat[];
  /** Where each hit seat was force-respawned to. */
  respawns: Partial<Record<Seat, TileId>>;
  /** `TIME_BOMB_SAFE_BONUS` if `hitSeats` was empty, else 0. */
  ownerBonus: number;
}

export type Phase = "SETUP_MINE" | "PLAYER_MOVE" | "REVEAL_STEP" | "GAME_OVER";

export interface MineOfOblivion2State {
  phase: Phase;
  mines: Record<Seat, TileId[]>;
  disarmed: Record<Seat, TileId[]>;
  timeBombs: TimeBomb[];
  mineReady: Record<Seat, boolean>;
  visitedTiles: TileId[];
  revealedCounts: Partial<Record<TileId, number>>;
  treasures: Treasure[];
  treasureClaimCount: number;
  players: Record<Seat, PlayerState>;
  activeSeat: Seat;
  actionsPlayed: number;
  lastEvent: LastEvent | null;
  /** Every time bomb that detonated on the move that produced the current `lastEvent`/`actionsPlayed` — empty array (not stale data) when none did. */
  lastBombEvents: BombEvent[];
  pendingGameOver: boolean;
  winner: Seat | null;
  isDraw: boolean;
}

/** Which seat(s) currently have an armed regular mine at `tile`. Same info-boundary contract as 1편: only safe to call for a tile the viewer already legitimately knows about. */
export function armedMineOwnersAt(state: Pick<MineOfOblivion2State, "mines" | "disarmed">, tile: TileId): Seat[] {
  return (["p1", "p2"] as const).filter((seat) => state.mines[seat].includes(tile) && !state.disarmed[seat].includes(tile));
}

/** Sum of still-armed *regular mines* (not time bombs — see module doc #3) across `tile`'s up-to-8 neighbors. */
function computeAdjacentMineScore(state: Pick<MineOfOblivion2State, "mines" | "disarmed">, tile: TileId): number {
  return eightDirectionNeighbors(tile).reduce((sum, n) => sum + armedMineOwnersAt(state, n).length, 0);
}

/** True iff `tile` is a legal spot for `seat` to bury a regular mine or a time bomb — not a treasure tile, not either start tile. Identical constraint for both hazard types. */
export function canPlaceHazard(seat: Seat, tile: TileId): boolean {
  if (!ALL_TILES.includes(tile)) return false;
  if (TREASURE_TILES.includes(tile)) return false;
  if (tile === START_TILE.p1 || tile === START_TILE.p2) return false;
  void seat;
  return true;
}

/** True iff `tile` is one of the two seats' own start tiles — the board's only permanent safe zone (identical to 1편). */
export function isSafeZoneTile(tile: TileId): boolean {
  return tile === START_TILE.p1 || tile === START_TILE.p2;
}

export function startGame(rng: () => number = Math.random): MineOfOblivion2State {
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    phase: "SETUP_MINE",
    mines: { p1: [], p2: [] },
    disarmed: { p1: [], p2: [] },
    timeBombs: [],
    mineReady: { p1: false, p2: false },
    visitedTiles: [],
    revealedCounts: {},
    treasures: TREASURE_TILES.map((tileId) => ({ tileId, holder: null, order: null, points: null })),
    treasureClaimCount: 0,
    players: {
      p1: { position: START_TILE.p1, score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      p2: { position: START_TILE.p2, score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
    },
    activeSeat: firstSeat,
    actionsPlayed: 0,
    lastEvent: null,
    lastBombEvents: [],
    pendingGameOver: false,
    winner: null,
    isDraw: false,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface BombPlacement {
  tile: TileId;
  fuseTurns: TimeBombFuse;
}

export type EngineAction =
  | { type: "SET_SETUP"; seat: Seat; mines: TileId[]; bombs: BombPlacement[] }
  | { type: "SELECT_TILE_STEP"; seat: Seat; tile: TileId }
  | { type: "DETONATE_BOMB"; seat: Seat; bombId: string }
  | { type: "READY_NEXT_ROUND" };

/** True iff `seat` may currently press "즉시 격발" on `bomb` (module doc #5-7) — only reduces the fuse, so a bomb already at or below `TIME_BOMB_MANUAL_TRIGGER_DELAY` has nothing left to shorten. */
export function canManuallyDetonate(bomb: TimeBomb): boolean {
  return bomb.status === "armed" && bomb.remaining > TIME_BOMB_MANUAL_TRIGGER_DELAY;
}

function tileSafeForRespawn(state: MineOfOblivion2State, tile: TileId, victim: Seat): boolean {
  if (armedMineOwnersAt(state, tile).length > 0) return false;
  const other = otherSeat(victim);
  return state.players[other].position !== tile;
}

/** Nearest-first (Chebyshev rings expanding from `victim`'s own start tile), random-among-ties respawn pick — identical algorithm to 1편's `chooseRespawnTile`, generalized to any seat needing a forced respawn (a regular mine hit or a time-bomb blast). `seedTile`/`state.actionsPlayed` keep the "random" pick deterministic and reproducible for lockstep replay. */
function chooseRespawnTile(state: MineOfOblivion2State, victim: Seat, seedTile: TileId): TileId {
  const start = START_TILE[victim];
  const maxRadius = COLS.length + ROWS.length;
  for (let radius = 0; radius <= maxRadius; radius++) {
    const ring = chebyshevRing(start, radius).filter((t) => tileSafeForRespawn(state, t, victim));
    if (ring.length > 0) {
      return deterministicPick(ring, `${victim}:${seedTile}:${state.actionsPlayed}:${radius}`);
    }
  }
  return start; // unreachable in practice
}

function resolveWinner(state: MineOfOblivion2State): { winner: Seat | null; isDraw: boolean } {
  const p1 = state.players.p1.score;
  const p2 = state.players.p2.score;
  if (p1 === p2) return { winner: null, isDraw: true };
  return { winner: p1 > p2 ? "p1" : "p2", isDraw: false };
}

function applySetSetup(state: MineOfOblivion2State, seat: Seat, mines: TileId[], bombs: BombPlacement[]): MineOfOblivion2State {
  if (state.phase !== "SETUP_MINE" || state.mineReady[seat]) return state;
  if (mines.length !== MINES_PER_PLAYER) return state;
  if (bombs.length !== TIME_BOMBS_PER_PLAYER) return state;
  const bombTiles = bombs.map((b) => b.tile);
  const allTiles = [...mines, ...bombTiles];
  if (new Set(allTiles).size !== allTiles.length) return state; // module doc #4 — no self-overlap between own mines and own bombs
  if (!mines.every((t) => canPlaceHazard(seat, t))) return state;
  if (!bombs.every((b) => canPlaceHazard(seat, b.tile) && TIME_BOMB_FUSE_OPTIONS.includes(b.fuseTurns))) return state;

  const newBombs: TimeBomb[] = bombs.map((b, i) => ({
    id: `${seat}-tb-${i}`,
    seat,
    tile: b.tile,
    fuseTurns: b.fuseTurns,
    remaining: b.fuseTurns,
    status: "armed",
    manuallyTriggered: false,
  }));

  const nextMines = { ...state.mines, [seat]: mines };
  const nextMineReady = { ...state.mineReady, [seat]: true };
  const bothReady = nextMineReady.p1 && nextMineReady.p2;
  return {
    ...state,
    mines: nextMines,
    timeBombs: [...state.timeBombs, ...newBombs],
    mineReady: nextMineReady,
    phase: bothReady ? "PLAYER_MOVE" : "SETUP_MINE",
  };
}

/**
 * Decrements every still-armed bomb's `remaining` by 1 (module doc #1 —
 * "전역 턴 기준", fires once per `SELECT_TILE_STEP` regardless of mover),
 * then resolves every bomb that just hit 0. Detonations are processed one at
 * a time in a stable deterministic order (`bombId` ascending) so that if two
 * bombs detonate in the same tick, the second one's blast check reads
 * positions *after* the first one's forced respawns have already applied —
 * no ambiguity about which snapshot of the board each explosion judges.
 */
function tickTimeBombs(state: MineOfOblivion2State): { state: MineOfOblivion2State; events: BombEvent[] } {
  let bombs = state.timeBombs.map((b) => (b.status === "armed" ? { ...b, remaining: b.remaining - 1 } : b));
  const detonatingIds = bombs
    .filter((b) => b.status === "armed" && b.remaining <= 0)
    .map((b) => b.id)
    .sort();

  let players = state.players;
  const events: BombEvent[] = [];
  let workingState = state;

  for (const bombId of detonatingIds) {
    const bomb = bombs.find((b) => b.id === bombId)!;
    workingState = { ...workingState, players };
    const zone = new Set(blastZone(bomb.tile));
    const hitSeats = (["p1", "p2"] as const).filter((s) => zone.has(players[s].position));
    const respawns: Partial<Record<Seat, TileId>> = {};
    let ownerBonus = 0;

    if (hitSeats.length > 0) {
      for (const s of hitSeats) {
        const respawnTile = chooseRespawnTile(workingState, s, bomb.tile);
        const victim = players[s];
        players = { ...players, [s]: { ...victim, position: respawnTile, score: victim.score - TIME_BOMB_BLAST_PENALTY, bombHitsTaken: victim.bombHitsTaken + 1 } };
        respawns[s] = respawnTile;
      }
    } else {
      ownerBonus = TIME_BOMB_SAFE_BONUS;
      const owner = players[bomb.seat];
      players = { ...players, [bomb.seat]: { ...owner, score: owner.score + TIME_BOMB_SAFE_BONUS, bombsSafelyDetonated: owner.bombsSafelyDetonated + 1 } };
    }

    bombs = bombs.map((b) => (b.id === bombId ? { ...b, status: "exploded" as const, remaining: 0 } : b));
    events.push({ bombId, owner: bomb.seat, tile: bomb.tile, hitSeats, respawns, ownerBonus });
  }

  return { state: { ...state, timeBombs: bombs, players }, events };
}

/**
 * Win condition (3rd treasure claimed) + the shared REVEAL_STEP gate. A
 * plain "reveal" arrival with **no** bomb detonating this move still skips
 * REVEAL_STEP entirely and passes the turn immediately, exactly like 1편's
 * 2026-09-01 popup-removal rule. A mine hit, a treasure claim, or **any**
 * bomb detonation (even one unrelated to the mover's own destination tile —
 * a bomb elsewhere on the board can reach 0 on someone else's move) all
 * route through the dramatic REVEAL_STEP pause instead.
 */
function finalizeAction(state: MineOfOblivion2State, mover: Seat, bombEvents: BombEvent[]): MineOfOblivion2State {
  if (state.treasureClaimCount >= 3) {
    const { winner, isDraw } = resolveWinner(state);
    return { ...state, phase: "REVEAL_STEP", pendingGameOver: true, winner, isDraw };
  }
  if (state.lastEvent?.kind === "reveal" && bombEvents.length === 0) {
    return { ...state, phase: "PLAYER_MOVE", activeSeat: otherSeat(mover) };
  }
  return { ...state, phase: "REVEAL_STEP", pendingGameOver: false };
}

/** Arrival judgment only (mine/treasure/reveal) — mirrors 1편's `resolveArrival` but stops short of finalizing, since `applyStep` still needs to tick time bombs before deciding the next phase. */
function resolveArrivalCore(state: MineOfOblivion2State, mover: Seat, tile: TileId): MineOfOblivion2State {
  const triggeredOwners = armedMineOwnersAt(state, tile);
  let next: MineOfOblivion2State = {
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
      // Module doc #3: only *armed regular mines* feed the public adjacent-count clue — a live time bomb on a neighboring tile is invisible to this number.
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

  return next;
}

function applyStep(state: MineOfOblivion2State, seat: Seat, tile: TileId): MineOfOblivion2State {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return state;
  if (!isEightDirectionAdjacent(state.players[seat].position, tile)) return state;
  if (state.players[otherSeat(seat)].position === tile) return state; // 동일 칸 진입 금지

  const afterArrival = resolveArrivalCore(state, seat, tile);
  const { state: afterBombs, events } = tickTimeBombs(afterArrival);
  const withEvents = { ...afterBombs, lastBombEvents: events };
  return finalizeAction(withEvents, seat, events);
}

/**
 * 원격 수동 격발("즉시 격발", module doc #5-7) — `seat`'s own turn only, on
 * one of their own still-armed bombs. A FREE action: no phase change, no
 * `activeSeat` change, no `actionsPlayed` bump — it only clamps that bomb's
 * `remaining` down to `TIME_BOMB_MANUAL_TRIGGER_DELAY`, so it goes on to
 * detonate through the ordinary `tickTimeBombs` path on a later move exactly
 * like a naturally-expired fuse. No-op if the bomb isn't `seat`'s own, isn't
 * still armed, or `canManuallyDetonate` is already false.
 */
function applyDetonateBomb(state: MineOfOblivion2State, seat: Seat, bombId: string): MineOfOblivion2State {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return state;
  const bomb = state.timeBombs.find((b) => b.id === bombId);
  if (!bomb || bomb.seat !== seat || !canManuallyDetonate(bomb)) return state;
  return {
    ...state,
    timeBombs: state.timeBombs.map((b) => (b.id === bombId ? { ...b, remaining: TIME_BOMB_MANUAL_TRIGGER_DELAY, manuallyTriggered: true } : b)),
  };
}

function applyReadyNextRound(state: MineOfOblivion2State): MineOfOblivion2State {
  if (state.phase !== "REVEAL_STEP") return state;
  if (state.pendingGameOver) {
    return { ...state, phase: "GAME_OVER" };
  }
  return { ...state, phase: "PLAYER_MOVE", activeSeat: otherSeat(state.activeSeat) };
}

/** Single entry point applying any `EngineAction` to a state — illegal actions are no-ops. */
export function applyAction(state: MineOfOblivion2State, action: EngineAction): MineOfOblivion2State {
  switch (action.type) {
    case "SET_SETUP":
      return applySetSetup(state, action.seat, action.mines, action.bombs);
    case "SELECT_TILE_STEP":
      return applyStep(state, action.seat, action.tile);
    case "DETONATE_BOMB":
      return applyDetonateBomb(state, action.seat, action.bombId);
    case "READY_NEXT_ROUND":
      return applyReadyNextRound(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// UI helpers — what a fair viewer of `seat` may see.
// ---------------------------------------------------------------------------

export function ownArmedMines(state: MineOfOblivion2State, seat: Seat): TileId[] {
  return state.mines[seat].filter((t) => !state.disarmed[seat].includes(t));
}

export function publiclyDisarmedTiles(state: MineOfOblivion2State): TileId[] {
  return [...state.disarmed.p1, ...state.disarmed.p2];
}

/** `seat`'s own still-armed time bombs — only these carry a visible ticking countdown to `seat`'s own viewer (module doc: opponent's bombs stay fully secret until they detonate). */
export function ownArmedTimeBombs(state: MineOfOblivion2State, seat: Seat): TimeBomb[] {
  return state.timeBombs.filter((b) => b.seat === seat && b.status === "armed");
}

/** Every tile ever hit by an exploded bomb's blast — public forever once it happens, purely for a "this ground has already been scorched" UI cue (bombs don't leave a "disarmed = now safe" tile marker the way mines do, since the tile itself never held anything visible). */
export function publiclyExplodedBombTiles(state: MineOfOblivion2State): TileId[] {
  return state.timeBombs.filter((b) => b.status === "exploded").map((b) => b.tile);
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Information fairness: the bot
// never reads the opponent's un-triggered mines or bombs — only its own
// (`ownArmedMines`/`ownArmedTimeBombs`) and whatever's already public.
// ---------------------------------------------------------------------------

type ScorableMove = Extract<EngineAction, { type: "SELECT_TILE_STEP" }>;

export function getValidMoves(state: MineOfOblivion2State, seat: Seat): ScorableMove[] {
  if (state.phase !== "PLAYER_MOVE" || state.activeSeat !== seat) return [];
  return eightDirectionNeighbors(state.players[seat].position)
    .filter((tile) => state.players[otherSeat(seat)].position !== tile)
    .map((tile) => ({ type: "SELECT_TILE_STEP", seat, tile }));
}

export function scoreMove(state: MineOfOblivion2State, seat: Seat, move: ScorableMove, tier: BotTier): number {
  if (tier === "novice") return 0;

  const { tile } = move;
  if (ownArmedMines(state, seat).includes(tile)) return -1000; // never knowingly step on a known regular mine

  const remainingTreasures = state.treasures.filter((t) => t.holder === null).map((t) => t.tileId);
  const nearestTreasureDist = remainingTreasures.length === 0 ? 0 : Math.min(...remainingTreasures.map((t) => chebyshevDistance(tile, t)));

  let score = 0;
  if (remainingTreasures.includes(tile)) {
    const prospectiveOrder = state.treasureClaimCount + 1;
    const prospectivePoints = prospectiveOrder === 1 ? 10 : prospectiveOrder === 2 ? 15 : 20;
    score += 80 + prospectivePoints;
  }
  score += (GRID_SIZE - nearestTreasureDist) * 3;
  if (!state.visitedTiles.includes(tile)) score += 4;
  else score -= 2;

  if (tier === "expert") {
    const hotNeighbors = eightDirectionNeighbors(tile).filter((n) => (state.revealedCounts[n] ?? 0) >= 3);
    if (hotNeighbors.length > 0 && !remainingTreasures.includes(tile)) score -= hotNeighbors.length * 2;
  }

  // Self-preservation: lean away from a tile inside one of *our own*
  // about-to-detonate bombs' 3×3 zone (remaining <= 1 — i.e. it fires on the
  // very next global tick, possibly even this same move once the opponent
  // replies). We can't see the opponent's bombs at all (info fairness), so
  // this is necessarily a partial defense — it only ever protects against
  // bombs the bot itself planted. (`tier === "novice"` already returned 0
  // above, so every path reaching here is `core`/`expert`.)
  const soonBombZones = ownArmedTimeBombs(state, seat)
    .filter((b) => b.remaining <= 1)
    .flatMap((b) => blastZone(b.tile));
  if (soonBombZones.includes(tile)) score -= 12;

  return score;
}

/** Heuristic mine placement for the bot's `SETUP_MINE` submission — reused for both hazard types (regular mines and time bomb tiles), since both share the same legality/weighting logic; only the resulting 11-tile pool is then split between the two. */
function chooseBotHazardTiles(seat: Seat, level: BotLevel, count: number, exclude: Set<TileId>, rng: () => number): TileId[] {
  const candidates = ALL_TILES.filter((t) => canPlaceHazard(seat, t) && !exclude.has(t));
  const tier = botTier(level);
  const weight = (tile: TileId): number => {
    if (tier === "novice") return 1;
    const distToTreasure = Math.min(...TREASURE_TILES.map((t) => chebyshevDistance(tile, t)));
    const distToOwnStart = chebyshevDistance(tile, START_TILE[seat]);
    return 1 + Math.max(0, 3 - Math.abs(distToTreasure - 2)) + (tier === "expert" ? Math.max(0, distToOwnStart - 1) * 0.2 : 0);
  };
  const pool = candidates.map((tile) => ({ tile, weight: weight(tile) }));
  const chosen: TileId[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
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

/** Full secret `SET_SETUP` submission for a bot seat — `MINES_PER_PLAYER` regular mines plus `TIME_BOMBS_PER_PLAYER` time bombs (disjoint tile sets, module doc #4), each bomb's fuse chosen with a light tier-based bias toward the mid-length option (4) for a more balanced/less predictable bot. */
export function chooseBotSetup(seat: Seat, level: BotLevel, rng: () => number = Math.random): { mines: TileId[]; bombs: BombPlacement[] } {
  const mines = chooseBotHazardTiles(seat, level, MINES_PER_PLAYER, new Set(), rng);
  const bombTiles = chooseBotHazardTiles(seat, level, TIME_BOMBS_PER_PLAYER, new Set(mines), rng);
  const tier = botTier(level);
  const bombs: BombPlacement[] = bombTiles.map((tile) => {
    let fuseTurns: TimeBombFuse;
    if (tier === "novice") {
      fuseTurns = TIME_BOMB_FUSE_OPTIONS[Math.floor(rng() * TIME_BOMB_FUSE_OPTIONS.length)];
    } else {
      // Weighted toward 4 (mid) for intermediate/expert — avoids the very
      // predictable "always shortest fuse" or "always longest fuse" pattern.
      const roll = rng();
      fuseTurns = roll < 0.25 ? 3 : roll < 0.75 ? 4 : 5;
    }
    return { tile, fuseTurns };
  });
  return { mines, bombs };
}

export function chooseBotAction(state: MineOfOblivion2State, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase === "SETUP_MINE") {
    if (state.mineReady[seat]) return null;
    const { mines, bombs } = chooseBotSetup(seat, level, rng);
    return { type: "SET_SETUP", seat, mines, bombs };
  }
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
