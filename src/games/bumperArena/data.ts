/**
 * 범퍼 아레나 — 규칙 수치와 공용 타입 (룰북: boardGameRule/범퍼아레나/범퍼아레나.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각) — 물리 상수만 초 단위로 적는다.
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(라운드 길이·레벨별 승률).
 */

export const GAME_ID = "bumper-arena";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface GameOptions {
  /** 라운드 수 */
  rounds: 3 | 5 | 7;
  /** 🍄⚡🛡️💥 아이템이 나오나 */
  items: boolean;
  /** 떨어진 사람이 👻 유령이 되어 입김으로 방해하나 */
  ghosts: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 5, items: true, ghosts: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const rounds = o?.rounds === 3 || o?.rounds === 7 ? o.rounds : 5;
  return { rounds, items: o?.items !== false, ghosts: o?.ghosts !== false };
}

/* ── 자리 표시: 색 + 모양(색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#ec4899"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥"] as const;
export const SEAT_COLOR_NAMES = ["빨강", "파랑", "노랑", "초록", "보라", "분홍"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
/** 1라운드 카운트다운은 조작을 익힐 수 있게 조금 길게 */
export const COUNTDOWN_FIRST_MS = 4000;
export const COUNTDOWN_MS = 3000;
export const ROUND_END_MS = 5000;
/** 싸움 시작 후 이 시각부터 바깥 링이 무너진다 */
export const CRUMBLE_START_MS = 10_000;
/** 서든데스 — 무너지는 속도가 빨라진다 */
export const SUDDEN_MS = 75_000;
/** 이때까지 2명 이상 살아 있으면 무승부(생존자 +2) */
export const FIGHT_MAX_MS = 100_000;
/** 타일이 흔들리기 시작해서 떨어질 때까지 */
export const WARN_MS = 1800;
/** 떨어지기 직전 이 사람을 민 사람이 KO 점수를 받는 시간 */
export const CREDIT_MS = 4000;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.62;
export const BIG_SCALE = 1.45;
export const ACCEL = 16;
export const DRAG = 3;
export const DRAG_DASH = 0.8;
export const DRAG_BRACE = 7;
export const AIR_ACCEL = 4;
export const DASH_SPEED = 10;
export const DASH_MS = 280;
export const DASH_CD_MS = 2600;
export const JUMP_MS = 650;
export const JUMP_H = 1.15;
export const JUMP_CD_MS = 3500;
/** 착지 충격파 */
export const POUND_R = 2.4;
export const POUND_SPEED = 5.5;
/** 버티기: 질량 배수·받는 넉백 배수·가속 배수, 스태미나 초당 소모/회복 */
export const BRACE_MASS = 2.5;
export const BRACE_KNOCK = 0.45;
export const BRACE_ACCEL = 0.3;
export const BRACE_DRAIN = 0.5;
export const BRACE_REGEN = 0.25;
export const BRACE_MIN_START = 0.15;
/** 부딪힘 탄성 */
export const RESTITUTION = 0.3;
/** 대시로 박으면 상대가 받는 넉백 배수 */
export const DASH_HIT_MULT = 1.2;
/** 열기 = 넉백 % (100%면 넉백 2배) */
export const HEAT_PER_SPEED = 1.2;
export const HEAT_MAX = 250;
export const GRAVITY = 22;
/** 이 아래로 떨어지면 화면에서 지운다 */
export const FALL_GONE_Y = -8;

/* ── 범퍼 기둥 ──────────────────────────────────────────────────────── */

export const POST_R = 0.45;
export const POST_BOUNCE = 1.25;
export const POST_MIN_SPEED = 6;

/* ── 유령 ───────────────────────────────────────────────────────────── */

export const GHOST_SPEED = 6;
export const GUST_R = 2.0;
export const GUST_SPEED = 4;
export const GUST_CD_MS = 7000;

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "big" | "turbo" | "shield" | "shock";
export const ITEM_KINDS: ItemKind[] = ["big", "turbo", "shield", "shock"];
export const ITEM_FIRST_MS = 4000;
export const ITEM_EVERY_MS = 6000;
export const ITEM_LIFE_MS = 12_000;
export const ITEM_MAX = 2;
export const ITEM_PICK_R = 0.95;
export const BIG_MS = 7000;
export const TURBO_MS = 6000;
export const SHIELD_MS = 15_000;
export const SHOCK_R = 3.2;
export const SHOCK_SPEED = 9;

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string; color: string }> = {
  big: { emoji: "🍄", name: "거대화", desc: `${BIG_MS / 1000}초 동안 몸이 1.45배·무게 2.2배 — 잘 안 밀리고 세게 밀어요 (조금 느려짐)`, color: "#f97316" },
  turbo: { emoji: "⚡", name: "터보", desc: `${TURBO_MS / 1000}초 동안 이동 1.45배 · 대시 재사용 절반`, color: "#eab308" },
  shield: { emoji: "🛡️", name: "방패", desc: "다음 한 번 크게 맞을 때 넉백 80% 막기 · 열기 안 오름", color: "#38bdf8" },
  shock: { emoji: "💥", name: "충격파", desc: `줍는 즉시 반경 ${SHOCK_R}m 안의 모두를 바깥으로 튕겨내요`, color: "#f43f5e" },
};

/** 꼴찌 보호막: 라운드 시작 때 1등보다 이만큼 이상 뒤지면 🛡️ */
export const COMEBACK_GAP = 4;

/* ── 점수 ───────────────────────────────────────────────────────────── */

export const PTS_KO = 1;
export const PTS_WIN = 3;
export const PTS_RUNNER_UP = 1;
export const PTS_TIMEOUT = 2;
export const PTS_TIE_FALL = 2;
