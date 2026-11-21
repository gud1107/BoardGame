/**
 * 마네킹 백화점 — 규칙 수치와 공용 타입 (룰북: boardGameRule/마네킹백화점/마네킹백화점.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각). 핵심 규칙은 하나 — **살아 있는 마네킹은 누군가 보고 있으면
 * 움직이지 못한다.** "본다" = 살아 있는 사람의 시선 원뿔 안 + 벽·진열장에 안 가림 + 거리 안
 * (손전등을 켜면 멀리, 끄면 코앞만). 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다.
 */

export const GAME_ID = "mannequin-mall";
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;

export type Difficulty = "easy" | "normal" | "hard" | "nightmare";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "nightmare"];

export interface GameOptions {
  difficulty: Difficulty;
}

export const DEFAULT_OPTIONS: GameOptions = { difficulty: "normal" };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const d = o?.difficulty;
  return { difficulty: d === "easy" || d === "hard" || d === "nightmare" ? d : "normal" };
}

export interface DifficultyInfo {
  label: string;
  emoji: string;
  desc: string;
  /** 마네킹 속도 배수 */
  speed: number;
  /** 처음부터 깨어 있는 마네킹 수에 더하는 값 */
  extraAwake: number;
  /** 정전 간격 배수 — 작을수록 자주 */
  flickerGap: number;
  /** 시작할 때 모두 갖는 📸 카메라 */
  cameras: number;
  /** 시작 건전지 */
  battery: number;
}

export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  easy: { label: "순한 밤", emoji: "🌙", desc: "마네킹이 느리고 정전이 드물어요. 모두 📸 카메라 1개를 갖고 시작", speed: 0.82, extraAwake: 0, flickerGap: 1.3, cameras: 1, battery: 90 },
  normal: { label: "보통", emoji: "🛍️", desc: "기본 규칙", speed: 1, extraAwake: 0, flickerGap: 1, cameras: 0, battery: 85 },
  hard: { label: "야간 재고 조사", emoji: "🩸", desc: "마네킹 하나가 더 깨어 있고 더 빨라요. 정전이 잦아요", speed: 1.1, extraAwake: 1, flickerGap: 0.85, cameras: 0, battery: 80 },
  nightmare: { label: "악몽", emoji: "💀", desc: "눈 한 번 돌리면 끝. 숙련자용", speed: 1.22, extraAwake: 1, flickerGap: 0.7, cameras: 0, battery: 65 },
};

/* ── 자리 표시: 색 + 모양 (색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#a3e635", "#f472b6"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

/** 시뮬 한 틱 (20Hz) */
export const TICK_MS = 50;
/** 시작하고 이 시간 동안 마네킹은 깨어나지 않는다 (조작 익히기) */
export const GRACE_MS = 10_000;
/** 제한 시간: 밤 10시 폐점 뒤 갇혀서, 자정에 셔터가 영영 잠긴다 */
export const TIME_LIMIT_MS = 12 * 60_000;
export const CLOCK_START_MIN = 22 * 60;
export const CLOCK_END_MIN = 24 * 60;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.3;
export const EYE = 1.6;
export const SPEED_WALK = 2.7;
export const SPEED_RUN = 4.6;
/** 뒷걸음질은 느리다 (보면서 물러나기) */
export const BACK_MUL = 0.62;
/** 달리기 체력: 100에서 초당 24 줄고, 안 달리면 초당 15 찬다 */
export const STAMINA_DRAIN = 24;
export const STAMINA_REGEN = 15;
export const STAMINA_MIN_RUN = 25;

/** 이동 상태: 0 멈춤 · 2 걷기 · 3 달리기 */
export type MoveMode = 0 | 2 | 3;

/* ── 시선 ───────────────────────────────────────────────────────────── */

/** 손전등을 켜면: 이 거리·원뿔(반각, 라디안) 안이면 본다 */
export const LIGHT_RANGE = 17;
export const LIGHT_CONE = 0.5;
/** 손전등을 끄면 어둠에 익은 눈으로 코앞만 */
export const DARK_RANGE = 4;
export const DARK_CONE = 0.75;
/** 마네킹 가슴 높이 (위아래 시선 판정 기준) */
export const MANNEQUIN_EYE_Y = 1.25;
/** 악몽은 손전등 원뿔이 좁다 */
export const NIGHTMARE_CONE = 0.42;

/* ── 손전등 ─────────────────────────────────────────────────────────── */

/** 100%로 200초 */
export const BATTERY_SEC = 200;
export const BATTERY_PACK = 50;

/* ── 마네킹 ─────────────────────────────────────────────────────────── */

/** 진열된 마네킹 중 처음 깨어 있는 수 (인원별) */
export function awakeAtStart(seatCount: number, d: Difficulty): number {
  return (seatCount >= 3 ? 2 : 1) + DIFFICULTY_INFO[d].extraAwake;
}
/** 아무도 안 볼 때 기본 속도 */
export const MQ_SPEED = 3.0;
/** 퓨즈 하나 꽂을 때마다 더 빨라진다 */
export const MQ_RAGE_SPEED = 0.12;
/** 정전 중에는 이만큼 더 빨리 */
export const MQ_DARK_MUL = 1.35;
/** 이 거리 안에서 아무도 안 보면 붙잡는다 */
export const GRAB_R = 0.8;
/** 붙잡은 뒤 멈춰 있는 시간 */
export const MQ_REST_MS = 4500;
/** 사람 하나에게 몰리지 않게 마네킹끼리 이만큼 떨어진다 */
export const MQ_SEP = 0.9;
/** 움직일 때 "삐걱" 소리가 들리는 거리 (화면 표시도 같은 거리) */
export const CREAK_R = 15;
/** 깨어나는 마네킹은 모든 사람에게서 길로 이만큼 떨어진 것 중에서 고른다 */
export const WAKE_MIN_DIST = 12;
/** 포즈 가짓수 (움직일 때마다 바뀐다) */
export const POSES = 7;
/**
 * 노려보기: 켠 손전등으로 이 거리 안에서 계속 비추면 "응시"가 차오르고, 다 차면 마네킹이 와르르 쓰러져
 * 한동안 못 움직인다. 두 사람이 함께 비추면 두 배로 빨리 찬다. 안 비추면 천천히 빠진다.
 */
export const STARE_RANGE = 11;
export const STARE_MS = 3200;
export const STARE_DECAY = 0.3;
export const TOPPLE_MS = 20_000;
/** 쓰러진 뒤 일어설 때마다 응시에 더 오래 버틴다 */
export const STARE_TOUGHEN = 0.25;
/** 이 거리(길)보다 먼 사람에게는 느릿느릿 다가간다 */
export const MQ_FAR = 22;
export const MQ_FAR_SPEED = 1.6;

/* ── 정전 (깜빡임) ──────────────────────────────────────────────────── */

export const FLICKER_FIRST_MS: [number, number] = [45_000, 60_000];
export const FLICKER_GAP_MS: [number, number] = [50_000, 75_000];
export const FLICKER_GAP_MIN_MS = 30_000;
export const FLICKER_WARN_MS = 2600;
export const FLICKER_MS = 1600;
/** 퓨즈를 꽂으면 이만큼 뒤에 전력이 출렁인다 (경고 포함) */
export const FLICKER_AFTER_FUSE_MS = 5000;

/* ── 소지품 ─────────────────────────────────────────────────────────── */

export const MAX_CAMERAS = 2;
export const MAX_RIBBONS = 2;
export type ItemKind = "fuse" | "battery" | "camera" | "ribbon" | "empty";
export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string }> = {
  fuse: { emoji: "⚡", name: "셔터 퓨즈", desc: "가운데 배전반에 꽂아야 하는 퓨즈" },
  battery: { emoji: "🔋", name: "건전지", desc: `손전등 +${BATTERY_PACK}%` },
  camera: { emoji: "📸", name: "일회용 카메라", desc: "플래시를 터뜨리면 앞쪽 마네킹이 잠깐 굳고 정체가 드러난다" },
  ribbon: { emoji: "🎀", name: "포장 끈", desc: "바로 앞 마네킹을 묶는다 — 살아 있는 것이면 한동안 못 움직이고, 아니면 그냥 마네킹" },
  empty: { emoji: "🕸️", name: "빈 상자", desc: "아무것도 없다" },
};

/** 인원별 필요한 퓨즈 수 */
export function fusesFor(seatCount: number): number {
  return seatCount <= 1 ? 3 : seatCount === 2 ? 4 : seatCount === 3 ? 5 : 6;
}

/* ── 상호작용 ───────────────────────────────────────────────────────── */

export const USE_RANGE = 2.4;
export const SEARCH_MS = 2200;
export const PLACE_MS = 2500;
export const REVIVE_MS = 4000;
export const REVIVE_RANGE = 2.0;
export const BIND_MS = 2000;
export const BIND_RANGE = 1.8;
export const BIND_HOLD_MS = 40_000;
export const EXIT_RANGE = 1.9;
/** 굳은(붙잡힌) 뒤 이 시간 안에 못 풀어 주면 영영 마네킹이 된다 */
export const BLEED_MS = 60_000;

/** 카메라 플래시 */
export const FLASH_RANGE = 18;
export const FLASH_CONE = 0.8;
export const FLASH_STUN_MS = 6500;
/** 정체가 드러난 마네킹은 이 시간 동안 눈이 붉게 빛난다 (모두에게 보인다) */
export const REVEAL_MS = 15_000;

/* ── 결과 ───────────────────────────────────────────────────────────── */

export type Grade = "S" | "A" | "B" | "C" | "F";

export function gradeOf(escaped: number, seatCount: number, everDown: number): Grade {
  if (escaped <= 0) return "F";
  if (escaped >= seatCount) return everDown === 0 ? "S" : "A";
  return escaped * 2 >= seatCount ? "B" : "C";
}

export function clockText(tMs: number): string {
  const k = Math.max(0, Math.min(1, tMs / TIME_LIMIT_MS));
  const m = Math.floor(CLOCK_START_MIN + (CLOCK_END_MIN - CLOCK_START_MIN) * k);
  const h = Math.floor(m / 60) % 24;
  return `${h === 0 ? "0" : h}:${String(m % 60).padStart(2, "0")}`;
}
