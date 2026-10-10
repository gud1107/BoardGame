/**
 * Static game data for 배고픈 상어 (Hungry Shark-style ocean survival) —
 * the browser-side equivalent of the spec's `SharkDataSO` / `PreyDataSO` /
 * `UpgradeCurveSO` ScriptableObjects. Everything tunable lives here so the
 * engine (`engine.ts`) stays pure simulation.
 *
 * World units are "pixels at zoom 1". +y points DOWN (canvas convention):
 * the water surface is y = 0, the sky is negative y, the seabed is ~3300.
 */

import { buildGeometry, geoCeil, geoFloor, insideAny, underIce, type Circle, type IceSpec, type MapGeometry, type TerrainSpec } from "./mapGeometry";

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
  /**
   * Gentler for under-tiered sharks: hunters needing ≥2 tiers more than the player's shark spawn
   * `spawn`× as often and notice it from `aggro`× the range (난파선 deep zone vs. T1/T2).
   */
  lowTierMercy?: { spawn: number; aggro: number; near?: { spawn: number; aggro: number } };
  /** Hunter-free bubble around the dive start for the first `seconds` (hunters steer out, none spawn inside). */
  safeStart?: { seconds: number; radius: number };
  /** Per-tier override multiplied on top of coinBonus (얼음 해협 T4 over-earned ~1.8× 딥 블루 in the bot sim). */
  tierCoinBonus?: Partial<Record<SharkTier, number>>;
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
    safeStart: { seconds: 8, radius: 500 },
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
    // Megalodon-class sharks vacuum up the packed shelf: ×0.75 brings T4 from ≈1.8× to ≈1.35× 딥 블루.
    tierCoinBonus: { 4: 0.75 },
    // Same rule as 난파선: 일각고래(T3) eases off for T1, 범고래(T4) for T1/T2.
    // `near` = the milder version for hunters only one tier out of reach (일각고래 vs T2).
    lowTierMercy: { spawn: 0.5, aggro: 0.75, near: { spawn: 0.8, aggro: 0.85 } },
    safeStart: { seconds: 8, radius: 500 },
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
    // Bot sim: T1/T2 deaths here were mostly 대왕오징어 / 유령 상어 / 곰치 / 아귀 in the deep terraces.
    // `near` covers 꼬치고기(T2) vs a T1 reef shark, 곰치/아귀/소형 상어(T3) vs T2.
    lowTierMercy: { spawn: 0.4, aggro: 0.7, near: { spawn: 0.75, aggro: 0.85 } },
    // Prod check: an idle reef shark kept dying to 꼬치고기/소형 상어 within 13~21s of the start.
    safeStart: { seconds: 15, radius: 650 },
    density: 1,
    threatDensity: 0.55,
    spawns: {
      ...COMMON_SPAWNS, tuna: 0.5, smallFish: 1.8,
      barracuda: 1, moray: 1, treasureHunter: 1, giantSquid: 1,
      crab: 2.5, puffer: 1, greenJelly: 1.4,
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

/** Effective coin multiplier of a map for a shark tier. */
export function mapCoinBonus(map: MapDef, tier: number): number {
  return map.coinBonus * (map.tierCoinBonus?.[tier as SharkTier] ?? 1);
}

export function mapById(id: string | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

const geometryCache = new Map<MapId, MapGeometry>();
/** Level geometry of any map (cached) — the rulebook's cross-section uses it without activating the map. */
export function geometryFor(map: MapDef): MapGeometry {
  let g = geometryCache.get(map.id);
  if (!g) {
    g = buildGeometry(map.width, map.terrain, map.ice, map.feature);
    geometryCache.set(map.id, g);
  }
  return g;
}

/**
 * Where a map's treasure chests sit, give or take the ±300 (±30m) jitter each dive adds — the
 * same evenly spaced seabed spots `createWorld` starts from, slid off hulls/pillars the same way.
 */
export function approxChestSpots(map: MapDef): { x: number; y: number }[] {
  const g = geometryFor(map);
  const scratch: Circle[] = [];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < map.chestCount; i++) {
    let x = ((i + 0.5) / map.chestCount) * map.width;
    for (let k = 0; k < 40 && insideAny(g, x, geoFloor(g, x) - 18, 22, scratch); k++) x += 45;
    x = Math.max(80, Math.min(map.width - 80, x));
    out.push({ x, y: geoFloor(g, x) - 18 });
  }
  return out;
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
//   + FROST 빙하 수호자 (그린란드 → 잠꾸러기 → 크라이오돈)
//   + VENOM 맹독 사냥꾼 (황소상어 → 환도상어 → 바실리스크)
//
// Every T2 also splits into a second T3 → T4 line (뱀상어/헬리코프리온,
// 청새리/블레이드, 랜턴/심연 등불, 빙창/오로라, 수염/히드라).
//
// `tier` is also the prey food-chain tier (EntityDef.requiredTier), so every
// branch at the same tier eats the same things — branches differ in stats,
// passives and the active skill (`skill`, cast with Space / ⚡ button).

export type SharkTier = 1 | 2 | 3 | 4;
export type SharkBranch = "BASE" | "BRUTE" | "SPEED" | "VOID" | "FROST" | "VENOM";

export type SkillId =
  | "sprint" | "crush" | "surgeRam" | "titanRoar"
  | "sonicBreak" | "sonar" | "shadowCloak"
  | "emp" | "snapJaw" | "blackHole"
  | "frostNova" | "iceArmor" | "blizzard"
  | "venomSpit" | "tailWhip" | "plague"
  | "frenzyBite" | "sawWhorl" | "slipstream" | "bladeDash"
  | "lure" | "starburst" | "iceSpear" | "auroraVeil"
  | "spineBurst" | "hydraFangs"
  | "bloodScent" | "ironJaw" | "crimsonTide"
  | "zigzagDash" | "tempest" | "afterimage"
  | "leechBite" | "riftPull" | "mindWave"
  | "hailstorm" | "glacialCrash" | "frostCrown"
  | "quillVolley" | "acidPool" | "toxicBloom";

export type PassiveId = "appetite" | "ballistics" | "staticField" | "coldBlood" | "bloodlust";

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
  FROST: { name: "빙하 수호자", short: "빙하 수호", emoji: "🧊", desc: "빙결 · 보호막 · 장기 생존" },
  VENOM: { name: "맹독 사냥꾼", short: "맹독 사냥", emoji: "🧪", desc: "원거리 독 · 광역 · 흡혈" },
};

/** Branch columns in tree order (the reef shark sits above them). */
export const BRANCH_ORDER = ["BRUTE", "SPEED", "VOID", "FROST", "VENOM"] as const;

export const SHARKS: SharkDef[] = [
  {
    id: "reef", tier: 1, branch: "BASE", parentId: null, nextIds: ["sandTiger", "mako", "elecShark", "greenland", "bullShark"],
    name: "암초상어", nameEn: "Reef Shark",
    maxHealth: 100, baseDrainRate: 3.0, swimSpeed: 250, boostMultiplier: 1.9, boostDuration: 2.4,
    biteForce: 10, eatRadius: 18, length: 70, cost: 0,
    goldMultiplier: 1.0, magnetRadius: 40, boostEfficiency: 1.0,
    skill: { id: "sprint", name: "스프린트 대시", cooldown: 6, desc: "0.6초간 2배 속도로 돌진합니다 (부스트 소모 없음)." },
    passive: { id: "appetite", name: "왕성한 식욕", desc: "먹이 섭취 시 체력 회복량 +20%" },
    colors: ["#64748b", "#e2e8f0", "#0f172a"],
    blurb: "작지만 민첩한 연안의 사냥꾼. 2티어부터 다섯 계통 진화 경로 중 하나를 고를 수 있습니다.",
  },
  // ── Branch A: Brute ──
  {
    id: "sandTiger", tier: 2, branch: "BRUTE", parentId: "reef", nextIds: ["white", "tigerShark", "whitetip"],
    name: "샌드타이거 상어", nameEn: "Sand Tiger",
    maxHealth: 180, baseDrainRate: 3.6, swimSpeed: 260, boostMultiplier: 1.85, boostDuration: 2.4,
    biteForce: 18, eatRadius: 28, length: 100, cost: 1560,
    goldMultiplier: 1.3, magnetRadius: 70, boostEfficiency: 0.9,
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
    id: "mako", tier: 2, branch: "SPEED", parentId: "reef", nextIds: ["hammer", "blueShark", "silky"],
    name: "청상아리", nameEn: "Mako Shark",
    maxHealth: 130, baseDrainRate: 3.2, swimSpeed: 305, boostMultiplier: 2.0, boostDuration: 2.6,
    biteForce: 14, eatRadius: 24, length: 86, cost: 1560,
    goldMultiplier: 1.3, magnetRadius: 65, boostEfficiency: 1.6,
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
    id: "elecShark", tier: 2, branch: "VOID", parentId: "reef", nextIds: ["goblin", "lantern", "cookiecutter"],
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
  // ── Branch D: Frost ──
  {
    id: "greenland", tier: 2, branch: "FROST", parentId: "reef", nextIds: ["sleeper", "iceLance", "frostfang"],
    name: "그린란드 상어", nameEn: "Greenland Shark",
    maxHealth: 200, baseDrainRate: 3.4, swimSpeed: 240, boostMultiplier: 1.8, boostDuration: 2.4,
    biteForce: 15, eatRadius: 26, length: 104, cost: 1690,
    goldMultiplier: 1.3, magnetRadius: 70, boostEfficiency: 1.0,
    skill: { id: "frostNova", name: "서리 파동", cooldown: 7, desc: "주변 400 반경을 3초간 얼려 멈추고, 얼어붙은 작은 먹이 최대 4마리를 즉시 포식합니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#475569", "#e0f2fe", "#7dd3fc"],
    blurb: "얼음 바다에서 수백 년을 사는 느림보. 느리지만 굶주림에 강해 오래 버팁니다.",
  },
  {
    id: "sleeper", tier: 3, branch: "FROST", parentId: "greenland", nextIds: ["cryodon"],
    name: "태평양 잠꾸러기상어", nameEn: "Pacific Sleeper",
    maxHealth: 330, baseDrainRate: 4.6, swimSpeed: 270, boostMultiplier: 1.85, boostDuration: 2.8,
    biteForce: 32, eatRadius: 32, length: 145, cost: 6050,
    goldMultiplier: 1.55, magnetRadius: 75, boostEfficiency: 1.1,
    skill: { id: "iceArmor", name: "빙결 갑옷", cooldown: 11, desc: "4초간 얼음 갑옷으로 모든 피해를 막고, 주변 300 반경을 2초간 얼립니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#334155", "#cbd5e1", "#38bdf8"],
    blurb: "두꺼운 피부에 얼음 갑옷을 두르는 심해의 거구. 위험한 바다에서도 버텨 냅니다.",
  },
  {
    id: "cryodon", tier: 4, branch: "FROST", parentId: "sleeper", nextIds: [],
    name: "빙하 군주 크라이오돈", nameEn: "Glacier Cryodon",
    maxHealth: 480, baseDrainRate: 6.6, swimSpeed: 295, boostMultiplier: 1.85, boostDuration: 3.2,
    biteForce: 52, eatRadius: 42, length: 205, cost: 21450,
    goldMultiplier: 2.1, magnetRadius: 110, boostEfficiency: 1.3,
    skill: { id: "blizzard", name: "절대영도 블리자드", cooldown: 14, desc: "5초간 몸 주위에 눈보라 — 반경 520 안 모든 생물이 얼어붙고, 반경 280 안 먹이는 계속 피해를 입습니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#1e3a5f", "#e0f2fe", "#67e8f9"],
    blurb: "빙하기에서 깨어난 전설. 주변 바다를 통째로 얼려 버리는 서리의 정점 포식자.",
  },
  // ── Branch E: Venom ──
  {
    id: "bullShark", tier: 2, branch: "VENOM", parentId: "reef", nextIds: ["thresher", "wobbegong", "spinyDogfish"],
    name: "황소상어", nameEn: "Bull Shark",
    maxHealth: 190, baseDrainRate: 3.5, swimSpeed: 275, boostMultiplier: 1.9, boostDuration: 2.5,
    biteForce: 17, eatRadius: 26, length: 96, cost: 1690,
    goldMultiplier: 1.3, magnetRadius: 85, boostEfficiency: 1.1,
    skill: { id: "venomSpit", name: "독침 사출", cooldown: 6, desc: "전방 부채꼴로 독침 3발을 쏴 먹이를 맞히고(2.5배 피해), 작은 먹이는 바로 삼킵니다." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#57534e", "#f5f5f4", "#84cc16"],
    blurb: "강과 바다를 가리지 않는 공격적인 사냥꾼. 멀리서 독침으로 먹이를 쓰러뜨립니다.",
  },
  {
    id: "thresher", tier: 3, branch: "VENOM", parentId: "bullShark", nextIds: ["basilisk"],
    name: "환도상어", nameEn: "Thresher Shark",
    maxHealth: 240, baseDrainRate: 4.5, swimSpeed: 305, boostMultiplier: 1.95, boostDuration: 2.9,
    biteForce: 30, eatRadius: 28, length: 140, cost: 6050,
    goldMultiplier: 1.6, magnetRadius: 75, boostEfficiency: 1.4,
    skill: { id: "tailWhip", name: "꼬리 채찍", cooldown: 7, desc: "긴 꼬리를 휘둘러 주변 320 반경에 3배 피해 — 작은 먹이는 기절해 삼켜지고, 포식자는 2.5초 기절." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#6d28d9", "#ede9fe", "#a3e635"],
    blurb: "몸길이만 한 꼬리를 채찍처럼 휘둘러 물고기 떼를 한 번에 기절시킵니다.",
  },
  {
    id: "basilisk", tier: 4, branch: "VENOM", parentId: "thresher", nextIds: [],
    name: "역병의 바실리스크", nameEn: "Plague Basilisk",
    maxHealth: 380, baseDrainRate: 6.4, swimSpeed: 320, boostMultiplier: 1.95, boostDuration: 3.3,
    biteForce: 50, eatRadius: 38, length: 190, cost: 21450,
    goldMultiplier: 2.2, magnetRadius: 100, boostEfficiency: 1.6,
    skill: { id: "plague", name: "역병의 숨결", cooldown: 12, desc: "전방 560 거리에 독 숨결 — 범위 안 먹이에 4배 피해, 위험물은 4초 마비. 쓰러뜨린 먹이마다 체력 회복." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#14532d", "#d9f99d", "#a3e635"],
    blurb: "독안개를 내뿜어 앞을 가로막는 모든 것을 녹여 버리는 맹독의 정점 포식자.",
  },
  // ── Second T3 → T4 line of every branch ──
  {
    id: "tigerShark", tier: 3, branch: "BRUTE", parentId: "sandTiger", nextIds: ["helicoprion"],
    name: "뱀상어", nameEn: "Tiger Shark",
    maxHealth: 280, baseDrainRate: 4.9, swimSpeed: 285, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 34, eatRadius: 34, length: 145, cost: 5850,
    goldMultiplier: 1.5, magnetRadius: 80, boostEfficiency: 1.1,
    skill: { id: "frenzyBite", name: "광란의 연속 물기", cooldown: 7, desc: "입 주변 300 반경의 먹이를 최대 5마리까지 연달아 물어뜯습니다(2배 피해). 물 때마다 체력 회복." },
    passive: { id: "appetite", name: "왕성한 식욕", desc: "먹이 섭취 시 체력 회복량 +20%" },
    colors: ["#78716c", "#fafaf9", "#292524"],
    blurb: "무엇이든 먹어 치우는 바다의 쓰레기통. 한 번 물면 주변 먹이를 연달아 삼킵니다.",
  },
  {
    id: "helicoprion", tier: 4, branch: "BRUTE", parentId: "tigerShark", nextIds: [],
    name: "헬리코프리온", nameEn: "Helicoprion",
    maxHealth: 440, baseDrainRate: 6.8, swimSpeed: 305, boostMultiplier: 1.85, boostDuration: 3.2,
    biteForce: 58, eatRadius: 44, length: 210, cost: 20800,
    goldMultiplier: 2.0, magnetRadius: 110, boostEfficiency: 1.4,
    skill: { id: "sawWhorl", name: "회전 톱날 턱", cooldown: 12, desc: "나선형 톱니 턱을 회전시켜 주변 380 반경에 3.5배 피해, 2초간 무적." },
    passive: null,
    colors: ["#57534e", "#e7e5e4", "#b45309"],
    blurb: "나선형 톱날 이빨을 가진 고생대의 괴물. 주변을 통째로 갈아 버립니다.",
  },
  {
    id: "blueShark", tier: 3, branch: "SPEED", parentId: "mako", nextIds: ["bladeShark"],
    name: "청새리상어", nameEn: "Blue Shark",
    maxHealth: 200, baseDrainRate: 4.3, swimSpeed: 330, boostMultiplier: 2.0, boostDuration: 3.0,
    biteForce: 26, eatRadius: 28, length: 125, cost: 5850,
    goldMultiplier: 1.6, magnetRadius: 75, boostEfficiency: 2.0,
    skill: { id: "slipstream", name: "슬립스트림", cooldown: 8, desc: "부스트를 가득 채우고 1.5초간 1.9배 속도로 해류를 탑니다. 지나가는 길의 작은 먹이는 빨려 들어옵니다." },
    passive: { id: "ballistics", name: "수중 탄도학", desc: "부스트 속도 +45%, 부스트 소모량 −30%" },
    colors: ["#1d4ed8", "#e0f2fe", "#38bdf8"],
    blurb: "대양을 가로지르는 장거리 여행자. 해류를 타고 끝없이 달립니다.",
  },
  {
    id: "bladeShark", tier: 4, branch: "SPEED", parentId: "blueShark", nextIds: [],
    name: "썬더 블레이드", nameEn: "Thunder Blade",
    maxHealth: 320, baseDrainRate: 5.9, swimSpeed: 355, boostMultiplier: 2.05, boostDuration: 3.6,
    biteForce: 46, eatRadius: 36, length: 175, cost: 20800,
    goldMultiplier: 2.2, magnetRadius: 90, boostEfficiency: 2.6,
    skill: { id: "bladeDash", name: "칼날 질주", cooldown: 9, desc: "무적 상태로 2.6배 속도 돌진 — 앞쪽 일직선 560 거리의 먹이를 베어 3배 피해, 위험물은 기절." },
    passive: null,
    colors: ["#0f172a", "#e2e8f0", "#facc15"],
    blurb: "번개처럼 바다를 가르는 칼날 지느러미. 지나간 자리에 먹이만 남습니다.",
  },
  {
    id: "lantern", tier: 3, branch: "VOID", parentId: "elecShark", nextIds: ["abyssLantern"],
    name: "랜턴상어", nameEn: "Lanternshark",
    maxHealth: 230, baseDrainRate: 4.5, swimSpeed: 285, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 28, eatRadius: 30, length: 130, cost: 6240,
    goldMultiplier: 1.7, magnetRadius: 120, boostEfficiency: 1.3,
    skill: { id: "lure", name: "발광 유인", cooldown: 8, desc: "몸의 빛으로 600 반경의 먹이를 입 앞으로 끌어당기고 1.5초간 홀립니다." },
    passive: { id: "staticField", name: "정전기 유도", desc: "주변 작은 먹이가 자석처럼 입으로 2배 강하게 빨려 들어옵니다." },
    colors: ["#1e293b", "#94a3b8", "#4ade80"],
    blurb: "배에서 빛을 내는 심해의 작은 등불. 빛에 홀린 먹이가 스스로 다가옵니다.",
  },
  {
    id: "abyssLantern", tier: 4, branch: "VOID", parentId: "lantern", nextIds: [],
    name: "심연의 등불 군주", nameEn: "Abyssal Lantern Lord",
    maxHealth: 390, baseDrainRate: 6.5, swimSpeed: 300, boostMultiplier: 1.85, boostDuration: 3.3,
    biteForce: 52, eatRadius: 40, length: 200, cost: 22750,
    goldMultiplier: 2.4, magnetRadius: 160, boostEfficiency: 1.5,
    skill: { id: "starburst", name: "심해 별빛 폭발", cooldown: 13, desc: "눈부신 빛으로 700 반경 모든 생물을 2.5초 기절시키고, 450 반경의 작은 먹이 최대 10마리를 즉시 포식." },
    passive: null,
    colors: ["#020617", "#64748b", "#86efac"],
    blurb: "심연 전체를 밝히는 빛의 군주. 빛 한 번에 먹이 떼가 사라집니다.",
  },
  {
    id: "iceLance", tier: 3, branch: "FROST", parentId: "greenland", nextIds: ["aurora"],
    name: "빙창 상어", nameEn: "Ice Lance Shark",
    maxHealth: 290, baseDrainRate: 4.5, swimSpeed: 285, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 34, eatRadius: 30, length: 140, cost: 6050,
    goldMultiplier: 1.55, magnetRadius: 70, boostEfficiency: 1.2,
    skill: { id: "iceSpear", name: "빙창 투척", cooldown: 7, desc: "전방 700 거리로 관통하는 얼음 창 — 맞은 먹이는 3배 피해, 위험물은 3초간 얼어붙습니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#64748b", "#f0f9ff", "#bae6fd"],
    blurb: "주둥이 끝에 얼음 창을 기르는 북극 상어. 멀리서 꿰뚫어 사냥합니다.",
  },
  {
    id: "aurora", tier: 4, branch: "FROST", parentId: "iceLance", nextIds: [],
    name: "오로라 리바이어던", nameEn: "Aurora Leviathan",
    maxHealth: 460, baseDrainRate: 6.4, swimSpeed: 300, boostMultiplier: 1.85, boostDuration: 3.3,
    biteForce: 50, eatRadius: 42, length: 205, cost: 21450,
    goldMultiplier: 2.1, magnetRadius: 120, boostEfficiency: 1.4,
    skill: { id: "auroraVeil", name: "오로라 장막", cooldown: 13, desc: "3초간 무적 장막 + 체력 25% 회복, 주변 450 반경을 3초간 얼립니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#134e4a", "#ccfbf1", "#c084fc"],
    blurb: "극지의 하늘빛을 두른 신비한 거구. 오로라 장막 안에서는 무엇도 닿지 않습니다.",
  },
  {
    id: "wobbegong", tier: 3, branch: "VENOM", parentId: "bullShark", nextIds: ["hydra"],
    name: "수염상어", nameEn: "Wobbegong",
    maxHealth: 270, baseDrainRate: 4.4, swimSpeed: 280, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 30, eatRadius: 32, length: 135, cost: 6050,
    goldMultiplier: 1.6, magnetRadius: 80, boostEfficiency: 1.2,
    skill: { id: "spineBurst", name: "독가시 폭발", cooldown: 7, desc: "몸의 독가시를 사방으로 터뜨려 300 반경에 2.5배 피해, 위험물은 3초 마비." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#854d0e", "#fef3c7", "#65a30d"],
    blurb: "해초처럼 위장해 숨어 있다가 독가시로 주변을 덮치는 매복의 달인.",
  },
  {
    id: "hydra", tier: 4, branch: "VENOM", parentId: "wobbegong", nextIds: [],
    name: "히드라 상어", nameEn: "Hydra Shark",
    maxHealth: 400, baseDrainRate: 6.4, swimSpeed: 310, boostMultiplier: 1.95, boostDuration: 3.3,
    biteForce: 50, eatRadius: 38, length: 195, cost: 21450,
    goldMultiplier: 2.2, magnetRadius: 100, boostEfficiency: 1.6,
    skill: { id: "hydraFangs", name: "세 머리 독니", cooldown: 9, desc: "세 방향으로 독니를 사출해 각각 먼 거리의 먹이를 3배 피해로 물어 끌어옵니다. 쓰러뜨린 먹이마다 체력 회복." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#3f6212", "#ecfccb", "#facc15"],
    blurb: "베어도 다시 자라는 세 개의 독니. 한 번에 세 마리를 낚아챕니다.",
  },
  // ── Third T3 line of every branch — its T3 forks into two T4s ──
  {
    id: "whitetip", tier: 3, branch: "BRUTE", parentId: "sandTiger", nextIds: ["dunkleosteus", "crimsonTyrant"],
    name: "장완흉상어", nameEn: "Oceanic Whitetip",
    maxHealth: 270, baseDrainRate: 4.8, swimSpeed: 295, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 33, eatRadius: 32, length: 140, cost: 5850,
    goldMultiplier: 1.5, magnetRadius: 75, boostEfficiency: 1.2,
    skill: { id: "bloodScent", name: "피 냄새 추적", cooldown: 8, desc: "1.2초간 1.6배 속도로 돌진하고, 5초간 보물 상자·황금 참치·대어의 위치를 감지합니다. 주변 450 반경 먹이는 1초 기절." },
    passive: { id: "appetite", name: "왕성한 식욕", desc: "먹이 섭취 시 체력 회복량 +20%" },
    colors: ["#6b7280", "#f9fafb", "#f8fafc"],
    blurb: "하얀 지느러미 끝을 가진 외양의 방랑자. 수 킬로미터 밖의 피 냄새도 놓치지 않습니다.",
  },
  {
    id: "dunkleosteus", tier: 4, branch: "BRUTE", parentId: "whitetip", nextIds: [],
    name: "둔클레오스테우스", nameEn: "Dunkleosteus",
    maxHealth: 480, baseDrainRate: 7.0, swimSpeed: 295, boostMultiplier: 1.8, boostDuration: 3.0,
    biteForce: 62, eatRadius: 44, length: 210, cost: 20800,
    goldMultiplier: 2.0, magnetRadius: 100, boostEfficiency: 1.3,
    skill: { id: "ironJaw", name: "강철 턱 분쇄", cooldown: 11, desc: "3초간 갑주로 모든 피해를 막고, 전방 340 거리 부채꼴에 5배 피해 — 위험물은 3초 기절." },
    passive: null,
    colors: ["#44403c", "#d6d3d1", "#a8a29e"],
    blurb: "뼈 갑옷을 두른 데본기의 폭군. 칼날 같은 턱뼈로 무엇이든 두 동강 냅니다.",
  },
  {
    id: "crimsonTyrant", tier: 4, branch: "BRUTE", parentId: "whitetip", nextIds: [],
    name: "진홍의 폭군", nameEn: "Crimson Tyrant",
    maxHealth: 450, baseDrainRate: 6.9, swimSpeed: 310, boostMultiplier: 1.85, boostDuration: 3.2,
    biteForce: 58, eatRadius: 42, length: 205, cost: 20800,
    goldMultiplier: 2.0, magnetRadius: 110, boostEfficiency: 1.4,
    skill: { id: "crimsonTide", name: "진홍 해일", cooldown: 13, desc: "피의 해일을 일으켜 주변 440 반경 먹이에 3배 피해, 위험물은 2.5초 기절. 쓰러뜨린 먹이마다 체력 6% 회복." },
    passive: { id: "appetite", name: "왕성한 식욕", desc: "먹이 섭취 시 체력 회복량 +20%" },
    colors: ["#7f1d1d", "#fecaca", "#ef4444"],
    blurb: "피로 물든 바다를 지배하는 광포한 군주. 사냥할수록 더 강해집니다.",
  },
  {
    id: "silky", tier: 3, branch: "SPEED", parentId: "mako", nextIds: ["stormRider", "mirage"],
    name: "미흑점상어", nameEn: "Silky Shark",
    maxHealth: 210, baseDrainRate: 4.3, swimSpeed: 325, boostMultiplier: 2.0, boostDuration: 3.0,
    biteForce: 27, eatRadius: 28, length: 122, cost: 5850,
    goldMultiplier: 1.6, magnetRadius: 75, boostEfficiency: 1.9,
    skill: { id: "zigzagDash", name: "지그재그 연격", cooldown: 7, desc: "1초간 1.8배 속도로 질주하며 전방 세 방향으로 400 거리를 베어 2배 피해, 위험물은 1.5초 기절." },
    passive: { id: "ballistics", name: "수중 탄도학", desc: "부스트 속도 +45%, 부스트 소모량 −30%" },
    colors: ["#475569", "#e2e8f0", "#a5b4fc"],
    blurb: "비단처럼 매끄러운 피부의 외양 질주자. 물고기 떼 사이를 지그재그로 가릅니다.",
  },
  {
    id: "stormRider", tier: 4, branch: "SPEED", parentId: "silky", nextIds: [],
    name: "폭풍 질주자", nameEn: "Storm Rider",
    maxHealth: 330, baseDrainRate: 5.9, swimSpeed: 350, boostMultiplier: 2.05, boostDuration: 3.6,
    biteForce: 47, eatRadius: 36, length: 175, cost: 20800,
    goldMultiplier: 2.2, magnetRadius: 90, boostEfficiency: 2.5,
    skill: { id: "tempest", name: "폭풍 회오리", cooldown: 10, desc: "주변 300 반경에 회오리 충격(2.5배 피해) 후 1.2초간 무적 + 2.2배 속도로 폭풍처럼 돌진합니다." },
    passive: null,
    colors: ["#1e3a8a", "#dbeafe", "#38bdf8"],
    blurb: "태풍의 눈에서 태어난 상어. 지나간 자리에 소용돌이만 남습니다.",
  },
  {
    id: "mirage", tier: 4, branch: "SPEED", parentId: "silky", nextIds: [],
    name: "신기루 상어", nameEn: "Mirage Shark",
    maxHealth: 320, baseDrainRate: 5.8, swimSpeed: 345, boostMultiplier: 2.05, boostDuration: 3.6,
    biteForce: 46, eatRadius: 36, length: 172, cost: 20800,
    goldMultiplier: 2.2, magnetRadius: 95, boostEfficiency: 2.5,
    skill: { id: "afterimage", name: "잔상 분신", cooldown: 12, desc: "2.5초간 잔상을 남기며 무적 + 1.5배 속도, 4초간 보물·대어 위치 감지. 출발 지점 220 반경의 생물은 잔상에 홀려 2초 기절." },
    passive: null,
    colors: ["#701a75", "#fae8ff", "#f0abfc"],
    blurb: "아지랑이처럼 일렁이는 몸. 눈에 보이는 건 이미 지나간 잔상뿐입니다.",
  },
  {
    id: "cookiecutter", tier: 3, branch: "VOID", parentId: "elecShark", nextIds: ["voidMaw", "psyShark"],
    name: "쿠키커터상어", nameEn: "Cookiecutter Shark",
    maxHealth: 240, baseDrainRate: 4.5, swimSpeed: 290, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 30, eatRadius: 30, length: 128, cost: 6240,
    goldMultiplier: 1.7, magnetRadius: 110, boostEfficiency: 1.3,
    skill: { id: "leechBite", name: "흡착 물기", cooldown: 8, desc: "450 반경에서 가장 큰 먹잇감에 달라붙어 4배 피해를 주고 체력 8%를 흡수합니다." },
    passive: { id: "staticField", name: "정전기 유도", desc: "주변 작은 먹이가 자석처럼 입으로 2배 강하게 빨려 들어옵니다." },
    colors: ["#3f3f46", "#a1a1aa", "#2dd4bf"],
    blurb: "자기보다 큰 사냥감에 달라붙어 쿠키처럼 동그랗게 살점을 도려내는 심해의 기생자.",
  },
  {
    id: "voidMaw", tier: 4, branch: "VOID", parentId: "cookiecutter", nextIds: [],
    name: "공허의 아가리", nameEn: "Void Maw",
    maxHealth: 400, baseDrainRate: 6.6, swimSpeed: 300, boostMultiplier: 1.85, boostDuration: 3.3,
    biteForce: 54, eatRadius: 42, length: 200, cost: 22750,
    goldMultiplier: 2.4, magnetRadius: 160, boostEfficiency: 1.5,
    skill: { id: "riftPull", name: "차원 균열", cooldown: 15, desc: "입 앞에 균열을 열어 480 반경의 먹이를 끌어당긴 뒤, 균열을 닫아 220 반경에 2.2배 피해를 줍니다." },
    passive: null,
    colors: ["#0f0a1e", "#6d28d9", "#22d3ee"],
    blurb: "입속이 다른 차원으로 이어진 존재. 균열 너머로 먹이 떼를 통째로 삼킵니다.",
  },
  {
    id: "psyShark", tier: 4, branch: "VOID", parentId: "cookiecutter", nextIds: [],
    name: "사이킥 오버로드", nameEn: "Psychic Overlord",
    maxHealth: 390, baseDrainRate: 6.5, swimSpeed: 305, boostMultiplier: 1.85, boostDuration: 3.3,
    biteForce: 52, eatRadius: 40, length: 195, cost: 22750,
    goldMultiplier: 2.3, magnetRadius: 150, boostEfficiency: 1.5,
    skill: { id: "mindWave", name: "정신 파동", cooldown: 14, desc: "정신 파동으로 800 반경 모든 생물을 3.5초 마비시키고, 320 반경 먹이에 2.5배 피해를 줍니다." },
    passive: { id: "staticField", name: "정전기 유도", desc: "주변 작은 먹이가 자석처럼 입으로 2배 강하게 빨려 들어옵니다." },
    colors: ["#4c1d95", "#ddd6fe", "#f472b6"],
    blurb: "부풀어 오른 머리에 깃든 초능력. 생각만으로 바다 전체를 멈춰 세웁니다.",
  },
  {
    id: "frostfang", tier: 3, branch: "FROST", parentId: "greenland", nextIds: ["glacierTitan", "snowQueen"],
    name: "서리송곳니 상어", nameEn: "Frostfang Shark",
    maxHealth: 300, baseDrainRate: 4.5, swimSpeed: 280, boostMultiplier: 1.9, boostDuration: 2.8,
    biteForce: 33, eatRadius: 31, length: 142, cost: 6050,
    goldMultiplier: 1.55, magnetRadius: 72, boostEfficiency: 1.15,
    skill: { id: "hailstorm", name: "우박 세례", cooldown: 8, desc: "전방 부채꼴로 우박 5발을 쏘아 420 거리의 먹이에 1.8배 피해, 위험물은 2초간 얼립니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#334155", "#f1f5f9", "#a5f3fc"],
    blurb: "입 밖으로 삐져나온 얼음 송곳니. 숨을 내쉴 때마다 우박이 쏟아집니다.",
  },
  {
    id: "glacierTitan", tier: 4, branch: "FROST", parentId: "frostfang", nextIds: [],
    name: "빙산 타이탄", nameEn: "Glacier Titan",
    maxHealth: 500, baseDrainRate: 6.7, swimSpeed: 285, boostMultiplier: 1.8, boostDuration: 3.0,
    biteForce: 54, eatRadius: 44, length: 215, cost: 21450,
    goldMultiplier: 2.1, magnetRadius: 110, boostEfficiency: 1.3,
    skill: { id: "glacialCrash", name: "빙하 붕괴", cooldown: 14, desc: "빙하를 무너뜨려 주변 420 반경에 3.5배 피해, 위험물은 3초간 얼어붙습니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#1e293b", "#e0f2fe", "#93c5fd"],
    blurb: "등에 빙산을 짊어진 거대한 수호자. 몸을 뒤틀면 빙하가 통째로 무너집니다.",
  },
  {
    id: "snowQueen", tier: 4, branch: "FROST", parentId: "frostfang", nextIds: [],
    name: "눈의 여왕", nameEn: "Snow Queen",
    maxHealth: 440, baseDrainRate: 6.3, swimSpeed: 305, boostMultiplier: 1.85, boostDuration: 3.3,
    biteForce: 50, eatRadius: 40, length: 198, cost: 21450,
    goldMultiplier: 2.1, magnetRadius: 125, boostEfficiency: 1.4,
    skill: { id: "frostCrown", name: "서리 왕관", cooldown: 13, desc: "2초간 무적 + 주변 480 반경을 3초간 얼리고, 얼어붙은 작은 먹이 최대 8마리를 즉시 포식합니다." },
    passive: { id: "coldBlood", name: "냉혈 대사", desc: "배고픔(체력 감소) 속도 −20%" },
    colors: ["#94a3b8", "#ffffff", "#7dd3fc"],
    blurb: "눈송이 왕관을 쓴 백색의 여제. 그녀가 지나간 바다는 영원히 얼어붙습니다.",
  },
  {
    id: "spinyDogfish", tier: 3, branch: "VENOM", parentId: "bullShark", nextIds: ["chimera", "nightshade"],
    name: "곱상어", nameEn: "Spiny Dogfish",
    maxHealth: 250, baseDrainRate: 4.4, swimSpeed: 300, boostMultiplier: 1.95, boostDuration: 2.9,
    biteForce: 29, eatRadius: 29, length: 132, cost: 6050,
    goldMultiplier: 1.6, magnetRadius: 78, boostEfficiency: 1.3,
    skill: { id: "quillVolley", name: "가시 연사", cooldown: 7, desc: "전방 부채꼴로 독가시 5발을 연사해 먹이에 2배 피해를 주고, 작은 먹이는 바로 삼킵니다." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#57534e", "#e7e5e4", "#bef264"],
    blurb: "등지느러미마다 독가시를 숨긴 작은 사냥꾼. 떼로 몰려와 가시를 퍼붓습니다.",
  },
  {
    id: "chimera", tier: 4, branch: "VENOM", parentId: "spinyDogfish", nextIds: [],
    name: "키메라 상어", nameEn: "Chimera Shark",
    maxHealth: 400, baseDrainRate: 6.4, swimSpeed: 315, boostMultiplier: 1.95, boostDuration: 3.3,
    biteForce: 50, eatRadius: 38, length: 192, cost: 21450,
    goldMultiplier: 2.2, magnetRadius: 100, boostEfficiency: 1.6,
    skill: { id: "acidPool", name: "산성 웅덩이", cooldown: 11, desc: "입 앞 220 거리에 산성액을 쏟아 340 반경 먹이에 3배 피해, 위험물은 3초 마비. 쓰러뜨린 먹이마다 체력 회복." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#365314", "#ecfccb", "#facc15"],
    blurb: "여러 생물을 이어 붙인 듯한 기묘한 몸. 입에서는 바위도 녹이는 산이 흐릅니다.",
  },
  {
    id: "nightshade", tier: 4, branch: "VENOM", parentId: "spinyDogfish", nextIds: [],
    name: "나이트셰이드", nameEn: "Nightshade",
    maxHealth: 380, baseDrainRate: 6.3, swimSpeed: 320, boostMultiplier: 1.95, boostDuration: 3.3,
    biteForce: 48, eatRadius: 38, length: 188, cost: 21450,
    goldMultiplier: 2.2, magnetRadius: 105, boostEfficiency: 1.6,
    skill: { id: "toxicBloom", name: "독꽃 개화", cooldown: 12, desc: "몸 주위에 독꽃을 피워 460 반경 먹이에 2.5배 피해, 위험물은 3.5초 마비. 쓰러뜨린 먹이마다 체력 회복." },
    passive: { id: "bloodlust", name: "흡혈 본능", desc: "먹이 섭취 시 체력 회복량 +30%" },
    colors: ["#3b0764", "#f3e8ff", "#a3e635"],
    blurb: "밤에만 피는 독꽃을 몸에 두른 상어. 그 향기를 맡은 먹이는 다시 깨어나지 못합니다.",
  },
];

export function sharkById(id: string): SharkDef {
  return SHARKS.find((s) => s.id === id) ?? SHARKS[0];
}

/** Depth-first ids from the reef shark — each sub-line's T3 → T4 stay together. */
export const TREE_ORDER: string[] = (() => {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const n of sharkById(id).nextIds) walk(n);
  };
  walk(SHARKS[0].id);
  return out;
})();

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

/**
 * Bot-sim per-dive income (coins + mission rewards, ×1000) — 2026-10-08, 4 seeds × 3 maps, upgrades 3/3/3.
 * Drives the 🎯 추천 진화 pick; re-run the sim and update these after any balance change.
 */
export const SIM_DIVE_INCOME: Record<string, number> = {
  reef: 0,
  sandTiger: 9.3, mako: 7.9, elecShark: 10.4, greenland: 8.2, bullShark: 7.7,
  white: 20.5, tigerShark: 24.5, whitetip: 13.7,
  hammer: 12.8, blueShark: 14.3, silky: 13.1,
  goblin: 20.3, lantern: 19.5, cookiecutter: 25.3,
  sleeper: 15.4, iceLance: 12.8, frostfang: 19.0,
  thresher: 23.2, wobbegong: 22.6, spinyDogfish: 13.0,
  megalodon: 58.7, helicoprion: 51.3, dunkleosteus: 42.9, crimsonTyrant: 52.3,
  phantom: 34.7, bladeShark: 38.5, stormRider: 38.9, mirage: 35.9,
  leviathan: 60.9, abyssLantern: 57.8, voidMaw: 55.6, psyShark: 62.5,
  cryodon: 59.0, aurora: 39.5, glacierTitan: 50.6, snowQueen: 38.4,
  basilisk: 47.1, hydra: 45.9, chimera: 54.3, nightshade: 49.3,
};

/** Sharks ranked by bot-sim per-dive income, strongest first (reef has no sim value and is left out). */
export const SHARK_POWER_RANK: string[] = Object.keys(SIM_DIVE_INCOME)
  .filter((id) => SIM_DIVE_INCOME[id] > 0)
  .sort((a, b) => SIM_DIVE_INCOME[b] - SIM_DIVE_INCOME[a]);

/** 👑 최강: the single best shark overall. */
export const STRONGEST_SHARK_ID = SHARK_POWER_RANK[0];

/** ⭐ best shark of each tier (T2~T4) by sim income. */
export const TIER_BEST_IDS: Set<string> = new Set(
  [2, 3, 4].map((tier) => SHARK_POWER_RANK.find((id) => sharkById(id).tier === tier)).filter((id): id is string => !!id),
);

/** 1-based overall power rank, or 0 when the shark has no sim value. */
export function sharkPowerRank(id: string): number {
  return SHARK_POWER_RANK.indexOf(id) + 1;
}

/** Value of evolving into `id`: its own income plus the best line after it (near-term and endgame both count). */
function pathValue(id: string): number {
  const s = sharkById(id);
  return (SIM_DIVE_INCOME[id] ?? 0) + Math.max(0, ...s.nextIds.map(pathValue));
}

/** The best next evolution from `id` (null at an apex). */
export function recommendedEvolution(id: string): SharkDef | null {
  const next = sharkById(id).nextIds;
  if (next.length === 0) return null;
  return sharkById(next.reduce((best, n) => (pathValue(n) > pathValue(best) ? n : best)));
}

/** The recommended route from `id` down to an apex (excluding `id`). */
export function recommendedPath(id: string): SharkDef[] {
  const out: SharkDef[] = [];
  for (let n = recommendedEvolution(id); n; n = recommendedEvolution(n.id)) out.push(n);
  return out;
}

/**
 * Sharks to highlight as 🎯 추천 진화: for every owned shark at the tip of its line (no owned
 * evolution yet), its recommended next step.
 */
export function evolutionFrontier(owned: string[]): Set<string> {
  const have = new Set(owned);
  const out = new Set<string>();
  for (const id of owned) {
    const s = sharkById(id);
    if (s.nextIds.some((n) => have.has(n))) continue;
    const r = recommendedEvolution(id);
    if (r && !have.has(r.id)) out.add(r.id);
  }
  return out;
}

export interface UpgradeLevels {
  bite: number;
  speed: number;
  boost: number;
  /** 🌟 각성 stage (T4 only, 0~MAX_AWAKEN; older saves lack it → 0). */
  awaken?: number;
}

// ── 🌟 각성 (post-apex progression for T4 sharks) ─────────────────────────────

export interface AwakenStage {
  name: string;
  cost: number;
  desc: string;
  /** Aura color in the dive + the stage chip in the shop. */
  color: string;
}

/** Five stages bought one by one on a T4 shark; each adds the effect in `desc` (cumulative). */
export const AWAKEN_STAGES: AwakenStage[] = [
  { name: "깨어남", cost: 30000, desc: "최대 체력 +10%", color: "#7dd3fc" },
  { name: "황금 본능", cost: 50000, desc: "골드 획득 +10%", color: "#fde047" },
  { name: "스킬 해방", cost: 80000, desc: "스킬 쿨타임 -15%", color: "#c4b5fd" },
  { name: "불굴의 심장", cost: 120000, desc: "최대 체력 +10% · 허기 -10%", color: "#fb7185" },
  { name: "심해의 왕", cost: 170000, desc: "골드 +15% · 몸집 +8% · 자석 범위 +30%", color: "#f0abfc" },
];
export const MAX_AWAKEN = AWAKEN_STAGES.length;

export function canAwaken(shark: SharkDef): boolean {
  return shark.tier === 4;
}

/** Cumulative multipliers for an awaken stage (0 = none). */
export function awakenBonus(level: number) {
  const l = Math.max(0, Math.min(MAX_AWAKEN, Math.floor(level || 0)));
  return {
    level: l,
    health: 1 + (l >= 1 ? 0.1 : 0) + (l >= 4 ? 0.1 : 0),
    gold: 1 + (l >= 2 ? 0.1 : 0) + (l >= 5 ? 0.15 : 0),
    cooldown: l >= 3 ? 0.85 : 1,
    drain: l >= 4 ? 0.9 : 1,
    size: l >= 5 ? 1.08 : 1,
    magnet: l >= 5 ? 1.3 : 1,
  };
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
  /** Seconds between skill casts (각성 Ⅲ shortens it). */
  skillCooldown: number;
  /** 🌟 각성 stage in effect (0 = none) — drives the aura. */
  awaken: number;
}

export function effectiveStats(shark: SharkDef, up: UpgradeLevels): EffectiveStats {
  const p = shark.passive?.id;
  const ballistics = p === "ballistics";
  const aw = awakenBonus(canAwaken(shark) ? (up.awaken ?? 0) : 0);
  return {
    maxHealth: Math.round(shark.maxHealth * aw.health),
    swimSpeed: shark.swimSpeed * (1 + up.speed * 0.03),
    // 수중 탄도학: the boost's extra speed is 45% bigger.
    boostMultiplier: ballistics ? 1 + (shark.boostMultiplier - 1) * 1.45 : shark.boostMultiplier,
    boostDuration: shark.boostDuration * (1 + up.boost * 0.07),
    boostRegen: 0.5 * (1 + up.boost * 0.05),
    biteForce: shark.biteForce * (1 + up.bite * 0.08),
    biteLevel: up.bite,
    eatRadius: shark.eatRadius,
    length: shark.length * aw.size,
    goldMultiplier: shark.goldMultiplier * aw.gold,
    magnetRadius: shark.magnetRadius * aw.magnet,
    // 냉혈 대사: hunger drains 20% slower.
    baseDrainRate: shark.baseDrainRate * (p === "coldBlood" ? 0.8 : 1) * aw.drain,
    magnetPower: p === "staticField" ? 2 : 1,
    boostDrain: (ballistics ? 0.7 : 1) / shark.boostEfficiency,
    healMul: p === "appetite" ? 1.2 : p === "bloodlust" ? 1.3 : 1,
    skillCooldown: shark.skill.cooldown * aw.cooldown,
    awaken: aw.level,
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
  | "mastDebris"
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
  // Snaps off a sunken mast's yard arm above the shark (creaks ~1s first) — 난파선 무덤's falling hazard.
  mastDebris: D({ kind: "mastDebris", name: "무너지는 돛대 파편", requiredTier: NEVER, heal: 25, score: 350, coins: 20, coinChance: 1, radius: 20, speed: 0, toughness: 1, behavior: "rock", damage: 34, damageKind: "contact", depth: [0, 0], color: "#78350f" }),
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

/** Clearing every mission of a dive pays this share of their rewards on top (2026-10-04). */
export const ALL_MISSIONS_BONUS_RATE = 0.5;
/** Each previous consecutive all-clear dive adds this much to the rate… */
export const MISSION_STREAK_STEP = 0.1;
/** …counting at most this many (0.5 + 5 × 0.1 = 100%). */
export const MISSION_STREAK_CAP = 5;

/** All-clear bonus rate for a dive started with `streak` consecutive all-clears behind it. */
export function allMissionsBonusRate(streak: number): number {
  return ALL_MISSIONS_BONUS_RATE + MISSION_STREAK_STEP * Math.max(0, Math.min(MISSION_STREAK_CAP, Math.floor(streak)));
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
