/**
 * 왕관 도둑 — 규칙 수치와 공용 타입 (룰북: boardGameRule/왕관도둑/왕관도둑.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각). 점수는 "왕관을 쓴 시간"이라 ms로 들고 다니고
 * 화면에는 초(소수 한 자리)로 보여 준다. 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다
 * (분당 왕관 이동 횟수·1등 보유 비율·막판 역전 비율·자리 편차·레벨별 승률).
 */

export const GAME_ID = "crown-thief";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** classic = 왕관을 오래 쓴 사람이 승 · team = 두 팀 합산 · curse = 저주의 왕관(쓰고 있으면 손해, 만져서 떠넘기기) */
export type GameMode = "classic" | "team" | "curse";

export interface GameOptions {
  mode: GameMode;
  /** 경기 시간 (초) */
  seconds: 90 | 120 | 180;
  /** 🍌🧲🎭 아이템이 나오나 */
  items: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { mode: "classic", seconds: 120, items: true };

/** 팀전은 4명 이상에서만 (2·3명이면 개인전으로) */
export const TEAM_MIN_PLAYERS = 4;

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined, seatCount = MAX_PLAYERS): GameOptions {
  let mode: GameMode = o?.mode === "team" || o?.mode === "curse" ? o.mode : "classic";
  if (mode === "team" && seatCount < TEAM_MIN_PLAYERS) mode = "classic";
  const seconds = o?.seconds === 90 || o?.seconds === 180 ? o.seconds : 120;
  return { mode, seconds, items: o?.items !== false };
}

export const MODE_INFO: Record<GameMode, { emoji: string; name: string; short: string }> = {
  classic: { emoji: "👑", name: "개인전", short: "왕관을 가장 오래 쓴 사람이 우승" },
  team: { emoji: "⚔️", name: "팀전", short: "☀ 해 팀 vs ☾ 달 팀 — 팀원이 쓴 시간을 합산 (4명 이상)" },
  curse: { emoji: "💀", name: "저주의 왕관", short: "쓰고 있으면 저주가 쌓여요 — 만져서 떠넘기고, 저주가 가장 적은 사람이 우승" },
};

/* ── 자리 표시: 색 + 모양(색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f43f5e"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥", "✚", "⬟"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록", "보라", "분홍", "청록", "빨강"] as const;

/** 팀: 자리 번호 짝수 = 해 팀, 홀수 = 달 팀. 색 + 기호 + 이름으로 함께 표시 */
export const TEAM_INFO = [
  { name: "해 팀", symbol: "☀", color: "#fb923c" },
  { name: "달 팀", symbol: "☾", color: "#60a5fa" },
] as const;
export const teamOf = (seat: number) => seat % 2;

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
/** 카운트다운 (조작을 익힐 수 있게 조금 길게) */
export const COUNTDOWN_MS = 4000;
/** 싸움 시작 이 시간 뒤 왕관이 광장 한가운데 떨어진다 (그림자로 미리 표시) */
export const CROWN_DROP_MS = 1500;
/** 마지막 이 시간은 ✨ 황금 왕관 — 점수 2배 */
export const GOLDEN_MS = 20_000;
export const GOLDEN_MULT = 2;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.42;
/** 가속 32, 마찰 6.4 → 최고 속도 5m/s, 손을 떼면 0.8m쯤 미끄러지다 선다 */
export const ACCEL = 32;
export const DRAG = 6.4;
export const BASE_SPEED = ACCEL / DRAG;
/** 몸끼리 부딪힘 탄성 */
export const RESTITUTION = 0.45;

/** 💨 돌진: 누르는 쪽으로 짧게 튀어나간다 */
export const DASH_SPEED = 10.5;
export const DASH_MS = 230;
export const DASH_CD_MS = 4000;
/** 돌진으로 박힌 사람은 짧게 휘청 (조작 불가) */
export const DASH_HIT_STAGGER_MS = 260;

/** 휘청(밀쳐짐·미끄러짐) 동안 마찰 — 낮아서 쭉 밀려간다 */
export const STAGGER_DRAG = 2.2;

/* ── 왕관 ───────────────────────────────────────────────────────────── */

/** 몸 반지름 두 개 + 이만큼 안이면 "만졌다" */
export const TOUCH_PAD = 0.15;
export const TOUCH_DIST = BODY_R * 2 + TOUCH_PAD;
/** 핑 보정: 왕의 지난 이 시간 동안 위치까지 만진 것으로 쳐 준다 (쫓는 쪽 유리) */
export const LAG_COMP_MS = 100;
/** 🛡 새 왕 무적: 왕관을 받은 직후 이 시간 동안은 뺏기지 않는다 */
export const INVULN_MS = 1500;
/** ✋ 복수 금지: 방금 뺏긴 사람은 이 시간 동안 그 왕관을 다시 뺏을 수 없다 */
export const REVENGE_MS = 3000;
/** 🪨 무거운 왕관: 오래 쓸수록 느려진다 — 이 시간마다 3%씩, 최대 20% */
export const WEIGHT_STEP_MS = 4000;
export const WEIGHT_PER_STEP = 0.04;
export const WEIGHT_MAX = 0.24;
/** 🐢 꼴찌 보정: 점수가 가장 불리한 사람(왕 제외)은 5% 빠르다 */
export const UNDERDOG_BONUS = 0.05;
/** 떨어진 왕관을 줍는 거리 */
export const CROWN_PICK_R = BODY_R + 0.45;
/** 떨어뜨린 사람은 이 시간 동안 못 줍는다 */
export const CROWN_DROP_BAN_MS = 1000;

/** 📣 왕의 호령 (개인전·팀전): 왕만, 왕관을 쓸 때마다 한 번 — 주변을 밀쳐낸다 */
export const ROAR_R = 3.2;
export const ROAR_PUSH_MIN = 5;
export const ROAR_PUSH_MAX = 9.5;
export const ROAR_STAGGER_MS = 450;
/** 💀 저주의 손길 (저주 모드): 왕만, 한 번 — 주변 사람을 느리게 */
export const SNARE_R = 3.2;
export const SNARE_MS = 1300;
export const SNARE_SLOW = 0.4;
/** 💀 저주 모드에선 왕이 오래 쓸수록 빨라진다 (쫓는 쪽이니까) */
export const CURSE_HASTE_PER_STEP = 0.05;
export const CURSE_HASTE_MAX = 0.3;

/* ── 광장 밖으로 떨어짐 ───────────────────────────────────────────── */

/** 떨어지는 연출 시간 (이 뒤로는 화면에서 사라짐) */
export const FALL_MS = 900;
/** 떨어진 순간부터 다시 나타날 때까지 */
export const RESPAWN_MS = 2200;
/** 다시 나타난 직후 이 시간은 반투명 (부딪힘·뺏기 없음) */
export const RESPAWN_GHOST_MS = 900;
/** 밀친 사람이 "떨어뜨림" 기록을 받는 시간 */
export const CREDIT_MS = 2500;
export const FALL_DEPTH = -6;

/* ── 점프대 ──────────────────────────────────────────────────────── */

export const PAD_MS = 780;
export const PAD_H = 1.8;
/** 같은 사람이 점프대를 다시 탈 수 있을 때까지 */
export const PAD_CD_MS = 4000;

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "banana" | "magnet" | "fake";
export const ITEM_KINDS: ItemKind[] = ["banana", "magnet", "fake"];
export const ITEM_FIRST_MS = 10_000;
export const ITEM_EVERY_MS = 13_000;
export const ITEM_LIFE_MS = 12_000;
export const ITEM_MAX = 2;
export const ITEM_PICK_R = 0.8;
/** 🍌 바나나 껍질: 주운 사람 뒤 1m에 놓인다. 밟으면 미끄러져 휘청 */
export const BANANA_BEHIND = 1.1;
export const BANANA_LIFE_MS = 16_000;
export const BANANA_R = 0.55;
export const BANANA_OWNER_SAFE_MS = 1500;
export const BANANA_SLIP_MS = 900;
export const TRAP_MAX = 4;
/** 🧲 자석: 손이 닿는 거리 +0.6m */
export const MAGNET_MS = 4000;
export const MAGNET_REACH = 0.6;
/** 🎭 가짜 왕관: 똑같이 생긴 왕관을 씌운다 */
export const FAKE_MS = 5000;

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string; color: string }> = {
  banana: { emoji: "🍌", name: "바나나 껍질", desc: `내 뒤에 껍질을 놓아요 — 밟은 사람은 ${BANANA_SLIP_MS / 1000}초 동안 쭉 미끄러져요`, color: "#facc15" },
  magnet: { emoji: "🧲", name: "자석 손", desc: `${MAGNET_MS / 1000}초 동안 손이 ${MAGNET_REACH}m 더 닿아요`, color: "#f43f5e" },
  fake: { emoji: "🎭", name: "가짜 왕관", desc: `${FAKE_MS / 1000}초 동안 진짜와 똑같은 가짜 왕관이 씌워져요 (왕이 주우면 다른 사람에게)`, color: "#c084fc" },
};

/** 저주 모드에선 가짜 왕관이 나오지 않는다 */
export function itemKindsFor(mode: GameMode): ItemKind[] {
  return mode === "curse" ? ["banana", "magnet"] : ITEM_KINDS;
}

/* ── 점수 표시 ───────────────────────────────────────────────────── */

/** ms → "12.3" */
export function fmtScore(ms: number): string {
  return (Math.floor(ms / 100) / 10).toFixed(1);
}
