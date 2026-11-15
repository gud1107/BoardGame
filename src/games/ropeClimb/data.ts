/**
 * 한 줄 등반대 — 규칙 수치와 공용 타입 (룰북: boardGameRule/한줄등반대/한줄등반대.md).
 *
 * 단위: 거리 m(벽 한 칸 = 1m), 속도 m/s, 시간 ms(시뮬 시각). 체력은 0~100.
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(산별 완등률·걸린 시간·레벨 차이).
 */

export const GAME_ID = "rope-climbers";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export type CourseId = "hill" | "ice" | "volcano";
export const COURSE_IDS: CourseId[] = ["hill", "ice", "volcano"];

export interface GameOptions {
  /** 어느 산을 오르나 */
  course: CourseId;
  /** ⛑ 팀 추락 허용 횟수 */
  lives: 2 | 3 | 5;
}

export const DEFAULT_OPTIONS: GameOptions = { course: "hill", lives: 3 };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const course = o?.course === "ice" || o?.course === "volcano" ? o.course : "hill";
  const lives = o?.lives === 2 || o?.lives === 5 ? o.lives : 3;
  return { course, lives };
}

/* ── 자리 표시: 색 + 모양(색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록"] as const;

/* ── 벽 ─────────────────────────────────────────────────────────────── */

/** 벽 너비 (칸). x는 −WALL_W/2 ~ +WALL_W/2 */
export const WALL_W = 14;

/** 칸 종류 */
export const ROCK = 0;
/** 매끈한 암반 — 잡을 수 없다 */
export const SMOOTH = 1;
/** 바위 턱 — 서서 쉰다 (체력 회복) */
export const LEDGE = 2;
/** 부서지는 바위 — 잡고 1.6초 뒤 떨어져 나간다 */
export const CRUMBLY = 3;
/** 오버행 — 잡을 수 있지만 체력이 빨리 닳고 느리다 */
export const OVERHANG = 4;
export type Cell = 0 | 1 | 2 | 3 | 4;

export const CELL_INFO: Record<Cell, { name: string; mark: string; desc: string }> = {
  0: { name: "바위", mark: "", desc: "평범하게 잡고 오를 수 있어요." },
  1: { name: "매끈한 암반", mark: "〰", desc: "잡을 수 없어요. 도약하거나, 줄에 매달려 끌려 올라가야 해요." },
  2: { name: "바위 턱", mark: "▬", desc: "서서 쉬는 곳. 체력이 빠르게 차요." },
  3: { name: "부서지는 바위", mark: "✕", desc: "잡은 지 1.6초 뒤 떨어져 나가요. 빨리 지나가세요." },
  4: { name: "오버행", mark: "▼", desc: "잡을 수 있지만 느리고 체력이 2배 넘게 닳아요." },
};

export interface CourseSpec {
  id: CourseId;
  name: string;
  emoji: string;
  /** 정상 높이 (칸) */
  height: number;
  /** 중간 캠프(체크포인트) 수 */
  camps: number;
  /** 장애물 사이 간격 (칸) */
  gapMin: number;
  gapMax: number;
  /** 나올 수 있는 장애물 */
  kinds: ObstacleKind[];
  /** 낙석 주기 (ms, 0 = 없음) */
  rockEvery: number;
  /** 돌풍 주기 (ms, 0 = 없음) */
  windEvery: number;
  /** 제한 시간 */
  limitMs: number;
  /** ⭐⭐⭐ 기준 시간 */
  parMs: number;
  /** 난이도 별 (표시용) */
  stars: 1 | 2 | 3;
  desc: string;
}

export type ObstacleKind = "band2" | "band3" | "patch" | "crumble" | "roof" | "chimney";

export const COURSES: Record<CourseId, CourseSpec> = {
  hill: {
    id: "hill",
    name: "솔바람 뒷산",
    emoji: "🌲",
    height: 34,
    camps: 2,
    gapMin: 4,
    gapMax: 6,
    kinds: ["patch", "band2", "crumble", "patch"],
    rockEvery: 11_000,
    windEvery: 0,
    limitMs: 240_000,
    parMs: 110_000,
    stars: 1,
    desc: "처음 오르기 좋은 산. 매끈한 띠가 얕고 낙석이 드물어요.",
  },
  ice: {
    id: "ice",
    name: "칼바람 빙벽",
    emoji: "🏔️",
    height: 46,
    camps: 3,
    gapMin: 3,
    gapMax: 5,
    kinds: ["band2", "band3", "patch", "chimney", "roof"],
    rockEvery: 13_000,
    windEvery: 15_000,
    limitMs: 330_000,
    parMs: 170_000,
    stars: 2,
    desc: "매끈한 얼음 띠가 두껍고 돌풍이 불어요. 끌어올리기가 꼭 필요해요.",
  },
  volcano: {
    id: "volcano",
    name: "불티 화산",
    emoji: "🌋",
    height: 58,
    camps: 3,
    gapMin: 3,
    gapMax: 5,
    kinds: ["band3", "crumble", "roof", "patch", "chimney", "crumble"],
    rockEvery: 8_000,
    windEvery: 21_000,
    limitMs: 540_000,
    parMs: 270_000,
    stars: 3,
    desc: "낙석이 쉴 새 없고 부서지는 바위가 많아요. 줄이 끊임없이 팽팽해져요.",
  },
};

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
export const COUNTDOWN_MS = 4000;
/** 아무도 벽을 못 잡은 채 이만큼 지나면 팀 추락 */
export const TEAM_FALL_MS = 900;
/** 추락 뒤 캠프에서 숨 고르는 시간 (조작 불가) */
export const RESPAWN_STUN_MS = 1200;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.38;
/** 오르는 속도 */
export const CLIMB_SPEED = 1.6;
export const LEDGE_SPEED = 2.8;
export const OVERHANG_SPEED = 1.1;
export const GRAVITY = 13;
/** 떨어지는 속도 상한 */
export const MAX_FALL = 15;
/** 도약 속도 (잡고 있다가 방향키 + 잡기 버튼) */
export const LEAP_SPEED = 7.2;
/** 공중에서 좌우로 흔드는 힘 */
export const AIR_ACCEL = 5.5;
/** 손을 놓은 뒤 다시 잡을 수 있을 때까지 */
export const REGRAB_MS = 220;
/** 턱에 세게 떨어지면 휘청 (m/s 이상) */
export const HARD_LAND = 9;
export const HARD_LAND_STUN_MS = 800;

/* ── 체력 ───────────────────────────────────────────────────────────── */

export const STAM_MAX = 100;
/** 움직이며 매달려 있을 때 (초당) */
export const MOVE_DRAIN = 6;
/** 가만히 매달려 있을 때 */
export const HOLD_DRAIN = 1.2;
export const OVERHANG_MULT = 2.2;
/** 바위 턱에서 회복 */
export const LEDGE_REGEN = 34;
/** 줄에 매달려 쉴 때 회복 */
export const HANG_REGEN = 11;
/** 매달린 동료 한 명의 무게를 버티는 값 (초당) */
export const LOAD_DRAIN = 4.5;
/** 줄을 당겨 끌어올리는 값 (초당) */
export const HAUL_DRAIN = 5;
/** 도약 한 번 */
export const LEAP_COST = 5;
/** 떨어지는 동료를 줄로 받아낼 때: 줄이 채이는 속도 1m/s마다 */
export const CATCH_COST = 1.6;
/** 체력이 바닥나 손을 놓친 뒤 다시 잡으려면 이만큼 차야 한다 */
export const GRAB_MIN = 22;
/** 낙석에 맞으면 */
export const ROCK_HIT_COST = 16;
export const ROCK_STUN_MS = 900;
/** 돌풍 중 매달리는 값 배수 */
export const WIND_DRAIN_MULT = 1.7;

/* ── 줄 ─────────────────────────────────────────────────────────────── */

/** 옆 사람과 이어진 줄 길이 */
export const ROPE_LEN = 4.4;
/** 끌어올릴 때 줄이 가장 짧아지는 길이 */
export const ROPE_MIN = 1.15;
/** 끌어올리는 속도 */
export const HAUL_SPEED = 1.9;
/** 이 속도 이상으로 줄이 채이면 "받아냄" */
export const CATCH_SPEED = 4;

/* ── 위험 ───────────────────────────────────────────────────────────── */

export const CRUMBLE_MS = 1600;
export const ROCK_WARN_MS = 1400;
export const ROCK_SPEED = 9.5;
export const ROCK_R = 0.55;
export const WIND_WARN_MS = 2000;
export const WIND_MS = 3200;
export const WIND_ACCEL = 6.5;

/* ── 점수 (개인 기여도 — 순위는 팀 결과가 먼저) ───────────────────────── */

/** 팀 최고 높이를 1m 새로 올릴 때마다 */
export const PTS_LEAD = 1;
/** 동료를 1m 끌어올릴 때마다 */
export const PTS_HAUL = 2;
/** 떨어지는 동료를 줄로 받아냄 */
export const PTS_CATCH = 6;
export const PTS_STAR = 8;
/** 완등 보너스 (전원) */
export const PTS_SUMMIT = 20;
