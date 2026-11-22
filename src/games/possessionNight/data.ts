/**
 * 빙의의 밤 — 규칙 수치와 공용 타입 (룰북: boardGameRule/빙의의밤/빙의의밤.md).
 *
 * 1 대 다수 비대칭 1인칭 공포: 한 명은 몸이 보이지 않는 👻 원귀, 나머지는 🧿 퇴마사.
 * 퇴마사는 고택 곳곳에 숨은 저주받은 물건을 찾아 마당 화로에 태우고, 다 태우면 화로 앞에서 퇴마 의식을 마친다.
 * 원귀는 직접 때리지 못한다 — 속삭임·덜컹·소등·현신으로 **공포**를 키우고, 겁에 질려 혼자 남은 사람에게
 * 빙의한다. 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각). 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다.
 */

export const GAME_ID = "possession-night";
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/** 원귀를 누가 맡나: 무작위 · 방장(1번 자리) · 특정 자리 번호 */
export type GhostPick = "random" | number;

export interface GameOptions {
  difficulty: Difficulty;
  ghost: GhostPick;
}

export const DEFAULT_OPTIONS: GameOptions = { difficulty: "normal", ghost: "random" };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const d = o?.difficulty;
  const g = o?.ghost;
  return {
    difficulty: d === "easy" || d === "hard" ? d : "normal",
    ghost: typeof g === "number" && Number.isInteger(g) && g >= 0 && g < MAX_PLAYERS ? g : "random",
  };
}

export interface DifficultyInfo {
  label: string;
  emoji: string;
  desc: string;
  /** 퇴마사 공포가 차오르는 속도 배수 */
  fear: number;
  /** 원귀 원한(기력) 회복 배수 */
  energy: number;
  /** 시작 성수 (사람마다) */
  water: number;
}

/** 난이도는 **퇴마사 쪽** 기준 — 쉬움이면 퇴마사가 유리 */
export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  easy: { label: "보름달", emoji: "🌕", desc: "공포가 천천히 차고 원귀의 원한이 느리게 모여요. 퇴마사에게 유리", fear: 0.82, energy: 0.85, water: 2 },
  normal: { label: "그믐", emoji: "🌘", desc: "기본 규칙 (양쪽 승률이 비슷하게 맞춘 값)", fear: 1, energy: 1, water: 1 },
  hard: { label: "삭월", emoji: "🌑", desc: "달도 없는 밤. 공포가 빨리 차고 원귀가 강해요. 원귀에게 유리", fear: 1.07, energy: 1.07, water: 1 },
};

/* ── 자리 표시: 색 + 모양 (색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#a3e635", "#f472b6", "#c084fc", "#fb7185"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "✚"] as const;
export const GHOST_COLOR = "#9fe3ff";

/* ── 시간 ───────────────────────────────────────────────────────────── */

/** 시뮬 한 틱 (20Hz) */
export const TICK_MS = 50;
/** 시작하고 이 시간 동안 원귀는 힘을 못 쓴다 (모두 조작 익히기) */
export const GRACE_MS = 15_000;
/** 제한 시간: 밤 11시에 시작해 닭이 우는 새벽 5시까지 (9분) — 그때까지 퇴마하지 못하면 원귀 승 */
export const TIME_LIMIT_MS = 9 * 60_000;
export const CLOCK_START_MIN = 23 * 60;
export const CLOCK_END_MIN = 29 * 60;

/* ── 퇴마사 몸 ──────────────────────────────────────────────────────── */

export const BODY_R = 0.3;
export const EYE = 1.6;
export const SPEED_WALK = 2.7;
export const SPEED_RUN = 4.5;
export const BACK_MUL = 0.65;
export const STAMINA_DRAIN = 22;
export const STAMINA_REGEN = 14;
export const STAMINA_MIN_RUN = 25;

/** 이동 상태: 0 멈춤 · 2 걷기 · 3 달리기 */
export type MoveMode = 0 | 2 | 3;

/* ── 원귀 몸 ────────────────────────────────────────────────────────── */

/** 벽을 뚫고 떠다닌다 (고택 담장 안에서만) */
export const GHOST_SPEED = 3.1;
/** 현신·드러남 중엔 느려진다 */
export const GHOST_SLOW = 1.5;
export const GHOST_EYE = 1.75;
/** 마당 화로의 결계 — 원귀는 이 안으로 못 들어온다 */
export const WARD_R = 3.2;
/** 원한(기력) */
export const ENERGY_MAX = 100;
export const ENERGY_REGEN = 3.4;
/** 퇴마사가 많을수록 원한이 빨리 모인다 (2명 기준 1배, 한 명 늘 때마다 +ENERGY_PER_HUNTER) */
export const ENERGY_PER_HUNTER = 0.28;
export function energyScale(hunters: number): number {
  return 1 + Math.max(0, hunters - 2) * ENERGY_PER_HUNTER;
}
/** 누군가 공황에 빠질 때마다 원한이 더 모인다 */
export const ENERGY_PANIC_BONUS = 12;
/** 원귀가 처음 나타나는 곳은 퇴마사 모두에게서 길로 이만큼 떨어진 곳 */
export const GHOST_SPAWN_MIN = 16;

/* ── 공포 ───────────────────────────────────────────────────────────── */

/** 공포 0~100 (초당) */
export const FEAR_ALONE = 1.1;
/** 혼자 하는 판(퇴마사 1명)은 "혼자" 공포가 이만큼만 찬다 — 늘 혼자니까 */
export const SOLO_ALONE_MUL = 0.4;
export const FEAR_DARK = 0.9;
/** 손전등까지 꺼져 있으면 더 */
export const FEAR_NO_LIGHT = 0.8;
export const FEAR_TOGETHER = -1.9;
export const FEAR_LIT = -1.6;
export const FEAR_COURTYARD = -1.0;
/** 원귀가 이 거리 안에 있으면 한기 (입김이 보인다) */
export const CHILL_R = 5;
export const FEAR_CHILL = 1.4;
export const FEAR_CARRY = 0.5;
/** 동료가 이 거리 안에 서 있으면 "함께" */
export const BUDDY_R = 6;
/** 이 공포부터 빙의당할 수 있다 (혼자일 때) */
export const POSSESS_FEAR = 75;
/** 공황: 동료 곁이어도 빙의당한다. 달리지 못하고 손전등이 깜빡인다 */
export const PANIC_FEAR = 100;
/** 공황에서 풀리는 공포 */
export const PANIC_CLEAR = 70;

/* ── 원귀의 힘 ──────────────────────────────────────────────────────── */

export type PowerKind = "whisper" | "slam" | "snuff" | "manifest" | "possess" | "quench";
export const POWER_ORDER: PowerKind[] = ["whisper", "slam", "snuff", "manifest", "possess", "quench"];

export interface PowerInfo {
  key: string;
  emoji: string;
  name: string;
  cost: number;
  cdMs: number;
  desc: string;
}

export const POWERS: Record<PowerKind, PowerInfo> = {
  whisper: { key: "1", emoji: "🗣️", name: "속삭임", cost: 18, cdMs: 6000, desc: "7m 안 가장 가까운 퇴마사 귀에 속삭인다 — 그 사람만 듣는다. 공포 +12 (혼자면 +24)" },
  slam: { key: "2", emoji: "💥", name: "덜컹", cost: 20, cdMs: 7000, desc: "3m 안 장롱·문을 덜컹 — 10m 안 모두 공포 +12 (혼자면 +18), 거기를 뒤지던 사람은 처음부터 다시" },
  snuff: { key: "3", emoji: "🕯️", name: "소등", cost: 25, cdMs: 12_000, desc: "지금 방의 등잔을 끄고, 7m 안 손전등을 6초 동안 꺼뜨린다 (공포 +8)" },
  manifest: { key: "4", emoji: "👁️", name: "현신", cost: 40, cdMs: 18_000, desc: "2.5초 동안 모습을 드러낸다 — 14m 안에서 나를 본 사람 공포 +35, 못 본 사람 +12. 그동안 느리고 위치가 들킨다" },
  possess: { key: "E", emoji: "👻", name: "빙의", cost: 30, cdMs: 12_000, desc: "2.2m 안, 공포 75 이상인데 6m 안에 서 있는 동료가 없는 사람(공황이면 동료가 있어도)에게 씐다" },
  quench: { key: "5", emoji: "🌫️", name: "불길 꺾기", cost: 35, cdMs: 10_000, desc: "퇴마 의식 중 화로 6m 안에서 — 의식 진행 -25%" },
};

export const WHISPER_R = 7;
export const WHISPER_FEAR = 12;
export const WHISPER_FEAR_ALONE = 24;
export const SLAM_R = 3;
export const SLAM_HEAR_R = 10;
export const SLAM_FEAR = 12;
export const SLAM_FEAR_ALONE = 18;
export const SNUFF_R = 7;
export const SNUFF_MS = 6000;
export const SNUFF_FEAR = 8;
export const MANIFEST_MS = 2500;
export const MANIFEST_R = 14;
export const MANIFEST_FEAR = 35;
export const MANIFEST_FEAR_SIDE = 12;
/** 현신을 "봤다" = 시선 원뿔(반각) 안 */
export const MANIFEST_CONE = 0.95;
export const POSSESS_R = 2.2;
export const QUENCH_R = 6;
export const QUENCH_LOSS = 25;

/** 등잔 불빛·손전등에 비친 원귀는 희미한 그림자로 보인다 */
export const SHIMMER_LIT_R = 9;
export const SHIMMER_BEAM_R = 7;
export const SHIMMER_CONE = 0.45;

/* ── 퇴마사 도구 ────────────────────────────────────────────────────── */

/** 손전등 100%로 240초 */
export const BATTERY_SEC = 240;
export const BATTERY_PACK = 50;
export const LIGHT_CONE = 0.5;

/** 🔮 영기 탐지기: 원귀까지 거리 → 0~3칸 */
export function emfLevel(d: number): number {
  return d <= 4 ? 3 : d <= 8 ? 2 : d <= 14 ? 1 : 0;
}

/** 💧 성수: 앞으로 뿌린다 */
export const WATER_R = 4.5;
export const WATER_CONE = 0.7;
export const WATER_STUN_MS = 4000;
export const WATER_REVEAL_MS = 6000;
export const WATER_DRAIN = 25;
export const MAX_WATER = 3;
/** 🍵 청심환 */
export const TEA_CALM = 45;
export const MAX_TEA = 2;
/** 저주받은 물건은 한 번에 둘까지 */
export const MAX_CARRY = 2;

export type ItemKind = "curse" | "water" | "tea" | "battery" | "empty";
export const ITEM_ORDER: ItemKind[] = ["empty", "curse", "water", "tea", "battery"];
export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string }> = {
  curse: { emoji: "🪆", name: "저주받은 물건", desc: "마당 화로에 태워야 한다 — 들고 있으면 마음이 무겁다 (공포가 더 찬다)" },
  water: { emoji: "💧", name: "성수", desc: "앞으로 뿌리면 거기 있던 원귀가 4초 묶이고 모습이 드러난다" },
  tea: { emoji: "🍵", name: "청심환", desc: `먹으면 공포 -${TEA_CALM}` },
  battery: { emoji: "🔋", name: "건전지", desc: `손전등 +${BATTERY_PACK}%` },
  empty: { emoji: "🕸️", name: "빈 곳", desc: "아무것도 없다" },
};

/** 저주받은 물건 이름 (화면 표시용, 번호마다) */
export const CURSE_NAMES = ["깨진 손거울", "피 묻은 비녀", "머리카락 인형", "찢어진 혼서지", "녹슨 은장도", "짝 잃은 꽃신", "얼룩진 노리개", "타다 만 위패"];

/** 퇴마사 수별 태워야 할 물건 수 */
export function cursesFor(hunters: number): number {
  return hunters <= 1 ? 3 : hunters === 2 ? 4 : hunters === 3 ? 5 : hunters === 4 ? 6 : 7;
}

/* ── 상호작용 ───────────────────────────────────────────────────────── */

export const USE_RANGE = 2.4;
export const SEARCH_MS = 3000;
export const BURN_MS = 2200;
export const BURN_R = 2.6;
export const LANTERN_MS = 1200;
export const REVIVE_MS = 4000;
export const REVIVE_RANGE = 2.0;
export const PICK_MS = 700;
/** 빙의된 사람은 동료가 퇴마해 주거나, 이 시간이 지나면 스스로 깨어난다 (혼자 하는 판은 짧게) */
export function selfWakeMs(hunters: number): number {
  return hunters <= 1 ? 7000 : 25_000;
}
/** 👻 원귀는 혼을 이만큼 빼앗으면(빙의 횟수, 깨어나도 센다) 이긴다 */
export function soulsFor(hunters: number): number {
  return [3, 3, 5, 6, 7, 6][Math.max(0, Math.min(5, hunters))];
}
/** 풀려난 직후 잠깐 안전 + 공포 */
export const SAFE_MS = 5000;
export const REVIVED_FEAR = 40;

/** 🔥 퇴마 의식: 화로 곁(3.5m)에 선 사람 수에 따라 초당 % */
export const RITUAL_R = 3.5;
export function ritualRate(n: number): number {
  return n <= 0 ? 0 : n === 1 ? 3.5 : n === 2 ? 5 : 6;
}

/* ── 결과 ───────────────────────────────────────────────────────────── */

export function clockText(tMs: number): string {
  const k = Math.max(0, Math.min(1, tMs / TIME_LIMIT_MS));
  const m = Math.floor(CLOCK_START_MIN + (CLOCK_END_MIN - CLOCK_START_MIN) * k);
  const h = Math.floor(m / 60) % 24;
  return `${h}:${String(m % 60).padStart(2, "0")}`;
}
