/**
 * 택배 대란 — 규칙 수치와 공용 타입 (룰북: boardGameRule/택배대란/택배대란.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각), 점수 = 정수.
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(분당 처리량·놓친 상자·별 기준·역할별 기여·레벨별 차이).
 */

export const GAME_ID = "parcel-panic";
/** 방 최소 인원 (봇 포함). 혼자 연습은 1명도 된다 */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** coop = 🤝 협동(팀 점수 + ★ 별) · versus = ⚔️ 실적 경쟁(개인 점수, 돌진으로 상자 떨어뜨리기) */
export type GameMode = "coop" | "versus";
export type Level = "easy" | "normal" | "hard";

export interface GameOptions {
  mode: GameMode;
  /** 근무 시간 (초) */
  seconds: 120 | 180 | 240;
  /** 물량 */
  level: Level;
  /** 🚨 돌발 사건 (정전·트럭 바꾸기·지게차·라벨 소동·물청소·주문 폭주) */
  incidents: boolean;
  /** 🎭 역할 (배달왕·장사·투수·검수원) */
  roles: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { mode: "coop", seconds: 180, level: "normal", incidents: true, roles: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined, seatCount = MAX_PLAYERS): GameOptions {
  let mode: GameMode = o?.mode === "versus" ? "versus" : "coop";
  if (mode === "versus" && seatCount < 2) mode = "coop";
  const seconds = o?.seconds === 120 || o?.seconds === 240 ? o.seconds : 180;
  const level: Level = o?.level === "easy" || o?.level === "hard" ? o.level : "normal";
  return { mode, seconds, level, incidents: o?.incidents !== false, roles: o?.roles !== false };
}

export const MODE_INFO: Record<GameMode, { emoji: string; name: string; short: string }> = {
  coop: { emoji: "🤝", name: "협동", short: "모두 한 팀 — 상자를 맞는 트럭에 실어 팀 점수를 모으고 ★ 별 3개를 노려요" },
  versus: { emoji: "⚔️", name: "실적 경쟁", short: "각자 실은 만큼 내 점수 — 💨 돌진으로 남의 상자를 떨어뜨리고, 던진 상자를 가로챌 수 있어요" },
};

export const LEVEL_INFO: Record<Level, { emoji: string; name: string; rate: number }> = {
  easy: { emoji: "🌱", name: "여유", rate: 0.8 },
  normal: { emoji: "📦", name: "보통", rate: 1 },
  hard: { emoji: "🔥", name: "대란", rate: 1.25 },
};

/* ── 자리 표시: 색 + 모양 ─────────────────────────────────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록", "보라", "분홍"] as const;

/* ── 목적지 (트럭) — 색 + 기호 + 이름 (색만으로 구분하지 않는다) ───────── */

export const DEST_INFO = [
  { sym: "☀", name: "해바라기 마을", short: "해바라기", color: "#f59e0b" },
  { sym: "≈", name: "파도 항구", short: "파도", color: "#0ea5e9" },
  { sym: "♣", name: "숲속 마을", short: "숲속", color: "#16a34a" },
  { sym: "✦", name: "별빛 시티", short: "별빛", color: "#c026d3" },
] as const;

/* ── 상자 ───────────────────────────────────────────────────────────── */

export type BoxKind = "normal" | "fragile" | "cold" | "heavy" | "express";

export const BOX_INFO: Record<BoxKind, { emoji: string; name: string; value: number; color: string; desc: string }> = {
  normal: { emoji: "📦", name: "일반", value: 10, color: "#c8925a", desc: "평범한 상자" },
  fragile: { emoji: "🥚", name: "깨지기 쉬움", value: 15, color: "#fbcfe8", desc: "던지거나 부딪혀 떨어뜨리면 깨져요" },
  cold: { emoji: "🧊", name: "냉장", value: 15, color: "#bae6fd", desc: "나온 지 45초가 지나면 녹아 버려요" },
  heavy: { emoji: "🛋️", name: "대형 가구", value: 30, color: "#a16207", desc: "혼자 들면 아주 느려요 — 둘이 들면 빨라요. 못 던져요" },
  express: { emoji: "⚡", name: "특급", value: 10, color: "#ef4444", desc: "나온 지 30초 안에 실으면 +10" },
};

/** 시간에 따라 섞이는 종류 비율 (근무 초반 → 후반) */
export const KIND_WEIGHTS_EARLY: [BoxKind, number][] = [
  ["normal", 70],
  ["fragile", 10],
  ["cold", 8],
  ["heavy", 6],
  ["express", 6],
];
export const KIND_WEIGHTS_LATE: [BoxKind, number][] = [
  ["normal", 44],
  ["fragile", 15],
  ["cold", 14],
  ["heavy", 13],
  ["express", 14],
];

export const COLD_LIFE_MS = 45_000;
export const EXPRESS_MS = 30_000;
export const EXPRESS_BONUS = 10;
/** ❓ 라벨 없는 상자: 근무 시작 이 시간 뒤부터 이 비율로 */
export const UNKNOWN_AFTER_MS = 30_000;
export const UNKNOWN_RATE = 0.12;
/** 스캔하면 덤 */
export const SCAN_BONUS = 5;

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
export const COUNTDOWN_MS = 4000;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.4;
/** 가속 34, 마찰 6.8 → 최고 5m/s */
export const ACCEL = 34;
export const DRAG = 6.8;
export const BASE_SPEED = ACCEL / DRAG;
export const RESTITUTION = 0.35;
/** 상자를 들고 있으면 */
export const CARRY_MULT = 0.86;
/** 🛋️ 대형 가구: 혼자 / 💪 장사 혼자 / 둘이 */
export const HEAVY_SOLO = 0.4;
export const HEAVY_STRONG = 0.72;
export const HEAVY_DUO = 0.9;
export const HEAVY_R = 0.62;
/** 둘이 들 때 몸 중심 ↔ 가구 중심 */
export const HEAVY_HANDLE = 0.95;
export const DASH_SPEED = 10;
export const DASH_MS = 220;
export const DASH_CD_MS = 3000;
export const STAGGER_MS = 700;
export const STAGGER_DRAG = 2.4;
/** 🧽 물청소: 미끄러운 바닥 */
export const WET_ACCEL = 13;
export const WET_DRAG = 2.6;
/** ⚔️ 꼴찌 보정 */
export const UNDERDOG_BONUS = 0.06;

/* ── 잡기 · 던지기 ───────────────────────────────────────────────────── */

/** 몸 중심 ↔ 상자 중심 이 안이면 잡을 수 있다 (컨베이어 위 상자는 조금 더 멀리) */
export const REACH = 1.05;
export const BELT_REACH = 1.3;
/** 들고 있는 상자는 몸 앞 이만큼 */
export const HOLD_AHEAD = 0.55;
export const THROW_RANGE = 5;
export const THROW_RANGE_PITCHER = 7.5;
export const THROW_MIN = 1.2;
/** 날아가는 시간 = 거리 비례 (최소 0.35초) */
export const THROW_SPEED = 9;
export const CATCH_R = 0.85;
/** 던진 직후 이 시간은 아무도 못 받는다 (던진 사람 몸에 바로 걸리지 않게) */
export const CATCH_GRACE_MS = 140;
/** 놓친(바닥에 떨어진) 상자는 이 시간 동안 다시 못 줍는다 */
export const DROP_NOPICK_MS = 500;
/** 트럭 칸에 정확히 던져 넣기 */
export const SHOT_BONUS = 3;

/* ── 트럭 ───────────────────────────────────────────────────────────── */

export const TRUCK_STAY_MS = 50_000;
export const TRUCK_AWAY_MS = 5000;
export const truckCap = (seatCount: number) => (seatCount <= 2 ? 5 : 6);
export const FULL_BONUS = 15;
/** 트럭에 실을 때 간격 (한 번에 하나) */
export const LOAD_GAP_MS = 150;

/* ── 놓침 ───────────────────────────────────────────────────────────── */

/** 협동: 컨베이어 끝 반송 / 깨짐 / 녹음 */
export const MISS_PENALTY = 5;
export const BELT_SPEED = 0.95;
export const BELT_GAP = 1.05;

/* ── 물량 ───────────────────────────────────────────────────────────── */

/**
 * 분당 상자 수 = 기본 × 인원 보정 × 물량(여유·보통·대란) × 근무 진행 램프.
 * 셀프플레이: Lv.5 봇 팀이 보통에서 놓치는 상자가 10~20% 가 되도록 맞췄다.
 */
export const BASE_PER_MIN = 5.4;
export const peopleFactor = (n: number) => 0.45 + 0.85 * n;
/** 근무 진행 0 → 1 사이 램프 (초반 0.7배 → 후반 1.25배) */
export const ramp = (u: number) => 0.7 + 0.55 * Math.min(1, Math.max(0, u));

/* ── 역할 ───────────────────────────────────────────────────────────── */

export type Role = "runner" | "strong" | "pitcher" | "inspector" | "none";
export const ROLES: Exclude<Role, "none">[] = ["runner", "strong", "pitcher", "inspector"];
export const ROLE_INFO: Record<Role, { emoji: string; name: string; desc: string }> = {
  runner: { emoji: "🏃", name: "배달왕", desc: "15% 빠르게 · 돌진 2초마다" },
  strong: { emoji: "💪", name: "장사", desc: "상자를 들어도 안 느려짐 · 🛋️ 가구도 혼자 꽤 빠르게" },
  pitcher: { emoji: "🎯", name: "투수", desc: "1.5배 멀리 던지기 · 던진 🥚도 안 깨짐" },
  inspector: { emoji: "🔎", name: "검수원", desc: "❓ 상자를 집는 순간 라벨이 보여요 · 🧊 녹는 시간 +15초" },
  none: { emoji: "👷", name: "직원", desc: "역할 없음" },
};
export const RUNNER_SPEED = 0.15;
export const RUNNER_DASH_CD_MS = 2000;
export const INSPECTOR_COLD_MS = 15_000;

/* ── 🚨 돌발 사건 ──────────────────────────────────────────────────── */

export type IncidentKind = "blackout" | "swap" | "forklift" | "labels" | "wet" | "rush";
export const INCIDENT_FIRST_MS = 30_000;
export const INCIDENT_EVERY_MS = 34_000;
export const INCIDENT_INFO: Record<IncidentKind, { emoji: string; name: string; ms: number; desc: string }> = {
  blackout: { emoji: "🔌", name: "정전", ms: 8000, desc: "컨베이어가 멈췄다가 몰아서 나와요" },
  swap: { emoji: "🔀", name: "트럭 자리 바꾸기", ms: 3500, desc: "두 트럭이 자리를 바꿔요 — 색·기호를 다시 확인!" },
  forklift: { emoji: "🚜", name: "지게차 통과", ms: 9000, desc: "노란 줄 위로 지게차가 지나가요 — 부딪히면 상자를 놓쳐요" },
  labels: { emoji: "🏷️", name: "라벨 소동", ms: 12_000, desc: "한동안 ❓ 라벨 없는 상자가 나와요 — 🔍 스캐너로!" },
  wet: { emoji: "🧽", name: "물청소", ms: 10_000, desc: "바닥이 미끄러워요 — 잘 안 서요" },
  rush: { emoji: "📈", name: "주문 폭주", ms: 10_000, desc: "상자가 두 배로 쏟아져요 (⚡ 특급 많음)" },
};
export const INCIDENT_KINDS = Object.keys(INCIDENT_INFO) as IncidentKind[];
export const BLACKOUT_BURST = 3;
export const FORK_WARN_MS = 2000;
export const FORK_SPEED = 3.4;
export const FORK_HALF = { x: 1.25, z: 0.7 };

/* ── ★ 별 (협동) ─────────────────────────────────────────────────────── */

/**
 * 협동 별 기준: 인원별 분당 팀 점수 기준 × 근무 분 × 물량 보정 × [1★, 2★, 3★] 비율.
 * 셀프플레이(봇 Lv.5 팀 점수 ≈ 기준의 85% → 2★와 3★ 사이)로 인원마다 맞췄다 — 인원이 늘수록 길이 막혀
 * 1인당 처리량이 줄어서 단순 비례가 아니다. 1★ = 출근 도장, 2★ = 우수 사원, 3★ = 전설의 물류팀.
 */
export const STAR_BASE_PER_MIN = [0, 103, 145, 225, 300, 345, 380] as const;
export const STAR_FRACTIONS = [0.45, 0.72, 0.98] as const;
export function starTargets(seatCount: number, seconds: number, level: Level): [number, number, number] {
  const n = Math.max(1, Math.min(MAX_PLAYERS, seatCount));
  const perMin = STAR_BASE_PER_MIN[n] * (level === "easy" ? 0.85 : level === "hard" ? 1.12 : 1);
  const base = (perMin * seconds) / 60;
  return STAR_FRACTIONS.map((f) => Math.round((base * f) / 5) * 5) as [number, number, number];
}
export const STAR_TITLES = ["😵 창고 마비", "🙂 출근 도장", "😎 우수 사원", "🏆 전설의 물류팀"] as const;
