/**
 * 만지면 내 꺼! — 규칙 수치와 공용 타입 (룰북: boardGameRule/만지면내꺼/만지면내꺼.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각), 점수 = 물건 값(정수).
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(분당 가로채기·1등/꼴찌 점수비·마감 세일 역전·
 * 줄에 남기고 끝난 값·가로채기 독식·레벨별 승률).
 */

export const GAME_ID = "finders-keepers";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** classic = 개인전 · team = 두 팀 합산 · bomb = 💣 폭탄 세일(째깍 폭탄 돌리기가 섞인 개인전) */
export type GameMode = "classic" | "team" | "bomb";

export interface GameOptions {
  mode: GameMode;
  /** 경기 시간 (초) */
  seconds: 120 | 150 | 180;
  /** 📢 점장 방송 (타임세일·물건 비·물청소) */
  events: boolean;
  /** 🎖 보너스 목표 2개 (시작 때 공개, 끝에 +점) */
  goals: boolean;
  /** 🧬 증강 (시작 전 · 1/3 · 2/3 지점에 3장 중 1장) — 옵션이 없는 옛 방장은 꺼짐 */
  augments: boolean;
}

/** 방 만들기 화면 기본값 (증강 켬). 엔진(`sanitizeOptions`)은 옵션이 빠지면 증강을 끈다. */
export const DEFAULT_OPTIONS: GameOptions = { mode: "classic", seconds: 150, events: true, goals: true, augments: true };

export const TEAM_MIN_PLAYERS = 4;

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined, seatCount = MAX_PLAYERS): GameOptions {
  let mode: GameMode = o?.mode === "team" || o?.mode === "bomb" ? o.mode : "classic";
  if (mode === "team" && seatCount < TEAM_MIN_PLAYERS) mode = "classic";
  const seconds = o?.seconds === 120 || o?.seconds === 180 ? o.seconds : 150;
  return { mode, seconds, events: o?.events !== false, goals: o?.goals !== false, augments: o?.augments === true };
}

export const MODE_INFO: Record<GameMode, { emoji: string; name: string; short: string }> = {
  classic: { emoji: "🖐️", name: "개인전", short: "만진 물건은 내 뒤에 줄줄이 — 내 바구니에 넣은 값이 가장 큰 사람이 우승" },
  team: { emoji: "🤝", name: "팀전", short: "☀ 해 팀 vs ☾ 달 팀 — 팀 바구니 하나, 팀원에게 줄을 통째로 넘길 수 있어요 (4명 이상)" },
  bomb: { emoji: "💣", name: "폭탄 세일", short: "개인전 + 째깍 폭탄 — 폭탄을 든 사람이 남을 만지면 떠넘겨요. 터지면 줄과 바구니 물건이 흩어져요" },
};

/* ── 자리 표시: 색 + 모양 ─────────────────────────────────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f43f5e"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥", "✚", "⬟"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록", "보라", "분홍", "청록", "빨강"] as const;

export const TEAM_INFO = [
  { name: "해 팀", symbol: "☀", color: "#fb923c" },
  { name: "달 팀", symbol: "☾", color: "#60a5fa" },
] as const;
export const teamOf = (seat: number) => seat % 2;

/* ── 물건 ───────────────────────────────────────────────────────────── */

export type ToyKind = "sock" | "duck" | "robot" | "gift" | "trophy";
/** 세트 보너스·목표에 쓰는 기본 4종 (트로피 제외) */
export const BASIC_KINDS: ToyKind[] = ["sock", "duck", "robot", "gift"];

export const TOY_INFO: Record<ToyKind, { emoji: string; name: string; value: number; weight: number; color: string }> = {
  sock: { emoji: "🧦", name: "양말 인형", value: 1, weight: 1, color: "#f472b6" },
  duck: { emoji: "🦆", name: "고무 오리", value: 2, weight: 2, color: "#facc15" },
  robot: { emoji: "🤖", name: "태엽 로봇", value: 3, weight: 3, color: "#94a3b8" },
  gift: { emoji: "🎁", name: "선물 상자", value: 5, weight: 5, color: "#ef4444" },
  trophy: { emoji: "🏆", name: "황금 트로피", value: 10, weight: 20, color: "#fbbf24" },
};

/** 다시 채울 때 종류 비율 (양말 45 · 오리 30 · 로봇 18 · 선물 7) */
export const REFILL_WEIGHTS: [ToyKind, number][] = [
  ["sock", 45],
  ["duck", 30],
  ["robot", 18],
  ["gift", 7],
];

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
export const COUNTDOWN_MS = 4000;
/** 🔥 마감 세일: 마지막 이 시간 (2인전은 더 길게) */
export const SALE_MS = 30_000;
export const SALE_MS_DUEL = 45_000;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.42;
/** 가속 32, 마찰 6.4 → 최고 5m/s */
export const ACCEL = 32;
export const DRAG = 6.4;
export const BASE_SPEED = ACCEL / DRAG;
export const RESTITUTION = 0.45;
export const DASH_SPEED = 10.5;
export const DASH_MS = 230;
export const DASH_CD_MS = 4000;
export const DASH_HIT_STAGGER_MS = 260;
export const STAGGER_DRAG = 2.2;
/** 🧽 물청소(점장 방송): 미끄러운 바닥 — 가속·마찰이 낮아 최고 속도는 같고 잘 안 선다 */
export const WET_ACCEL = 12;
export const WET_DRAG = 2.4;
/** 🐢 꼴찌 보정 */
export const UNDERDOG_BONUS = 0.05;

/* ── 만지기 · 줄 ─────────────────────────────────────────────────────── */

/** 몸 중심 ↔ 물건 중심 이 안이면 만짐 */
export const TOUCH_ITEM = 0.78;
/** 몸 ↔ 몸 (팀원 넘겨주기·폭탄 떠넘기기) */
export const TOUCH_BODY = BODY_R * 2 + 0.15;
/** 핑 보정: 물건·몸의 지난 이 시간 위치까지 만진 것으로 쳐 준다 */
export const LAG_COMP_MS = 100;
/** 줄 위 물건 간격 */
export const GAP = 0.7;
/** 줄에 매달린 물건이 앞 물건을 쫓아가는 최고 속도 (가로챈 순간 순간이동처럼 보이지 않게) */
export const CHAIN_PULL = 14;
export const MAX_CHAIN = 12;
/** ✊ 몸 바로 뒤 이만큼은 손에 꼭 쥐고 있어 못 뺏는다 */
export const HELD_SAFE = 1;
/** 🐣 꼴찌 보호: 점수가 가장 낮은 사람(혼자일 때)은 앞 3개까지 안전 */
export const UNDERDOG_SAFE = 3;
/** 🐢 무게: 줄 위 무게 합 × 1%, 최대 30% */
export const WEIGHT_PER = 0.01;
export const WEIGHT_MAX = 0.3;
/** 🛡 갓 찜 보호: 바닥에서 주운 물건 / 가로챈 물건 (가로챈 쪽은 도망칠 틈을 더 준다) */
export const SHIELD_MS = 1200;
export const SNATCH_SHIELD_MS = 2200;
/** 🤲 손이 무거움: 가로챈 사람은 이 시간 동안 다시 못 가로챈다 (바닥 줍기는 됨) */
export const SNATCH_CD_MS = 5000;
/** ✋ 되찜 금지: 방금 나에게서 가로챈 사람의 줄은 이 시간 동안 못 건드린다 */
export const REVENGE_MS = 2500;
/** ✂️ 줄 끊기 */
export const CUT_CD_MS = 8000;
export const CUT_BOOST = 0.25;
export const CUT_BOOST_MS = 2000;
/** 떨어뜨린 물건은 이 시간 동안 아무도 못 줍는다 */
export const DROP_NOPICK_MS = 1000;
/** 🤝 팀원에게 넘겨주기 재사용 */
export const PASS_CD_MS = 1500;
/** "꽉 참" 알림 간격 */
export const FULL_WARN_MS = 1500;

/* ── 바구니 ─────────────────────────────────────────────────────────── */

export const BASKET_R = 1.6;
/** 넣는 간격 — 줄 앞에서부터 하나씩 */
export const DEPOSIT_MS = 250;
/** 마감 세일 때 바구니 맨 위를 털 수 있는 거리 (바구니 중심 기준) */
export const LOOT_REACH = BASKET_R + TOUCH_ITEM;
/** 털린 바구니는 이 시간 동안 다시 못 턴다 */
export const LOOT_CD_MS = 5000;

/* ── 다시 채우기 · 방송 ─────────────────────────────────────────────── */

/** 바닥 물건이 처음 개수의 이 비율 아래면 지붕 틈에서 떨어진다 */
export const REFILL_THRESHOLD = 0.3;
export const REFILL_THRESHOLD_DUEL = 0.4;
export const REFILL_EVERY_MS = 8000;
export const REFILL_N = 2;
/** 떨어지기 전 바닥 그림자 예고 */
export const DROP_WARN_MS = 1500;

export type ShopEventKind = "timeSale" | "rain" | "wet";
export const EVENT_FIRST_MS = 25_000;
export const EVENT_EVERY_MS = 35_000;
export const EVENT_INFO: Record<ShopEventKind, { emoji: string; name: string; ms: number; desc: string }> = {
  timeSale: { emoji: "🏷️", name: "타임세일", ms: 12_000, desc: "한 종류를 넣으면 값이 2배" },
  rain: { emoji: "🌧️", name: "물건 비", ms: 3000, desc: "지붕 틈에서 물건이 우수수" },
  wet: { emoji: "🧽", name: "물청소", ms: 10_000, desc: "바닥이 미끄러워요 — 잘 안 서요" },
};
export const RAIN_N = 6;

/* ── 세트 보너스 · 목표 ─────────────────────────────────────────────── */

/** 한 번에(바구니를 떠나기 전까지) 같은 종류 3개 넣기 */
export const SET_TRIPLE_BONUS = 2;
/** 한 번에 기본 4종 모두 넣기 */
export const SET_RAINBOW_BONUS = 4;

export type GoalKind = "snatcher" | "train" | "duck" | "robot" | "socks" | "clean" | "looter";
export const GOAL_BONUS = 5;
export const GOAL_INFO: Record<GoalKind, { emoji: string; name: string; desc: string }> = {
  snatcher: { emoji: "✂️", name: "소매치기왕", desc: "가로챈 값이 가장 많은 사람" },
  train: { emoji: "🚂", name: "기차왕", desc: "한 번에 넣은 값이 가장 큰 사람" },
  duck: { emoji: "🦆", name: "오리 수집가", desc: "고무 오리를 가장 많이 넣은 사람" },
  robot: { emoji: "🤖", name: "로봇 수집가", desc: "태엽 로봇을 가장 많이 넣은 사람" },
  socks: { emoji: "🧦", name: "양말 부자", desc: "양말 인형을 가장 많이 넣은 사람" },
  clean: { emoji: "🛡️", name: "철벽", desc: "10점 이상 넣고, 가로채기 당한 값이 가장 적은 사람" },
  looter: { emoji: "🔥", name: "마감 털이범", desc: "마감 세일 때 바구니를 가장 많이 턴 사람" },
};
export const GOAL_KINDS = Object.keys(GOAL_INFO) as GoalKind[];

/* ── 💣 폭탄 세일 ───────────────────────────────────────────────────── */

export const BOMB_FIRST_MS = 6000;
export const BOMB_FUSE_MIN = 16_000;
export const BOMB_FUSE_MAX = 28_000;
/** 화면(스냅샷)에 남은 시간이 보이는 구간 — 그 전엔 숨김 */
export const BOMB_REVEAL_MS = 5000;
export const BOMB_RESPAWN_MS = 6000;
/** 받은 직후 이 시간은 못 떠넘긴다 */
export const BOMB_SHIELD_MS = 1200;
/** 준 사람에게는 이 시간 동안 못 돌려준다 */
export const BOMB_REVENGE_MS = 2500;
/** 폭탄 든 사람은 조금 빠르다 (쫓는 쪽) */
export const BOMB_HASTE = 0.1;
/** 터지면 바구니 맨 위에서 날아가는 물건 수 */
export const BOMB_BASKET_LOSS = 2;
export const BOMB_STAGGER_MS = 600;
export const bombCountFor = (n: number) => (n <= 4 ? 1 : 2);

/* ── 무빙워크 ─────────────────────────────────────────────────────── */

export const WALKWAY_SPEED = 1.8;
