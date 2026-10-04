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
 * Base (꽃게/균형형) roadmap: 12 finer steps. Originally the spec's six
 * milestones sat at Lv1/3/5/7/9/12 (0·1k·5k·20k·100k·500k). The 하이퍼 성장
 * update cut the early thresholds by 40% (Lv2–6) and made 바나나/조개 2.5×
 * richer; the late ones were re-tuned by bot self-play against the new income
 * (field weapons, mutations, tier skills) so a runaway crab hits Lv11 ~2× and
 * Lv12 ~2× sooner than before rather than in the first two minutes.
 */
export const LEVELS: LevelDef[] = [
  { level: 1, name: "아기 게", points: 0, scale: 1.0, atk: 10, hp: 100, speed: 250, speedLabel: "가장 빠름", gain: 1 },
  { level: 2, name: "꼬마 게", points: 300, scale: 1.15, atk: 14, hp: 150, speed: 245, speedLabel: "가장 빠름", gain: 1.1 },
  { level: 3, name: "어린 게", points: 600, scale: 1.3, atk: 18, hp: 200, speed: 240, speedLabel: "빠름", gain: 1.4 },
  { level: 4, name: "소년 게", points: 1_300, scale: 1.5, atk: 26, hp: 300, speed: 231, speedLabel: "빠름", gain: 1.55 },
  { level: 5, name: "청년 게", points: 3_000, scale: 1.7, atk: 35, hp: 450, speed: 222, speedLabel: "보통", gain: 2 },
  { level: 6, name: "젊은 게", points: 6_000, scale: 1.95, atk: 48, hp: 700, speed: 213, speedLabel: "보통", gain: 2.2 },
  { level: 7, name: "성체 게", points: 15_000, scale: 2.2, atk: 65, hp: 1_000, speed: 205, speedLabel: "약간 느림", gain: 3 },
  { level: 8, name: "노련한 게", points: 36_000, scale: 2.5, atk: 90, hp: 1_600, speed: 196, speedLabel: "약간 느림", gain: 3.3 },
  { level: 9, name: "거대 게", points: 90_000, scale: 2.8, atk: 120, hp: 2_500, speed: 188, speedLabel: "느림", gain: 4.5 },
  { level: 10, name: "대왕 게", points: 230_000, scale: 3.1, atk: 160, hp: 3_500, speed: 182, speedLabel: "느림", gain: 4.8 },
  { level: 11, name: "전설의 게", points: 440_000, scale: 3.3, atk: 190, hp: 4_300, speed: 178, speedLabel: "묵직함", gain: 5.3 },
  { level: 12, name: "킹 크랩", points: 720_000, scale: 3.5, atk: 220, hp: 5_000, speed: 175, speedLabel: "묵직함", gain: 6 },
];

export const MAX_LEVEL = LEVELS.length;

// ── Species roadmaps ────────────────────────────────────────────────────────

export type SpeciesId = "flower" | "fiddler" | "ghost" | "snow" | "hermit" | "mitten" | "hairy" | "redsnow";

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
  /** Multiplier on the level point-gain (bigger = earns more from food/creatures/box coins). */
  gain?: number;
  /** Level-threshold multiplier at Lv2 (early) → Lv12 (late): <1 = cheaper. */
  earlyCost: number;
  lateCost: number;
  /** Body proportions for the renderer. */
  build: { clawL: number; clawR: number; leg: number; body: number; shell?: boolean; fur?: boolean; spikes?: boolean };
  /** Lifetime trophies needed to pick this species in the lobby (0 = free). */
  unlock: number;
  /** Species trait that flares up on every level-up. */
  perk: { icon: string; name: string; desc: string; seconds: number; color: string };
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  flower: {
    id: "flower", name: "꽃게", role: "균형형",
    blurb: "기획서 기준 로드맵 그대로. 어느 구간에서도 무난하게 싸우고 자랍니다.",
    atk: 1, hp: 1, speed: 1, scale: 1, crit: 0, staminaDrain: 1, regen: 1, earlyCost: 1, lateCost: 1,
    build: { clawL: 1, clawR: 1, leg: 1, body: 1 },
    unlock: 0,
    perk: { icon: "🌸", name: "꽃잎 회복", desc: "레벨업 때 체력 10% 추가 회복", seconds: 0, color: "#f472b6" },
  },
  fiddler: {
    id: "fiddler", name: "농게", role: "파워형",
    blurb: "한쪽 집게가 거대합니다. 공격력 +30%·치명타 +5%, 대신 체력과 발이 조금 약합니다.",
    atk: 1.3, hp: 0.9, speed: 0.95, scale: 1, crit: 0.05, staminaDrain: 1, regen: 1, earlyCost: 1.05, lateCost: 1,
    build: { clawL: 0.7, clawR: 1.75, leg: 1, body: 0.95 },
    unlock: 20,
    perk: { icon: "💥", name: "분노의 집게", desc: "레벨업 후 3초간 공격력 +25%", seconds: 3, color: "#fb923c" },
  },
  ghost: {
    id: "ghost", name: "달랑게", role: "스피드형",
    blurb: "모래사장의 단거리 선수. 이동 +15%·부스트 소모 -30%, 초반 레벨업이 빠르지만 후반 성장은 더딥니다.",
    atk: 0.85, hp: 0.85, speed: 1.15, scale: 0.92, crit: 0.02, staminaDrain: 0.7, regen: 1, earlyCost: 0.75, lateCost: 1.15,
    build: { clawL: 0.8, clawR: 0.8, leg: 1.35, body: 0.9 },
    unlock: 60,
    perk: { icon: "💨", name: "질주 본능", desc: "레벨업 때 스태미나 가득 + 2.5초간 이동 +20%", seconds: 2.5, color: "#fde68a" },
  },
  snow: {
    id: "snow", name: "대게", role: "탱커형",
    blurb: "긴 다리의 철갑. 체력 +35%·자연 회복 +50%, 초반엔 느리게 크지만 후반 레벨업이 가장 빠릅니다.",
    atk: 0.9, hp: 1.35, speed: 0.9, scale: 1.08, crit: 0, staminaDrain: 1, regen: 1.5, earlyCost: 1.2, lateCost: 0.88,
    build: { clawL: 0.9, clawR: 0.9, leg: 1.5, body: 1.05 },
    unlock: 120,
    perk: { icon: "🧊", name: "철갑 경화", desc: "레벨업 후 3초간 받는 피해 -30%", seconds: 3, color: "#7dd3fc" },
  },
  hermit: {
    id: "hermit", name: "소라게", role: "방어형",
    blurb: "등에 소라 껍데기를 지고 다닙니다. 체력 +25%, 레벨업할 때마다 방패를 새것처럼 고칩니다.",
    atk: 0.95, hp: 1.25, speed: 0.95, scale: 0.95, crit: 0, staminaDrain: 1, regen: 1.1, earlyCost: 0.95, lateCost: 1.05,
    build: { clawL: 1.1, clawR: 0.8, leg: 0.9, body: 0.9, shell: true },
    unlock: 180,
    perk: { icon: "🐚", name: "껍데기 수선", desc: "레벨업 때 방패 내구도 완전 회복(없으면 냄비 뚜껑 지급)", seconds: 0, color: "#e9d5ff" },
  },
  mitten: {
    id: "mitten", name: "참게", role: "흡혈형",
    blurb: "털 난 집게로 물고 늘어지는 끈질긴 싸움꾼. 공격 +5%·회복 +20%, 레벨업 직후엔 때릴수록 체력이 찹니다.",
    atk: 1.05, hp: 1, speed: 1, scale: 1, crit: 0, staminaDrain: 1, regen: 1.2, earlyCost: 1, lateCost: 1,
    build: { clawL: 1.1, clawR: 1.1, leg: 1, body: 1, fur: true },
    unlock: 250,
    perk: { icon: "🩸", name: "털집게 흡혈", desc: "레벨업 후 4초간 가한 피해의 25%만큼 회복", seconds: 4, color: "#4ade80" },
  },
  hairy: {
    id: "hairy", name: "털게", role: "치명타형",
    blurb: "온몸의 가시털이 급소를 노립니다. 치명타 +10%·공격 +10%, 대신 체력이 15% 낮습니다.",
    atk: 1.1, hp: 0.85, speed: 1.02, scale: 0.95, crit: 0.1, staminaDrain: 1, regen: 1, earlyCost: 1, lateCost: 1.02,
    build: { clawL: 0.95, clawR: 0.95, leg: 0.95, body: 0.95, spikes: true },
    unlock: 330,
    perk: { icon: "⚡", name: "가시털 폭발", desc: "레벨업 후 3초간 치명타 확률 +50%", seconds: 3, color: "#facc15" },
  },
  redsnow: {
    id: "redsnow", name: "홍게", role: "수집형",
    blurb: "심해에서 올라온 보물 사냥꾼. 점수 흡수 +6%·이동 +5%, 대신 공격과 체력이 10% 낮습니다.",
    atk: 0.9, hp: 0.9, speed: 1.05, scale: 1, crit: 0, staminaDrain: 0.9, regen: 1, gain: 1.06, earlyCost: 0.9, lateCost: 1.05,
    build: { clawL: 0.85, clawR: 0.85, leg: 1.4, body: 1 },
    unlock: 420,
    perk: { icon: "💰", name: "심해의 보물", desc: "레벨업 때 주변에 보물 코인이 쏟아짐", seconds: 0, color: "#fbbf24" },
  },
};

export const SPECIES_LIST: SpeciesDef[] = Object.values(SPECIES);

/** Level-up surge strengths (see SpeciesDef.perk). */
export const PERK_ATK = 1.25;
export const PERK_SPEED = 1.2;
export const PERK_ARMOR = 0.7;
export const PERK_HEAL = 0.1;
export const PERK_LIFESTEAL = 0.25;
export const PERK_CRIT = 0.5;

export function isUnlocked(species: SpeciesId, trophies: number): boolean {
  return trophies >= SPECIES[species].unlock;
}

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
      gain: +(l.gain * (sp.gain ?? 1)).toFixed(2),
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
  banana: { kind: "banana", name: "바나나", emoji: "🍌", points: 62, heal: 0.02, radius: 9, weight: 34 },
  clam: { kind: "clam", name: "조개", emoji: "🦪", points: 150, heal: 0.02, radius: 9, weight: 22 },
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

// ── 하이퍼 성장: evolution tiers + 게딱지 특수기 ─────────────────────────────

export type CrabTier = 1 | 2 | 3 | 4;

export interface TierDef {
  tier: CrabTier;
  /** First level of this tier. */
  level: number;
  name: string;
  passive: string;
  /** Cumulative passive multipliers. */
  speed: number;
  armor: number; // damage taken multiplier
  atk: number;
  skillName: string;
  skillIcon: string;
  skillCooldown: number;
  skillDescription: string;
  color: string;
}

/**
 * The spec's 4-step evolution tree mapped onto the 12-level roadmap
 * (Lv4/8 as written; the spec's Lv15 is past our Lv12 cap, so Tier 4 opens at Lv11).
 */
export const TIERS: Record<CrabTier, TierDef> = {
  1: {
    tier: 1, level: 1, name: "아기 게", passive: "기본 집게발",
    speed: 1, armor: 1, atk: 1,
    skillName: "옆걸음 대시", skillIcon: "💨", skillCooldown: 4,
    skillDescription: "진행 방향으로 빠르게 굴러 0.35초간 모든 공격을 회피합니다.", color: "#fdba74",
  },
  2: {
    tier: 2, level: 4, name: "갯벌 돌방게", passive: "이동속도 +30%",
    speed: 1.3, armor: 1, atk: 1,
    skillName: "버블 스핏", skillIcon: "🫧", skillCooldown: 5,
    skillDescription: "주변 360도로 산소 방울을 터뜨려 적을 1.5초간 기절시킵니다.", color: "#7dd3fc",
  },
  3: {
    tier: 3, level: 8, name: "티타늄 투구 왕게", passive: "이동속도 +30% · 받는 피해 -33%(방어 +50%)",
    speed: 1.3, armor: 1 / 1.5, atk: 1,
    skillName: "모래 잠복 폭발", skillIcon: "🏜️", skillCooldown: 7,
    skillDescription: "1.5초간 모래 속에 숨어 무적이 된 뒤 솟구치며 주변을 띄워 올립니다(광역 피해+기절).", color: "#fcd34d",
  },
  4: {
    tier: 4, level: 11, name: "심해 메카 바나클 크랩", passive: "이동 +30% · 방어 +50% · 듀얼 집게포(공격 +30%)",
    speed: 1.3, armor: 1 / 1.5, atk: 1.3,
    skillName: "고압 수류 멜트 빔", skillIcon: "🔫", skillCooldown: 10,
    skillDescription: "전방에 거대한 수압 레이저를 발사해 일직선상의 모든 적을 관통 분쇄합니다.", color: "#22d3ee",
  },
};

export function tierForLevel(level: number): CrabTier {
  return level >= TIERS[4].level ? 4 : level >= TIERS[3].level ? 3 : level >= TIERS[2].level ? 2 : 1;
}

export type ShellBand = "chevron" | "streak" | "hex" | "dots";
export type ShellPiece = "rosette" | "star" | "rivets" | "coin";

/** Shell pattern flavour per species: Tier 2 band style and Tier 3 centrepiece (render + evolution SFX). */
export const SHELL_STYLE: Record<SpeciesId, { band: ShellBand; piece: ShellPiece }> = {
  flower: { band: "chevron", piece: "rosette" },
  fiddler: { band: "chevron", piece: "star" },
  ghost: { band: "streak", piece: "star" },
  snow: { band: "hex", piece: "rivets" },
  hermit: { band: "dots", piece: "rosette" },
  mitten: { band: "dots", piece: "rosette" },
  hairy: { band: "streak", piece: "rivets" },
  redsnow: { band: "dots", piece: "coin" },
};

export const SHELL_BAND_LABEL: Record<ShellBand, string> = { chevron: "줄무늬", streak: "속도선", hex: "육각 갑옷", dots: "물방울" };
export const SHELL_PIECE_LABEL: Record<ShellPiece, string> = { rosette: "황금 꽃", star: "황금 별", rivets: "황금 리벳", coin: "황금 동전" };

/** Seconds the level-up "new shell pattern paints itself on" reveal lasts. */
export const EVO_REVEAL = 0.9;

export const DASH_SPEED = 720;
export const DASH_INVULN = 0.35;
export const BUBBLE_RADIUS = 150; // × scale
export const BUBBLE_STUN = 1.5;
export const BURROW_TIME = 1.5;
export const BURROW_RADIUS = 175; // × scale
export const BURROW_DMG = 2.5; // × ATK
export const BEAM_LENGTH = 760;
export const BEAM_WIDTH = 34; // × scale (half-width)
export const BEAM_DMG = 4; // × ATK

// ── 필드 드롭 해저 무기 (auto-firing, timed; max 2) ─────────────────────────

export type GearKind = "shotgun" | "needle" | "zap" | "mine" | "trident" | "saw" | "vortex";

export type GearRarity = "common" | "rare" | "epic";

/** `dmg`/`dur` are the rarity bonuses baked into GEARS (rarer = hits harder and lasts longer). */
export const GEAR_RARITY: Record<GearRarity, { label: string; rank: number; color: string; glow: string; dmg: number; dur: number }> = {
  common: { label: "일반", rank: 1, color: "#67e8f9", glow: "rgba(34,211,238,0.7)", dmg: 1, dur: 1 },
  rare: { label: "희귀", rank: 2, color: "#c084fc", glow: "rgba(192,132,252,0.8)", dmg: 1.15, dur: 1.2 },
  epic: { label: "전설", rank: 3, color: "#fbbf24", glow: "rgba(251,191,36,0.9)", dmg: 1.3, dur: 1.4 },
};

export interface GearDef {
  kind: GearKind;
  name: string;
  emoji: string;
  desc: string;
  rarity: GearRarity;
  /** Relative drop weight — rarer weapons drop less often. */
  weight: number;
  /** Damage per hit as a multiple of the owner's level ATK (rarity bonus included). */
  dmg: number;
  /** Before the rarity bonus — the rulebook shows both. */
  baseDmg: number;
  cooldown: number;
  /** Seconds the weapon lasts after pickup (rarity bonus included). */
  duration: number;
  baseDuration: number;
  /** Auto-aim range (world units, before scale bonus). */
  range: number;
  color: string;
}

export const MAX_GEAR = 2;
/** Picking up a weapon you already hold upgrades it (★1 → ★3): +25% damage and -12% cooldown per star. */
export const GEAR_STACK_MAX = 3;
export const GEAR_STACK_DMG = 0.25;
export const GEAR_STACK_CD = 0.12;
/** Bots go out of their way (vision ×, payoff +) to hunt anyone carrying a legendary weapon. */
export const EPIC_HUNT_VISION = 1.6;
export const EPIC_HUNT_PAYOFF = 4_000;
/** The longer a legendary carrier survives, the fatter the bounty on its shell (capped). */
export const EPIC_BOUNTY_PER_SEC = 120;
export const EPIC_BOUNTY_MAX_EXTRA = 15_000;
/** Bounty paid (on top of the normal kill reward) for flipping a legendary carrier. */
export function epicBounty(victimLevel: number, heldSeconds = 0): number {
  return 3_000 + 500 * victimLevel + Math.min(EPIC_BOUNTY_MAX_EXTRA, Math.floor(heldSeconds) * EPIC_BOUNTY_PER_SEC);
}
/** 생존 보상: every EPIC_SURVIVE_EVERY seconds a legendary carrier stays alive it earns this × its point gain. */
export const EPIC_SURVIVE_EVERY = 5;
export const EPIC_SURVIVE_PTS = 150;
/** A carrier whose bounty has grown past this is "WANTED": bigger red blip on the minimap, red price tag. */
export const EPIC_WANTED = 10_000;

type GearBase = Omit<GearDef, "baseDmg" | "baseDuration">;

const GEAR_BASE: Record<GearKind, GearBase> = {
  shotgun: { kind: "shotgun", name: "조개껍질 산탄총", emoji: "🐚", desc: "전방 부채꼴로 패각 파편 5발", rarity: "common", weight: 30, dmg: 0.5, cooldown: 0.8, duration: 30, range: 300, color: "#fbcfe8" },
  needle: { kind: "needle", name: "가시 산호 기관총", emoji: "🪸", desc: "가시 침 초연사 + 넉백", rarity: "common", weight: 28, dmg: 0.2, cooldown: 0.15, duration: 25, range: 380, color: "#fb7185" },
  zap: { kind: "zap", name: "해파리 감전 채찍", emoji: "⚡", desc: "체인 라이트닝 3체 연쇄 감전", rarity: "rare", weight: 12, dmg: 0.9, cooldown: 1.2, duration: 30, range: 260, color: "#c4b5fd" },
  mine: { kind: "mine", name: "복어 맹독 지뢰포", emoji: "🐡", desc: "지나간 자리에 독 거품 지뢰", rarity: "common", weight: 26, dmg: 2.2, cooldown: 2.0, duration: 30, range: 0, color: "#a3e635" },
  trident: { kind: "trident", name: "넵튠의 청동 삼지창", emoji: "🔱", desc: "일직선 관통 수류창", rarity: "epic", weight: 5, dmg: 1.8, cooldown: 1.8, duration: 30, range: 520, color: "#fbbf24" },
  vortex: { kind: "vortex", name: "크라켄 소용돌이 포", emoji: "🌀", desc: "적을 빨아들이며 갈아버리는 소용돌이 발사", rarity: "epic", weight: 4, dmg: 0.42, cooldown: 2.6, duration: 30, range: 420, color: "#818cf8" },
  saw: { kind: "saw", name: "톱날 전기톱 집게", emoji: "🪚", desc: "초근접 회전 톱날 지속 피해", rarity: "rare", weight: 12, dmg: 0.32, cooldown: 0.2, duration: 25, range: 0, color: "#e2e8f0" },
};

export const GEARS = Object.fromEntries(
  Object.values(GEAR_BASE).map((g) => {
    const r = GEAR_RARITY[g.rarity];
    return [g.kind, { ...g, baseDmg: g.dmg, baseDuration: g.duration, dmg: +(g.dmg * r.dmg).toFixed(3), duration: Math.round(g.duration * r.dur) }];
  }),
) as Record<GearKind, GearDef>;

export const GEAR_LIST: GearDef[] = Object.values(GEARS);

/** Drop chance of each weapon from a pool restricted to `minRarity` and up. */
export function gearDropOdds(minRarity: GearRarity = "common"): Record<GearKind, number> {
  const pool = GEAR_LIST.filter((g) => GEAR_RARITY[g.rarity].rank >= GEAR_RARITY[minRarity].rank);
  const total = pool.reduce((a, g) => a + g.weight, 0);
  const out = {} as Record<GearKind, number>;
  for (const g of GEAR_LIST) out[g.kind] = pool.includes(g) ? g.weight / total : 0;
  return out;
}

/** Chance a slain creature drops a weapon. */
export const GEAR_DROP: Record<CreatureKind, number> = { babyCrab: 0.06, fish: 0.06, crayfish: 0.25, turtle: 0.7, lobster: 1 };

// ── 변이 아이템 (buffs & risk traps) ───────────────────────────────────────

export type MutationKind = "capsule" | "pearl" | "pepper" | "giant" | "toxic" | "salt" | "rum" | "oil";

export interface MutationDef {
  kind: MutationKind;
  name: string;
  emoji: string;
  risk: boolean;
  /** Seconds the upside lasts. */
  duration: number;
  /** Risk items: the downside only lasts this long (from pickup), the upside keeps going. */
  penalty?: number;
  /** Upside / downside for the HUD and rulebook. */
  good: string;
  bad?: string;
  atk: number;
  speed: number;
  armor: number; // damage taken multiplier
  weight: number;
  color: string;
}

export const MUTATIONS: Record<MutationKind, MutationDef> = {
  capsule: { kind: "capsule", name: "황금 플랑크톤 캡슐", emoji: "💊", risk: false, duration: 10, good: "자석 반경 3배 + 먹이 점수 300%", atk: 1, speed: 1, armor: 1, weight: 14, color: "#facc15" },
  pearl: { kind: "pearl", name: "진주 보호막", emoji: "🔮", risk: false, duration: 25, good: "공격 2회 무효화 + 수류 반사 폭발", atk: 1, speed: 1, armor: 1, weight: 12, color: "#e0f2fe" },
  pepper: { kind: "pepper", name: "매운 고추 미역", emoji: "🌶️", risk: false, duration: 12, good: "이동속도 +70% · 지나간 자리에 불꽃", atk: 1, speed: 1.7, armor: 1, weight: 13, color: "#f97316" },
  giant: { kind: "giant", name: "거대화 킹 바닷가재 즙", emoji: "🦞", risk: false, duration: 10, good: "몸집 2배 · 닿는 잡몹 즉사", atk: 1.25, speed: 1, armor: 1, weight: 9, color: "#ef4444" },
  toxic: { kind: "toxic", name: "방사능 폐기물 통", emoji: "☢️", risk: true, duration: 14, penalty: 6, good: "공격력 +200%", bad: "초록 시야 + 초당 2% 자해", atk: 3, speed: 1, armor: 1, weight: 9, color: "#84cc16" },
  salt: { kind: "salt", name: "고농도 소금 덩어리", emoji: "🧂", risk: true, duration: 10, penalty: 4, good: "방어력 +80% · 넉백 면역", bad: "이동속도 -40%", atk: 1, speed: 0.6, armor: 1 / 1.8, weight: 9, color: "#f1f5f9" },
  rum: { kind: "rum", name: "취한 해적의 럼주 병", emoji: "🥃", risk: true, duration: 12, penalty: 5, good: "모든 타격 치명타", bad: "조작 방향 반전(혼란)", atk: 1, speed: 1, armor: 1, weight: 8, color: "#d97706" },
  oil: { kind: "oil", name: "미끄러운 기름 찌꺼기", emoji: "🛢️", risk: true, duration: 2, penalty: 2, good: "", bad: "미끄러져 방향 제어 불가", atk: 1, speed: 1, armor: 1, weight: 10, color: "#334155" },
};

export const MUTATION_LIST: MutationDef[] = Object.values(MUTATIONS);
export const MUTATION_POP = 26;
export const MAGNET_BASE = 12; // pull radius = (body + this) × 3 while the capsule lasts
export const PEARL_CHARGES = 2;
export const TOXIC_DOT = 0.02; // of max HP per second
export const GIANT_SCALE = 2;
