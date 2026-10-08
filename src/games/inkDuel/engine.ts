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
  dcos,
  degToRad,
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
import { CHARACTER_COUNT, MAPS, type MapId } from "./maps";
import {
  activeStatuses,
  lifestealRate,
  BLIND_POWER_JITTER,
  SLOW_POWER_MUL_TURN,
  statusesForHit,
  TURN_DURATION,
  VULNERABLE_MUL,
  WEAKEN_MUL,
  type StatusId,
  type StatusMap,
} from "./status";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const START_HP = 100;
export const MAX_ROUNDS = 10;
export const MIN_INK = 6;
export const FROZEN_INK = 72;

/** 🛑 Stop-mode tuning the host picks in the waiting room. */
export interface StopRules {
  rounds: number;
  /** Ink handed out at the start of every turn. */
  ink: number;
  /** Per-turn timer (UI-side auto-submit; kept in state so every client shows the same clock). */
  turnSeconds: number;
}

export const DEFAULT_STOP_RULES: StopRules = { rounds: MAX_ROUNDS, ink: INK_PER_TURN, turnSeconds: 45 };

export const STOP_RULE_OPTIONS: { [K in keyof StopRules]: { label: string; title: string; options: { label: string; value: number }[] } } = {
  turnSeconds: { label: "⏱ 턴 시간", title: "한 사람이 그리고 쏘는 데 쓸 수 있는 시간", options: [{ label: "30초", value: 30 }, { label: "45초", value: 45 }, { label: "60초", value: 60 }] },
  rounds: { label: "🔁 라운드", title: "이 라운드가 끝나면 체력 높은 순", options: [{ label: "5", value: 5 }, { label: "10", value: MAX_ROUNDS }, { label: "15", value: 15 }] },
  ink: { label: "🖋️ 턴당 잉크", title: "매 턴 받는 잉크 (많을수록 크고 강한 무기)", options: [{ label: "70", value: 70 }, { label: "100", value: INK_PER_TURN }, { label: "130", value: 130 }] },
};

/** One-tap stop-mode presets. Ink 130 was checked by sim (2026-10-09): same damage cap, blast radius +18% at most. */
export const STOP_PRESETS: { id: string; emoji: string; name: string; desc: string; rules: StopRules }[] = [
  { id: "default", emoji: "🧘", name: "기본", desc: "45초 · 10라운드 · 잉크 100", rules: DEFAULT_STOP_RULES },
  { id: "quick", emoji: "⚡", name: "빠른 대결", desc: "30초 · 5라운드 — 10분 안에 끝", rules: { turnSeconds: 30, rounds: 5, ink: INK_PER_TURN } },
  { id: "long", emoji: "🏰", name: "장기전", desc: "60초 · 15라운드 — 천천히 그리고 끝까지", rules: { turnSeconds: 60, rounds: 15, ink: INK_PER_TURN } },
  { id: "big", emoji: "🎨", name: "큰 그림", desc: "잉크 130 · 60초 — 크고 화려한 낙서", rules: { turnSeconds: 60, rounds: MAX_ROUNDS, ink: 130 } },
];

export function sameStopRules(a: StopRules, b: StopRules): boolean {
  return a.rounds === b.rounds && a.ink === b.ink && a.turnSeconds === b.turnSeconds;
}

/** Clamp untrusted rules (they arrive over the network). */
export function sanitizeStopRules(raw: unknown): StopRules {
  const r = (raw ?? {}) as Partial<Record<keyof StopRules, unknown>>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v))) : d);
  return {
    rounds: num(r.rounds, DEFAULT_STOP_RULES.rounds, 1, 30),
    ink: num(r.ink, DEFAULT_STOP_RULES.ink, 30, 200),
    turnSeconds: num(r.turnSeconds, DEFAULT_STOP_RULES.turnSeconds, 15, 120),
  };
}

/** Ink at the start of a turn (❄️ freeze trims it by the same 28% at any setting). */
function turnInk(rules: StopRules | undefined, frozen: boolean): number {
  const ink = rules?.ink ?? INK_PER_TURN;
  return frozen ? Math.round((ink * FROZEN_INK) / INK_PER_TURN) : ink;
}
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
/**
 * 🛡️ Shield: drawn doodle scaled up and stood next to the player. While it
 * stands its owner takes less damage — up to SHIELD_GUARD (×0.6) for a
 * 100-ink shield, proportionally less for a smaller one. (2026-10-09: once
 * shields could go up in the same turn as a shot, a flat −40% made a 20-ink
 * dot win 90% of duels.)
 */
const SHIELD_SCALE = 1.3;
const SHIELD_HP_PER_INK = 1.3;
export const SHIELD_GUARD = 0.6;
const BURN_DMG = 5;
/** Shot-bending statuses: re-applying them every hit locked the victim out, so they skip a turn after landing. */
const LOCK_STATUSES: StatusId[] = ["confuse", "slow", "blind"];
const POISON_DMG = 4;
const CHAIN_RANGE = 240;
const PELLET_SPREAD = 28;
/** Crater radius per weapon kind, as a fraction of its blast radius (or a fixed size). */
const CRATER_FACTOR: Record<WeaponStats["kind"], number> = {
  spear: 0,
  bomb: 0.85,
  rocket: 0.7,
  anvil: 0.8,
  shuriken: 0,
  lightning: 0,
  boomerang: 0,
  drill: 1.25,
  wave: 0,
  cluster: 0.55,
  club: 0.5,
};
const CRATER_FIXED: Partial<Record<WeaponStats["kind"], number>> = { lightning: 10, boomerang: 10, shuriken: 8 };
const DIRECT_BONUS = 1.2;
const CRIT_MUL = 1.6;
const SELF_DMG_MUL = 0.5;

export interface Player {
  seat: SeatIndex;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  /** Active status effects → remaining turns of this player (see status.ts). */
  status: StatusMap;
  /** Just sat out a stun: can't be stunned again until after their next real turn. */
  stunImmune: boolean;
  /** 😵/🐌/🕶️ that were active during their last turn: can't land again until after the next one. */
  lockImmune?: StatusId[];
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
  kind: "burn" | "poison" | "stun";
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
      /** Flat x,y of 🎆 scatter sub-blasts (empty for single-impact weapons). */
      pelletPoints: number[];
      wallsBroken: number[];
      craterRadius: number;
      hpBefore: number[];
      killed: SeatIndex[];
      dots: DotRecord[];
      move?: MoveRecord;
      /** A boomerang came back to its thrower. */
      caught?: boolean;
      /** Statuses inflicted, per victim seat. */
      inflicted: { seat: SeatIndex; statuses: StatusId[] }[];
      /** 🩷 Lifesteal heal for the shooter. */
      heal: number;
      /** 😵 The shooter was confused: the angle they actually fired at. */
      confusedAngle?: number;
      /** 🐌 slow / 🕶️ blind changed the power the shooter asked for: what actually flew. */
      bentPower?: number;
      /** 🛡️ A shield went up in the same turn as this shot. */
      shieldWallId?: number;
    }
  | { kind: "wall"; id: number; seat: SeatIndex; wallId: number; dots: DotRecord[]; move?: MoveRecord }
  | { kind: "shield"; id: number; seat: SeatIndex; wallId: number; dots: DotRecord[]; move?: MoveRecord }
  | { kind: "pass"; id: number; seat: SeatIndex; dots: DotRecord[]; move?: MoveRecord };

/** The acting player walked from `from` to `to` (x) before acting this turn. */
export interface MoveRecord {
  from: number;
  to: number;
}

export interface InkDuelState {
  seed: number;
  playerCount: number;
  map: MapId;
  /** Character art index per seat (unique; see arenaArt CHARACTERS). */
  characters: number[];
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
  /** Host-chosen settings (optional only so older synced states still load). */
  rules?: StopRules;
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
  | {
      type: "fire";
      seat: SeatIndex;
      strokes: Stroke[];
      angle: number;
      power: number;
      move?: number;
      /** 🛡️ Raise a shield in the same turn; its ink comes out of the same turn budget. */
      shield?: { strokes: Stroke[]; angle: number };
    }
  | { type: "wall"; seat: SeatIndex; strokes: Stroke[]; move?: number }
  | { type: "shield"; seat: SeatIndex; strokes: Stroke[]; angle: number; move?: number }
  | { type: "pass"; seat: SeatIndex; move?: number };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function windFor(seed: number, turnNo: number, map: MapId): number {
  const rng = seededRng((seed + turnNo * 7919) | 0);
  return Math.round((rng() * 2 - 1) * 40 * MAPS[map].windMul) / 1000;
}

function generateTerrain(rng: () => number, map: MapId): number[] {
  const t = MAPS[map].terrain;
  // The meadow keeps the original generator so existing seeds stay identical.
  const f1 = map === "meadow" ? 0.004 + rng() * 0.004 : t.freqs[0] * (0.7 + rng() * 0.6);
  const f2 = map === "meadow" ? 0.012 + rng() * 0.01 : t.freqs[1] * (0.7 + rng() * 0.6);
  const f3 = map === "meadow" ? 0.03 + rng() * 0.02 : t.freqs[2] * (0.7 + rng() * 0.6);
  const p1 = rng() * 6;
  const p2 = rng() * 6;
  const p3 = rng() * 6;
  const out: number[] = [];
  for (let i = 0; i < TERRAIN_COLS; i++) {
    const x = i * COL_W;
    const h = t.base + t.amps[0] * dsin(x * f1 + p1) + t.amps[1] * dsin(x * f2 + p2) + t.amps[2] * dsin(x * f3 + p3);
    out.push(Math.round(Math.max(300, Math.min(480, h)) * 10) / 10);
  }
  return out;
}

/** Each seat gets its requested character if nobody earlier claimed it; the rest are dealt from what's left. */
function resolveCharacters(count: number, seed: number, requested: readonly (number | null | undefined)[] | undefined): number[] {
  const out = new Array<number>(count).fill(-1);
  const used = new Set<number>();
  for (let seat = 0; seat < count; seat++) {
    const c = requested?.[seat];
    if (typeof c === "number" && Number.isInteger(c) && c >= 0 && c < CHARACTER_COUNT && !used.has(c)) {
      out[seat] = c;
      used.add(c);
    }
  }
  const free = shuffle(
    Array.from({ length: CHARACTER_COUNT }, (_, i) => i).filter((c) => !used.has(c)),
    seededRng((seed ^ 0x5bd1e995) | 0),
  );
  for (let seat = 0; seat < count; seat++) if (out[seat] < 0) out[seat] = free.shift() ?? seat % CHARACTER_COUNT;
  return out;
}

export interface StartOptions {
  map?: MapId;
  /** 🛑 stop-mode settings (rounds / ink / turn timer). */
  stopRules?: StopRules;
  /** Requested character per seat (null/undefined = no preference). */
  characters?: readonly (number | null | undefined)[];
}

export function startGame(playerCount: number, seed: number, options: StartOptions = {}): InkDuelState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const map: MapId = options.map && MAPS[options.map] ? options.map : "meadow";
  const rng = seededRng(seed);
  let terrain = generateTerrain(rng, map);
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
    status: {},
    stunImmune: false,
  }));
  const first = Math.floor(rng() * count);
  return {
    seed,
    playerCount: count,
    map,
    characters: resolveCharacters(count, seed, options.characters),
    players,
    terrain,
    walls: [],
    nextWallId: 1,
    phase: "playing",
    turnSeat: first,
    turnNo: 0,
    round: 1,
    wind: windFor(seed, 0, map),
    rules: sanitizeStopRules(options.stopRules),
    inkBudget: sanitizeStopRules(options.stopRules).ink,
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

/** Works for both modes: only reads living players' HP and the elimination order. */
export function computeRankings(state: { players: readonly { seat: SeatIndex; alive: boolean; hp: number }[]; deathGroups: readonly (readonly SeatIndex[])[] }): { seat: SeatIndex; rank: number }[] {
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
export function wallPlacementError(state: { players: readonly { seat: SeatIndex; x: number; y: number; alive: boolean }[]; terrain: readonly number[] }, seat: SeatIndex, strokes: readonly Stroke[]): string | null {
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
export function maxMoveFor(state: InkDuelState, seat: SeatIndex): number {
  return (state.players[seat]?.status.slow ?? 0) > 0 ? MAX_MOVE / 2 : MAX_MOVE;
}

export function applyMove(state: InkDuelState, seat: SeatIndex, dx: number): InkDuelState | null {
  if (!Number.isInteger(dx) || Math.abs(dx) > maxMoveFor(state, seat)) return null;
  if (dx === 0) return state;
  const me = state.players[seat];
  const to = resolveMove(state, seat, dx);
  const cost = moveInk(me.x, to) * ((me.status.slow ?? 0) > 0 ? 2 : 1);
  if (cost > state.inkBudget) return null;
  const players = state.players.map((p) => (p.seat === seat ? { ...p, x: to, y: surfaceY(state.terrain, to) } : p));
  return { ...state, players, inkBudget: Math.round((state.inkBudget - cost) * 100) / 100 };
}

/**
 * The wall a 🛡️ shield doodle becomes: the pad drawing scaled up and stood
 * beside the player in the `angle` direction (0 = right, 90 = up). Shared by
 * the reducer and the UI preview.
 */
export function shieldWall(state: { players: readonly { x: number; y: number }[]; nextWallId: number }, seat: SeatIndex, strokes: readonly Stroke[], angle: number): Wall {
  const me = state.players[seat];
  const stats = analyzeWeapon(strokes);
  const a = degToRad(angle);
  const dist = PLAYER_R + 14 + stats.radius * SHIELD_SCALE * 0.35;
  const cx = me.x + dcos(a) * dist;
  const cy = me.y - 20 - dsin(a) * dist;
  const ink = totalInk(strokes);
  const hp = Math.round(ink * SHIELD_HP_PER_INK * 10) / 10;
  const guard = Math.round(Math.min(1, ink / INK_PER_TURN) * (1 - SHIELD_GUARD) * 100) / 100;
  const colorInk = [0, 0, 0, 0, 0];
  for (const s of strokes) colorInk[s.c] += s.p.length;
  let color = 0;
  for (let i = 1; i < colorInk.length; i++) if (colorInk[i] > colorInk[color]) color = i;
  return {
    id: state.nextWallId,
    owner: seat,
    shieldOf: seat,
    guard,
    strokes: stats.shape.map((st) => {
      const out: number[] = [];
      for (let i = 0; i < st.p.length; i += 2) out.push(Math.round((cx + st.p[i] * SHIELD_SCALE) * 10) / 10, Math.round((cy + st.p[i + 1] * SHIELD_SCALE) * 10) / 10);
      return out;
    }),
    hp,
    maxHp: hp,
    color,
  };
}

/** Damage multiplier from the strongest shield `seat` has standing (1 = none). */
export function shieldGuardMul(walls: readonly Wall[], seat: SeatIndex): number {
  let best = 0;
  for (const w of walls) if (w.shieldOf === seat && w.hp > 0) best = Math.max(best, w.guard ?? 1 - SHIELD_GUARD);
  return 1 - best;
}

export function hasShield(walls: readonly Wall[], seat: SeatIndex): boolean {
  return walls.some((w) => w.shieldOf === seat && w.hp > 0);
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

  if (action.type === "shield") {
    if (!strokesValid(action.strokes, PAD_SIZE, PAD_SIZE) || !validInk(state, action.strokes)) return state;
    if (!Number.isInteger(action.angle) || action.angle < 0 || action.angle > 180) return state;
    const wall = shieldWall(state, action.seat, action.strokes, action.angle);
    // A fresh shield replaces any leftover one (there shouldn't be — they expire on the owner's turn).
    const walls = [...state.walls.filter((w) => w.shieldOf !== action.seat), wall];
    const next = { ...state, walls, nextWallId: state.nextWallId + 1 };
    return endTurn(next, { kind: "shield", id: state.seq + 1, seat: action.seat, wallId: wall.id, dots: [] }, next.players, next.terrain, next.walls);
  }

  // fire (optionally with a 🛡️ shield raised first, sharing the turn's ink)
  if (!strokesValid(action.strokes, PAD_SIZE, PAD_SIZE)) return state;
  if (!Number.isInteger(action.angle) || action.angle < 0 || action.angle > 180) return state;
  if (!Number.isInteger(action.power) || action.power < 10 || action.power > 100) return state;
  const weaponInk = totalInk(action.strokes);
  let shieldInk = 0;
  if (action.shield) {
    if (!strokesValid(action.shield.strokes, PAD_SIZE, PAD_SIZE) || !Number.isInteger(action.shield.angle) || action.shield.angle < 0 || action.shield.angle > 180) return state;
    shieldInk = totalInk(action.shield.strokes);
    if (shieldInk < MIN_INK) return state;
  }
  if (weaponInk < MIN_INK || weaponInk + shieldInk > state.inkBudget + 0.5) return state;
  let shieldWallId: number | undefined;
  if (action.shield) {
    // Same-turn shields are light: they cut damage but don't stop shots (a solid one
    // here won 76% of duels — in 1v1 it ate the opponent's only shot every round).
    const wall = { ...shieldWall(state, action.seat, action.shield.strokes, action.shield.angle), light: true };
    shieldWallId = wall.id;
    state = { ...state, walls: [...state.walls.filter((w) => w.shieldOf !== action.seat), wall], nextWallId: state.nextWallId + 1 };
  }
  let angle = action.angle;
  let confusedAngle: number | undefined;
  if ((state.players[action.seat].status.confuse ?? 0) > 0) {
    const r = seededRng((state.seed + (state.seq + 1) * 7477) | 0);
    const off = Math.round(4 + r() * 5) * (r() < 0.5 ? -1 : 1);
    angle = Math.max(0, Math.min(180, angle + off));
    confusedAngle = angle;
  }
  let power = action.power;
  const st = state.players[action.seat].status;
  if ((st.slow ?? 0) > 0) power *= SLOW_POWER_MUL_TURN;
  if ((st.blind ?? 0) > 0) {
    const r = seededRng((state.seed + (state.seq + 1) * 9173) | 0);
    power += Math.round(BLIND_POWER_JITTER[0] + r() * (BLIND_POWER_JITTER[1] - BLIND_POWER_JITTER[0])) * (r() < 0.5 ? -1 : 1);
  }
  power = Math.max(10, Math.min(100, Math.round(power)));
  const bentPower = power !== action.power ? power : undefined;
  const next = resolveShot(state, action.seat, analyzeWeapon(action.strokes), angle, power);
  if ((confusedAngle === undefined && bentPower === undefined && shieldWallId === undefined) || next.lastEvent?.kind !== "shot") return next;
  return {
    ...next,
    lastEvent: {
      ...next.lastEvent,
      ...(confusedAngle !== undefined ? { confusedAngle } : {}),
      ...(bentPower !== undefined ? { bentPower } : {}),
      ...(shieldWallId !== undefined ? { shieldWallId } : {}),
    },
  };
}

interface ShotOutcome {
  players: Player[];
  terrain: number[];
  walls: Wall[];
  event: Extract<InkEvent, { kind: "shot" }>;
}

/** The bits of a player the impact rules read and write (shared by both modes). */
export interface ImpactBody {
  seat: SeatIndex;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  status: StatusMap;
  stunImmune: boolean;
  lockImmune?: StatusId[];
}

export interface ImpactResult {
  hits: HitRecord[];
  chainPath: number[];
  pelletPoints: number[];
  crit: boolean;
  craterRadius: number;
  wallsBroken: number[];
  killed: SeatIndex[];
  inflicted: { seat: SeatIndex; statuses: StatusId[] }[];
  heal: number;
  walls: Wall[];
  terrain: number[];
}

/**
 * Applies one landed (or missed) shot to the world: damage with all the
 * modifiers, lightning chains, scatter sub-blasts, wall damage, craters,
 * status effects, lifesteal and knockback. Mutates `players` in place (pass
 * copies). Shared by 🛑 stop mode (computeShot) and 🏃 moving mode
 * (realtime.ts) — they differ only in how long a status lasts (`duration`)
 * and where randomness comes from.
 */
export function resolveImpact<P extends ImpactBody>(
  players: P[],
  walls0: readonly Wall[],
  terrain0: readonly number[],
  map: MapId,
  seat: SeatIndex,
  stats: WeaponStats,
  flight: { impact: { x: number; y: number } | null; directSeat: number | null; wallStop: number | null; pierced: readonly number[] },
  critRoll: number,
  statusRoll: () => number,
  duration: (st: StatusId) => number,
  /** Global damage scale (moving mode hits softer because shots come faster). */
  dmgScale = 1,
): ImpactResult {
  const shooter = players[seat];
  let walls = walls0.map((w) => ({ ...w }));
  for (const id of flight.pierced) {
    const w = walls.find((x) => x.id === id);
    if (w) w.hp -= 25;
  }
  let terrain = terrain0 as number[];
  const hits: HitRecord[] = [];
  const chainPath: number[] = [];
  const pelletPoints: number[] = [];
  let crit = false;
  let craterRadius = 0;

  if (flight.impact) {
    const { x: ix, y: iy } = flight.impact;
    crit = critRoll < stats.critChance;
    const mul = (crit ? CRIT_MUL : 1) * dmgScale;
    const blast = stats.blastRadius;
    // 🎆 Scatter shots burst at several points spread around the impact.
    const centers: number[] = [];
    if (stats.pellets > 0) {
      for (let i = 0; i < stats.pellets; i++) centers.push(ix + (i - (stats.pellets - 1) / 2) * PELLET_SPREAD, iy - (i % 2) * 10);
    } else {
      centers.push(ix, iy);
    }
    pelletPoints.push(...(stats.pellets > 0 ? centers.map((v) => Math.round(v)) : []));
    for (const p of players) {
      if (!p.alive) continue;
      let dmg = 0;
      const direct = flight.directSeat === p.seat;
      if (direct) dmg = stats.damage * DIRECT_BONUS;
      if (blast > 0) {
        for (let k = 0; k < centers.length; k += 2) {
          if (direct && k === 0) continue;
          const dx = p.x - centers[k];
          const dy = p.y - PLAYER_R - centers[k + 1];
          const d = Math.sqrt(dx * dx + dy * dy);
          const reach = blast + PLAYER_R;
          if (d < reach) dmg += stats.damage * (1 - (0.6 * d) / reach);
        }
      }
      if (dmg <= 0) continue;
      if (p.seat === seat) dmg *= SELF_DMG_MUL;
      dmg *= shieldGuardMul(walls, p.seat);
      dmg *= dmgMods(shooter.status, p.status);
      hits.push({ seat: p.seat, dmg: Math.round(dmg * mul), direct, chain: false });
    }
    // Lightning chains: jump to the nearest living, not-yet-hit enemy.
    if (stats.chains > 0) {
      let lx = ix;
      let ly = iy;
      chainPath.push(Math.round(lx), Math.round(ly));
      for (let k = 0; k < stats.chains; k++) {
        let best: P | null = null;
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
        hits.push({ seat: best.seat, dmg: Math.round(stats.damage * 0.5 * mul * shieldGuardMul(walls, best.seat) * dmgMods(shooter.status, best.status)), direct: false, chain: true });
        lx = best.x;
        ly = best.y - PLAYER_R;
        chainPath.push(Math.round(lx), Math.round(ly));
      }
    }
    // Walls caught in the blast / directly hit.
    for (const w of walls) {
      if (w.hp <= 0) continue;
      if (flight.wallStop === w.id) w.hp -= stats.damage * 1.5;
      else if (blast > 0) {
        for (let k = 0; k < centers.length; k += 2) if (wallTouchesCircle(w, centers[k], centers[k + 1], blast)) w.hp -= stats.damage;
      }
    }
    craterRadius = (CRATER_FACTOR[stats.kind] * stats.blastRadius || CRATER_FIXED[stats.kind] || 0) * MAPS[map].craterMul;
    if (craterRadius > 0) for (let k = 0; k < centers.length; k += 2) terrain = carveCrater(terrain, centers[k], centers[k + 1], craterRadius);
  }

  const inflicted: { seat: SeatIndex; statuses: StatusId[] }[] = [];
  let heal = 0;
  for (const h of hits) {
    const p = players[h.seat];
    p.hp = Math.max(0, p.hp - h.dmg);
    if (h.seat !== seat) heal += h.dmg * lifestealRate(stats);
    const got: StatusId[] = [];
    for (const st of statusesForHit(stats, statusRoll())) {
      if (st === "stun" && p.stunImmune) continue;
      if (p.lockImmune?.includes(st)) continue;
      p.status = { ...p.status, [st]: Math.max(p.status[st] ?? 0, duration(st)) };
      got.push(st);
    }
    if (got.length > 0) inflicted.push({ seat: h.seat, statuses: got });
    // 🌊 Knockback: shove hit players (not the shooter) away from the impact.
    if (stats.knockback > 0 && flight.impact && h.seat !== seat && !h.chain) {
      const dir = p.x >= flight.impact.x ? 1 : -1;
      p.x = Math.round(Math.max(20, Math.min(WORLD_W - 20, p.x + dir * stats.knockback)));
    }
  }
  heal = Math.round(heal);
  if (heal > 0 && shooter.alive) shooter.hp = Math.min(START_HP, shooter.hp + heal);
  const wallsBroken = walls.filter((w) => w.hp <= 0 && walls0.some((o) => o.id === w.id && o.hp > 0)).map((w) => w.id);
  walls = walls.filter((w) => w.hp > 0).map((w) => ({ ...w, hp: Math.round(w.hp * 10) / 10 }));
  const killed: SeatIndex[] = [];
  for (const p of players) {
    if (p.alive && p.hp <= 0) {
      p.alive = false;
      killed.push(p.seat);
    }
  }
  return { hits, chainPath, pelletPoints, crit, craterRadius, wallsBroken, killed, inflicted, heal, walls, terrain };
}

/** Pure shot resolution, also used by the bot to evaluate candidates. */
export function computeShot(state: InkDuelState, seat: SeatIndex, stats: WeaponStats, angle: number, power: number): ShotOutcome {
  const shooter = state.players[seat];
  const flight = simulateFlight(state.terrain, bodies(state), state.walls, { seat, x: shooter.x, y: shooter.y, alive: true }, stats, angle, power, state.wind);
  const hpBefore = state.players.map((p) => p.hp);
  const players = state.players.map((p) => ({ ...p }));
  const critRng = seededRng((state.seed + (state.seq + 1) * 1013) | 0);
  const r = resolveImpact(
    players,
    state.walls,
    state.terrain,
    state.map,
    seat,
    stats,
    flight,
    flight.impact ? critRng() : 1,
    seededRng((state.seed + (state.seq + 1) * 3571) | 0),
    (st) => TURN_DURATION[st],
  );
  for (const p of players) p.y = surfaceY(r.terrain, p.x);
  return {
    players,
    terrain: r.terrain,
    walls: r.walls,
    event: {
      kind: "shot",
      id: state.seq + 1,
      seat,
      stats,
      angle,
      power,
      frames: flight.frames,
      impact: flight.impact ? { x: Math.round(flight.impact.x * 10) / 10, y: Math.round(flight.impact.y * 10) / 10 } : null,
      crit: r.crit,
      hits: r.hits,
      chainPath: r.chainPath,
      pelletPoints: r.pelletPoints,
      wallsBroken: r.wallsBroken,
      craterRadius: r.craterRadius,
      hpBefore,
      killed: r.killed,
      dots: [],
      ...(flight.caught ? { caught: true } : {}),
      inflicted: r.inflicted,
      heal: r.heal,
    },
  };
}

/** Damage multiplier from the shooter's ⬇️ weaken and the target's 💔 vulnerable. */
function dmgMods(shooter: StatusMap, target: StatusMap): number {
  return ((shooter.weaken ?? 0) > 0 ? WEAKEN_MUL : 1) * ((target.vulnerable ?? 0) > 0 ? VULNERABLE_MUL : 1);
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
function endTurn(state: InkDuelState, event: InkEvent, players0: Player[], terrain: number[], walls0: Wall[]): InkDuelState {
  let walls = walls0;
  const players = players0.map((p) => ({ ...p }));
  let deathGroups = state.deathGroups;
  const dots: DotRecord[] = [];
  let seat = state.turnSeat;
  let turnNo = state.turnNo;
  let round = state.round;
  const n = state.playerCount;
  // The player who just acted used up one turn of each timed debuff (DoTs tick at turn start instead).
  if (players[seat]) {
    const st: StatusMap = {};
    for (const k of activeStatuses(players[seat].status)) {
      const left = (players[seat].status[k] ?? 0) - (k === "burn" || k === "poison" ? 0 : 1);
      if (left > 0) st[k] = left;
    }
    // A confusion that was active this turn grants a turn of immunity (no confuse-lock).
    players[seat].lockImmune = LOCK_STATUSES.filter((k) => (players[seat].status[k] ?? 0) > 0);
    players[seat].status = st;
    players[seat].stunImmune = false;
  }

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
    wind: windFor(state.seed, turnNo, state.map),
    inkBudget: turnInk(state.rules, phase === "playing" && (players[seat]?.status.freeze ?? 0) > 0),
    lastEvent: { ...event, dots },
    seq: state.seq + 1,
  });

  for (let guard = 0; guard < n * 6; guard++) {
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
    if (round > (state.rules?.rounds ?? MAX_ROUNDS)) return finish("gameOver");
    const startingSeat = seat;
    if (walls.some((w) => w.shieldOf === startingSeat || (w.shieldOf !== undefined && !players[w.shieldOf]?.alive))) {
      walls = walls.filter((w) => w.shieldOf !== startingSeat && (w.shieldOf === undefined || players[w.shieldOf]?.alive));
    }
    const p = players[seat];
    let tick = 0;
    const status: StatusMap = { ...p.status };
    if ((status.burn ?? 0) > 0) {
      dots.push({ seat, dmg: BURN_DMG, kind: "burn" });
      tick += BURN_DMG;
      status.burn = (status.burn ?? 0) - 1;
    }
    if ((status.poison ?? 0) > 0) {
      dots.push({ seat, dmg: POISON_DMG, kind: "poison" });
      tick += POISON_DMG;
      status.poison = (status.poison ?? 0) - 1;
    }
    p.status = status;
    if (tick > 0) {
      p.hp = Math.max(0, p.hp - tick);
      if (p.hp <= 0) {
        p.alive = false;
        deathGroups = [...deathGroups, [seat]];
        continue;
      }
    }
    // 💫 Stunned: this turn is skipped outright, then a turn of immunity.
    if ((status.stun ?? 0) > 0) {
      dots.push({ seat, dmg: 0, kind: "stun" });
      p.status = { ...status, stun: 0 };
      p.stunImmune = true;
      continue;
    }
    return finish("playing");
  }
  return finish("gameOver");
}

// ---------------------------------------------------------------------------
// Bots (ARCHITECTURE.md §7)
// ---------------------------------------------------------------------------

type Template = WeaponStats["kind"];

/** Procedurally "draws" a doodle of one archetype on the pad, fitting `budget` ink. */
export function botDoodle(template: Template, color: InkColor, budget: number, rng: () => number): Stroke[] {
  const j = (v: number) => Math.round(Math.max(0, Math.min(PAD_SIZE, v + (rng() * 2 - 1) * 2)));
  const HALF_PI = 1.5707963267948966;
  const TAU = 6.283185307179586;
  const polys: number[][] = [];
  const ring = (cx: number, cy: number, r: number, steps: number) => {
    const p: number[] = [];
    for (let t = 0; t <= steps; t++) {
      const a = (t / steps) * TAU;
      p.push(cx + r * dsin(a + HALF_PI), cy + r * dsin(a));
    }
    return p;
  };
  const polygon = (corners: number[]) => {
    const p: number[] = [];
    const n = corners.length / 2;
    for (let k = 0; k <= n; k++) {
      const a = k % n;
      const b = (k + 1) % n;
      if (k === n) {
        p.push(corners[a * 2], corners[a * 2 + 1]);
        break;
      }
      for (let t = 0; t < 4; t++) p.push(corners[a * 2] + ((corners[b * 2] - corners[a * 2]) * t) / 4, corners[a * 2 + 1] + ((corners[b * 2 + 1] - corners[a * 2 + 1]) * t) / 4);
    }
    return p;
  };
  switch (template) {
    case "spear": {
      const p: number[] = [];
      for (let t = 0; t <= 16; t++) p.push(20 + t * 10, 100 + (t % 2) * 2);
      polys.push(p);
      break;
    }
    case "bomb":
      polys.push(ring(100, 100, 45 + rng() * 25, 24));
      break;
    case "rocket":
      polys.push(polygon([100, 30, 165, 160, 35, 160]));
      break;
    case "anvil":
      polys.push(polygon([45, 55, 155, 55, 155, 145, 45, 145]));
      break;
    case "shuriken": {
      const c: number[] = [];
      for (let k = 0; k < 10; k++) {
        const a = -HALF_PI + (k / 10) * TAU;
        const r = k % 2 === 0 ? 75 : 25;
        c.push(100 + r * dsin(a + HALF_PI), 100 + r * dsin(a));
      }
      polys.push(polygon(c));
      break;
    }
    case "lightning": {
      const p: number[] = [];
      for (let t = 0; t <= 8; t++) p.push(30 + t * 18, t % 2 === 0 ? 70 : 130);
      polys.push(p);
      break;
    }
    case "boomerang": {
      // Smooth "C" arc (~200°).
      const r = 55 + rng() * 15;
      const p: number[] = [];
      for (let t = 0; t <= 20; t++) {
        const a = -1.7 + (t / 20) * 3.5;
        p.push(100 + r * dsin(a + HALF_PI), 100 + r * dsin(a));
      }
      polys.push(p);
      break;
    }
    case "drill": {
      // Two-turn spiral from the centre outwards.
      const p: number[] = [];
      for (let t = 0; t <= 48; t++) {
        const a = (t / 48) * 2 * TAU;
        const r = 10 + (t / 48) * 70;
        p.push(100 + r * dsin(a + HALF_PI), 100 + r * dsin(a));
      }
      polys.push(p);
      break;
    }
    case "wave": {
      const p: number[] = [];
      for (let x = 20; x <= 180; x += 6) p.push(x, 100 + 30 * dsin(x * 0.045));
      polys.push(p);
      break;
    }
    case "cluster":
      for (const [cx, cy] of [
        [50, 60],
        [150, 60],
        [100, 100],
        [50, 140],
        [150, 140],
      ]) polys.push(ring(cx, cy, 12, 10));
      break;
    default:
      // Club: a small, dense lump (closed but too small to be a bomb).
      polys.push(ring(100, 100, 15, 12));
  }
  const fit = (scale: number): Stroke[] =>
    polys.map((poly) => {
      const p: number[] = [];
      for (let i = 0; i < poly.length; i += 2) p.push(j(100 + (poly[i] - 100) * scale), j(100 + (poly[i + 1] - 100) * scale));
      return { c: color, p };
    });
  let scale = 1;
  let strokes = fit(scale);
  while (totalInk(strokes) > budget - 1 && scale > 0.3) {
    scale -= 0.08;
    strokes = fit(scale);
  }
  return strokes;
}

export const BOT_WEAPON_KINDS: readonly Template[] = ["spear", "bomb", "rocket", "anvil", "shuriken", "lightning", "boomerang", "drill", "wave", "cluster", "club"];

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
    case "boomerang":
    case "rocket":
    case "shuriken":
    case "drill":
    case "cluster":
      return 3;
    case "anvil":
      return 4;
    case "wave":
      // Shoving someone toward the arena edge is worth a bit more.
      return 2 + (enemies.some((e) => e.x < 120 || e.x > WORLD_W - 120) ? 4 : 0);
    default:
      return 1;
  }
}

/** Ink color for a bot doodle: shock for lightning half the time, otherwise skip elements the target already suffers. */
function botColor(state: InkDuelState, seat: SeatIndex, t: Template, rng: () => number): InkColor {
  if (t === "lightning" && rng() < 0.5) return 4;
  const enemies = state.players.filter((p) => p.alive && p.seat !== seat);
  const statusOfColor: Partial<Record<number, StatusId>> = { 1: "burn", 2: "freeze", 3: "poison", 5: "slow", 6: "stun", 7: "weaken", 8: "vulnerable", 10: "confuse", 11: "blind" };
  const options = Array.from({ length: 12 }, (_, c) => c).filter((c) => {
    const st = statusOfColor[c];
    return !st || !enemies.every((e) => (e.status[st] ?? 0) > 0);
  }) as InkColor[];
  return options[Math.floor(rng() * options.length)];
}

/** A representative set of legal moves (doodles are continuous, so this samples rather than enumerates). */
export function getValidMoves(state: InkDuelState, seat: SeatIndex): EngineAction[] {
  if (currentActor(state) !== seat) return [];
  const rng = seededRng((state.seed + state.seq * 31) | 0);
  const moves: EngineAction[] = [{ type: "pass", seat }];
  for (const t of BOT_WEAPON_KINDS) {
    const strokes = botDoodle(t, 0, state.inkBudget, rng);
    for (const angle of [30, 60, 90, 120, 150]) moves.push({ type: "fire", seat, strokes, angle, power: 60 });
  }
  moves.push({ type: "shield", seat, strokes: botDoodle("bomb", 2, state.inkBudget, rng), angle: 90 });
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
  // Hurt and unshielded: put a small bubble shield up and fire with the ink that's left.
  if (level >= 3 && enemies.length > 0 && me.hp <= 60 && !hasShield(state.walls, seat) && rng() < 0.45) {
    const near = enemies.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a));
    const strokes = botDoodle("bomb", 2, Math.min(35, state.inkBudget - 30), rng);
    const ink = totalInk(strokes);
    if (ink >= MIN_INK && state.inkBudget - ink >= 25) {
      const core = chooseBotActionCore({ ...state, inkBudget: Math.round((state.inkBudget - ink) * 100) / 100 }, seat, level, rng);
      if (core?.type === "fire") return { ...core, shield: { strokes, angle: near.x < me.x ? 150 : 30 } };
    }
  }
  return chooseBotActionCore(state, seat, level, rng);
}

function chooseBotActionCore(state: InkDuelState, seat: SeatIndex, level: BotLevel, rng: () => number): EngineAction | null {
  const me = state.players[seat];
  const enemies = state.players.filter((p) => p.alive && p.seat !== seat);
  if (enemies.length === 0) return { type: "pass", seat };

  // Defensive wall when hurt and unprotected.
  const hasWall = state.walls.some((w) => w.owner === seat && w.shieldOf === undefined && w.hp > 15);
  if (level >= 3 && !hasWall && me.hp <= 55 && rng() < 0.2) {
    const wall = botWall(state, seat, rng);
    if (wall) return { type: "wall", seat, strokes: wall };
  }

  // Per-turn "mood": a random lean toward each weapon kind, so equally good
  // options don't always resolve to the same kind.
  const mood = Object.fromEntries(BOT_WEAPON_KINDS.map((t) => [t, rng() * 8])) as Record<Template, number>;
  // Evaluate a random 5 of the 11 weapon kinds per turn — keeps think time low and play varied.
  const kinds = shuffle([...BOT_WEAPON_KINDS], rng).slice(0, 5);
  // Walk options: stronger bots reposition for a better angle (walking eats ink).
  const walks = level >= 4 ? [0, -60, -30, 30, 60] : [0];
  const scored: { move: Extract<EngineAction, { type: "fire" }>; score: number }[] = [];
  const randomPool: { action: Extract<EngineAction, { type: "fire" }>; s: InkDuelState }[] = [];
  for (const walk of walks) {
    const s = applyMove(state, seat, walk);
    if (!s || (walk !== 0 && s.players[seat].x === me.x)) continue;
    const self = s.players[seat];
    const bodyList = bodies(s);
    for (const t of kinds) {
      const strokes = botDoodle(t, botColor(s, seat, t, rng), s.inkBudget, rng);
      if (totalInk(strokes) < MIN_INK) continue;
      const stats = analyzeWeapon(strokes);
      const quick: { action: Extract<EngineAction, { type: "fire" }>; q: number }[] = [];
      for (let angle = 6; angle <= 174; angle += 6) {
        for (let power = 24; power <= 100; power += 8) {
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
