/**
 * Pure simulation for 배고픈 상어 — no DOM, no canvas, no Math.random
 * (a seeded mulberry32 lives on the world so runs are reproducible in tests).
 *
 * Maps onto the spec's Unity modules:
 *   SharkController/SharkMotor  → `stepShark`
 *   SharkBiteCollider           → `resolveBites` + `resolveContacts`
 *   FishBoidAgent               → `updateBoid`
 *   EnemySharkAI (FSM)          → `updateHunter`
 *   Mine / Jellyfish            → `explode` / poison status
 *   EntityPoolManager/ZoneSpawner → `acquire`/`release` + `runSpawner`
 *   EventBus                    → `world.events` (drained by the UI each frame)
 */

import {
  COMBO_WINDOW,
  comboMultiplier,
  drainPerSecond,
  effectiveStats,
  ENTITY_DEFS,
  explosionDamage,
  GOLD_GAUGE_RATE,
  GOLD_RUSH_DURATION,
  goldGaugeCapacity,
  goldRushMultiplier,
  healGain,
  MEGA_EVERY,
  MEGA_GOLD_RUSH_DURATION,
  mineExplosionRadius,
  MISSIONS,
  NEVER,
  POISON_DURATION,
  POISON_SLOW,
  POISON_TICK,
  populationTargets,
  seabedY,
  SKY_TOP,
  SURFACE_Y,
  UNITS_PER_METER,
  WORLD_W,
  type EffectiveStats,
  type EntityDef,
  type EntityKind,
  type MissionId,
  type SharkDef,
  type UpgradeLevels,
} from "./data";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Entity {
  id: number;
  kind: EntityKind;
  def: EntityDef;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Remaining bite HP (starts at def.toughness). */
  hp: number;
  /** Free-running phase for bobbing/animation. */
  phase: number;
  /** Generic timer: wander re-roll, weapon reload, lifetime... */
  timer: number;
  attackCd: number;
  hitFlash: number;
  homeY: number;
  dir: 1 | -1;
  state: "patrol" | "chase" | "flee";
}

export type ParticleKind = "blood" | "chunk" | "bubble" | "splash" | "spark" | "smoke" | "coin" | "flash" | "gold";

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

export interface SharkState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heading in radians, 0 = facing +x (right). */
  angle: number;
  hp: number;
  boost: number;
  boosting: boolean;
  airborne: boolean;
  /** Jaw animation: >0 while the mouth is closing on something (seconds). */
  jaw: number;
  biteCooldown: number;
  poison: { remaining: number; tick: number; pct: number } | null;
  hurtFlash: number;
  invuln: number;
}

export type GameEvent =
  | { type: "eat"; kind: EntityKind; x: number; y: number; points: number }
  | { type: "bite"; x: number; y: number }
  | { type: "hurt"; amount: number }
  | { type: "poison" }
  | { type: "bounce" }
  | { type: "explode"; x: number; y: number; big: boolean }
  | { type: "jumpOut" }
  | { type: "splash"; strength: number }
  | { type: "goldStart"; mega: boolean; multiplier: number }
  | { type: "goldEnd" }
  | { type: "coin"; amount: number }
  | { type: "chest"; amount: number }
  | { type: "mission"; label: string; reward: number }
  | { type: "torpedo" }
  | { type: "death"; cause: string };

export interface MissionState {
  id: MissionId;
  label: string;
  goal: number;
  progress: number;
  reward: number;
  done: boolean;
}

export interface RunStats {
  eaten: Partial<Record<EntityKind, number>>;
  fish: number;
  humans: number;
  bigKills: number;
  chests: number;
  jumps: number;
  maxDepth: number;
  rushes: number;
  megaRushes: number;
  bestCombo: number;
  damageTaken: number;
}

export interface GoldRushState {
  gauge: number;
  capacity: number;
  active: boolean;
  mega: boolean;
  remaining: number;
  duration: number;
  count: number;
  multiplier: number;
}

export interface World {
  seed: number;
  rngState: number;
  time: number;
  def: SharkDef;
  stats: EffectiveStats;
  shark: SharkState;
  entities: Entity[];
  pool: Entity[];
  nextId: number;
  particles: Particle[];
  texts: FloatText[];
  score: number;
  coins: number;
  combo: number;
  comboTimer: number;
  gold: GoldRushState;
  shake: number;
  events: GameEvent[];
  missions: MissionState[];
  run: RunStats;
  over: boolean;
  deathCause: string | null;
  spawnTimer: number;
  bounceCd: number;
}

export interface SharkInput {
  /** Desired swim direction (need not be normalized); (0,0) = no input. */
  dirX: number;
  dirY: number;
  boost: boolean;
}

// ── Tunables ────────────────────────────────────────────────────────────────

export const GRAVITY = 1100;
export const BREACH_BONUS = 1.35;
const ACTIVE_RADIUS = 1900;
const DESPAWN_DX = 2700;
const DESPAWN_DY = 2100;
const SPAWN_MIN = 950;
const SPAWN_MAX = 1800;
const MAX_PARTICLES = 700;
const CELL = 120;
const FLEE_BASE = 200;
const NEIGHBOR_R = 46;
const CHEST_COUNT = 7;

// ── RNG ─────────────────────────────────────────────────────────────────────

export function rand(w: World): number {
  let t = (w.rngState = (w.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (w: World, a: number, b: number) => a + rand(w) * (b - a);

// ── Construction ────────────────────────────────────────────────────────────

export function createWorld(def: SharkDef, upgrades: UpgradeLevels, seed = Date.now() & 0x7fffffff): World {
  const stats = effectiveStats(def, upgrades);
  const w: World = {
    seed,
    rngState: seed | 0,
    time: 0,
    def,
    stats,
    shark: {
      x: 1400,
      y: 260,
      vx: 0,
      vy: 0,
      angle: 0,
      hp: stats.maxHealth,
      boost: stats.boostDuration,
      boosting: false,
      airborne: false,
      jaw: 0,
      biteCooldown: 0,
      poison: null,
      hurtFlash: 0,
      invuln: 0,
    },
    entities: [],
    pool: [],
    nextId: 1,
    particles: [],
    texts: [],
    score: 0,
    coins: 0,
    combo: 0,
    comboTimer: 0,
    gold: {
      gauge: 0,
      capacity: goldGaugeCapacity(def.tier),
      active: false,
      mega: false,
      remaining: 0,
      duration: GOLD_RUSH_DURATION,
      count: 0,
      multiplier: 1,
    },
    shake: 0,
    events: [],
    missions: [],
    run: {
      eaten: {},
      fish: 0,
      humans: 0,
      bigKills: 0,
      chests: 0,
      jumps: 0,
      maxDepth: 0,
      rushes: 0,
      megaRushes: 0,
      bestCombo: 0,
      damageTaken: 0,
    },
    over: false,
    deathCause: null,
    spawnTimer: 0,
    bounceCd: 0,
  };

  // Three distinct missions, goal difficulty scaled by tier.
  const pool = [...MISSIONS];
  const goalIdx = Math.min(2, Math.floor((def.tier - 1) / 2));
  for (let i = 0; i < 3 && pool.length; i++) {
    const m = pool.splice(Math.floor(rand(w) * pool.length), 1)[0];
    const goal = m.goals[goalIdx];
    w.missions.push({ id: m.id, label: m.label(goal), goal, progress: 0, reward: m.reward * (1 + goalIdx), done: false });
  }

  // Treasure chests: fixed seabed spots for this run (not respawned).
  for (let i = 0; i < CHEST_COUNT; i++) {
    const x = ((i + 0.5) / CHEST_COUNT) * WORLD_W + range(w, -300, 300);
    const e = spawn(w, "chest", x, 0);
    e.y = seabedY(x) - e.def.radius + 4;
  }

  // Initial population so the first seconds aren't empty.
  for (let i = 0; i < 40; i++) runSpawner(w, true);
  return w;
}

// ── Pooling ─────────────────────────────────────────────────────────────────

function spawn(w: World, kind: EntityKind, x: number, y: number): Entity {
  const def = ENTITY_DEFS[kind];
  const e = w.pool.pop() ?? ({} as Entity);
  e.id = w.nextId++;
  e.kind = kind;
  e.def = def;
  e.alive = true;
  e.x = x;
  e.y = y;
  e.dir = rand(w) < 0.5 ? -1 : 1;
  e.vx = def.speed * 0.5 * e.dir;
  e.vy = 0;
  e.angle = e.dir > 0 ? 0 : Math.PI;
  e.hp = def.toughness;
  e.phase = rand(w) * Math.PI * 2;
  e.timer = range(w, 0.5, 3);
  e.attackCd = 0;
  e.hitFlash = 0;
  e.homeY = y;
  e.state = "patrol";
  w.entities.push(e);
  return e;
}

function release(w: World, e: Entity) {
  e.alive = false;
}

/** Sweeps dead entities back into the pool (called once per step). */
function compact(w: World) {
  let j = 0;
  for (let i = 0; i < w.entities.length; i++) {
    const e = w.entities[i];
    if (e.alive) w.entities[j++] = e;
    else w.pool.push(e);
  }
  w.entities.length = j;
}

// ── Spatial hash ────────────────────────────────────────────────────────────

const grid = new Map<number, Entity[]>();
const gridKey = (cx: number, cy: number) => cx * 4096 + (cy + 64);

function buildGrid(w: World) {
  for (const arr of grid.values()) arr.length = 0;
  for (const e of w.entities) {
    if (!e.alive) continue;
    const k = gridKey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(e);
  }
}

function queryGrid(x: number, y: number, r: number, out: Entity[]): Entity[] {
  out.length = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) {
      const arr = grid.get(gridKey(cx, cy));
      if (arr) for (const e of arr) if (e.alive) out.push(e);
    }
  return out;
}

const scratchA: Entity[] = [];
const scratchB: Entity[] = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function sharkTier(w: World): number {
  return w.def.tier;
}

/** Can the player currently eat this entity? (spec §1-3 + Mega Gold Rush) */
export function isEdible(w: World, e: Entity): boolean {
  if (w.gold.active && w.gold.mega) return true;
  return e.def.requiredTier <= w.def.tier;
}

/** Is this entity currently a threat to the player (for AI + drawing warnings)? */
export function isDangerous(w: World, e: Entity): boolean {
  if (w.gold.active) return false;
  return !isEdible(w, e) && e.def.damage > 0;
}

export function mouthPos(w: World): { x: number; y: number } {
  const s = w.shark;
  const L = w.stats.length * 0.46;
  return { x: s.x + Math.cos(s.angle) * L, y: s.y + Math.sin(s.angle) * L };
}

export function depthMeters(y: number): number {
  return Math.max(0, Math.round(y / UNITS_PER_METER));
}

function angleLerp(a: number, b: number, maxStep: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

function addParticle(w: World, p: Particle) {
  if (w.particles.length >= MAX_PARTICLES) w.particles.shift();
  w.particles.push(p);
}

function burst(
  w: World,
  kind: ParticleKind,
  x: number,
  y: number,
  n: number,
  speed: number,
  color: string,
  size: number,
  life: number,
  gravity = 0,
) {
  for (let i = 0; i < n; i++) {
    const a = rand(w) * Math.PI * 2;
    const v = speed * (0.3 + rand(w) * 0.7);
    const l = life * (0.6 + rand(w) * 0.6);
    addParticle(w, {
      kind,
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: l,
      maxLife: l,
      size: size * (0.6 + rand(w) * 0.8),
      color,
      gravity,
    });
  }
}

function floatText(w: World, x: number, y: number, text: string, color: string, size = 18) {
  w.texts.push({ x, y, text, color, life: 1.2, size });
  if (w.texts.length > 40) w.texts.shift();
}

// ── Main step ───────────────────────────────────────────────────────────────

export function step(w: World, input: SharkInput, rawDt: number): void {
  if (w.over) return;
  const dt = Math.min(0.05, Math.max(0, rawDt));
  w.time += dt;

  stepShark(w, input, dt);
  if (w.over) return;
  buildGrid(w);
  updateEntities(w, dt);
  buildGrid(w);
  resolveBites(w);
  resolveContacts(w, dt);
  updateGoldRush(w, dt);
  updateCombo(w, dt);
  updateParticles(w, dt);
  updateMissions(w);

  w.spawnTimer -= dt;
  if (w.spawnTimer <= 0) {
    w.spawnTimer = 0.2;
    runSpawner(w, false);
    despawnFar(w);
  }
  compact(w);
  w.shake = Math.max(0, w.shake - dt * 30);
  w.bounceCd = Math.max(0, w.bounceCd - dt);

  if (w.shark.hp <= 0) killShark(w, w.deathCause ?? "굶주림");
}

function killShark(w: World, cause: string) {
  if (w.over) return;
  w.shark.hp = 0;
  w.over = true;
  w.deathCause = cause;
  burst(w, "blood", w.shark.x, w.shark.y, 40, 220, "#b91c1c", 7, 1.4);
  w.events.push({ type: "death", cause });
}

// ── Shark motor (spec §3) ───────────────────────────────────────────────────

function stepShark(w: World, input: SharkInput, dt: number) {
  const s = w.shark;
  const st = w.stats;
  const tier = w.def.tier;
  const mag = Math.hypot(input.dirX, input.dirY);
  const wasAirborne = s.airborne;

  s.jaw = Math.max(0, s.jaw - dt);
  s.biteCooldown = Math.max(0, s.biteCooldown - dt);
  s.hurtFlash = Math.max(0, s.hurtFlash - dt);
  s.invuln = Math.max(0, s.invuln - dt);

  if (!s.airborne) {
    const turnRate = 5.2 - tier * 0.32;
    let speed = st.swimSpeed;
    if (s.poison) speed *= 1 - POISON_SLOW;
    const canBoost = input.boost && mag > 0.01 && (w.gold.active || s.boost > 0.05);
    s.boosting = canBoost;
    if (canBoost) {
      speed *= st.boostMultiplier;
      if (!w.gold.active) s.boost = Math.max(0, s.boost - dt);
      if (rand(w) < 0.5) {
        const tail = w.stats.length * 0.5;
        addParticle(w, {
          kind: "bubble",
          x: s.x - Math.cos(s.angle) * tail,
          y: s.y - Math.sin(s.angle) * tail,
          vx: range(w, -20, 20),
          vy: range(w, -60, -20),
          life: 0.9,
          maxLife: 0.9,
          size: range(w, 2, 4.5),
          color: "#e0f2fe",
          gravity: 0,
        });
      }
    } else {
      s.boost = Math.min(st.boostDuration, s.boost + dt * st.boostRegen);
    }

    let targetVx: number, targetVy: number;
    if (mag > 0.01) {
      s.angle = angleLerp(s.angle, Math.atan2(input.dirY, input.dirX), turnRate * dt * (canBoost ? 0.8 : 1));
      targetVx = Math.cos(s.angle) * speed;
      targetVy = Math.sin(s.angle) * speed;
    } else {
      // Idle cruise: keep drifting slowly along the current heading.
      targetVx = Math.cos(s.angle) * speed * 0.18;
      targetVy = Math.sin(s.angle) * speed * 0.18;
    }
    const k = Math.min(1, dt * (mag > 0.01 ? 4 : 2));
    s.vx += (targetVx - s.vx) * k;
    s.vy += (targetVy - s.vy) * k;
  } else {
    // Airborne: ballistic under gravity, only a little mid-air rotation control.
    s.boosting = false;
    s.vy += GRAVITY * dt;
    s.vx *= 1 - 0.15 * dt;
    s.angle = angleLerp(s.angle, Math.atan2(s.vy, s.vx), 3 * dt);
    s.boost = Math.min(st.boostDuration, s.boost + dt * st.boostRegen * 0.5);
  }

  s.x += s.vx * dt;
  s.y += s.vy * dt;

  // Water volume transitions (spec §6-1).
  if (!wasAirborne && s.y < SURFACE_Y - 2) {
    s.airborne = true;
    // Breaching bonus so a boosted jump can actually reach pelicans/helicopters.
    if (s.vy < 0) s.vy *= s.boosting || w.gold.active ? BREACH_BONUS : 1.1;
    w.run.jumps++;
    burst(w, "splash", s.x, SURFACE_Y, 18, 260, "#e0f2fe", 4, 0.8, 700);
    w.events.push({ type: "jumpOut" });
  } else if (wasAirborne && s.y >= SURFACE_Y) {
    s.airborne = false;
    const steep = Math.abs(Math.sin(s.angle));
    const keep = 0.35 + 0.3 * steep; // belly-flops lose more speed than dives
    const strength = Math.min(1, Math.hypot(s.vx, s.vy) / 900);
    s.vx *= keep;
    s.vy *= keep;
    burst(w, "splash", s.x, SURFACE_Y, 14 + Math.round(strength * 22), 320, "#f0f9ff", 5, 0.9, 700);
    burst(w, "bubble", s.x, SURFACE_Y + 30, 12, 120, "#e0f2fe", 3.5, 1.1);
    w.events.push({ type: "splash", strength });
  }

  // World bounds.
  const r = w.stats.length * 0.3;
  if (s.x < r) { s.x = r; s.vx = Math.abs(s.vx) * 0.3; }
  if (s.x > WORLD_W - r) { s.x = WORLD_W - r; s.vx = -Math.abs(s.vx) * 0.3; }
  const floor = seabedY(s.x) - r;
  if (s.y > floor) { s.y = floor; s.vy = Math.min(0, s.vy); }
  if (s.y < SKY_TOP + 40) { s.y = SKY_TOP + 40; s.vy = Math.max(0, s.vy); }

  w.run.maxDepth = Math.max(w.run.maxDepth, depthMeters(s.y));

  // Starvation (spec §1-1) — paused during Gold Rush.
  if (!w.gold.active) {
    s.hp -= drainPerSecond(st.baseDrainRate, w.time) * dt;
    if (s.hp <= 0) w.deathCause = "굶주림";
  }

  // Jellyfish poison DoT (spec §6-2).
  if (s.poison) {
    s.poison.remaining -= dt;
    s.poison.tick -= dt;
    if (s.poison.tick <= 0) {
      s.poison.tick += POISON_TICK;
      if (!w.gold.active) hurt(w, st.maxHealth * s.poison.pct, "해파리 독", true);
    }
    if (s.poison.remaining <= 0) s.poison = null;
  }
}

function hurt(w: World, amount: number, cause: string, silent = false) {
  if (w.gold.active || amount <= 0) return;
  const s = w.shark;
  s.hp -= amount;
  s.hurtFlash = 0.35;
  w.run.damageTaken += amount;
  w.shake = Math.max(w.shake, silent ? 3 : Math.min(18, 6 + amount / 5));
  floatText(w, s.x, s.y - 30, `-${Math.round(amount)}`, "#f87171", silent ? 14 : 20);
  if (!silent) burst(w, "blood", s.x, s.y, 10, 160, "#dc2626", 4, 0.8);
  w.events.push({ type: "hurt", amount });
  if (s.hp <= 0) w.deathCause = cause;
}

// ── Entity AI ───────────────────────────────────────────────────────────────

function updateEntities(w: World, dt: number) {
  const s = w.shark;
  for (const e of w.entities) {
    if (!e.alive) continue;
    e.phase += dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.attackCd = Math.max(0, e.attackCd - dt);
    const dx = e.x - s.x, dy = e.y - s.y;
    const far = Math.abs(dx) > ACTIVE_RADIUS || Math.abs(dy) > ACTIVE_RADIUS;
    // Zone culling: distant entities are frozen (spec §7).
    if (far && e.def.behavior !== "rock" && e.def.behavior !== "torpedo") continue;
    const dist = Math.hypot(dx, dy) || 1;
    switch (e.def.behavior) {
      case "boid": updateBoid(w, e, dist, dx, dy, dt); break;
      case "crawl": {
        e.timer -= dt;
        if (e.timer <= 0) { e.timer = range(w, 1.5, 4); e.dir = rand(w) < 0.5 ? -1 : 1; }
        const fleeing = dist < 260 && isEdible(w, e);
        const sp = e.def.speed * (fleeing ? 2 : 1);
        e.x += (fleeing ? Math.sign(dx) || e.dir : e.dir) * sp * dt;
        e.y = seabedY(e.x) - e.def.radius + 3;
        break;
      }
      case "surfaceSwim": {
        const panic = dist < 320;
        e.timer -= dt;
        if (e.timer <= 0) { e.timer = range(w, 2, 5); e.dir = rand(w) < 0.5 ? -1 : 1; }
        const d = panic ? Math.sign(dx) || e.dir : e.dir;
        e.x += d * e.def.speed * (panic ? 1.7 : 1) * dt;
        e.y = SURFACE_Y + 5 + Math.sin(e.phase * 2) * 2.5;
        e.angle = d > 0 ? 0 : Math.PI;
        break;
      }
      case "wander": updateWander(w, e, dist, dx, dy, dt); break;
      case "jelly": {
        e.y = e.homeY + Math.sin(e.phase * 0.9) * 26;
        e.x += Math.sin(e.phase * 0.3) * e.def.speed * dt;
        break;
      }
      case "mine": e.y = e.homeY + Math.sin(e.phase * 1.2) * 5; break;
      case "fly": {
        e.x += e.dir * e.def.speed * dt;
        // Periodic dives toward the surface to scoop fish.
        e.y = e.homeY + (Math.sin(e.phase * 0.7) > 0.6 ? (SURFACE_Y - 12 - e.homeY) * (Math.sin(e.phase * 0.7) - 0.6) * 2.5 : 0);
        if (e.x < 60 || e.x > WORLD_W - 60) e.dir = e.x < 60 ? 1 : -1;
        e.angle = e.dir > 0 ? 0 : Math.PI;
        break;
      }
      case "surfaceBoat": {
        e.x += e.dir * e.def.speed * dt;
        e.y = SURFACE_Y - 4 + Math.sin(e.phase * 1.3) * 3;
        if (e.x < 150 || e.x > WORLD_W - 150) e.dir = e.x < 150 ? 1 : -1;
        e.angle = e.dir > 0 ? 0 : Math.PI;
        break;
      }
      case "hunter": updateHunter(w, e, dist, dx, dy, dt); break;
      case "torpedo": {
        const want = Math.atan2(-dy, -dx);
        e.angle = angleLerp(e.angle, want, 1.5 * dt);
        e.vx = Math.cos(e.angle) * e.def.speed;
        e.vy = Math.sin(e.angle) * e.def.speed;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.timer -= dt;
        if (rand(w) < 0.6)
          addParticle(w, { kind: "bubble", x: e.x - Math.cos(e.angle) * 12, y: e.y - Math.sin(e.angle) * 12, vx: 0, vy: -30, life: 0.6, maxLife: 0.6, size: 2.5, color: "#e2e8f0", gravity: 0 });
        if (e.timer <= 0 || e.y < SURFACE_Y || e.y > seabedY(e.x)) explode(w, e);
        break;
      }
      case "sub": {
        e.x += e.dir * e.def.speed * dt;
        e.y = e.homeY + Math.sin(e.phase * 0.4) * 30;
        if (e.x < 200 || e.x > WORLD_W - 200) e.dir = e.x < 200 ? 1 : -1;
        e.angle = e.dir > 0 ? 0 : Math.PI;
        e.timer -= dt;
        if (e.timer <= 0) {
          e.timer = range(w, 3.5, 5.5);
          if (dist < 850 && w.def.tier <= 5 && !w.shark.airborne) {
            const t = spawn(w, "torpedo", e.x + e.dir * 50, e.y + 10);
            t.angle = Math.atan2(-dy, -dx);
            t.timer = 6;
            w.events.push({ type: "torpedo" });
          }
        }
        break;
      }
      case "heli": {
        e.timer -= dt;
        if (e.timer <= 0) { e.timer = range(w, 3, 7); e.dir = rand(w) < 0.5 ? -1 : 1; }
        e.x += e.dir * e.def.speed * dt;
        e.y = e.homeY + Math.sin(e.phase * 1.1) * 18;
        if (e.x < 150 || e.x > WORLD_W - 150) e.dir = e.x < 150 ? 1 : -1;
        e.angle = e.dir > 0 ? 0 : Math.PI;
        break;
      }
      case "rock": {
        e.vy += 240 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.angle += dt * 2;
        if (rand(w) < 0.4)
          addParticle(w, { kind: "smoke", x: e.x, y: e.y, vx: range(w, -10, 10), vy: -20, life: 1, maxLife: 1, size: range(w, 4, 8), color: "#44403c", gravity: 0 });
        if (e.y > seabedY(e.x) - e.def.radius) {
          burst(w, "smoke", e.x, e.y, 8, 90, "#57534e", 7, 1.2);
          burst(w, "spark", e.x, e.y, 8, 200, "#fb923c", 3, 0.5);
          release(w, e);
        }
        break;
      }
      case "static": break;
    }
    // Keep swimmers inside the water column.
    const b = e.def.behavior;
    if (b === "boid" || b === "wander" || b === "hunter" || b === "jelly" || b === "sub") {
      const floor = seabedY(e.x) - e.def.radius - 6;
      if (e.y > floor) { e.y = floor; e.vy = -Math.abs(e.vy) * 0.5; }
      if (e.y < SURFACE_Y + e.def.radius + 6) { e.y = SURFACE_Y + e.def.radius + 6; e.vy = Math.abs(e.vy) * 0.5; }
    }
    // Nobody may leave the world horizontally (fleeing swimmers/crabs used to
    // run off the left edge and become uncatchable forever).
    if (e.x < 20) { e.x = 20; e.vx = Math.abs(e.vx); e.dir = 1; }
    else if (e.x > WORLD_W - 20) { e.x = WORLD_W - 20; e.vx = -Math.abs(e.vx); e.dir = -1; }
  }
}

/** Boids (spec §5): separation + alignment + cohesion + evade (priority). */
function updateBoid(w: World, e: Entity, dist: number, dx: number, dy: number, dt: number) {
  let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, n = 0;
  const neighbors = queryGrid(e.x, e.y, NEIGHBOR_R, scratchA);
  for (const o of neighbors) {
    if (o === e || o.kind !== e.kind) continue;
    const ox = e.x - o.x, oy = e.y - o.y;
    const d2 = ox * ox + oy * oy;
    if (d2 > NEIGHBOR_R * NEIGHBOR_R) continue;
    sepX += ox / (d2 + 0.001) * 30;
    sepY += oy / (d2 + 0.001) * 30;
    aliX += o.vx; aliY += o.vy;
    cohX += o.x; cohY += o.y;
    n++;
  }
  let ax = 0, ay = 0;
  if (n > 0) {
    const al = Math.hypot(aliX, aliY) || 1;
    const cx = cohX / n - e.x, cy = cohY / n - e.y;
    const cl = Math.hypot(cx, cy) || 1;
    ax += sepX * 1.5 + (aliX / al) * 1.0 * 60 + (cx / cl) * 1.0 * 40;
    ay += sepY * 1.5 + (aliY / al) * 1.0 * 60 + (cy / cl) * 1.0 * 40;
  }
  // Drift back toward the school's home depth + gentle wander.
  ay += (e.homeY - e.y) * 0.15;
  e.timer -= dt;
  if (e.timer <= 0) { e.timer = range(w, 2, 5); e.dir = rand(w) < 0.5 ? -1 : 1; }
  ax += e.dir * 25;

  const fleeR = FLEE_BASE + w.stats.length * 0.8;
  const fleeing = dist < fleeR && (isEdible(w, e) || w.gold.active);
  if (fleeing) {
    const f = ((fleeR - dist) / fleeR) * 700;
    ax += (dx / dist) * f;
    ay += (dy / dist) * f;
  }
  e.vx += ax * dt;
  e.vy += ay * dt;
  const lim = e.def.speed * (fleeing ? 1.45 : 1);
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > lim) { e.vx = (e.vx / sp) * lim; e.vy = (e.vy / sp) * lim; }
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  if (sp > 5) e.angle = Math.atan2(e.vy, e.vx);
}

function updateWander(w: World, e: Entity, dist: number, dx: number, dy: number, dt: number) {
  e.timer -= dt;
  if (e.timer <= 0) {
    e.timer = range(w, 1.5, 4);
    const a = (rand(w) - 0.5) * 1.2 + (rand(w) < 0.5 ? 0 : Math.PI);
    e.vx = Math.cos(a) * e.def.speed * 0.6;
    e.vy = Math.sin(a) * e.def.speed * 0.3;
  }
  // Stay near the spawn depth band.
  const [lo, hi] = e.def.depth;
  if (e.y < lo) e.vy += 40 * dt;
  if (e.y > hi) e.vy -= 40 * dt;
  let mx = e.vx, my = e.vy;
  const fleeR = FLEE_BASE + 80 + w.stats.length;
  if (dist < fleeR && (isEdible(w, e) || w.gold.active)) {
    mx = (dx / dist) * e.def.speed * 1.25;
    my = (dy / dist) * e.def.speed * 1.25;
  }
  e.x += mx * dt;
  e.y += my * dt;
  if (Math.abs(mx) > 1) e.angle = Math.atan2(my * 0.4, mx);
}

/** Enemy shark / anglerfish FSM: patrol → chase (if player is prey) / flee (if predator). */
function updateHunter(w: World, e: Entity, dist: number, dx: number, dy: number, dt: number) {
  const danger = isDangerous(w, e);
  const aggro = e.kind === "angler" ? 360 : e.kind === "ghostShark" ? 600 : 440;
  if (danger && dist < aggro && !w.shark.airborne && e.attackCd <= 0.4) {
    // Stamina: a chase lasts ~5s, then the hunter tires and backs off.
    if (e.state !== "chase") e.timer = 5;
    e.state = "chase";
  } else if (!danger && dist < 480) e.state = "flee";
  else if (dist > aggro * 1.4 || (!danger && e.state === "chase")) e.state = "patrol";
  if (e.state === "chase") {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = "patrol";
      e.attackCd = 3;
      e.timer = 2;
    }
  }

  let tx: number, ty: number, sp: number;
  if (e.state === "chase") {
    tx = -dx / dist; ty = -dy / dist; sp = e.def.speed;
  } else if (e.state === "flee") {
    tx = dx / dist; ty = dy / dist; sp = e.def.speed * 0.95;
  } else {
    e.timer -= dt;
    if (e.timer <= 0) { e.timer = range(w, 2, 5); e.dir = rand(w) < 0.5 ? -1 : 1; }
    tx = e.dir; ty = (e.homeY - e.y) * 0.004; sp = e.def.speed * 0.4;
  }
  const want = Math.atan2(ty, tx);
  e.angle = angleLerp(e.angle, want, 2.6 * dt);
  const k = Math.min(1, dt * 3);
  e.vx += (Math.cos(e.angle) * sp - e.vx) * k;
  e.vy += (Math.sin(e.angle) * sp - e.vy) * k;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

// ── Bite engine (spec §4) ───────────────────────────────────────────────────

function resolveBites(w: World) {
  const s = w.shark;
  const m = mouthPos(w);
  const hx = Math.cos(s.angle), hy = Math.sin(s.angle);
  const reach = w.stats.eatRadius;
  for (const e of queryGrid(m.x, m.y, reach + 70, scratchB)) {
    if (!e.alive) continue;
    const dx = e.x - m.x, dy = e.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d > reach + e.def.radius) continue;
    // Forward cone check: dot(heading, dir-to-prey from body center) ≥ 0.25.
    const bx = e.x - s.x, by = e.y - s.y;
    const bl = Math.hypot(bx, by) || 1;
    if ((hx * bx + hy * by) / bl < 0.25) continue;
    if (!isEdible(w, e)) continue; // tier too low → handled by contact (damage/bounce)
    if (e.hp <= 1 || (w.gold.active && w.gold.mega)) {
      consume(w, e);
    } else if (s.biteCooldown <= 0) {
      s.biteCooldown = 0.28;
      s.jaw = 0.22;
      e.hp -= w.stats.biteForce * (w.gold.active ? 2 : 1);
      e.hitFlash = 0.15;
      burst(w, e.y < SURFACE_Y + 6 ? "chunk" : "blood", e.x, e.y, 6, 150, e.y < SURFACE_Y + 6 ? "#78716c" : "#dc2626", 4, 0.7);
      w.shake = Math.max(w.shake, 4);
      w.events.push({ type: "bite", x: e.x, y: e.y });
      if (e.hp <= 0) consume(w, e);
    }
  }
}

function consume(w: World, e: Entity) {
  const s = w.shark;
  const def = e.def;
  const goldOn = w.gold.active;
  w.combo++;
  w.comboTimer = COMBO_WINDOW;
  w.run.bestCombo = Math.max(w.run.bestCombo, w.combo);
  const cm = comboMultiplier(w.combo);
  const mult = cm * (goldOn ? w.gold.multiplier : 1);
  const points = Math.round(def.score * mult);
  w.score += points;
  if (!goldOn) w.gold.gauge += def.score * cm * GOLD_GAUGE_RATE;

  if (goldOn) s.hp = w.stats.maxHealth;
  else s.hp = Math.min(w.stats.maxHealth, s.hp + healGain(def.heal, w.stats.biteLevel));

  let coins = 0;
  if (e.kind === "chest") {
    coins = def.coins + Math.floor(rand(w) * 80);
    w.run.chests++;
    w.events.push({ type: "chest", amount: coins });
    burst(w, "gold", e.x, e.y, 30, 260, "#facc15", 4, 1.2);
  } else if (goldOn) coins = Math.max(1, def.coins) * (w.gold.mega ? 2 : 1);
  else if (rand(w) < def.coinChance) coins = def.coins;
  if (coins > 0) {
    w.coins += coins;
    w.events.push({ type: "coin", amount: coins });
    burst(w, "coin", e.x, e.y, Math.min(10, 2 + coins), 140, "#fde047", 3.5, 0.9, -40);
  }

  w.run.eaten[e.kind] = (w.run.eaten[e.kind] ?? 0) + 1;
  if (e.kind === "smallFish" || e.kind === "grouper" || e.kind === "tuna" || e.kind === "ray" || e.kind === "puffer") w.run.fish++;
  if (def.human) w.run.humans++;
  if (def.toughness > 1) w.run.bigKills++;

  s.jaw = 0.22;
  const big = def.radius > 20;
  const underwater = e.y > SURFACE_Y;
  burst(w, underwater ? "blood" : "chunk", e.x, e.y, big ? 26 : 8, big ? 240 : 120, underwater ? "#b91c1c" : "#a8a29e", big ? 6 : 3.5, big ? 1.2 : 0.7, underwater ? 0 : 500);
  if (big) {
    burst(w, "chunk", e.x, e.y, 10, 220, "#7f1d1d", 5, 1.1, 120);
    w.shake = Math.max(w.shake, 10);
  }
  floatText(w, e.x, e.y - 14, `+${points.toLocaleString()}`, goldOn ? "#fde047" : "#ffffff", big ? 24 : 16);

  // Wrecking a boat throws its crew/passengers into the water.
  if (e.kind === "fishingBoat" || e.kind === "yacht") {
    const n = 2 + Math.floor(rand(w) * 2);
    for (let i = 0; i < n; i++) spawn(w, e.kind === "yacht" ? "passenger" : "sailor", e.x + range(w, -50, 50), SURFACE_Y + 5);
    burst(w, "chunk", e.x, e.y, 18, 300, "#92400e", 5, 1.2, 600);
  }

  w.events.push({ type: "eat", kind: e.kind, x: e.x, y: e.y, points });
  release(w, e);
  maybeStartGoldRush(w);
}

// ── Contacts: hazards, poison, bouncing (spec §4 "NO → Knockback/Damage") ───

function resolveContacts(w: World, dt: number) {
  const s = w.shark;
  const L = w.stats.length;
  const hx = Math.cos(s.angle), hy = Math.sin(s.angle);
  const bodyR = L * 0.2;
  for (const e of queryGrid(s.x, s.y, L + 80, scratchB)) {
    if (!e.alive) continue;
    const edible = isEdible(w, e);
    if (edible) continue; // edible but outside the mouth cone — just glide past
    // Closest point on the shark's spine segment.
    const px = e.x - s.x, py = e.y - s.y;
    const t = Math.max(-L * 0.45, Math.min(L * 0.45, px * hx + py * hy));
    const cx = s.x + hx * t, cy = s.y + hy * t;
    const dx = e.x - cx, dy = e.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const trigger = e.def.damageKind === "explode" ? 22 : 0;
    if (d > bodyR + e.def.radius + trigger) continue;

    if (e.def.damageKind === "explode") {
      explode(w, e);
    } else if (e.def.damageKind === "poison") {
      if (!w.gold.active && (!s.poison || s.poison.remaining < POISON_DURATION - 0.6)) {
        s.poison = { remaining: POISON_DURATION + (e.kind === "redJelly" ? 0.5 : 0), tick: POISON_TICK, pct: e.def.damage };
        w.events.push({ type: "poison" });
        floatText(w, s.x, s.y - 40, "중독!", "#86efac", 18);
        burst(w, "spark", s.x, s.y, 10, 120, "#86efac", 3, 0.6);
      }
    } else if (e.def.damage > 0) {
      if (e.attackCd <= 0 && s.invuln <= 0 && !w.gold.active) {
        e.attackCd = 1.1;
        s.invuln = 0.3;
        hurt(w, e.def.damage, e.def.name);
        knockback(w, -dx / d, -dy / d, 380);
        if (e.def.behavior === "hunter") e.state = "patrol";
      }
    } else {
      // Harmless but too big (e.g. a boat hull for a Reef Shark): resolve the
      // overlap and reflect only the inward velocity — a per-frame impulse
      // here would keep shoving the shark along with a moving hull.
      const nx = dx / d, ny = dy / d;
      const overlap = bodyR + e.def.radius - d;
      s.x -= nx * overlap;
      s.y -= ny * overlap;
      const inward = s.vx * nx + s.vy * ny;
      if (inward > 0) {
        s.vx -= nx * inward * 1.6;
        s.vy -= ny * inward * 1.6;
      }
      if (w.bounceCd <= 0) {
        w.bounceCd = 0.5;
        w.events.push({ type: "bounce" });
        floatText(w, e.x, e.y - e.def.radius - 10, `티어 ${e.def.requiredTier} 필요`, "#cbd5e1", 14);
      }
    }
  }
  void dt;
}

function knockback(w: World, nx: number, ny: number, force: number) {
  w.shark.vx += nx * force;
  w.shark.vy += ny * force;
}

/** Mine / torpedo detonation — Damage = MaxDamage · (1 − dist / R) (spec §6-2). */
export function explode(w: World, e: Entity) {
  if (!e.alive) return;
  release(w, e);
  const R = mineExplosionRadius(e.kind);
  const s = w.shark;
  const d = Math.hypot(s.x - e.x, s.y - e.y);
  const dmg = explosionDamage(e.def.damage, d, R);
  if (dmg > 0) {
    hurt(w, dmg, e.def.name);
    const n = d || 1;
    knockback(w, (s.x - e.x) / n, (s.y - e.y) / n, 700 * (1 - d / R));
  }
  burst(w, "flash", e.x, e.y, 1, 0, "#fff7ed", R * 0.9, 0.35);
  burst(w, "spark", e.x, e.y, 26, R * 3.2, "#fb923c", 4, 0.6);
  burst(w, "smoke", e.x, e.y, 18, R * 1.1, "#44403c", 12, 1.6);
  burst(w, "bubble", e.x, e.y, 20, R * 1.5, "#e0f2fe", 4, 1.4);
  w.shake = Math.max(w.shake, R > 200 ? 22 : 15);
  w.events.push({ type: "explode", x: e.x, y: e.y, big: R > 200 });
  // Blast kills small fish nearby and chains into other mines.
  // Explosions are rare, so a direct scan beats trusting a possibly stale grid.
  for (const o of w.entities.slice()) {
    if (!o.alive || o === e) continue;
    const od = Math.hypot(o.x - e.x, o.y - e.y);
    if (od > R) continue;
    if (o.def.damageKind === "explode" && od < R * 0.55) explode(w, o);
    else if (o.def.toughness <= 1 && o.def.requiredTier <= 3 && o.kind !== "chest") {
      burst(w, "blood", o.x, o.y, 4, 80, "#b91c1c", 3, 0.6);
      release(w, o);
    }
  }
}

// ── Gold Rush (spec §1-2) ───────────────────────────────────────────────────

function maybeStartGoldRush(w: World) {
  const g = w.gold;
  if (g.active || g.gauge < g.capacity) return;
  g.count++;
  g.mega = g.count % MEGA_EVERY === 0;
  g.active = true;
  g.duration = g.mega ? MEGA_GOLD_RUSH_DURATION : GOLD_RUSH_DURATION;
  g.remaining = g.duration;
  g.multiplier = goldRushMultiplier(g.count, g.mega);
  g.gauge = g.capacity;
  w.run.rushes++;
  if (g.mega) w.run.megaRushes++;
  w.shark.hp = w.stats.maxHealth;
  w.shark.poison = null;
  w.shake = Math.max(w.shake, 12);
  burst(w, "gold", w.shark.x, w.shark.y, 50, 420, "#facc15", 5, 1.4);
  w.events.push({ type: "goldStart", mega: g.mega, multiplier: g.multiplier });
}

/** Debug/test hook: instantly fill the gauge and trigger a rush. */
export function forceGoldRush(w: World) {
  w.gold.gauge = w.gold.capacity;
  maybeStartGoldRush(w);
}

function updateGoldRush(w: World, dt: number) {
  const g = w.gold;
  if (!g.active) return;
  g.remaining -= dt;
  g.gauge = g.capacity * Math.max(0, g.remaining / g.duration);
  if (g.remaining <= 0) {
    g.active = false;
    g.mega = false;
    g.gauge = 0;
    g.multiplier = 1;
    w.events.push({ type: "goldEnd" });
  }
}

function updateCombo(w: World, dt: number) {
  if (w.combo === 0) return;
  w.comboTimer -= dt;
  if (w.comboTimer <= 0) w.combo = 0;
}

function updateParticles(w: World, dt: number) {
  let j = 0;
  for (const p of w.particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vy += p.gravity * dt;
    const drag = p.kind === "bubble" ? 1 : 1 - Math.min(1, dt * 2.2);
    p.vx *= drag;
    p.vy *= p.kind === "bubble" ? 1 : drag;
    if (p.kind === "bubble") p.vy -= 60 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "bubble" && p.y < SURFACE_Y) continue;
    w.particles[j++] = p;
  }
  w.particles.length = j;
  let k = 0;
  for (const t of w.texts) {
    t.life -= dt;
    t.y -= 40 * dt;
    if (t.life > 0) w.texts[k++] = t;
  }
  w.texts.length = k;
}

// ── Missions ────────────────────────────────────────────────────────────────

function updateMissions(w: World) {
  for (const m of w.missions) {
    if (m.done) continue;
    const r = w.run;
    const v =
      m.id === "eatFish" ? r.fish
      : m.id === "eatHumans" ? r.humans
      : m.id === "reachDepth" ? r.maxDepth
      : m.id === "survive" ? Math.floor(w.time)
      : m.id === "goldRush" ? r.rushes
      : m.id === "score" ? w.score
      : m.id === "boatBreaker" ? r.bigKills
      : m.id === "chest" ? r.chests
      : r.jumps;
    m.progress = Math.min(m.goal, v);
    if (v >= m.goal) {
      m.done = true;
      w.coins += m.reward;
      floatText(w, w.shark.x, w.shark.y - 60, `미션 완료! +${m.reward}🪙`, "#86efac", 20);
      w.events.push({ type: "mission", label: m.label, reward: m.reward });
    }
  }
}

// ── Spawner (spec §7 zone streaming) ────────────────────────────────────────

function countKinds(w: World): Partial<Record<EntityKind, number>> {
  const c: Partial<Record<EntityKind, number>> = {};
  for (const e of w.entities) if (e.alive) c[e.kind] = (c[e.kind] ?? 0) + 1;
  return c;
}

function runSpawner(w: World, initial: boolean) {
  const targets = populationTargets(w.def.tier);
  const counts = countKinds(w);
  const s = w.shark;
  for (const kind of Object.keys(targets) as EntityKind[]) {
    const want = targets[kind] ?? 0;
    if ((counts[kind] ?? 0) >= want) continue;
    const def = ENTITY_DEFS[kind];
    // Pick an x in the ring around the player (or anywhere nearby initially).
    const side = rand(w) < 0.5 ? -1 : 1;
    const off = initial ? range(w, 250, SPAWN_MAX) : range(w, SPAWN_MIN, SPAWN_MAX);
    let x = s.x + side * off;
    if (x < 80 || x > WORLD_W - 80) x = s.x - side * off;
    x = Math.max(80, Math.min(WORLD_W - 80, x));
    const floor = seabedY(x);
    let y: number;
    switch (def.behavior) {
      case "crawl": y = floor - def.radius; break;
      case "surfaceSwim": y = SURFACE_Y + 5; break;
      case "surfaceBoat": y = SURFACE_Y - 4; break;
      case "fly": case "heli": y = range(w, def.depth[0], def.depth[1]); break;
      default: {
        const lo = Math.max(SURFACE_Y + 40, def.depth[0]);
        const hi = Math.min(floor - 40, def.depth[1]);
        if (hi <= lo) continue;
        y = range(w, lo, hi);
      }
    }
    if (def.behavior === "boid") {
      const n = 8 + Math.floor(rand(w) * 7);
      const dir = rand(w) < 0.5 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const f = spawn(w, kind, x + range(w, -40, 40), y + range(w, -30, 30));
        f.homeY = y;
        f.dir = dir as 1 | -1;
        f.vx = dir * def.speed * 0.6;
      }
      counts[kind] = (counts[kind] ?? 0) + n;
    } else {
      spawn(w, kind, x, y);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  // Abyss volcano: falling rocks rain down while the player is deep.
  if (!initial && s.y > 2350 && rand(w) < 0.22) {
    const r = spawn(w, "rock", s.x + range(w, -700, 700), Math.max(2250, s.y - 650));
    r.vx = range(w, -40, 40);
    r.vy = range(w, 40, 120);
  }
}

function despawnFar(w: World) {
  const s = w.shark;
  for (const e of w.entities) {
    if (!e.alive || e.kind === "chest") continue;
    if (Math.abs(e.x - s.x) > DESPAWN_DX || Math.abs(e.y - s.y) > DESPAWN_DY) release(w, e);
  }
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface RunSummary {
  sharkId: string;
  score: number;
  coins: number;
  seconds: number;
  cause: string;
  run: RunStats;
  missions: MissionState[];
}

export function summarize(w: World): RunSummary {
  return {
    sharkId: w.def.id,
    score: w.score,
    coins: w.coins,
    seconds: Math.floor(w.time),
    cause: w.deathCause ?? "굶주림",
    run: w.run,
    missions: w.missions,
  };
}

export { NEVER };
