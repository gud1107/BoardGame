/**
 * 살얼음 파티 — 규칙 수치와 공용 타입 (룰북: boardGameRule/살얼음파티/살얼음파티.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각) — 물리·얼음 상수만 초 단위로 적는다.
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(라운드 길이·레벨별 승률·자리 편차).
 */

export const GAME_ID = "thin-ice-party";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface GameOptions {
  /** 라운드 수 */
  rounds: 1 | 3 | 5;
  /** ❄️🥾🐟 아이템이 나오나 */
  items: boolean;
  /** 빠진 사람이 👻 유령이 되어 다음 해빙 구역을 고르나 (끄면 해님이 무작위로) */
  ghosts: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 3, items: true, ghosts: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const rounds = o?.rounds === 1 || o?.rounds === 5 ? o.rounds : 3;
  return { rounds, items: o?.items !== false, ghosts: o?.ghosts !== false };
}

/* ── 자리 표시: 색 + 모양(색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록", "보라", "분홍"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
/** 1라운드 카운트다운은 조작을 익힐 수 있게 조금 길게 */
export const COUNTDOWN_FIRST_MS = 4000;
export const COUNTDOWN_MS = 3000;
export const ROUND_END_MS = 5500;
/** 빠지기 직전 이 사람을 밀친 사람이 KO 점수를 받는 시간 */
export const CREDIT_MS = 4000;

/* ── 얼음 ───────────────────────────────────────────────────────────── */

/** 한 사람이 1초 서 있을 때 줄어드는 얼음 (1 = 멀쩡) — 혼자 약 2초면 깨진다 */
export const ICE_DRAIN = 0.5;
/** 🥾 아이젠을 신으면 덜 깎인다 */
export const SPIKES_DRAIN = 0.4;
/** 아무도 안 선 얼음은 아주 천천히 다시 언다 (초당) — 깨진 칸은 다시 안 생김 */
export const REFREEZE = 0.035;
/** 금 1단계·2단계 경계 (화면 표시와 봇 판단) */
export const CRACK_1 = 0.66;
export const CRACK_2 = 0.33;
/** 점프하고 내려앉을 때 얼음이 받는 충격 */
export const LAND_CRACK = 0.08;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.4;
/** 얼음이라 미끄럽다: 가속 15.6, 마찰 3.4 → 최고 속도 약 4.6m/s, 손을 떼면 1.3m쯤 미끄러짐 */
export const ACCEL = 15.6;
export const DRAG = 3.4;
export const AIR_ACCEL = 5;
/** 공중에서 방향을 틀어 더 빨라질 수 있는 한계 */
export const AIR_MAX_SPEED = 4.8;
export const JUMP_MS = 600;
export const JUMP_H = 0.85;
export const JUMP_CD_MS = 1300;
/** 점프는 누르는 방향으로 최소 이 속도로 뛰어나간다 (구멍 한 칸 건너기: 약 2.4m) */
export const JUMP_SPEED = 3.8;
/** 내려찍기: 살짝 떠올랐다가(RISE) 빠르게 내리꽂는다(SLAM) */
export const STOMP_RISE_MS = 260;
export const STOMP_H = 0.75;
export const SLAM_MS = 110;
export const STOMP_CD_MS = 4000;
/** 내려찍은 자리 주변 얼음 피해 (2.1m = 바로 옆 여섯 칸까지) */
export const STOMP_R = 2.1;
export const STOMP_DMG = 0.38;
/** 내려찍은 바로 그 칸 (내 발밑이라 위험!) */
export const STOMP_CENTER_DMG = 0.5;
/** 밀쳐내기 반경·속도 (가까울수록 세게) */
export const KNOCK_R = 2.6;
export const KNOCK_MIN = 2.5;
export const KNOCK_MAX = 6.5;
/** 밀쳐진 사람은 짧게 휘청 떠오른다 (그동안 조작 불가) */
export const STAGGER_MS = 320;
export const STAGGER_H = 0.35;
/** 🥾 아이젠: 밀쳐지는 세기 배수 */
export const SPIKES_KNOCK = 0.5;
/** 몸끼리 부딪힘 탄성 */
export const RESTITUTION = 0.4;
export const GRAVITY = 18;
/** 물 표면 높이 (얼음 윗면 = 0) */
export const WATER_Y = -0.55;
/** 이 아래로 가라앉으면 화면에서 지운다 */
export const SINK_GONE_Y = -2.4;

/* ── 해빙 경보 ─────────────────────────────────────────────────────── */

/** 싸움 시작 이 시간 뒤 첫 경보 (경보 3초 → 8초에 첫 해빙) */
export const THAW_FIRST_WARN_MS = 5000;
export const THAW_WARN_MS = 3000;
/** 해빙 다음 경보까지 쉬는 시간: 5초에서 한 번마다 0.4초씩 줄어 최소 2초 (주기 8초 → 5초) */
export const THAW_GAP_START_MS = 5000;
export const THAW_GAP_STEP_MS = 400;
export const THAW_GAP_MIN_MS = 2000;
/** 해가 비춘 구역 얼음이 한 번에 잃는 양 */
export const THAW_DAMAGE = 0.55;

/* ── 서든데스 ──────────────────────────────────────────────────────── */

export const SUDDEN_MS = 60_000;
/** 바깥 고리부터 5초마다 한 고리씩 무너진다 */
export const SUDDEN_RING_MS = 5000;
/** 고리의 각 칸은 0.9~1.8초 흔들린 뒤 깨진다 */
export const DOOM_MIN_MS = 900;
export const DOOM_SPREAD_MS = 900;
/** 안전장치: 이때까지 2명 이상 남으면 무승부 */
export const FIGHT_MAX_MS = 120_000;

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "frost" | "spikes" | "fish";
export const ITEM_KINDS: ItemKind[] = ["frost", "spikes", "fish"];
export const ITEM_FIRST_MS = 6000;
export const ITEM_EVERY_MS = 7000;
export const ITEM_LIFE_MS = 12_000;
export const ITEM_MAX = 2;
export const ITEM_PICK_R = 0.75;
export const FROST_R = 2.1;
export const SPIKES_MS = 8000;

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string; color: string }> = {
  frost: { emoji: "❄️", name: "냉기", desc: `줍는 순간 반경 ${FROST_R}m 얼음이 다시 꽁꽁 (깨진 칸·무너지는 칸은 그대로)`, color: "#7dd3fc" },
  spikes: { emoji: "🥾", name: "아이젠", desc: `${SPIKES_MS / 1000}초 동안 내 발밑 얼음이 ${Math.round(SPIKES_DRAIN * 100)}%만 깎이고, 밀쳐지는 힘도 절반`, color: "#a3e635" },
  fish: { emoji: "🐟", name: "물고기", desc: "바로 +1점! 대신 보통 위험한 칸에 떠올라요", color: "#fb923c" },
};

/** 꼴찌 보호: 라운드 시작 때 1등보다 이만큼 이상 뒤지면 🥾 아이젠을 신고 시작 */
export const COMEBACK_GAP = 4;

/* ── 점수 ───────────────────────────────────────────────────────────── */

/** 생존 순위 점수: 1등 +3 · 2등 +2(3인 이상) · 3등 +1(4인 이상) */
export const PTS_PLACE = [3, 2, 1] as const;
export const PTS_KO = 1;
export const PTS_FISH = 1;
/** 마지막 사람들이 같은 순간 빠지면 그 사람들끼리 +2씩 / 시간 종료면 남은 사람 +2씩 */
export const PTS_DRAW = 2;

export function placePoints(rank: number, seatCount: number): number {
  if (rank === 1) return PTS_PLACE[0];
  if (rank === 2 && seatCount >= 3) return PTS_PLACE[1];
  if (rank === 3 && seatCount >= 4) return PTS_PLACE[2];
  return 0;
}
