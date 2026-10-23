/**
 * Deterministic beat-'em-up simulation for 섬광전대 프리즘파이브.
 *
 * One `step(world, input)` = one 1/60 s tick. Seeded RNG only (never
 * Math.random) so tests and the bot sim are reproducible. The canvas host
 * drains `world.events` for sound/UI each frame; `world.fx` is cosmetic state
 * the renderer reads (also advanced here so a replay looks identical).
 *
 * Flow per stage: henshin intro → scrolling waves (camera locks until each is
 * cleared) → boss → 거대화 → giant-robot duel (mecha vs giant) → stage clear.
 */

import {
  ASSIST_HITS,
  ASSIST_MAX,
  BOSSES,
  COMBO_WINDOW,
  DIFFICULTIES,
  DODGE_INVULN,
  DODGE_TICKS,
  EN_MAX,
  ENEMIES,
  GETUP_INVULN,
  GRAVITY,
  HERO_ORDER,
  HEROES,
  IRON_MAG,
  JUGGLE_MAX,
  JUMP_VY,
  MECHA,
  MECHA_FINISH_AT,
  PERFECT_TICKS,
  PICKUPS,
  PRISM_MAX,
  RELOAD_MOVE,
  STAGES,
  STYLE_MAX,
  TEAM_ULT,
  VIEW_W,
  Z_MAX,
  stageGrade,
  styleRank,
  type BossId,
  type Difficulty,
  type EnemyId,
  type HeroDef,
  type HeroId,
  type HitDef,
  type HitKind,
  type MoveDef,
  type PickupKind,
  type ProjKind,
  type ProjSpawn,
  type StageDef,
} from "./data";

// ---------------------------------------------------------------- rng

export function rngNext(w: { seed: number }): number {
  let t = (w.seed = (w.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = (w: World, a: number, b: number) => a + rngNext(w) * (b - a);
const pick = <T,>(w: World, arr: readonly T[]): T => arr[Math.floor(rngNext(w) * arr.length)];

// ---------------------------------------------------------------- types

export interface Input {
  mx: -1 | 0 | 1;
  mz: -1 | 0 | 1;
  light: boolean;
  heavy: boolean;
  jump: boolean;
  dodge: boolean;
  /** 1..3 = skill pressed this tick. */
  skill: 0 | 1 | 2 | 3;
  ult: boolean;
  assist: boolean;
  /** 견제기 (H). */
  poke: boolean;
}
export const NO_INPUT: Input = { mx: 0, mz: 0, light: false, heavy: false, jump: false, dodge: false, skill: 0, ult: false, assist: false, poke: false };

export type ActorKind = "hero" | "enemy" | "boss" | "clone" | "assist" | "mecha" | "giant" | "crate" | "turret";
export type AState = "idle" | "walk" | "run" | "jump" | "attack" | "tell" | "hit" | "air" | "down" | "getup" | "dodge" | "dead" | "grabbed" | "held" | "stunned" | "pose" | "gone";
export type Reaction = "high" | "low" | "stagger" | "bind" | "spin" | "guard";

export interface Actor {
  id: number;
  kind: ActorKind;
  team: 0 | 1;
  name: string;
  heroId?: HeroId;
  enemyId?: EnemyId;
  bossId?: BossId;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  face: 1 | -1;
  hp: number;
  maxHp: number;
  state: AState;
  /** Ticks in the current state. */
  t: number;
  move: MoveDef | null;
  moveT: number;
  /** Which (hit index × target) pairs this move instance already landed. */
  hitLog: number[];
  /** The move instance landed at least one hit. */
  landed: boolean;
  /** Queued enemy move during its telegraph. */
  next: MoveDef | null;
  stun: number;
  reaction: Reaction;
  juggle: number;
  invuln: number;
  /** White hit flash ticks (render). */
  flash: number;
  breakG: number;
  breakMax: number;
  /** Ticks of 브레이크 left. */
  broken: number;
  phase: number;
  scale: number;
  groundBounce: boolean;
  otgUsed: boolean;
  /** Hero-only air hover hits this jump / air chain index. */
  airHits: number;
  airIdx: number;
  /** Shield dropped (방패병) for this many ticks. */
  guardBroken: number;
  /** Boss guard stance / parry stance ticks. */
  guardStance: number;
  parry: number;
  /** Self-destruct fuse (자폭병), -1 = not lit. */
  fuse: number;
  /** Holder id while `held` (giant swing victim). */
  holder: number;
  /** Has walked inside the locked arena at least once. */
  entered: boolean;
  /** Hidden mid-teleport. */
  hidden: number;
  /** Clone / assist lifetime. */
  life: number;
  ironWall: number;
  /** Dark Blast charge progress (0..1) for the HUD. */
  charge: number;
  /** Untouchable while falling after the juggle cap. */
  untouchable: boolean;
  koByHero: boolean;
  /** 세이렌's water marks (0..3) and their remaining ticks. */
  mark: number;
  markT: number;
  ai: { cd: number; think: number; side: 1 | -1; wz: number; patCd: Record<string, number>; zOff: number };
  drop?: PickupKind;
}

export interface Proj {
  id: number;
  team: 0 | 1;
  owner: number;
  kind: ProjKind;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  t: number;
  life: number;
  /** Ticks before it becomes harmful (pillars/rocks warn first). */
  warn: number;
  hit: ProjSpawn["hit"];
  pierce: boolean;
  blast: number;
  home: number;
  hitIds: number[];
  /** Beam length. */
  len: number;
  dir: 1 | -1;
  color?: string;
  /** Explosions hit both teams (자폭병). */
  friendlyFire?: boolean;
}

export type FxKind = "spark" | "heavySpark" | "slash" | "ring" | "dust" | "boom" | "bigBoom" | "num" | "text" | "guard" | "heal" | "flashLine" | "smoke" | "speed";
export interface Fx {
  kind: FxKind;
  x: number;
  z: number;
  y: number;
  t: number;
  life: number;
  color: string;
  text?: string;
  size: number;
  dir: number;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  t: number;
}

export type GameEvent =
  | { type: "swing"; heavy: boolean }
  | { type: "hit"; heavy: boolean; onHero: boolean; blocked?: boolean }
  | { type: "shoot"; kind: ProjKind }
  | { type: "explode"; big: boolean }
  | { type: "ko"; boss: boolean }
  | { type: "skill"; name: string }
  | { type: "ult"; name: string; color: string }
  | { type: "assist"; hero: HeroId }
  | { type: "perfect" }
  | { type: "counter" }
  | { type: "overheat" }
  | { type: "chain" }
  | { type: "detonate"; marks: number }
  | { type: "reload" }
  | { type: "break"; name: string }
  | { type: "parry" }
  | { type: "phase"; phase: number; name: string }
  | { type: "bossIntro"; boss: BossId }
  | { type: "giant"; boss: BossId }
  | { type: "finishReady" }
  | { type: "henshin" }
  | { type: "go" }
  | { type: "pickup"; kind: PickupKind }
  | { type: "lifeLost"; left: number }
  | { type: "comboEnd"; combo: number; bonus: number }
  | { type: "tech" }
  | { type: "clear" }
  | { type: "over" };

export type Phase = "intro" | "play" | "bossIntro" | "bossDown" | "giantIntro" | "finish" | "clear" | "over";

export interface CutIn {
  name: string;
  color: string;
  heroId: HeroId | "team" | "mecha";
  t: number;
  total: number;
}

export interface World {
  seed: number;
  tick: number;
  stage: StageDef;
  diff: Difficulty;
  heroId: HeroId;
  hero: HeroDef;
  mode: "stage" | "giant";
  phase: Phase;
  phaseT: number;
  actors: Actor[];
  projs: Proj[];
  fx: Fx[];
  pickups: Pickup[];
  nextId: number;
  camX: number;
  lockX: number | null;
  waveIdx: number;
  groupIdx: number;
  /** Ticks of global hit-stop. */
  freeze: number;
  /** Ticks of half-speed (섬광 회피 / boss KO). */
  slow: number;
  /** Camera shake strength (render). */
  shake: number;
  cutin: CutIn | null;
  combo: number;
  comboT: number;
  maxCombo: number;
  style: number;
  styleTop: number;
  lastMoveId: string;
  score: number;
  kills: number;
  bossKills: number;
  dmgTaken: number;
  lives: number;
  livesLost: number;
  perfectDodges: number;
  en: number;
  prism: number;
  assistStock: number;
  assistHits: number;
  assistIdx: number;
  cds: [number, number, number];
  buf: { light: number; heavy: number; jump: number; dodge: number; skill: number; skillN: 0 | 1 | 2 | 3; ult: number; assist: number; poke: number };
  lastMx: number;
  tapDir: number;
  tapT: number;
  running: boolean;
  /** Play time in ticks (excludes cut-ins/intros). */
  time: number;
  banner: { text: string; sub?: string; t: number; color: string } | null;
  events: GameEvent[];
  bossActor: number;
  /** The stage boss (kept after its actor is removed, for the giant phase). */
  curBoss: BossId | null;
  ventT: number;
  finishReady: boolean;
  goT: number;
  /** Hero traits: 블레이즈 heat/overheat, 볼트 charge, 아이언 ammo + shield drone, 세이렌 regen. */
  heat: number;
  overheat: number;
  charge: number;
  ammo: number;
  shieldHits: number;
  regenT: number;
  counters: number;
  /** Targets already visited by the current 연쇄 번개 스텝. */
  blinkIds: number[];
  /** Guards chain-lightning from re-triggering itself. */
  chaining: boolean;
  summary: StageSummary | null;
}

export interface StageSummary {
  stage: number;
  hero: HeroId;
  diff: Difficulty;
  cleared: boolean;
  score: number;
  timeSec: number;
  maxCombo: number;
  kills: number;
  bossKills: number;
  dmgTaken: number;
  livesLost: number;
  perfectDodges: number;
  styleTop: string;
  grade: "S" | "A" | "B" | "C" | "-";
  bonus: { clear: number; time: number; noDeath: number; lives: number };
}

// ---------------------------------------------------------------- creation

const BODY_R = 14;
const FREE: AState[] = ["idle", "walk", "run"];

function baseActor(w: World, kind: ActorKind, team: 0 | 1, x: number, z: number, hp: number, name: string): Actor {
  return {
    id: w.nextId++,
    kind,
    team,
    name,
    x,
    z,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    face: team === 0 ? 1 : -1,
    hp,
    maxHp: hp,
    state: "idle",
    t: 0,
    move: null,
    moveT: 0,
    hitLog: [],
    landed: false,
    next: null,
    stun: 0,
    reaction: "high",
    juggle: 0,
    invuln: 0,
    flash: 0,
    breakG: 0,
    breakMax: 0,
    broken: 0,
    phase: 1,
    scale: 1,
    groundBounce: false,
    otgUsed: false,
    airHits: 0,
    airIdx: 0,
    guardBroken: 0,
    guardStance: 0,
    parry: 0,
    fuse: -1,
    holder: -1,
    entered: false,
    hidden: 0,
    life: -1,
    ironWall: 0,
    charge: 0,
    untouchable: false,
    koByHero: false,
    mark: 0,
    markT: 0,
    ai: { cd: 40, think: 0, side: 1, wz: z, patCd: {}, zOff: 0 },
  };
}

export function createWorld(opts: { stage: number; hero: HeroId; diff: Difficulty; seed?: number }): World {
  const stage = STAGES.find((s) => s.id === opts.stage) ?? STAGES[0];
  const hero = HEROES[opts.hero];
  const w: World = {
    seed: opts.seed ?? 12345,
    tick: 0,
    stage,
    diff: opts.diff,
    heroId: opts.hero,
    hero,
    mode: "stage",
    phase: "intro",
    phaseT: 0,
    actors: [],
    projs: [],
    fx: [],
    pickups: [],
    nextId: 1,
    camX: 0,
    lockX: null,
    waveIdx: 0,
    groupIdx: 0,
    freeze: 0,
    slow: 0,
    shake: 0,
    cutin: null,
    combo: 0,
    comboT: 0,
    maxCombo: 0,
    style: 0,
    styleTop: 0,
    lastMoveId: "",
    score: 0,
    kills: 0,
    bossKills: 0,
    dmgTaken: 0,
    lives: DIFFICULTIES[opts.diff].lives,
    livesLost: 0,
    perfectDodges: 0,
    en: 60,
    prism: 0,
    assistStock: 1,
    assistHits: 0,
    assistIdx: 0,
    cds: [0, 0, 0],
    buf: { light: 0, heavy: 0, jump: 0, dodge: 0, skill: 0, skillN: 0, ult: 0, assist: 0, poke: 0 },
    lastMx: 0,
    tapDir: 0,
    tapT: -99,
    running: false,
    time: 0,
    banner: null,
    events: [],
    bossActor: -1,
    curBoss: null,
    ventT: 0,
    finishReady: false,
    goT: 0,
    heat: 0,
    overheat: 0,
    charge: 0,
    ammo: IRON_MAG,
    shieldHits: 0,
    regenT: 0,
    counters: 0,
    blinkIds: [],
    chaining: false,
    summary: null,
  };
  const h = baseActor(w, "hero", 0, 120, Z_MAX * 0.55, hero.hp, hero.name);
  h.heroId = opts.hero;
  h.state = "pose";
  w.actors.push(h);
  w.events.push({ type: "henshin" });
  w.banner = { text: stage.name, sub: stage.sub, t: 150, color: hero.color };
  return w;
}

export const heroActor = (w: World): Actor => w.actors.find((a) => a.kind === "hero" || a.kind === "mecha")!;
export const bossActor = (w: World): Actor | undefined => w.actors.find((a) => a.id === w.bossActor);

const diffOf = (w: World) => DIFFICULTIES[w.diff];

function spawnEnemy(w: World, id: EnemyId, side: 1 | -1): Actor {
  const def = ENEMIES[id];
  const x = side > 0 ? w.camX + VIEW_W + 30 + rand(w, 0, 60) : w.camX - 30 - rand(w, 0, 60);
  const e = baseActor(w, "enemy", 1, x, rand(w, 12, Z_MAX - 12), Math.round(def.hp * diffOf(w).hp), def.name);
  e.enemyId = id;
  e.face = side > 0 ? -1 : 1;
  e.breakMax = def.breakMax ?? 0;
  e.ai.cd = 30 + Math.floor(rand(w, 0, 60));
  e.ai.side = side;
  e.ai.zOff = rand(w, -40, 40);
  if (id === "elite") e.drop = "meat";
  else if (rngNext(w) < 0.14) e.drop = pick(w, ["riceball", "riceball", "crystal", "prism"] as PickupKind[]);
  w.actors.push(e);
  return e;
}

function spawnBoss(w: World, id: BossId): Actor {
  const def = BOSSES[id];
  const b = baseActor(w, "boss", 1, w.camX + VIEW_W - 110, Z_MAX * 0.5, Math.round(def.hp * diffOf(w).hp), def.name);
  b.bossId = id;
  b.breakMax = def.breakMax;
  b.scale = def.scale;
  b.entered = true;
  b.ai.think = 60;
  w.actors.push(b);
  w.bossActor = b.id;
  w.curBoss = id;
  return b;
}

function spawnCrate(w: World, x: number, z: number) {
  const c = baseActor(w, "crate", 1, x, z, 40, "상자");
  c.entered = true;
  c.drop = pick(w, ["riceball", "riceball", "meat", "crystal", "prism", "star"] as PickupKind[]);
  w.actors.push(c);
}

// ---------------------------------------------------------------- fx helpers

function fx(w: World, kind: FxKind, x: number, z: number, y: number, extra: Partial<Fx> = {}) {
  w.fx.push({ kind, x, z, y, t: 0, life: extra.life ?? 18, color: extra.color ?? "#fff", size: extra.size ?? 1, dir: extra.dir ?? 1, text: extra.text });
  if (w.fx.length > 260) w.fx.splice(0, w.fx.length - 260);
}

function say(w: World, text: string, color: string, sub?: string, t = 90) {
  w.banner = { text, sub, t, color };
}

// ---------------------------------------------------------------- input

function bufferInput(w: World, inp: Input) {
  const b = w.buf;
  const B = 9;
  b.light = inp.light ? B : Math.max(0, b.light - 1);
  b.heavy = inp.heavy ? B : Math.max(0, b.heavy - 1);
  b.jump = inp.jump ? B : Math.max(0, b.jump - 1);
  b.dodge = inp.dodge ? B : Math.max(0, b.dodge - 1);
  b.ult = inp.ult ? B : Math.max(0, b.ult - 1);
  b.assist = inp.assist ? B : Math.max(0, b.assist - 1);
  b.poke = inp.poke ? B : Math.max(0, b.poke - 1);
  if (inp.skill) {
    b.skill = B;
    b.skillN = inp.skill;
  } else b.skill = Math.max(0, b.skill - 1);
  // Double-tap → run.
  if (inp.mx !== 0 && w.lastMx === 0) {
    if (inp.mx === w.tapDir && w.tick - w.tapT <= 15) w.running = true;
    w.tapDir = inp.mx;
    w.tapT = w.tick;
  }
  if (inp.mx === 0 || (w.running && inp.mx !== w.tapDir)) w.running = false;
  w.lastMx = inp.mx;
}

// ---------------------------------------------------------------- moves

function startMove(w: World, a: Actor, m: MoveDef) {
  a.state = "attack";
  a.move = m;
  a.moveT = 0;
  a.t = 0;
  a.hitLog = [];
  a.landed = false;
  if (a.kind === "hero" || a.kind === "mecha") {
    if (m.shout) w.events.push({ type: "skill", name: m.shout });
    else if (m.hits.length || m.proj) w.events.push({ type: "swing", heavy: m.total >= 30 });
  }
  if (m.special) startSpecial(w, a, m);
}

function endMove(a: Actor) {
  a.move = null;
  a.moveT = 0;
  a.state = a.y > 0.5 ? "jump" : "idle";
  a.t = 0;
  a.guardStance = 0;
  a.parry = 0;
}

const foes = (w: World, a: Actor) => w.actors.filter((b) => b.team !== a.team && b.kind !== "crate" && b.state !== "dead" && b.state !== "gone" && b.hp > 0);

function nearestFoe(w: World, a: Actor, maxD = 9999): Actor | null {
  let best: Actor | null = null;
  let bd = maxD;
  for (const b of foes(w, a)) {
    const d = Math.abs(b.x - a.x) + Math.abs(b.z - a.z) * 1.5;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

function startSpecial(w: World, a: Actor, m: MoveDef) {
  const h = heroActor(w);
  switch (m.special) {
    case "blink": {
      const t = nearestFoe(w, a, 420);
      if (t) {
        a.x = t.x - t.face * 40;
        a.z = t.z;
        a.face = t.x > a.x ? 1 : -1;
        fx(w, "speed", a.x, a.z, 30, { color: "#93c5fd", life: 14 });
      }
      break;
    }
    case "teleport":
      a.hidden = 20;
      break;
    case "flameField":
    case "heatBurst":
      break;
    case "chainBlink":
      w.blinkIds = [];
      break;
    case "counter":
      a.parry = m.total;
      fx(w, "ring", a.x, a.z, 30, { color: "#7dd3fc", life: 20, size: 1.2 });
      break;
    case "turret": {
      for (const old of w.actors) if (old.kind === "turret") old.state = "gone";
      const t = baseActor(w, "turret", 0, a.x + a.face * 34, a.z, 1, "자동 포탑");
      t.face = a.face;
      t.life = 300;
      t.invuln = 999;
      t.entered = true;
      w.actors.push(t);
      fx(w, "dust", t.x, t.z, 0, { life: 14 });
      break;
    }
    case "shieldDrone":
      w.shieldHits = 3;
      fx(w, "ring", a.x, a.z, 40, { color: "#94a3b8", life: 26, size: 1.6 });
      break;
    case "rockLine":
      for (let i = 0; i < 5; i++)
        addProj(w, a, { kind: "pillar", x: a.x + a.face * (54 + i * 46), z: a.z, y: 0, vx: 0, vy: 0, warn: 8 + i * 5, life: 8 + i * 5 + 16, hit: { r: 22, dmg: 40, kind: "launch", lift: 9, stop: 4, brk: 18, z: 26 }, color: "#a8a29e" });
      break;
    case "detonate": {
      let total = 0;
      w.chaining = true;
      for (const b of w.actors) {
        if (b.team !== 1 || b.mark <= 0 || b.state === "dead" || b.state === "gone" || b.hp <= 0) continue;
        if (b.x < w.camX - 30 || b.x > w.camX + VIEW_W + 30) continue;
        const n = b.mark;
        total += n;
        b.mark = 0;
        fx(w, "boom", b.x, b.z, 40 * b.scale, { color: "#5eead4", life: 22, size: 1 + n * 0.4 });
        const hit: HitDef = { at: 0, len: 1, x: [0, 0], z: 999, y: [-99, 999], dmg: 40 * n + 10, kind: n >= 3 ? "knockdown" : "stagger", stun: 40, kb: 3, lift: 5, stop: 4, brk: 26 * n, screen: true };
        applyHit(w, a, b, hit, b.x >= a.x ? 1 : -1, false);
      }
      w.chaining = false;
      w.events.push({ type: "detonate", marks: total });
      if (!total) fx(w, "text", a.x, a.z, 90, { text: "표식이 없다!", color: "#99f6e4", life: 40 });
      break;
    }
    case "heal": {
      if (m.id === "s2") w.regenT = 300;
      const amount = Math.round(h.maxHp * (m.id === "ult" ? 0.3 : m.id === "as" ? 0.12 : 0.18));
      h.hp = Math.min(h.maxHp, h.hp + amount);
      fx(w, "heal", h.x, h.z, 40, { color: "#f9a8d4", life: 40, text: `+${amount}` });
      break;
    }
    case "ironWall":
      a.ironWall = 240;
      fx(w, "ring", a.x, a.z, 30, { color: "#4ade80", life: 30, size: 2 });
      break;
    case "guard":
      a.guardStance = m.total;
      break;
    case "parry":
      a.parry = m.total;
      break;
    case "charge":
      a.face = h.x > a.x ? 1 : -1;
      break;
    case "rockRain":
      for (let i = 0; i < 6; i++) addProj(w, a, { kind: "rock", x: h.x + rand(w, -160, 160), z: rand(w, 10, Z_MAX - 10), y: 300, vx: 0, vy: -7, warn: 40 + i * 8, life: 140, hit: { r: 22, dmg: 70, kind: "knockdown", kb: 4, lift: 4, stop: 5, brk: 0, z: 22 }, blast: 34 });
      break;
    case "pillars": {
      const n = a.bossId === "darkshadow" ? 4 : 6;
      for (let i = 0; i < n; i++) {
        const x = a.bossId === "darkshadow" ? h.x + (i - 1.5) * 70 : h.x + rand(w, -220, 220);
        addProj(w, a, { kind: "pillar", x, z: a.bossId === "darkshadow" ? h.z : rand(w, 10, Z_MAX - 10), y: 0, vx: 0, vy: 0, warn: 50 + i * 6, life: 70 + i * 6, hit: { r: 24, dmg: a.bossId === "darkshadow" ? 90 : 80, kind: "launch", lift: 8, stop: 5, brk: 0, z: a.bossId === "darkshadow" ? 70 : 24 }, color: a.bossId === "darkshadow" ? "#818cf8" : "#facc15" });
      }
      break;
    }
    case "clones":
      for (const dx of [-160, 160]) {
        const c = baseActor(w, "clone", 1, Math.max(w.camX + 40, Math.min(w.camX + VIEW_W - 40, h.x + dx)), rand(w, 20, Z_MAX - 20), 1, "환영");
        c.bossId = a.bossId;
        c.scale = a.scale;
        c.entered = true;
        c.life = 600;
        c.ai.think = 40;
        w.actors.push(c);
        fx(w, "smoke", c.x, c.z, 30, { color: "#c4b5fd", life: 24, size: 2 });
      }
      break;
    case "summon":
      spawnEnemy(w, "elite", 1);
      spawnEnemy(w, "grunt", -1);
      spawnEnemy(w, "grunt", 1);
      break;
    case "darkBlast":
      a.charge = 0;
      say(w, "다크 블래스트 충전 중!", "#a855f7", "브레이크로 끊거나 섬광 회피로 버텨라", 120);
      break;
    default:
      break;
  }
}

/** Per-tick behaviour for moves with specials (beyond hit/proj tables). */
function tickSpecial(w: World, a: Actor, m: MoveDef) {
  const h = heroActor(w);
  if (m.special === "flameField" && a.moveT % 4 === 0 && a.moveT <= 16)
    addProj(w, a, { kind: "flame", x: a.x, z: a.z, y: 0, vx: 0, life: 150, pierce: true, hit: { r: 18, dmg: 14, kind: "flinch", stun: 14, kb: 0.3, stop: 0, brk: 4, z: 18 } });
  if (m.special === "heatBurst" && a.moveT === 14) {
    const over = w.overheat > 0;
    const dmg = Math.round(50 + w.heat * 1.5 + (over ? 70 : 0));
    w.heat = 0;
    w.overheat = 0;
    w.shake = Math.max(w.shake, over ? 16 : 9);
    fx(w, "bigBoom", a.x, a.z, 30, { color: "#f97316", life: 30, size: over ? 2.6 : 1.6 });
    w.events.push({ type: "explode", big: over });
    const burst: HitDef = { at: 0, len: 1, x: [-120, 120], z: 50, y: [-20, 160], dmg, kind: "launch", lift: 10, kb: 4, stop: over ? 12 : 7, brk: Math.round(dmg * 0.5) };
    w.chaining = true;
    for (const b of w.actors.filter((o) => o.team === 1 && o.state !== "dead" && o.state !== "gone")) tryHit(w, a, b, burst, 50, b.x >= a.x ? 1 : -1, true);
    w.chaining = false;
  }
  if (m.special === "chainBlink" && a.moveT % 10 === 0 && a.moveT <= 20) {
    let best: Actor | null = null;
    let bd = 340;
    for (const b of foes(w, a)) {
      if (w.blinkIds.includes(b.id)) continue;
      const d = Math.abs(b.x - a.x) + Math.abs(b.z - a.z) * 1.5;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) {
      w.blinkIds.push(best.id);
      fx(w, "flashLine", a.x, a.z, 30, { color: "#7dd3fc", life: 12, size: 1 });
      const side = best.face === 1 ? -1 : 1;
      a.x = best.x + side * 36 * best.scale;
      a.z = best.z;
      a.face = best.x > a.x ? 1 : -1;
      fx(w, "speed", a.x, a.z, 30, { color: "#38bdf8", life: 12 });
    }
  }
  if (m.special === "teleport" && a.moveT === 20) {
    a.x = Math.max(w.camX + 40, Math.min(w.camX + VIEW_W - 40, h.x - h.face * 70));
    a.z = h.z;
    a.face = h.x > a.x ? 1 : -1;
    a.hidden = 0;
    fx(w, "smoke", a.x, a.z, 40, { color: "#c4b5fd", life: 20, size: 2 });
  }
  if (m.special === "charge") {
    a.vx = a.moveT < 6 ? 0 : 8.4 * a.face;
    const lo = (w.lockX ?? w.camX) + 30;
    const hi = (w.lockX ?? w.camX) + VIEW_W - 30;
    if (a.moveT > 8 && ((a.face > 0 && a.x >= hi) || (a.face < 0 && a.x <= lo))) {
      // Slammed the arena wall — stunned and open.
      a.x = Math.max(lo, Math.min(hi, a.x));
      a.vx = 0;
      endMove(a);
      a.state = "stunned";
      a.stun = 130;
      a.t = 0;
      w.shake = Math.max(w.shake, 10);
      fx(w, "bigBoom", a.x + a.face * 30, a.z, 50, { color: "#fbbf24", life: 26 });
      say(w, "벽에 충돌! 지금이다!", "#fbbf24", undefined, 70);
      w.events.push({ type: "explode", big: false });
    }
  }
  if (m.special === "grabThrow" && a.moveT === 70) {
    const v = w.actors.find((b) => b.holder === a.id);
    if (v) {
      v.holder = -1;
      v.state = "hit";
      damage(w, a, v, 80, true);
      if (v.hp > 0) {
        v.state = "air";
        v.vy = 6;
        v.vx = 9 * a.face;
      }
      w.shake = 10;
    }
  }
  if (m.special === "darkBlast") {
    a.charge = a.moveT / m.total;
    if (a.moveT === m.total - 2) {
      w.shake = 24;
      fx(w, "bigBoom", h.x, h.z, 40, { color: "#a855f7", life: 40, size: 3 });
      w.events.push({ type: "explode", big: true });
      const blast: HitDef = { at: 0, len: 1, x: [0, 0], z: 999, y: [-99, 999], dmg: 380, kind: "spin", kb: 9, lift: 9, stop: 16, screen: true };
      tryHit(w, a, h, blast, 0, a.face, false);
      a.charge = 0;
    }
  }
}

function addProj(w: World, owner: Actor, p: Partial<Proj> & Pick<Proj, "kind" | "x" | "z" | "y" | "vx" | "life" | "hit">) {
  w.projs.push({
    id: w.nextId++,
    team: owner.team,
    owner: owner.id,
    vz: 0,
    vy: 0,
    t: 0,
    warn: 0,
    pierce: false,
    blast: 0,
    home: 0,
    hitIds: [],
    len: 0,
    dir: owner.face,
    ...p,
  });
}

function spawnMoveProj(w: World, a: Actor, s: ProjSpawn) {
  const zs = [0, ...(s.fanZ ?? [])];
  const h = heroActor(w);
  for (const dz of zs) {
    let vx = s.vx * a.face;
    const vy = s.vy ?? 0;
    // Enemy bombs are lobbed at the hero.
    if (s.kind === "bomb" && a.team === 1) {
      const g = GRAVITY * 0.6;
      const flight = (2 * vy) / g;
      vx = Math.max(-6, Math.min(6, (h.x - a.x) / flight));
    }
    addProj(w, a, {
      kind: s.kind,
      x: a.x + s.dx * a.face,
      z: Math.max(4, Math.min(Z_MAX - 4, a.z + dz)),
      y: a.y + s.dy * reachScale(a),
      vx,
      vy,
      vz: s.kind === "orb" && dz !== 0 ? Math.sign(dz) * 0.35 : 0,
      life: s.life,
      hit: s.hit,
      pierce: !!s.pierce,
      blast: s.blast ?? 0,
      home: s.home ?? 0,
      len: s.kind === "beam" ? (a.kind === "giant" ? 560 : 420) : 0,
      dir: a.face,
      color: s.color,
    });
  }
  w.events.push({ type: "shoot", kind: s.kind });
}

function tickMove(w: World, a: Actor) {
  const m = a.move;
  if (!m) return;
  const t = a.moveT;
  if (m.lunge) {
    let v: number | null = null;
    for (const [from, to, vx] of m.lunge) if (t >= from && t < to) v = vx;
    if (v !== null) a.vx = v * a.face;
    else if (a.y <= 0 && m.special !== "charge") a.vx *= 0.6;
  } else if (a.y <= 0 && m.special !== "charge") a.vx *= 0.6;
  if (m.hop && t === m.hop[0]) a.vy = m.hop[1];
  if (m.invuln && t >= m.invuln[0] && t < m.invuln[1]) a.invuln = Math.max(a.invuln, 1);
  for (const s of m.proj ?? []) if (s.at === t) spawnMoveProj(w, a, s);
  tickSpecial(w, a, m);
  if (a.state !== "attack" || a.move !== m) return;
  m.hits.forEach((h, i) => {
    if (t < h.at || t >= h.at + h.len) return;
    const targets = w.actors.filter((b) => b.team !== a.team && b.state !== "dead" && b.state !== "gone");
    for (const b of targets) tryHit(w, a, b, h, i, a.face, true);
  });
  a.moveT++;
  const done = m.untilLand ? a.y <= 0 && a.moveT > 3 : a.moveT >= m.total;
  if (done) {
    if (m.id === "reload") {
      w.ammo = IRON_MAG;
      w.events.push({ type: "reload" });
      fx(w, "text", a.x, a.z, 80, { text: "장전 완료", color: "#e2e8f0", life: 30 });
    }
    if (m.untilLand) {
      fx(w, "dust", a.x, a.z, 0, { life: 16, size: 1.6 });
      fx(w, "ring", a.x, a.z, 0, { color: "#fde68a", life: 14, size: 1.4 });
      w.shake = Math.max(w.shake, 5);
    }
    endMove(a);
  }
}

// ---------------------------------------------------------------- hits

/** Stand-in attacker for stage hazards (steam vents). */
function envActor(x: number): Actor {
  return baseActor({ nextId: -1 } as World, "enemy", 1, x, 0, 1, "증기");
}

const isArmored = (a: Actor) =>
  a.kind === "giant" ? a.broken <= 0 : a.kind === "boss" ? a.broken <= 0 && a.state !== "stunned" : a.ironWall > 0 || (a.state === "attack" && !!a.move?.armor) || (a.state === "attack" && a.kind === "enemy" && !!ENEMIES[a.enemyId!].armorOnAttack);

/** Boss tables are authored at hero size and scaled up; mecha/giant tables are already in giant units. */
const reachScale = (a: Actor) => (a.kind === "boss" || a.kind === "clone" ? a.scale : 1);

function inRange(a: Actor, b: Actor, h: HitDef, w: World): boolean {
  if (h.screen) return b.x > w.camX - 30 && b.x < w.camX + VIEW_W + 30;
  const r = BODY_R * b.scale;
  const s = reachScale(a);
  const dx = (b.x - a.x) * a.face;
  if (dx < h.x[0] * s - r || dx > h.x[1] * s + r) return false;
  if (Math.abs(b.z - a.z) > h.z + 6 * b.scale) return false;
  const dy = b.y - a.y;
  return dy >= h.y[0] * s - 10 && dy <= h.y[1] * s;
}

/** Returns true when the hit connected (even if blocked). */
function tryHit(w: World, a: Actor, b: Actor, h: HitDef, idx: number, dir: number, melee: boolean): boolean {
  if (b.hp <= 0 && b.kind !== "crate") return false;
  if (b.state === "held" || b.hidden > 0 || b.kind === "assist" || b.kind === "turret") return false;
  if (b.state === "down" && !(h.otg && !b.otgUsed)) return false;
  if (b.untouchable) return false;
  const key = idx * 100000 + b.id;
  if (melee && a.hitLog.includes(key)) return false;
  if (!inRange(a, b, h, w)) return false;
  if (melee) a.hitLog.push(key);
  a.landed = true;
  if (b.invuln > 0) {
    if ((b.kind === "hero" || b.kind === "mecha") && b.state === "dodge" && b.t < PERFECT_TICKS + DODGE_INVULN[0]) perfectDodge(w, b);
    return false;
  }
  applyHit(w, a, b, h, dir, melee);
  return true;
}

function perfectDodge(w: World, h: Actor) {
  if (w.slow > 0) return;
  w.slow = 50;
  w.perfectDodges++;
  w.prism = Math.min(PRISM_MAX, w.prism + 15);
  w.en = Math.min(EN_MAX, w.en + 15);
  w.style = Math.min(STYLE_MAX, w.style + 60);
  h.invuln = Math.max(h.invuln, 30);
  fx(w, "flashLine", h.x, h.z, 40, { color: "#e0f2fe", life: 30, size: 2 });
  fx(w, "text", h.x, h.z, 90, { text: "섬광 회피!", color: "#7dd3fc", life: 50 });
  w.events.push({ type: "perfect" });
}

function heroDamageMul(w: World, a: Actor) {
  return a.kind === "hero" || a.kind === "assist" ? w.hero.atk : 1;
}

function applyHit(w: World, a: Actor, b: Actor, h: HitDef, dir: number, melee: boolean) {
  const heroSide = a.team === 0;
  const heroVictim = b.kind === "hero" || b.kind === "mecha";
  // 방패병 front guard.
  const ed = b.enemyId ? ENEMIES[b.enemyId] : null;
  const facingAttacker = b.face === -dir;
  const breaking = h.guardBreak || h.kind === "launch" || h.kind === "knockdown" || h.kind === "spike" || h.kind === "spin" || h.kind === "grab";
  if (ed?.frontGuard && b.guardBroken <= 0 && facingAttacker && (FREE.includes(b.state) || b.state === "tell") && !h.screen) {
    if (!breaking) {
      fx(w, "guard", b.x - dir * 10, b.z, 34, { color: "#e5e7eb", life: 12 });
      b.vx = 1.6 * dir;
      w.freeze = Math.max(w.freeze, 2);
      w.events.push({ type: "hit", heavy: false, onHero: false, blocked: true });
      return;
    }
    b.guardBroken = 300;
    fx(w, "text", b.x, b.z, 80, { text: "가드 브레이크!", color: "#fbbf24", life: 40 });
  }
  // Boss guard stance: front 90% cut.
  let mul = heroDamageMul(w, a) * (a.kind === "clone" ? 0.5 : 1);
  if (b.guardStance > 0 && facingAttacker && !h.screen) {
    mul *= 0.1;
    fx(w, "guard", b.x - dir * 20 * b.scale, b.z, 50, { color: "#fda4af", life: 12, size: 1.5 });
    w.events.push({ type: "hit", heavy: false, onHero: false, blocked: true });
  }
  // 볼트 뇌전 카운터: the hero blinks behind whoever struck and shocks them.
  if (heroVictim && b.parry > 0 && !h.screen && a.team === 1) {
    b.parry = 0;
    if (b.move) endMove(b);
    const side = a.face === 1 ? -1 : 1;
    b.x = a.x + side * 34 * a.scale;
    b.z = a.z;
    b.face = a.x > b.x ? 1 : -1;
    b.invuln = Math.max(b.invuln, 30);
    w.counters++;
    w.slow = Math.max(w.slow, 30);
    w.style = Math.min(STYLE_MAX, w.style + 70);
    w.charge = 5;
    fx(w, "flashLine", b.x, b.z, 40, { color: "#7dd3fc", life: 22, size: 2 });
    fx(w, "text", b.x, b.z, 100, { text: "뇌전 카운터!", color: "#7dd3fc", life: 50 });
    w.events.push({ type: "counter" });
    const zap: HitDef = { at: 0, len: 1, x: [-999, 999], z: 999, y: [-99, 999], dmg: 90, kind: "stagger", stun: 50, kb: 3, stop: 10, brk: 70 };
    applyHit(w, b, a, zap, b.face, false);
    return;
  }
  // 아이언 실드 드론 soaks whole hits.
  if (heroVictim && b.kind === "hero" && w.shieldHits > 0 && !h.screen) {
    w.shieldHits--;
    fx(w, "guard", b.x - dir * 12, b.z, 40, { color: "#94a3b8", life: 14, size: 1.6 });
    w.events.push({ type: "hit", heavy: false, onHero: true, blocked: true });
    return;
  }
  // Parry: melee into a parry stance gets countered.
  if (b.parry > 0 && melee && !h.screen && heroSide) {
    b.parry = 0;
    w.events.push({ type: "parry" });
    fx(w, "flashLine", b.x, b.z, 50, { color: "#a5b4fc", life: 20, size: 2 });
    fx(w, "text", b.x, b.z, 110, { text: "패리 반격!", color: "#a5b4fc", life: 50 });
    endMove(b);
    b.face = a.x > b.x ? 1 : -1;
    const counter: HitDef = { at: 0, len: 1, x: [-999, 999], z: 999, y: [-99, 999], dmg: 150, kind: "knockdown", kb: 8, lift: 5, stop: 12 };
    applyHit(w, b, a, counter, b.face, false);
    return;
  }
  const byHero = a.kind === "hero" && b.kind !== "crate";
  if (byHero && w.hero.trait === "heat" && w.overheat > 0) mul *= 1.35;
  let dmg = h.dmg * mul;
  if (heroSide && b.juggle > 6) dmg *= Math.max(0.4, 1 - 0.05 * (b.juggle - 6));
  if (b.broken > 0 || b.state === "stunned") dmg *= 1.5;
  if (heroVictim) {
    dmg *= diffOf(w).dmg;
    if (b.ironWall > 0) dmg *= 0.3;
    if (b.kind === "hero" && w.hero.trait === "stoneSkin") dmg *= 0.85;
  }
  dmg = Math.max(1, Math.round(dmg));
  // Giants can only be felled by the finisher.
  if (b.kind === "giant" && h.dmg < 99999) dmg = Math.min(dmg, b.hp - 1);
  const dealt = Math.min(dmg, b.hp);
  damage(w, a, b, dmg, false);
  b.flash = 6;
  const heavy = h.dmg >= 40 || h.kind !== "flinch";
  w.freeze = Math.max(w.freeze, h.stop ?? 3);
  if (heavy) w.shake = Math.max(w.shake, Math.min(14, (h.stop ?? 3) + (h.screen ? 4 : 0)));
  const sparkY = b.y + 34 * b.scale;
  fx(w, heavy ? "heavySpark" : "spark", b.x - dir * 6 * b.scale, b.z, sparkY, { color: heroSide ? w.hero.color : "#f87171", life: heavy ? 16 : 10, size: b.scale * (heavy ? 1.4 : 1), dir });
  if (melee && heroSide && a.move && (a.move.anim.startsWith("slash") || a.move.anim === "spin" || a.move.anim === "thrust")) fx(w, "slash", b.x, b.z, sparkY, { color: w.hero.color, life: 10, size: b.scale, dir });
  fx(w, "num", b.x + rand(w, -8, 8), b.z, b.y + 60 * b.scale, { text: String(dmg), color: heroVictim ? "#f87171" : h.screen || dmg >= 100 ? "#fde047" : "#fff", life: 36, size: dmg >= 100 ? 1.5 : 1 });
  w.events.push({ type: "hit", heavy, onHero: heroVictim });

  // Bookkeeping for the hero side.
  if (heroSide && b.kind !== "crate") {
    w.combo++;
    w.comboT = COMBO_WINDOW;
    w.maxCombo = Math.max(w.maxCombo, w.combo);
    const moveId = a.move?.id ?? "proj";
    const fresh = moveId !== w.lastMoveId ? 1 : 0.45;
    w.lastMoveId = moveId;
    w.style = Math.min(STYLE_MAX, w.style + (8 + dmg * 0.1) * fresh * (b.y > 10 ? 1.3 : 1));
    w.styleTop = Math.max(w.styleTop, w.style);
    w.en = Math.min(EN_MAX, w.en + 1.2);
    w.prism = Math.min(PRISM_MAX, w.prism + dmg * 0.045);
    if (byHero) heroTrait(w, a, b, dir);
    if (w.mode === "stage" && ++w.assistHits >= ASSIST_HITS) {
      w.assistHits = 0;
      if (w.assistStock < ASSIST_MAX) w.assistStock++;
    }
    w.score += Math.round(dealt * styleRank(w.style).mul * diffOf(w).score);
    if ((a.kind === "hero" || a.kind === "mecha") && a.y > 0 && a.airHits < 6 && melee) {
      a.airHits++;
      a.vy = Math.max(a.vy, 2.6);
    }
  }
  if (heroVictim) {
    w.dmgTaken += dmg;
    w.prism = Math.min(PRISM_MAX, w.prism + dmg * 0.03);
    w.style = Math.max(0, w.style - 120);
    if (w.combo >= 5) endCombo(w);
    w.combo = 0;
  }

  // Break gauge.
  if (b.breakMax > 0 && b.broken <= 0 && heroSide) {
    const charging = b.move?.special === "darkBlast";
    b.breakG += (h.brk ?? 0) * (charging ? 1.6 : 1);
    if (b.breakG >= b.breakMax) {
      b.breakG = b.breakMax;
      b.broken = b.kind === "enemy" ? 150 : 220;
      if (b.move) endMove(b);
      b.charge = 0;
      b.state = "stunned";
      b.stun = b.broken;
      b.t = 0;
      w.freeze = Math.max(w.freeze, 14);
      w.shake = 14;
      fx(w, "ring", b.x, b.z, 40 * b.scale, { color: "#fde047", life: 30, size: 3 });
      fx(w, "text", b.x, b.z, 120 * b.scale, { text: "BREAK!", color: "#fde047", life: 60, size: 1.6 });
      w.events.push({ type: "break", name: b.name });
      w.style = Math.min(STYLE_MAX, w.style + 80);
      if (b.hp > 0) return;
    }
  }
  if (b.kind === "crate") return;
  if (b.hp <= 0) {
    knockOut(w, a, b, h, dir);
    return;
  }
  if (isArmored(b) && h.kind !== "grab") {
    b.vx += 0.3 * dir;
    return;
  }
  react(w, a, b, h, dir);
}

/** `direct` = not routed through applyHit (which handles its own KO). */
/** Per-hero rule that fires on every hero hit (see HeroDef.trait). */
function heroTrait(w: World, a: Actor, b: Actor, dir: number) {
  // Trait payoffs (chain lightning, heat burst, mark detonation) never feed their own trait.
  if (w.chaining) return;
  switch (w.hero.trait) {
    case "heat":
      if (w.overheat > 0) {
        fx(w, "boom", b.x, b.z, b.y + 30 * b.scale, { color: "#fb923c", life: 12, size: 0.6 });
        break;
      }
      w.heat = Math.min(100, w.heat + 5);
      if (w.heat >= 100) {
        w.overheat = 480;
        fx(w, "ring", a.x, a.z, 30, { color: "#f97316", life: 30, size: 2.4 });
        fx(w, "text", a.x, a.z, 100, { text: "OVERHEAT!", color: "#fb923c", life: 60, size: 1.4 });
        w.events.push({ type: "overheat" });
      }
      break;
    case "charge":
      if (++w.charge >= 5) {
        w.charge = 0;
        w.chaining = true;
        const near = foes(w, a)
          .filter((o) => o !== b && Math.abs(o.x - b.x) < 180 && Math.abs(o.z - b.z) < 70)
          .slice(0, 3);
        for (const o of near) {
          fx(w, "flashLine", o.x, o.z, 40, { color: "#bae6fd", life: 10, size: 0.8 });
          const zap: HitDef = { at: 0, len: 1, x: [0, 0], z: 999, y: [-99, 999], dmg: 32, kind: "flinch", stun: 26, kb: 0.6, stop: 2, brk: 14, screen: true };
          applyHit(w, a, o, zap, o.x >= b.x ? 1 : -1, false);
        }
        fx(w, "heavySpark", b.x, b.z, b.y + 34, { color: "#38bdf8", life: 14, size: 1.4, dir });
        w.events.push({ type: "chain" });
        w.chaining = false;
      }
      break;
    case "mark":
      if (b.hp > 0) {
        b.mark = Math.min(3, b.mark + 1);
        b.markT = 420;
      }
      break;
    default:
      break;
  }
}

function damage(w: World, a: Actor, b: Actor, dmg: number, direct: boolean) {
  b.hp = Math.max(0, b.hp - dmg);
  if (direct) fx(w, "num", b.x, b.z, b.y + 60 * b.scale, { text: String(dmg), color: "#fde047", life: 36, size: 1.4 });
  if (b.kind === "crate" && b.hp <= 0) {
    b.state = "gone";
    fx(w, "boom", b.x, b.z, 20, { color: "#a16207", life: 18 });
    if (b.drop) w.pickups.push({ id: w.nextId++, kind: b.drop, x: b.x, z: b.z, t: 0 });
    w.events.push({ type: "explode", big: false });
  } else if (direct && b.hp <= 0 && b.state !== "air" && b.state !== "dead" && b.kind !== "hero" && b.kind !== "mecha") {
    knockOut(w, a, b, { at: 0, len: 1, x: [0, 0], z: 0, y: [0, 0], dmg, kind: "knockdown", kb: 6, lift: 6 }, a.face);
  }
}

function knockOut(w: World, a: Actor, b: Actor, h: HitDef, dir: number) {
  if (b.move) endMove(b);
  b.state = "air";
  b.vy = Math.max(h.lift ?? 0, b.kind === "boss" ? 7 : 6);
  b.vx = Math.max(Math.abs(h.kb ?? 0), 4) * dir;
  b.reaction = "spin";
  b.koByHero = a.team === 0;
  b.untouchable = true;
  if (b.enemyId === "drone") b.fuse = b.fuse > 0 ? Math.min(b.fuse, 24) : 24;
  if (b.kind === "hero" || b.kind === "mecha") return;
  if (b.kind === "enemy") {
    w.kills++;
    const def = ENEMIES[b.enemyId!];
    w.score += Math.round(def.score * styleRank(w.style).mul * diffOf(w).score);
    if (b.drop) w.pickups.push({ id: w.nextId++, kind: b.drop, x: b.x, z: b.z, t: 0 });
    w.events.push({ type: "ko", boss: false });
  }
  if (b.kind === "clone") b.state = "gone";
  if (b.kind === "boss") bossDown(w, b);
  if (b.kind === "giant") giantDown(w, b);
}

function react(w: World, a: Actor, b: Actor, h: HitDef, dir: number) {
  const juggleDecay = Math.max(0.55, 1 - b.juggle * 0.035);
  const kb = h.kb ?? 0;
  if (b.move) {
    endMove(b);
    b.next = null;
  }
  if (b.state === "tell") b.next = null;
  if (b.team === 1) b.ai.cd = Math.max(b.ai.cd, 40);
  b.charge = 0;
  if (b.y <= 0) b.face = (dir > 0 ? -1 : 1) as 1 | -1;
  const toward = h.pull ? -1 : 1;
  const kind: HitKind = b.y > 2 && (h.kind === "flinch" || h.kind === "stagger" || h.kind === "bind") ? "launch" : h.kind;
  switch (kind) {
    case "flinch":
    case "stagger":
      b.state = "hit";
      b.t = 0;
      b.stun = h.stun ?? 18;
      b.reaction = kind === "stagger" ? "stagger" : b.reaction === "high" ? "low" : "high";
      b.vx = kb * dir * toward * (h.pull ? 1.4 : 1);
      break;
    case "bind":
      b.state = "hit";
      b.t = 0;
      b.stun = h.stun ?? 120;
      b.reaction = "bind";
      b.vx = 0;
      break;
    case "grab":
      if (a.move?.special === "grabThrow" && b.kind !== "boss" && b.kind !== "giant") {
        b.state = "held";
        b.holder = a.id;
        b.t = 0;
      } else if (b.kind === "hero") {
        b.state = "grabbed";
        b.t = 0;
        b.stun = h.stun ?? 100;
        b.holder = a.id;
      }
      break;
    case "spike":
      if (b.y > 2) {
        b.state = "air";
        b.vy = h.lift ?? -9;
        b.vx = kb * dir;
        b.groundBounce = true;
      } else {
        b.state = "air";
        b.vy = 3.5;
        b.vx = 1.5 * dir;
      }
      b.juggle++;
      break;
    case "launch":
    case "knockdown":
    case "spin":
      b.state = "air";
      b.t = 0;
      b.vy = (h.lift ?? (kind === "launch" ? 3.6 : 3)) * (b.y > 2 ? juggleDecay : 1);
      if (b.y <= 0 && kind === "launch") b.vy = h.lift ?? 9;
      b.vx = (kind === "launch" ? (b.y > 2 ? kb * 0.5 + 0.4 : kb || 0.6) : kb) * dir * toward;
      b.reaction = kind === "spin" ? "spin" : "high";
      b.juggle++;
      if (b.y <= 0) b.y = 0.5;
      break;
  }
  if (b.juggle > JUGGLE_MAX && b.y > 2) {
    b.untouchable = true;
    fx(w, "text", b.x, b.z, b.y + 90, { text: "MAX", color: "#94a3b8", life: 30 });
  }
}

function endCombo(w: World) {
  const bonus = Math.round(Math.pow(w.combo, 1.5) * 12 * diffOf(w).score);
  w.score += bonus;
  w.events.push({ type: "comboEnd", combo: w.combo, bonus });
}

// ---------------------------------------------------------------- bosses / giant

function bossDown(w: World, b: Actor) {
  w.bossKills++;
  const def = BOSSES[b.bossId!];
  w.score += Math.round(def.score * diffOf(w).score);
  w.slow = 120;
  w.freeze = 24;
  w.shake = 20;
  w.phase = "bossDown";
  w.phaseT = 0;
  for (const e of w.actors) if (e.kind === "enemy" || e.kind === "clone") e.state = "gone";
  w.projs = [];
  w.events.push({ type: "ko", boss: true });
  say(w, `${def.name} 격파!`, "#fde047", "…아직 끝나지 않았다?!", 160);
}

function giantDown(w: World, b: Actor) {
  w.phase = "finish";
  w.phaseT = 0;
  w.shake = 30;
  w.projs = [];
  w.score += Math.round(BOSSES[b.bossId!].score * 0.6 * diffOf(w).score);
  w.events.push({ type: "ko", boss: true });
}

function enterGiant(w: World) {
  const boss = BOSSES[w.curBoss ?? "hornbuster"];
  w.mode = "giant";
  w.lockX = w.camX;
  w.actors = [];
  w.projs = [];
  w.pickups = [];
  const m = baseActor(w, "mecha", 0, w.camX + 170, 75, Math.round(MECHA.hp), MECHA.name);
  m.heroId = w.heroId;
  m.scale = 2.4;
  m.state = "pose";
  w.actors.push(m);
  const g = baseActor(w, "giant", 1, w.camX + VIEW_W - 150, 75, Math.round(boss.giantHp * diffOf(w).hp), `거대 ${boss.name}`);
  g.bossId = boss.id;
  g.scale = 2.9;
  g.breakMax = 700;
  g.entered = true;
  g.ai.think = 90;
  w.actors.push(g);
  w.bossActor = g.id;
  w.finishReady = false;
  w.cds = [0, 0, 0];
  w.en = Math.max(w.en, 50);
  w.events.push({ type: "giant", boss: boss.id });
  say(w, `거대 ${boss.name} 출현!`, "#f97316", `${MECHA.name} — 합체 출격!`, 140);
}

function bossAI(w: World, b: Actor) {
  const def = BOSSES[b.bossId!];
  const h = heroActor(w);
  for (const k of Object.keys(b.ai.patCd)) if (b.ai.patCd[k] > 0) b.ai.patCd[k]--;
  // Phase change.
  const ratio = b.hp / b.maxHp;
  const want = ratio <= 0.33 ? 3 : ratio <= 0.66 ? 2 : 1;
  if (b.kind === "boss" && want > b.phase && FREE.includes(b.state)) {
    b.phase = want;
    const roar: MoveDef = { id: "roar", name: "포효", anim: "roar", total: 60, invuln: [0, 60], hits: [{ at: 14, len: 4, x: [-140, 140], z: 80, y: [-10, 200], dmg: 10, kind: "knockdown", kb: 7, lift: 4, stop: 4 }] };
    startMove(w, b, roar);
    w.shake = 12;
    w.events.push({ type: "phase", phase: want, name: def.name });
    say(w, want === 3 ? `${def.name} 최종 형태!` : `${def.name} 분노!`, "#f43f5e", want === 3 ? "새로운 패턴이 열린다" : undefined, 80);
    return;
  }
  if (!FREE.includes(b.state)) return;
  if (h.state === "dead" || w.phase !== "play") {
    b.state = "idle";
    return;
  }
  const dx = h.x - b.x;
  const dz = h.z - b.z;
  b.face = dx >= 0 ? 1 : -1;
  const sp = def.speed * (b.phase === 3 ? 1.15 : 1);
  const near = Math.abs(dx) < 70 * (b.kind === "giant" ? 2.2 : 1);
  if (!near || Math.abs(dz) > 10) {
    b.state = "walk";
    b.vx = near ? 0 : Math.sign(dx) * sp;
    b.vz = b.kind === "giant" ? 0 : Math.sign(dz) * Math.min(Math.abs(dz), sp * 0.8);
  } else {
    b.state = "idle";
    b.vx = 0;
    b.vz = 0;
  }
  if (--b.ai.think > 0) return;
  // Pick a pattern.
  let pool: { move: MoveDef; weight: number }[];
  if (b.kind === "giant") pool = def.giantMoves.filter((m) => !(b.ai.patCd[m.id] > 0)).map((move) => ({ move, weight: 1 }));
  else
    pool = def.patterns
      .filter((p) => p.phases.includes(b.phase) && !(b.ai.patCd[p.move.id] > 0) && (p.near === undefined || (Math.abs(dx) < p.near * b.scale && Math.abs(dz) < 26)))
      .map((p) => ({ move: p.move, weight: p.weight }));
  if (b.kind === "clone") pool = pool.filter((p) => p.move.id === "claw" || p.move.id === "orbs");
  if (!pool.length) {
    b.ai.think = 10;
    return;
  }
  let r = rngNext(w) * pool.reduce((s, p) => s + p.weight, 0);
  let chosen = pool[0].move;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) {
      chosen = p.move;
      break;
    }
  }
  const pat = def.patterns.find((p) => p.move.id === chosen.id);
  b.ai.patCd[chosen.id] = b.kind === "giant" ? 150 : pat?.cooldown ?? 90;
  b.next = chosen;
  b.state = "tell";
  b.t = 0;
  b.stun = Math.round((chosen.tell ?? 20) * diffOf(w).tell);
  b.vx = 0;
  b.vz = 0;
  const base = b.kind === "giant" ? 70 : b.phase === 3 ? 26 : b.phase === 2 ? 36 : 48;
  b.ai.think = Math.round((base + rngNext(w) * 30) / (w.diff === "hard" ? 1.3 : w.diff === "easy" ? 0.7 : 1));
}

// ---------------------------------------------------------------- enemy AI

function enemyAI(w: World, e: Actor) {
  const def = ENEMIES[e.enemyId!];
  const h = heroActor(w);
  if (e.ai.cd > 0) e.ai.cd--;
  if (e.guardBroken > 0) e.guardBroken--;
  if (!FREE.includes(e.state)) return;
  if (h.state === "dead" || w.phase !== "play") {
    e.state = "idle";
    e.vx = e.vz = 0;
    return;
  }
  const dx = h.x - e.x;
  const dz = h.z - e.z;
  if (Math.abs(dx) > 4) e.face = dx > 0 ? 1 : -1;
  // 자폭병: run in, light the fuse.
  if (def.fuse) {
    if (Math.abs(dx) < 34 && Math.abs(dz) < 16) {
      e.state = "tell";
      e.stun = def.fuse;
      e.fuse = def.fuse;
      e.t = 0;
      e.vx = e.vz = 0;
      return;
    }
    e.state = "walk";
    e.vx = Math.sign(dx) * def.speed;
    e.vz = Math.sign(dz) * Math.min(Math.abs(dz), def.speed * 0.7);
    return;
  }
  const attackers = w.actors.filter((o) => o.kind === "enemy" && (o.state === "tell" || (o.state === "attack" && o.team === 1))).length;
  const canAttack = e.ai.cd <= 0 && attackers < diffOf(w).tokens;
  const side = e.ai.side;
  const ranged = def.range[0] > 120;
  const wantDist = canAttack || ranged ? (def.range[0] + def.range[1]) / 2 : def.range[1] + 50;
  const tx = h.x + side * wantDist;
  if (w.lockX !== null && (tx < w.lockX + 20 || tx > w.lockX + VIEW_W - 20) && rngNext(w) < 0.05) e.ai.side = -side as 1 | -1;
  const tz = ranged && def.id === "bomber" ? e.ai.wz : canAttack ? h.z : Math.max(8, Math.min(Z_MAX - 8, h.z + e.ai.zOff));
  // Re-pick the side if the hero walked past.
  if (Math.sign(e.x - h.x) !== side && Math.abs(dx) > 40 && rngNext(w) < 0.02) e.ai.side = (e.x > h.x ? 1 : -1) as 1 | -1;
  const ex = tx - e.x;
  const ez = tz - e.z;
  const sp = def.speed;
  if (Math.abs(ex) > 6 || Math.abs(ez) > 4) {
    e.state = "walk";
    e.vx = Math.abs(ex) > 6 ? Math.sign(ex) * sp : 0;
    e.vz = Math.abs(ez) > 4 ? Math.sign(ez) * Math.min(Math.abs(ez), sp * 0.7) : 0;
  } else {
    e.state = "idle";
    e.vx = e.vz = 0;
  }
  if (!canAttack) return;
  const dist = Math.abs(dx);
  const inBand = dist >= def.range[0] - 14 && dist <= def.range[1] + 12;
  const aligned = def.id === "bomber" || def.id === "sniper" || Math.abs(dz) < 14;
  if (inBand && aligned && e.entered) {
    const m = pick(w, def.moves);
    e.next = m;
    e.state = "tell";
    e.t = 0;
    e.stun = Math.round((m.tell ?? 20) * diffOf(w).tell);
    e.vx = e.vz = 0;
    e.face = dx > 0 ? 1 : -1;
    e.ai.cd = Math.round(rand(w, 70, 150) / (w.diff === "hard" ? 1.4 : 1));
  }
}

// ---------------------------------------------------------------- hero control

function heroControl(w: World, h: Actor, inp: Input) {
  const b = w.buf;
  if (h.state === "grabbed") {
    if (inp.light || inp.heavy || inp.jump || inp.dodge) h.stun -= 7;
    return;
  }
  const giant = h.kind === "mecha";
  const hd = w.hero;
  const speed = giant ? MECHA.speed : hd.speed;
  const free = FREE.includes(h.state);
  // Ultimate / assists from any free or cancellable state.
  const cancellable = free || h.state === "jump" || (h.state === "attack" && h.landed && h.move?.id !== "ult" && h.move?.id !== "team" && h.move?.id !== "mf");
  if (giant) {
    if (b.ult && cancellable && w.finishReady) {
      b.ult = 0;
      cutIn(w, h, MECHA.finish, "mecha", hd.color);
      return;
    }
  } else if (b.ult && cancellable && w.prism >= PRISM_MAX) {
    b.ult = 0;
    w.prism = 0;
    cutIn(w, h, hd.ult, hd.id, hd.color);
    return;
  } else if (b.assist && w.assistStock > 0 && (free || h.state === "jump" || h.state === "attack" || h.state === "hit")) {
    b.assist = 0;
    if (w.assistStock >= ASSIST_MAX) {
      w.assistStock = 0;
      cutIn(w, h, TEAM_ULT, "team", "#f8fafc");
      return;
    }
    w.assistStock--;
    callAssist(w, h);
  }
  // Skills.
  if (b.skill && b.skillN) {
    const idx = b.skillN - 1;
    const m = giant ? MECHA.rocket : hd.skills[idx];
    const cdIdx = giant ? 0 : idx;
    const okState = free || h.state === "jump" || (h.state === "attack" && h.landed && !h.move?.cd && h.move?.id !== "ult");
    if (okState && w.cds[cdIdx] <= 0 && w.en >= (m.en ?? 0)) {
      b.skill = 0;
      w.en -= m.en ?? 0;
      w.cds[cdIdx] = m.cd ?? 120;
      startMove(w, h, m);
      return;
    }
  }
  if (h.state === "attack" && h.move) {
    const m = h.move;
    const can = m.cancel !== undefined && h.moveT >= m.cancel;
    if (b.dodge && h.landed && w.en >= 10 && !m.cd && m.id !== "ult" && m.id !== "team" && m.id !== "mf") {
      b.dodge = 0;
      w.en -= 10;
      startDodge(w, h, inp);
      return;
    }
    if (!can) return;
    const chain = giant ? MECHA.chain : hd.chain;
    const ci = chain.indexOf(m);
    const ai = hd.air.indexOf(m);
    if (b.light && ci >= 0 && ci + 1 < chain.length) {
      b.light = 0;
      faceInput(h, inp);
      startMove(w, h, giant ? chain[ci + 1] : ammoGate(w, chain[ci + 1]));
      return;
    }
    if (b.light && ai >= 0 && ai + 1 < hd.air.length && h.y > 0) {
      b.light = 0;
      startMove(w, h, hd.air[ai + 1]);
      return;
    }
    if (b.heavy && m === hd.heavy && h.landed && !giant) {
      b.heavy = 0;
      startMove(w, h, hd.heavy2);
      return;
    }
    if (b.poke && ci >= 0 && !giant) {
      b.poke = 0;
      faceInput(h, inp);
      startMove(w, h, hd.poke);
      return;
    }
    if (b.heavy && ci >= 0 && !giant) {
      b.heavy = 0;
      faceInput(h, inp);
      startMove(w, h, ci >= 1 ? hd.finisher : hd.heavy);
      return;
    }
    if (b.heavy && ci >= 0 && giant) {
      b.heavy = 0;
      startMove(w, h, MECHA.heavy);
      return;
    }
    if (b.heavy && ai >= 0 && h.y > 0) {
      b.heavy = 0;
      startMove(w, h, hd.airHeavy);
      return;
    }
    if (b.jump && m === hd.heavy && h.landed && !giant) {
      // 띄우기 → 점프 추격.
      b.jump = 0;
      endMove(h);
      h.state = "jump";
      h.vy = JUMP_VY + 1.4;
      h.vx = 1.2 * h.face;
      h.airHits = 0;
      h.airIdx = 0;
      return;
    }
    return;
  }
  if (h.state === "jump") {
    h.vx = inp.mx * speed * 0.85;
    h.vz = inp.mz * speed * 0.5;
    if (inp.mx) h.face = inp.mx;
    if (b.light && !giant && h.airIdx < hd.air.length) {
      b.light = 0;
      startMove(w, h, hd.air[h.airIdx++]);
      return;
    }
    if (b.heavy && !giant) {
      b.heavy = 0;
      startMove(w, h, hd.airHeavy);
    }
    return;
  }
  if (!free) return;
  if (b.dodge) {
    b.dodge = 0;
    startDodge(w, h, inp);
    return;
  }
  if (b.jump && !giant) {
    b.jump = 0;
    h.state = "jump";
    h.vy = JUMP_VY;
    h.t = 0;
    h.airHits = 0;
    h.airIdx = 0;
    w.running = false;
    return;
  }
  if (b.poke && !giant) {
    b.poke = 0;
    faceInput(h, inp);
    startMove(w, h, hd.poke);
    w.running = false;
    return;
  }
  if (b.heavy) {
    b.heavy = 0;
    faceInput(h, inp);
    startMove(w, h, giant ? MECHA.heavy : w.running ? hd.slide : hd.heavy);
    w.running = false;
    return;
  }
  if (b.light) {
    b.light = 0;
    faceInput(h, inp);
    startMove(w, h, giant ? MECHA.chain[0] : w.running ? hd.dashAtk : ammoGate(w, hd.chain[0]));
    w.running = false;
    return;
  }
  const run = w.running && !giant;
  h.vx = inp.mx * speed * (run ? 1.75 : 1);
  h.vz = giant ? 0 : inp.mz * speed * 0.72;
  if (inp.mx) h.face = inp.mx;
  const moving = inp.mx !== 0 || (inp.mz !== 0 && !giant);
  const next: AState = !moving ? "idle" : run ? "run" : "walk";
  if (next !== h.state) {
    h.state = next;
    h.t = 0;
  }
}

/** 아이언's light-chain shots spend rounds; an empty magazine turns the press into a reload. */
function ammoGate(w: World, m: MoveDef): MoveDef {
  if (w.hero.trait !== "ammo" || !w.hero.chain.includes(m)) return m;
  if (w.ammo <= 0) {
    fx(w, "text", heroActor(w).x, heroActor(w).z, 80, { text: "재장전!", color: "#fbbf24", life: 30 });
    return RELOAD_MOVE;
  }
  w.ammo--;
  return m;
}

function faceInput(h: Actor, inp: Input) {
  if (inp.mx) h.face = inp.mx;
}

function startDodge(w: World, h: Actor, inp: Input) {
  h.move = null;
  h.state = "dodge";
  h.t = 0;
  const dir = inp.mx !== 0 ? inp.mx : (-h.face as -1 | 1);
  const sp = h.kind === "mecha" ? 4.2 : 5.4;
  h.vx = dir * sp;
  h.vz = h.kind === "mecha" ? 0 : inp.mz * 3.2;
  w.running = false;
  if (w.hero.trait === "ammo" && h.kind === "hero") w.ammo = Math.min(IRON_MAG, w.ammo + 3);
}

function cutIn(w: World, h: Actor, m: MoveDef, who: CutIn["heroId"], color: string) {
  w.cutin = { name: m.shout ?? m.name, color, heroId: who, t: 0, total: who === "team" ? 80 : 56 };
  startMove(w, h, m);
  h.invuln = 999;
  w.events.push({ type: "ult", name: m.name, color });
}

function callAssist(w: World, h: Actor) {
  const mates = HERO_ORDER.filter((id) => id !== w.heroId);
  const id = mates[w.assistIdx % mates.length];
  w.assistIdx++;
  const def = HEROES[id];
  const t = nearestFoe(w, h, 600);
  const fromLeft = !t || t.x > h.x;
  const a = baseActor(w, "assist", 0, fromLeft ? w.camX + 20 : w.camX + VIEW_W - 20, t ? t.z : h.z, 1, def.name);
  a.heroId = id;
  a.face = fromLeft ? 1 : -1;
  a.life = 70;
  a.invuln = 999;
  w.actors.push(a);
  startMove(w, a, def.assist);
  fx(w, "speed", a.x, a.z, 30, { color: def.color, life: 16 });
  w.events.push({ type: "assist", hero: id });
}

// ---------------------------------------------------------------- physics

function bounds(w: World, a: Actor): [number, number] {
  if (w.mode === "giant") return [w.camX + 50, w.camX + VIEW_W - 50];
  if (a.kind === "hero") return [w.camX + 16, w.camX + VIEW_W - 16];
  if (w.lockX !== null && a.entered) return [w.lockX + 14, w.lockX + VIEW_W - 14];
  return [-9999, 9999];
}

function physics(w: World, a: Actor) {
  if (a.state === "held") {
    const holder = w.actors.find((o) => o.id === a.holder);
    if (!holder || holder.state !== "attack") {
      a.holder = -1;
      a.state = "air";
      a.vy = 4;
      return;
    }
    const ang = (holder.moveT / 10) * Math.PI * 2;
    // Swing around the holder (cosmetic orbit — no gameplay trig on the result).
    a.x = holder.x + Math.cos(ang) * 50;
    a.z = Math.max(4, Math.min(Z_MAX - 4, holder.z + Math.sin(ang) * 14));
    a.y = 24;
    return;
  }
  if (a.state === "grabbed") {
    const g = w.actors.find((o) => o.id === a.holder);
    if (g) {
      a.x = g.x + g.face * 46 * g.scale * 0.7;
      a.z = g.z;
      a.y = 30;
    }
    return;
  }
  const airborne = a.y > 0 || a.vy > 0;
  if (airborne) {
    const grav = a.state === "air" ? GRAVITY * (0.92 + a.juggle * 0.03) : a.state === "attack" && a.move?.untilLand ? GRAVITY * 0.2 : GRAVITY;
    // Air attacks hang a little.
    const hang = a.state === "attack" && !a.move?.untilLand && (a.kind === "hero" || a.kind === "assist") ? 0.45 : 1;
    a.vy -= grav * hang;
    a.y += a.vy;
    if (a.y <= 0) {
      a.y = 0;
      land(w, a);
    }
  }
  a.x += a.vx;
  a.z += a.vz;
  a.z = Math.max(4, Math.min(Z_MAX - 4, a.z));
  const [lo, hi] = bounds(w, a);
  if (a.x < lo || a.x > hi) {
    if (a.state === "air" && Math.abs(a.vx) > 5 && a.kind !== "hero") {
      // 벽꽝 — wall bounce back into the combo.
      a.vx = -a.vx * 0.35;
      a.vy = Math.max(a.vy, 4.5);
      fx(w, "ring", a.x, a.z, a.y + 30, { color: "#e5e7eb", life: 14, size: 1.4 });
      w.shake = Math.max(w.shake, 8);
      w.events.push({ type: "hit", heavy: true, onHero: false });
    }
    a.x = Math.max(lo, Math.min(hi, a.x));
  } else if (a.x > lo + 4 && a.x < hi - 4) a.entered = true;
  const ground = a.y <= 0;
  if (ground && (a.state === "hit" || a.state === "down" || a.state === "getup" || a.state === "stunned" || a.state === "dead" || a.state === "tell")) {
    a.vx *= 0.8;
    a.vz *= 0.8;
  }
  if (a.state === "dodge") {
    a.vx *= 0.9;
    a.vz *= 0.9;
  }
}

function land(w: World, a: Actor) {
  if (a.state === "air") {
    a.vx *= 0.4;
    if (a.groundBounce) {
      a.groundBounce = false;
      a.vy = 5.5;
      a.y = 0.5;
      fx(w, "dust", a.x, a.z, 0, { life: 16, size: 1.5 });
      w.shake = Math.max(w.shake, 6);
      return;
    }
    a.vy = 0;
    fx(w, "dust", a.x, a.z, 0, { life: 14, size: a.scale });
    if (a.hp <= 0 && a.kind !== "hero" && a.kind !== "mecha") {
      a.state = "dead";
      a.t = 0;
      if (a.fuse > 0) explodeDrone(w, a);
      return;
    }
    if ((a.kind === "hero" || a.kind === "mecha") && a.hp > 0 && w.buf.jump > 0) {
      a.state = "getup";
      a.t = 12;
      a.invuln = 24;
      a.juggle = 0;
      a.untouchable = false;
      w.buf.jump = 0;
      fx(w, "text", a.x, a.z, 70, { text: "낙법!", color: "#bae6fd", life: 30 });
      w.events.push({ type: "tech" });
      return;
    }
    a.state = "down";
    a.t = 0;
    a.stun = a.kind === "hero" || a.kind === "mecha" ? 34 : a.kind === "boss" ? 50 : 44;
    a.otgUsed = false;
    return;
  }
  a.vy = 0;
  if (a.state === "jump") {
    a.state = "idle";
    a.t = 0;
    a.vx = 0;
  }
  if (a.state === "attack" && a.move && !a.move.untilLand && a.move.anim !== "rise") {
    // Landing cancels an air chain.
    if (a.move.id.startsWith("air")) endMove(a);
  }
}

function explodeDrone(w: World, d: Actor) {
  if (d.fuse === -2) return;
  d.fuse = -2;
  d.state = "dead";
  d.hp = 0;
  fx(w, "boom", d.x, d.z, 20, { color: "#f97316", life: 24, size: 1.8 });
  w.shake = Math.max(w.shake, 10);
  w.events.push({ type: "explode", big: false });
  for (const b of w.actors) {
    if (b === d || b.state === "dead" || b.state === "gone" || b.kind === "crate" || b.kind === "assist" || b.kind === "turret") continue;
    if (Math.abs(b.x - d.x) > 64 || Math.abs(b.z - d.z) > 34) continue;
    if (b.invuln > 0) {
      if (b.kind === "hero" && b.state === "dodge") perfectDodge(w, b);
      continue;
    }
    const h: HitDef = { at: 0, len: 1, x: [0, 0], z: 0, y: [0, 0], dmg: b.team === 0 ? 110 : 160, kind: "knockdown", kb: 6, lift: 6, stop: 6, brk: 30 };
    // Attribute enemy casualties to the hero when the drone was knocked into them.
    const src = d.koByHero && b.team === 1 ? heroActor(w) : d;
    applyHit(w, src, b, h, b.x >= d.x ? 1 : -1, false);
  }
}

// ---------------------------------------------------------------- per-actor state ticks

function tickActor(w: World, a: Actor) {
  a.t++;
  if (a.invuln > 0 && a.invuln < 900) a.invuln--;
  if (a.flash > 0) a.flash--;
  if (a.ironWall > 0) a.ironWall--;
  if (a.guardStance > 0) a.guardStance--;
  if (a.parry > 0) a.parry--;
  if (a.hidden > 0) a.hidden--;
  if (a.broken > 0) {
    a.broken--;
    if (a.broken === 0) a.breakG = 0;
  }
  if (a.invuln >= 900 && a.state !== "attack" && a.kind !== "assist") a.invuln = 30;
  if (a.fuse > 0 && --a.fuse === 0) {
    explodeDrone(w, a);
    return;
  }
  switch (a.state) {
    case "hit":
      if (--a.stun <= 0) {
        a.state = "idle";
        a.t = 0;
      }
      break;
    case "stunned":
      if (--a.stun <= 0) {
        a.state = "idle";
        a.t = 0;
        a.broken = 0;
        a.breakG = 0;
      }
      break;
    case "tell":
      if (a.fuse > 0) break;
      if (--a.stun <= 0) {
        const m = a.next;
        a.next = null;
        if (m) startMove(w, a, m);
        else a.state = "idle";
      } else if (a.enemyId === "sniper" && a.stun > 24) {
        const h = heroActor(w);
        a.z += Math.sign(h.z - a.z) * Math.min(Math.abs(h.z - a.z), 1.2);
      } else if (a.kind === "boss" && a.next?.special === "charge") {
        const h = heroActor(w);
        a.face = h.x > a.x ? 1 : -1;
        a.z += Math.sign(h.z - a.z) * Math.min(Math.abs(h.z - a.z), 1.4);
      }
      break;
    case "down":
      a.juggle = 0;
      a.untouchable = false;
      if (--a.stun <= 0) {
        a.state = "getup";
        a.t = 0;
        a.invuln = a.kind === "hero" || a.kind === "mecha" ? GETUP_INVULN : 14;
      }
      break;
    case "getup":
      if (a.t >= 20) {
        a.state = "idle";
        a.t = 0;
      }
      break;
    case "dodge":
      if (a.t >= DODGE_INVULN[0] && a.t < DODGE_INVULN[1]) a.invuln = Math.max(a.invuln, 1);
      if (a.t >= DODGE_TICKS) {
        a.state = "idle";
        a.t = 0;
        a.vx = a.vz = 0;
      }
      break;
    case "grabbed": {
      const g = w.actors.find((o) => o.id === a.holder);
      if (a.t % 16 === 8 && g) {
        const dmg = Math.round(22 * diffOf(w).dmg);
        a.hp = Math.max(0, a.hp - dmg);
        w.dmgTaken += dmg;
        a.flash = 4;
        fx(w, "num", a.x, a.z, 80, { text: String(dmg), color: "#f87171", life: 30 });
        w.events.push({ type: "hit", heavy: false, onHero: true });
      }
      if (--a.stun <= 0 || !g || g.state === "stunned" || a.hp <= 0) {
        a.holder = -1;
        a.state = "air";
        a.vy = 6;
        a.vx = (g ? g.face : 1) * 6;
        a.y = 30;
        w.shake = 10;
      }
      break;
    }
    case "dead":
      if (a.t > 60 && a.kind !== "hero" && a.kind !== "mecha") a.state = "gone";
      break;
    default:
      break;
  }
  if (a.state === "attack") tickMove(w, a);
  if (a.markT > 0 && --a.markT === 0) a.mark = 0;
  if (a.kind === "turret") {
    if (--a.life <= 0) {
      a.state = "gone";
      fx(w, "smoke", a.x, a.z, 10, { color: "#94a3b8", life: 20 });
      return;
    }
    if (a.t % 20 === 0) {
      const t = nearestFoe(w, a, 520);
      if (t) {
        a.face = t.x >= a.x ? 1 : -1;
        addProj(w, a, { kind: "shot", x: a.x + a.face * 14, z: a.z, y: 22, vx: 11 * a.face, vz: Math.sign(t.z - a.z) * Math.min(1.5, Math.abs(t.z - a.z) / 20), life: 46, hit: { r: 12, dmg: 14, kind: "flinch", stun: 14, kb: 0.8, stop: 1, brk: 6, z: 18 } });
      }
    }
    return;
  }
  if (a.kind === "clone" && a.life > 0 && --a.life === 0) a.state = "gone";
  if (a.kind === "assist" && a.state !== "attack") {
    a.vy = 8;
    a.y = Math.max(a.y, 1);
    if (--a.life <= 0 || a.t > 30) a.state = "gone";
  }
}

// ---------------------------------------------------------------- projectiles

function tickProjs(w: World) {
  for (const p of w.projs) {
    p.t++;
    if (p.kind === "beam") {
      const o = w.actors.find((a) => a.id === p.owner);
      if (o) {
        p.x = o.x + p.dir * 30 * o.scale;
        p.z = o.z;
        p.y = o.y + 40 * o.scale;
      }
      if (p.t % 6 === 0) p.hitIds = [];
    } else if (p.kind === "flame") {
      if (p.t % 15 === 0) p.hitIds = [];
    } else if (p.kind === "pillar") {
      if (p.t === p.warn) w.events.push({ type: "explode", big: false });
    } else {
      if (p.kind === "rock" && p.t < p.warn) continue;
      if (p.home > 0 && p.kind === "missile") {
        let tgt: Actor | null = null;
        let bd = 1e9;
        for (const b of w.actors) {
          if (b.team === p.team || b.kind === "crate" || b.state === "dead" || b.state === "gone" || b.hp <= 0) continue;
          const d = Math.abs(b.x - p.x) + Math.abs(b.z - p.z);
          if (d < bd) {
            bd = d;
            tgt = b;
          }
        }
        if (tgt && p.t > 10) {
          p.vx += Math.sign(tgt.x - p.x) * p.home;
          p.vz += Math.sign(tgt.z - p.z) * p.home * 0.5;
          p.vy += Math.sign(tgt.y + 30 * tgt.scale - p.y) * p.home * 0.6;
        }
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        if (sp > 7) {
          p.vx *= 7 / sp;
          p.vy *= 7 / sp;
          p.vz *= 7 / sp;
        }
      } else if (p.home > 0) {
        const tgt = p.team === 1 ? heroActor(w) : null;
        if (tgt) {
          p.vx += Math.sign(tgt.x - p.x) * p.home;
          p.vz += Math.sign(tgt.z - p.z) * p.home * 0.6;
          const sp = Math.hypot(p.vx, p.vz);
          if (sp > 4.2) {
            p.vx *= 4.2 / sp;
            p.vz *= 4.2 / sp;
          }
        }
      }
      const grav = p.kind === "bomb" || p.kind === "grenade" ? GRAVITY * 0.6 : p.kind === "rock" ? GRAVITY * 0.5 : 0;
      p.vy -= grav;
      p.x += p.vx;
      p.y += p.vy;
      p.z = Math.max(4, Math.min(Z_MAX - 4, p.z + p.vz));
      if ((p.kind === "bomb" || p.kind === "grenade" || p.kind === "rock" || p.kind === "missile") && p.y <= 0) {
        blast(w, p);
        p.life = 0;
        continue;
      }
    }
    if (p.t < p.warn) continue;
    if (p.kind === "pillar" && p.t > p.warn + 18) {
      p.life = 0;
      continue;
    }
    if (p.blast && p.kind !== "rock") {
      // Thrown explosives only detonate on impact with the ground or a body.
    }
    for (const b of w.actors) {
      if (b.team === p.team || b.state === "dead" || b.state === "gone" || b.kind === "assist" || b.kind === "turret") continue;
      if (p.hitIds.includes(b.id)) continue;
      if (!projOverlaps(p, b)) continue;
      if (p.blast) {
        blast(w, p);
        p.life = 0;
        break;
      }
      const h: HitDef = { at: 0, len: 1, x: [0, 0], y: [0, 0], ...p.hit };
      const owner = w.actors.find((a) => a.id === p.owner) ?? b;
      if (b.state === "down" && !(h.otg && !b.otgUsed)) continue;
      p.hitIds.push(b.id);
      if (b.invuln > 0 || b.untouchable || b.hidden > 0 || b.state === "held") {
        if ((b.kind === "hero" || b.kind === "mecha") && b.state === "dodge" && b.t < PERFECT_TICKS + DODGE_INVULN[0]) perfectDodge(w, b);
        continue;
      }
      if (b.parry > 0 && p.team === 0) {
        fx(w, "guard", b.x, b.z, 50, { color: "#a5b4fc", life: 12 });
        p.life = 0;
        break;
      }
      applyHit(w, owner, b, h, p.kind === "beam" ? p.dir : p.vx >= 0 ? 1 : -1, false);
      if (owner.state === "attack") owner.landed = true;
      if (!p.pierce) {
        p.life = 0;
        break;
      }
    }
    p.life--;
  }
  w.projs = w.projs.filter((p) => p.life > 0 && p.x > w.camX - 300 && p.x < w.camX + VIEW_W + 300);
}

function projOverlaps(p: Proj, b: Actor): boolean {
  const r = p.hit.r + BODY_R * b.scale;
  const bodyMid = b.y + 32 * b.scale;
  if (Math.abs(b.z - p.z) > p.hit.z + 4 * b.scale) return false;
  if (p.kind === "beam") {
    const from = p.dir > 0 ? p.x : p.x - p.len;
    const to = p.dir > 0 ? p.x + p.len : p.x;
    return b.x + BODY_R * b.scale >= from && b.x - BODY_R * b.scale <= to && Math.abs(bodyMid - p.y) < p.hit.r + 40 * b.scale;
  }
  if (p.kind === "wave") return Math.abs(b.x - p.x) < r && b.y < 20;
  if (p.kind === "flame") return Math.abs(b.x - p.x) < r && b.y < 30;
  if (p.kind === "pillar") return Math.abs(b.x - p.x) < r;
  return Math.abs(b.x - p.x) < r && Math.abs(bodyMid - p.y) < p.hit.r + 34 * b.scale;
}

function blast(w: World, p: Proj) {
  fx(w, "boom", p.x, p.z, Math.max(10, p.y), { color: p.team === 0 ? "#fde047" : "#f97316", life: 22, size: p.blast / 40 });
  w.shake = Math.max(w.shake, 7);
  w.events.push({ type: "explode", big: false });
  const owner = w.actors.find((a) => a.id === p.owner);
  for (const b of w.actors) {
    if (b.team === p.team || b.state === "dead" || b.state === "gone" || b.kind === "assist" || b.kind === "turret" || b.state === "held") continue;
    if (Math.abs(b.x - p.x) > p.blast + BODY_R * b.scale || Math.abs(b.z - p.z) > p.hit.z + 6) continue;
    if (b.state === "down" || b.hidden > 0) continue;
    if (b.invuln > 0 || b.untouchable) {
      if ((b.kind === "hero" || b.kind === "mecha") && b.state === "dodge") perfectDodge(w, b);
      continue;
    }
    const h: HitDef = { at: 0, len: 1, x: [0, 0], y: [0, 0], ...p.hit };
    applyHit(w, owner ?? b, b, h, b.x >= p.x ? 1 : -1, false);
  }
}

// ---------------------------------------------------------------- waves / camera

function tickWaves(w: World) {
  const h = heroActor(w);
  const st = w.stage;
  if (w.lockX === null) {
    const target = Math.min(st.length - VIEW_W, h.x - VIEW_W * 0.42);
    if (target > w.camX) w.camX += Math.min(4.5, target - w.camX);
    const wave = st.waves[w.waveIdx];
    if (wave && h.x >= wave.at) {
      w.lockX = w.camX;
      w.groupIdx = 0;
      if (wave.boss) {
        spawnBoss(w, wave.boss);
        w.phase = "bossIntro";
        w.phaseT = 0;
        w.events.push({ type: "bossIntro", boss: wave.boss });
        const bd = BOSSES[wave.boss];
        say(w, `${bd.title} ${bd.name}`, bd.accent, bd.intro, 150);
      } else spawnGroup(w, wave.groups[0].enemies);
      for (let i = 0; i < (wave.crates ?? 0); i++) spawnCrate(w, w.camX + 160 + i * 170 + rand(w, 0, 60), rand(w, 20, Z_MAX - 20));
    }
    return;
  }
  const wave = st.waves[w.waveIdx];
  if (!wave || wave.boss) return;
  const alive = w.actors.filter((a) => a.kind === "enemy" && a.state !== "dead" && a.state !== "gone").length;
  const nextGroup = wave.groups[w.groupIdx + 1];
  if (nextGroup && alive <= (nextGroup.when ?? 0)) {
    w.groupIdx++;
    spawnGroup(w, nextGroup.enemies);
    return;
  }
  if (!nextGroup && alive === 0) {
    w.lockX = null;
    w.waveIdx++;
    w.goT = 150;
    w.events.push({ type: "go" });
  }
}

function spawnGroup(w: World, list: EnemyId[]) {
  list.forEach((id, i) => {
    const e = spawnEnemy(w, id, i % 2 === 0 ? 1 : -1);
    e.ai.side = e.x > heroActor(w).x ? 1 : -1;
    if (id === "bomber" || id === "sniper") e.ai.wz = rand(w, 10, Z_MAX - 10);
  });
}

// ---------------------------------------------------------------- hero death / lives

function tickHeroLife(w: World, h: Actor) {
  if (h.hp > 0) return;
  if (h.state === "air" || h.state === "grabbed") return;
  if (h.state !== "dead") {
    if (h.move) endMove(h);
    h.state = "dead";
    h.t = 0;
    w.combo = 0;
    say(w, h.kind === "mecha" ? `${MECHA.name} 기능 정지…` : "변신 해제…!", "#f87171", undefined, 80);
  }
  if (h.t < 90) return;
  if (w.lives <= 0) {
    w.phase = "over";
    w.phaseT = 0;
    w.summary = summarize(w, false);
    w.events.push({ type: "over" });
    return;
  }
  w.lives--;
  w.livesLost++;
  w.events.push({ type: "lifeLost", left: w.lives });
  h.hp = h.maxHp;
  h.state = "pose";
  h.t = 0;
  h.y = 0;
  h.invuln = 180;
  w.en = Math.max(w.en, 60);
  w.prism = Math.min(PRISM_MAX, w.prism + 30);
  say(w, h.kind === "mecha" ? `${MECHA.name} 재기동!` : `재변신 — ${w.hero.henshin}`, w.hero.color, `남은 변신 ${w.lives}`, 90);
  w.events.push({ type: "henshin" });
  // Shockwave clears space.
  for (const e of w.actors)
    if (e.team === 1 && e.kind !== "crate" && e.kind !== "giant" && e.kind !== "boss" && e.state !== "dead" && e.state !== "gone" && e.hp > 0 && Math.abs(e.x - h.x) < 200)
      react(w, h, e, { at: 0, len: 1, x: [0, 0], z: 0, y: [0, 0], dmg: 0, kind: "knockdown", kb: 6, lift: 4 }, e.x >= h.x ? 1 : -1);
  w.projs = w.projs.filter((p) => p.team === 0);
}

// ---------------------------------------------------------------- summary

export function summarize(w: World, cleared: boolean): StageSummary {
  const d = diffOf(w);
  const timeSec = Math.round(w.time / 60);
  const bonus = { clear: 0, time: 0, noDeath: 0, lives: 0 };
  if (cleared) {
    bonus.clear = Math.round(5000 * w.stage.id * d.score);
    bonus.time = Math.round(Math.max(0, w.stage.par - timeSec) * 40 * d.score);
    bonus.noDeath = w.livesLost === 0 ? Math.round(6000 * d.score) : 0;
    bonus.lives = Math.round(w.lives * 1500 * d.score);
  }
  const score = w.score + bonus.clear + bonus.time + bonus.noDeath + bonus.lives;
  let perf = 100 - w.livesLost * 22 - Math.min(30, (w.dmgTaken / w.hero.hp) * 5);
  perf += timeSec <= w.stage.par ? 8 : -Math.min(15, (timeSec - w.stage.par) / 10);
  perf += Math.min(14, w.maxCombo / 4);
  return {
    stage: w.stage.id,
    hero: w.heroId,
    diff: w.diff,
    cleared,
    score,
    timeSec,
    maxCombo: w.maxCombo,
    kills: w.kills,
    bossKills: w.bossKills,
    dmgTaken: w.dmgTaken,
    livesLost: w.livesLost,
    perfectDodges: w.perfectDodges,
    styleTop: styleRank(w.styleTop).id,
    grade: cleared ? stageGrade(Math.max(0, Math.min(100, perf))) : "-",
    bonus,
  };
}

// ---------------------------------------------------------------- step

export function step(w: World, inp: Input) {
  w.tick++;
  bufferInput(w, inp);
  if (w.banner && --w.banner.t <= 0) w.banner = null;
  for (const f of w.fx) f.t++;
  w.fx = w.fx.filter((f) => f.t < f.life);
  if (w.shake > 0) w.shake = Math.max(0, w.shake - 0.8);
  if (w.goT > 0) w.goT--;
  if (w.phase === "clear" || w.phase === "over") return;
  if (w.cutin) {
    w.cutin.t++;
    if (w.cutin.t >= w.cutin.total) w.cutin = null;
    return;
  }
  if (w.freeze > 0) {
    w.freeze--;
    return;
  }
  if (w.slow > 0) {
    w.slow--;
    if (w.slow % 2 === 1) return;
  }
  const h = heroActor(w);
  w.phaseT++;
  switch (w.phase) {
    case "intro":
      if (w.phaseT >= 150) {
        w.phase = "play";
        h.state = "idle";
        h.t = 0;
      }
      return;
    case "bossIntro":
      if (w.phaseT >= 150) w.phase = "play";
      break;
    case "bossDown":
      for (const a of w.actors) {
        if (a.kind !== "boss" && a.kind !== "hero") continue;
        tickActor(w, a);
        physics(w, a);
      }
      if (w.phaseT % 20 === 0) {
        const b = bossActor(w);
        if (b) fx(w, "boom", b.x + rand(w, -40, 40), b.z, rand(w, 10, 90), { color: pick(w, ["#f97316", "#fde047", "#f43f5e"]), life: 24, size: 1.6 });
        w.events.push({ type: "explode", big: false });
      }
      if (w.phaseT >= 200) {
        w.phase = "giantIntro";
        w.phaseT = 0;
        enterGiant(w);
      }
      return;
    case "giantIntro":
      if (w.phaseT >= 150) {
        w.phase = "play";
        const m = heroActor(w);
        m.state = "idle";
      }
      return;
    case "finish":
      if (w.phaseT % 12 === 0) {
        const g = bossActor(w);
        if (g) fx(w, "bigBoom", g.x + rand(w, -80, 80), g.z, rand(w, 20, 260), { color: pick(w, ["#f97316", "#fde047", "#f43f5e", "#fff"]), life: 30, size: 2.5 });
        w.shake = 12;
        w.events.push({ type: "explode", big: true });
      }
      for (const a of w.actors) {
        if (a.kind === "giant") {
          a.state = "dead";
          tickActor(w, a);
        } else if (a.kind === "mecha") {
          a.state = "pose";
          a.t++;
        }
      }
      if (w.phaseT >= 210) {
        w.phase = "clear";
        w.summary = summarize(w, true);
        w.events.push({ type: "clear" });
      }
      return;
    default:
      break;
  }
  if (w.phase === "play") w.time++;
  if (h.state === "pose" && w.phase === "play") {
    if (h.t >= 60) {
      h.state = "idle";
      h.t = 0;
    }
  } else if (w.phase === "play" && h.state !== "dead") heroControl(w, h, inp);
  else if (w.phase === "bossIntro" && FREE.includes(h.state)) {
    h.state = "idle";
    h.vx = h.vz = 0;
  }
  // Timers.
  for (let i = 0; i < 3; i++) if (w.cds[i] > 0) w.cds[i]--;
  w.en = Math.min(EN_MAX, w.en + 1 / 30);
  if (w.overheat > 0 && --w.overheat === 0) w.heat = 0;
  else if (w.overheat <= 0 && w.heat > 0 && w.comboT === 0) w.heat = Math.max(0, w.heat - 0.08);
  if (w.regenT > 0) {
    w.regenT--;
    if (h.hp > 0 && h.kind === "hero" && w.regenT % 6 === 0) h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp * 0.003));
  }
  if (w.comboT > 0 && --w.comboT === 0) {
    if (w.combo >= 5) endCombo(w);
    w.combo = 0;
  }
  w.style = Math.max(0, w.style - (w.style > 360 ? 0.22 : 0.12));
  // AI.
  if (w.phase === "play") {
    for (const a of w.actors) {
      if (a.state === "dead" || a.state === "gone") continue;
      if (a.kind === "enemy") enemyAI(w, a);
      else if (a.kind === "boss" || a.kind === "giant" || a.kind === "clone") bossAI(w, a);
    }
    separate(w);
  }
  // Mecha finisher availability.
  if (w.mode === "giant") {
    const g = bossActor(w);
    const ready = !!g && g.hp / g.maxHp <= MECHA_FINISH_AT;
    if (ready && !w.finishReady) {
      w.events.push({ type: "finishReady" });
      say(w, "필살기 준비 완료!", "#fde047", "F / 필살 버튼 — 섬광 일도양단!", 150);
    }
    w.finishReady = ready;
  }
  for (const a of w.actors) {
    if (a.state === "gone") continue;
    if (a.kind === "crate") continue;
    if (w.phase === "bossIntro" && a.kind !== "hero") {
      if (a.kind === "boss") a.vx = a.vz = 0;
      continue;
    }
    tickActor(w, a);
    physics(w, a);
  }
  tickProjs(w);
  tickPickups(w, h);
  if (w.stage.vents && w.mode === "stage") tickVents(w, h);
  if (w.mode === "stage") tickWaves(w);
  tickHeroLife(w, h);
  w.actors = w.actors.filter((a) => a.state !== "gone");
}

function separate(w: World) {
  const list = w.actors.filter((a) => (a.kind === "enemy" || a.kind === "boss") && FREE.includes(a.state));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.abs(dx) < 22 && Math.abs(dz) < 12) {
        const push = dx >= 0 ? 0.6 : -0.6;
        a.x -= push;
        b.x += push;
        a.z -= dz >= 0 ? 0.4 : -0.4;
        b.z += dz >= 0 ? 0.4 : -0.4;
      }
    }
}

function tickPickups(w: World, h: Actor) {
  for (const p of w.pickups) {
    p.t++;
    if (h.kind !== "hero" || h.hp <= 0 || h.y > 4) continue;
    if (Math.abs(p.x - h.x) < 26 && Math.abs(p.z - h.z) < 18) {
      const d = PICKUPS[p.kind];
      if (d.hp) h.hp = Math.min(h.maxHp, h.hp + Math.round(h.maxHp * d.hp));
      if (d.en) w.en = Math.min(EN_MAX, w.en + d.en);
      if (d.prism) w.prism = Math.min(PRISM_MAX, w.prism + d.prism);
      if (d.score) w.score += d.score;
      fx(w, "text", h.x, h.z, 90, { text: `${d.emoji} ${d.name}`, color: "#bbf7d0", life: 40 });
      w.events.push({ type: "pickup", kind: p.kind });
      p.t = -1;
    }
  }
  w.pickups = w.pickups.filter((p) => p.t >= 0 && p.t < 60 * 25);
}

/** 제철소 steam vents: three fixed columns per screen vent every 4s (1s warning). */
export const VENT_PERIOD = 240;
export function ventXs(w: World): number[] {
  const base = Math.floor(w.camX / 400) * 400;
  return [base + 260, base + 660, base + 1060];
}
function tickVents(w: World, h: Actor) {
  w.ventT = (w.ventT + 1) % VENT_PERIOD;
  if (w.ventT < 60 || w.ventT > 100) return;
  if (w.ventT === 60) w.events.push({ type: "explode", big: false });
  for (const vx of ventXs(w)) {
    for (const b of w.actors) {
      if (b.state === "dead" || b.state === "gone" || b.kind === "crate" || b.kind === "assist" || b.kind === "turret" || b.kind === "boss") continue;
      if (Math.abs(b.x - vx) > 22 || b.y > 30 || b.invuln > 0 || b.state === "down") continue;
      if (w.ventT % 20 !== 0) continue;
      const hit: HitDef = { at: 0, len: 1, x: [0, 0], z: 0, y: [0, 0], dmg: b.team === 0 ? 40 : 60, kind: "launch", lift: 6, kb: 1, stop: 3 };
      applyHit(w, b.team === 0 ? envActor(vx) : h, b, hit, b.x >= vx ? 1 : -1, false);
    }
  }
}

// ---------------------------------------------------------------- simple bot (tests / demo)

/** A greedy auto-player: used by the balance sims and the lobby attract demo. */
export function botInput(w: World, mem: { t: number }): Input {
  const inp: Input = { ...NO_INPUT };
  const h = heroActor(w);
  mem.t++;
  if (w.phase !== "play" || !h || h.state === "dead") return inp;
  if (w.mode === "giant" && w.finishReady) {
    inp.ult = mem.t % 10 === 0;
    return inp;
  }
  if (w.prism >= PRISM_MAX && mem.t % 30 === 0) inp.ult = true;
  if (w.assistStock >= 1 && mem.t % 240 === 0) inp.assist = true;
  // Dodge incoming telegraphs that are about to fire.
  const threat = w.actors.find((a) => a.team === 1 && a.state === "tell" && a.stun <= 6 && Math.abs(a.x - h.x) < 120 * a.scale && Math.abs(a.z - h.z) < 30);
  if (threat && mem.t % 2 === 0) {
    inp.dodge = true;
    inp.mx = (h.x > threat.x ? 1 : -1) as 1 | -1;
    return inp;
  }
  let tgt: Actor | null = null;
  let bd = 1e9;
  for (const a of w.actors) {
    if (a.team !== 1 || a.state === "dead" || a.state === "gone" || a.hp <= 0) continue;
    const d = Math.abs(a.x - h.x) + Math.abs(a.z - h.z) * 2;
    if (d < bd) {
      bd = d;
      tgt = a;
    }
  }
  if (!tgt) {
    inp.mx = 1;
    // Grab nearby pickups when hurt.
    const p = w.pickups[0];
    if (p) {
      inp.mx = (Math.sign(p.x - h.x) || 0) as -1 | 0 | 1;
      inp.mz = Math.abs(p.z - h.z) > 6 ? ((Math.sign(p.z - h.z) || 0) as -1 | 0 | 1) : 0;
    }
    return inp;
  }
  const dx = tgt.x - h.x;
  const dz = tgt.z - h.z;
  const ranged = w.heroId === "yellow" || w.heroId === "pink";
  const reach = w.mode === "giant" ? 150 : ranged ? 140 : 46 * tgt.scale;
  const want = w.mode === "giant" ? 120 : ranged ? 110 : 36 + 10 * tgt.scale;
  if (Math.abs(dz) > 8 && w.mode === "stage") inp.mz = (Math.sign(dz) || 0) as -1 | 0 | 1;
  if (Math.abs(dx) > reach) inp.mx = (Math.sign(dx) || 0) as -1 | 0 | 1;
  else if (Math.abs(dx) < want * 0.5) inp.mx = (-Math.sign(dx) || 0) as -1 | 0 | 1;
  else if (h.face !== Math.sign(dx)) inp.mx = (Math.sign(dx) || 0) as -1 | 0 | 1;
  if (Math.abs(dx) <= reach && Math.abs(dz) <= 14) {
    const k = mem.t % 48;
    if (w.en >= 35 && mem.t % 90 === 0) inp.skill = (1 + (Math.floor(mem.t / 90) % 3)) as 1 | 2 | 3;
    else if (k === 30) inp.heavy = true;
    else if (k % 6 === 0) inp.light = true;
  }
  return inp;
}
