/**
 * 랜덤 합성 디펜스 (Merge Defense) — pure simulation engine.
 *
 * Every seat owns a 5×3 board ringed by a looping road. The same waves walk
 * every road at the same time; units on the board shoot them automatically.
 * Summoning gives a random unit, two identical units (same kind + grade)
 * merge into ONE random unit of the next grade — the luck is in what comes
 * out. When `loadLimit(playerCount)` monsters are on your road at once you're out; the
 * last board standing wins. Every `SEND_EVERY` kills drops an elite onto the
 * next living opponent's road, so a strong board pressures the others.
 *
 * Sync model: same as worm — the room host is the sole authority (calls
 * `stepGame` at a fixed 20Hz and broadcasts snapshots); other clients run
 * `stepGame` locally between snapshots purely for smooth motion and snap to
 * each snapshot when it arrives. All randomness goes through the seeded rng
 * stored IN the state (`state.rng`), never Math.random, so a client's local
 * prediction matches the host until a remote action arrives.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const TICK_MS = 50;
export const TICKS_PER_SEC = 1000 / TICK_MS;

/** Board geometry (logical units — the canvas scales this). */
export const BOARD_W = 400;
export const BOARD_H = 280;
/** Build-pad pitch; pads are drawn CELL − 8 wide and tapped within ±(CELL − 8)/2. */
export const CELL = 60;

/**
 * Maps — each one is a closed road (monsters loop it forever) plus its own
 * build pads. They differ in shape, not just paint: the road can ring the
 * pads, sit inside them, cross itself, or cut the board diagonally, and the
 * pad count changes with it. `hp` evens the maps out (bot-sim, 2 bots ×16
 * games each: every map's median bot elimination lands on wave 33–34).
 */
export type MapId = "classic" | "plaza" | "figure8" | "diamond";
export interface MapDef {
  id: MapId;
  name: string;
  emoji: string;
  desc: string;
  /** Closed road polyline, travelled in order; point 0 is the portal. */
  path: readonly (readonly [number, number])[];
  slots: readonly (readonly [number, number])[];
  /** Monster HP multiplier on this map. */
  hp: number;
  /** Grass gradient [centre, edge]. */
  grass: readonly [string, string];
}

const GRID_5x3: [number, number][] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) GRID_5x3.push([80 + c * 60, 80 + r * 60]);

export const MAPS: Record<MapId, MapDef> = {
  classic: {
    id: "classic",
    name: "순환로",
    emoji: "🔲",
    desc: "길이 바깥을 한 바퀴 — 5×3 칸 15개",
    path: [[20, 20], [380, 20], [380, 260], [20, 260]],
    slots: GRID_5x3,
    hp: 1,
    grass: ["#3f8a3a", "#1f4d24"],
  },
  plaza: {
    id: "plaza",
    name: "중앙 광장",
    emoji: "⭕",
    desc: "가운데 작은 고리를 칸 15개가 둘러싸요 — 짧은 길, 집중 사격",
    path: [[120, 92], [280, 92], [280, 188], [120, 188]],
    slots: [
      [40, 40], [104, 40], [168, 40], [232, 40], [296, 40], [360, 40],
      [52, 140], [200, 140], [348, 140],
      [40, 240], [104, 240], [168, 240], [232, 240], [296, 240], [360, 240],
    ],
    hp: 1.08,
    grass: ["#b59a5c", "#6b5530"],
  },
  figure8: {
    id: "figure8",
    name: "8자 교차로",
    emoji: "♾️",
    desc: "길이 가운데서 엇갈려요 — 가장 긴 길, 칸 12개",
    path: [[18, 18], [168, 18], [232, 262], [382, 262], [382, 18], [232, 18], [168, 262], [18, 262]],
    slots: [
      [68, 72], [126, 72], [68, 140], [126, 140], [68, 208], [126, 208],
      [274, 72], [332, 72], [274, 140], [332, 140], [274, 208], [332, 208],
    ],
    hp: 0.7,
    grass: ["#7a8a34", "#3b4a1c"],
  },
  diamond: {
    id: "diamond",
    name: "마름모 요새",
    emoji: "🔷",
    desc: "대각선 길 안쪽 5칸 + 네 모서리 8칸 — 칸 13개",
    path: [[200, 14], [386, 140], [200, 266], [14, 140]],
    slots: [
      [140, 140], [200, 140], [260, 140], [200, 82], [200, 198],
      [34, 34], [94, 28], [306, 28], [366, 34],
      [34, 246], [94, 252], [306, 252], [366, 246],
    ],
    hp: 1,
    grass: ["#3a7f86", "#173c45"],
  },
};
export const MAP_IDS: MapId[] = ["classic", "plaza", "figure8", "diamond"];
export function sanitizeMap(v: unknown): MapId {
  return typeof v === "string" && (MAP_IDS as string[]).includes(v) ? (v as MapId) : "classic";
}
/** Most pads any map has (action validation bound). */
export const MAX_SLOTS = Math.max(...MAP_IDS.map((id) => MAPS[id].slots.length));

/*
 * The active map's geometry, as live bindings: a client only ever runs one
 * match, so the engine entry points (`startGame`, `applyAction`, `stepGame`,
 * `chooseBotAction`) and the board call `selectMap(state.map)` and every
 * geometry helper reads these.
 */
export let MAP: MapDef = MAPS.classic;
export let SLOTS = MAP.slots.length;
export let PATH_LEN = 0;
let segStart: number[] = [];
let segLen: number[] = [];
let slotPref: number[] = [];

export function selectMap(id: MapId | undefined) {
  const next = MAPS[sanitizeMap(id)];
  if (next === MAP && segLen.length) return;
  MAP = next;
  SLOTS = next.slots.length;
  segStart = [];
  segLen = [];
  let total = 0;
  next.path.forEach(([x, y], i) => {
    const [nx, ny] = next.path[(i + 1) % next.path.length];
    segStart.push(total);
    const len = Math.hypot(nx - x, ny - y);
    segLen.push(len);
    total += len;
  });
  PATH_LEN = total;
  slotPref = Array.from({ length: SLOTS }, (_, i) => i).sort((a, b) => slotCoverage(b, 140) - slotCoverage(a, 140) || a - b);
}
selectMap("classic");

export const PREP_TICKS = 6 * TICKS_PER_SEC;
export const WAVE_TICKS = 20 * TICKS_PER_SEC;
const SPAWN_GAP = 12;
export const BOSS_EVERY = 5;
/** Monsters (head count) on one road that knock a player out, by player count (bot-sim tuned). */
// More players take longer to whittle down to one survivor, so the bar drops
// as seats rise — every table size lands on a ~8.5–9 min median bot game.
export const LOAD_LIMITS: Record<number, number> = { 2: 55, 3: 50, 4: 45 };
export function loadLimit(playerCount: number): number {
  return LOAD_LIMITS[playerCount] ?? LOAD_LIMITS[2];
}
/** Host-picked wave difficulty — scales every monster's HP (bot-sim tuned). */
export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];
export const DIFFICULTY_HP: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.2 };
/** Monsters per wave multiplier (spawned closer together so the wave still fits its 20s). */
export const DIFFICULTY_COUNT: Record<Difficulty, number> = { easy: 1, normal: 1, hard: 1.25 };
export function difficultyHp(s: Pick<MergeDefenseState, "difficulty" | "map">): number {
  return DIFFICULTY_HP[difficultyOf(s)] * MAPS[sanitizeMap(s.map)].hp;
}
export function difficultyCount(s: Pick<MergeDefenseState, "difficulty">): number {
  return DIFFICULTY_COUNT[difficultyOf(s)];
}
export function difficultyOf(state: Pick<MergeDefenseState, "difficulty">): Difficulty {
  return state.difficulty && DIFFICULTIES.includes(state.difficulty) ? state.difficulty : "normal";
}
export function sanitizeDifficulty(raw: unknown): Difficulty {
  return DIFFICULTIES.includes(raw as Difficulty) ? (raw as Difficulty) : "normal";
}
/** Host-picked elimination bars offered when creating a room (null = by player count). */
export const LIMIT_CHOICES = [35, 45, 55, 70] as const;
export const LIMIT_MIN = 20;
export const LIMIT_MAX = 100;
/** The bar actually in force for this match (room setting, else the per-seat default). */
export function eliminationLimit(state: Pick<MergeDefenseState, "limit" | "playerCount">): number {
  return state.limit ?? loadLimit(state.playerCount);
}
/** Validates a host-sent limit; anything odd falls back to the per-seat default. */
export function sanitizeLimit(raw: unknown): number | null {
  return Number.isInteger(raw) && (raw as number) >= LIMIT_MIN && (raw as number) <= LIMIT_MAX ? (raw as number) : null;
}
/** Bosses / warlords call a minion onto the road this often; golems split in two on death. */
const BOSS_MINION_EVERY = 4 * 20;
const WARLORD_MINION_EVERY = 5 * 20;
const GOLEM_SPLIT = 2;
/**
 * Most minions one boss / warlord may summon, by difficulty. Uncapped, a board
 * that couldn't kill the wave-10 boss fast got buried in endless minions (bot
 * sim: ~4% of games ended at wave 11–12 on normal AND hard); a cap of 4 on
 * normal removed every such collapse.
 */
export const MINION_CAP: Record<Difficulty, number> = { easy: 2, normal: 4, hard: 6 };
/** Once out of minions a caller goes berserk: every SMASH_EVERY it stuns the nearest tower. */
export const SMASH_EVERY = 6 * 20;
export const SMASH_STUN = 2 * 20;
const SMASH_REACH = 150;
/** 🛡️ 결속: a permanent board upgrade, each level cuts smash stun time by 25%. */
export const BRACE_MAX = 3;
export const BRACE_COSTS = [80, 160, 280];
/**
 * A jam blocked by max 결속 reflects: the sender's strongest tower is stunned
 * this many ticks (0 = off). Controlled sim (one seat rushing 결속 3 in 2p/3p
 * versus): no reflect 38% wins, 0.7s reflect ~47%, fair share ~42% (±5 noise)
 * — so the 280 third level stays and the reflect is a modest payoff.
 */
export const JAM_REFLECT = { ticks: 14 };
/**
 * Bots chase max 결속 once they've been combo-jammed this many times. Sim
 * (versus 2p/4p): 2 → ~95% of bots maxed it and 2/3 of jams bounced; 6 → ~45%
 * of bots, 13–20% of jams blocked, game length unchanged.
 */
export const BOT_BRACE = { afterJams: 6, afterSmashes: 10 };
export function braceCost(level: number): number {
  return BRACE_COSTS[Math.min(level, BRACE_COSTS.length - 1)];
}
/** 🎯 집중: a permanent board upgrade raising crit chance and crit damage. */
export const FOCUS_MAX = 5;
export const FOCUS_STEP = { chance: 0.03, mult: 0.15 };
const FOCUS_COSTS = [70, 120, 180, 260, 360];
export function focusCost(level: number): number {
  return FOCUS_COSTS[Math.min(level, FOCUS_COSTS.length - 1)];
}
/** Crit chance / multiplier for a board at this 집중 level. */
export function critStats(focus: number): { chance: number; mult: number } {
  const f = Math.max(0, Math.min(FOCUS_MAX, focus));
  return { chance: CRIT.chance + FOCUS_STEP.chance * f, mult: CRIT.mult + FOCUS_STEP.mult * f };
}
/**
 * Crit combo: crits on one board less than COMBO.gapTicks apart chain.
 * Reaching COMBO.goldAt pays comboGold, reaching COMBO.gemAt pays a gem — each
 * at most once per wave, since a big late board chains almost endlessly.
 * Tuned so a full board cashes the gold milestone in ~38% of waves from W10
 * (was 10% at 6 ticks / 10 combo) without moving median waves beyond noise.
 * 유닛 대결: each milestone also jams the next opponent (COMBO.jam towers stunned).
 */
export const COMBO = { gapTicks: 9, goldAt: 8, gemAt: 20, gems: true, jam: { gold: 2, gem: 3 } };
export const COMBO_GOLD = { base: 6, perWave: 1.5 };
/** From this wave on, combo-bonus coverage is tracked for /stats (matches the tuning target). */
export const LATE_WAVE = 10;
export function comboGold(wave: number): number {
  return Math.round(COMBO_GOLD.base + COMBO_GOLD.perWave * Math.max(1, wave));
}
/** Stun ticks a smash inflicts on a board with this 결속 level. */
export function stunTicks(brace: number): number {
  return Math.round(SMASH_STUN * (1 - 0.25 * Math.min(BRACE_MAX, brace)));
}
/** Gold to shake every stunned tower awake at once. */
export function wakeCost(wave: number): number {
  return 10 + 2 * Math.max(1, wave);
}
/** Killing a berserk boss / warlord pays this share of its gold again, plus one extra gem. */
export const RAGE_GOLD_BONUS = 0.5;
export const SEND_EVERY = 12;
export const MAX_GRADE = 5;
export const MAX_UPGRADE = 10;
export const START_GOLD = 100;
export const START_GEMS = 1;
/** Gems spent per 💎 gamble. */
export const GAMBLE_COST = 1;
/** 💎 gamble outcomes in percent (grade 0 = 꽝, nothing built). Shown on the button and in the rulebook. */
export const GAMBLE_ODDS: readonly { grade: number; pct: number }[] = [
  { grade: 0, pct: 20 },
  { grade: 2, pct: 48 },
  { grade: 3, pct: 26 },
  { grade: 4, pct: 6 },
];
const MAX_EVENTS = 40;

export type SeatIndex = number;
export type UnitKind = "archer" | "mage" | "frost" | "thunder" | "poison";
export const UNIT_KINDS: UnitKind[] = ["archer", "mage", "frost", "thunder", "poison"];

export interface UnitDef {
  name: string;
  emoji: string;
  color: string;
  /** Damage per hit at grade 1, upgrade 0. */
  dmg: number;
  /** Ticks between attacks at grade 1. */
  interval: number;
  /** Attack reach from the unit's cell centre at grade 1 (board units). */
  range: number;
  /** 물리 hits are cut by a monster's 방어력, 마법 hits by its 마법 저항. */
  dmgType: DamageType;
  desc: string;
}

export type DamageType = "physical" | "magic";
export const DAMAGE_TYPE_LABEL: Record<DamageType, string> = { physical: "물리", magic: "마법" };

export const UNITS: Record<UnitKind, UnitDef> = {
  archer: { name: "궁수", emoji: "🏹", color: "#f97316", dmg: 11, interval: 12, range: 150, dmgType: "physical", desc: "빠른 단일 공격 · 긴 사거리" },
  mage: { name: "마법사", emoji: "🔮", color: "#a855f7", dmg: 9, interval: 22, range: 125, dmgType: "magic", desc: "범위 폭발" },
  frost: { name: "서리", emoji: "❄️", color: "#38bdf8", dmg: 6, interval: 18, range: 135, dmgType: "magic", desc: "둔화" },
  thunder: { name: "번개", emoji: "⚡", color: "#facc15", dmg: 8, interval: 20, range: 135, dmgType: "physical", desc: "연쇄 공격" },
  poison: { name: "독", emoji: "☠️", color: "#22c55e", dmg: 4, interval: 24, range: 140, dmgType: "magic", desc: "최대 체력 % 독 (보스 특효)" },
};

export const GRADE_NAMES = ["", "일반", "희귀", "영웅", "전설", "신화"];
export const GRADE_COLORS = ["", "#cbd5e1", "#38bdf8", "#a855f7", "#f59e0b", "#f43f5e"];
/** Damage multiplier per grade step. */
const GRADE_MULT = 2.5;
const UPGRADE_STEP = 0.15;

export interface Unit {
  kind: UnitKind;
  grade: number;
  /** Ticks until the next attack. */
  cd: number;
  /** Ticks left stunned by a berserk boss's smash (can't attack). */
  stun?: number;
}

export type MobKind = "normal" | "fast" | "tank" | "boss" | "elite" | "invader" | "golem" | "wraith" | "warlord";

/**
 * Per-kind defences (fractions of damage removed): `armor` cuts 물리 hits
 * (궁수·번개), `resist` cuts 마법 hits (마법사·서리·독, poison ticks too).
 * Tanks/golems want magic, fast monsters/wraiths want physical, so a board
 * of one damage type has a weak spot. Shown on the monster info card.
 */
export const MOB_INFO: Record<MobKind, { name: string; emoji: string; armor: number; resist: number; trait?: string }> = {
  normal: { name: "몬스터", emoji: "👾", armor: 0, resist: 0 },
  fast: { name: "날쌘 몬스터", emoji: "💨", armor: 0, resist: 0.25, trait: "빠름" },
  tank: { name: "탱커", emoji: "🛡️", armor: 0.35, resist: 0, trait: "느리지만 단단함" },
  boss: { name: "보스", emoji: "👑", armor: 0.2, resist: 0.2, trait: "졸개 소환 · 다 부르면 광폭화(타워 기절) · 둔화 절반" },
  elite: { name: "정예 몬스터", emoji: "🔥", armor: 0.15, resist: 0.15, trait: "상대가 보낸 압박" },
  invader: { name: "침략자", emoji: "😈", armor: 0.1, resist: 0.1, trait: "상대가 보낸 유닛 — 등급이 높을수록 단단함" },
  golem: { name: "바위 골렘", emoji: "🪨", armor: 0.5, resist: 0, trait: "쓰러지면 작은 몬스터로 쪼개짐" },
  wraith: { name: "망령", emoji: "👻", armor: 0.1, resist: 0.45, trait: "아주 빠름 · 둔화 면역" },
  warlord: { name: "전쟁군주", emoji: "👹", armor: 0.3, resist: 0.15, trait: "미니 보스 · 졸개 소환" },
};

/** Damage that lands on `kind` after its armor / resist. */
export function mitigated(kind: MobKind, amount: number, type: DamageType): number {
  const info = MOB_INFO[kind];
  return amount * (1 - (type === "physical" ? info.armor : info.resist));
}

/**
 * 유닛 대결: monsters a player may buy with gold and drop on an opponent's
 * road. Shares the unit-send cooldown. Each costs more than the gold the
 * defender earns by killing it, so hiring is pressure, not a gold engine.
 */
export type HireKind = "swarm" | "wraith" | "golem" | "warlord";
export const HIRE_KINDS: HireKind[] = ["swarm", "wraith", "golem", "warlord"];
export const SWARM_SIZE = 6;

export interface HireDef {
  name: string;
  emoji: string;
  desc: string;
  base: number;
  perWave: number;
  minWave: number;
}

export const HIRES: Record<HireKind, HireDef> = {
  swarm: { name: "박쥐 떼", emoji: "🦇", desc: `빠른 박쥐 ${SWARM_SIZE}마리가 한꺼번에`, base: 45, perWave: 4, minWave: 1 },
  wraith: { name: "망령", emoji: "👻", desc: "아주 빠름 · 둔화 면역", base: 60, perWave: 5, minWave: 2 },
  golem: { name: "바위 골렘", emoji: "🪨", desc: "체력 9배 · 느림 · 쓰러지면 돌멩이 2마리로 분열", base: 80, perWave: 6, minWave: 3 },
  warlord: { name: "전쟁군주", emoji: "👹", desc: "미니 보스 · 체력 20배 · 졸개 소환 후 광폭화(타워 기절)", base: 170, perWave: 12, minWave: 5 },
};

export function hireCost(kind: HireKind, wave: number): number {
  return HIRES[kind].base + HIRES[kind].perWave * Math.max(1, wave);
}

export interface Mob {
  id: number;
  kind: MobKind;
  hp: number;
  maxHp: number;
  /** Total distance travelled — position is `trav % PATH_LEN`; larger = older = targeted first. */
  trav: number;
  speed: number;
  slowT: number;
  slowPct: number;
  poisonT: number;
  poisonDps: number;
  /** Seat that sent this elite/invader (for colour/labels); -1 for wave mobs. */
  from: SeatIndex;
  /** 유닛 대결 invaders only: the unit that was sent (drawn as a corrupted tower). */
  unitKind?: UnitKind;
  grade?: number;
  /** Boss / warlord: minions called so far (capped by MINION_CAP). */
  calls?: number;
  /** Bosses only: the wave they arrived with (a wave-10 boss may die in wave 11). */
  bornWave?: number;
  /** Out of minions → berserk: smashes the nearest tower every SMASH_EVERY ticks. */
  rage?: boolean;
}

export interface Shot {
  slot: number;
  kind: UnitKind;
  grade: number;
  /** Hit positions flattened [x0, y0, x1, y1, …] — first is the main target. */
  pts: number[];
  /** Critical hit (rolled from state.rng): this attack dealt CRIT_MULT damage. */
  crit?: boolean;
  /** Main target's mob id (lets the UI pin crit numbers to the right mob). */
  target?: number;
}

/**
 * Every attack rolls for a critical hit. 12% × 2 adds ~12% DPS, offset by
 * WAVE_CURVE.base 60 → 66 (bot sim: median waves unchanged on normal/hard).
 */
export const CRIT = { chance: 0.12, mult: 2 };

export interface Board {
  units: (Unit | null)[];
  mobs: Mob[];
  gold: number;
  gems: number;
  summons: number;
  upgrades: Record<UnitKind, number>;
  kills: number;
  sendMeter: number;
  alive: boolean;
  /** Tick of elimination (null while alive). */
  outAt: number | null;
  outWave: number;
  bot: boolean;
  /** Ticks until this board may send another unit (유닛 대결 only). */
  sendCd: number;
  /** 🛡️ 결속 level (0..BRACE_MAX) — shortens smash stuns. */
  brace?: number;
  /** 🎯 집중 level (0..FOCUS_MAX) — raises crit chance and damage. */
  focus?: number;
  /** Berserk bosses / warlords this board killed (for /stats). */
  rageKills?: number;
  /** Current crit chain, the tick of its last crit, and this match's longest chain. */
  critChain?: number;
  /** Wave in which this board last cashed a combo gold / gem milestone. */
  comboGoldWave?: number;
  comboGemWave?: number;
  lastCritTick?: number;
  bestCombo?: number;
  /** 유닛 대결 combo jams this board landed / suffered / shrugged off (max 결속). */
  jamsSent?: number;
  jamsTaken?: number;
  jamsBlocked?: number;
  /** Times this board's blocked jam bounced back onto it. */
  reflectsTaken?: number;
  /** Times a berserk boss / warlord smash stunned one of this board's towers. */
  smashesTaken?: number;
  /** Peak monsters on the road per finished wave (index = wave − 1) and the running peak of the current wave. */
  loadHistory?: number[];
  /** Cumulative gold earned (all income, before spending) and kills at each closed wave — same indexing as loadHistory. */
  goldHistory?: number[];
  killHistory?: number[];
  /** Running total of gold earned this match. */
  goldEarned?: number;
  /** Board upgrades bought, in order: wave + which (for the results chart). */
  upgradeLog?: { wave: number; kind: "focus" | "brace"; level: number }[];
  /** Wave bosses this board killed: which wave's boss, and in which wave it fell. */
  bossKills?: { wave: number; at: number }[];
  wavePeak?: number;
  /** Waves from W10 this board started alive, and how many of them paid the combo gold milestone (for /stats). */
  lateWaves?: number;
  comboBonusWaves?: number;
  /** Attacks fired during the most recent tick — for FX only. */
  shots: Shot[];
}

export type GameEvent =
  | { id: number; tick: number; seat: SeatIndex; type: "summon"; slot: number; grade: number; lucky: boolean }
  | { id: number; tick: number; seat: SeatIndex; type: "merge"; slot: number; grade: number; from: number }
  | { id: number; tick: number; seat: SeatIndex; type: "gamble"; slot: number; grade: number }
  | { id: number; tick: number; seat: SeatIndex; type: "gamble-fail" }
  | { id: number; tick: number; seat: SeatIndex; type: "upgrade"; kind: UnitKind; level: number }
  | { id: number; tick: number; seat: SeatIndex; type: "send"; to: SeatIndex }
  | { id: number; tick: number; seat: SeatIndex; type: "invade"; to: SeatIndex; kind: UnitKind; grade: number }
  | { id: number; tick: number; seat: SeatIndex; type: "hire"; to: SeatIndex; mob: HireKind }
  | { id: number; tick: number; seat: SeatIndex; type: "move"; a: number; b: number }
  /** `rage` = it was berserk (bonus paid); `warlord` = a bought mini boss (only announced when berserk). */
  | { id: number; tick: number; seat: SeatIndex; type: "boss-kill"; rage?: boolean; warlord?: boolean; gold?: number; gems?: number }
  | { id: number; tick: number; seat: SeatIndex; type: "wake"; count: number }
  | { id: number; tick: number; seat: SeatIndex; type: "brace"; level: number }
  | { id: number; tick: number; seat: SeatIndex; type: "focus"; level: number }
  /** A crit chain hit a reward milestone (`count` is the chain length). */
  | { id: number; tick: number; seat: SeatIndex; type: "combo"; count: number; gold: number; gems: number }
  /** 유닛 대결: `seat`'s combo milestone stunned these towers on `to`'s board. */
  | { id: number; tick: number; seat: SeatIndex; type: "jam"; to: SeatIndex; slots: number[]; blocked?: boolean; reflected?: number }
  /** A golem at road distance `trav` just broke into pebbles. */
  | { id: number; tick: number; seat: SeatIndex; type: "split"; trav: number }
  /** A boss / warlord used up its minions and went berserk. */
  | { id: number; tick: number; seat: SeatIndex; type: "rage"; trav: number; boss: boolean }
  /** A berserk boss / warlord at `trav` stunned the tower in `slot`. */
  | { id: number; tick: number; seat: SeatIndex; type: "smash"; trav: number; slot: number }
  /** A boss / warlord at road distance `trav` just called a minion. */
  | { id: number; tick: number; seat: SeatIndex; type: "call"; trav: number; boss: boolean }
  | { id: number; tick: number; seat: SeatIndex; type: "out" }
  | { id: number; tick: number; seat: -1; type: "wave"; wave: number; boss: boolean };

/**
 * "survival" (생존전): only the automatic elite pressure.
 * "versus" (유닛 대결): players may also sacrifice their own units — a sent
 * unit leaves your board and walks the target's road as an invader whose
 * strength scales with its grade.
 */
export type GameMode = "survival" | "versus";
export const GAME_MODES: GameMode[] = ["survival", "versus"];

export interface MergeDefenseState {
  phase: "playing" | "gameOver";
  mode: GameMode;
  playerCount: number;
  /** Room-chosen wave difficulty; absent = normal. */
  difficulty?: Difficulty;
  /** Room-chosen map; absent = classic. */
  map?: MapId;
  /** Room-chosen elimination head count; null/absent = `loadLimit(playerCount)`. */
  limit?: number | null;
  tick: number;
  /** 0 during the prep countdown, then 1, 2, … */
  wave: number;
  boards: Board[];
  rng: number;
  nextMobId: number;
  nextEventId: number;
  events: GameEvent[];
}

export type Action =
  | { type: "summon"; slot?: number }
  | { type: "gamble"; slot?: number }
  | { type: "merge"; a: number; b: number }
  /** Moves unit `a` to cell `b` (swapping if `b` is occupied). */
  | { type: "move"; a: number; b: number }
  | { type: "upgrade"; kind: UnitKind }
  /** 유닛 대결: sacrifice the unit in `slot` onto `to`'s road. */
  | { type: "send"; slot: number; to?: SeatIndex }
  /** Pay gold to clear every stun on your board. */
  | { type: "wake" }
  /** Buy the next 🛡️ 결속 level. */
  | { type: "brace" }
  /** Buy the next 🎯 집중 level. */
  | { type: "focus" }
  /** 유닛 대결: buy a monster with gold and drop it on `to`'s road. */
  | { type: "hire"; mob: HireKind; to?: SeatIndex };

export const SEND_COOLDOWN_TICKS = 3 * 20;

// ---------------------------------------------------------------------------
// RNG — mulberry32 over `state.rng`.
// ---------------------------------------------------------------------------

function rand(s: MergeDefenseState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(s: MergeDefenseState, list: readonly T[]): T {
  return list[Math.floor(rand(s) * list.length)];
}

// ---------------------------------------------------------------------------
// Geometry helpers (shared with the renderer).
// ---------------------------------------------------------------------------

/** Point on the road for a distance travelled (from the portal, along `MAP.path`). */
export function pathPoint(trav: number): { x: number; y: number } {
  let d = trav % PATH_LEN;
  if (d < 0) d += PATH_LEN;
  let i = segLen.length - 1;
  while (i > 0 && segStart[i] > d) i--;
  const [x0, y0] = MAP.path[i];
  const [x1, y1] = MAP.path[(i + 1) % MAP.path.length];
  const k = segLen[i] ? (d - segStart[i]) / segLen[i] : 0;
  return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
}

export function slotCenter(slot: number): { x: number; y: number } {
  const p = MAP.slots[slot] ?? MAP.slots[0];
  return { x: p[0], y: p[1] };
}

/** The pad under a board point, or null. */
export function slotAtPoint(x: number, y: number): number | null {
  const half = (CELL - 8) / 2;
  for (let i = 0; i < SLOTS; i++) {
    const [cx, cy] = MAP.slots[i];
    if (Math.abs(x - cx) <= half && Math.abs(y - cy) <= half) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Economy / balance formulas.
// ---------------------------------------------------------------------------

export function summonCost(board: Board): number {
  return 20 + board.summons * 2;
}

export function upgradeCost(level: number): number {
  return 40 + level * 40;
}

/**
 * Wave HP: +17% per wave up to `knee`, then a gentler +12% so the late game
 * stops spiking (bot sim: median game ~9 → ~10.5 min, wider comeback window).
 * Exported as a mutable object so balance sims can sweep it.
 */
export const WAVE_CURVE = { base: 66, growth: 1.17, knee: 15, late: 1.12 };
export function waveHp(wave: number): number {
  const c = WAVE_CURVE;
  const early = Math.min(wave, c.knee) - 1;
  const late = Math.max(0, wave - c.knee);
  return Math.round(c.base * Math.pow(c.growth, early) * Math.pow(c.late, late));
}

export function killGold(kind: MobKind, wave: number): number {
  if (kind === "boss") return 40 + wave * 4;
  if (kind === "warlord") return 12 + wave;
  if (kind === "elite" || kind === "invader" || kind === "golem" || kind === "wraith") return 4 + Math.floor(wave / 4);
  return 2 + Math.floor(wave / 6);
}

export function waveBonus(wave: number): number {
  return 20 + wave * 3;
}

export function fieldLoad(board: Board): number {
  let load = 0;
  for (const m of board.mobs) if (m.hp > 0) load += 1;
  return load;
}

export function unitDamage(unit: Unit, board: Board): number {
  return UNITS[unit.kind].dmg * Math.pow(GRADE_MULT, unit.grade - 1) * (1 + UPGRADE_STEP * board.upgrades[unit.kind]);
}

export function unitInterval(unit: Unit): number {
  return Math.max(4, Math.round(UNITS[unit.kind].interval * (1 - 0.07 * (unit.grade - 1))));
}

export function unitRange(unit: Unit): number {
  return UNITS[unit.kind].range + (unit.grade - 1) * 8;
}

/** Share of the road (0..1) within `range` of a cell — how good a cell is for building. */
export function slotCoverage(slot: number, range: number): number {
  const c = slotCenter(slot);
  let hit = 0;
  const steps = 120;
  for (let i = 0; i < steps; i++) {
    const p = pathPoint((i / steps) * PATH_LEN);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx * dx + dy * dy <= range * range) hit++;
  }
  return hit / steps;
}

/** Cells ordered best-coverage first (for the base range, on the active map) — used by bots. */
export function slotPreference(): number[] {
  return slotPref;
}

export function invaderHp(grade: number, wave: number): number {
  return Math.round(waveHp(Math.max(2, wave)) * 3 * Math.pow(2.3, grade - 1));
}

export function waveCount(wave: number): number {
  return 12 + Math.floor(wave * 0.5);
}

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % BOSS_EVERY === 0;
}

// ---------------------------------------------------------------------------
// Setup.
// ---------------------------------------------------------------------------

function emptyBoard(bot: boolean): Board {
  return {
    units: Array.from({ length: SLOTS }, () => null),
    mobs: [],
    gold: START_GOLD,
    gems: START_GEMS,
    summons: 0,
    upgrades: { archer: 0, mage: 0, frost: 0, thunder: 0, poison: 0 },
    kills: 0,
    sendMeter: 0,
    alive: true,
    outAt: null,
    outWave: 0,
    bot,
    sendCd: 0,
    brace: 0,
    focus: 0,
    rageKills: 0,
    critChain: 0,
    lastCritTick: -999,
    bestCombo: 0,
    jamsSent: 0,
    jamsTaken: 0,
    jamsBlocked: 0,
    reflectsTaken: 0,
    lateWaves: 0,
    comboBonusWaves: 0,
    shots: [],
  };
}

export function startGame(
  playerCount: number,
  seed: number,
  botSeats: readonly number[] = [],
  mode: GameMode = "survival",
  limit: number | null = null,
  difficulty: Difficulty = "normal",
  map: MapId = "classic",
): MergeDefenseState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  selectMap(map);
  return {
    map: sanitizeMap(map),
    phase: "playing",
    mode: GAME_MODES.includes(mode) ? mode : "survival",
    playerCount: n,
    limit: sanitizeLimit(limit),
    difficulty: sanitizeDifficulty(difficulty),
    tick: 0,
    wave: 0,
    boards: Array.from({ length: n }, (_, seat) => emptyBoard(botSeats.includes(seat))),
    rng: seed | 0,
    nextMobId: 1,
    nextEventId: 1,
    events: [],
  };
}

function cloneState(s: MergeDefenseState): MergeDefenseState {
  return {
    ...s,
    boards: s.boards.map((b) => ({
      ...b,
      units: b.units.map((u) => (u ? { ...u } : null)),
      mobs: b.mobs.map((m) => ({ ...m })),
      upgrades: { ...b.upgrades },
      shots: [],
    })),
    events: s.events.slice(),
  };
}

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "tick"> : never) : never;

function pushEvent(s: MergeDefenseState, ev: EventBody) {
  s.events.push({ ...ev, id: s.nextEventId++, tick: s.tick } as GameEvent);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

function emptySlots(board: Board): number[] {
  const out: number[] = [];
  board.units.forEach((u, i) => {
    if (!u) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Player actions.
// ---------------------------------------------------------------------------

export function sanitizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const isSlot = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_SLOTS;
  if (a.type === "summon" || a.type === "gamble") {
    if (a.slot === undefined || a.slot === null) return { type: a.type };
    return isSlot(a.slot) ? { type: a.type, slot: a.slot } : null;
  }
  if ((a.type === "merge" || a.type === "move") && isSlot(a.a) && isSlot(a.b)) {
    if (a.a === a.b) return null;
    return { type: a.type, a: a.a, b: a.b };
  }
  if (a.type === "send" && isSlot(a.slot)) {
    if (a.to === undefined || a.to === null) return { type: "send", slot: a.slot };
    return Number.isInteger(a.to) && (a.to as number) >= 0 && (a.to as number) < MAX_PLAYERS ? { type: "send", slot: a.slot, to: a.to as number } : null;
  }
  if (a.type === "wake") return { type: "wake" };
  if (a.type === "brace") return { type: "brace" };
  if (a.type === "focus") return { type: "focus" };
  if (a.type === "hire" && HIRE_KINDS.includes(a.mob as HireKind)) {
    if (a.to === undefined || a.to === null) return { type: "hire", mob: a.mob as HireKind };
    return Number.isInteger(a.to) && (a.to as number) >= 0 && (a.to as number) < MAX_PLAYERS ? { type: "hire", mob: a.mob as HireKind, to: a.to as number } : null;
  }
  if (a.type === "upgrade" && UNIT_KINDS.includes(a.kind as UnitKind)) return { type: "upgrade", kind: a.kind as UnitKind };
  return null;
}

export function canMerge(board: Board, a: number, b: number): boolean {
  const ua = board.units[a];
  const ub = board.units[b];
  return !!ua && !!ub && a !== b && ua.kind === ub.kind && ua.grade === ub.grade && ua.grade < MAX_GRADE;
}

/** Applies one action for `seat`. Invalid / unaffordable actions are ignored (returns the same state). */
export function applyAction(state: MergeDefenseState, seat: SeatIndex, action: Action): MergeDefenseState {
  if (state.phase !== "playing") return state;
  const cur = state.boards[seat];
  if (!cur || !cur.alive) return state;
  selectMap(state.map);
  // Pads past this map's count (an action sanitized against a bigger map).
  const n = cur.units.length;
  if ("slot" in action && action.slot !== undefined && action.slot >= n) return state;
  if ("a" in action && (action.a >= n || action.b >= n)) return state;

  if (action.type === "summon") {
    if (cur.gold < summonCost(cur) || emptySlots(cur).length === 0) return state;
    if (action.slot !== undefined && cur.units[action.slot]) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gold -= summonCost(board);
    board.summons += 1;
    const slot = action.slot ?? pick(s, emptySlots(board));
    const lucky = rand(s) < 0.06;
    const grade = lucky ? 2 : 1;
    board.units[slot] = { kind: pick(s, UNIT_KINDS), grade, cd: 0 };
    pushEvent(s, { seat, type: "summon", slot, grade, lucky });
    return s;
  }

  if (action.type === "gamble") {
    if (cur.gems < GAMBLE_COST || emptySlots(cur).length === 0) return state;
    if (action.slot !== undefined && cur.units[action.slot]) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gems -= GAMBLE_COST;
    let roll = rand(s) * 100;
    const grade = (GAMBLE_ODDS.find((o) => (roll -= o.pct) < 0) ?? GAMBLE_ODDS[GAMBLE_ODDS.length - 1]).grade;
    if (grade === 0) {
      pushEvent(s, { seat, type: "gamble-fail" });
      return s;
    }
    const slot = action.slot ?? pick(s, emptySlots(board));
    board.units[slot] = { kind: pick(s, UNIT_KINDS), grade, cd: 0 };
    pushEvent(s, { seat, type: "gamble", slot, grade });
    return s;
  }

  if (action.type === "merge") {
    if (!canMerge(cur, action.a, action.b)) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    const grade = board.units[action.a]!.grade + 1;
    board.units[action.a] = null;
    board.units[action.b] = { kind: pick(s, UNIT_KINDS), grade, cd: 0 };
    pushEvent(s, { seat, type: "merge", slot: action.b, grade, from: action.a });
    return s;
  }

  if (action.type === "move") {
    if (!cur.units[action.a]) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    const moving = board.units[action.a];
    board.units[action.a] = board.units[action.b];
    board.units[action.b] = moving;
    pushEvent(s, { seat, type: "move", a: action.a, b: action.b });
    return s;
  }

  if (action.type === "send") {
    const unit = cur.units[action.slot];
    if (state.mode !== "versus" || !unit || cur.sendCd > 0 || state.wave < 1) return state;
    const to = action.to !== undefined && action.to !== seat && state.boards[action.to]?.alive ? action.to : nextAliveOpponent(state, seat);
    if (to === null) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.units[action.slot] = null;
    board.sendCd = SEND_COOLDOWN_TICKS;
    const hp = Math.round(invaderHp(unit.grade, s.wave) * difficultyHp(s));
    s.boards[to].mobs.push({
      id: s.nextMobId++,
      kind: "invader",
      hp,
      maxHp: hp,
      trav: 0,
      speed: 72,
      slowT: 0,
      slowPct: 0,
      poisonT: 0,
      poisonDps: 0,
      from: seat,
      unitKind: unit.kind,
      grade: unit.grade,
    });
    pushEvent(s, { seat, type: "invade", to, kind: unit.kind, grade: unit.grade });
    return s;
  }

  if (action.type === "focus") {
    const level = cur.focus ?? 0;
    if (level >= FOCUS_MAX || cur.gold < focusCost(level)) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gold -= focusCost(level);
    board.focus = level + 1;
    board.upgradeLog = [...(board.upgradeLog ?? []), { wave: Math.max(1, s.wave), kind: "focus", level: level + 1 }];
    pushEvent(s, { seat, type: "focus", level: level + 1 });
    return s;
  }

  if (action.type === "brace") {
    const level = cur.brace ?? 0;
    if (level >= BRACE_MAX || cur.gold < braceCost(level)) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gold -= braceCost(level);
    board.brace = level + 1;
    board.upgradeLog = [...(board.upgradeLog ?? []), { wave: Math.max(1, s.wave), kind: "brace", level: level + 1 }];
    pushEvent(s, { seat, type: "brace", level: level + 1 });
    return s;
  }

  if (action.type === "wake") {
    const stunned = cur.units.filter((u) => u?.stun).length;
    if (stunned === 0 || cur.gold < wakeCost(state.wave)) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gold -= wakeCost(s.wave);
    for (const u of board.units) if (u?.stun) u.stun = 0;
    pushEvent(s, { seat, type: "wake", count: stunned });
    return s;
  }

  if (action.type === "hire") {
    const price = hireCost(action.mob, state.wave);
    if (state.mode !== "versus" || cur.sendCd > 0 || state.wave < Math.max(1, HIRES[action.mob].minWave) || cur.gold < price) return state;
    const to = action.to !== undefined && action.to !== seat && state.boards[action.to]?.alive ? action.to : nextAliveOpponent(state, seat);
    if (to === null) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gold -= price;
    board.sendCd = SEND_COOLDOWN_TICKS;
    const road = s.boards[to].mobs;
    if (action.mob === "swarm") {
      // Slightly staggered so the flock reads as a line, not one blob.
      for (let i = 0; i < SWARM_SIZE; i++) {
        const m = makeMob(s, "fast", s.wave, seat);
        m.hp = m.maxHp = Math.round(m.maxHp * 1.3);
        m.trav = (SWARM_SIZE - 1 - i) * 9;
        road.push(m);
      }
    } else {
      road.push(makeMob(s, action.mob, s.wave, seat));
    }
    pushEvent(s, { seat, type: "hire", to, mob: action.mob });
    return s;
  }

  // upgrade
  const level = cur.upgrades[action.kind];
  if (level >= MAX_UPGRADE || cur.gold < upgradeCost(level)) return state;
  const s = cloneState(state);
  const board = s.boards[seat];
  board.gold -= upgradeCost(level);
  board.upgrades[action.kind] = level + 1;
  pushEvent(s, { seat, type: "upgrade", kind: action.kind, level: level + 1 });
  return s;
}

// ---------------------------------------------------------------------------
// Simulation step.
// ---------------------------------------------------------------------------

function makeMob(s: MergeDefenseState, kind: MobKind, wave: number, from: SeatIndex = -1): Mob {
  const base = waveHp(Math.max(1, wave)) * difficultyHp(s);
  const spec: Record<MobKind, { hp: number; speed: number }> = {
    normal: { hp: 1, speed: 60 },
    fast: { hp: 0.6, speed: 105 },
    tank: { hp: 2.8, speed: 40 },
    boss: { hp: 45, speed: 32 },
    elite: { hp: 4, speed: 70 },
    invader: { hp: 3, speed: 72 },
    golem: { hp: 9, speed: 34 },
    wraith: { hp: 2.2, speed: 112 },
    warlord: { hp: 20, speed: 38 },
  };
  const k = spec[kind];
  const hp = Math.round(base * k.hp);
  return {
    id: s.nextMobId++,
    kind,
    hp,
    maxHp: hp,
    trav: 0,
    speed: k.speed,
    slowT: 0,
    slowPct: 0,
    poisonT: 0,
    poisonDps: 0,
    from,
    ...(kind === "boss" ? { bornWave: wave } : {}),
  };
}

function spawnKindFor(wave: number, index: number): MobKind {
  if (wave >= 6 && index % 5 === 4) return "tank";
  if (wave >= 3 && index % 4 === 2) return "fast";
  return "normal";
}

function spawnWaves(s: MergeDefenseState) {
  if (s.tick < PREP_TICKS) return;
  const t = s.tick - PREP_TICKS;
  const wave = Math.floor(t / WAVE_TICKS) + 1;
  const inWave = t % WAVE_TICKS;
  if (inWave === 0) {
    s.wave = wave;
    const boss = isBossWave(wave);
    pushEvent(s, { seat: -1, type: "wave", wave, boss });
    for (const board of s.boards) {
      if (!board.alive) continue;
      if (wave > 1) earn(board, waveBonus(wave - 1));
      if (wave >= LATE_WAVE) board.lateWaves = (board.lateWaves ?? 0) + 1;
      if (wave > 1) {
        // Close out the previous wave's peak (immutable append — states share arrays).
        closeWave(board);
        board.wavePeak = fieldLoad(board);
      }
      if (boss) board.mobs.push(makeMob(s, "boss", wave));
    }
  }
  const crowd = difficultyCount(s);
  const gap = Math.max(6, Math.round(SPAWN_GAP / crowd));
  if (inWave % gap !== 0) return;
  const index = inWave / gap;
  const base = Math.round(waveCount(wave) * crowd);
  const count = isBossWave(wave) ? Math.floor(base / 2) : base;
  if (index >= count) return;
  const kind = spawnKindFor(wave, index);
  for (const board of s.boards) {
    if (board.alive) board.mobs.push(makeMob(s, kind, wave));
  }
}

/** Income of any kind: adds to the purse and to the match's earned total. */
function earn(board: Board, amount: number) {
  board.gold += amount;
  board.goldEarned = (board.goldEarned ?? 0) + amount;
}

/** Appends this wave's peak load / earned gold / kills (immutable — states share arrays). */
function closeWave(board: Board) {
  board.loadHistory = [...(board.loadHistory ?? []), board.wavePeak ?? 0];
  board.goldHistory = [...(board.goldHistory ?? []), Math.round(board.goldEarned ?? 0)];
  board.killHistory = [...(board.killHistory ?? []), board.kills];
}

function damage(mob: Mob, amount: number, type: DamageType) {
  mob.hp -= mitigated(mob.kind, amount, type);
}

function attack(s: MergeDefenseState, board: Board, slot: number, unit: Unit, ordered: Mob[]) {
  const target = ordered[0];
  const cs = critStats(board.focus ?? 0);
  const crit = rand(s) < cs.chance;
  if (crit) {
    const chain = s.tick - (board.lastCritTick ?? -999) <= COMBO.gapTicks ? (board.critChain ?? 0) + 1 : 1;
    board.critChain = chain;
    board.lastCritTick = s.tick;
    board.bestCombo = Math.max(board.bestCombo ?? 0, chain);
    const goldDue = chain === COMBO.goldAt && board.comboGoldWave !== s.wave;
    const gemDue = COMBO.gems && chain === COMBO.gemAt && board.comboGemWave !== s.wave;
    if (goldDue || gemDue) {
      const gold = goldDue ? comboGold(s.wave) : 0;
      const gems = gemDue ? 1 : 0;
      if (goldDue) {
        board.comboGoldWave = s.wave;
        if (s.wave >= LATE_WAVE) board.comboBonusWaves = (board.comboBonusWaves ?? 0) + 1;
      }
      if (gemDue) board.comboGemWave = s.wave;
      earn(board, gold);
      board.gems += gems;
      const seat = s.boards.indexOf(board);
      pushEvent(s, { seat, type: "combo", count: chain, gold, gems });
      // 유닛 대결: the combo also rattles the next opponent's strongest towers.
      const to = s.mode === "versus" ? nextAliveOpponent(s, seat) : null;
      if (to !== null) {
        const foe = s.boards[to];
        const ticks = stunTicks(foe.brace ?? 0);
        const slots = foe.units
          .map((u, i) => ({ u, i }))
          .filter((x): x is { u: Unit; i: number } => !!x.u)
          .sort((a, b) => b.u.grade - a.u.grade || a.i - b.i)
          .slice(0, gemDue ? COMBO.jam.gem : COMBO.jam.gold)
          .map((x) => x.i);
        if ((foe.brace ?? 0) >= BRACE_MAX) {
          // Max 결속 shrugs combo jams off entirely — and bounces a short stun
          // back onto the sender's strongest tower (shortened by the sender's own 결속).
          foe.jamsBlocked = (foe.jamsBlocked ?? 0) + 1;
          const back = Math.round(JAM_REFLECT.ticks * (stunTicks(board.brace ?? 0) / stunTicks(0)));
          const strongest = board.units.reduce((best, u, i) => (u && (best < 0 || u.grade > board.units[best]!.grade) ? i : best), -1);
          const reflected = back > 0 && strongest >= 0 ? strongest : undefined;
          if (reflected !== undefined) {
            board.units[reflected]!.stun = Math.max(board.units[reflected]!.stun ?? 0, back);
            board.reflectsTaken = (board.reflectsTaken ?? 0) + 1;
          }
          pushEvent(s, { seat, type: "jam", to, slots: [], blocked: true, ...(reflected !== undefined ? { reflected } : {}) });
        } else if (ticks > 0 && slots.length > 0) {
          for (const i of slots) foe.units[i]!.stun = Math.max(foe.units[i]!.stun ?? 0, ticks);
          board.jamsSent = (board.jamsSent ?? 0) + 1;
          foe.jamsTaken = (foe.jamsTaken ?? 0) + 1;
          pushEvent(s, { seat, type: "jam", to, slots });
        }
      }
    }
  }
  const dmg = unitDamage(unit, board) * (crit ? cs.mult : 1);
  const type = UNITS[unit.kind].dmgType;
  const hits: number[] = [target.id];
  switch (unit.kind) {
    case "archer":
      damage(target, dmg, type);
      if (unit.grade >= 3 && ordered[1]) {
        damage(ordered[1], dmg * 0.6, type);
        hits.push(ordered[1].id);
      }
      break;
    case "mage": {
      const radius = 55 + unit.grade * 5;
      for (const m of ordered) {
        let gap = Math.abs((m.trav % PATH_LEN) - (target.trav % PATH_LEN));
        gap = Math.min(gap, PATH_LEN - gap);
        if (gap <= radius) {
          damage(m, dmg, type);
          if (m !== target) hits.push(m.id);
        }
      }
      break;
    }
    case "frost": {
      const pct = Math.min(0.7, 0.35 + unit.grade * 0.07);
      damage(target, dmg, type);
      // Wraiths shrug off the chill.
      if (target.kind !== "wraith") {
        target.slowT = Math.max(target.slowT, 40);
        target.slowPct = Math.max(target.slowPct, target.kind === "boss" ? pct / 2 : pct);
      }
      break;
    }
    case "thunder": {
      const chain = 2 + Math.floor(unit.grade / 2);
      ordered.slice(0, chain + 1).forEach((m, i) => {
        damage(m, dmg * (i === 0 ? 1 : 0.7), type);
        if (i > 0) hits.push(m.id);
      });
      break;
    }
    case "poison": {
      damage(target, dmg, type);
      const pct = 0.025 + unit.grade * 0.01;
      const cap = dmg * 6;
      target.poisonDps = Math.max(target.poisonDps, Math.min(target.maxHp * pct, cap));
      target.poisonT = 60;
      break;
    }
  }
  const pts: number[] = [];
  for (const id of hits) {
    const m = ordered.find((o) => o.id === id);
    if (!m) continue;
    const p = pathPoint(m.trav);
    pts.push(Math.round(p.x), Math.round(p.y));
  }
  board.shots.push({ slot, kind: unit.kind, grade: unit.grade, pts, target: target.id, ...(crit ? { crit: true } : {}) });
  void s;
}

function nextAliveOpponent(s: MergeDefenseState, seat: SeatIndex): SeatIndex | null {
  for (let i = 1; i < s.playerCount; i++) {
    const other = (seat + i) % s.playerCount;
    if (s.boards[other].alive) return other;
  }
  return null;
}

export function stepGame(state: MergeDefenseState): MergeDefenseState {
  selectMap(state.map);
  if (state.phase !== "playing") return state;
  const s = cloneState(state);
  s.tick += 1;
  spawnWaves(s);

  const sends: { from: SeatIndex; to: SeatIndex }[] = [];

  s.boards.forEach((board, seat) => {
    if (!board.alive) return;

    // Movement + status effects.
    for (const m of board.mobs) {
      const slow = m.slowT > 0 ? m.slowPct : 0;
      m.trav += (m.speed * (1 - slow)) / TICKS_PER_SEC;
      if (m.slowT > 0) m.slowT -= 1;
      if (m.slowT === 0) m.slowPct = 0;
      if (m.poisonT > 0) {
        damage(m, m.poisonDps / TICKS_PER_SEC, "magic");
        m.poisonT -= 1;
        if (m.poisonT === 0) m.poisonDps = 0;
      }
    }

    if (board.sendCd > 0) board.sendCd -= 1;

    // Bosses / warlords keep calling minions — big monsters count as one head
    // but still swell the road.
    const called: Mob[] = [];
    for (const m of board.mobs) {
      const every = m.kind === "boss" ? BOSS_MINION_EVERY : m.kind === "warlord" ? WARLORD_MINION_EVERY : 0;
      if (!every || m.hp <= 0 || (s.tick + m.id) % every !== 0) continue;
      if (m.rage) continue;
      m.calls = (m.calls ?? 0) + 1;
      if (m.calls >= MINION_CAP[difficultyOf(s)]) {
        m.rage = true;
        pushEvent(s, { seat, type: "rage", trav: Math.round(m.trav), boss: m.kind === "boss" });
      }
      const minion = makeMob(s, "normal", Math.max(1, s.wave), m.from);
      minion.trav = Math.max(0, m.trav - 6);
      called.push(minion);
      pushEvent(s, { seat, type: "call", trav: Math.round(m.trav), boss: m.kind === "boss" });
    }
    board.mobs.push(...called);

    // Berserk callers smash the closest tower in reach, stunning it.
    for (const m of board.mobs) {
      if (!m.rage || m.hp <= 0 || (s.tick + m.id) % SMASH_EVERY !== 0) continue;
      const p = pathPoint(m.trav);
      let best = -1;
      let bestD = SMASH_REACH * SMASH_REACH;
      board.units.forEach((u, slot) => {
        if (!u) return;
        const c = slotCenter(slot);
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = slot;
        }
      });
      if (best < 0) continue;
      const ticks = stunTicks(board.brace ?? 0);
      if (ticks <= 0) continue;
      board.units[best]!.stun = ticks;
      board.smashesTaken = (board.smashesTaken ?? 0) + 1;
      pushEvent(s, { seat, type: "smash", trav: Math.round(m.trav), slot: best });
    }

    // Attacks — each unit hits the oldest live mob inside its own range.
    const ordered = board.mobs.filter((m) => m.hp > 0).sort((a, b) => b.trav - a.trav);
    const pos = ordered.map((m) => pathPoint(m.trav));
    board.units.forEach((unit, slot) => {
      if (!unit) return;
      if (unit.stun) {
        unit.stun -= 1;
        return;
      }
      if (unit.cd > 0) unit.cd -= 1;
      if (unit.cd > 0) return;
      const c = slotCenter(slot);
      const r2 = unitRange(unit) * unitRange(unit);
      const inRange: Mob[] = [];
      ordered.forEach((m, i) => {
        if (m.hp <= 0) return;
        const dx = pos[i].x - c.x;
        const dy = pos[i].y - c.y;
        if (dx * dx + dy * dy <= r2) inRange.push(m);
      });
      if (inRange.length === 0) return;
      attack(s, board, slot, unit, inRange);
      unit.cd = unitInterval(unit);
    });

    // Deaths + rewards.
    const survivors: Mob[] = [];
    for (const m of board.mobs) {
      if (m.hp > 0) {
        survivors.push(m);
        continue;
      }
      board.kills += 1;
      earn(board, killGold(m.kind, s.wave));
      const rageGold = m.rage ? Math.round(killGold(m.kind, s.wave) * RAGE_GOLD_BONUS) : 0;
      if (m.rage) {
        board.rageKills = (board.rageKills ?? 0) + 1;
        earn(board, rageGold);
        board.gems += 1;
      }
      if (m.kind === "golem") {
        pushEvent(s, { seat, type: "split", trav: Math.round(m.trav) });
        for (let i = 0; i < GOLEM_SPLIT; i++) {
          const pebble = makeMob(s, "normal", Math.max(1, s.wave), m.from);
          pebble.trav = Math.max(0, m.trav - i * 8);
          survivors.push(pebble);
        }
      }
      if (m.kind === "boss") {
        board.gems += 2;
        board.bossKills = [...(board.bossKills ?? []), { wave: m.bornWave ?? s.wave, at: s.wave }];
        pushEvent(s, m.rage ? { seat, type: "boss-kill", rage: true, gold: rageGold, gems: 3 } : { seat, type: "boss-kill" });
      } else if (m.kind === "warlord" && m.rage) {
        pushEvent(s, { seat, type: "boss-kill", rage: true, warlord: true, gold: rageGold, gems: 1 });
      }
      board.sendMeter += 1;
      if (board.sendMeter >= SEND_EVERY) {
        board.sendMeter = 0;
        const to = nextAliveOpponent(s, seat);
        if (to !== null) sends.push({ from: seat, to });
      }
    }
    board.mobs = survivors;
  });

  for (const { from, to } of sends) {
    if (!s.boards[to].alive) continue;
    s.boards[to].mobs.push(makeMob(s, "elite", Math.max(1, s.wave), from));
    pushEvent(s, { seat: from, type: "send", to });
  }

  for (const board of s.boards) if (board.alive) board.wavePeak = Math.max(board.wavePeak ?? 0, fieldLoad(board));

  // Eliminations — everyone over the limit this tick goes out together.
  const out: SeatIndex[] = [];
  s.boards.forEach((board, seat) => {
    if (board.alive && fieldLoad(board) >= eliminationLimit(s)) out.push(seat);
  });
  const aliveBefore = s.boards.filter((b) => b.alive).length;
  if (out.length > 0 && out.length === aliveBefore) {
    // Nobody may go out leaving zero survivors: everyone left ties for 1st.
    s.phase = "gameOver";
    return s;
  }
  for (const seat of out) {
    const board = s.boards[seat];
    board.alive = false;
    board.outAt = s.tick;
    board.outWave = s.wave;
    closeWave(board);
    pushEvent(s, { seat, type: "out" });
  }
  if (s.boards.filter((b) => b.alive).length <= 1) s.phase = "gameOver";
  return s;
}

// ---------------------------------------------------------------------------
// Rankings.
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  wave: number;
  kills: number;
  /** Longest crit chain this match. */
  combo: number;
  /** 유닛 대결 combo jams landed / suffered / blocked. */
  jamsSent: number;
  jamsTaken: number;
  jamsBlocked: number;
  reflectsTaken: number;
  /** Waves from W10 started alive / of those, waves that paid the combo gold milestone. */
  lateWaves: number;
  comboBonusWaves: number;
}

/** Survivors rank first; then later elimination is better; same-tick eliminations tie-break on kills. */
export function computeRankings(state: MergeDefenseState): RankedSeat[] {
  const rows = state.boards.map((b, seat) => ({
    seat,
    out: b.alive ? Number.POSITIVE_INFINITY : (b.outAt ?? 0),
    wave: b.alive ? state.wave : b.outWave,
    kills: b.kills,
    combo: b.bestCombo ?? 0,
    jamsSent: b.jamsSent ?? 0,
    jamsTaken: b.jamsTaken ?? 0,
    jamsBlocked: b.jamsBlocked ?? 0,
    reflectsTaken: b.reflectsTaken ?? 0,
    lateWaves: b.lateWaves ?? 0,
    comboBonusWaves: b.comboBonusWaves ?? 0,
  }));
  const sorted = [...rows].sort((a, b) => b.out - a.out || b.kills - a.kills);
  const ranked: RankedSeat[] = [];
  let rank = 1;
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    if (i > 0 && (prev.out !== r.out || prev.kills !== r.kills)) rank = i + 1;
    ranked.push({ seat: r.seat, rank, wave: r.wave, kills: r.kills, combo: r.combo, jamsSent: r.jamsSent, jamsTaken: r.jamsTaken, jamsBlocked: r.jamsBlocked, reflectsTaken: r.reflectsTaken, lateWaves: r.lateWaves, comboBonusWaves: r.comboBonusWaves });
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// Bot.
// ---------------------------------------------------------------------------

/** Pairs of slots holding identical units, lowest grade first. */
export function mergePairs(board: Board): [number, number][] {
  const pairs: [number, number][] = [];
  const used = new Set<number>();
  const order = board.units
    .map((u, i) => ({ u, i }))
    .filter((x): x is { u: Unit; i: number } => !!x.u && x.u.grade < MAX_GRADE)
    .sort((a, b) => a.u.grade - b.u.grade);
  for (const { u, i } of order) {
    if (used.has(i)) continue;
    const match = order.find((o) => o.i !== i && !used.has(o.i) && o.u.kind === u.kind && o.u.grade === u.grade);
    if (match) {
      used.add(i);
      used.add(match.i);
      pairs.push([i, match.i]);
    }
  }
  return pairs;
}

/**
 * 🤖 자동 parts a player can hand to the bot one by one. `actionPart` maps
 * every action to the part that owns it.
 */
export type AutoPart = "build" | "merge" | "upgrade" | "move" | "attack";
export const AUTO_PARTS: AutoPart[] = ["build", "merge", "upgrade", "move", "attack"];
export function actionPart(a: Action): AutoPart {
  switch (a.type) {
    case "summon":
    case "gamble":
      return "build";
    case "merge":
      return "merge";
    case "move":
      return "move";
    case "send":
    case "hire":
      return "attack";
    default:
      return "upgrade";
  }
}

/**
 * A simple greedy bot: gamble gems, fill the board, merge when full, upgrade with spare gold.
 * `auto` is the player's 🤖 자동 setup: `parts` limits it to some kinds of
 * action (with building off it merges any pair right away and stops saving
 * gold for summons), `upgradeMinGold` holds every upgrade-part buy until the
 * board has at least that much gold, and `gambleMinGems` holds 💎 도박 until
 * that many gems are banked (the caller lowers it to 1 to spend a full bank).
 */
export interface AutoOptions {
  parts?: ReadonlySet<AutoPart>;
  upgradeMinGold?: number;
  gambleMinGems?: number;
}
/** 🤖 자동 "도박은 보석 N개 모일 때까지 아끼기" choices (1 = gamble right away). */
export const AUTO_GAMBLE_SAVE = [1, 2, 3, 5];
/** 🤖 자동 "강화는 골드 N 이상일 때만" choices (0 = no condition). */
export const AUTO_UPGRADE_MIN_GOLD = [0, 200, 500, 1000, 2000];

export function chooseBotAction(state: MergeDefenseState, seat: SeatIndex, auto: AutoOptions = {}): Action | null {
  const board = state.boards[seat];
  if (!board || !board.alive || state.phase !== "playing") return null;
  selectMap(state.map);
  const ok = (p: AutoPart) => (!auto.parts || auto.parts.has(p)) && (p !== "upgrade" || board.gold >= (auto.upgradeMinGold ?? 0));
  const building = ok("build");
  const free = emptySlots(board).length;
  const cost = summonCost(board);
  const bestEmpty = slotPref.find((i) => !board.units[i]);
  if (building && board.gems >= Math.max(GAMBLE_COST, auto.gambleMinGems ?? 0) && bestEmpty !== undefined) return { type: "gamble", slot: bestEmpty };
  // 유닛 대결: a board that keeps getting combo-jammed saves up for max 결속
  // (immunity + reflect) before anything else.
  const braceNow = board.brace ?? 0;
  if (ok("upgrade") && state.mode === "versus" && state.wave >= 8 && braceNow < BRACE_MAX && (board.jamsTaken ?? 0) >= BOT_BRACE.afterJams) {
    return board.gold >= braceCost(braceNow) ? { type: "brace" } : null;
  }
  // Any mode: a board that berserk bosses keep smashing raises 결속 next
  // (one level per BOT_BRACE.afterSmashes smashes taken). Survival sim: boards
  // take ~35–49 smashes a game; at 10 per level ~96% of normal / ~50% of hard
  // bots max it, and median waves don't move — 결속 eases play, doesn't decide it.
  if (ok("upgrade") && braceNow < BRACE_MAX && (board.smashesTaken ?? 0) >= BOT_BRACE.afterSmashes * (braceNow + 1) && board.gold >= braceCost(braceNow)) {
    return { type: "brace" };
  }
  if (building && bestEmpty !== undefined && board.gold >= cost) return { type: "summon", slot: bestEmpty };
  const pairs = mergePairs(board);
  if (ok("merge") && (free === 0 || !building) && pairs.length > 0) {
    // Keep the merged unit on the better of the two cells.
    const [a, b] = pairs[0];
    const keep = slotPref.indexOf(a) < slotPref.indexOf(b) ? a : b;
    return { type: "merge", a: keep === a ? b : a, b: keep };
  }
  // 유닛 대결: a full, unmergeable board throws its weakest unit at the
  // opponent (also frees a cell for a fresh summon).
  if (ok("attack") && state.mode === "versus" && free === 0 && board.sendCd === 0 && state.wave >= 3) {
    let weakest = -1;
    board.units.forEach((u, i) => {
      if (u && u.grade <= 2 && (weakest < 0 || u.grade < board.units[weakest]!.grade)) weakest = i;
    });
    if (weakest >= 0) return { type: "send", slot: weakest };
  }
  // A full board with spare gold sharpens its crits.
  const focus = board.focus ?? 0;
  if (ok("upgrade") && state.wave >= 6 && free === 0 && focus < FOCUS_MAX && board.gold >= focusCost(focus) * 2.5) return { type: "focus" };
  // After the first boss, brace against berserk smashes once the board is full.
  const brace = board.brace ?? 0;
  if (ok("upgrade") && state.wave >= 10 && free === 0 && brace < BRACE_MAX && board.gold >= braceCost(brace) * 2) return { type: "brace" };
  // A stunned strong tower is worth waking if gold is comfortable.
  if (ok("upgrade") && board.units.some((u) => u?.stun && u.stun > 10 && u.grade >= 3) && board.gold >= wakeCost(state.wave) * 2) return { type: "wake" };
  // 유닛 대결: rich and nothing left to build → buy the priciest monster we
  // can comfortably afford for the next opponent.
  if (ok("attack") && state.mode === "versus" && free === 0 && board.sendCd === 0 && state.wave >= 4) {
    const hire = [...HIRE_KINDS].reverse().find((k) => state.wave >= HIRES[k].minWave && board.gold >= hireCost(k, state.wave) * 2);
    if (hire) return { type: "hire", mob: hire };
  }
  // Strongest unit not on a top cell → swap it there.
  const strongest = board.units.reduce((best, u, i) => (u && (best < 0 || u.grade > board.units[best]!.grade) ? i : best), -1);
  if (ok("move") && strongest >= 0) {
    const rank = slotPref.indexOf(strongest);
    const target = slotPref.slice(0, rank).find((i) => !board.units[i] || board.units[i]!.grade < board.units[strongest]!.grade);
    if (target !== undefined) return { type: "move", a: strongest, b: target };
  }
  // Spare gold → upgrade the kind with the most total grade on board.
  const weight: Record<UnitKind, number> = { archer: 0, mage: 0, frost: 0, thunder: 0, poison: 0 };
  for (const u of board.units) if (u) weight[u.kind] += Math.pow(GRADE_MULT, u.grade - 1);
  const best = [...UNIT_KINDS].filter((k) => board.upgrades[k] < MAX_UPGRADE).sort((a, b) => weight[b] - weight[a])[0];
  if (ok("upgrade") && best && weight[best] > 0 && board.gold >= upgradeCost(board.upgrades[best]) && (free === 0 || !building || board.gold >= cost + upgradeCost(board.upgrades[best]))) {
    return { type: "upgrade", kind: best };
  }
  return null;
}
