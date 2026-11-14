/**
 * 숨죽인 병동 — 규칙 수치와 공용 타입 (룰북: boardGameRule/숨죽인병동/숨죽인병동.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각). "소리 반경"은 귀신 귀까지의 **길 따라 잰 거리**
 * (벽을 뚫지 못하고 복도를 돌아간다)와 비교한다. 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다.
 */

export const GAME_ID = "hushed-ward";
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
  /** 귀신 청력 배수 */
  hear: number;
  /** 귀신 속도 배수 */
  speed: number;
  /** 🧿 시작 수호 부적 (혼자일 땐 +1) */
  charms: number;
  /** 정적(종) 간격 배수 — 작을수록 자주 */
  hushGap: number;
}

export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  easy: { label: "순한 밤", emoji: "🌙", desc: "귀가 조금 어둡고 느려요. 모두 🧿 수호 부적 1장을 갖고 시작", hear: 0.8, speed: 0.9, charms: 1, hushGap: 1.25 },
  normal: { label: "보통", emoji: "🕯️", desc: "기본 규칙", hear: 1, speed: 1, charms: 0, hushGap: 1 },
  hard: { label: "깊은 밤", emoji: "🩸", desc: "귀가 밝고 빨라요. 종이 더 자주 울려요", hear: 1.2, speed: 1.07, charms: 0, hushGap: 0.85 },
  nightmare: { label: "악몽", emoji: "💀", desc: "발소리 하나가 목숨. 숙련자용", hear: 1.4, speed: 1.13, charms: 0, hushGap: 0.7 },
};

/* ── 자리 표시: 색 + 모양 (색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#a3e635", "#f472b6"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

/** 시뮬 한 틱 (20Hz) */
export const TICK_MS = 50;
/** 시작하고 이 시간 동안 귀신은 깨어나지 않는다 (조작 익히기) */
export const GRACE_MS = 12_000;
/** 제한 시간: 새벽 3:00에 들어와 4:44에 문이 영영 닫힌다 */
export const TIME_LIMIT_MS = 12 * 60_000;
export const CLOCK_START_MIN = 180;
export const CLOCK_END_MIN = 284;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.3;
export const EYE_STAND = 1.58;
export const EYE_CROUCH = 0.95;
export const SPEED_CROUCH = 1.35;
export const SPEED_WALK = 2.6;
export const SPEED_RUN = 4.8;
/** 달리기 체력: 100에서 초당 22 줄고(약 4.5초), 안 달리면 초당 14 찬다 */
export const STAMINA_DRAIN = 22;
export const STAMINA_REGEN = 14;
/** 바닥나면 이만큼 찰 때까지 못 달린다 */
export const STAMINA_MIN_RUN = 25;

/** 이동 상태: 0 멈춤 · 1 앉아 걷기 · 2 걷기 · 3 달리기 */
export type MoveMode = 0 | 1 | 2 | 3;

/* ── 소리 (반경 m) ───────────────────────────────────────────────────── */

export const NOISE_WALK = 5;
export const NOISE_RUN = 13;
/** 평소엔 앉아 걸으면 무음. 정적(종) 중에는 이만큼 들린다 */
export const NOISE_CROUCH_HUSH = 1.2;
export const NOISE_DOOR = 7;
export const NOISE_SEARCH = 3;
export const NOISE_REVIVE = 2.5;
export const NOISE_BOTTLE = 16;
export const NOISE_GASP = 9;
export const NOISE_PLACE = 14;
export const NOISE_EXIT = 40;
/** 심장 소리: 공포 65↑ / 85↑ */
export const NOISE_BEAT_1 = 4;
export const NOISE_BEAT_2 = 6.5;
/** 발소리·뒤지는 소리가 귀신에게 전해지는 간격 */
export const NOISE_EVERY_MS = 400;
/** 닫힌 문 하나가 소리를 이만큼(거리) 막는다 */
export const DOOR_MUFFLE = 5;

/* ── 공포 · 숨 · 손전등 ─────────────────────────────────────────────── */

export const FEAR_DARK = 2.0;
export const FEAR_LIT = -1.6;
/** 귀신이 이 거리(길) 안이면 가까울수록 최대 초당 FEAR_GHOST 오른다 */
export const FEAR_GHOST_R = 10;
export const FEAR_GHOST = 7;
export const FEAR_HUSH = 1.5;
/** 동료가 이 거리 안이면 진정 */
export const FEAR_MATE_R = 5;
export const FEAR_MATE = -0.8;
export const FEAR_BEAT_1 = 65;
export const FEAR_BEAT_2 = 85;
export const BEAT_MS_1 = 900;
export const BEAT_MS_2 = 600;
/** 동료가 눈앞에서 붙잡히면 */
export const FEAR_WITNESS = 15;
export const FEAR_WITNESS_R = 8;
export const PILL_CALM = 55;

/** 숨 참기: 최대 6초. 다 쓰면 "헉!" 소리가 나고 3초 동안 못 참는다 */
export const BREATH_MAX = 6;
export const BREATH_REGEN = 0.7;
export const GASP_LOCK_MS = 3000;

/** 손전등: 100%로 170초. 시작은 80% */
export const BATTERY_START = 80;
export const BATTERY_SEC = 170;
export const BATTERY_PACK = 55;

/* ── 소지품 ─────────────────────────────────────────────────────────── */

export const MAX_BOTTLES = 2;
export const MAX_PILLS = 2;
export type ItemKind = "talisman" | "battery" | "bottle" | "pill" | "charm" | "empty";
export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string }> = {
  talisman: { emoji: "🧧", name: "봉인 부적", desc: "기도실 제단에 붙여야 하는 부적" },
  battery: { emoji: "🔋", name: "건전지", desc: `손전등 +${BATTERY_PACK}%` },
  bottle: { emoji: "🍾", name: "빈 약병", desc: "던지면 깨지는 소리로 귀신을 그쪽으로 보낸다" },
  pill: { emoji: "💊", name: "진정제", desc: `공포 -${PILL_CALM}` },
  charm: { emoji: "🧿", name: "수호 부적", desc: "붙잡힐 때 한 번 대신 타 버리고 귀신을 잠깐 멈춘다" },
  empty: { emoji: "🕸️", name: "빈 서랍", desc: "아무것도 없다" },
};

/** 인원별 필요한 봉인 부적 수 */
export function talismansFor(seatCount: number): number {
  return seatCount <= 1 ? 3 : seatCount === 2 ? 4 : seatCount === 3 ? 5 : 6;
}

/* ── 상호작용 ───────────────────────────────────────────────────────── */

export const USE_RANGE = 2.4;
export const DOOR_RANGE = 2.2;
export const SEARCH_MS = 2000;
export const PLACE_MS = 2500;
export const REVIVE_MS = 4000;
export const REVIVE_RANGE = 2.0;
export const EXIT_RANGE = 1.9;
/** 쓰러진 뒤 이 시간 안에 못 일으키면 끝 */
export const BLEED_MS = 70_000;
export const REVIVE_FEAR = 50;

/* ── 귀신 "청귀(聽鬼)" ──────────────────────────────────────────────── */

export const GHOST_ROAM = 1.5;
export const GHOST_INVESTIGATE = 2.7;
export const GHOST_HUNT = 4.3;
/** 부적 한 장 붙을 때마다 */
export const RAGE_ROAM = 0.12;
export const RAGE_HUNT = 0.07;
export const RAGE_HEAR = 0.06;
/** 사람이 많을수록 귀가 조금 밝아진다 (한 명 늘 때마다) */
export const CROWD_HEAR = 0.05;
/** 정적 중에 들켜 시작한 추격 */
export const ENRAGED_SPEED = 1.12;
/** 몸이 닿는 거리 (어떤 상태든) / 추격 중 낚아채는 거리 */
export const BUMP_R = 0.55;
export const GRAB_R = 1.0;
/** 경계심: 들릴 때마다 쌓이고 초당 ALERT_DECAY 줄어든다. ALERT_HUNT를 넘으면 추격 */
export const ALERT_HUNT = 6;
export const ALERT_DECAY = 0.6;
/** 이 거리(길) 안에서 난 소리는 바로 추격 */
export const HUNT_NEAR = 4;
export const LISTEN_MS = 3500;
/** 추격 중 이 시간 동안 아무 소리도 못 들으면 놓친다 */
export const HUNT_MEMORY_MS = 2600;
export const FEED_MS = 3200;
export const CHARM_STUN_MS = 5500;
/** 붙잡은 뒤 한동안 귀가 어두워지고 멀리 떠난다 */
export const SATED_MS = 11_000;
export const SATED_HEAR = 0.45;
export const GHOST_DOOR_MS = 800;
/** 병 깨지는 소리는 추격 대상이 이 거리보다 멀 때만 귀신을 돌려세운다 */
export const BOTTLE_DIVERT_R = 4.5;

/* ── 정적 (종) ──────────────────────────────────────────────────────── */

export const HUSH_FIRST_MS: [number, number] = [45_000, 60_000];
export const HUSH_GAP_MS: [number, number] = [55_000, 80_000];
export const HUSH_GAP_RAGE_MS = 4000;
export const HUSH_GAP_MIN_MS = 34_000;
export const HUSH_WARN_MS = 3500;
export const HUSH_MS = 5000;
/** 정적 중 모든 소리 반경 배수 */
export const HUSH_MUL = 3;

/* ── 약병 던지기 ────────────────────────────────────────────────────── */

export const THROW_MIN = 4;
export const THROW_MAX = 12;
export const THROW_SPEED = 11;

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
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
