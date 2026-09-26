/**
 * Static game data for 배고픈 상어 (Hungry Shark-style ocean survival) —
 * the browser-side equivalent of the spec's `SharkDataSO` / `PreyDataSO` /
 * `UpgradeCurveSO` ScriptableObjects. Everything tunable lives here so the
 * engine (`engine.ts`) stays pure simulation.
 *
 * World units are "pixels at zoom 1". +y points DOWN (canvas convention):
 * the water surface is y = 0, the sky is negative y, the seabed is ~3300.
 */

// ── World layout ────────────────────────────────────────────────────────────

export const WORLD_W = 9000;
export const SKY_TOP = -900;
export const SURFACE_Y = 0;
/** Base seabed depth; the actual floor is `seabedY(x)` (rolling terrain). */
export const SEABED_BASE = 3300;

export type ZoneId = "shallows" | "reef" | "deep" | "abyss";

export const ZONES: { id: ZoneId; name: string; from: number; to: number }[] = [
  { id: "shallows", name: "얕은 바다", from: SURFACE_Y, to: 700 },
  { id: "reef", name: "산호초 지대", from: 700, to: 1600 },
  { id: "deep", name: "심해", from: 1600, to: 2500 },
  { id: "abyss", name: "해구 (화산 지대)", from: 2500, to: 99999 },
];

export function zoneAt(y: number): ZoneId {
  for (const z of ZONES) if (y < z.to) return z.id;
  return "abyss";
}

/** Rolling seabed profile — deterministic, so render and physics agree. */
export function seabedY(x: number): number {
  return (
    SEABED_BASE +
    Math.sin(x * 0.0011) * 140 +
    Math.sin(x * 0.0037 + 1.3) * 60 +
    Math.sin(x * 0.013 + 0.4) * 14
  );
}

// ── Sharks (spec §1-3 tier table) ───────────────────────────────────────────

export type SharkTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface SharkDef {
  id: string;
  tier: SharkTier;
  name: string;
  nameEn: string;
  maxHealth: number;
  /** D_base in D(t) = D_base · (1 + t/T_scale)^γ. */
  baseDrainRate: number;
  swimSpeed: number;
  boostMultiplier: number;
  /** Seconds of boost at full energy. */
  boostDuration: number;
  /** Damage per bite against multi-bite prey (boats, submarines...). */
  biteForce: number;
  /** Extra reach of the mouth on top of the prey's own radius. */
  eatRadius: number;
  /** Body length in world units (drawing + collision). */
  length: number;
  cost: number;
  /** Hull colors: [back, belly, accent]. */
  colors: [string, string, string];
  blurb: string;
}

export const SHARKS: SharkDef[] = [
  {
    id: "reef", tier: 1, name: "암초상어", nameEn: "Reef Shark",
    maxHealth: 100, baseDrainRate: 3.0, swimSpeed: 250, boostMultiplier: 1.9, boostDuration: 2.4,
    biteForce: 10, eatRadius: 18, length: 70, cost: 0,
    colors: ["#64748b", "#e2e8f0", "#0f172a"],
    blurb: "작은 물고기·게·수영객을 노리는 입문용 상어. 쏠종개와 해파리를 조심하세요.",
  },
  {
    id: "mako", tier: 2, name: "청상아리", nameEn: "Mako Shark",
    maxHealth: 130, baseDrainRate: 3.2, swimSpeed: 300, boostMultiplier: 2.0, boostDuration: 2.6,
    biteForce: 14, eatRadius: 20, length: 86, cost: 1000,
    colors: ["#2563eb", "#dbeafe", "#1e3a8a"],
    blurb: "바다에서 가장 빠른 상어. 펠리컨·다이버를 사냥할 수 있습니다.",
  },
  {
    id: "hammer", tier: 3, name: "귀상어", nameEn: "Hammerhead",
    maxHealth: 170, baseDrainRate: 3.6, swimSpeed: 285, boostMultiplier: 1.95, boostDuration: 2.8,
    biteForce: 18, eatRadius: 24, length: 104, cost: 3500,
    colors: ["#a16207", "#fef3c7", "#422006"],
    blurb: "넓은 머리로 가오리·참치를 낚아챕니다. 심해 아귀와 어뢰는 아직 위험합니다.",
  },
  {
    id: "tiger", tier: 4, name: "뱀상어", nameEn: "Tiger Shark",
    maxHealth: 225, baseDrainRate: 4.5, swimSpeed: 295, boostMultiplier: 1.95, boostDuration: 3.0,
    biteForce: 26, eatRadius: 28, length: 126, cost: 9000,
    colors: ["#57534e", "#f5f5f4", "#1c1917"],
    blurb: "낚싯배를 부수고 작은 상어까지 먹어 치우는 바다의 쓰레기통.",
  },
  {
    id: "white", tier: 5, name: "백상아리", nameEn: "Great White",
    maxHealth: 300, baseDrainRate: 5.2, swimSpeed: 310, boostMultiplier: 1.9, boostDuration: 3.2,
    biteForce: 36, eatRadius: 34, length: 152, cost: 22000,
    colors: ["#475569", "#ffffff", "#020617"],
    blurb: "잠수함까지 씹어 삼키는 최상위 포식자. 유령 상어만은 피하세요.",
  },
  {
    id: "megalodon", tier: 6, name: "메갈로돈", nameEn: "Megalodon",
    maxHealth: 420, baseDrainRate: 7.0, swimSpeed: 320, boostMultiplier: 1.85, boostDuration: 3.4,
    biteForce: 55, eatRadius: 42, length: 210, cost: 60000,
    colors: ["#334155", "#cbd5e1", "#7f1d1d"],
    blurb: "고대의 괴물. 보트·헬리콥터·기뢰까지 삼킵니다. 화산 암석만 조심!",
  },
];

export function sharkById(id: string): SharkDef {
  return SHARKS.find((s) => s.id === id) ?? SHARKS[0];
}

// ── Starvation formula (spec §1-1) ──────────────────────────────────────────

export const T_SCALE = 180;
export const DRAIN_GAMMA = 1.3;

/** D_sec(t) = D_base · (1 + t / T_scale)^γ */
export function drainPerSecond(baseDrain: number, aliveSeconds: number): number {
  return baseDrain * Math.pow(1 + aliveSeconds / T_SCALE, DRAIN_GAMMA);
}

/** H_gain = Prey_BaseHP · (1 + Upgrade_Bite · 0.05) */
export function healGain(preyBaseHp: number, biteLevel: number): number {
  return preyBaseHp * (1 + biteLevel * 0.05);
}

// ── Upgrade curves (spec's UpgradeCurveSO) ──────────────────────────────────

export type UpgradeKind = "bite" | "speed" | "boost";
export const MAX_UPGRADE_LEVEL = 10;

export const UPGRADE_LABELS: Record<UpgradeKind, { name: string; emoji: string; desc: string }> = {
  bite: { name: "물어뜯기", emoji: "🦷", desc: "레벨당 회복량 +5%, 물기 피해 +8%" },
  speed: { name: "속도", emoji: "💨", desc: "레벨당 수영 속도 +3%" },
  boost: { name: "부스트", emoji: "🚀", desc: "레벨당 부스트 지속 +7%, 충전 속도 +5%" },
};

export function upgradeCost(shark: SharkDef, kind: UpgradeKind, currentLevel: number): number {
  const tierFactor = 1 + (shark.tier - 1) * 0.9;
  const base = kind === "bite" ? 120 : kind === "speed" ? 100 : 90;
  return Math.round((base * tierFactor * Math.pow(1.42, currentLevel)) / 10) * 10;
}

export interface UpgradeLevels {
  bite: number;
  speed: number;
  boost: number;
}

/** Final per-run stats after applying upgrades (the "AnimationCurve" evaluation). */
export interface EffectiveStats {
  maxHealth: number;
  baseDrainRate: number;
  swimSpeed: number;
  boostMultiplier: number;
  boostDuration: number;
  boostRegen: number;
  biteForce: number;
  biteLevel: number;
  eatRadius: number;
  length: number;
}

export function effectiveStats(shark: SharkDef, up: UpgradeLevels): EffectiveStats {
  return {
    maxHealth: shark.maxHealth,
    baseDrainRate: shark.baseDrainRate,
    swimSpeed: shark.swimSpeed * (1 + up.speed * 0.03),
    boostMultiplier: shark.boostMultiplier,
    boostDuration: shark.boostDuration * (1 + up.boost * 0.07),
    boostRegen: 0.5 * (1 + up.boost * 0.05),
    biteForce: shark.biteForce * (1 + up.bite * 0.08),
    biteLevel: up.bite,
    eatRadius: shark.eatRadius,
    length: shark.length,
  };
}

// ── Gold Rush (spec §1-2) ───────────────────────────────────────────────────

export const GOLD_RUSH_DURATION = 8;
export const MEGA_GOLD_RUSH_DURATION = 10;
export const GOLD_GAUGE_RATE = 0.02;
/** Rushes per mega rush — every 8th rush is a Mega Gold Rush. */
export const MEGA_EVERY = 8;

export function goldGaugeCapacity(tier: SharkTier): number {
  return Math.round(30 * Math.pow(tier, 0.9));
}

/** ×2 on the first rush, +1 per rush, capped at ×8 (mega is always ×10). */
export function goldRushMultiplier(rushNumber: number, mega: boolean): number {
  if (mega) return 10;
  return Math.min(8, 1 + rushNumber);
}

// ── Combo (addition: fast consecutive eats multiply score) ──────────────────

export const COMBO_WINDOW = 1.6;
export function comboMultiplier(combo: number): number {
  if (combo >= 30) return 3;
  if (combo >= 15) return 2;
  if (combo >= 6) return 1.5;
  return 1;
}

// ── Entities (spec's PreyTier table + hazards) ──────────────────────────────

/** A required tier above 6 means "never edible except during Mega Gold Rush". */
export const NEVER = 99;

export type EntityKind =
  | "smallFish" | "crab" | "swimmer" | "puffer" | "greenJelly" | "redJelly"
  | "mineS" | "mineM" | "mineL" | "mineXL"
  | "pelican" | "diver" | "grouper"
  | "ray" | "tuna" | "sailor" | "angler" | "torpedo"
  | "fishingBoat" | "passenger" | "smallShark" | "cageDiver"
  | "submarine" | "ghostShark"
  | "yacht" | "helicopter" | "rock"
  | "chest";

export type Behavior =
  | "boid" | "crawl" | "surfaceSwim" | "wander" | "jelly" | "mine" | "fly"
  | "surfaceBoat" | "hunter" | "torpedo" | "sub" | "heli" | "rock" | "static";

export type DamageKind = "contact" | "poison" | "explode";

export interface EntityDef {
  kind: EntityKind;
  name: string;
  requiredTier: number;
  /** Prey_BaseHP — HP restored when eaten. */
  heal: number;
  score: number;
  coins: number;
  /** Chance that `coins` actually drop outside Gold Rush. */
  coinChance: number;
  radius: number;
  speed: number;
  /** Bite HP; >1 means it takes several bites (biteForce each). */
  toughness: number;
  behavior: Behavior;
  /** Damage dealt to a shark that can't eat it (0 = harmless, just bounces). */
  damage: number;
  damageKind: DamageKind;
  /** Depth band [minY, maxY] it spawns in. */
  depth: [number, number];
  human?: boolean;
  color: string;
}

const D = (d: EntityDef) => d;

export const ENTITY_DEFS: Record<EntityKind, EntityDef> = {
  smallFish: D({ kind: "smallFish", name: "작은 물고기", requiredTier: 1, heal: 7, score: 20, coins: 1, coinChance: 0.35, radius: 7, speed: 120, toughness: 1, behavior: "boid", damage: 0, damageKind: "contact", depth: [60, 1700], color: "#fbbf24" }),
  crab: D({ kind: "crab", name: "게", requiredTier: 1, heal: 9, score: 35, coins: 1, coinChance: 0.5, radius: 10, speed: 40, toughness: 1, behavior: "crawl", damage: 0, damageKind: "contact", depth: [0, 0], color: "#ef4444" }),
  swimmer: D({ kind: "swimmer", name: "수영객", requiredTier: 1, heal: 15, score: 60, coins: 2, coinChance: 0.6, radius: 11, speed: 45, toughness: 1, behavior: "surfaceSwim", damage: 0, damageKind: "contact", depth: [0, 0], human: true, color: "#fca5a5" }),
  puffer: D({ kind: "puffer", name: "쏠종개", requiredTier: 2, heal: 10, score: 45, coins: 1, coinChance: 0.4, radius: 11, speed: 60, toughness: 1, behavior: "wander", damage: 12, damageKind: "contact", depth: [150, 1500], color: "#a3e635" }),
  greenJelly: D({ kind: "greenJelly", name: "초록 해파리", requiredTier: NEVER, heal: 20, score: 120, coins: 3, coinChance: 1, radius: 14, speed: 18, toughness: 1, behavior: "jelly", damage: 0.05, damageKind: "poison", depth: [80, 1400], color: "#4ade80" }),
  redJelly: D({ kind: "redJelly", name: "붉은 해파리", requiredTier: NEVER, heal: 25, score: 160, coins: 4, coinChance: 1, radius: 17, speed: 16, toughness: 1, behavior: "jelly", damage: 0.06, damageKind: "poison", depth: [700, 2400], color: "#f87171" }),
  mineS: D({ kind: "mineS", name: "소형 기뢰", requiredTier: NEVER, heal: 20, score: 200, coins: 5, coinChance: 1, radius: 13, speed: 0, toughness: 1, behavior: "mine", damage: 40, damageKind: "explode", depth: [120, 900], color: "#475569" }),
  mineM: D({ kind: "mineM", name: "중형 기뢰", requiredTier: NEVER, heal: 25, score: 300, coins: 8, coinChance: 1, radius: 17, speed: 0, toughness: 1, behavior: "mine", damage: 70, damageKind: "explode", depth: [500, 1800], color: "#3f3f46" }),
  mineL: D({ kind: "mineL", name: "대형 기뢰", requiredTier: NEVER, heal: 30, score: 450, coins: 12, coinChance: 1, radius: 22, speed: 0, toughness: 1, behavior: "mine", damage: 110, damageKind: "explode", depth: [1300, 2600], color: "#27272a" }),
  mineXL: D({ kind: "mineXL", name: "초대형 기뢰", requiredTier: NEVER, heal: 40, score: 700, coins: 20, coinChance: 1, radius: 30, speed: 0, toughness: 1, behavior: "mine", damage: 170, damageKind: "explode", depth: [2200, 3100], color: "#18181b" }),
  pelican: D({ kind: "pelican", name: "펠리컨", requiredTier: 2, heal: 24, score: 90, coins: 3, coinChance: 0.7, radius: 13, speed: 110, toughness: 1, behavior: "fly", damage: 0, damageKind: "contact", depth: [-260, -40], color: "#f8fafc" }),
  diver: D({ kind: "diver", name: "다이버", requiredTier: 2, heal: 28, score: 110, coins: 3, coinChance: 0.7, radius: 12, speed: 55, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [120, 900], human: true, color: "#facc15" }),
  grouper: D({ kind: "grouper", name: "중형 어류", requiredTier: 2, heal: 20, score: 70, coins: 2, coinChance: 0.5, radius: 14, speed: 90, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [300, 1900], color: "#60a5fa" }),
  ray: D({ kind: "ray", name: "가오리", requiredTier: 3, heal: 38, score: 160, coins: 4, coinChance: 0.7, radius: 20, speed: 80, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [800, 2400], color: "#94a3b8" }),
  tuna: D({ kind: "tuna", name: "참치", requiredTier: 3, heal: 36, score: 170, coins: 4, coinChance: 0.7, radius: 17, speed: 180, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [200, 1500], color: "#1d4ed8" }),
  sailor: D({ kind: "sailor", name: "어선 선원", requiredTier: 3, heal: 32, score: 150, coins: 5, coinChance: 0.8, radius: 11, speed: 40, toughness: 1, behavior: "surfaceSwim", damage: 0, damageKind: "contact", depth: [0, 0], human: true, color: "#fb923c" }),
  angler: D({ kind: "angler", name: "심해 아귀", requiredTier: 4, heal: 45, score: 380, coins: 8, coinChance: 0.8, radius: 22, speed: 95, toughness: 30, behavior: "hunter", damage: 22, damageKind: "contact", depth: [1800, 3100], color: "#3b0764" }),
  torpedo: D({ kind: "torpedo", name: "어뢰", requiredTier: NEVER, heal: 10, score: 250, coins: 5, coinChance: 1, radius: 9, speed: 260, toughness: 1, behavior: "torpedo", damage: 55, damageKind: "explode", depth: [0, 0], color: "#9ca3af" }),
  fishingBoat: D({ kind: "fishingBoat", name: "낚싯배", requiredTier: 4, heal: 50, score: 500, coins: 20, coinChance: 1, radius: 44, speed: 50, toughness: 60, behavior: "surfaceBoat", damage: 0, damageKind: "contact", depth: [0, 0], color: "#b45309" }),
  passenger: D({ kind: "passenger", name: "크루즈 승객", requiredTier: 4, heal: 30, score: 220, coins: 6, coinChance: 0.9, radius: 11, speed: 35, toughness: 1, behavior: "surfaceSwim", damage: 0, damageKind: "contact", depth: [0, 0], human: true, color: "#c084fc" }),
  smallShark: D({ kind: "smallShark", name: "소형 상어", requiredTier: 4, heal: 55, score: 450, coins: 10, coinChance: 0.9, radius: 24, speed: 195, toughness: 40, behavior: "hunter", damage: 18, damageKind: "contact", depth: [650, 2200], color: "#6b7280" }),
  cageDiver: D({ kind: "cageDiver", name: "케이지 다이버", requiredTier: 5, heal: 60, score: 700, coins: 15, coinChance: 1, radius: 26, speed: 20, toughness: 70, behavior: "wander", damage: 20, damageKind: "contact", depth: [150, 700], human: true, color: "#d4d4d8" }),
  submarine: D({ kind: "submarine", name: "잠수함", requiredTier: 5, heal: 90, score: 1600, coins: 60, coinChance: 1, radius: 58, speed: 60, toughness: 160, behavior: "sub", damage: 0, damageKind: "contact", depth: [900, 2600], color: "#eab308" }),
  ghostShark: D({ kind: "ghostShark", name: "유령 상어", requiredTier: 6, heal: 120, score: 2200, coins: 50, coinChance: 1, radius: 40, speed: 240, toughness: 150, behavior: "hunter", damage: 38, damageKind: "contact", depth: [2000, 3100], color: "#e0f2fe" }),
  yacht: D({ kind: "yacht", name: "보트", requiredTier: 6, heal: 80, score: 1400, coins: 40, coinChance: 1, radius: 56, speed: 70, toughness: 140, behavior: "surfaceBoat", damage: 0, damageKind: "contact", depth: [0, 0], color: "#f8fafc" }),
  helicopter: D({ kind: "helicopter", name: "헬리콥터", requiredTier: 6, heal: 100, score: 3000, coins: 80, coinChance: 1, radius: 40, speed: 90, toughness: 120, behavior: "heli", damage: 0, damageKind: "contact", depth: [-420, -240], color: "#dc2626" }),
  rock: D({ kind: "rock", name: "화산 암석", requiredTier: NEVER, heal: 30, score: 400, coins: 10, coinChance: 1, radius: 16, speed: 0, toughness: 1, behavior: "rock", damage: 30, damageKind: "contact", depth: [2400, 2400], color: "#7c2d12" }),
  chest: D({ kind: "chest", name: "보물 상자", requiredTier: 1, heal: 0, score: 500, coins: 120, coinChance: 1, radius: 18, speed: 0, toughness: 1, behavior: "static", damage: 0, damageKind: "contact", depth: [0, 0], color: "#ca8a04" }),
};

/** Mine explosion radius (spec §6-2: Damage = Max · (1 - dist / R)). */
export function mineExplosionRadius(kind: EntityKind): number {
  switch (kind) {
    case "mineS": return 120;
    case "mineM": return 160;
    case "mineL": return 210;
    case "mineXL": return 280;
    case "torpedo": return 110;
    default: return 0;
  }
}

export function explosionDamage(maxDamage: number, dist: number, radius: number): number {
  if (dist >= radius) return 0;
  return maxDamage * (1 - dist / radius);
}

/** Jellyfish poison (spec §6-2): 3s, every 0.5s lose `pct` of max HP, speed −40%. */
export const POISON_DURATION = 3;
export const POISON_TICK = 0.5;
export const POISON_SLOW = 0.4;

/**
 * Spawn table: how many of each kind to keep alive around the player.
 * Tier-gated so a Reef Shark isn't swarmed by submarines, and bigger sharks
 * see more of the prey that actually feeds them.
 */
export function populationTargets(tier: SharkTier): Partial<Record<EntityKind, number>> {
  return {
    smallFish: 80,
    crab: 8,
    swimmer: 7,
    puffer: 7,
    greenJelly: 8,
    redJelly: 6,
    mineS: 4,
    mineM: 4,
    mineL: 3,
    mineXL: 2,
    pelican: 4,
    diver: 5,
    grouper: 10,
    ray: 5,
    tuna: 6,
    sailor: tier >= 3 ? 3 : 1,
    angler: 4,
    fishingBoat: 2,
    passenger: tier >= 4 ? 5 : 1,
    smallShark: tier <= 2 ? 2 : 3,
    cageDiver: tier >= 3 ? 2 : 1,
    submarine: tier >= 3 ? 2 : 1,
    ghostShark: 2,
    yacht: tier >= 5 ? 2 : 1,
    helicopter: tier >= 5 ? 2 : 1,
  };
}

// ── Missions (addition: per-run objectives that pay coins) ──────────────────

export type MissionId =
  | "eatFish" | "eatHumans" | "reachDepth" | "survive" | "goldRush" | "score" | "boatBreaker" | "chest" | "jump";

export interface MissionDef {
  id: MissionId;
  label: (goal: number) => string;
  goals: number[];
  reward: number;
}

export const MISSIONS: MissionDef[] = [
  { id: "eatFish", label: (g) => `물고기 ${g}마리 먹기`, goals: [25, 50, 90], reward: 150 },
  { id: "eatHumans", label: (g) => `사람 ${g}명 먹기`, goals: [3, 6, 10], reward: 200 },
  { id: "reachDepth", label: (g) => `수심 ${g}m 도달`, goals: [80, 160, 260], reward: 180 },
  { id: "survive", label: (g) => `${g}초 생존`, goals: [90, 150, 240], reward: 220 },
  { id: "goldRush", label: (g) => `골드 러시 ${g}회 발동`, goals: [1, 2, 4], reward: 250 },
  { id: "score", label: (g) => `점수 ${g.toLocaleString()}점 달성`, goals: [3000, 8000, 20000], reward: 300 },
  { id: "boatBreaker", label: (g) => `여러 번 물어야 하는 대형 먹잇감 ${g}개 파괴`, goals: [1, 2, 4], reward: 350 },
  { id: "chest", label: (g) => `보물 상자 ${g}개 찾기`, goals: [1, 2, 3], reward: 300 },
  { id: "jump", label: (g) => `수면 위로 ${g}번 점프`, goals: [3, 6, 12], reward: 120 },
];

/** 10 world units = 1 m for the depth readout. */
export const UNITS_PER_METER = 10;
