/**
 * Pure simulation for 꽃게 서바이벌 — no DOM, no canvas, no Math.random
 * (a seeded mulberry32 lives on the world so matches are reproducible in tests).
 *
 * Maps onto the spec's Unity modules:
 *   CrabController  → `moveCrab` (8-dir move, smooth facing turn, boost/stamina)
 *   CrabGrowth      → `addScore`/`checkLevel` + the scale lerp in `moveCrab`
 *   CrabCombat      → `swing` (cone hit test, combo, crit, counter, durability)
 *   WeaponItem      → `crab.weapon`/`crab.shield` + WEAPONS/SHIELDS tables
 *   CrabHealth      → `damageCrab` (frontal guard via dot product) + `killCrab`
 *   HealingZone     → tide pools in `applyZones`
 *   TreasureBox     → `hitBox`/`breakBox`
 *   ObjectSpawner   → `runSpawner`
 *   GameManager     → `updateLeaderboard` (king crab election + broadcasts)
 *   EventBus        → `world.events` (drained by the UI each frame)
 */

import {
  BASE_CRIT,
  BOOST_MULT,
  BOT_COUNT,
  BOT_NAMES,
  BOT_RESPAWN,
  BOXES,
  COMBO_WINDOW,
  comboMultiplier,
  COUNTER_MULT,
  COUNTER_WINDOW,
  CRAB_COLORS,
  CRAB_RADIUS,
  CREATURES,
  CRIT_MULT,
  FOODS,
  GUARD_COS,
  HIT_STOP,
  islandRadiusAt,
  levelForScore,
  roadmap,
  SPECIES,
  SPECIES_LIST,
  POOL_HEAL_RATE,
  POPULATION,
  REGEN_DELAY,
  REGEN_RATE,
  SHALLOW_SLOW,
  SHALLOW_W,
  SHIELDS,
  SPAWN_SHIELD,
  STAMINA_DELAY,
  STAMINA_DRAIN,
  STAMINA_MAX,
  STAMINA_REGEN,
  UNARMED,
  WEAPONS,
  type BoxKind,
  type CrabColor,
  type CreatureDef,
  type CreatureKind,
  type FoodKind,
  type LevelDef,
  type ShieldKind,
  type SpeciesId,
  type WeaponKind,
} from "./data";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Equip<K> {
  kind: K;
  dur: number;
}

export interface Brain {
  goal: "food" | "crab" | "creature" | "box" | "flee" | "pool" | "wander";
  targetId: number;
  gx: number;
  gy: number;
  think: number;
  aggression: number;
  skill: number;
  wanderAngle: number;
  stuck: number;
  lastX: number;
  lastY: number;
}

export interface Crab {
  id: number;
  name: string;
  isPlayer: boolean;
  color: CrabColor;
  species: SpeciesId;
  alive: boolean;
  x: number;
  y: number;
  /** Knockback velocity (decays); walking is applied directly each step. */
  vx: number;
  vy: number;
  angle: number;
  moving: boolean;
  walk: number;
  score: number;
  level: number;
  /** Displayed scale, lerped toward the level's target scale. */
  scale: number;
  hp: number;
  maxHp: number;
  stamina: number;
  staminaDelay: number;
  boosting: boolean;
  attackCd: number;
  swing: number;
  swingSide: 1 | -1;
  weapon: Equip<WeaponKind> | null;
  shield: Equip<ShieldKind> | null;
  hasKey: boolean;
  combo: number;
  comboT: number;
  counter: { by: number; t: number } | null;
  sinceHurt: number;
  hitFlash: number;
  guardFlash: number;
  stun: number;
  invuln: number;
  deadT: number;
  respawnT: number;
  kills: number;
  lastAttacker: string | null;
  inPool: boolean;
  brain: Brain | null;
}

export interface Creature {
  id: number;
  kind: CreatureKind;
  def: CreatureDef;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  timer: number;
  attackCd: number;
  hitFlash: number;
  aggroId: number;
  aggroT: number;
  walk: number;
  deadT: number;
}

export type PickupType = "food" | "coin" | "weapon" | "shield" | "key";

export interface Pickup {
  id: number;
  type: PickupType;
  food?: FoodKind;
  weapon?: Equip<WeaponKind>;
  shield?: Equip<ShieldKind>;
  /** Points; food/meat/box coins are scaled by the collector's level gain, crab drops are absolute. */
  value: number;
  absolute: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  radius: number;
  age: number;
  /** Drops expire; natural spawns don't (Infinity). */
  ttl: number;
  lockId: number;
  lockT: number;
}

export interface Box {
  id: number;
  kind: BoxKind;
  alive: boolean;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  hitFlash: number;
  lockedMsgT: number;
}

export interface Rock {
  x: number;
  y: number;
  r: number;
  h: number;
  tint: number;
}
export interface Palm {
  x: number;
  y: number;
  r: number;
  lean: number;
  size: number;
}
export interface Pool {
  x: number;
  y: number;
  r: number;
}
export interface Deco {
  x: number;
  y: number;
  kind: number;
  rot: number;
}

export interface Particle {
  kind: "sand" | "spark" | "splinter" | "coin" | "star" | "splash" | "heal" | "gold";
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

export type GameEvent =
  | { type: "swing"; player: boolean; heavy: boolean }
  | { type: "hit"; x: number; y: number; crit: boolean; big: boolean; player: boolean; hurtPlayer: boolean }
  | { type: "guard"; player: boolean }
  | { type: "break"; what: "weapon" | "shield"; player: boolean; name: string }
  | { type: "boxBreak"; gold: boolean; player: boolean }
  | { type: "locked" }
  | { type: "eat"; player: boolean }
  | { type: "coin"; player: boolean }
  | { type: "equip"; name: string; emoji: string }
  | { type: "key" }
  | { type: "levelUp"; level: number; name: string; player: boolean }
  | { type: "kingNew"; name: string; player: boolean }
  | { type: "kingDown"; name: string; by: string | null; player: boolean; byPlayer: boolean }
  | { type: "kill"; killer: string; victim: string; byPlayer: boolean; victimPlayer: boolean }
  | { type: "counter" }
  | { type: "playerDeath"; by: string }
  | { type: "matchEnd" };

export interface MatchStats {
  kills: number;
  bestCombo: number;
  maxLevel: number;
  boxes: number;
  eaten: number;
  kingSeconds: number;
  peakScore: number;
  deaths: number;
  damageDealt: number;
}

export interface CrabInput {
  /** Desired walk direction (need not be normalized); (0,0) = stand still. */
  moveX: number;
  moveY: number;
  /** Optional facing override (mouse aim). Falls back to the walk direction. */
  faceX?: number;
  faceY?: number;
  boost: boolean;
  attack: boolean;
}

export interface World {
  seed: number;
  rngState: number;
  time: number;
  duration: number;
  crabs: Crab[];
  creatures: Creature[];
  pickups: Pickup[];
  boxes: Box[];
  rocks: Rock[];
  palms: Palm[];
  pools: Pool[];
  deco: Deco[];
  nextId: number;
  particles: Particle[];
  texts: FloatText[];
  events: GameEvent[];
  hitStop: number;
  shake: number;
  playerId: number;
  /** Player is flipped over, waiting for the revive/end choice. */
  playerDown: boolean;
  deathSnapshot: { score: number; weapon: Equip<WeaponKind> | null; shield: Equip<ShieldKind> | null; by: string } | null;
  revivesLeft: number;
  kingId: number | null;
  ranking: number[];
  lbTimer: number;
  spawnTimer: number;
  stats: MatchStats;
  over: boolean;
  finalScore: number;
}

// ── RNG / helpers ───────────────────────────────────────────────────────────

export function rand(w: World): number {
  let t = (w.rngState = (w.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (w: World, a: number, b: number) => a + rand(w) * (b - a);
const pick = <T,>(w: World, arr: readonly T[]): T => arr[Math.floor(rand(w) * arr.length)];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function crabRadius(c: Crab): number {
  return CRAB_RADIUS * c.scale;
}
export function levelDef(c: Crab): LevelDef {
  return roadmap(c.species)[c.level - 1];
}
/** Unarmed claw reach beyond the body edge. */
export const CLAW_REACH = 26;

export function attackReach(c: Crab): number {
  const wd = c.weapon ? WEAPONS[c.weapon.kind] : UNARMED;
  return crabRadius(c) + CLAW_REACH * c.scale * wd.reach;
}

export function crabDps(c: Crab): number {
  const wd = c.weapon ? WEAPONS[c.weapon.kind] : UNARMED;
  return (levelDef(c).atk * wd.dmg) / wd.cooldown;
}

export function player(w: World): Crab {
  return w.crabs.find((c) => c.id === w.playerId)!;
}

function wallRadius(x: number, y: number): number {
  return islandRadiusAt(Math.atan2(y, x)) + SHALLOW_W;
}
export function isShallow(x: number, y: number): boolean {
  return Math.hypot(x, y) > islandRadiusAt(Math.atan2(y, x));
}

function isFree(w: World, x: number, y: number, r: number): boolean {
  const d = Math.hypot(x, y);
  if (d > islandRadiusAt(Math.atan2(y, x)) - r - 20) return false;
  for (const k of w.rocks) if (Math.hypot(x - k.x, y - k.y) < k.r + r + 6) return false;
  for (const p of w.palms) if (Math.hypot(x - p.x, y - p.y) < p.r + r + 4) return false;
  for (const b of w.boxes) if (b.alive && Math.hypot(x - b.x, y - b.y) < BOXES[b.kind].radius + r + 6) return false;
  return true;
}

function randomLandPoint(w: World, r: number, avoidPools = false, maxFrac = 0.93): { x: number; y: number } {
  for (let i = 0; i < 60; i++) {
    const a = rand(w) * Math.PI * 2;
    const d = Math.sqrt(rand(w)) * islandRadiusAt(a) * maxFrac;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (!isFree(w, x, y, r)) continue;
    if (avoidPools && w.pools.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + r)) continue;
    return { x, y };
  }
  return { x: 0, y: 0 };
}

function randomShallowPoint(w: World): { x: number; y: number } {
  const a = rand(w) * Math.PI * 2;
  const d = islandRadiusAt(a) + range(w, 30, SHALLOW_W - 30);
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

// ── Creation ────────────────────────────────────────────────────────────────

export interface MatchOptions {
  playerName: string;
  colorId: string;
  species?: SpeciesId;
  duration: number;
  seed?: number;
  bots?: number;
}

export function createWorld(opts: MatchOptions): World {
  const seed = opts.seed ?? (Date.now() & 0x7fffffff);
  const w: World = {
    seed,
    rngState: seed,
    time: 0,
    duration: opts.duration,
    crabs: [],
    creatures: [],
    pickups: [],
    boxes: [],
    rocks: [],
    palms: [],
    pools: [],
    deco: [],
    nextId: 1,
    particles: [],
    texts: [],
    events: [],
    hitStop: 0,
    shake: 0,
    playerId: 0,
    playerDown: false,
    deathSnapshot: null,
    revivesLeft: 1,
    kingId: null,
    ranking: [],
    lbTimer: 0,
    spawnTimer: 0,
    stats: { kills: 0, bestCombo: 0, maxLevel: 1, boxes: 0, eaten: 0, kingSeconds: 0, peakScore: 0, deaths: 0, damageDealt: 0 },
    over: false,
    finalScore: 0,
  };
  generateMap(w);

  const color = CRAB_COLORS.find((c) => c.id === opts.colorId) ?? CRAB_COLORS[0];
  const me = makeCrab(w, opts.playerName.trim() || "나", color, true, opts.species ?? "flower");
  w.playerId = me.id;
  w.crabs.push(me);

  const names = [...BOT_NAMES];
  const botCount = opts.bots ?? BOT_COUNT;
  for (let i = 0; i < botCount; i++) {
    const name = names.splice(Math.floor(rand(w) * names.length), 1)[0] ?? `게${i + 1}`;
    const bc = CRAB_COLORS[(i + 1 + CRAB_COLORS.indexOf(color)) % CRAB_COLORS.length];
    const b = makeCrab(w, name, bc, false, SPECIES_LIST[Math.floor(rand(w) * SPECIES_LIST.length)].id);
    // A staggered head start so the leaderboard isn't a flat line of zeros.
    const head = Math.floor(rand(w) * rand(w) * 2600);
    b.score = head;
    syncLevel(b, true);
    w.crabs.push(b);
  }

  for (let i = 0; i < POPULATION.food; i++) spawnFood(w);
  for (let i = 0; i < POPULATION.creatures; i++) spawnCreature(w);
  for (let i = 0; i < POPULATION.wood; i++) spawnBox(w, "wood");
  for (let i = 0; i < POPULATION.gold; i++) spawnBox(w, "gold");
  for (let i = 0; i < POPULATION.keys; i++) spawnKey(w);
  updateLeaderboard(w, true);
  return w;
}

function makeCrab(w: World, name: string, color: CrabColor, isPlayer: boolean, species: SpeciesId): Crab {
  const p = randomLandPoint(w, 30, true, 0.85);
  const c: Crab = {
    id: w.nextId++,
    name,
    isPlayer,
    color,
    species,
    alive: true,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    angle: rand(w) * Math.PI * 2,
    moving: false,
    walk: 0,
    score: 0,
    level: 1,
    scale: roadmap(species)[0].scale,
    hp: roadmap(species)[0].hp,
    maxHp: roadmap(species)[0].hp,
    stamina: STAMINA_MAX,
    staminaDelay: 0,
    boosting: false,
    attackCd: 0,
    swing: 0,
    swingSide: 1,
    weapon: null,
    shield: null,
    hasKey: false,
    combo: 0,
    comboT: 0,
    counter: null,
    sinceHurt: 99,
    hitFlash: 0,
    guardFlash: 0,
    stun: 0,
    invuln: SPAWN_SHIELD,
    deadT: 0,
    respawnT: 0,
    kills: 0,
    lastAttacker: null,
    inPool: false,
    brain: isPlayer
      ? null
      : {
          goal: "wander",
          targetId: 0,
          gx: p.x,
          gy: p.y,
          think: rand(w) * 0.3,
          aggression: range(w, 0.15, 1),
          skill: range(w, 0.45, 1),
          wanderAngle: rand(w) * Math.PI * 2,
          stuck: 0,
          lastX: p.x,
          lastY: p.y,
        },
  };
  return c;
}

function generateMap(w: World) {
  // Tide pools: one in the middle plus a ring.
  w.pools.push({ x: 0, y: 0, r: 125 });
  const ringN = 5;
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * Math.PI * 2 + range(w, -0.25, 0.25);
    const d = range(w, 900, 1350);
    w.pools.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: range(w, 90, 125) });
  }

  // Rock rings: gaps ~52u so Lv1-2 crabs (≤47u wide) slip through, bigger ones can't.
  const GAP = 52;
  for (let i = 0; i < 9; i++) {
    let cx = 0, cy = 0;
    for (let t = 0; t < 40; t++) {
      const a = rand(w) * Math.PI * 2;
      const d = range(w, 400, 1450);
      cx = Math.cos(a) * d;
      cy = Math.sin(a) * d;
      const clear =
        w.pools.every((p) => Math.hypot(cx - p.x, cy - p.y) > p.r + 260) &&
        w.rocks.every((k) => Math.hypot(cx - k.x, cy - k.y) > 380);
      if (clear) break;
    }
    const k = 5 + Math.floor(rand(w) * 3);
    const R = range(w, 125, 165);
    const chord = 2 * R * Math.sin(Math.PI / k);
    const rr = (chord - GAP) / 2;
    const rot = rand(w) * Math.PI;
    // One side of every ring is a wide opening only for the bold (and big).
    const openIdx = rand(w) < 0.35 ? Math.floor(rand(w) * k) : -1;
    for (let j = 0; j < k; j++) {
      if (j === openIdx) continue;
      const a = rot + (j / k) * Math.PI * 2;
      w.rocks.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, r: rr, h: rr * range(w, 0.7, 1.05), tint: rand(w) });
    }
  }
  // Lone boulders.
  for (let i = 0; i < 16; i++) {
    const r = range(w, 30, 70);
    const p = randomLandPoint(w, r + 30, true, 0.9);
    w.rocks.push({ x: p.x, y: p.y, r, h: r * range(w, 0.6, 1), tint: rand(w) });
  }
  // Palms.
  for (let i = 0; i < 48; i++) {
    const p = randomLandPoint(w, 30, true, 0.95);
    w.palms.push({ x: p.x, y: p.y, r: 13, lean: range(w, -0.5, 0.5), size: range(w, 0.85, 1.25) });
  }
  // Pure decoration (shells, pebbles, grass).
  for (let i = 0; i < 420; i++) {
    const a = rand(w) * Math.PI * 2;
    const d = Math.sqrt(rand(w)) * islandRadiusAt(a) * 0.97;
    w.deco.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, kind: Math.floor(rand(w) * 5), rot: rand(w) * Math.PI * 2 });
  }
}

// ── Spawning ────────────────────────────────────────────────────────────────

function newPickup(w: World, type: PickupType, x: number, y: number, value: number, absolute: boolean, radius: number, ttl = Infinity): Pickup {
  const p: Pickup = { id: w.nextId++, type, value, absolute, x, y, vx: 0, vy: 0, z: 0, vz: 0, radius, age: 0, ttl, lockId: 0, lockT: 0 };
  w.pickups.push(p);
  return p;
}

function weightedFood(w: World): FoodKind {
  const list = Object.values(FOODS).filter((f) => f.weight > 0);
  const total = list.reduce((a, f) => a + f.weight, 0);
  let r = rand(w) * total;
  for (const f of list) {
    r -= f.weight;
    if (r <= 0) return f.kind;
  }
  return "banana";
}

function spawnFood(w: World) {
  const kind = weightedFood(w);
  const f = FOODS[kind];
  const p = randomLandPoint(w, f.radius, false, 0.96);
  const pk = newPickup(w, "food", p.x, p.y, f.points, false, f.radius);
  pk.food = kind;
}

function spawnKey(w: World) {
  // Half the keys hide inside rock rings — a reason to stay small and nimble.
  let p = randomLandPoint(w, 12, true);
  if (rand(w) < 0.5 && w.rocks.length) {
    const k = pick(w, w.rocks);
    const cand = { x: k.x + range(w, -40, 40), y: k.y + range(w, -40, 40) };
    // Walk toward the ring centroid of nearby rocks.
    const near = w.rocks.filter((o) => Math.hypot(o.x - k.x, o.y - k.y) < 360);
    if (near.length >= 4) {
      const cx = near.reduce((a, o) => a + o.x, 0) / near.length;
      const cy = near.reduce((a, o) => a + o.y, 0) / near.length;
      if (isFree(w, cx, cy, 14)) p = { x: cx, y: cy };
      else if (isFree(w, cand.x, cand.y, 14)) p = cand;
    }
  }
  newPickup(w, "key", p.x, p.y, 0, true, 12);
}

function spawnBox(w: World, kind: BoxKind) {
  const def = BOXES[kind];
  const p = randomLandPoint(w, def.radius + 10, true, 0.9);
  const hp = kind === "gold" ? 1 : def.hp;
  w.boxes.push({ id: w.nextId++, kind, alive: true, x: p.x, y: p.y, hp, maxHp: hp, hitFlash: 0, lockedMsgT: 0 });
}

function weightedCreature(w: World): CreatureKind {
  const list = Object.values(CREATURES);
  const total = list.reduce((a, c) => a + c.weight, 0);
  let r = rand(w) * total;
  for (const c of list) {
    r -= c.weight;
    if (r <= 0) return c.kind;
  }
  return "babyCrab";
}

function spawnCreature(w: World, kind = weightedCreature(w)) {
  const def = CREATURES[kind];
  const p = def.water ? randomShallowPoint(w) : randomLandPoint(w, def.radius + 6, true, 0.92);
  w.creatures.push({
    id: w.nextId++,
    kind,
    def,
    alive: true,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    angle: rand(w) * Math.PI * 2,
    hp: def.hp,
    timer: range(w, 0.5, 3),
    attackCd: 0,
    hitFlash: 0,
    aggroId: 0,
    aggroT: 0,
    walk: 0,
    deadT: 0,
  });
}

function runSpawner(w: World) {
  const food = w.pickups.filter((p) => p.type === "food" && p.ttl === Infinity).length;
  for (let i = 0; i < Math.min(2, POPULATION.food - food); i++) spawnFood(w);
  const cre = w.creatures.filter((c) => c.alive).length;
  if (cre < POPULATION.creatures) spawnCreature(w);
  const wood = w.boxes.filter((b) => b.alive && b.kind === "wood").length;
  if (wood < POPULATION.wood && rand(w) < 0.12) spawnBox(w, "wood");
  const gold = w.boxes.filter((b) => b.alive && b.kind === "gold").length;
  if (gold < POPULATION.gold && rand(w) < 0.03) spawnBox(w, "gold");
  const keys = w.pickups.filter((p) => p.type === "key").length + w.crabs.filter((c) => c.alive && c.hasKey).length;
  if (keys < POPULATION.keys && rand(w) < 0.05) spawnKey(w);
  // Garbage-collect corpses & dead boxes.
  if (w.creatures.length > POPULATION.creatures * 2) w.creatures = w.creatures.filter((c) => c.alive || c.deadT < 1);
  if (w.boxes.length > (POPULATION.wood + POPULATION.gold) * 2) w.boxes = w.boxes.filter((b) => b.alive);
}

// ── FX helpers ──────────────────────────────────────────────────────────────

function burst(w: World, kind: Particle["kind"], x: number, y: number, n: number, speed: number, color: string, size = 4, life = 0.6, up = 120) {
  for (let i = 0; i < n && w.particles.length < 500; i++) {
    const a = rand(w) * Math.PI * 2;
    const v = speed * (0.3 + rand(w) * 0.7);
    const l = life * (0.6 + rand(w) * 0.6);
    w.particles.push({ kind, x, y, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: up * (0.5 + rand(w)), life: l, maxLife: l, size: size * (0.6 + rand(w) * 0.8), color });
  }
}

function floatText(w: World, x: number, y: number, text: string, color: string, size = 16, life = 0.9) {
  if (w.texts.length > 90) w.texts.shift();
  w.texts.push({ x: x + range(w, -8, 8), y, text, color, life, maxLife: life, size });
}

// ── Score / growth ──────────────────────────────────────────────────────────

function syncLevel(c: Crab, instant = false) {
  const lv = levelForScore(c.score, c.species);
  if (lv.level === c.level && !instant) return false;
  const oldMax = c.maxHp;
  c.level = lv.level;
  c.maxHp = lv.hp;
  c.hp = instant ? lv.hp : Math.min(lv.hp, c.hp * (lv.hp / oldMax) + lv.hp * 0.12);
  if (instant) c.scale = lv.scale;
  return true;
}

export function addScore(w: World, c: Crab, pts: number) {
  if (pts <= 0 || !c.alive) return;
  const before = c.level;
  c.score += Math.round(pts);
  if (c.isPlayer) w.stats.peakScore = Math.max(w.stats.peakScore, c.score);
  if (syncLevel(c) && c.level > before) {
    w.events.push({ type: "levelUp", level: c.level, name: c.name, player: c.isPlayer });
    floatText(w, c.x, c.y - 30 * c.scale, `LEVEL UP! Lv${c.level}`, "#fde047", 22, 1.6);
    burst(w, "star", c.x, c.y, 18, 220, "#fde047", 5, 0.9, 200);
    if (c.isPlayer) w.stats.maxLevel = Math.max(w.stats.maxLevel, c.level);
  }
}

// ── Main step ───────────────────────────────────────────────────────────────

export function step(w: World, input: CrabInput, rawDt: number): void {
  if (w.over) return;
  const dt = Math.min(0.05, rawDt);
  w.shake = Math.max(0, w.shake - dt * 3);
  if (w.hitStop > 0) {
    w.hitStop -= dt;
    return;
  }
  w.time += dt;

  for (const c of w.crabs) {
    if (!c.alive) {
      c.deadT += dt;
      if (!c.isPlayer) {
        c.respawnT -= dt;
        if (c.respawnT <= 0) respawnBot(w, c);
      }
      continue;
    }
    const inp = c.isPlayer ? input : botThink(w, c, dt);
    moveCrab(w, c, inp, dt);
    if (inp.attack && c.attackCd <= 0 && c.stun <= 0) swing(w, c);
  }
  for (const cr of w.creatures) updateCreature(w, cr, dt);
  resolveCollisions(w);
  updatePickups(w, dt);
  applyZones(w, dt);

  for (const b of w.boxes) {
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    b.lockedMsgT = Math.max(0, b.lockedMsgT - dt);
  }

  w.lbTimer -= dt;
  if (w.lbTimer <= 0) {
    w.lbTimer = 0.5;
    updateLeaderboard(w);
  }
  if (w.kingId === w.playerId) w.stats.kingSeconds += dt;

  w.spawnTimer -= dt;
  if (w.spawnTimer <= 0) {
    w.spawnTimer = 0.5;
    runSpawner(w);
  }

  for (const p of w.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vz -= 520 * dt;
    p.z = Math.max(0, p.z + p.vz * dt);
    p.vx *= 1 - 2.5 * dt;
    p.vy *= 1 - 2.5 * dt;
  }
  w.particles = w.particles.filter((p) => p.life > 0);
  for (const t of w.texts) {
    t.life -= dt;
    t.y -= 40 * dt;
  }
  w.texts = w.texts.filter((t) => t.life > 0);

  if (w.time >= w.duration) endMatch(w);
}

export function endMatch(w: World) {
  if (w.over) return;
  const me = player(w);
  w.finalScore = me.alive ? me.score : (w.deathSnapshot?.score ?? 0);
  w.over = true;
  w.events.push({ type: "matchEnd" });
}

// ── CrabController ──────────────────────────────────────────────────────────

function moveCrab(w: World, c: Crab, inp: CrabInput, dt: number) {
  c.attackCd = Math.max(0, c.attackCd - dt);
  c.swing = Math.max(0, c.swing - dt);
  c.hitFlash = Math.max(0, c.hitFlash - dt);
  c.guardFlash = Math.max(0, c.guardFlash - dt);
  c.stun = Math.max(0, c.stun - dt);
  c.invuln = Math.max(0, c.invuln - dt);
  c.sinceHurt += dt;
  if (c.comboT > 0) {
    c.comboT -= dt;
    if (c.comboT <= 0) c.combo = 0;
  }
  if (c.counter) {
    c.counter.t -= dt;
    if (c.counter.t <= 0) c.counter = null;
  }

  const lv = levelDef(c);
  let mx = inp.moveX, my = inp.moveY;
  const ml = Math.hypot(mx, my);
  c.moving = ml > 0.001 && c.stun <= 0;
  if (c.moving) {
    mx /= ml;
    my /= ml;
  } else {
    mx = my = 0;
  }

  // Boost / stamina.
  const wantBoost = inp.boost && c.moving && c.stamina > 0;
  if (wantBoost) {
    c.boosting = true;
    c.stamina = Math.max(0, c.stamina - STAMINA_DRAIN * SPECIES[c.species].staminaDrain * dt);
    c.staminaDelay = STAMINA_DELAY;
  } else {
    c.boosting = false;
    if (c.staminaDelay > 0) c.staminaDelay -= dt;
    else c.stamina = Math.min(STAMINA_MAX, c.stamina + STAMINA_REGEN * dt);
  }

  let speed = lv.speed * (c.boosting ? BOOST_MULT : 1);
  if (isShallow(c.x, c.y)) speed *= SHALLOW_SLOW;
  if (c.attackCd > 0 && c.weapon && WEAPONS[c.weapon.kind].family === "heavy") speed *= 0.8;

  c.x += (mx * speed + c.vx) * dt;
  c.y += (my * speed + c.vy) * dt;
  const decay = Math.exp(-7 * dt);
  c.vx *= decay;
  c.vy *= decay;

  // Facing: Quaternion.Slerp equivalent — bigger crabs turn slower.
  let fx = inp.faceX ?? 0, fy = inp.faceY ?? 0;
  if (Math.hypot(fx, fy) < 0.001) {
    fx = mx;
    fy = my;
  }
  if (Math.hypot(fx, fy) > 0.001 && c.stun <= 0) {
    const target = Math.atan2(fy, fx);
    let diff = target - c.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const rate = 16 / (0.55 + c.scale * 0.45);
    const stepA = clamp(diff, -rate * dt, rate * dt);
    c.angle += stepA;
  }
  if (c.moving) c.walk += dt * speed * 0.09 / Math.sqrt(c.scale);

  // Growth lerp (Transform scale + collider).
  c.scale += (lv.scale - c.scale) * (1 - Math.exp(-2.5 * dt));

  // Out-of-combat regen.
  if (c.sinceHurt > REGEN_DELAY && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * REGEN_RATE * SPECIES[c.species].regen * dt);

  if (c.boosting && w.particles.length < 400 && rand(w) < dt * 18) {
    burst(w, "sand", c.x - Math.cos(c.angle) * crabRadius(c), c.y - Math.sin(c.angle) * crabRadius(c), 1, 40, "#e8cf94", 4 * c.scale, 0.5, 40);
  }
}

// ── CrabCombat ──────────────────────────────────────────────────────────────

interface HitTarget {
  x: number;
  y: number;
  r: number;
}

function inCone(c: Crab, t: HitTarget, reach: number, arc: number): boolean {
  const dx = t.x - c.x, dy = t.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d - t.r > reach) return false;
  if (d < crabRadius(c) * 0.6 + t.r * 0.5) return true; // overlapping: always hits
  const dot = (dx * Math.cos(c.angle) + dy * Math.sin(c.angle)) / d;
  // Widen the cone by the target's angular size so big targets are easy to tag.
  const ang = Math.acos(clamp(dot, -1, 1)) - Math.atan2(t.r, d);
  return ang <= arc;
}

export function swing(w: World, c: Crab) {
  const wd = c.weapon ? WEAPONS[c.weapon.kind] : UNARMED;
  c.attackCd = wd.cooldown;
  c.swing = Math.min(0.24, wd.cooldown * 0.8);
  c.swingSide = c.weapon ? 1 : c.swingSide === 1 ? -1 : 1;
  const heavy = !!c.weapon && WEAPONS[c.weapon.kind].family === "heavy";
  w.events.push({ type: "swing", player: c.isPlayer, heavy });

  const reach = attackReach(c);
  let hitLiving = false;
  let hitAny = false;
  const lv = levelDef(c);
  const nextCombo = c.comboT > 0 ? c.combo + 1 : 1;

  for (const t of w.crabs) {
    if (t === c || !t.alive || t.invuln > 0) continue;
    if (!inCone(c, { x: t.x, y: t.y, r: crabRadius(t) }, reach, wd.arc)) continue;
    const crit = rand(w) < BASE_CRIT + wd.crit + SPECIES[c.species].crit;
    const counter = !!c.counter && c.counter.by === t.id;
    let dmg = lv.atk * wd.dmg * comboMultiplier(nextCombo) * range(w, 0.9, 1.1);
    if (crit) dmg *= CRIT_MULT;
    if (counter) {
      dmg *= COUNTER_MULT;
      c.counter = null;
    }
    damageCrab(w, t, dmg, c, { crit, counter, knockback: wd.knockback, stun: wd.stun });
    hitLiving = true;
    hitAny = true;
  }
  for (const cr of w.creatures) {
    if (!cr.alive) continue;
    if (!inCone(c, { x: cr.x, y: cr.y, r: cr.def.radius }, reach, wd.arc)) continue;
    const crit = rand(w) < BASE_CRIT + wd.crit + SPECIES[c.species].crit;
    let dmg = lv.atk * wd.dmg * comboMultiplier(nextCombo) * range(w, 0.9, 1.1);
    if (crit) dmg *= CRIT_MULT;
    damageCreature(w, cr, dmg, c, crit, wd.knockback);
    hitLiving = true;
    hitAny = true;
  }
  for (const b of w.boxes) {
    if (!b.alive) continue;
    if (!inCone(c, { x: b.x, y: b.y, r: BOXES[b.kind].radius }, reach, wd.arc)) continue;
    hitBox(w, b, c, lv.atk * wd.dmg);
    hitAny = true;
  }

  if (hitAny) {
    c.combo = nextCombo;
    c.comboT = COMBO_WINDOW;
    if (c.isPlayer) w.stats.bestCombo = Math.max(w.stats.bestCombo, c.combo);
    if (c.combo >= 3 && hitLiving) addScore(w, c, Math.min(10, c.combo) * 4 * lv.gain);
  }
  // Durability: one point per swing that connected with something alive.
  if (hitLiving && c.weapon) {
    c.weapon.dur -= 1;
    if (c.weapon.dur <= 0) {
      const name = WEAPONS[c.weapon.kind].name;
      c.weapon = null;
      w.events.push({ type: "break", what: "weapon", player: c.isPlayer, name });
      floatText(w, c.x, c.y - 26 * c.scale, `${name} 파괴!`, "#fca5a5", 15, 1.2);
      burst(w, "splinter", c.x + Math.cos(c.angle) * 20 * c.scale, c.y + Math.sin(c.angle) * 20 * c.scale, 10, 180, "#a8a29e", 4);
    }
  }
}

function damageCrab(
  w: World,
  t: Crab,
  raw: number,
  by: Crab | null,
  o: { crit: boolean; counter: boolean; knockback: number; stun: number; sourceName?: string; sx?: number; sy?: number },
) {
  const sx = by ? by.x : (o.sx ?? t.x), sy = by ? by.y : (o.sy ?? t.y);
  const dx = t.x - sx, dy = t.y - sy;
  const d = Math.hypot(dx, dy) || 1;
  let dmg = raw;
  let guarded = false;
  // Frontal guard: shield up and the hit comes from within ±60° of facing.
  if (t.shield) {
    const toAtkX = -dx / d, toAtkY = -dy / d;
    const dot = Math.cos(t.angle) * toAtkX + Math.sin(t.angle) * toAtkY;
    if (dot >= GUARD_COS) {
      const sd = SHIELDS[t.shield.kind];
      dmg *= 1 - sd.block;
      guarded = true;
      t.guardFlash = 0.18;
      t.shield.dur -= 1;
      if (t.shield.dur <= 0) {
        w.events.push({ type: "break", what: "shield", player: t.isPlayer, name: sd.name });
        floatText(w, t.x, t.y - 30 * t.scale, `${sd.name} 파괴!`, "#fca5a5", 15, 1.2);
        burst(w, "splinter", t.x, t.y, 10, 170, sd.color, 4);
        t.shield = null;
      }
    }
  }
  dmg = Math.max(1, Math.round(dmg));
  t.hp -= dmg;
  t.sinceHurt = 0;
  t.hitFlash = 0.14;
  if (by) {
    t.counter = { by: by.id, t: COUNTER_WINDOW };
    t.lastAttacker = by.name;
    if (by.isPlayer) w.stats.damageDealt += dmg;
  } else if (o.sourceName) t.lastAttacker = o.sourceName;
  // Knockback scaled by relative size; guarding halves it.
  const ratio = by ? clamp(by.scale / t.scale, 0.35, 2.2) : 1;
  const kb = o.knockback * ratio * (guarded ? 0.5 : 1);
  t.vx += (dx / d) * kb;
  t.vy += (dy / d) * kb;
  if (o.stun > 0 && !guarded) t.stun = Math.max(t.stun, o.stun * clamp(ratio, 0.4, 1.3));

  const big = dmg >= t.maxHp * 0.3;
  const label = o.counter ? "반격! " : big ? "일격! " : o.crit ? "치명타! " : "";
  const color = guarded ? "#93c5fd" : o.counter ? "#f0abfc" : big ? "#fb923c" : o.crit ? "#fde047" : t.isPlayer ? "#f87171" : "#ffffff";
  floatText(w, t.x, t.y - 24 * t.scale, `${label}${guarded ? "🛡" : ""}${dmg}`, color, label ? 19 : 15);
  burst(w, "spark", t.x - (dx / d) * crabRadius(t) * 0.7, t.y - (dy / d) * crabRadius(t) * 0.7, o.crit || big ? 12 : 6, 220, guarded ? "#bfdbfe" : "#fff7ae", 3.5, 0.35, 90);
  if (guarded) w.events.push({ type: "guard", player: t.isPlayer || !!by?.isPlayer });
  if (o.counter && by?.isPlayer) w.events.push({ type: "counter" });

  const playerInvolved = t.isPlayer || !!by?.isPlayer;
  w.events.push({ type: "hit", x: t.x, y: t.y, crit: o.crit, big, player: !!by?.isPlayer, hurtPlayer: t.isPlayer });
  if (playerInvolved) {
    w.hitStop = HIT_STOP;
    w.shake = Math.max(w.shake, t.isPlayer ? 0.6 : o.crit || big ? 0.45 : 0.22);
  }
  if (t.hp <= 0) killCrab(w, t, by, o.sourceName);
}

function killCrab(w: World, v: Crab, by: Crab | null, sourceName?: string) {
  v.alive = false;
  v.hp = 0;
  v.deadT = 0;
  v.respawnT = BOT_RESPAWN;
  const wasKing = w.kingId === v.id;
  const score = v.score;

  // Coins: 35% of the victim's score scattered around the corpse.
  const pool = Math.floor(score * 0.25);
  const n = clamp(Math.round(3 + Math.sqrt(pool) / 22), 3, 14);
  for (let i = 0; i < n && pool > 0; i++) {
    const pk = newPickup(w, "coin", v.x, v.y, Math.floor(pool / n), true, 9 + Math.min(8, Math.sqrt(pool / n) / 10), 45);
    const a = rand(w) * Math.PI * 2, s = range(w, 80, 220) * Math.sqrt(v.scale);
    pk.vx = Math.cos(a) * s;
    pk.vy = Math.sin(a) * s;
    pk.vz = range(w, 150, 260);
    pk.lockId = v.id;
    pk.lockT = 0.4;
  }
  const meat = newPickup(w, "food", v.x, v.y, 20 * v.level, false, 11, 45);
  meat.food = "meat";
  if (v.weapon) dropEquip(w, v.x, v.y, "weapon", v.weapon);
  if (v.shield) dropEquip(w, v.x, v.y, "shield", v.shield);
  if (v.hasKey) newPickup(w, "key", v.x + 10, v.y, 0, true, 12);

  const killerName = by?.name ?? sourceName ?? "바다";
  if (v.isPlayer) {
    w.deathSnapshot = { score, weapon: v.weapon ? { ...v.weapon } : null, shield: v.shield ? { ...v.shield } : null, by: killerName };
    w.playerDown = true;
    w.stats.deaths++;
    w.events.push({ type: "playerDeath", by: killerName });
  }
  v.weapon = null;
  v.shield = null;
  v.hasKey = false;
  v.score = 0;
  burst(w, "splash", v.x, v.y, 16, 200, v.color.shell, 5, 0.8, 180);

  if (by) {
    by.kills++;
    if (by.isPlayer) w.stats.kills++;
    let reward = Math.floor(score * 0.2) + 75 * v.level;
    if (wasKing) reward += Math.floor(score * 0.3) + 10_000;
    addScore(w, by, reward);
    floatText(w, by.x, by.y - 40 * by.scale, `+${Math.round(reward).toLocaleString()}`, "#fde047", wasKing ? 26 : 18, 1.4);
  }
  w.events.push({ type: "kill", killer: killerName, victim: v.name, byPlayer: !!by?.isPlayer, victimPlayer: v.isPlayer });
  if (wasKing) {
    w.kingId = null;
    w.events.push({ type: "kingDown", name: v.name, by: by?.name ?? null, player: v.isPlayer, byPlayer: !!by?.isPlayer });
    burst(w, "gold", v.x, v.y, 30, 300, "#facc15", 5, 1.2, 260);
  }
}

function dropEquip(w: World, x: number, y: number, type: "weapon" | "shield", e: Equip<WeaponKind> | Equip<ShieldKind>) {
  const pk = newPickup(w, type, x, y, 0, true, 16, 45);
  if (type === "weapon") pk.weapon = { ...(e as Equip<WeaponKind>) };
  else pk.shield = { ...(e as Equip<ShieldKind>) };
  const a = rand(w) * Math.PI * 2;
  pk.vx = Math.cos(a) * 120;
  pk.vy = Math.sin(a) * 120;
  pk.vz = 200;
  return pk;
}

function damageCreature(w: World, cr: Creature, dmg: number, by: Crab, crit: boolean, kb: number) {
  const d = Math.max(1, Math.round(dmg));
  cr.hp -= d;
  cr.hitFlash = 0.14;
  cr.aggroId = by.id;
  cr.aggroT = 5;
  const dx = cr.x - by.x, dy = cr.y - by.y, dd = Math.hypot(dx, dy) || 1;
  const push = (kb * clamp(CRAB_RADIUS * by.scale / cr.def.radius, 0.3, 2)) * 0.6;
  cr.vx += (dx / dd) * push;
  cr.vy += (dy / dd) * push;
  if (by.isPlayer) {
    floatText(w, cr.x, cr.y - cr.def.radius, `${crit ? "치명타! " : ""}${d}`, crit ? "#fde047" : "#ffffff", crit ? 17 : 13, 0.7);
    w.hitStop = Math.max(w.hitStop, HIT_STOP * 0.6);
    w.shake = Math.max(w.shake, 0.12);
    w.events.push({ type: "hit", x: cr.x, y: cr.y, crit, big: false, player: true, hurtPlayer: false });
  }
  burst(w, "spark", cr.x, cr.y, 5, 160, "#fff7ae", 3, 0.3, 80);
  if (cr.hp <= 0) {
    cr.alive = false;
    cr.deadT = 0;
    addScore(w, by, cr.def.points * levelDef(by).gain);
    if (by.isPlayer) {
      w.stats.eaten++;
      floatText(w, cr.x, cr.y - cr.def.radius - 10, `+${Math.round(cr.def.points * levelDef(by).gain).toLocaleString()}`, "#fde047", 15, 1);
    }
    for (let i = 0; i < cr.def.meat; i++) {
      const m = newPickup(w, "food", cr.x, cr.y, Math.round(cr.def.points * 0.15), false, 11, 40);
      m.food = "meat";
      const a = rand(w) * Math.PI * 2;
      m.vx = Math.cos(a) * 110;
      m.vy = Math.sin(a) * 110;
      m.vz = 180;
    }
    burst(w, "splash", cr.x, cr.y, 10, 140, cr.def.color, 4, 0.6, 150);
  }
}

function hitBox(w: World, b: Box, by: Crab, dmg: number) {
  if (b.kind === "gold") {
    if (!by.hasKey) {
      if (by.isPlayer && b.lockedMsgT <= 0) {
        b.lockedMsgT = 1.2;
        floatText(w, b.x, b.y - 30, "🔒 열쇠가 필요해!", "#fcd34d", 15, 1.1);
        w.events.push({ type: "locked" });
      }
      b.hitFlash = 0.08;
      return;
    }
    by.hasKey = false;
    floatText(w, b.x, b.y - 34, "🔑 열쇠 사용!", "#fde047", 17, 1.2);
    breakBox(w, b, by);
    return;
  }
  b.hp -= dmg;
  b.hitFlash = 0.12;
  burst(w, "splinter", b.x, b.y, 4, 150, "#b45309", 3.5, 0.5, 140);
  if (by.isPlayer) w.events.push({ type: "hit", x: b.x, y: b.y, crit: false, big: false, player: true, hurtPlayer: false });
  if (b.hp <= 0) breakBox(w, b, by);
}

function randomWeapon(w: World, minTier: number, maxTier: number): WeaponKind {
  const list = Object.values(WEAPONS).filter((x) => x.tier >= minTier && x.tier <= maxTier);
  // Lower tiers are commoner.
  const total = list.reduce((a, x) => a + 1 / x.tier, 0);
  let r = rand(w) * total;
  for (const x of list) {
    r -= 1 / x.tier;
    if (r <= 0) return x.kind;
  }
  return list[0].kind;
}
function randomShield(w: World, minTier: number, maxTier: number): ShieldKind {
  const list = Object.values(SHIELDS).filter((x) => x.tier >= minTier && x.tier <= maxTier);
  return pick(w, list).kind;
}

function breakBox(w: World, b: Box, by: Crab) {
  b.alive = false;
  const gold = b.kind === "gold";
  const def = BOXES[b.kind];
  if (by.isPlayer) w.stats.boxes++;
  w.events.push({ type: "boxBreak", gold, player: by.isPlayer });
  burst(w, gold ? "gold" : "splinter", b.x, b.y, gold ? 26 : 14, gold ? 260 : 200, gold ? "#facc15" : "#b45309", 5, 0.8, 220);
  if (by.isPlayer) floatText(w, b.x, b.y - 30, gold ? "황금 상자 개봉!" : "파괴!", gold ? "#facc15" : "#fdba74", gold ? 20 : 16, 1.1);

  const scatter = (pk: Pickup) => {
    const a = rand(w) * Math.PI * 2, s = range(w, 70, 170);
    pk.vx = Math.cos(a) * s;
    pk.vy = Math.sin(a) * s;
    pk.vz = range(w, 160, 260);
  };
  const coinTotal = range(w, def.coins[0], def.coins[1]);
  const nCoins = gold ? 6 : 3;
  for (let i = 0; i < nCoins; i++) scatter(newPickup(w, "coin", b.x, b.y, Math.round(coinTotal / nCoins), false, gold ? 12 : 9, 40));
  if (gold) {
    scatter(dropEquip(w, b.x, b.y, "weapon", freshWeapon(randomWeapon(w, 3, 5))));
    if (rand(w) < 0.6) scatter(dropEquip(w, b.x, b.y, "shield", freshShield(randomShield(w, 2, 3))));
    const m = newPickup(w, "food", b.x, b.y, FOODS.watermelon.points, false, FOODS.watermelon.radius, 40);
    m.food = "watermelon";
    scatter(m);
  } else {
    const r = rand(w);
    if (r < 0.55) scatter(dropEquip(w, b.x, b.y, "weapon", freshWeapon(randomWeapon(w, 1, 4))));
    else if (r < 0.85) scatter(dropEquip(w, b.x, b.y, "shield", freshShield(randomShield(w, 1, 2))));
    if (rand(w) < 0.4) {
      const f = weightedFood(w);
      const m = newPickup(w, "food", b.x, b.y, FOODS[f].points, false, FOODS[f].radius, 40);
      m.food = f;
      scatter(m);
    }
  }
}

const freshWeapon = (kind: WeaponKind): Equip<WeaponKind> => ({ kind, dur: WEAPONS[kind].durability });
const freshShield = (kind: ShieldKind): Equip<ShieldKind> => ({ kind, dur: SHIELDS[kind].durability });

// ── Creatures ───────────────────────────────────────────────────────────────

function updateCreature(w: World, cr: Creature, dt: number) {
  if (!cr.alive) {
    cr.deadT += dt;
    return;
  }
  cr.hitFlash = Math.max(0, cr.hitFlash - dt);
  cr.attackCd = Math.max(0, cr.attackCd - dt);
  cr.aggroT = Math.max(0, cr.aggroT - dt);
  cr.timer -= dt;
  const def = cr.def;
  let tx = 0, ty = 0, speed = def.speed;

  const aggro = cr.aggroT > 0 ? w.crabs.find((c) => c.id === cr.aggroId && c.alive) : undefined;
  if (def.behavior === "flee") {
    let nearest: Crab | null = null, nd = 190;
    for (const c of w.crabs) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - cr.x, c.y - cr.y) - crabRadius(c);
      if (d < nd) { nd = d; nearest = c; }
    }
    if (nearest) {
      tx = cr.x - nearest.x;
      ty = cr.y - nearest.y;
      speed *= 1.25;
    }
  } else if (aggro && def.atk > 0) {
    tx = aggro.x - cr.x;
    ty = aggro.y - cr.y;
    const d = Math.hypot(tx, ty);
    if (d > 700) cr.aggroT = 0;
    const reach = def.radius + crabRadius(aggro) + 12;
    if (d < reach) {
      speed = 0;
      if (cr.attackCd <= 0 && aggro.invuln <= 0) {
        cr.attackCd = def.behavior === "tank" ? 1.6 : 1.1;
        damageCrab(w, aggro, def.atk, null, { crit: false, counter: false, knockback: 150, stun: 0, sourceName: def.name, sx: cr.x, sy: cr.y });
      }
    }
  } else if (def.kind === "lobster") {
    // The big lobster guards its patch: anything small that wanders close gets pinched.
    for (const c of w.crabs) {
      if (c.alive && Math.hypot(c.x - cr.x, c.y - cr.y) < 170 && c.level <= 5) {
        cr.aggroId = c.id;
        cr.aggroT = 3;
        break;
      }
    }
  }

  if (tx === 0 && ty === 0) {
    if (cr.timer <= 0) {
      cr.timer = range(w, 1.5, 4);
      cr.angle = rand(w) * Math.PI * 2;
    }
    tx = Math.cos(cr.angle);
    ty = Math.sin(cr.angle);
    speed *= 0.4;
  }
  const l = Math.hypot(tx, ty) || 1;
  const want = Math.atan2(ty, tx);
  let diff = want - cr.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  cr.angle += clamp(diff, -6 * dt, 6 * dt);
  cr.x += ((tx / l) * speed + cr.vx) * dt;
  cr.y += ((ty / l) * speed + cr.vy) * dt;
  cr.vx *= Math.exp(-6 * dt);
  cr.vy *= Math.exp(-6 * dt);
  if (speed > 0) cr.walk += dt * speed * 0.12;

  // Habitat: fish stay in the shallow ring, land critters on the sand.
  const dist = Math.hypot(cr.x, cr.y);
  const edge = islandRadiusAt(Math.atan2(cr.y, cr.x));
  if (def.water) {
    const lo = edge + 12, hi = edge + SHALLOW_W - 12;
    if (dist < lo || dist > hi) {
      const nd = clamp(dist, lo, hi);
      cr.x = (cr.x / dist) * nd;
      cr.y = (cr.y / dist) * nd;
      cr.angle += Math.PI * 0.5;
    }
  } else if (dist > edge - def.radius) {
    const nd = edge - def.radius;
    cr.x = (cr.x / dist) * nd;
    cr.y = (cr.y / dist) * nd;
    cr.angle = Math.atan2(-cr.y, -cr.x);
  }
}

// ── Collisions ──────────────────────────────────────────────────────────────

function pushOutCircle(o: { x: number; y: number }, r: number, cx: number, cy: number, cr: number) {
  const dx = o.x - cx, dy = o.y - cy;
  const d = Math.hypot(dx, dy);
  const min = r + cr;
  if (d < min && d > 0.0001) {
    o.x = cx + (dx / d) * min;
    o.y = cy + (dy / d) * min;
    return true;
  }
  return false;
}

function resolveCollisions(w: World) {
  const alive = w.crabs.filter((c) => c.alive);
  for (let i = 0; i < alive.length; i++) {
    const a = alive[i];
    const ra = crabRadius(a);
    for (let j = i + 1; j < alive.length; j++) {
      const b = alive[j];
      const rb = crabRadius(b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = (ra + rb) * 0.9;
      if (d < min && d > 0.0001) {
        const ma = a.scale * a.scale, mb = b.scale * b.scale;
        const over = min - d;
        a.x -= (dx / d) * over * (mb / (ma + mb));
        a.y -= (dy / d) * over * (mb / (ma + mb));
        b.x += (dx / d) * over * (ma / (ma + mb));
        b.y += (dy / d) * over * (ma / (ma + mb));
      }
    }
    for (const cr of w.creatures) {
      if (!cr.alive) continue;
      pushOutCircle(cr, cr.def.radius, a.x, a.y, ra * 0.9);
    }
  }
  const solids = (o: { x: number; y: number }, r: number) => {
    for (const k of w.rocks) if (Math.abs(o.x - k.x) < k.r + r && Math.abs(o.y - k.y) < k.r + r) pushOutCircle(o, r, k.x, k.y, k.r);
    for (const p of w.palms) if (Math.abs(o.x - p.x) < p.r + r && Math.abs(o.y - p.y) < p.r + r) pushOutCircle(o, r, p.x, p.y, p.r);
    for (const b of w.boxes) if (b.alive && Math.abs(o.x - b.x) < 40 + r && Math.abs(o.y - b.y) < 40 + r) pushOutCircle(o, r, b.x, b.y, BOXES[b.kind].radius);
    const d = Math.hypot(o.x, o.y);
    const wall = wallRadius(o.x, o.y) - r;
    if (d > wall) {
      o.x = (o.x / d) * wall;
      o.y = (o.y / d) * wall;
    }
  };
  for (const c of alive) solids(c, crabRadius(c));
  for (const cr of w.creatures) if (cr.alive && !cr.def.water) solids(cr, cr.def.radius);
}

// ── Pickups ─────────────────────────────────────────────────────────────────

function equipScore(tier: number, dur: number, maxDur: number) {
  return tier * 10 + (dur / maxDur) * 6;
}

function tryCollect(w: World, c: Crab, p: Pickup): boolean {
  const lv = levelDef(c);
  switch (p.type) {
    case "food": {
      const f = FOODS[p.food ?? "banana"];
      const pts = p.value * lv.gain;
      addScore(w, c, pts);
      c.hp = Math.min(c.maxHp, c.hp + c.maxHp * f.heal);
      if (c.isPlayer) {
        w.stats.eaten++;
        floatText(w, p.x, p.y - 10, `+${Math.round(pts).toLocaleString()}`, "#bef264", 13, 0.7);
        w.events.push({ type: "eat", player: true });
      }
      burst(w, "star", p.x, p.y, 3, 60, "#fef08a", 3, 0.4, 60);
      return true;
    }
    case "coin": {
      const pts = p.absolute ? p.value : p.value * lv.gain;
      addScore(w, c, pts);
      if (c.isPlayer) {
        floatText(w, p.x, p.y - 10, `+${Math.round(pts).toLocaleString()}`, "#fde047", 14, 0.8);
        w.events.push({ type: "coin", player: true });
      }
      burst(w, "coin", p.x, p.y, 4, 80, "#facc15", 3, 0.4, 80);
      return true;
    }
    case "key":
      if (c.hasKey) return false;
      c.hasKey = true;
      if (c.isPlayer) {
        w.events.push({ type: "key" });
        floatText(w, p.x, p.y - 12, "🔑 열쇠 획득!", "#fde047", 16, 1.1);
      }
      return true;
    case "weapon": {
      const nw = p.weapon!;
      const nd = WEAPONS[nw.kind];
      const cur = c.weapon;
      if (cur) {
        const cd = WEAPONS[cur.kind];
        if (equipScore(nd.tier, nw.dur, nd.durability) <= equipScore(cd.tier, cur.dur, cd.durability) + 2) return false;
        const dropped = dropEquip(w, c.x, c.y, "weapon", cur);
        dropped.lockId = c.id;
        dropped.lockT = 2;
      }
      c.weapon = { ...nw };
      if (c.isPlayer) {
        w.events.push({ type: "equip", name: nd.name, emoji: nd.emoji });
        floatText(w, c.x, c.y - 34 * c.scale, `${nd.emoji} ${nd.name} 장착!`, "#e0f2fe", 16, 1.1);
      }
      return true;
    }
    case "shield": {
      const ns = p.shield!;
      const nd = SHIELDS[ns.kind];
      const cur = c.shield;
      if (cur) {
        const cd = SHIELDS[cur.kind];
        if (equipScore(nd.tier, ns.dur, nd.durability) <= equipScore(cd.tier, cur.dur, cd.durability) + 2) return false;
        const dropped = dropEquip(w, c.x, c.y, "shield", cur);
        dropped.lockId = c.id;
        dropped.lockT = 2;
      }
      c.shield = { ...ns };
      if (c.isPlayer) {
        w.events.push({ type: "equip", name: nd.name, emoji: nd.emoji });
        floatText(w, c.x, c.y - 34 * c.scale, `${nd.emoji} ${nd.name} 장착!`, "#e0f2fe", 16, 1.1);
      }
      return true;
    }
  }
}

function updatePickups(w: World, dt: number) {
  const alive = w.crabs.filter((c) => c.alive);
  const keep: Pickup[] = [];
  for (const p of w.pickups) {
    p.age += dt;
    if (p.lockT > 0) p.lockT -= dt;
    if (p.vx || p.vy || p.z > 0 || p.vz) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-4 * dt);
      p.vy *= Math.exp(-4 * dt);
      p.vz -= 700 * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = Math.abs(p.vz) > 60 ? -p.vz * 0.35 : 0;
      }
      if (Math.abs(p.vx) < 2 && Math.abs(p.vy) < 2 && p.z === 0 && p.vz === 0) p.vx = p.vy = 0;
      const d = Math.hypot(p.x, p.y), wall = wallRadius(p.x, p.y) - 20;
      if (d > wall) {
        p.x = (p.x / d) * wall;
        p.y = (p.y / d) * wall;
      }
      for (const k of w.rocks) pushOutCircle(p, p.radius, k.x, k.y, k.r);
    }
    if (p.age > p.ttl) continue;
    let taken = false;
    if (p.z < 12) {
      for (const c of alive) {
        if (p.lockT > 0 && p.lockId === c.id) continue;
        const r = crabRadius(c) + p.radius;
        const dx = c.x - p.x, dy = c.y - p.y;
        if (dx * dx + dy * dy < r * r && tryCollect(w, c, p)) {
          taken = true;
          break;
        }
      }
    }
    if (!taken) keep.push(p);
  }
  w.pickups = keep;
}

// ── HealingZone ─────────────────────────────────────────────────────────────

function applyZones(w: World, dt: number) {
  for (const c of w.crabs) {
    if (!c.alive) continue;
    const r = crabRadius(c);
    const was = c.inPool;
    c.inPool = w.pools.some((p) => Math.hypot(c.x - p.x, c.y - p.y) < p.r + r * 0.3);
    if (c.inPool && c.hp < c.maxHp) {
      c.hp = Math.min(c.maxHp, c.hp + c.maxHp * POOL_HEAL_RATE * dt);
      if (rand(w) < dt * 6) burst(w, "heal", c.x + range(w, -r, r), c.y + range(w, -r, r), 1, 10, "#86efac", 5, 0.9, 70);
    }
    if (c.isPlayer && c.inPool && !was && c.hp < c.maxHp) floatText(w, c.x, c.y - 30 * c.scale, "💧 치유의 웅덩이", "#86efac", 15, 1.1);
  }
}

// ── GameManager: leaderboard + king election ────────────────────────────────

export function updateLeaderboard(w: World, initial = false) {
  const sorted = [...w.crabs].sort((a, b) => (b.alive ? b.score : -1) - (a.alive ? a.score : -1));
  w.ranking = sorted.map((c) => c.id);
  const top = sorted[0];
  if (!top || !top.alive || top.score <= 0) return;
  const cur = w.kingId !== null ? w.crabs.find((c) => c.id === w.kingId) : undefined;
  // Hysteresis: a challenger must beat the sitting king by 5% (and 300 pts) to take the crown.
  if (cur && cur.alive && cur !== top && (top.score < cur.score * 1.05 || top.score - cur.score < 300)) return;
  if (cur === top) return;
  w.kingId = top.id;
  // The opening seconds reshuffle a lot — crown silently until things settle.
  if (!initial && w.time >= 10) {
    w.events.push({ type: "kingNew", name: top.name, player: top.isPlayer });
    burst(w, "gold", top.x, top.y, 24, 240, "#facc15", 5, 1, 240);
  }
}

export function rankOf(w: World, id: number): number {
  return w.ranking.indexOf(id) + 1;
}

// ── Death / respawn ─────────────────────────────────────────────────────────

function respawnBot(w: World, c: Crab) {
  const p = randomLandPoint(w, 30, true, 0.9);
  c.alive = true;
  c.x = p.x;
  c.y = p.y;
  c.vx = c.vy = 0;
  c.score = 0;
  syncLevel(c, true);
  c.hp = c.maxHp;
  c.stamina = STAMINA_MAX;
  c.invuln = SPAWN_SHIELD;
  c.combo = 0;
  c.counter = null;
  c.stun = 0;
  if (c.brain) {
    c.brain.goal = "wander";
    c.brain.aggression = clamp(c.brain.aggression + range(w, -0.15, 0.15), 0.1, 1);
  }
}

/** Continue: spend the one heart — keep half the score and the gear you died with. */
export function revivePlayer(w: World): boolean {
  if (!w.playerDown || w.revivesLeft <= 0 || w.over) return false;
  const me = player(w);
  const snap = w.deathSnapshot;
  w.revivesLeft--;
  w.playerDown = false;
  const p = randomLandPoint(w, 30, true, 0.85);
  me.alive = true;
  me.x = p.x;
  me.y = p.y;
  me.vx = me.vy = 0;
  me.score = Math.floor((snap?.score ?? 0) * 0.5);
  syncLevel(me, true);
  me.hp = me.maxHp;
  me.stamina = STAMINA_MAX;
  me.invuln = SPAWN_SHIELD;
  me.weapon = snap?.weapon ? { ...snap.weapon, dur: Math.max(1, Math.ceil(snap.weapon.dur / 2)) } : null;
  me.shield = snap?.shield ? { ...snap.shield, dur: Math.max(1, Math.ceil(snap.shield.dur / 2)) } : null;
  me.combo = 0;
  me.counter = null;
  me.stun = 0;
  w.deathSnapshot = null;
  return true;
}

// ── Bot AI ──────────────────────────────────────────────────────────────────

const IDLE: CrabInput = { moveX: 0, moveY: 0, boost: false, attack: false };

/** Seconds for `a` to kill `b` (shield-adjusted), used for fight-or-flight. */
function timeToKill(a: Crab, b: Crab): number {
  const block = b.shield ? SHIELDS[b.shield.kind].block * 0.5 : 0;
  return b.hp / Math.max(1, crabDps(a) * (1 - block));
}

export function botThink(w: World, c: Crab, dt: number): CrabInput {
  const br = c.brain;
  if (!br) return IDLE;
  br.think -= dt;
  const r = crabRadius(c);
  const hpFrac = c.hp / c.maxHp;

  // Stuck detection → random wander for a moment.
  br.stuck += dt;
  if (br.stuck > 1) {
    const moved = Math.hypot(c.x - br.lastX, c.y - br.lastY);
    if (moved < 25 && br.goal !== "pool") {
      br.goal = "wander";
      br.wanderAngle = rand(w) * Math.PI * 2;
      br.think = 0.9;
    }
    br.stuck = 0;
    br.lastX = c.x;
    br.lastY = c.y;
  }

  if (br.think <= 0) {
    br.think = range(w, 0.22, 0.4) / (0.6 + br.skill * 0.4);
    decide(w, c, br, hpFrac);
  }

  // Resolve the live target position.
  let tx = br.gx, ty = br.gy, tr = 0;
  let attackable = false;
  if (br.goal === "crab") {
    const t = w.crabs.find((o) => o.id === br.targetId);
    if (!t || !t.alive) br.think = 0;
    else {
      tx = t.x; ty = t.y; tr = crabRadius(t); attackable = t.invuln <= 0;
    }
  } else if (br.goal === "creature") {
    const t = w.creatures.find((o) => o.id === br.targetId);
    if (!t || !t.alive) br.think = 0;
    else {
      tx = t.x; ty = t.y; tr = t.def.radius; attackable = true;
    }
  } else if (br.goal === "box") {
    const t = w.boxes.find((o) => o.id === br.targetId);
    if (!t || !t.alive) br.think = 0;
    else {
      tx = t.x; ty = t.y; tr = BOXES[t.kind].radius; attackable = true;
    }
  } else if (br.goal === "food") {
    const t = w.pickups.find((o) => o.id === br.targetId);
    if (!t) br.think = 0;
    else { tx = t.x; ty = t.y; }
  } else if (br.goal === "wander") {
    tx = c.x + Math.cos(br.wanderAngle) * 200;
    ty = c.y + Math.sin(br.wanderAngle) * 200;
  }

  let dx = tx - c.x, dy = ty - c.y;
  const dist = Math.hypot(dx, dy);
  const reach = attackReach(c);
  let attack = false;
  const faceX = dx, faceY = dy;
  if (attackable && dist - tr < reach * 0.95) {
    // In range: square up and swing. Keep closing a little on crabs so they can't kite.
    const aim = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - c.angle), Math.cos(Math.atan2(dy, dx) - c.angle)));
    attack = aim < 0.6 && rand(w) < 0.35 + br.skill * 0.65;
    if (br.goal !== "crab" || dist - tr < reach * 0.55) {
      dx = 0;
      dy = 0;
    }
  }
  if (br.goal === "pool" && dist < 40) {
    dx = 0;
    dy = 0;
  }

  // Obstacle avoidance: steer around rocks in the way.
  if (dx !== 0 || dy !== 0) {
    const l = Math.hypot(dx, dy);
    let sx = dx / l, sy = dy / l;
    for (const k of w.rocks) {
      const ox = c.x - k.x, oy = c.y - k.y;
      const od = Math.hypot(ox, oy);
      const clearance = k.r + r + 40;
      if (od < clearance && od > 0.01) {
        const push = (clearance - od) / clearance;
        sx += (ox / od) * push * 1.6;
        sy += (oy / od) * push * 1.6;
        // Tangential slide so they don't jam head-on.
        sx += (-oy / od) * push * 0.8;
        sy += (ox / od) * push * 0.8;
      }
    }
    dx = sx;
    dy = sy;
  }

  const chasing = br.goal === "crab" && dist < 420 && dist > reach;
  const boost = (br.goal === "flee" || (chasing && c.stamina > 35)) && c.stamina > 5;
  return { moveX: dx, moveY: dy, faceX: attack || (attackable && dist < reach * 1.5) ? faceX : undefined, faceY: attack || (attackable && dist < reach * 1.5) ? faceY : undefined, boost, attack };
}

function decide(w: World, c: Crab, br: Brain, hpFrac: number) {
  const vision = 480 + 160 * c.scale;
  const lv = levelDef(c);

  // 1) Threat assessment.
  let threat: Crab | null = null, threatD = Infinity;
  for (const o of w.crabs) {
    if (o === c || !o.alive) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d > vision * 0.7) continue;
    const dangerous = timeToKill(o, c) < timeToKill(c, o) * 0.8;
    if (dangerous && d < threatD) { threat = o; threatD = d; }
  }

  // 2) Low HP → heal in a tide pool (or flee first if hunted).
  if (hpFrac < 0.4 || (br.goal === "pool" && hpFrac < 0.92)) {
    const pool = w.pools.reduce((best, p) => (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? p : best), w.pools[0]);
    if (threat && threatD < 220) setFlee(br, c, threat);
    else {
      br.goal = "pool";
      br.gx = pool.x;
      br.gy = pool.y;
    }
    return;
  }
  if (threat && threatD < 200 + 90 * c.scale && br.aggression < 0.85) {
    setFlee(br, c, threat);
    return;
  }

  // 3) Opportunity scoring.
  let best = 0;
  let choice: { goal: Brain["goal"]; id: number; x: number; y: number } | null = null;
  const consider = (goal: Brain["goal"], id: number, x: number, y: number, value: number) => {
    if (value > best) {
      best = value;
      choice = { goal, id, x, y };
    }
  };

  for (const o of w.crabs) {
    if (o === c || !o.alive || o.invuln > 0) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    const isKing = o.id === w.kingId;
    if (d > vision * (isKing ? 1.8 : 1)) continue;
    const mine = timeToKill(c, o), theirs = timeToKill(o, c);
    if (mine > theirs * (0.55 + br.aggression * 0.55)) continue;
    // Big crabs mostly ignore small fry — not worth the chase.
    const smallFry = o.level < c.level - 3 ? 0.25 : 1;
    const payoff = (o.score * 0.6 + 200 * o.level * lv.gain) * smallFry + (isKing ? o.score * 0.5 + 10_000 : 0);
    consider("crab", o.id, o.x, o.y, (payoff * (0.4 + br.aggression)) / (d + 150));
  }
  for (const cr of w.creatures) {
    if (!cr.alive) continue;
    const d = Math.hypot(cr.x - c.x, cr.y - c.y);
    if (d > vision) continue;
    // Can I tank it? Creature hits every ~1.2s.
    const theirTtk = c.hp / Math.max(0.1, cr.def.atk / 1.2);
    const myTtk = cr.hp / Math.max(1, crabDps(c));
    if (cr.def.atk > 0 && myTtk > theirTtk * 0.6) continue;
    consider("creature", cr.id, cr.x, cr.y, (cr.def.points * lv.gain) / (d + 80 + myTtk * 90));
  }
  for (const b of w.boxes) {
    if (!b.alive) continue;
    const d = Math.hypot(b.x - c.x, b.y - c.y);
    if (d > vision) continue;
    if (b.kind === "gold") {
      if (c.hasKey) consider("box", b.id, b.x, b.y, 9000 * lv.gain / (d + 60));
    } else {
      const want = c.weapon ? 250 : 900;
      consider("box", b.id, b.x, b.y, (want * lv.gain) / (d + 100));
    }
  }
  for (const p of w.pickups) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d > vision) continue;
    let v = 0;
    if (p.type === "food") v = p.value * lv.gain;
    else if (p.type === "coin") v = p.absolute ? p.value : p.value * lv.gain;
    else if (p.type === "key") v = c.hasKey ? 0 : 1500 * lv.gain;
    else if (p.type === "weapon" && p.weapon) {
      const nd = WEAPONS[p.weapon.kind];
      const curTier = c.weapon ? WEAPONS[c.weapon.kind].tier : 0;
      v = nd.tier > curTier ? 1200 * lv.gain : 0;
    } else if (p.type === "shield" && p.shield) {
      const curTier = c.shield ? SHIELDS[c.shield.kind].tier : 0;
      v = SHIELDS[p.shield.kind].tier > curTier ? 900 * lv.gain : 0;
    }
    if (v > 0) consider("food", p.id, p.x, p.y, v / (d + 40));
  }

  const ch = choice as { goal: Brain["goal"]; id: number; x: number; y: number } | null;
  if (ch) {
    br.goal = ch.goal;
    br.targetId = ch.id;
    br.gx = ch.x;
    br.gy = ch.y;
  } else {
    br.goal = "wander";
    // Drift toward the island centre if near the shore.
    if (Math.hypot(c.x, c.y) > 1400) br.wanderAngle = Math.atan2(-c.y, -c.x) + range(w, -0.6, 0.6);
    else if (rand(w) < 0.3) br.wanderAngle = rand(w) * Math.PI * 2;
  }
}

function setFlee(br: Brain, c: Crab, threat: Crab) {
  br.goal = "flee";
  const ax = c.x - threat.x, ay = c.y - threat.y;
  const l = Math.hypot(ax, ay) || 1;
  // Bias away from the sea wall so fleeing crabs don't pin themselves.
  const cx = -c.x / (Math.hypot(c.x, c.y) || 1), cy = -c.y / (Math.hypot(c.x, c.y) || 1);
  const edgeBias = Math.hypot(c.x, c.y) > 1300 ? 0.9 : 0.2;
  br.gx = c.x + ((ax / l) + cx * edgeBias) * 300;
  br.gy = c.y + ((ay / l) + cy * edgeBias) * 300;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface MatchSummary {
  score: number;
  rank: number;
  total: number;
  seconds: number;
  stats: MatchStats;
  top: { name: string; score: number; isPlayer: boolean; level: number }[];
  endedByDeath: boolean;
  killedBy: string | null;
}

export function summarize(w: World): MatchSummary {
  const me = player(w);
  const score = w.over ? w.finalScore : me.alive ? me.score : (w.deathSnapshot?.score ?? 0);
  const others = w.crabs.filter((c) => !c.isPlayer).map((c) => ({ name: c.name, score: c.alive ? c.score : 0, isPlayer: false, level: c.level }));
  const all = [...others, { name: me.name, score, isPlayer: true, level: levelForScore(score, me.species).level }].sort((a, b) => b.score - a.score);
  return {
    score,
    rank: all.findIndex((x) => x.isPlayer) + 1,
    total: all.length,
    seconds: Math.floor(w.time),
    stats: { ...w.stats },
    top: all.slice(0, 10),
    endedByDeath: !me.alive,
    killedBy: !me.alive ? (w.deathSnapshot?.by ?? null) : null,
  };
}
