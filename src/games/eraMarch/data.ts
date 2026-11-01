/**
 * 시대의 진격 (Era March) — every number the simulation uses. Balance passes
 * only edit this file (the bot self-play test in EraMarch.test.ts reads the
 * same tables), so engine.ts stays pure mechanics.
 *
 * Units: lane positions are in lane units (0 = left base, LANE = right base),
 * speeds in lane units per second, times in ticks (TICKS_PER_SEC per second).
 */

export const TICK_MS = 50;
export const TICKS_PER_SEC = 1000 / TICK_MS;
export const LANE = 1000;
/** Where units appear / where a base's wall starts, measured from its own end. */
export const SPAWN_X = 40;
export const BASE_FRONT = 36;
export const ALLY_GAP = 18;
export const CONTACT_GAP = 16;
export const POP_CAP = 15;
export const QUEUE_CAP = 5;
export const START_GOLD = 175;
export const MATCH_TICKS = 12 * 60 * TICKS_PER_SEC;
/** Last-stand: enemies this close to your base make your turrets hit harder. */
export const LAST_STAND_RANGE = 150;
export const LAST_STAND_MUL = 1.3;
export const SPECIAL_CD = 60 * TICKS_PER_SEC;

export type Era = 0 | 1 | 2 | 3 | 4;
export type Role = "melee" | "ranged" | "charge" | "support";

export interface EraDef {
  id: Era;
  name: string;
  emoji: string;
  /** XP and gold both needed to leave the PREVIOUS era for this one. */
  xpNeed: number;
  goldCost: number;
  baseHp: number;
  /** Passive gold per second. */
  income: number;
  sky: [string, string];
  ground: string;
  accent: string;
}

export const ERAS: readonly EraDef[] = [
  { id: 0, name: "부족 시대", emoji: "🪨", xpNeed: 0, goldCost: 0, baseHp: 1400, income: 3, sky: ["#f5c487", "#7aa7d6"], ground: "#6f8f3a", accent: "#d97706" },
  { id: 1, name: "제국 시대", emoji: "🏛️", xpNeed: 700, goldCost: 200, baseHp: 2800, income: 4, sky: ["#f4d9a6", "#6f9fd8"], ground: "#7a8f44", accent: "#b91c1c" },
  { id: 2, name: "항해 시대", emoji: "⚓", xpNeed: 2000, goldCost: 500, baseHp: 5200, income: 6, sky: ["#ffd8b0", "#5b8fc7"], ground: "#738a4a", accent: "#0e7490" },
  { id: 3, name: "증기 시대", emoji: "⚙️", xpNeed: 4800, goldCost: 1100, baseHp: 9000, income: 8, sky: ["#d9c3a8", "#6c7f96"], ground: "#6b7448", accent: "#a16207" },
  { id: 4, name: "전격 시대", emoji: "⚡", xpNeed: 10500, goldCost: 2400, baseHp: 15000, income: 11, sky: ["#c4b5fd", "#1e3a8a"], ground: "#4b5f53", accent: "#7c3aed" },
];

export type UnitKind =
  | "club" | "sling" | "boar"
  | "legion" | "archer" | "cavalry" | "shieldwall" | "chariot"
  | "marine" | "musket" | "dragoon" | "grenadier" | "corsair"
  | "trooper" | "rifle" | "armored" | "automaton" | "steamtank"
  | "plasma" | "railgun" | "hovertank" | "drone" | "colossus"
  | "shaman" | "ogre" | "priest" | "ballista" | "drummer" | "fieldgun" | "medic" | "howitzer" | "android" | "plasmagun";

/** Projectile / swing look, also picks the hit SFX. */
export type Fx = "club" | "stone" | "sword" | "arrow" | "blade" | "musket" | "bomb" | "bayonet" | "rifle" | "shell" | "plasma" | "rail" | "heal" | "gore" | "trample" | "ram" | "zap" | "boulder";

export interface UnitDef {
  kind: UnitKind;
  era: Era;
  role: Role;
  name: string;
  emoji: string;
  cost: number;
  trainTicks: number;
  hp: number;
  atk: number;
  cdTicks: number;
  range: number;
  speed: number;
  fx: Fx;
  /** Area radius around the target (lane units). */
  splash?: number;
  /** Damage multiplier against bases. */
  siege?: number;
  /** Gold stolen from the enemy per hit. */
  steal?: number;
  /** At most this many alive at once. */
  limit?: number;
  /** Only trainable after picking this doctrine. */
  doctrine?: DoctrineId;
  /** Visual scale (1 = a foot soldier). */
  size: number;
  desc: string;
}

const T = TICKS_PER_SEC;
const s = (sec: number) => Math.round(sec * T);

export const UNITS: Record<UnitKind, UnitDef> = {
  club: { kind: "club", era: 0, role: "melee", name: "돌도끼 전사", emoji: "🪓", cost: 15, trainTicks: s(1.2), hp: 95, atk: 15, cdTicks: s(1), range: 14, speed: 40, fx: "club", size: 1, desc: "싸고 단단한 앞줄. 돌격병에 강함" },
  sling: { kind: "sling", era: 0, role: "ranged", name: "투석꾼", emoji: "🪨", cost: 25, trainTicks: s(1.6), hp: 50, atk: 11, cdTicks: s(1.2), range: 140, speed: 38, fx: "stone", size: 0.95, desc: "뒤에서 돌을 던짐. 근접병에 강함" },
  boar: { kind: "boar", era: 0, role: "charge", name: "멧돼지 기수", emoji: "🐗", cost: 60, trainTicks: s(3), hp: 230, atk: 30, cdTicks: s(1.4), range: 16, speed: 62, fx: "gore", size: 1.25, desc: "빠르고 묵직함. 원거리병에 강함" },

  legion: { kind: "legion", era: 1, role: "melee", name: "군단병", emoji: "🗡️", cost: 35, trainTicks: s(1.3), hp: 230, atk: 33, cdTicks: s(1), range: 14, speed: 40, fx: "sword", size: 1, desc: "방패와 단검의 정예 보병" },
  archer: { kind: "archer", era: 1, role: "ranged", name: "궁수", emoji: "🏹", cost: 55, trainTicks: s(1.7), hp: 120, atk: 24, cdTicks: s(1.2), range: 160, speed: 38, fx: "arrow", size: 1, desc: "긴 사거리의 화살" },
  cavalry: { kind: "cavalry", era: 1, role: "charge", name: "기병", emoji: "🐎", cost: 130, trainTicks: s(3), hp: 540, atk: 66, cdTicks: s(1.4), range: 16, speed: 64, fx: "trample", size: 1.3, desc: "말 위의 창기병" },
  shieldwall: { kind: "shieldwall", era: 1, role: "melee", name: "대방패병", emoji: "🛡️", cost: 90, trainTicks: s(2.2), hp: 900, atk: 20, cdTicks: s(1.2), range: 12, speed: 30, fx: "sword", doctrine: "shield", size: 1.15, desc: "느리지만 거대한 HP의 벽" },
  chariot: { kind: "chariot", era: 1, role: "charge", name: "낫바퀴 전차", emoji: "🛞", cost: 160, trainTicks: s(3.2), hp: 460, atk: 85, cdTicks: s(1.5), range: 16, speed: 72, fx: "trample", splash: 30, doctrine: "chariot", size: 1.35, desc: "바퀴 낫으로 주변까지 벤다" },

  marine: { kind: "marine", era: 2, role: "melee", name: "해병", emoji: "⚔️", cost: 80, trainTicks: s(1.3), hp: 520, atk: 72, cdTicks: s(1), range: 14, speed: 42, fx: "blade", size: 1, desc: "커틀러스를 든 갑판 전사" },
  musket: { kind: "musket", era: 2, role: "ranged", name: "머스킷병", emoji: "🔫", cost: 125, trainTicks: s(1.8), hp: 270, atk: 56, cdTicks: s(1.3), range: 175, speed: 38, fx: "musket", size: 1, desc: "한 발 한 발이 묵직한 총" },
  dragoon: { kind: "dragoon", era: 2, role: "charge", name: "용기병", emoji: "🏇", cost: 290, trainTicks: s(3), hp: 1250, atk: 150, cdTicks: s(1.4), range: 16, speed: 64, fx: "trample", size: 1.3, desc: "총검을 든 기마병" },
  grenadier: { kind: "grenadier", era: 2, role: "ranged", name: "척탄병", emoji: "💣", cost: 210, trainTicks: s(2.4), hp: 340, atk: 75, cdTicks: s(1.8), range: 150, speed: 36, fx: "bomb", splash: 45, doctrine: "aim", size: 1.05, desc: "뭉친 적을 한 번에 날림" },
  corsair: { kind: "corsair", era: 2, role: "melee", name: "갈고리 해적", emoji: "🏴‍☠️", cost: 170, trainTicks: s(1.8), hp: 760, atk: 85, cdTicks: s(1), range: 16, speed: 46, fx: "blade", steal: 3, doctrine: "plunder", size: 1.05, desc: "때릴 때마다 상대 골드를 훔침" },

  trooper: { kind: "trooper", era: 3, role: "melee", name: "돌격대", emoji: "🪖", cost: 180, trainTicks: s(1.3), hp: 1150, atk: 160, cdTicks: s(1), range: 14, speed: 42, fx: "bayonet", size: 1, desc: "참호용 삽과 총검" },
  rifle: { kind: "rifle", era: 3, role: "ranged", name: "소총수", emoji: "🎯", cost: 280, trainTicks: s(1.8), hp: 600, atk: 120, cdTicks: s(1.2), range: 190, speed: 38, fx: "rifle", size: 1, desc: "정확한 장거리 사격" },
  armored: { kind: "armored", era: 3, role: "charge", name: "장갑차", emoji: "🚙", cost: 650, trainTicks: s(3.2), hp: 2800, atk: 330, cdTicks: s(1.4), range: 18, speed: 60, fx: "ram", size: 1.4, desc: "철판을 두른 돌격 차량" },
  automaton: { kind: "automaton", era: 3, role: "melee", name: "자동 보병", emoji: "🤖", cost: 110, trainTicks: s(0.7), hp: 650, atk: 95, cdTicks: s(1), range: 14, speed: 44, fx: "bayonet", doctrine: "mass", size: 0.95, desc: "싸고 빨리 찍어내는 태엽 병사" },
  steamtank: { kind: "steamtank", era: 3, role: "charge", name: "증기 전차", emoji: "🚂", cost: 950, trainTicks: s(4), hp: 4600, atk: 280, cdTicks: s(1.6), range: 70, speed: 28, fx: "shell", siege: 2, splash: 25, doctrine: "iron", size: 1.6, desc: "느리지만 기지에 2배 피해" },

  plasma: { kind: "plasma", era: 4, role: "melee", name: "플라즈마 기사", emoji: "⚡", cost: 400, trainTicks: s(1.3), hp: 2500, atk: 350, cdTicks: s(1), range: 15, speed: 44, fx: "zap", size: 1.05, desc: "에너지 검을 든 기사" },
  railgun: { kind: "railgun", era: 4, role: "ranged", name: "레일건병", emoji: "🔋", cost: 620, trainTicks: s(1.8), hp: 1350, atk: 265, cdTicks: s(1.2), range: 210, speed: 38, fx: "rail", size: 1, desc: "관통 레일 사격" },
  hovertank: { kind: "hovertank", era: 4, role: "charge", name: "호버 전차", emoji: "🛸", cost: 1400, trainTicks: s(3.2), hp: 6000, atk: 700, cdTicks: s(1.4), range: 18, speed: 62, fx: "ram", size: 1.45, desc: "떠서 질주하는 전차" },
  drone: { kind: "drone", era: 4, role: "support", name: "수리 드론", emoji: "🛰️", cost: 900, trainTicks: s(2.4), hp: 1500, atk: 260, cdTicks: s(1), range: 120, speed: 40, fx: "heal", doctrine: "network", size: 0.9, desc: "가장 앞의 아군을 계속 수리" },
  // ✚ support (heals the frontmost hurt ally) and 🎯 siege (slow, fragile, ×2.5 on bases) for every era
  shaman: { kind: "shaman", era: 0, role: "support", name: "주술사", emoji: "🪶", cost: 45, trainTicks: s(2), hp: 75, atk: 14, cdTicks: s(1.2), range: 110, speed: 36, fx: "heal", limit: 3, size: 0.95, desc: "앞선 아군을 치유 (최대 3명)" },
  ogre: { kind: "ogre", era: 0, role: "ranged", name: "바위 투척 거인", emoji: "🗿", cost: 95, trainTicks: s(3.5), hp: 280, atk: 32, cdTicks: s(2.6), range: 165, speed: 26, fx: "boulder", splash: 26, siege: 2.5, size: 1.4, desc: "느리지만 바위로 기지에 2.5배 피해" },
  priest: { kind: "priest", era: 1, role: "support", name: "사제", emoji: "📿", cost: 100, trainTicks: s(2), hp: 170, atk: 32, cdTicks: s(1.2), range: 120, speed: 36, fx: "heal", limit: 3, size: 1, desc: "앞선 아군을 치유 (최대 3명)" },
  ballista: { kind: "ballista", era: 1, role: "ranged", name: "발리스타 수레", emoji: "🏹", cost: 210, trainTicks: s(3.5), hp: 600, atk: 72, cdTicks: s(2.6), range: 190, speed: 26, fx: "arrow", splash: 20, siege: 2.5, size: 1.35, desc: "긴 사거리 공성 노포" },
  drummer: { kind: "drummer", era: 2, role: "support", name: "북 고수", emoji: "🥁", cost: 220, trainTicks: s(2), hp: 380, atk: 74, cdTicks: s(1.2), range: 120, speed: 36, fx: "heal", limit: 3, size: 1, desc: "북소리로 앞선 아군을 회복 (최대 3명)" },
  fieldgun: { kind: "fieldgun", era: 2, role: "ranged", name: "야포", emoji: "💥", cost: 460, trainTicks: s(3.5), hp: 1300, atk: 165, cdTicks: s(2.6), range: 200, speed: 26, fx: "shell", splash: 30, siege: 2.5, size: 1.35, desc: "포탄으로 뭉친 적과 기지를 강타" },
  medic: { kind: "medic", era: 3, role: "support", name: "위생병", emoji: "🩹", cost: 480, trainTicks: s(2), hp: 820, atk: 160, cdTicks: s(1.2), range: 125, speed: 38, fx: "heal", limit: 3, size: 1, desc: "앞선 아군을 치료 (최대 3명)" },
  howitzer: { kind: "howitzer", era: 3, role: "ranged", name: "곡사포", emoji: "🧨", cost: 1020, trainTicks: s(3.5), hp: 2800, atk: 370, cdTicks: s(2.6), range: 210, speed: 24, fx: "shell", splash: 35, siege: 2.5, size: 1.45, desc: "가장 먼 곳까지 닿는 공성포" },
  android: { kind: "android", era: 4, role: "support", name: "수복 안드로이드", emoji: "🤖", cost: 1050, trainTicks: s(2), hp: 1850, atk: 350, cdTicks: s(1.2), range: 130, speed: 38, fx: "heal", limit: 3, size: 1.05, desc: "나노 수복 광선 (최대 3명)" },
  plasmagun: { kind: "plasmagun", era: 4, role: "ranged", name: "플라즈마 포대", emoji: "🔆", cost: 2250, trainTicks: s(3.5), hp: 5800, atk: 820, cdTicks: s(2.6), range: 220, speed: 24, fx: "plasma", splash: 40, siege: 2.5, size: 1.45, desc: "떠다니는 공성 포대" },
  colossus: { kind: "colossus", era: 4, role: "charge", name: "코일 거신", emoji: "🗿", cost: 2800, trainTicks: s(6), hp: 16000, atk: 1100, cdTicks: s(1.8), range: 30, speed: 24, fx: "zap", splash: 50, limit: 1, doctrine: "overload", size: 2.1, desc: "전장에 1기만. 주변을 전격으로 지짐" },
};

/** Base roster per era, in button order (melee, ranged, charge, support, siege). */
export const ERA_UNITS: readonly (readonly UnitKind[])[] = [
  ["club", "sling", "boar", "shaman", "ogre"],
  ["legion", "archer", "cavalry", "priest", "ballista"],
  ["marine", "musket", "dragoon", "drummer", "fieldgun"],
  ["trooper", "rifle", "armored", "medic", "howitzer"],
  ["plasma", "railgun", "hovertank", "android", "plasmagun"],
];

/** melee ▶ charge ▶ ranged ▶ melee. Support never gets a bonus or a penalty. */
export const BEATS: Record<Role, Role | null> = { melee: "charge", charge: "ranged", ranged: "melee", support: null };
export const COUNTER_MUL = 1.5;
export const WEAK_MUL = 0.75;

export function roleMul(att: Role, def: Role): number {
  if (BEATS[att] === def) return COUNTER_MUL;
  if (BEATS[def] === att) return WEAK_MUL;
  return 1;
}

export const ROLE_ICON: Record<Role, string> = { melee: "⚔", ranged: "🏹", charge: "🐎", support: "✚" };
export const ROLE_NAME: Record<Role, string> = { melee: "근접", ranged: "원거리", charge: "돌격", support: "지원" };

export type DoctrineId = "shield" | "chariot" | "aim" | "plunder" | "mass" | "iron" | "network" | "overload";

export interface DoctrineDef {
  id: DoctrineId;
  /** Picked when ENTERING this era. */
  era: Era;
  name: string;
  emoji: string;
  passive: string;
  unit: UnitKind;
}

export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  shield: { id: "shield", era: 1, name: "방패 군단", emoji: "🛡️", passive: "근접병이 받는 피해 −20%", unit: "shieldwall" },
  chariot: { id: "chariot", era: 1, name: "전차 돌격", emoji: "🛞", passive: "돌격병 이동속도 +25%", unit: "chariot" },
  aim: { id: "aim", era: 2, name: "사격 교범", emoji: "🎯", passive: "원거리병 사거리 +20%", unit: "grenadier" },
  plunder: { id: "plunder", era: 2, name: "약탈 함대", emoji: "🏴‍☠️", passive: "처치 골드 +25%", unit: "corsair" },
  mass: { id: "mass", era: 3, name: "대량 생산", emoji: "🏭", passive: "모든 생산 시간 −25%", unit: "automaton" },
  iron: { id: "iron", era: 3, name: "철갑 공학", emoji: "🚂", passive: "돌격병 HP +30%", unit: "steamtank" },
  network: { id: "network", era: 4, name: "네트워크 지휘", emoji: "📡", passive: "원거리·지원병이 받는 피해 −25%", unit: "drone" },
  overload: { id: "overload", era: 4, name: "오버로드", emoji: "☄️", passive: "필살기 쿨타임 −30%", unit: "colossus" },
};

export const ERA_DOCTRINES: Record<Era, readonly [DoctrineId, DoctrineId] | null> = {
  0: null,
  1: ["shield", "chariot"],
  2: ["aim", "plunder"],
  3: ["mass", "iron"],
  4: ["network", "overload"],
};

export type TurretKind = "rock" | "fire" | "ballista" | "pitch" | "cannon" | "mortar" | "gatling" | "flak" | "laser" | "tesla";

export interface TurretDef {
  kind: TurretKind;
  era: Era;
  name: string;
  emoji: string;
  cost: number;
  dmg: number;
  cdTicks: number;
  /** Reach from the base's wall. */
  range: number;
  splash?: number;
  fx: Fx;
}

export const TURRETS: Record<TurretKind, TurretDef> = {
  rock: { kind: "rock", era: 0, name: "돌 투척대", emoji: "🪨", cost: 110, dmg: 20, cdTicks: s(1.4), range: 250, fx: "stone" },
  fire: { kind: "fire", era: 0, name: "불화살대", emoji: "🔥", cost: 170, dmg: 12, cdTicks: s(1.6), range: 230, splash: 30, fx: "arrow" },
  ballista: { kind: "ballista", era: 1, name: "발리스타", emoji: "🎯", cost: 260, dmg: 48, cdTicks: s(1.4), range: 270, fx: "arrow" },
  pitch: { kind: "pitch", era: 1, name: "끓는 기름", emoji: "🫗", cost: 380, dmg: 28, cdTicks: s(1.6), range: 200, splash: 40, fx: "bomb" },
  cannon: { kind: "cannon", era: 2, name: "요새포", emoji: "💥", cost: 600, dmg: 115, cdTicks: s(1.5), range: 290, fx: "shell" },
  mortar: { kind: "mortar", era: 2, name: "박격포", emoji: "🎆", cost: 850, dmg: 70, cdTicks: s(1.9), range: 300, splash: 45, fx: "bomb" },
  gatling: { kind: "gatling", era: 3, name: "개틀링", emoji: "🔩", cost: 1300, dmg: 95, cdTicks: s(0.6), range: 280, fx: "rifle" },
  flak: { kind: "flak", era: 3, name: "유탄포", emoji: "🧨", cost: 1800, dmg: 170, cdTicks: s(1.8), range: 300, splash: 50, fx: "shell" },
  laser: { kind: "laser", era: 4, name: "레이저 포대", emoji: "🔴", cost: 2900, dmg: 520, cdTicks: s(1.3), range: 320, fx: "rail" },
  tesla: { kind: "tesla", era: 4, name: "테슬라 코일", emoji: "🌀", cost: 3800, dmg: 320, cdTicks: s(1.7), range: 260, splash: 60, fx: "zap" },
};

export const ERA_TURRETS: readonly (readonly [TurretKind, TurretKind])[] = [
  ["rock", "fire"],
  ["ballista", "pitch"],
  ["cannon", "mortar"],
  ["gatling", "flak"],
  ["laser", "tesla"],
];

/** Slot 0 is open from the start; the others are bought. */
export const SLOT_COST = [0, 250, 900] as const;
export const SELL_REFUND = 0.5;

export interface SpecialDef {
  era: Era;
  name: string;
  emoji: string;
  desc: string;
}

export const SPECIALS: readonly SpecialDef[] = [
  { era: 0, name: "맘모스 떼", emoji: "🦣", desc: "맘모스가 전선을 휩쓸어 적을 밀어내고 기절시킴" },
  { era: 1, name: "투석기 일제사격", emoji: "☄️", desc: "적이 가장 몰린 곳에 바위 3연타" },
  { era: 2, name: "함포 지원", emoji: "⚓", desc: "앞바다 함대가 적 6명을 저격" },
  { era: 3, name: "비행선 폭격", emoji: "🎈", desc: "비행선이 적 진영 끝까지 폭탄을 떨굼" },
  { era: 4, name: "EMP 정지장", emoji: "🌐", desc: "적 전체 3초 정지 + 포탑 무력화" },
];

/** Reward knobs. */
export const KILL_GOLD = 0.62;
export const KILL_XP = 2;
export const TRAIN_XP = 0.5;
export const ERA_GAP_BONUS = 1.5;
export const PLUNDER_GOLD = 1.25;
/** Front-line income: +1 gold/s per this many lane units past the middle. */
export const FRONT_STEP = 100;
export const FRONT_MAX = 4;
/** XP every second just for holding on (× the era's income), so a side that is behind keeps moving. */
export const PASSIVE_XP = 1;
/** Evolving costs this much less gold while the opponent is already in a later era. */
export const CATCH_UP_DISCOUNT = 0.7;
/** Sudden death: both bases lose this share of max HP per second. */
export const SUDDEN_DEATH_PCT = 0.015;

/* ── pre-battle shop: one command plan + items bought with ★ ────────────── */

export type PlanId = "fortress" | "blitz" | "scholar" | "merchant";

export interface PlanDef {
  id: PlanId;
  name: string;
  emoji: string;
  pros: string[];
  cons: string;
  color: string;
}

export const PLANS: Record<PlanId, PlanDef> = {
  fortress: { id: "fortress", name: "철벽 수비", emoji: "🏰", pros: ["기지 HP +15%", "포탑 슬롯 2칸 개방", "포탑 피해 +15%"], cons: "생산 15% 느림", color: "#64748b" },
  blitz: { id: "blitz", name: "전격 돌격", emoji: "⚔️", pros: ["시작 골드 +150", "공격력 +15%", "이동속도 +15%", "생산 20% 빠름"], cons: "진화 골드 +10%", color: "#dc2626" },
  scholar: { id: "scholar", name: "학자의 길", emoji: "📜", pros: ["XP 획득 +35%", "진화 골드 −20%"], cons: "시작 골드 −20", color: "#7c3aed" },
  merchant: { id: "merchant", name: "상인 연합", emoji: "💰", pros: ["골드 수입 +15%", "처치 골드 +10%"], cons: "유닛 HP −8%", color: "#ca8a04" },
};
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export type ItemId = "vault" | "veterans" | "armor" | "warmup" | "tower" | "drill" | "sharp" | "bonds";

export interface ItemDef {
  id: ItemId;
  name: string;
  emoji: string;
  cost: number;
  desc: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  vault: { id: "vault", name: "비상 금고", emoji: "🪙", cost: 1, desc: "시작 골드 +90" },
  veterans: { id: "veterans", name: "정예 선봉대", emoji: "🎖️", cost: 2, desc: "시작하자마자 돌도끼 전사 3명 무료 출전" },
  armor: { id: "armor", name: "강화 갑옷", emoji: "🛡️", cost: 2, desc: "모든 유닛 HP +8%" },
  warmup: { id: "warmup", name: "필살기 예열", emoji: "☄️", cost: 2, desc: "첫 필살기가 처음부터 충전됨" },
  tower: { id: "tower", name: "선제 포탑", emoji: "🏹", cost: 2, desc: "돌 투척대를 미리 설치" },
  drill: { id: "drill", name: "강행 훈련", emoji: "⚡", cost: 2, desc: "생산 시간 −10%" },
  sharp: { id: "sharp", name: "숙련 사수", emoji: "🎯", cost: 2, desc: "원거리·지원 사거리 +10%" },
  bonds: { id: "bonds", name: "전쟁 공채", emoji: "📈", cost: 3, desc: "골드 수입 +15%" },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const SHOP_BUDGET = 5;
/** Seconds to pick in an online room before the current pick is locked in. */
export const SHOP_SECONDS = 40;

export interface Loadout {
  plan: PlanId;
  items: ItemId[];
}

/** Used when time runs out with nothing confirmed. */
export const DEFAULT_LOADOUT: Loadout = { plan: "merchant", items: ["vault", "armor", "drill"] };

export function loadoutCost(items: readonly ItemId[]): number {
  return items.reduce((s, i) => s + ITEMS[i].cost, 0);
}

/** Network / storage input → a legal loadout (unknown or over-budget parts dropped). */
export function sanitizeLoadout(raw: unknown): Loadout {
  const r = (raw ?? {}) as { plan?: unknown; items?: unknown };
  const plan = PLAN_IDS.includes(r.plan as PlanId) ? (r.plan as PlanId) : DEFAULT_LOADOUT.plan;
  const items: ItemId[] = [];
  if (Array.isArray(r.items)) {
    for (const i of r.items) {
      if (!ITEM_IDS.includes(i as ItemId) || items.includes(i as ItemId)) continue;
      if (loadoutCost([...items, i as ItemId]) > SHOP_BUDGET) continue;
      items.push(i as ItemId);
    }
  }
  return { plan, items };
}

/** Suggested item sets per plan (shop "추천" buttons, bots). */
export const PLAN_COMBOS: Record<PlanId, ItemId[]> = {
  fortress: ["tower", "armor", "vault"],
  blitz: ["veterans", "drill", "vault"],
  scholar: ["warmup", "sharp", "vault"],
  merchant: ["bonds", "armor"],
};
