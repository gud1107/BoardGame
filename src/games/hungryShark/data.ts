/**
 * Static game data for 배고픈 상어 (Hungry Shark-style ocean survival) —
 * the browser-side equivalent of the spec's `SharkDataSO` / `PreyDataSO` /
 * `UpgradeCurveSO` ScriptableObjects. Everything tunable lives here so the
 * engine (`engine.ts`) stays pure simulation.
 *
 * World units are "pixels at zoom 1". +y points DOWN (canvas convention):
 * the water surface is y = 0, the sky is negative y, the seabed is ~3300.
 */

import { buildGeometry, geoCeil, geoFloor, underIce, type IceSpec, type MapGeometry, type TerrainSpec } from "./mapGeometry";

// ── World layout ────────────────────────────────────────────────────────────

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

// ── Maps (selectable dive sites) ────────────────────────────────────────────
//
// Every map keeps the same depth bands (ZONES) so prey depth ranges still
// mean the same thing, but each has its own level geometry (`mapGeometry.ts`:
// seabed profile, ice ceiling, solid structures), its own monster roster
// (`spawns` — kinds not listed never appear there), coin bonus and palette.
// `createWorld` activates the chosen map, which updates the live `WORLD_W`
// binding + `seabedY`/`ceilingY` for engine and renderer.

export type MapId = "deepBlue" | "frozenStrait" | "shipwreck";

export interface MapDef {
  id: MapId;
  name: string;
  emoji: string;
  desc: string;
  /** Recommended shark tier (informational only — every map is open). */
  recommendedTier: number;
  width: number;
  chestCount: number;
  terrain: TerrainSpec;
  /** Solid ice sheet over the surface (얼음 해협). */
  ice: IceSpec | null;
  /** Coin multiplier for everything earned on this map. */
  coinBonus: number;
  /** Whole-map population factor on top of POPULATION_SCALE. */
  density: number;
  /** Extra factor for kinds that can hurt the shark (damage > 0) — the map's difficulty knob, tuned by bot sim. */
  threatDensity: number;
  /** Monster roster: spawn-count multiplier per kind. Kinds missing here never spawn on this map. */
  spawns: Partial<Record<EntityKind, number>>;
  /** Depth (world y) where the deep-water darkness starts. */
  darknessStart: number;
  feature: "coral" | "iceSheet" | "wrecks";
  palette: {
    sky: [string, string, string];
    water: [string, string, string, string, string];
    ridge: string;
    sand: [string, string];
    sun: string;
  };
}

/** Shared by every map: generic fish, jellies, mines, the golden tuna. */
const COMMON_SPAWNS: Partial<Record<EntityKind, number>> = {
  smallFish: 1, grouper: 1, ray: 1, tuna: 1, goldenTuna: 1,
};

export const MAPS: MapDef[] = [
  {
    id: "deepBlue", name: "딥 블루 오션", emoji: "🌊", recommendedTier: 1,
    desc: "완만한 산호 언덕이 화산 해구까지 이어지는 탁 트인 바다. 해변 피서객·요트·헬기가 몰려드는 기본 사냥터.",
    width: 14000, chestCount: 11,
    terrain: { kind: "rolling", base: SEABED_BASE, octaves: [[140, 0.0011, 0], [60, 0.0037, 1.3], [14, 0.013, 0.4]] },
    ice: null,
    coinBonus: 1,
    density: 1,
    threatDensity: 1,
    spawns: {
      ...COMMON_SPAWNS,
      crab: 1, swimmer: 1, puffer: 1, greenJelly: 1, redJelly: 1,
      mineS: 1, mineM: 1, mineL: 1, mineXL: 1,
      pelican: 1, diver: 1, sailor: 1, angler: 1, fishingBoat: 1, passenger: 1,
      smallShark: 1, cageDiver: 1, submarine: 1, ghostShark: 1, yacht: 1, helicopter: 1,
    },
    darknessStart: 1100, feature: "coral",
    palette: {
      sky: ["#0ea5e9", "#7dd3fc", "#e0f2fe"],
      water: ["#22b8e8", "#0679b8", "#0a4a78", "#082b4a", "#020617"],
      ridge: "rgba(8,47,73,0.55)",
      sand: ["#3f3a2e", "#0c0a09"],
      sun: "rgba(254,240,138,0.9)",
    },
  },
  {
    id: "frozenStrait", name: "얼음 해협", emoji: "🧊", recommendedTier: 2,
    desc: "수면이 두꺼운 빙판으로 덮여 숨구멍에서만 점프할 수 있는 바다. 얕은 대륙붕 사이로 깊은 해구 두 개가 갈라지고, 고드름과 얼음 기둥이 길을 막고, 빙판 밑을 지나면 고드름이 떨어집니다. 펭귄·물범·일각고래·범고래 서식. 코인 ×1.1.",
    width: 12000, chestCount: 9,
    terrain: {
      kind: "profile",
      points: [[0, 850], [1700, 950], [2150, 3300], [4300, 3450], [4750, 1200], [6200, 1100], [6500, 2200], [7400, 2250], [7800, 3500], [10000, 3400], [10450, 1000], [12000, 900]],
      octaves: [[40, 0.004, 0.3], [12, 0.02, 1]],
    },
    ice: { holes: [[1400, 700], [3300, 520], [5500, 620], [8900, 520], [11200, 640]], thickness: 80 },
    // Bot sim 2026-10-04 (6 seeds, Lv.3): the shallow shelf packs prey together, so per-dive income already
    // beats 딥 블루 (T3 ≈1.4×, T4 ≈1.8× at ×1.0) — the bonus stays small.
    coinBonus: 1.1,
    density: 1,
    threatDensity: 0.7,
    spawns: {
      ...COMMON_SPAWNS, smallFish: 1.2, tuna: 1.3, grouper: 1.4,
      penguin: 1, seal: 1, narwhal: 1, orca: 1,
      redJelly: 1.3, mineS: 0.6, mineM: 0.6, diver: 0.8, pelican: 0.5,
      fishingBoat: 0.6, sailor: 0.6, submarine: 1, smallShark: 0.7, angler: 0.8, iceberg: 1,
    },
    darknessStart: 1000, feature: "iceSheet",
    palette: {
      sky: ["#334155", "#94a3b8", "#e2e8f0"],
      water: ["#67e8f9", "#0e7490", "#164e63", "#0c2a3a", "#020617"],
      ridge: "rgba(22,78,99,0.55)",
      sand: ["#94a3b8", "#1e293b"],
      sun: "rgba(241,245,249,0.85)",
    },
  },
  {
    id: "shipwreck", name: "난파선 무덤", emoji: "⚓", recommendedTier: 3,
    desc: "계단처럼 꺼지는 해저 단구를 따라 거대한 침몰선 선체와 부러진 돛대가 벽처럼 놓인 어두운 바다. 보물 상자가 두 배지만 꼬치고기·곰치·대왕오징어와 기뢰가 득실거립니다. 코인 ×1.25.",
    width: 13000, chestCount: 20,
    terrain: {
      kind: "profile",
      points: [[0, 700], [1500, 720], [1750, 1300], [3300, 1320], [3550, 2000], [5000, 2050], [5300, 2900], [6000, 3400], [7400, 3400], [7700, 2700], [8900, 2650], [9200, 1900], [10600, 1850], [10850, 1100], [13000, 900]],
      octaves: [[25, 0.006, 0.7], [10, 0.03, 2]],
    },
    ice: null,
    coinBonus: 1.25,
    density: 1,
    threatDensity: 0.55,
    spawns: {
      ...COMMON_SPAWNS, tuna: 0.5, smallFish: 1.4,
      barracuda: 1, moray: 1, treasureHunter: 1, giantSquid: 1,
      crab: 1.8, puffer: 1, greenJelly: 1.4,
      mineS: 1.5, mineM: 1.6, mineL: 1.6, mineXL: 1.2,
      diver: 1.2, sailor: 0.8, fishingBoat: 1, angler: 1.4, smallShark: 1, submarine: 1.3, ghostShark: 1.3,
    },
    darknessStart: 500, feature: "wrecks",
    palette: {
      sky: ["#1e293b", "#475569", "#94a3b8"],
      water: ["#2d8a7a", "#155e63", "#123a46", "#0b1f2a", "#020617"],
      ridge: "rgba(18,58,70,0.6)",
      sand: ["#3b3524", "#0a0907"],
      sun: "rgba(226,232,240,0.45)",
    },
  },
];

export function mapById(id: string | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

const geometryCache = new Map<MapId, MapGeometry>();
function geometryFor(map: MapDef): MapGeometry {
  let g = geometryCache.get(map.id);
  if (!g) {
    g = buildGeometry(map.width, map.terrain, map.ice, map.feature);
    geometryCache.set(map.id, g);
  }
  return g;
}

let activeMap: MapDef = MAPS[0];
let activeGeo: MapGeometry = geometryFor(activeMap);
/** Width of the active map (live binding — updated by `setActiveMap`). */
export let WORLD_W = activeMap.width;

export function setActiveMap(map: MapDef) {
  activeMap = map;
  activeGeo = geometryFor(map);
  WORLD_W = map.width;
}

export function getActiveMap(): MapDef {
  return activeMap;
}

/** Level geometry (structures, colliders, ice) of the active map. */
export function activeGeometry(): MapGeometry {
  return activeGeo;
}

/** Shallowest / deepest the active map's seabed gets. */
export function seabedExtent(): { min: number; max: number } {
  return { min: activeGeo.floorMin, max: activeGeo.floorMax };
}

/** Lowest world y the camera / minimap must be able to show on the active map. */
export function worldBottom(): number {
  return Math.max(SEABED_BASE + 260, seabedExtent().max + 90);
}

/** Seabed profile of the active map — deterministic, so render and physics agree. */
export function seabedY(x: number): number {
  return geoFloor(activeGeo, x);
}

/** Highest point water reaches at x: the surface, or the ice sheet's underside (얼음 해협). */
export function ceilingY(x: number): number {
  return geoCeil(activeGeo, x, SURFACE_Y);
}

/** True where the surface is covered by ice (no jumping, no boats). */
export function isUnderIce(x: number): boolean {
  return underIce(activeGeo, x);
}

// ── Sharks: 3-branch evolution tree (Tier 1 → 2 → 3 → 4) ─────────────────────
//
//                       [T1 암초상어]
//          ┌──────────────────┼──────────────────┐
//   BRUTE 포식자          SPEED 스피드 암살      VOID 심해 사이오닉
//   T2 샌드타이거          T2 청상아리            T2 일렉트릭 레이 상어
//   T3 백상아리            T3 귀상어              T3 심해 고블린 상어
//   T4 메갈로돈            T4 나이트메어 팬텀      T4 아비스 레비아탄
//
// `tier` is also the prey food-chain tier (EntityDef.requiredTier), so every
// branch at the same tier eats the same things — branches differ in stats,
// passives and the active skill (`skill`, cast with Space / ⚡ button).

export type SharkTier = 1 | 2 | 3 | 4;
export type SharkBranch = "BASE" | "BRUTE" | "SPEED" | "VOID";

export type SkillId =
  | "sprint" | "crush" | "surgeRam" | "titanRoar"
  | "sonicBreak" | "sonar" | "shadowCloak"
  | "emp" | "snapJaw" | "blackHole";

export type PassiveId = "appetite" | "ballistics" | "staticField";

export interface SharkSkill {
  id: SkillId;
  name: string;
  /** Seconds between casts. */
  cooldown: number;
  desc: string;
}

export interface SharkDef {
  id: string;
  tier: SharkTier;
  branch: SharkBranch;
  /** Evolution parent (must be owned before this can be unlocked). */
  parentId: string | null;
  /** Branch choices this shark evolves into. */
  nextIds: string[];
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
  /** Coin multiplier on everything this shark earns in a dive. */
  goldMultiplier: number;
  /** Small edible prey inside this radius (from the mouth) is sucked in. */
  magnetRadius: number;
  /** Boost drains 1/boostEfficiency as fast. */
  boostEfficiency: number;
  skill: SharkSkill;
  passive: { id: PassiveId; name: string; desc: string } | null;
  /** Hull colors: [back, belly, accent]. */
  colors: [string, string, string];
  blurb: string;
}

export const BRANCH_INFO: Record<SharkBranch, { name: string; short: string; emoji: string; desc: string }> = {
  BASE: { name: "기본", short: "기본", emoji: "🦈", desc: "모든 진화의 출발점" },
  BRUTE: { name: "브루트 포식자", short: "포식자 계통", emoji: "🩸", desc: "대형 · 체력 · 광역 파괴" },
  SPEED: { name: "스피드 암살자", short: "스피드 암살", emoji: "⚡", desc: "기동성 · 탐지 · 일격" },
  VOID: { name: "심해 사이오닉", short: "심해 사이오닉", emoji: "🌀", desc: "스킬 · 끌어당김 · 상태이상" },
};

export const SHARKS: SharkDef[] = [
  {
    id: "reef", tier: 1, branch: "BASE", parentId: null, nextIds: ["sandTiger", "mako", "elecShark"],
    name: "암초상어", nameEn: "Reef Shark",
    maxHealth: 100, baseDrainRate: 3.0, swimSpeed: 250, boostMultiplier: 1.9, boostDuration: 2.4,
    biteForce: 10, eatRadius: 18, length: 70, cost: 0,
    goldMultiplier: 1.0, magnetRadius: 40, boostEfficiency: 1.0,
    skill: { id: "sprint", name: "스프린트 대시", cooldown: 6, desc: "0.6초간 2배 속도로 돌진합니다 (부스트 소모 없음)." },
    passive: { id: "appetite", name: "왕성한 식욕", desc: "먹이 섭취 시 체력 회복량 +20%" },
    colors: ["#64748b", "#e2e8f0", "#0f172a"],
    blurb: "작지만 민첩한 연안의 사냥꾼. 2티어부터 세 갈래 진화 경로 중 하나를 고를 수 있습니다.",
  },
  // ── Branch A: Brute ──
  {
    id: "sandTiger", tier: 2, branch: "BRUTE", parentId: "reef", nextIds: ["white"],
    name: "샌드타이거 상어", nameEn: "Sand Tiger",
    maxHealth: 180, baseDrainRate: 3.6, swimSpeed: 260, boostMultiplier: 1.85, boostDuration: 2.4,
    biteForce: 18, eatRadius: 24, length: 100, cost: 1560,
    goldMultiplier: 1.2, magnetRadius: 50, boostEfficiency: 0.9,
    skill: { id: "crush", name: "크러시 바이트", cooldown: 8, desc: "4초간 기뢰·해파리·어뢰를 씹어서 무력화하고 먹어 치웁니다." },
    passive: null,
    colors: ["#a18a6a", "#f5efe0", "#3f2f1d"],
    blurb: "단단한 먹이도 부수는 강력한 턱 힘. 체력이 높아 실수에 관대합니다.",
  },
  {
    id: "white", tier: 3, branch: "BRUTE", parentId: "sandTiger", nextIds: ["megalodon"],
    name: "백상아리", nameEn: "Great White",
    maxHealth: 300, baseDrainRate: 5.0, swimSpeed: 290, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 36, eatRadius: 34, length: 150, cost: 5850,
    goldMultiplier: 1.5, magnetRadius: 70, boostEfficiency: 1.1,
    skill: { id: "surgeRam", name: "서지 램 (충격 돌진)", cooldown: 9, desc: "무적 상태로 돌진하며 광역 충격파 — 먹이는 큰 피해, 기뢰는 유폭, 포식자는 기절." },
    passive: null,
    colors: ["#475569", "#ffffff", "#020617"],
    blurb: "바다의 제왕. 배와 케이지를 부수고 광역 충격파를 일으킵니다.",
  },
  {
    id: "megalodon", tier: 4, branch: "BRUTE", parentId: "white", nextIds: [],
    name: "메갈로돈", nameEn: "Megalodon",
    maxHealth: 460, baseDrainRate: 7.0, swimSpeed: 310, boostMultiplier: 1.85, boostDuration: 3.2,
    biteForce: 60, eatRadius: 44, length: 215, cost: 20800,
    goldMultiplier: 2.0, magnetRadius: 110, boostEfficiency: 1.4,
    skill: { id: "titanRoar", name: "타이탄의 포효", cooldown: 15, desc: "주변 모든 생물을 3초간 경직시키고, 6초간 크기 2배 + 무적 돌진." },
    passive: null,
    colors: ["#334155", "#cbd5e1", "#7f1d1d"],
    blurb: "잠수함과 헬리콥터조차 한 입에 삼키는 고대의 정점 포식자.",
  },
  // ── Branch B: Speed ──
  {
    id: "mako", tier: 2, branch: "SPEED", parentId: "reef", nextIds: ["hammer"],
    name: "청상아리", nameEn: "Mako Shark",
    maxHealth: 130, baseDrainRate: 3.2, swimSpeed: 305, boostMultiplier: 2.0, boostDuration: 2.6,
    biteForce: 14, eatRadius: 20, length: 86, cost: 1560,
    goldMultiplier: 1.25, magnetRadius: 45, boostEfficiency: 1.6,
    skill: { id: "sonicBreak", name: "음속 돌파", cooldown: 5, desc: "0.9초간 2.4배 속도 + 무적으로 꿰뚫고 지나갑니다." },
    passive: { id: "ballistics", name: "수중 탄도학", desc: "부스트 속도 +45%, 부스트 소모량 −30%" },
    colors: ["#2563eb", "#dbeafe", "#1e3a8a"],
    blurb: "가장 빠른 유선형 상어. 도망치는 사냥감을 순식간에 낚아챕니다.",
  },
  {
    id: "hammer", tier: 3, branch: "SPEED", parentId: "mako", nextIds: ["phantom"],
    name: "귀상어", nameEn: "Hammerhead",
    maxHealth: 220, baseDrainRate: 4.4, swimSpeed: 320, boostMultiplier: 2.0, boostDuration: 3.0,
    biteForce: 28, eatRadius: 28, length: 120, cost: 5850,
    goldMultiplier: 1.6, magnetRadius: 80, boostEfficiency: 1.8,
    skill: { id: "sonar", name: "360° 소나 펄스", cooldown: 7, desc: "8초간 보물 상자·황금 참치·대어의 위치를 화면 가장자리 레이더로 탐지합니다." },
    passive: null,
    colors: ["#a16207", "#fef3c7", "#422006"],
    blurb: "넓은 머리의 전자기 감각으로 숨겨진 보물과 황금 먹이를 찾아냅니다.",
  },
  {
    id: "phantom", tier: 4, branch: "SPEED", parentId: "hammer", nextIds: [],
    name: "나이트메어 팬텀", nameEn: "Nightmare Phantom",
    maxHealth: 340, baseDrainRate: 6.0, swimSpeed: 345, boostMultiplier: 2.05, boostDuration: 3.6,
    biteForce: 48, eatRadius: 36, length: 175, cost: 20800,
    goldMultiplier: 2.2, magnetRadius: 90, boostEfficiency: 2.5,
    skill: { id: "shadowCloak", name: "그림자 은신", cooldown: 12, desc: "4초간 무적 은신(포식자·어뢰가 추적 불가). 은신 후 첫 물기는 500% 피해." },
    passive: null,
    colors: ["#312e81", "#c7d2fe", "#c084fc"],
    blurb: "시공간을 왜곡해 은신하고, 그림자 속에서 치명적인 일격을 가합니다.",
  },
  // ── Branch C: Void / Psionic ──
  {
    id: "elecShark", tier: 2, branch: "VOID", parentId: "reef", nextIds: ["goblin"],
    name: "일렉트릭 레이 상어", nameEn: "Electric Ray Shark",
    maxHealth: 150, baseDrainRate: 3.4, swimSpeed: 270, boostMultiplier: 1.9, boostDuration: 2.5,
    biteForce: 15, eatRadius: 22, length: 92, cost: 1820,
    goldMultiplier: 1.3, magnetRadius: 85, boostEfficiency: 1.2,
    skill: { id: "emp", name: "EMP 정전기 방출", cooldown: 6, desc: "주변을 3초간 마비(기뢰 무력화)시키고 체인 라이트닝으로 작은 먹이 최대 6마리를 즉시 포식." },
    passive: { id: "staticField", name: "정전기 유도", desc: "주변 작은 먹이가 자석처럼 입으로 2배 강하게 빨려 들어옵니다." },
    colors: ["#155e75", "#cffafe", "#22d3ee"],
    blurb: "몸에 흐르는 전류로 작은 물고기를 끌어당기고 마비시킵니다.",
  },
  {
    id: "goblin", tier: 3, branch: "VOID", parentId: "elecShark", nextIds: ["leviathan"],
    name: "심해 고블린 상어", nameEn: "Goblin Shark",
    maxHealth: 250, baseDrainRate: 4.6, swimSpeed: 285, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 30, eatRadius: 30, length: 135, cost: 6240,
    goldMultiplier: 1.7, magnetRadius: 110, boostEfficiency: 1.3,
    skill: { id: "snapJaw", name: "스냅 조 (원거리 턱 사출)", cooldown: 8, desc: "턱을 투사체처럼 사출해 전방 먼 거리의 먹이를 3배 피해로 물어 끌어옵니다." },
    passive: null,
    colors: ["#be7c8f", "#fce7f3", "#831843"],
    blurb: "심해의 기괴한 턱을 발사해 멀리 있는 먹이를 낚아챕니다.",
  },
  {
    id: "leviathan", tier: 4, branch: "VOID", parentId: "goblin", nextIds: [],
    name: "아비스 레비아탄", nameEn: "Abyss Leviathan",
    maxHealth: 400, baseDrainRate: 6.6, swimSpeed: 300, boostMultiplier: 1.85, boostDuration: 3.3,
    biteForce: 54, eatRadius: 40, length: 200, cost: 22750,
    goldMultiplier: 2.4, magnetRadius: 160, boostEfficiency: 1.5,
    skill: { id: "blackHole", name: "심해의 블랙홀 소용돌이", cooldown: 14, desc: "전방에 4초간 중력 특이점을 열어 반경 안의 먹이를 흡입·포식하고 위험물은 분쇄합니다." },
    passive: null,
    colors: ["#1e1b4b", "#818cf8", "#a855f7"],
    blurb: "중력 특이점을 열어 반경 내 모든 물고기와 잠수함을 빨아들입니다.",
  },
];

export function sharkById(id: string): SharkDef {
  return SHARKS.find((s) => s.id === id) ?? SHARKS[0];
}

/** Root → ... → this shark (inclusive). */
export function evolutionPath(id: string): SharkDef[] {
  const out: SharkDef[] = [];
  let cur = SHARKS.find((s) => s.id === id);
  while (cur) {
    out.unshift(cur);
    const pid = cur.parentId;
    cur = pid ? SHARKS.find((s) => s.id === pid) : undefined;
  }
  return out;
}

export function sharksOfTier(tier: number): SharkDef[] {
  return SHARKS.filter((s) => s.tier === tier);
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
  const tierFactor = 1 + (shark.tier - 1) * 1.6;
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
  goldMultiplier: number;
  magnetRadius: number;
  /** Magnet pull strength multiplier (정전기 유도 passive doubles it). */
  magnetPower: number;
  /** Boost seconds drained per real second (lower = longer boost). */
  boostDrain: number;
  /** Heal multiplier on top of healGain (왕성한 식욕 passive). */
  healMul: number;
}

export function effectiveStats(shark: SharkDef, up: UpgradeLevels): EffectiveStats {
  const p = shark.passive?.id;
  const ballistics = p === "ballistics";
  return {
    maxHealth: shark.maxHealth,
    baseDrainRate: shark.baseDrainRate,
    swimSpeed: shark.swimSpeed * (1 + up.speed * 0.03),
    // 수중 탄도학: the boost's extra speed is 45% bigger.
    boostMultiplier: ballistics ? 1 + (shark.boostMultiplier - 1) * 1.45 : shark.boostMultiplier,
    boostDuration: shark.boostDuration * (1 + up.boost * 0.07),
    boostRegen: 0.5 * (1 + up.boost * 0.05),
    biteForce: shark.biteForce * (1 + up.bite * 0.08),
    biteLevel: up.bite,
    eatRadius: shark.eatRadius,
    length: shark.length,
    goldMultiplier: shark.goldMultiplier,
    magnetRadius: shark.magnetRadius,
    magnetPower: p === "staticField" ? 2 : 1,
    boostDrain: (ballistics ? 0.7 : 1) / shark.boostEfficiency,
    healMul: p === "appetite" ? 1.2 : 1,
  };
}

// ── Gold Rush (spec §1-2) ───────────────────────────────────────────────────

export const GOLD_RUSH_DURATION = 8;
export const MEGA_GOLD_RUSH_DURATION = 10;
export const GOLD_GAUGE_RATE = 0.02;
/** Rushes per mega rush — every 8th rush is a Mega Gold Rush. */
export const MEGA_EVERY = 8;

export function goldGaugeCapacity(tier: SharkTier): number {
  // 30 / 88 / 151 / 215 — higher tiers eat far more per second (magnet,
  // skills), so their gauge grows faster than the old ladder's did.
  return Math.round(30 * Math.pow(1 + ((tier - 1) * 5) / 3, 1.1));
}

/**
 * Coins are doubled during a Gold Rush (×4 in a Mega). The spec asked for ×3,
 * but on top of the ×2.5 base drops it pushed income to ~5× (sim-measured);
 * ×2 lands the overall boost near the intended "2배 이상".
 */
export const GOLD_RUSH_COIN_MULT = 2;

/** ×2 on the first rush, +1 per rush, capped at ×8 (mega is always ×10). */
export function goldRushMultiplier(rushNumber: number, mega: boolean): number {
  if (mega) return 10;
  return Math.min(8, 1 + rushNumber);
}

// ── Combo (addition: fast consecutive eats multiply score) ──────────────────

export const COMBO_WINDOW = 1.5;
export function comboMultiplier(combo: number): number {
  if (combo >= 30) return 3;
  if (combo >= 15) return 2;
  if (combo >= 6) return 1.5;
  return 1;
}

/**
 * Frenzy: consecutive eats (each within COMBO_WINDOW of the last) multiply
 * coin drops ×2 → ×3 → ×4 → max ×5. Steps every few eats rather than per eat
 * so a single fish school doesn't jump straight to ×5. Not applied during a
 * Gold Rush (which already triples coins) — stacking them blew up the economy.
 */
export const FRENZY_STEPS: [number, number][] = [
  [30, 5],
  [20, 4],
  [12, 3],
  [5, 2],
];
export function frenzyMultiplier(combo: number): number {
  for (const [at, m] of FRENZY_STEPS) if (combo >= at) return m;
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
  | "goldenTuna"
  | "iceberg"
  | "iceShard"
  // 얼음 해협 exclusives
  | "penguin" | "seal" | "narwhal" | "orca"
  // 난파선 무덤 exclusives
  | "barracuda" | "moray" | "treasureHunter" | "giantSquid"
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
  smallFish: D({ kind: "smallFish", name: "작은 물고기", requiredTier: 1, heal: 7, score: 20, coins: 3, coinChance: 0.35, radius: 7, speed: 120, toughness: 1, behavior: "boid", damage: 0, damageKind: "contact", depth: [60, 1700], color: "#fbbf24" }),
  crab: D({ kind: "crab", name: "게", requiredTier: 1, heal: 9, score: 35, coins: 3, coinChance: 0.5, radius: 10, speed: 40, toughness: 1, behavior: "crawl", damage: 0, damageKind: "contact", depth: [0, 0], color: "#ef4444" }),
  swimmer: D({ kind: "swimmer", name: "수영객", requiredTier: 1, heal: 15, score: 60, coins: 5, coinChance: 0.6, radius: 11, speed: 45, toughness: 1, behavior: "surfaceSwim", damage: 0, damageKind: "contact", depth: [0, 0], human: true, color: "#fca5a5" }),
  puffer: D({ kind: "puffer", name: "쏠종개", requiredTier: 2, heal: 10, score: 45, coins: 3, coinChance: 0.4, radius: 11, speed: 60, toughness: 1, behavior: "wander", damage: 12, damageKind: "contact", depth: [150, 1500], color: "#a3e635" }),
  greenJelly: D({ kind: "greenJelly", name: "초록 해파리", requiredTier: NEVER, heal: 20, score: 120, coins: 7, coinChance: 1, radius: 14, speed: 18, toughness: 1, behavior: "jelly", damage: 0.05, damageKind: "poison", depth: [80, 1400], color: "#4ade80" }),
  redJelly: D({ kind: "redJelly", name: "붉은 해파리", requiredTier: NEVER, heal: 25, score: 160, coins: 10, coinChance: 1, radius: 17, speed: 16, toughness: 1, behavior: "jelly", damage: 0.06, damageKind: "poison", depth: [700, 2400], color: "#f87171" }),
  mineS: D({ kind: "mineS", name: "소형 기뢰", requiredTier: NEVER, heal: 20, score: 200, coins: 12, coinChance: 1, radius: 13, speed: 0, toughness: 1, behavior: "mine", damage: 40, damageKind: "explode", depth: [120, 900], color: "#475569" }),
  mineM: D({ kind: "mineM", name: "중형 기뢰", requiredTier: NEVER, heal: 25, score: 300, coins: 20, coinChance: 1, radius: 17, speed: 0, toughness: 1, behavior: "mine", damage: 70, damageKind: "explode", depth: [500, 1800], color: "#3f3f46" }),
  mineL: D({ kind: "mineL", name: "대형 기뢰", requiredTier: NEVER, heal: 30, score: 450, coins: 30, coinChance: 1, radius: 22, speed: 0, toughness: 1, behavior: "mine", damage: 110, damageKind: "explode", depth: [1300, 2600], color: "#27272a" }),
  mineXL: D({ kind: "mineXL", name: "초대형 기뢰", requiredTier: NEVER, heal: 40, score: 700, coins: 48, coinChance: 1, radius: 30, speed: 0, toughness: 1, behavior: "mine", damage: 170, damageKind: "explode", depth: [2200, 3100], color: "#18181b" }),
  pelican: D({ kind: "pelican", name: "펠리컨", requiredTier: 2, heal: 24, score: 90, coins: 7, coinChance: 0.7, radius: 13, speed: 110, toughness: 1, behavior: "fly", damage: 0, damageKind: "contact", depth: [-260, -40], color: "#f8fafc" }),
  diver: D({ kind: "diver", name: "다이버", requiredTier: 2, heal: 28, score: 110, coins: 8, coinChance: 0.7, radius: 12, speed: 55, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [120, 900], human: true, color: "#facc15" }),
  grouper: D({ kind: "grouper", name: "중형 어류", requiredTier: 2, heal: 20, score: 70, coins: 5, coinChance: 0.5, radius: 14, speed: 90, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [300, 1900], color: "#60a5fa" }),
  ray: D({ kind: "ray", name: "가오리", requiredTier: 2, heal: 38, score: 160, coins: 9, coinChance: 0.7, radius: 20, speed: 80, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [800, 2400], color: "#94a3b8" }),
  tuna: D({ kind: "tuna", name: "참치", requiredTier: 2, heal: 36, score: 170, coins: 9, coinChance: 0.7, radius: 17, speed: 180, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [200, 1500], color: "#1d4ed8" }),
  sailor: D({ kind: "sailor", name: "어선 선원", requiredTier: 2, heal: 32, score: 150, coins: 12, coinChance: 0.8, radius: 11, speed: 40, toughness: 1, behavior: "surfaceSwim", damage: 0, damageKind: "contact", depth: [0, 0], human: true, color: "#fb923c" }),
  angler: D({ kind: "angler", name: "심해 아귀", requiredTier: 3, heal: 45, score: 380, coins: 19, coinChance: 0.8, radius: 22, speed: 95, toughness: 30, behavior: "hunter", damage: 22, damageKind: "contact", depth: [1800, 3100], color: "#3b0764" }),
  torpedo: D({ kind: "torpedo", name: "어뢰", requiredTier: NEVER, heal: 10, score: 250, coins: 12, coinChance: 1, radius: 9, speed: 260, toughness: 1, behavior: "torpedo", damage: 55, damageKind: "explode", depth: [0, 0], color: "#9ca3af" }),
  fishingBoat: D({ kind: "fishingBoat", name: "낚싯배", requiredTier: 3, heal: 50, score: 500, coins: 47, coinChance: 1, radius: 44, speed: 50, toughness: 60, behavior: "surfaceBoat", damage: 0, damageKind: "contact", depth: [0, 0], color: "#b45309" }),
  passenger: D({ kind: "passenger", name: "크루즈 승객", requiredTier: 3, heal: 30, score: 220, coins: 14, coinChance: 0.9, radius: 11, speed: 35, toughness: 1, behavior: "surfaceSwim", damage: 0, damageKind: "contact", depth: [0, 0], human: true, color: "#c084fc" }),
  smallShark: D({ kind: "smallShark", name: "소형 상어", requiredTier: 3, heal: 55, score: 450, coins: 23, coinChance: 0.9, radius: 24, speed: 195, toughness: 40, behavior: "hunter", damage: 18, damageKind: "contact", depth: [650, 2200], color: "#6b7280" }),
  cageDiver: D({ kind: "cageDiver", name: "케이지 다이버", requiredTier: 3, heal: 60, score: 700, coins: 36, coinChance: 1, radius: 26, speed: 20, toughness: 70, behavior: "wander", damage: 20, damageKind: "contact", depth: [150, 700], human: true, color: "#d4d4d8" }),
  submarine: D({ kind: "submarine", name: "잠수함", requiredTier: 3, heal: 90, score: 1600, coins: 140, coinChance: 1, radius: 58, speed: 60, toughness: 160, behavior: "sub", damage: 0, damageKind: "contact", depth: [900, 2600], color: "#eab308" }),
  ghostShark: D({ kind: "ghostShark", name: "유령 상어", requiredTier: 4, heal: 120, score: 2200, coins: 115, coinChance: 1, radius: 40, speed: 240, toughness: 150, behavior: "hunter", damage: 38, damageKind: "contact", depth: [2000, 3100], color: "#e0f2fe" }),
  yacht: D({ kind: "yacht", name: "보트", requiredTier: 4, heal: 80, score: 1400, coins: 93, coinChance: 1, radius: 56, speed: 70, toughness: 140, behavior: "surfaceBoat", damage: 0, damageKind: "contact", depth: [0, 0], color: "#f8fafc" }),
  helicopter: D({ kind: "helicopter", name: "헬리콥터", requiredTier: 4, heal: 100, score: 3000, coins: 186, coinChance: 1, radius: 40, speed: 90, toughness: 120, behavior: "heli", damage: 0, damageKind: "contact", depth: [-420, -240], color: "#dc2626" }),
  rock: D({ kind: "rock", name: "화산 암석", requiredTier: NEVER, heal: 30, score: 400, coins: 24, coinChance: 1, radius: 16, speed: 0, toughness: 1, behavior: "rock", damage: 30, damageKind: "contact", depth: [2400, 2400], color: "#7c2d12" }),
  goldenTuna: D({ kind: "goldenTuna", name: "황금 참치", requiredTier: 1, heal: 30, score: 300, coins: 150, coinChance: 1, radius: 15, speed: 235, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [200, 2200], color: "#facc15" }),
  iceberg: D({ kind: "iceberg", name: "빙산", requiredTier: NEVER, heal: 60, score: 900, coins: 40, coinChance: 1, radius: 70, speed: 18, toughness: 1, behavior: "surfaceBoat", damage: 0, damageKind: "contact", depth: [0, 0], color: "#e0f2fe" }),
  // Falls from a ceiling icicle above the shark (hangs ~0.9s trembling first) — 얼음 해협's falling-rock.
  iceShard: D({ kind: "iceShard", name: "떨어지는 고드름", requiredTier: NEVER, heal: 20, score: 300, coins: 18, coinChance: 1, radius: 13, speed: 0, toughness: 1, behavior: "rock", damage: 26, damageKind: "contact", depth: [0, 0], color: "#e0f2fe" }),
  // ── 얼음 해협 ──
  penguin: D({ kind: "penguin", name: "펭귄", requiredTier: 1, heal: 10, score: 40, coins: 4, coinChance: 0.45, radius: 9, speed: 135, toughness: 1, behavior: "boid", damage: 0, damageKind: "contact", depth: [110, 700], color: "#1e293b" }),
  seal: D({ kind: "seal", name: "물범", requiredTier: 2, heal: 34, score: 165, coins: 10, coinChance: 0.7, radius: 17, speed: 170, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [120, 1100], color: "#9ca3af" }),
  narwhal: D({ kind: "narwhal", name: "일각고래", requiredTier: 3, heal: 60, score: 520, coins: 26, coinChance: 0.9, radius: 26, speed: 185, toughness: 45, behavior: "hunter", damage: 20, damageKind: "contact", depth: [300, 2000], color: "#cbd5e1" }),
  orca: D({ kind: "orca", name: "범고래", requiredTier: 4, heal: 130, score: 2400, coins: 120, coinChance: 1, radius: 40, speed: 230, toughness: 160, behavior: "hunter", damage: 40, damageKind: "contact", depth: [200, 2800], color: "#0f172a" }),
  // ── 난파선 무덤 ──
  barracuda: D({ kind: "barracuda", name: "꼬치고기", requiredTier: 2, heal: 30, score: 150, coins: 9, coinChance: 0.7, radius: 14, speed: 210, toughness: 1, behavior: "hunter", damage: 10, damageKind: "contact", depth: [200, 1900], color: "#a8a29e" }),
  moray: D({ kind: "moray", name: "곰치", requiredTier: 3, heal: 50, score: 420, coins: 22, coinChance: 0.85, radius: 20, speed: 150, toughness: 35, behavior: "hunter", damage: 20, damageKind: "contact", depth: [600, 3200], color: "#4d7c0f" }),
  treasureHunter: D({ kind: "treasureHunter", name: "보물 사냥꾼", requiredTier: 2, heal: 30, score: 140, coins: 16, coinChance: 0.85, radius: 12, speed: 55, toughness: 1, behavior: "wander", damage: 0, damageKind: "contact", depth: [150, 1700], human: true, color: "#f97316" }),
  giantSquid: D({ kind: "giantSquid", name: "대왕오징어", requiredTier: 4, heal: 140, score: 2600, coins: 130, coinChance: 1, radius: 38, speed: 210, toughness: 170, behavior: "hunter", damage: 42, damageKind: "contact", depth: [1500, 3300], color: "#b91c1c" }),
  chest: D({ kind: "chest", name: "보물 상자", requiredTier: 1, heal: 0, score: 500, coins: 300, coinChance: 1, radius: 18, speed: 0, toughness: 1, behavior: "static", damage: 0, damageKind: "contact", depth: [0, 0], color: "#ca8a04" }),
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

/**
 * Bonus effects when certain prey is eaten (economy overhaul table):
 *   boost  — refill this fraction of the boost tank (small fish school)
 *   heal   — extra heal as a fraction of max HP (mid-size fish)
 *   shield — seconds of damage immunity (ray / small shark ≈ "거북·물개")
 *   gauge  — fill this fraction of the Gold Rush gauge (divers/sailors)
 *   skill  — recharge half of the active skill's cooldown ("메가 바이트 충전")
 *   rush   — trigger a Gold Rush immediately (황금 참치)
 */
export type PreyEffect =
  | { type: "boost"; amount: number }
  | { type: "heal"; amount: number }
  | { type: "shield"; seconds: number }
  | { type: "gauge"; amount: number }
  | { type: "skill" }
  | { type: "rush" };

export const PREY_EFFECTS: Partial<Record<EntityKind, PreyEffect>> = {
  smallFish: { type: "boost", amount: 0.03 },
  puffer: { type: "heal", amount: 0.08 },
  grouper: { type: "heal", amount: 0.08 },
  tuna: { type: "heal", amount: 0.08 },
  ray: { type: "shield", seconds: 2 },
  smallShark: { type: "shield", seconds: 2 },
  diver: { type: "gauge", amount: 0.15 },
  sailor: { type: "gauge", amount: 0.15 },
  cageDiver: { type: "gauge", amount: 0.15 },
  fishingBoat: { type: "skill" },
  submarine: { type: "skill" },
  yacht: { type: "skill" },
  goldenTuna: { type: "rush" },
  penguin: { type: "boost", amount: 0.05 },
  seal: { type: "heal", amount: 0.1 },
  narwhal: { type: "shield", seconds: 2 },
  barracuda: { type: "heal", amount: 0.08 },
  moray: { type: "shield", seconds: 2 },
  treasureHunter: { type: "gauge", amount: 0.2 },
  orca: { type: "skill" },
  giantSquid: { type: "skill" },
};

export function preyEffectLabel(fx: PreyEffect): string {
  switch (fx.type) {
    case "boost": return `부스트 +${Math.round(fx.amount * 100)}%`;
    case "heal": return `체력 +${Math.round(fx.amount * 100)}% 추가 회복`;
    case "shield": return `${fx.seconds}초 실드`;
    case "gauge": return `골드 게이지 +${Math.round(fx.amount * 100)}%`;
    case "skill": return "스킬 쿨타임 50% 충전";
    case "rush": return "즉시 골드 러시!";
  }
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
/** Global "more monsters" factor applied to every kind except the fish schools (2026-10-04: ×1.4). */
export const POPULATION_SCALE = 1.4;

export function populationTargets(tier: SharkTier): Partial<Record<EntityKind, number>> {
  const base: Partial<Record<EntityKind, number>> = {
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
    sailor: tier >= 2 ? 3 : 1,
    angler: 4,
    fishingBoat: 2,
    passenger: tier >= 3 ? 5 : 1,
    smallShark: tier <= 1 ? 2 : 3,
    cageDiver: tier >= 2 ? 2 : 1,
    submarine: tier >= 2 ? 2 : 1,
    ghostShark: 2,
    yacht: tier >= 3 ? 2 : 1,
    helicopter: tier >= 3 ? 2 : 1,
    iceberg: 3,
    seal: 9,
    narwhal: tier <= 1 ? 2 : 3,
    orca: tier <= 2 ? 1 : 2,
    barracuda: tier <= 1 ? 4 : 6,
    moray: 4,
    treasureHunter: 5,
    giantSquid: 2,
  };
  const out: Partial<Record<EntityKind, number>> = {};
  for (const k of Object.keys(base) as EntityKind[]) out[k] = Math.round((base[k] ?? 0) * POPULATION_SCALE);
  // Schools are already dense; only nudged up.
  out.smallFish = 100;
  out.penguin = 80;
  // Rare: the spawner only rolls it in occasionally (see engine runSpawner).
  out.goldenTuna = 1;
  return out;
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
  { id: "eatFish", label: (g) => `물고기 ${g}마리 먹기`, goals: [25, 50, 90], reward: 190 },
  { id: "eatHumans", label: (g) => `사람 ${g}명 먹기`, goals: [3, 6, 10], reward: 250 },
  { id: "reachDepth", label: (g) => `수심 ${g}m 도달`, goals: [80, 160, 260], reward: 225 },
  { id: "survive", label: (g) => `${g}초 생존`, goals: [90, 150, 240], reward: 275 },
  { id: "goldRush", label: (g) => `골드 러시 ${g}회 발동`, goals: [1, 2, 4], reward: 310 },
  { id: "score", label: (g) => `점수 ${g.toLocaleString()}점 달성`, goals: [3000, 8000, 20000], reward: 375 },
  { id: "boatBreaker", label: (g) => `여러 번 물어야 하는 대형 먹잇감 ${g}개 파괴`, goals: [1, 2, 4], reward: 440 },
  { id: "chest", label: (g) => `보물 상자 ${g}개 찾기`, goals: [1, 2, 3], reward: 375 },
  { id: "jump", label: (g) => `수면 위로 ${g}번 점프`, goals: [3, 6, 12], reward: 150 },
];

/** 10 world units = 1 m for the depth readout. */
export const UNITS_PER_METER = 10;
