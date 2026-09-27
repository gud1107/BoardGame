/**
 * Static tables for 꽃게 서바이벌 — the spec's "ScriptableObject" layer.
 * Everything tunable lives here so the engine stays pure logic.
 *
 * World units: a Lv1 crab has a 18u body radius; the island is ~3800u wide.
 */

// ── Growth (spec §2.2 / request §3) ────────────────────────────────────────

export interface LevelDef {
  level: number;
  name: string;
  /** Score needed to reach this level. */
  points: number;
  scale: number;
  atk: number;
  hp: number;
  /** Walk speed in units/s (boost multiplies by BOOST_MULT). */
  speed: number;
  speedLabel: string;
  /**
   * Point multiplier on everything eaten/collected — a bigger crab takes
   * bigger bites, which is what keeps the exponential thresholds reachable.
   */
  gain: number;
}

/**
 * Base (꽃게/균형형) roadmap: 12 finer steps. The spec's six milestones are kept
 * exactly at Lv1/3/5/7/9/12 (0·1k·5k·20k·100k·500k), with in-between steps
 * interpolated so level-ups come about twice as often.
 */
export const LEVELS: LevelDef[] = [
  { level: 1, name: "아기 게", points: 0, scale: 1.0, atk: 10, hp: 100, speed: 250, speedLabel: "가장 빠름", gain: 1 },
  { level: 2, name: "꼬마 게", points: 400, scale: 1.15, atk: 14, hp: 150, speed: 245, speedLabel: "가장 빠름", gain: 1.1 },
  { level: 3, name: "어린 게", points: 1_000, scale: 1.3, atk: 18, hp: 200, speed: 240, speedLabel: "빠름", gain: 1.4 },
  { level: 4, name: "소년 게", points: 2_200, scale: 1.5, atk: 26, hp: 300, speed: 231, speedLabel: "빠름", gain: 1.55 },
  { level: 5, name: "청년 게", points: 5_000, scale: 1.7, atk: 35, hp: 450, speed: 222, speedLabel: "보통", gain: 2 },
  { level: 6, name: "젊은 게", points: 10_000, scale: 1.95, atk: 48, hp: 700, speed: 213, speedLabel: "보통", gain: 2.2 },
  { level: 7, name: "성체 게", points: 20_000, scale: 2.2, atk: 65, hp: 1_000, speed: 205, speedLabel: "약간 느림", gain: 3 },
  { level: 8, name: "노련한 게", points: 45_000, scale: 2.5, atk: 90, hp: 1_600, speed: 196, speedLabel: "약간 느림", gain: 3.3 },
  { level: 9, name: "거대 게", points: 100_000, scale: 2.8, atk: 120, hp: 2_500, speed: 188, speedLabel: "느림", gain: 4.5 },
  { level: 10, name: "대왕 게", points: 200_000, scale: 3.1, atk: 160, hp: 3_500, speed: 182, speedLabel: "느림", gain: 4.8 },
  { level: 11, name: "전설의 게", points: 350_000, scale: 3.3, atk: 190, hp: 4_300, speed: 178, speedLabel: "묵직함", gain: 5.3 },
  { level: 12, name: "킹 크랩", points: 500_000, scale: 3.5, atk: 220, hp: 5_000, speed: 175, speedLabel: "묵직함", gain: 6 },
];

export const MAX_LEVEL = LEVELS.length;

// ── Species roadmaps ────────────────────────────────────────────────────────

export type SpeciesId = "flower" | "fiddler" | "ghost" | "snow";

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  role: string;
  blurb: string;
  /** Stat multipliers applied on top of the base roadmap. */
  atk: number;
  hp: number;
  speed: number;
  scale: number;
  crit: number; // added crit chance
  staminaDrain: number;
  regen: number;
  /** Level-threshold multiplier at Lv2 (early) → Lv12 (late): <1 = cheaper. */
  earlyCost: number;
  lateCost: number;
  /** Body proportions for the renderer. */
  build: { clawL: number; clawR: number; leg: number; body: number };
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  flower: {
    id: "flower", name: "꽃게", role: "균형형",
    blurb: "기획서 기준 로드맵 그대로. 어느 구간에서도 무난하게 싸우고 자랍니다.",
    atk: 1, hp: 1, speed: 1, scale: 1, crit: 0, staminaDrain: 1, regen: 1, earlyCost: 1, lateCost: 1,
    build: { clawL: 1, clawR: 1, leg: 1, body: 1 },
  },
  fiddler: {
    id: "fiddler", name: "농게", role: "파워형",
    blurb: "한쪽 집게가 거대합니다. 공격력 +30%·치명타 +5%, 대신 체력과 발이 조금 약합니다.",
    atk: 1.3, hp: 0.9, speed: 0.95, scale: 1, crit: 0.05, staminaDrain: 1, regen: 1, earlyCost: 1.05, lateCost: 1,
    build: { clawL: 0.7, clawR: 1.75, leg: 1, body: 0.95 },
  },
  ghost: {
    id: "ghost", name: "달랑게", role: "스피드형",
    blurb: "모래사장의 단거리 선수. 이동 +15%·부스트 소모 -30%, 초반 레벨업이 빠르지만 후반 성장은 더딥니다.",
    atk: 0.85, hp: 0.85, speed: 1.15, scale: 0.92, crit: 0.02, staminaDrain: 0.7, regen: 1, earlyCost: 0.75, lateCost: 1.15,
    build: { clawL: 0.8, clawR: 0.8, leg: 1.35, body: 0.9 },
  },
  snow: {
    id: "snow", name: "대게", role: "탱커형",
    blurb: "긴 다리의 철갑. 체력 +35%·자연 회복 +50%, 초반엔 느리게 크지만 후반 레벨업이 가장 빠릅니다.",
    atk: 0.9, hp: 1.35, speed: 0.9, scale: 1.08, crit: 0, staminaDrain: 1, regen: 1.5, earlyCost: 1.2, lateCost: 0.88,
    build: { clawL: 0.9, clawR: 0.9, leg: 1.5, body: 1.05 },
  },
};

export const SPECIES_LIST: SpeciesDef[] = Object.values(SPECIES);

const roadmapCache = new Map<SpeciesId, LevelDef[]>();

/** The 12-step roadmap for one species (base table × species multipliers). */
export function roadmap(species: SpeciesId = "flower"): LevelDef[] {
  let r = roadmapCache.get(species);
  if (r) return r;
  const sp = SPECIES[species];
  r = LEVELS.map((l, i) => {
    const t = i <= 1 ? 0 : (i - 1) / (LEVELS.length - 2);
    const cost = sp.earlyCost + (sp.lateCost - sp.earlyCost) * t;
    return {
      ...l,
      points: i === 0 ? 0 : Math.round((l.points * cost) / 100) * 100,
      scale: +(l.scale * sp.scale).toFixed(2),
      atk: Math.round(l.atk * sp.atk),
      hp: Math.round((l.hp * sp.hp) / 10) * 10,
      speed: Math.round(l.speed * sp.speed),
    };
  });
  roadmapCache.set(species, r);
  return r;
}

export function levelForScore(score: number, species: SpeciesId = "flower"): LevelDef {
  const table = roadmap(species);
  let lv = table[0];
  for (const l of table) if (score >= l.points) lv = l;
  return lv;
}

export const CRAB_RADIUS = 18;
export const BOOST_MULT = 1.5;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 32; // per second while boosting
export const STAMINA_REGEN = 70; // per second once the delay has passed
export const STAMINA_DELAY = 2; // seconds after releasing boost
/** Out-of-combat regen: starts after this many seconds without damage. */
export const REGEN_DELAY = 5;
export const REGEN_RATE = 0.015; // of max HP per second
export const POOL_HEAL_RATE = 0.05; // of max HP per second (tide pools)
export const COMBO_WINDOW = 1.6;
export const COUNTER_WINDOW = 0.45;
export const HIT_STOP = 0.05;
export const BASE_CRIT = 0.08;
export const CRIT_MULT = 1.75;
export const COUNTER_MULT = 1.5;
/** Frontal guard cone half-angle (cos). 60° → 0.5. */
export const GUARD_COS = 0.5;

export function comboMultiplier(combo: number): number {
  return 1 + Math.min(10, Math.max(0, combo - 1)) * 0.08;
}

// ── Equipment (spec §4) ─────────────────────────────────────────────────────

export type WeaponKind = "bone" | "bat" | "hammer" | "bottle" | "knife" | "sickle" | "sign" | "anchor";
export type ShieldKind = "potLid" | "shell" | "captain";

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  emoji: string;
  family: "blunt" | "blade" | "heavy";
  dmg: number; // damage multiplier on the level ATK
  cooldown: number; // seconds between swings
  reach: number; // multiplier on the unarmed claw reach
  arc: number; // half-angle of the hit cone (radians)
  crit: number; // added crit chance
  knockback: number;
  stun: number; // seconds
  durability: number;
  tier: number;
  color: string;
}

export const UNARMED = { dmg: 1, cooldown: 0.36, reach: 1, arc: 1.05, crit: 0, knockback: 90, stun: 0 };

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  bone: { kind: "bone", name: "뼈다귀", emoji: "🦴", family: "blunt", dmg: 1.35, cooldown: 0.42, reach: 1.25, arc: 1.0, crit: 0.02, knockback: 190, stun: 0.25, durability: 18, tier: 1, color: "#f5f0e1" },
  bottle: { kind: "bottle", name: "깨진 유리병", emoji: "🍾", family: "blade", dmg: 1.3, cooldown: 0.28, reach: 1.15, arc: 0.9, crit: 0.14, knockback: 60, stun: 0, durability: 14, tier: 1, color: "#4ade80" },
  bat: { kind: "bat", name: "야구방망이", emoji: "🏏", family: "blunt", dmg: 1.6, cooldown: 0.45, reach: 1.5, arc: 1.05, crit: 0.04, knockback: 280, stun: 0.4, durability: 16, tier: 2, color: "#d6a15e" },
  knife: { kind: "knife", name: "칼", emoji: "🔪", family: "blade", dmg: 1.55, cooldown: 0.26, reach: 1.25, arc: 0.85, crit: 0.2, knockback: 70, stun: 0, durability: 16, tier: 2, color: "#e2e8f0" },
  hammer: { kind: "hammer", name: "망치", emoji: "🔨", family: "blunt", dmg: 2.0, cooldown: 0.55, reach: 1.45, arc: 1.0, crit: 0.05, knockback: 340, stun: 0.55, durability: 15, tier: 3, color: "#94a3b8" },
  sickle: { kind: "sickle", name: "낫", emoji: "🌙", family: "blade", dmg: 1.85, cooldown: 0.3, reach: 1.45, arc: 1.2, crit: 0.22, knockback: 90, stun: 0, durability: 15, tier: 3, color: "#cbd5e1" },
  sign: { kind: "sign", name: "표지판", emoji: "🪧", family: "heavy", dmg: 2.4, cooldown: 0.72, reach: 1.85, arc: 1.55, crit: 0.06, knockback: 380, stun: 0.5, durability: 14, tier: 4, color: "#facc15" },
  anchor: { kind: "anchor", name: "닻", emoji: "⚓", family: "heavy", dmg: 3.0, cooldown: 0.85, reach: 1.95, arc: 1.75, crit: 0.08, knockback: 460, stun: 0.7, durability: 15, tier: 5, color: "#64748b" },
};

export interface ShieldDef {
  kind: ShieldKind;
  name: string;
  emoji: string;
  /** Fraction of frontal damage removed. */
  block: number;
  durability: number;
  tier: number;
  color: string;
}

export const SHIELDS: Record<ShieldKind, ShieldDef> = {
  potLid: { kind: "potLid", name: "냄비 뚜껑", emoji: "🍳", block: 0.5, durability: 15, tier: 1, color: "#9ca3af" },
  shell: { kind: "shell", name: "조개껍데기", emoji: "🐚", block: 0.6, durability: 18, tier: 2, color: "#fbcfe8" },
  captain: { kind: "captain", name: "캡틴 방패", emoji: "🛡️", block: 0.7, durability: 22, tier: 3, color: "#3b82f6" },
};

// ── Food & pickups (spec §3.2) ──────────────────────────────────────────────

export type FoodKind = "banana" | "donut" | "coconut" | "starfish" | "clam" | "watermelon" | "meat";

export interface FoodDef {
  kind: FoodKind;
  name: string;
  emoji: string;
  points: number;
  /** Fraction of max HP restored. */
  heal: number;
  radius: number;
  weight: number; // relative spawn weight (0 = drop-only)
}

export const FOODS: Record<FoodKind, FoodDef> = {
  banana: { kind: "banana", name: "바나나", emoji: "🍌", points: 25, heal: 0.02, radius: 9, weight: 34 },
  clam: { kind: "clam", name: "조개", emoji: "🦪", points: 60, heal: 0.02, radius: 9, weight: 22 },
  donut: { kind: "donut", name: "도넛", emoji: "🍩", points: 90, heal: 0.03, radius: 10, weight: 16 },
  coconut: { kind: "coconut", name: "코코넛", emoji: "🥥", points: 150, heal: 0.04, radius: 11, weight: 12 },
  starfish: { kind: "starfish", name: "불가사리", emoji: "⭐", points: 220, heal: 0.03, radius: 11, weight: 8 },
  watermelon: { kind: "watermelon", name: "수박", emoji: "🍉", points: 500, heal: 0.08, radius: 14, weight: 3 },
  meat: { kind: "meat", name: "고기", emoji: "🍖", points: 0, heal: 0.06, radius: 11, weight: 0 },
};

// ── Creatures (NPC, spec §3.2-2) ────────────────────────────────────────────

export type CreatureKind = "babyCrab" | "fish" | "crayfish" | "turtle" | "lobster";

export interface CreatureDef {
  kind: CreatureKind;
  name: string;
  hp: number;
  points: number;
  radius: number;
  speed: number;
  /** 0 = harmless; otherwise hits back when attacked. */
  atk: number;
  behavior: "flee" | "fight" | "tank";
  water: boolean; // lives in the shallow ring
  weight: number;
  meat: number; // meat pickups dropped (points = points*0.3 each)
  color: string;
}

export const CREATURES: Record<CreatureKind, CreatureDef> = {
  babyCrab: { kind: "babyCrab", name: "꼬마 게", hp: 20, points: 80, radius: 10, speed: 120, atk: 0, behavior: "flee", water: false, weight: 30, meat: 0, color: "#fb923c" },
  fish: { kind: "fish", name: "물고기", hp: 16, points: 120, radius: 11, speed: 150, atk: 0, behavior: "flee", water: true, weight: 24, meat: 0, color: "#38bdf8" },
  crayfish: { kind: "crayfish", name: "가재", hp: 90, points: 350, radius: 15, speed: 110, atk: 7, behavior: "fight", water: false, weight: 14, meat: 1, color: "#dc2626" },
  turtle: { kind: "turtle", name: "바다거북", hp: 700, points: 2_000, radius: 32, speed: 45, atk: 22, behavior: "tank", water: false, weight: 5, meat: 3, color: "#65a30d" },
  lobster: { kind: "lobster", name: "대왕 랍스터", hp: 3_500, points: 9_000, radius: 46, speed: 70, atk: 75, behavior: "fight", water: false, weight: 1.6, meat: 5, color: "#b91c1c" },
};

// ── Boxes ───────────────────────────────────────────────────────────────────

export type BoxKind = "wood" | "gold";
export const BOXES: Record<BoxKind, { name: string; hp: number; radius: number; coins: [number, number] }> = {
  wood: { name: "나무 상자", hp: 45, radius: 20, coins: [60, 180] },
  gold: { name: "황금 보물상자", hp: 1, radius: 26, coins: [1_200, 2_600] },
};

// ── Map ─────────────────────────────────────────────────────────────────────

export const WORLD_R = 2150; // hard sea wall radius
export const ISLAND_R = 1850; // mean sand radius
export const SHALLOW_W = 190; // shallow-water ring width beyond the sand edge
export const SHALLOW_SLOW = 0.78;

/** Wobbly island edge (deterministic, not seeded — the island is a landmark). */
export function islandRadiusAt(angle: number): number {
  return ISLAND_R + 110 * Math.sin(3 * angle + 0.4) + 70 * Math.sin(5 * angle + 1.3) + 40 * Math.sin(9 * angle);
}

export const POPULATION = {
  food: 240,
  wood: 24,
  gold: 6,
  keys: 5,
  creatures: 46,
};

// ── Match ───────────────────────────────────────────────────────────────────

export const MATCH_LENGTHS = [
  { seconds: 300, label: "5분 · 스피드" },
  { seconds: 480, label: "8분 · 기본" },
  { seconds: 720, label: "12분 · 킹 크랩 도전" },
];

export const BOT_COUNT = 13;
export const BOT_RESPAWN = 4;
export const SPAWN_SHIELD = 3; // seconds of spawn invulnerability

export interface CrabColor {
  id: string;
  name: string;
  shell: string;
  dark: string;
  belly: string;
}

export const CRAB_COLORS: CrabColor[] = [
  { id: "red", name: "꽃게 레드", shell: "#e0472f", dark: "#8f1f12", belly: "#fbd5c5" },
  { id: "blue", name: "블루 크랩", shell: "#2f7de0", dark: "#123c8f", belly: "#dbeafe" },
  { id: "orange", name: "선셋 오렌지", shell: "#f08a24", dark: "#94480a", belly: "#ffedd5" },
  { id: "purple", name: "보라 소라게", shell: "#8b5cf6", dark: "#4c1d95", belly: "#ede9fe" },
  { id: "green", name: "갯벌 그린", shell: "#22a35a", dark: "#0f5130", belly: "#dcfce7" },
  { id: "pink", name: "코랄 핑크", shell: "#ec5f9a", dark: "#8a1d4e", belly: "#fce7f3" },
  { id: "teal", name: "민트 청게", shell: "#14b8a6", dark: "#0f5c55", belly: "#ccfbf1" },
  { id: "black", name: "흑게", shell: "#475569", dark: "#1e293b", belly: "#e2e8f0" },
];

export const BOT_NAMES = [
  "집게대장", "모래사장보안관", "옆걸음마스터", "간장게장", "킹크랩지망생", "해변의무법자", "조개털이", "야자수밑", "파도타기",
  "꽃게탕", "대게왕", "소라껍데기", "갯벌의제왕", "바위틈", "집게손", "빨간집게", "밀물", "썰물", "코코넛헌터",
  "불가사리수집가", "해적게", "망치집게", "모래성파괴자", "게딱지", "짠물", "바다향기", "게걸음", "왕집게",
];
