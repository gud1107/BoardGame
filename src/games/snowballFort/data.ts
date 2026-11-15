/**
 * 눈싸움 요새전 — 규칙 수치와 공용 타입 (룰북: boardGameRule/눈싸움요새전/눈싸움요새전.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각). 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다
 * (라운드 길이·레벨별 승률·팀 인원 차이 보정).
 *
 * 좌표: 눈밭은 x ∈ [−FIELD_HW, FIELD_HW], z ∈ [−FIELD_HL, FIELD_HL]. 0팀(🍓 딸기)은 z > 0 쪽,
 * 1팀(🥤 소다)은 z < 0 쪽에 요새가 있다. 높이 y는 땅 = 0.
 */

export const GAME_ID = "snowball-fort";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export interface GameOptions {
  /** 라운드 수 (과반을 먼저 이긴 팀이 승리) */
  rounds: 1 | 3 | 5;
  /** 🍫 핫초코 · 🧊 왕눈덩이 아이템 */
  items: boolean;
  /** 마지막 40초 ❄️ 눈보라 (벽이 녹고 눈덩이를 더 들 수 있음) */
  blizzard: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 3, items: true, blizzard: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const rounds = o?.rounds === 1 || o?.rounds === 5 ? o.rounds : 3;
  return { rounds, items: o?.items !== false, blizzard: o?.blizzard !== false };
}

/* ── 팀 ─────────────────────────────────────────────────────────────── */

export const TEAM_COLORS = ["#ef4444", "#3b82f6"] as const;
export const TEAM_NAMES = ["딸기팀", "소다팀"] as const;
export const TEAM_EMOJI = ["🍓", "🥤"] as const;
/** 색각 이상이어도 모양으로 구분: 딸기 ● · 소다 ▲ */
export const TEAM_SYMBOLS = ["●", "▲"] as const;
/** 자리마다 다른 목도리 색 (같은 팀 안에서도 누가 누군지) */
export const SEAT_SCARF = ["#f97316", "#06b6d4", "#facc15", "#a855f7", "#f43f5e", "#22c55e", "#ec4899", "#94a3b8"] as const;

export const teamOf = (seat: number) => seat % 2;
/** 팀의 자기 진영 방향 (0팀 +1, 1팀 −1) */
export const sideSign = (team: number) => (team === 0 ? 1 : -1);

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
export const COUNTDOWN_FIRST_MS = 4500;
export const COUNTDOWN_MS = 3000;
export const ROUND_END_MS = 5500;
export const ROUND_MS = 150_000;
/** 이때부터 ❄️ 눈보라 */
export const BLIZZARD_AT_MS = 110_000;

/* ── 눈밭 ───────────────────────────────────────────────────────────── */

export const FIELD_HW = 10;
export const FIELD_HL = 15;
/** 자기 진영 + 가운데선 너머 이만큼까지 벽을 세울 수 있다 */
export const WALL_REACH_PAST_MID = 1.0;

/** 눈더미 (한 진영에 3개, 상대 진영에 거울 대칭) — 근처에서 모으면 빨리 모인다 */
export const PILES: readonly { x: number; z: number }[] = [
  { x: -6.5, z: 6.2 },
  { x: 6.5, z: 6.2 },
  { x: 0, z: 9.6 },
  { x: -6.5, z: -6.2 },
  { x: 6.5, z: -6.2 },
  { x: 0, z: -9.6 },
];
export const PILE_R = 2.3;
export const PILE_GATHER_K = 1.8;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.42;
export const BODY_H = 1.7;
export const SPEED = 4.6;
/** 던질 힘을 모으는 동안 이동 속도 배수 */
export const CHARGE_SLOW = 0.5;
export const ACCEL = 32;
export const HP_MAX = 3;
/** 인원이 적은 팀은 몸이 하나 더 단단하다 */
export const HP_SMALL_TEAM = 4;
/** 눈사람이 되어(얼어서) 쉬는 시간 */
export const FROZEN_MS = 4000;
/** 다시 나온 직후 무적 */
export const RESPAWN_SAFE_MS = 1500;
export const DASH_SPEED = 11;
export const DASH_MS = 230;
export const DASH_CD_MS = 2800;

/* ── 눈덩이 ─────────────────────────────────────────────────────────── */

export const AMMO_START = 2;
export const AMMO_MAX = 4;
export const AMMO_MAX_BLIZZARD = 6;
/** 눈덩이 하나 뭉치는 시간 */
export const GATHER_MS = 750;
/** 인원이 적은 팀은 빨리 뭉치고, 빨리 녹는다 */
export const SMALL_TEAM_GATHER_K = 1.35;
export const SMALL_TEAM_FROZEN_K = 0.6;
export const CHARGE_MS = 900;
export const THROW_CD_MS = 320;
export const GRAVITY = 14;
export const LAUNCH_Y = 1.45;
export const BALL_R = 0.14;
export const GIANT_R = 0.34;
/** 세게 모을수록 멀리·높이 (가볍게: 4m 낮고 빠르게 → 꽉: 18m 높은 포물선) */
export const RANGE_MIN = 4;
export const RANGE_MAX = 18;
export const FLIGHT_MIN_S = 0.32;
export const FLIGHT_MAX_S = 0.92;
/** 사람 맞음 판정을 몸보다 살짝 넉넉하게 (눈덩이는 퍼지니까) */
export const HIT_SLACK = 0.1;

/** 모은 힘(0..1)으로 던졌을 때 수평 속도·위로 속도 */
export function launchFor(charge: number): { range: number; time: number; vh: number; vy: number } {
  const c = Math.max(0, Math.min(1, charge));
  const range = RANGE_MIN + (RANGE_MAX - RANGE_MIN) * c;
  const time = FLIGHT_MIN_S + (FLIGHT_MAX_S - FLIGHT_MIN_S) * c;
  // 0.3m 높이에 `range` 거리에서 닿도록
  const vy = (0.3 - LAUNCH_Y + 0.5 * GRAVITY * time * time) / time;
  return { range, time, vh: range / time, vy };
}

/** 이 거리를 맞히려면 얼마나 모아야 하나 (봇·조준선) */
export function chargeForRange(d: number): number {
  return Math.max(0, Math.min(1, (d - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)));
}

/* ── 벽 ─────────────────────────────────────────────────────────────── */

export const WALL_LEN = 2.4;
export const WALL_T = 0.55;
export const WALL_H = 1.15;
export const WALL_HP = 3;
export const WALL_LIFE_MS = 50_000;
export const WALL_COST = 2;
export const WALL_MAX_TEAM = 6;
export const WALL_PLACE_D = 1.35;
export const BUILD_STALL_MS = 380;
/** 요새 기본 벽 (사라지지 않음) */
export const FORT_WALL_HP = 4;
/** 눈보라: 벽이 이 간격마다 1씩 녹는다 */
export const BLIZZARD_MELT_MS = 6000;

/* ── 눈사람 대장 ───────────────────────────────────────────────────── */

export const SNOWMAN_Z = 12.9;
export const SNOWMAN_R = 0.95;
export const SNOWMAN_H = 2.3;
/** 눈사람 체력은 쳐들어오는 상대 인원으로 정한다 (적은 팀의 눈사람이 더 튼튼) */
export function snowmanHpFor(enemyTeamSize: number, myTeamSize = enemyTeamSize): number {
  return 4 + 2 * Math.max(1, enemyTeamSize) + 6 * Math.max(0, enemyTeamSize - myTeamSize);
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "cocoa" | "giant";
export const ITEM_KINDS: ItemKind[] = ["cocoa", "giant"];
export const ITEM_FIRST_MS = 12_000;
export const ITEM_EVERY_MS = 15_000;
export const ITEM_LIFE_MS = 13_000;
export const ITEM_MAX = 2;
export const ITEM_PICK_R = 0.85;
/** 🍫: 이 시간 동안 뭉치기·모으기 2배 */
export const COCOA_MS = 6000;
export const GIANT_DMG = 3;

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string; color: string }> = {
  cocoa: { emoji: "🍫", name: "핫초코", desc: `몸이 다 녹고(체력 가득) ${COCOA_MS / 1000}초 동안 뭉치기·힘 모으기 2배`, color: "#b45309" },
  giant: { emoji: "🧊", name: "왕눈덩이", desc: `다음 한 번은 왕눈덩이 — ${GIANT_DMG}배 피해, 벽을 한 방에 부숴요`, color: "#7dd3fc" },
};

/* ── 점수 (팀 안 MVP 표시용) ─────────────────────────────────────────── */

export const PTS_HIT = 1;
export const PTS_FREEZE = 2;
export const PTS_SNOWMAN = 1;
