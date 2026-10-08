/**
 * 🏃 Moving mode — what travels over the network and what the canvas draws.
 *
 * The host broadcasts compact `RtSnap`s (~12/s). Heavy, rarely-changing data
 * is only attached when it changed recently (terrain/walls by version) or
 * when a projectile was just spawned (its doodle shape), and clients cache
 * it. `RtClientBuffer` interpolates between the last two snapshots so remote
 * players and doodles glide instead of jumping 12 times a second.
 */

import type { Element, Stroke } from "./analyze";
import type { SeatIndex } from "./engine";
import type { MapId } from "./maps";
import type { Wall } from "./physics";
import { DEFAULT_RT_RULES, type RtEvent, type RtRules, type RtState } from "./realtime";
import type { StatusMap } from "./status";

export interface RtViewPlayer {
  seat: SeatIndex;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  status: StatusMap;
  ink: number;
  cooldownMs: number;
  shieldCdMs: number;
  facing: 1 | -1;
  damageDealt: number;
  bestHit: number;
}

export interface RtViewProjectile {
  id: number;
  owner: SeatIndex;
  x: number;
  y: number;
  c: number;
  s: number;
  element: Element;
  ink: number;
  shape: Stroke[] | null;
}

export interface RtView {
  timeMs: number;
  rules: RtRules;
  map: MapId;
  characters: number[];
  players: RtViewPlayer[];
  projectiles: RtViewProjectile[];
  terrain: number[];
  walls: Wall[];
  wind: number;
  phase: "playing" | "gameOver";
  deathGroups: SeatIndex[][];
  events: RtEvent[];
}

export interface RtSnap {
  t: number;
  rules?: RtRules;
  seq: number;
  /** Bumped every time a guest takes over the simulation after the host vanished. */
  epoch?: number;
  /** Seat currently running the simulation. */
  hostSeat?: number;
  map: MapId;
  characters: number[];
  players: RtViewPlayer[];
  projectiles: Omit<RtViewProjectile, "shape">[];
  shapes?: Record<number, Stroke[]>;
  terrainVer: number;
  terrain?: number[];
  wallsVer: number;
  walls?: Wall[];
  wind: number;
  phase: "playing" | "gameOver";
  deathGroups: SeatIndex[][];
  events: RtEvent[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function viewPlayers(s: RtState): RtViewPlayer[] {
  return s.players.map((p) => ({
    seat: p.seat,
    x: r1(p.x),
    y: r1(p.y),
    hp: Math.round(p.hp),
    alive: p.alive,
    status: Object.fromEntries(Object.entries(p.status).map(([k, v]) => [k, Math.round(v ?? 0)])) as StatusMap,
    ink: Math.floor(p.ink),
    cooldownMs: Math.round(p.cooldownMs),
    shieldCdMs: Math.round(p.shieldCdMs ?? 0),
    facing: p.facing,
    damageDealt: p.damageDealt,
    bestHit: p.bestHit,
  }));
}

/** Host side: the live state as a view (no copying of geometry). */
export function viewFromState(s: RtState): RtView {
  return {
    timeMs: s.timeMs,
    rules: s.rules ?? DEFAULT_RT_RULES,
    map: s.map,
    characters: s.characters,
    players: viewPlayers(s),
    projectiles: s.projectiles.map((pr) => ({ id: pr.id, owner: pr.owner, x: pr.f.x, y: pr.f.y, c: pr.f.c, s: pr.f.s, element: pr.stats.element, ink: pr.stats.shape[0]?.c ?? 0, shape: pr.stats.shape })),
    terrain: s.terrain,
    walls: s.walls,
    wind: s.wind,
    phase: s.phase,
    deathGroups: s.deathGroups,
    events: s.events,
  };
}

/**
 * Host side: a snapshot to broadcast. Geometry rides along when it changed
 * within the last ~1s (`geometryFresh`) or always when `full` (state-sync).
 */
export function snapFromState(s: RtState, opts: { full?: boolean; terrainFresh?: boolean; wallsFresh?: boolean }): RtSnap {
  const shapes: Record<number, Stroke[]> = {};
  for (const pr of s.projectiles) if (opts.full || s.timeMs - pr.spawnedAt < 900) shapes[pr.id] = pr.stats.shape;
  return {
    t: Math.round(s.timeMs),
    rules: s.rules,
    seq: s.seq,
    map: s.map,
    characters: s.characters,
    players: viewPlayers(s),
    projectiles: s.projectiles.map((pr) => ({ id: pr.id, owner: pr.owner, x: r1(pr.f.x), y: r1(pr.f.y), c: r2(pr.f.c), s: r2(pr.f.s), element: pr.stats.element, ink: pr.stats.shape[0]?.c ?? 0 })),
    ...(Object.keys(shapes).length > 0 ? { shapes } : {}),
    terrainVer: s.terrainVer,
    ...(opts.full || opts.terrainFresh ? { terrain: s.terrain } : {}),
    wallsVer: s.wallsVer,
    ...(opts.full || opts.wallsFresh ? { walls: s.walls } : {}),
    wind: s.wind,
    phase: s.phase,
    deathGroups: s.deathGroups,
    events: s.events.filter((e) => e.at >= s.timeMs - 1500),
  };
}

const INTERP_DELAY_MS = 110;

/** Client side: caches geometry/shapes and interpolates between snapshots. */
export class RtClientBuffer {
  private prev: { snap: RtSnap; at: number } | null = null;
  private curr: { snap: RtSnap; at: number } | null = null;
  private terrain: number[] = [];
  private terrainVer = -1;
  private walls: Wall[] = [];
  private wallsVer = -1;
  private shapes = new Map<number, Stroke[]>();
  private events = new Map<number, RtEvent>();

  push(snap: RtSnap, now: number) {
    if (this.curr) {
      const curEpoch = this.curr.snap.epoch ?? 0;
      const epoch = snap.epoch ?? 0;
      // A new simulation host restarts from a slightly older backup (lower seq): accept it by epoch.
      if (epoch < curEpoch || (epoch === curEpoch && snap.seq <= this.curr.snap.seq)) return;
      if (epoch > curEpoch) this.prev = null;
    }
    if (snap.terrain && snap.terrainVer >= this.terrainVer) {
      this.terrain = snap.terrain;
      this.terrainVer = snap.terrainVer;
    }
    if (snap.walls && snap.wallsVer >= this.wallsVer) {
      this.walls = snap.walls;
      this.wallsVer = snap.wallsVer;
    }
    if (snap.shapes) for (const [id, sh] of Object.entries(snap.shapes)) this.shapes.set(Number(id), sh);
    for (const e of snap.events) this.events.set(e.id, e);
    // Forget old events/shapes.
    for (const [id, e] of this.events) if (e.at < snap.t - 3000) this.events.delete(id);
    const live = new Set(snap.projectiles.map((p) => p.id));
    for (const id of this.shapes.keys()) if (!live.has(id) && !snap.shapes?.[id]) this.shapes.delete(id);
    this.prev = this.curr && (this.curr.snap.epoch ?? 0) === (snap.epoch ?? 0) ? this.curr : null;
    this.curr = { snap, at: now };
  }

  get ready(): boolean {
    return this.curr !== null && this.terrain.length > 0;
  }

  latest(): RtSnap | null {
    return this.curr?.snap ?? null;
  }

  view(now: number): RtView | null {
    if (!this.curr || this.terrain.length === 0) return null;
    const c = this.curr.snap;
    const p = this.prev?.snap ?? null;
    // Render slightly in the past and blend the two snapshots around that moment.
    const span = this.prev ? Math.max(1, this.curr.at - this.prev.at) : 1;
    const k = this.prev ? Math.max(0, Math.min(1.2, (now - INTERP_DELAY_MS - this.prev.at) / span)) : 1;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    const players = c.players.map((pl) => {
      const old = p?.players.find((q) => q.seat === pl.seat);
      return old && old.alive === pl.alive ? { ...pl, x: lerp(old.x, pl.x), y: lerp(old.y, pl.y) } : pl;
    });
    const projectiles = c.projectiles.map((pr) => {
      const old = p?.projectiles.find((q) => q.id === pr.id);
      const shape = this.shapes.get(pr.id) ?? null;
      return old ? { ...pr, x: lerp(old.x, pr.x), y: lerp(old.y, pr.y), shape } : { ...pr, shape };
    });
    return {
      timeMs: lerp(p?.t ?? c.t, c.t),
      rules: c.rules ?? DEFAULT_RT_RULES,
      map: c.map,
      characters: c.characters,
      players,
      projectiles,
      terrain: this.terrain,
      walls: this.walls,
      wind: c.wind,
      phase: c.phase,
      deathGroups: c.deathGroups,
      events: [...this.events.values()],
    };
  }
}
