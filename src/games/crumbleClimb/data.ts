/**
 * 무너지는 탑 오르기 — 규칙 수치와 공용 타입 (룰북: boardGameRule/무너지는탑오르기/무너지는탑오르기.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각) — 물리 상수만 초 단위로 적는다.
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(라운드 길이·레벨별 승률·선두 유지율).
 */

export const GAME_ID = "crumble-climb";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface GameOptions {
  /** 라운드 수 */
  rounds: 1 | 3 | 5;
  /** 🪶⚡🛡 아이템이 나오나 */
  items: boolean;
  /** 🧱 꼴찌·탈락자가 선두에게 방해 카드를 쓰나 */
  sabotage: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 3, items: true, sabotage: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const rounds = o?.rounds === 1 || o?.rounds === 5 ? o.rounds : 3;
  return { rounds, items: o?.items !== false, sabotage: o?.sabotage !== false };
}

/* ── 자리 표시: 색 + 모양(색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록", "보라", "분홍"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
export const COUNTDOWN_FIRST_MS = 4000;
export const COUNTDOWN_MS = 3000;
export const ROUND_END_MS = 6000;
/** 안전장치: 이때까지 안 끝나면 라운드 끝 (붕괴가 꼭대기에 닿는 건 보통 55초 안쪽) */
export const ROUND_MAX_MS = 120_000;

/* ── 탑 ─────────────────────────────────────────────────────────────── */

/** 가운데 기둥 반지름 — 몸은 기둥을 뚫지 못한다 */
export const PILLAR_R = 1.7;
/** 바닥(시작) 원판 바깥 반지름 */
export const BASE_R = 6.8;
/** 발판이 놓이는 기둥 축 거리 범위 */
export const LANE_MIN = 3.1;
export const LANE_MAX = 5.7;
/** 탑 높이 (꼭대기 왕관 발판 윗면 근처) */
export const TOWER_H = 30;
export const CROWN_R = 1.7;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.35;
export const RUN_SPEED = 5.2;
/** 땅에서 원하는 속도로 붙는 빠르기 (1/초) — 클수록 즉각 */
export const GROUND_K = 14;
/** 🧊 얼음판 위 (미끄러움) */
export const ICY_K = 1.6;
export const AIR_K = 5;
export const GRAVITY = 22;
/** 점프 초속: 최고 약 1.68m */
export const JUMP_V = 8.6;
/** 🪶 공중 점프 */
export const AIR_JUMP_V = 8.0;
/** 트램펄린: 최고 약 2.9m */
export const BOUNCE_V = 11.3;
export const FALL_MAX = 24;
/** 발판 끝에서 떨어진 뒤에도 이 시간 안이면 점프 가능 (코요테 타임) */
export const COYOTE_MS = 110;
/** 점프를 누른 뒤 이 시간 안에 착지하면 바로 점프 (입력 버퍼) */
export const JUMP_BUFFER_MS = 160;
/** 몸 반지름 중 이만큼이 발판 위에 걸쳐 있으면 선다 */
export const FOOT_MARGIN = 0.22;

/* ── 발판 ──────────────────────────────────────────────────────────── */

export type PlatformKind = "base" | "stone" | "crumbly" | "bouncy" | "moving" | "crown";

/** 금 간 발판: 처음 밟고 이 시간 뒤 무너지고, 다시 생긴다 */
export const CRUMBLE_MS = 900;
export const RESPAWN_MS = 3000;
/** 움직이는 발판: 좌우로 흔드는 각도(rad)·주기 */
export const SWAY_AMP = 0.32;
export const SWAY_MS = 4200;

/* ── 붕괴 ──────────────────────────────────────────────────────────── */

/** 붕괴선 시작 높이와, 싸움 시작 뒤 오르기 시작하는 시간 */
export const COLLAPSE_START_Y = -2;
export const COLLAPSE_DELAY_MS = 7000;
/** 붕괴 속도: 처음 0.3m/s에서 1초마다 0.015씩 빨라짐 (최대 1.6) */
export const COLLAPSE_V0 = 0.3;
export const COLLAPSE_ACCEL = 0.015;
export const COLLAPSE_VMAX = 1.6;
/** 첫 등정자가 나오면 붕괴가 이만큼 빨라진다 */
export const FINAL_CALL_MUL = 1.7;
/** 붕괴선 이만큼 위 발판은 흔들리며 경고 */
export const COLLAPSE_WARN_H = 1.8;
/** 붕괴선보다 이만큼 아래로 내려가면 탈락 */
export const CAUGHT_DEPTH = 1.2;

/* ── 밀치기 ─────────────────────────────────────────────────────────── */

export const SHOVE_R = 1.75;
/** 바라보는 쪽 ±70° 안 */
export const SHOVE_CONE = 1.22;
export const SHOVE_PUSH = 7.2;
export const SHOVE_LIFT = 3.2;
export const SHOVE_CD_MS = 3200;
/** 밀쳐진 사람은 이 시간 조작이 둔해진다 */
export const STAGGER_MS = 380;

/* ── 방해 카드 ─────────────────────────────────────────────────────── */

export type SabKind = "rocks" | "ice" | "wind" | "shake";
export const SAB_KINDS: SabKind[] = ["rocks", "ice", "wind", "shake"];
/** 탈락자(👻)는 이 간격마다 카드 한 장 */
export const SAB_GHOST_MS = 9000;
/** 살아 있는 꼴찌는 선두보다 이만큼 낮으면 카드를 모은다 */
export const SAB_GAP = 6;
export const SAB_LAST_MS = 12_000;
/** 카드를 받고 이 안에 안 고르면 무작위로 쓴다 */
export const SAB_PICK_MS = 6000;
/** 첫 카드는 싸움 시작 이 시간 뒤부터 */
export const SAB_FIRST_MS = 10_000;
/** 낙석: 경고 원 → 떨어지는 시간, 맞는 반경 */
export const ROCK_WARN_MS = 1100;
export const ROCK_R = 0.95;
export const ROCK_COUNT = 3;
/** 얼음판: 선두 높이 −0.5 ~ +4m 발판을 이 시간 미끄럽게 */
export const ICE_MS = 7000;
export const ICE_BAND_UP = 4;
/** 돌풍: 경고 뒤 이 시간 동안 선두 높이 −2m 위 모두를 탑 바깥쪽으로 */
export const WIND_WARN_MS = 900;
export const WIND_MS = 3200;
export const WIND_ACCEL = 9;
/** 흔들기: 선두가 선 발판 + 그 위 두 발판이 무너지기 시작 */
export const SHAKE_MS = 1000;

export const SAB_INFO: Record<SabKind, { emoji: string; name: string; desc: string; color: string }> = {
  rocks: { emoji: "🪨", name: "낙석", desc: `선두 머리 위로 돌 ${ROCK_COUNT}개 — ${ROCK_WARN_MS / 1000}초 뒤 떨어져 맞으면 휘청`, color: "#a8a29e" },
  ice: { emoji: "🧊", name: "얼음판", desc: `선두 근처 발판이 ${ICE_MS / 1000}초 동안 미끄러워져요`, color: "#7dd3fc" },
  wind: { emoji: "💨", name: "돌풍", desc: `${WIND_WARN_MS / 1000}초 뒤 ${WIND_MS / 1000}초 동안 선두 높이 바람이 탑 바깥쪽으로`, color: "#e2e8f0" },
  shake: { emoji: "🧱", name: "발판 흔들기", desc: `선두가 선 발판과 그 위 두 칸이 ${SHAKE_MS / 1000}초 뒤 무너져요`, color: "#f59e0b" },
};

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "feather" | "boots" | "shield";
export const ITEM_KINDS: ItemKind[] = ["feather", "boots", "shield"];
export const ITEM_FIRST_MS = 4000;
export const ITEM_EVERY_MS = 5500;
export const ITEM_LIFE_MS = 15_000;
export const ITEM_MAX = 3;
export const ITEM_PICK_R = 0.8;
export const BOOTS_MS = 6000;
export const BOOTS_MUL = 1.3;
export const SHIELD_MS = 15_000;

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string; color: string }> = {
  feather: { emoji: "🪶", name: "깃털", desc: "공중에서 한 번 더 점프 (하나만 들 수 있어요)", color: "#fde68a" },
  boots: { emoji: "⚡", name: "번개 신발", desc: `${BOOTS_MS / 1000}초 동안 ${Math.round((BOOTS_MUL - 1) * 100)}% 빨리 달려요`, color: "#facc15" },
  shield: { emoji: "🛡", name: "방패", desc: `${SHIELD_MS / 1000}초 동안 밀치기·낙석·돌풍을 한 번 막아요`, color: "#93c5fd" },
};

/* ── 점수 ───────────────────────────────────────────────────────────── */

/** 꼭대기에 먼저 오른 순서대로 (6명까지) — 못 오르면 0 */
export const FINISH_PTS = [6, 4, 3, 2, 1, 1] as const;

export function finishPoints(place: number): number {
  return place >= 1 && place <= FINISH_PTS.length ? FINISH_PTS[place - 1] : 0;
}
