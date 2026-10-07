/**
 * 낙서 결투 — 🏃 moving mode (real-time). Unlike 🛑 stop mode's lockstep
 * reducer, this follows the worm game's host-authoritative pattern
 * (docs/cloud-sync.md §5): only the room host calls `stepRealtime`, clients
 * send inputs/commands and render the host's snapshots.
 *
 * Projectile physics (`moveFlyer`/`collideFlyer`) and impact rules
 * (`resolveImpact`) are the exact same code stop mode uses — only player
 * movement, ink regeneration, cooldowns and millisecond status timers are new.
 */

import { analyzeWeapon, INK_COLORS, PAD_SIZE, strokesValid, totalInk, type Element, type Stroke, type WeaponKind, type WeaponStats } from "./analyze";
import {
  botDoodle,
  BOT_WEAPON_KINDS,
  MIN_INK,
  resolveImpact,
  shieldWall,
  startGame,
  START_HP,
  wallPlacementError,
  type HitRecord,
  type ImpactBody,
  type SeatIndex,
  type StartOptions,
} from "./engine";
import type { MapId } from "./maps";
import { MAPS } from "./maps";
import { collideFlyer, GRAVITY, launchFlyer, minHeight, moveFlyer, MUZZLE_Y, PLAYER_R, simulateFlight, surfaceY, WORLD_H, WORLD_W, type Flyer, type Wall } from "./physics";
import { activeStatuses, LIVE_DURATION_MS, type StatusId } from "./status";

/** Physics tick — the same per-tick constants as stop mode, at 120 ticks/s. */
export const RT_TICK_MS = 1000 / 120;
export const RT_MATCH_MS = 180_000;
export const RT_INK_MAX = 100;
export const RT_INK_REGEN_PER_S = 16;
export const RT_COOLDOWN_MS = 1800;
/** Hits land softer than in stop mode — shots come much faster. */
export const RT_DAMAGE_SCALE = 0.6;
export const RT_SPEED = 75;
export const RT_JUMP_VY = -4.4;
export const RT_WIND_EVERY_MS = 10_000;
export const RT_SHIELD_MS = 6000;
const STUN_IMMUNE_MS = 2000;
const DOT_PULSE_MS = 500;
const BURN_PULSE = 2;
const POISON_PULSE = 1;
const MAX_STEP_UP = 3;
const PROJECTILE_MAX_TICKS = 900;
const EVENT_KEEP_MS = 3000;

export interface RtPlayer extends ImpactBody {
  vy: number;
  onGround: boolean;
  facing: 1 | -1;
  ink: number;
  cooldownMs: number;
  stunImmuneMs: number;
  dotMs: number;
  damageDealt: number;
  bestHit: number;
}

export interface RtProjectile {
  id: number;
  owner: SeatIndex;
  stats: WeaponStats;
  f: Flyer;
  spawnedAt: number;
}

export type RtEvent =
  | {
      id: number;
      at: number;
      kind: "boom";
      owner: SeatIndex;
      x: number;
      y: number;
      weapon: WeaponKind;
      element: Element;
      blast: number;
      ink: string;
      hits: HitRecord[];
      crit: boolean;
      chainPath: number[];
      pelletPoints: number[];
      killed: SeatIndex[];
      inflicted: { seat: SeatIndex; statuses: StatusId[] }[];
      heal: number;
      dirt: boolean;
    }
  | { id: number; at: number; kind: "caught"; seat: SeatIndex; x: number; y: number }
  | { id: number; at: number; kind: "fire" | "wall" | "shield"; seat: SeatIndex };

export interface RtState {
  mode: "moving";
  seed: number;
  map: MapId;
  characters: number[];
  playerCount: number;
  players: RtPlayer[];
  terrain: number[];
  walls: Wall[];
  /** Shield wall id → match time it disappears. */
  shieldExpiry: Record<number, number>;
  nextWallId: number;
  projectiles: RtProjectile[];
  nextId: number;
  timeMs: number;
  wind: number;
  nextWindMs: number;
  events: RtEvent[];
  phase: "playing" | "gameOver";
  deathGroups: SeatIndex[][];
  /** Bumped whenever terrain / walls change (lets snapshots skip unchanged geometry). */
  terrainVer: number;
  wallsVer: number;
  seq: number;
}

export interface RtInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export type RtCommand =
  | { type: "fire"; seat: SeatIndex; strokes: Stroke[]; angle: number; power: number }
  | { type: "wall"; seat: SeatIndex; strokes: Stroke[] }
  | { type: "shield"; seat: SeatIndex; strokes: Stroke[]; angle: number };

export const NO_INPUT: RtInput = { left: false, right: false, jump: false };

export function startRealtime(playerCount: number, seed: number, options: StartOptions = {}): RtState {
  const base = startGame(playerCount, seed, options);
  return {
    mode: "moving",
    seed,
    map: base.map,
    characters: base.characters,
    playerCount: base.playerCount,
    players: base.players.map((p) => ({
      ...p,
      vy: 0,
      onGround: true,
      facing: p.x < WORLD_W / 2 ? 1 : -1,
      ink: RT_INK_MAX,
      cooldownMs: 0,
      stunImmuneMs: 0,
      dotMs: 0,
      damageDealt: 0,
      bestHit: 0,
    })),
    terrain: base.terrain,
    walls: [],
    shieldExpiry: {},
    nextWallId: 1,
    projectiles: [],
    nextId: 1,
    timeMs: 0,
    wind: base.wind,
    nextWindMs: RT_WIND_EVERY_MS,
    events: [],
    phase: "playing",
    deathGroups: [],
    terrainVer: 0,
    wallsVer: 0,
    seq: 0,
  };
}

export function canAct(p: RtPlayer): boolean {
  return p.alive && (p.status.stun ?? 0) <= 0 && (p.status.freeze ?? 0) <= 0;
}

function wallBlocks(state: RtState, fromX: number, toX: number): number {
  // First ground-standing wall point between fromX and toX (exclusive), or toX if clear.
  let stop = toX;
  for (const w of state.walls) {
    for (const st of w.strokes) {
      for (let i = 0; i < st.length; i += 2) {
        const x = st[i];
        if (st[i + 1] < surfaceY(state.terrain, x) - 40) continue;
        if (toX > fromX && x > fromX && x - 8 < stop) stop = Math.max(fromX, x - 8);
        if (toX < fromX && x < fromX && x + 8 > stop) stop = Math.min(fromX, x + 8);
      }
    }
  }
  return stop;
}

type NewEvent = RtEvent extends infer E ? (E extends RtEvent ? Omit<E, "id" | "at"> : never) : never;

function pushEvent(state: RtState, ev: NewEvent) {
  state.events.push({ ...(ev as RtEvent), id: state.nextId++, at: state.timeMs });
}

function applyCommand(state: RtState, cmd: RtCommand, rng: () => number) {
  const p = state.players[cmd.seat];
  if (!p || !canAct(p) || p.cooldownMs > 0) return;
  if (!strokesValid(cmd.strokes, cmd.type === "wall" ? WORLD_W : PAD_SIZE, cmd.type === "wall" ? WORLD_H : PAD_SIZE)) return;
  const ink = totalInk(cmd.strokes);
  if (ink < MIN_INK || ink > p.ink + 0.5) return;
  if (cmd.type === "fire") {
    if (!Number.isFinite(cmd.angle) || !Number.isFinite(cmd.power)) return;
    let angle = Math.max(0, Math.min(180, Math.round(cmd.angle)));
    const power = Math.max(10, Math.min(100, Math.round(cmd.power)));
    if ((p.status.confuse ?? 0) > 0) angle = Math.max(0, Math.min(180, angle + Math.round(8 + rng() * 14) * (rng() < 0.5 ? -1 : 1)));
    const stats = analyzeWeapon(cmd.strokes);
    const id = state.nextId++;
    state.projectiles.push({ id, owner: cmd.seat, stats, f: launchFlyer({ seat: cmd.seat, x: p.x, y: p.y, alive: true }, stats, angle, power), spawnedAt: state.timeMs });
    p.facing = angle > 90 ? -1 : 1;
    pushEvent(state, { kind: "fire", seat: cmd.seat });
  } else if (cmd.type === "wall") {
    if (wallPlacementError(state, cmd.seat, cmd.strokes)) return;
    const colorInk = new Array<number>(INK_COLORS.length).fill(0);
    for (const s of cmd.strokes) colorInk[s.c] += s.p.length;
    let color = 0;
    for (let i = 1; i < colorInk.length; i++) if (colorInk[i] > colorInk[color]) color = i;
    const hp = Math.round(ink * 10) / 10;
    state.walls.push({ id: state.nextWallId++, owner: cmd.seat, strokes: cmd.strokes.map((s) => s.p.slice()), hp, maxHp: hp, color });
    state.wallsVer++;
    pushEvent(state, { kind: "wall", seat: cmd.seat });
  } else {
    if (!Number.isFinite(cmd.angle)) return;
    state.walls = state.walls.filter((w) => w.shieldOf !== cmd.seat);
    const wall = shieldWall(state, cmd.seat, cmd.strokes, Math.max(0, Math.min(180, Math.round(cmd.angle))));
    state.walls.push(wall);
    state.nextWallId++;
    state.shieldExpiry[wall.id] = state.timeMs + RT_SHIELD_MS;
    state.wallsVer++;
    pushEvent(state, { kind: "shield", seat: cmd.seat });
  }
  p.ink -= ink;
  p.cooldownMs = RT_COOLDOWN_MS;
}

function movePlayer(state: RtState, p: RtPlayer, input: RtInput, dt: number) {
  const acting = canAct(p);
  let dir = acting ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
  if ((p.status.confuse ?? 0) > 0) dir = -dir;
  if (dir !== 0) {
    p.facing = dir > 0 ? 1 : -1;
    const speed = RT_SPEED * ((p.status.slow ?? 0) > 0 ? 0.5 : 1);
    let to = Math.max(15, Math.min(WORLD_W - 15, p.x + (dir * speed * dt) / 1000));
    to = wallBlocks(state, p.x, to);
    if (p.onGround && surfaceY(state.terrain, to) < p.y - MAX_STEP_UP) to = p.x; // too steep to climb
    p.x = to;
  }
  if (acting && input.jump && p.onGround) {
    p.vy = RT_JUMP_VY;
    p.onGround = false;
  }
  const ground = surfaceY(state.terrain, p.x);
  if (p.onGround) {
    if (ground > p.y + MAX_STEP_UP) p.onGround = false; // walked off a ledge / ground blown away
    else p.y = ground;
  }
  if (!p.onGround) {
    p.vy += GRAVITY;
    p.y += p.vy;
    if (p.y >= ground) {
      p.y = ground;
      p.vy = 0;
      p.onGround = true;
    }
  }
}

function tickStatuses(state: RtState, p: RtPlayer, dt: number) {
  if (!p.alive) return;
  const hadStun = (p.status.stun ?? 0) > 0;
  const next: typeof p.status = {};
  for (const k of activeStatuses(p.status)) {
    const left = (p.status[k] ?? 0) - dt;
    if (left > 0) next[k] = left;
  }
  p.status = next;
  if (hadStun && (p.status.stun ?? 0) <= 0) p.stunImmuneMs = STUN_IMMUNE_MS;
  p.stunImmuneMs = Math.max(0, p.stunImmuneMs - dt);
  p.stunImmune = p.stunImmuneMs > 0;
  if ((p.status.burn ?? 0) > 0 || (p.status.poison ?? 0) > 0) {
    p.dotMs += dt;
    while (p.dotMs >= DOT_PULSE_MS) {
      p.dotMs -= DOT_PULSE_MS;
      p.hp = Math.max(0, p.hp - ((p.status.burn ?? 0) > 0 ? BURN_PULSE : 0) - ((p.status.poison ?? 0) > 0 ? POISON_PULSE : 0));
    }
  } else {
    p.dotMs = 0;
  }
  p.ink = Math.min(RT_INK_MAX, p.ink + (RT_INK_REGEN_PER_S * dt) / 1000);
  p.cooldownMs = Math.max(0, p.cooldownMs - dt);
}

/**
 * Advances the match by `dtMs` (host only). Mutates and returns `state`.
 * `inputs` is each seat's held keys; `commands` are fire/wall/shield
 * requests received since the last step.
 */
export function stepRealtime(state: RtState, dtMs: number, inputs: Record<number, RtInput>, commands: readonly RtCommand[], rng: () => number = Math.random): RtState {
  if (state.phase !== "playing") return state;
  for (const cmd of commands) applyCommand(state, cmd, rng);
  const ticks = Math.max(1, Math.min(12, Math.round(dtMs / RT_TICK_MS)));
  for (let t = 0; t < ticks && state.phase === "playing"; t++) tick(state, inputs, rng);
  state.events = state.events.filter((e) => e.at >= state.timeMs - EVENT_KEEP_MS);
  state.seq++;
  return state;
}

function tick(state: RtState, inputs: Record<number, RtInput>, rng: () => number) {
  const dt = RT_TICK_MS;
  state.timeMs += dt;
  if (state.timeMs >= state.nextWindMs) {
    state.wind = Math.round((rng() * 2 - 1) * 40 * MAPS[state.map].windMul) / 1000;
    state.nextWindMs += RT_WIND_EVERY_MS;
  }
  // Shields fade out.
  const expired = state.walls.filter((w) => w.shieldOf !== undefined && (state.shieldExpiry[w.id] ?? 0) <= state.timeMs);
  if (expired.length > 0) {
    state.walls = state.walls.filter((w) => !expired.includes(w));
    for (const w of expired) delete state.shieldExpiry[w.id];
    state.wallsVer++;
  }
  for (const p of state.players) {
    if (!p.alive) continue;
    movePlayer(state, p, inputs[p.seat] ?? NO_INPUT, dt);
    tickStatuses(state, p, dt);
  }

  // Projectiles.
  const minTerrain = minHeight(state.terrain);
  const bodies = state.players.map((p) => ({ seat: p.seat, x: p.x, y: p.y, alive: p.alive }));
  const survivors: RtProjectile[] = [];
  for (const pr of state.projectiles) {
    const owner = state.players[pr.owner];
    pr.f.homeX = owner.x;
    pr.f.homeY = owner.y - MUZZLE_Y;
    moveFlyer(pr.f, pr.stats, state.wind);
    const out = pr.f.tick > PROJECTILE_MAX_TICKS ? { impact: null, directSeat: null, wallStop: null } : collideFlyer(pr.f, pr.stats, state.terrain, bodies, state.walls, pr.owner, false, minTerrain);
    if (!out) {
      survivors.push(pr);
      continue;
    }
    if (out.caught) {
      pushEvent(state, { kind: "caught", seat: pr.owner, x: Math.round(pr.f.x), y: Math.round(pr.f.y) });
      continue;
    }
    if (!out.impact) continue;
    const r = resolveImpact(
      state.players,
      state.walls,
      state.terrain,
      state.map,
      pr.owner,
      pr.stats,
      { impact: out.impact, directSeat: out.directSeat, wallStop: out.wallStop, pierced: pr.f.pierced },
      rng(),
      rng,
      (st) => LIVE_DURATION_MS[st],
      RT_DAMAGE_SCALE,
    );
    if (r.terrain !== state.terrain) state.terrainVer++;
    if (r.walls.length !== state.walls.length || r.walls.some((w, i) => w.hp !== state.walls[i]?.hp)) state.wallsVer++;
    for (const id of r.wallsBroken) delete state.shieldExpiry[id];
    state.terrain = r.terrain;
    state.walls = r.walls;
    for (const h of r.hits) {
      if (h.seat === pr.owner) continue;
      owner.damageDealt += h.dmg;
      owner.bestHit = Math.max(owner.bestHit, h.dmg);
      // Knocked-back players fall back onto the terrain under their new spot.
      const victim = state.players[h.seat];
      victim.onGround = false;
    }
    if (r.killed.length > 0) state.deathGroups.push(r.killed);
    pushEvent(state, {
      kind: "boom",
      owner: pr.owner,
      x: Math.round(out.impact.x),
      y: Math.round(out.impact.y),
      weapon: pr.stats.kind,
      element: pr.stats.element,
      blast: pr.stats.blastRadius,
      ink: INK_COLORS[pr.stats.shape[0]?.c ?? 0],
      hits: r.hits,
      crit: r.crit,
      chainPath: r.chainPath,
      pelletPoints: r.pelletPoints,
      killed: r.killed,
      inflicted: r.inflicted,
      heal: r.heal,
      dirt: r.craterRadius > 0,
    });
  }
  state.projectiles = survivors;

  // DoT deaths.
  const dotDead = state.players.filter((p) => p.alive && p.hp <= 0);
  if (dotDead.length > 0) {
    for (const p of dotDead) p.alive = false;
    state.deathGroups.push(dotDead.map((p) => p.seat));
  }
  // Ground under living players may have been blown away.
  for (const p of state.players) if (p.alive && p.onGround && surfaceY(state.terrain, p.x) > p.y + MAX_STEP_UP) p.onGround = false;

  if (state.players.filter((p) => p.alive).length <= 1 || state.timeMs >= RT_MATCH_MS) {
    state.phase = "gameOver";
    state.projectiles = [];
  }
}

// ---------------------------------------------------------------------------
// Bots (host-side). One decision every few hundred ms; aim reuses the fast
// stop-mode flight search against the live positions.
// ---------------------------------------------------------------------------

export interface RtBotMemory {
  nextThinkMs: number;
  input: RtInput;
  preferred: number;
}

export function newBotMemory(rng: () => number): RtBotMemory {
  return { nextThinkMs: 0, input: { ...NO_INPUT }, preferred: 200 + rng() * 160 };
}

export function rtBotThink(state: RtState, seat: SeatIndex, level: number, mem: RtBotMemory, rng: () => number): RtCommand | null {
  const me = state.players[seat];
  if (!me.alive || state.phase !== "playing") {
    mem.input = { ...NO_INPUT };
    return null;
  }
  if (state.timeMs < mem.nextThinkMs) return null;
  mem.nextThinkMs = state.timeMs + 250 + rng() * 200;
  const enemies = state.players.filter((p) => p.alive && p.seat !== seat);
  if (enemies.length === 0) return null;
  const target = enemies.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a));

  // Movement: hold a preferred distance; dodge incoming doodles (stronger bots dodge more).
  const dist = target.x - me.x;
  // -1 = walk left, 1 = walk right, 0 = stand.
  let walk = 0;
  if (Math.abs(dist) < mem.preferred - 60) walk = dist > 0 ? -1 : 1;
  else if (Math.abs(dist) > mem.preferred + 80) walk = dist > 0 ? 1 : -1;
  let jump = false;
  const threat = state.projectiles.find((pr) => pr.owner !== seat && Math.abs(pr.f.x - me.x) < 140 && pr.f.vx * (me.x - pr.f.x) > 0);
  if (threat && rng() < 0.15 + level * 0.07) {
    jump = rng() < 0.5;
    walk = threat.f.vx > 0 ? 1 : -1;
  }
  if (me.x < 40) walk = 1;
  if (me.x > WORLD_W - 40) walk = -1;
  mem.input = { left: walk < 0, right: walk > 0, jump };
  if (rng() < 0.08) mem.preferred = 180 + rng() * 200;

  if (!canAct(me) || me.cooldownMs > 0) return null;
  // Think time between shots shrinks with level.
  if (rng() > 0.12 + level * 0.03) return null;

  if (me.hp < 40 && rng() < 0.25 && me.ink >= 40) {
    const strokes = botDoodle("bomb", 2, Math.min(me.ink, 50), rng);
    if (totalInk(strokes) >= MIN_INK) return { type: "shield", seat, strokes, angle: target.x < me.x ? 150 : 30 };
  }
  if (me.ink < 45) return null;
  const kind = BOT_WEAPON_KINDS[Math.floor(rng() * BOT_WEAPON_KINDS.length)];
  const strokes = botDoodle(kind, Math.floor(rng() * INK_COLORS.length) as Stroke["c"], Math.min(me.ink, 70), rng);
  if (totalInk(strokes) < MIN_INK || totalInk(strokes) > me.ink) return null;
  const stats = analyzeWeapon(strokes);
  const bodies = state.players.map((p) => ({ seat: p.seat, x: p.x, y: p.y, alive: p.alive }));
  let best: { angle: number; power: number; score: number } | null = null;
  const towards = target.x > me.x;
  for (let angle = towards ? 10 : 95; angle <= (towards ? 85 : 170); angle += 6) {
    for (let power = 25; power <= 100; power += 9) {
      const f = simulateFlight(state.terrain, bodies, state.walls, { seat, x: me.x, y: me.y, alive: true }, stats, angle, power, state.wind, true);
      if (!f.impact) continue;
      const dx = target.x - f.impact.x;
      const dy = target.y - PLAYER_R - f.impact.y;
      let score = -Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(f.impact.x - me.x) < stats.blastRadius + 30) score -= 200;
      if (!best || score > best.score) best = { angle, power, score };
    }
  }
  if (!best) return null;
  const wobble = Math.round((rng() * 2 - 1) * Math.max(0, 10 - level) * 1.5);
  return { type: "fire", seat, strokes, angle: Math.max(0, Math.min(180, best.angle + wobble)), power: best.power };
}

export { START_HP };
