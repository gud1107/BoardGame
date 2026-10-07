/**
 * 낙서 결투 (Ink Duel) — pure reducer (ARCHITECTURE.md §1).
 *
 * 2~4 players take turns on a side-view arena. Each turn a player gets 100 ink
 * and either doodles a WEAPON (on a square pad — its geometry becomes the
 * weapon's stats via analyze.ts, and the doodle itself flies as the hitbox) or
 * draws an ink WALL straight onto the arena. Last one standing wins; after
 * MAX_ROUNDS the highest HP wins.
 *
 * The whole flight is resolved inside `applyAction` (physics.ts), and the
 * recorded frames are kept on `state.lastEvent` so every client replays the
 * same animation — lockstep-safe because the simulation only uses
 * deterministic arithmetic and a seed derived from `state.seed`.
 */

import { seededRng, shuffle } from "@/lib/rng";
import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  analyzeWeapon,
  dsin,
  INK_PER_TURN,
  PAD_SIZE,
  strokesValid,
  totalInk,
  type InkColor,
  type Stroke,
  type WeaponStats,
} from "./analyze";
import {
  carveCrater,
  COL_W,
  PLAYER_R,
  simulateFlight,
  surfaceY,
  TERRAIN_COLS,
  wallTouchesCircle,
  WORLD_H,
  WORLD_W,
  type Body,
  type Wall,
} from "./physics";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const START_HP = 100;
export const MAX_ROUNDS = 10;
export const MIN_INK = 6;
export const FROZEN_INK = 65;
/** Wall points must stay within this horizontal distance of the builder… */
export const WALL_RANGE = 230;
/** …and this far from every other living player (no entombing). */
export const WALL_KEEPOUT = 40;
/** Max walk per turn (px) and its ink price — a full 80px walk costs 20 ink. */
export const MAX_MOVE = 80;
export const MOVE_INK_PER_PX = 0.25;
/** Can't walk closer than this to another living player… */
const MOVE_PERSONAL_SPACE = 36;
/** …or through a wall point lower than this above the ground. */
const WALL_BLOCK_HEIGHT = 40;
const BURN_DMG = 6;
const POISON_DMG = 4;
const CHAIN_RANGE = 240;
const DIRECT_BONUS = 1.2;
const CRIT_MUL = 1.6;
const SELF_DMG_MUL = 0.5;

export interface Player {
  seat: SeatIndex;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  burn: number;
  poison: number;
  frozen: boolean;
}

export interface HitRecord {
  seat: SeatIndex;
  dmg: number;
  direct: boolean;
  chain: boolean;
}

export interface DotRecord {
  seat: SeatIndex;
  dmg: number;
  kind: "burn" | "poison";
}

export type InkEvent =
  | {
      kind: "shot";
      id: number;
      seat: SeatIndex;
      stats: WeaponStats;
      angle: number;
      power: number;
      frames: number[];
      impact: { x: number; y: number } | null;
      crit: boolean;
      hits: HitRecord[];
      /** Flat x,y of the lightning chain jumps (starting at the impact point). */
      chainPath: number[];
      wallsBroken: number[];
      craterRadius: number;
      hpBefore: number[];
      killed: SeatIndex[];
      dots: DotRecord[];
      move?: MoveRecord;
    }
  | { kind: "wall"; id: number; seat: SeatIndex; wallId: number; dots: DotRecord[]; move?: MoveRecord }
  | { kind: "pass"; id: number; seat: SeatIndex; dots: DotRecord[]; move?: MoveRecord };

/** The acting player walked from `from` to `to` (x) before acting this turn. */
export interface MoveRecord {
  from: number;
  to: number;
}

export interface InkDuelState {
  seed: number;
  playerCount: number;
  players: Player[];
  terrain: number[];
  walls: Wall[];
  nextWallId: number;
  phase: "playing" | "gameOver";
  turnSeat: SeatIndex;
  /** Counts every turn taken (starts at 0). */
  turnNo: number;
  round: number;
  wind: number;
  inkBudget: number;
  /** Seats in the order they were eliminated (earliest first); same-event deaths share one entry group. */
  deathGroups: SeatIndex[][];
  lastEvent: InkEvent | null;
  damageDealt: number[];
  bestHit: number[];
  seq: number;
}

/**
 * Every action may carry `move`: a signed horizontal walk (px) taken before
 * acting. Walking costs ink (MOVE_INK_PER_PX), so it competes with the doodle.
 */
export type EngineAction =
  | { type: "fire"; seat: SeatIndex; strokes: Stroke[]; angle: number; power: number; move?: number }
  | { type: "wall"; seat: SeatIndex; strokes: Stroke[]; move?: number }
  | { type: "pass"; seat: SeatIndex; move?: number };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function windFor(seed: number, turnNo: number): number {
  const rng = seededRng((seed + turnNo * 7919) | 0);
  return Math.round((rng() * 2 - 1) * 40) / 1000;
}

function generateTerrain(rng: () => number): number[] {
  const f1 = 0.004 + rng() * 0.004;
  const f2 = 0.012 + rng() * 0.01;
  const f3 = 0.03 + rng() * 0.02;
  const p1 = rng() * 6;
  const p2 = rng() * 6;
  const p3 = rng() * 6;
  const out: number[] = [];
  for (let i = 0; i < TERRAIN_COLS; i++) {
    const x = i * COL_W;
    const h = 400 + 45 * dsin(x * f1 + p1) + 24 * dsin(x * f2 + p2) + 8 * dsin(x * f3 + p3);
    out.push(Math.round(Math.max(300, Math.min(480, h)) * 10) / 10);
  }
  return out;
}

export function startGame(playerCount: number, seed: number): InkDuelState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const rng = seededRng(seed);
  let terrain = generateTerrain(rng);
  const order = shuffle(
    Array.from({ length: count }, (_, i) => i),
    rng,
  );
  const xs: number[] = new Array(count);
  order.forEach((seat, slot) => {
    const margin = 70;
    const span = WORLD_W - margin * 2;
    xs[seat] = Math.round(margin + (span * (slot + 0.5)) / count + (rng() * 2 - 1) * 24);
  });
  // Flatten a small pad under every spawn.
  terrain = terrain.slice();
  for (const x of xs) {
    const base = surfaceY(terrain, x);
    for (let i = 0; i < terrain.length; i++) {
      const dx = Math.abs(i * COL_W - x);
      if (dx <= 24) terrain[i] = base;
      else if (dx <= 48) terrain[i] = Math.round((terrain[i] + (base - terrain[i]) * (1 - (dx - 24) / 24)) * 10) / 10;
    }
  }
  const players: Player[] = xs.map((x, seat) => ({
    seat,
    x,
    y: surfaceY(terrain, x),
    hp: START_HP,
    alive: true,
    burn: 0,
    poison: 0,
    frozen: false,
  }));
  const first = Math.floor(rng() * count);
  return {
    seed,
    playerCount: count,
    players,
    terrain,
    walls: [],
    nextWallId: 1,
    phase: "playing",
    turnSeat: first,
    turnNo: 0,
    round: 1,
    wind: windFor(seed, 0),
    inkBudget: INK_PER_TURN,
    deathGroups: [],
    lastEvent: null,
    damageDealt: new Array(count).fill(0),
    bestHit: new Array(count).fill(0),
    seq: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentActor(state: InkDuelState): SeatIndex | null {
  return state.phase === "playing" ? state.turnSeat : null;
}

export function isStateSyncStale(current: InkDuelState | null, synced: InkDuelState): boolean {
  return current !== null && synced.seq < current.seq;
}

export function aliveSeats(state: InkDuelState): SeatIndex[] {
  return state.players.filter((p) => p.alive).map((p) => p.seat);
}

export function computeRankings(state: InkDuelState): { seat: SeatIndex; rank: number }[] {
  const out: { seat: SeatIndex; rank: number }[] = [];
  const alive = state.players.filter((p) => p.alive).sort((a, b) => b.hp - a.hp);
  let rank = 1;
  for (let i = 0; i < alive.length; i++) {
    if (i > 0 && alive[i].hp < alive[i - 1].hp) rank = i + 1;
    out.push({ seat: alive[i].seat, rank });
  }
  let next = alive.length + 1;
  for (let g = state.deathGroups.length - 1; g >= 0; g--) {
    const group = state.deathGroups[g];
    for (const seat of group) out.push({ seat, rank: next });
    next += group.length;
  }
  return out;
}

export function winnerSeats(state: InkDuelState): SeatIndex[] {
  return computeRankings(state)
    .filter((r) => r.rank === 1)
    .map((r) => r.seat);
}

function bodies(state: InkDuelState): Body[] {
  return state.players.map((p) => ({ seat: p.seat, x: p.x, y: p.y, alive: p.alive }));
}

/** Wall placement rule shared by the reducer and the UI's live preview. */
export function wallPlacementError(state: InkDuelState, seat: SeatIndex, strokes: readonly Stroke[]): string | null {
  const me = state.players[seat];
  for (const s of strokes) {
    for (let i = 0; i < s.p.length; i += 2) {
      const x = s.p[i];
      const y = s.p[i + 1];
      if (Math.abs(x - me.x) > WALL_RANGE) return "내 위치에서 너무 멀어요";
      if (y >= surfaceY(state.terrain, x) + 4) return "땅속에는 그릴 수 없어요";
      for (const p of state.players) {
        if (!p.alive || p.seat === seat) continue;
        const dx = x - p.x;
        const dy = y - (p.y - PLAYER_R);
        if (dx * dx + dy * dy < WALL_KEEPOUT * WALL_KEEPOUT) return "상대 바로 옆에는 그릴 수 없어요";
      }
    }
  }
  return null;
}

/**
 * Where a walk of `dx` actually ends: clamped to the arena, stopped short of
 * other living players and of walls standing on the ground in the way.
 */
export function resolveMove(state: InkDuelState, seat: SeatIndex, dx: number): number {
  const me = state.players[seat];
  if (dx === 0) return me.x;
  const dir = dx > 0 ? 1 : -1;
  let to = Math.max(20, Math.min(WORLD_W - 20, me.x + dx));
  for (const p of state.players) {
    if (!p.alive || p.seat === seat) continue;
    if (dir > 0 && p.x > me.x && p.x - MOVE_PERSONAL_SPACE < to) to = p.x - MOVE_PERSONAL_SPACE;
    if (dir < 0 && p.x < me.x && p.x + MOVE_PERSONAL_SPACE > to) to = p.x + MOVE_PERSONAL_SPACE;
  }
  for (const w of state.walls) {
    for (const st of w.strokes) {
      for (let i = 0; i < st.length; i += 2) {
        const x = st[i];
        if (st[i + 1] < surfaceY(state.terrain, x) - WALL_BLOCK_HEIGHT) continue;
        if (dir > 0 && x > me.x && x - 10 < to) to = x - 10;
        if (dir < 0 && x < me.x && x + 10 > to) to = x + 10;
      }
    }
  }
  to = dir > 0 ? Math.max(me.x, to) : Math.min(me.x, to);
  return Math.round(to);
}

export function moveInk(from: number, to: number): number {
  return Math.abs(to - from) * MOVE_INK_PER_PX;
}

/** State after `seat` walks `dx` (ink deducted). Returns null if the walk is illegal. */
export function applyMove(state: InkDuelState, seat: SeatIndex, dx: number): InkDuelState | null {
  if (!Number.isInteger(dx) || Math.abs(dx) > MAX_MOVE) return null;
  if (dx === 0) return state;
  const me = state.players[seat];
  const to = resolveMove(state, seat, dx);
  const cost = moveInk(me.x, to);
  if (cost > state.inkBudget) return null;
  const players = state.players.map((p) => (p.seat === seat ? { ...p, x: to, y: surfaceY(state.terrain, to) } : p));
  return { ...state, players, inkBudget: Math.round((state.inkBudget - cost) * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function validInk(state: InkDuelState, strokes: readonly Stroke[]): boolean {
  const ink = totalInk(strokes);
  return ink >= MIN_INK && ink <= state.inkBudget + 0.5;
}

export function applyAction(state: InkDuelState, action: EngineAction): InkDuelState {
  if (state.phase !== "playing" || action.seat !== state.turnSeat) return state;
  const me = state.players[action.seat];
  if (!me || !me.alive) return state;
  const dx = action.move ?? 0;
  if (dx === 0) return applyActionInPlace(state, action);
  const moved = applyMove(state, action.seat, dx);
  if (!moved) return state;
  const next = applyActionInPlace(moved, action);
  if (next === moved || !next.lastEvent) return state;
  const move: MoveRecord = { from: me.x, to: moved.players[action.seat].x };
  return { ...next, lastEvent: { ...next.lastEvent, move } };
}

function applyActionInPlace(state: InkDuelState, action: EngineAction): InkDuelState {
  if (action.type === "pass") {
    return endTurn(state, { kind: "pass", id: state.seq + 1, seat: action.seat, dots: [] }, state.players, state.terrain, state.walls);
  }

  if (action.type === "wall") {
    if (!strokesValid(action.strokes, WORLD_W, WORLD_H) || !validInk(state, action.strokes)) return state;
    if (wallPlacementError(state, action.seat, action.strokes)) return state;
    const ink = totalInk(action.strokes);
    const hp = Math.round(ink * 10) / 10;
    const colorInk = [0, 0, 0, 0, 0];
    for (const s of action.strokes) colorInk[s.c] += s.p.length;
    let color = 0;
    for (let i = 1; i < colorInk.length; i++) if (colorInk[i] > colorInk[color]) color = i;
    const wall: Wall = { id: state.nextWallId, owner: action.seat, strokes: action.strokes.map((s) => s.p.slice()), hp, maxHp: hp, color };
    const next = { ...state, walls: [...state.walls, wall], nextWallId: state.nextWallId + 1 };
    return endTurn(next, { kind: "wall", id: state.seq + 1, seat: action.seat, wallId: wall.id, dots: [] }, next.players, next.terrain, next.walls);
  }

  // fire
  if (!strokesValid(action.strokes, PAD_SIZE, PAD_SIZE) || !validInk(state, action.strokes)) return state;
  if (!Number.isInteger(action.angle) || action.angle < 0 || action.angle > 180) return state;
  if (!Number.isInteger(action.power) || action.power < 10 || action.power > 100) return state;
  return resolveShot(state, action.seat, analyzeWeapon(action.strokes), action.angle, action.power);
}

interface ShotOutcome {
  players: Player[];
  terrain: number[];
  walls: Wall[];
  event: Extract<InkEvent, { kind: "shot" }>;
}

/** Pure shot resolution, also used by the bot to evaluate candidates. */
export function computeShot(state: InkDuelState, seat: SeatIndex, stats: WeaponStats, angle: number, power: number): ShotOutcome {
  const shooter = state.players[seat];
  const flight = simulateFlight(state.terrain, bodies(state), state.walls, { seat, x: shooter.x, y: shooter.y, alive: true }, stats, angle, power, state.wind);
  const hpBefore = state.players.map((p) => p.hp);
  let walls = state.walls.map((w) => ({ ...w }));
  for (const id of flight.pierced) {
    const w = walls.find((x) => x.id === id);
    if (w) w.hp -= 25;
  }
  const players = state.players.map((p) => ({ ...p }));
  let terrain = state.terrain;
  const hits: HitRecord[] = [];
  const chainPath: number[] = [];
  let crit = false;
  let craterRadius = 0;

  if (flight.impact) {
    const { x: ix, y: iy } = flight.impact;
    const rng = seededRng((state.seed + (state.seq + 1) * 1013) | 0);
    crit = rng() < stats.critChance;
    const mul = crit ? CRIT_MUL : 1;
    const blast = stats.blastRadius;
    for (const p of players) {
      if (!p.alive) continue;
      let dmg = 0;
      const direct = flight.directSeat === p.seat;
      if (direct) dmg = stats.damage * DIRECT_BONUS;
      else if (blast > 0) {
        const dx = p.x - ix;
        const dy = p.y - PLAYER_R - iy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const reach = blast + PLAYER_R;
        if (d < reach) dmg = stats.damage * (1 - (0.6 * d) / reach);
      }
      if (dmg <= 0) continue;
      if (p.seat === seat) dmg *= SELF_DMG_MUL;
      hits.push({ seat: p.seat, dmg: Math.round(dmg * mul), direct, chain: false });
    }
    // Lightning chains: jump to the nearest living, not-yet-hit enemy.
    if (stats.chains > 0) {
      let lx = ix;
      let ly = iy;
      chainPath.push(Math.round(lx), Math.round(ly));
      for (let k = 0; k < stats.chains; k++) {
        let best: Player | null = null;
        let bestD = CHAIN_RANGE * CHAIN_RANGE;
        for (const p of players) {
          if (!p.alive || p.seat === seat || hits.some((h) => h.seat === p.seat)) continue;
          const dx = p.x - lx;
          const dy = p.y - PLAYER_R - ly;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = p;
          }
        }
        if (!best) break;
        hits.push({ seat: best.seat, dmg: Math.round(stats.damage * 0.5 * mul), direct: false, chain: true });
        lx = best.x;
        ly = best.y - PLAYER_R;
        chainPath.push(Math.round(lx), Math.round(ly));
      }
    }
    // Walls caught in the blast / directly hit.
    for (const w of walls) {
      if (w.hp <= 0) continue;
      if (flight.wallStop === w.id) w.hp -= stats.damage * 1.5;
      else if (blast > 0 && wallTouchesCircle(w, ix, iy, blast)) w.hp -= stats.damage;
    }
    craterRadius = stats.kind === "bomb" ? stats.blastRadius * 0.85 : stats.kind === "club" ? stats.blastRadius * 0.5 : stats.kind === "lightning" ? 10 : 0;
    if (craterRadius > 0) terrain = carveCrater(terrain, ix, iy, craterRadius);
  }

  for (const h of hits) {
    const p = players[h.seat];
    p.hp = Math.max(0, p.hp - h.dmg);
    if (stats.element === "fire") p.burn = 2;
    else if (stats.element === "ice") p.frozen = true;
    else if (stats.element === "poison") p.poison = 3;
  }
  const wallsBroken = walls.filter((w) => w.hp <= 0 && state.walls.some((o) => o.id === w.id && o.hp > 0)).map((w) => w.id);
  walls = walls.filter((w) => w.hp > 0).map((w) => ({ ...w, hp: Math.round(w.hp * 10) / 10 }));
  for (const p of players) p.y = surfaceY(terrain, p.x);
  const killed: SeatIndex[] = [];
  for (const p of players) {
    if (p.alive && p.hp <= 0) {
      p.alive = false;
      killed.push(p.seat);
    }
  }
  return {
    players,
    terrain,
    walls,
    event: {
      kind: "shot",
      id: state.seq + 1,
      seat,
      stats,
      angle,
      power,
      frames: flight.frames,
      impact: flight.impact ? { x: Math.round(flight.impact.x * 10) / 10, y: Math.round(flight.impact.y * 10) / 10 } : null,
      crit,
      hits,
      chainPath,
      wallsBroken,
      craterRadius,
      hpBefore,
      killed,
      dots: [],
    },
  };
}

function resolveShot(state: InkDuelState, seat: SeatIndex, stats: WeaponStats, angle: number, power: number): InkDuelState {
  const out = computeShot(state, seat, stats, angle, power);
  const damageDealt = state.damageDealt.slice();
  const bestHit = state.bestHit.slice();
  for (const h of out.event.hits) {
    if (h.seat === seat) continue;
    damageDealt[seat] += h.dmg;
    if (h.dmg > bestHit[seat]) bestHit[seat] = h.dmg;
  }
  const deathGroups = out.event.killed.length > 0 ? [...state.deathGroups, out.event.killed] : state.deathGroups;
  return endTurn({ ...state, damageDealt, bestHit, deathGroups }, out.event, out.players, out.terrain, out.walls);
}

/** Advances to the next living seat, applying start-of-turn burn/poison (which can kill and skip). */
function endTurn(state: InkDuelState, event: InkEvent, players0: Player[], terrain: number[], walls: Wall[]): InkDuelState {
  const players = players0.map((p) => ({ ...p }));
  let deathGroups = state.deathGroups;
  const dots: DotRecord[] = [];
  let seat = state.turnSeat;
  let turnNo = state.turnNo;
  let round = state.round;
  const n = state.playerCount;
  // The player who just acted spent their frozen debuff this turn.
  if (players[seat]) players[seat].frozen = false;

  const finish = (phase: "playing" | "gameOver"): InkDuelState => ({
    ...state,
    players,
    terrain,
    walls,
    deathGroups,
    phase,
    turnSeat: seat,
    turnNo,
    round,
    wind: windFor(state.seed, turnNo),
    inkBudget: phase === "playing" && players[seat]?.frozen ? FROZEN_INK : INK_PER_TURN,
    lastEvent: { ...event, dots },
    seq: state.seq + 1,
  });

  for (let guard = 0; guard < n * 3; guard++) {
    if (players.filter((p) => p.alive).length <= 1) return finish("gameOver");
    // Next living seat.
    let next = seat;
    for (let k = 1; k <= n; k++) {
      const cand = (seat + k) % n;
      if (players[cand].alive) {
        next = cand;
        break;
      }
    }
    turnNo += 1;
    round = Math.floor(turnNo / n) + 1;
    seat = next;
    if (round > MAX_ROUNDS) return finish("gameOver");
    const p = players[seat];
    let tick = 0;
    if (p.burn > 0) {
      dots.push({ seat, dmg: BURN_DMG, kind: "burn" });
      tick += BURN_DMG;
      p.burn -= 1;
    }
    if (p.poison > 0) {
      dots.push({ seat, dmg: POISON_DMG, kind: "poison" });
      tick += POISON_DMG;
      p.poison -= 1;
    }
    if (tick > 0) {
      p.hp = Math.max(0, p.hp - tick);
      if (p.hp <= 0) {
        p.alive = false;
        deathGroups = [...deathGroups, [seat]];
        continue;
      }
    }
    return finish("playing");
  }
  return finish("gameOver");
}

// ---------------------------------------------------------------------------
// Bots (ARCHITECTURE.md §7)
// ---------------------------------------------------------------------------

type Template = "spear" | "bomb" | "lightning" | "club";

/** Procedurally "draws" a doodle of one archetype on the pad, fitting `budget` ink. */
export function botDoodle(template: Template, color: InkColor, budget: number, rng: () => number): Stroke[] {
  const j = (v: number) => Math.round(Math.max(0, Math.min(PAD_SIZE, v + (rng() * 2 - 1) * 2)));
  const pts: number[] = [];
  const fit = (scale: number): Stroke[] => {
    const p: number[] = [];
    for (let i = 0; i < pts.length; i += 2) p.push(j(100 + (pts[i] - 100) * scale), j(100 + (pts[i + 1] - 100) * scale));
    return [{ c: color, p }];
  };
  switch (template) {
    case "spear":
      for (let t = 0; t <= 16; t++) pts.push(20 + t * 10, 100 + (t % 2) * 2);
      break;
    case "bomb": {
      const r = 45 + rng() * 25;
      for (let t = 0; t <= 24; t++) {
        const a = (t / 24) * 6.283185307179586;
        pts.push(100 + r * dsin(a + 1.5707963267948966), 100 + r * dsin(a));
      }
      break;
    }
    case "lightning":
      for (let t = 0; t <= 8; t++) pts.push(30 + t * 18, t % 2 === 0 ? 70 : 130);
      break;
    default:
      for (let t = 0; t <= 14; t++) {
        const a = t * 1.9;
        const r = 20 + (t % 3) * 14;
        pts.push(100 + r * dsin(a + 1.5707963267948966), 100 + r * dsin(a));
      }
  }
  let scale = 1;
  let strokes = fit(scale);
  while (totalInk(strokes) > budget - 1 && scale > 0.3) {
    scale -= 0.08;
    strokes = fit(scale);
  }
  return strokes;
}

const TEMPLATES: readonly Template[] = ["spear", "bomb", "lightning", "club"];

/**
 * Situational preference for each weapon kind, added on top of the simulated
 * damage. Without it bombs win almost every comparison (their splash forgives
 * aim), so the bot looked one-note. Spears punch through enemy walls,
 * lightning shines when enemies stand close together, bombs break walls.
 */
function kindBonus(state: InkDuelState, seat: SeatIndex, t: Template): number {
  const enemies = state.players.filter((p) => p.alive && p.seat !== seat);
  const enemyWalls = state.walls.some((w) => w.owner !== seat && w.hp > 0);
  switch (t) {
    case "spear":
      return enemyWalls ? 9 : 3;
    case "lightning": {
      let pairs = 0;
      for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) if (Math.abs(enemies[i].x - enemies[j].x) < CHAIN_RANGE) pairs++;
      return 2 + pairs * 6;
    }
    case "bomb":
      return enemyWalls ? 3 : 0;
    default:
      return 1;
  }
}

/** Ink color for a bot doodle: shock for lightning half the time, otherwise skip elements the target already suffers. */
function botColor(state: InkDuelState, seat: SeatIndex, t: Template, rng: () => number): InkColor {
  if (t === "lightning" && rng() < 0.5) return 4;
  const enemies = state.players.filter((p) => p.alive && p.seat !== seat);
  const options: InkColor[] = [0, 1, 2, 3, 4].filter((c) => {
    if (c === 1) return !enemies.every((e) => e.burn > 0);
    if (c === 3) return !enemies.every((e) => e.poison > 0);
    return true;
  }) as InkColor[];
  return options[Math.floor(rng() * options.length)];
}

/** A representative set of legal moves (doodles are continuous, so this samples rather than enumerates). */
export function getValidMoves(state: InkDuelState, seat: SeatIndex): EngineAction[] {
  if (currentActor(state) !== seat) return [];
  const rng = seededRng((state.seed + state.seq * 31) | 0);
  const moves: EngineAction[] = [{ type: "pass", seat }];
  for (const t of ["spear", "bomb", "lightning", "club"] as Template[]) {
    const strokes = botDoodle(t, 0, state.inkBudget, rng);
    for (const angle of [30, 60, 90, 120, 150]) moves.push({ type: "fire", seat, strokes, angle, power: 60 });
  }
  return moves;
}

function scoreOutcome(state: InkDuelState, seat: SeatIndex, out: ShotOutcome): number {
  let score = 0;
  for (const h of out.event.hits) {
    if (h.seat === seat) score -= h.dmg * 1.6;
    else score += h.dmg;
  }
  for (const k of out.event.killed) score += k === seat ? -200 : 40;
  return score;
}

/** Wall the bot draws: a thick arc between itself and the closest enemy. */
function botWall(state: InkDuelState, seat: SeatIndex, rng: () => number): Stroke[] | null {
  const me = state.players[seat];
  let target: Player | null = null;
  for (const p of state.players) {
    if (!p.alive || p.seat === seat) continue;
    if (!target || Math.abs(p.x - me.x) < Math.abs(target.x - me.x)) target = p;
  }
  if (!target) return null;
  const dir = target.x > me.x ? 1 : -1;
  const x = Math.round(me.x + dir * (46 + rng() * 14));
  const ground = surfaceY(state.terrain, x);
  const strokes: Stroke[] = [];
  for (let k = 0; k < 3; k++) {
    const p: number[] = [];
    const xx = x + dir * k * 5;
    for (let y = Math.round(ground - 4); y >= ground - 95; y -= 8) p.push(Math.max(0, Math.min(WORLD_W, xx + Math.round((rng() * 2 - 1) * 2))), Math.max(0, Math.round(y)));
    strokes.push({ c: 0, p });
  }
  while (strokes.length > 0 && totalInk(strokes) > state.inkBudget - 1) strokes.pop();
  if (strokes.length === 0) return null;
  return wallPlacementError(state, seat, strokes) ? null : strokes;
}

export function chooseBotAction(state: InkDuelState, seat: SeatIndex, level: BotLevel = 5, rng: () => number = Math.random): EngineAction | null {
  if (currentActor(state) !== seat) return null;
  const me = state.players[seat];
  const enemies = state.players.filter((p) => p.alive && p.seat !== seat);
  if (enemies.length === 0) return { type: "pass", seat };

  // Defensive wall when hurt and unprotected.
  const hasWall = state.walls.some((w) => w.owner === seat && w.hp > 15);
  if (level >= 3 && !hasWall && me.hp <= 55 && rng() < 0.3) {
    const wall = botWall(state, seat, rng);
    if (wall) return { type: "wall", seat, strokes: wall };
  }

  // Per-turn "mood": a random lean toward each weapon kind, so equally good
  // options don't always resolve to the same kind.
  const mood: Record<Template, number> = { spear: rng() * 8, bomb: rng() * 8, lightning: rng() * 8, club: rng() * 8 };
  // Walk options: stronger bots reposition for a better angle (walking eats ink).
  const walks = level >= 4 ? [0, -60, -30, 30, 60] : [0];
  const scored: { move: Extract<EngineAction, { type: "fire" }>; score: number }[] = [];
  const randomPool: { action: Extract<EngineAction, { type: "fire" }>; s: InkDuelState }[] = [];
  for (const walk of walks) {
    const s = applyMove(state, seat, walk);
    if (!s || (walk !== 0 && s.players[seat].x === me.x)) continue;
    const self = s.players[seat];
    const bodyList = bodies(s);
    for (const t of TEMPLATES) {
      const strokes = botDoodle(t, botColor(s, seat, t, rng), s.inkBudget, rng);
      if (totalInk(strokes) < MIN_INK) continue;
      const stats = analyzeWeapon(strokes);
      const quick: { action: Extract<EngineAction, { type: "fire" }>; q: number }[] = [];
      for (let angle = 6; angle <= 174; angle += 5) {
        for (let power = 24; power <= 100; power += 6) {
          const f = simulateFlight(s.terrain, bodyList, s.walls, { seat, x: self.x, y: self.y, alive: true }, stats, angle, power, s.wind, true);
          if (!f.impact) continue;
          let q = 0;
          for (const e of enemies) {
            const dx = e.x - f.impact.x;
            const dy = e.y - PLAYER_R - f.impact.y;
            q += Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (stats.blastRadius + PLAYER_R + 40));
          }
          const sdx = self.x - f.impact.x;
          const sdy = self.y - f.impact.y;
          if (sdx * sdx + sdy * sdy < (stats.blastRadius + 30) * (stats.blastRadius + 30)) q -= 2;
          const action = { type: "fire" as const, seat, strokes, angle, power, ...(walk !== 0 ? { move: walk } : {}) };
          quick.push({ action, q });
          if (walk === 0 && rng() < 0.01) randomPool.push({ action, s });
        }
      }
      quick.sort((a, b) => b.q - a.q);
      const bonus = kindBonus(s, seat, t) + mood[t] - Math.abs(walk) * 0.04;
      for (const c of quick.slice(0, 3)) {
        const out = computeShot(s, seat, stats, c.action.angle, c.action.power);
        scored.push({ move: c.action, score: scoreOutcome(s, seat, out) + bonus });
      }
    }
  }
  if (scored.length === 0) return { type: "pass", seat };
  // A few random shots so pickByLevel's "mistake" path has something to grab.
  for (const r of randomPool.slice(0, 3)) {
    const out = computeShot(r.s, seat, analyzeWeapon(r.action.strokes), r.action.angle, r.action.power);
    scored.push({ move: r.action, score: scoreOutcome(r.s, seat, out) });
  }
  const picked = pickByLevel(scored, level, rng);
  // Human-ish aim wobble for lower levels.
  const wobble = Math.round((rng() * 2 - 1) * Math.max(0, 10 - level) * 1.2);
  const angle = Math.max(0, Math.min(180, picked.angle + wobble));
  return { ...picked, angle };
}
