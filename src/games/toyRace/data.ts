/**
 * 장난감 방 레이스 — 규칙 수치와 공용 타입 (룰북: boardGameRule/장난감방레이스/장난감방레이스.md).
 *
 * 단위: 거리 u(장난감 차 한 대 길이 ≈ 1.1u), 속도 u/s, 시간 ms(시뮬 시각).
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(랩 시간·순위 변동·꼴찌 장난감 효과·자리 편차·레벨별 승률).
 */

export const GAME_ID = "toy-room-race";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export type TrackId = "living" | "bath" | "bedroom";
export const TRACK_IDS: TrackId[] = ["living", "bath", "bedroom"];
/** single = 트랙 하나 · gp = 세 트랙을 이어 달려 점수 합산 */
export type RaceMode = "single" | "gp";

export interface GameOptions {
  mode: RaceMode;
  /** 단판 트랙 ("random" = 시작할 때 무작위) */
  track: TrackId | "random";
  laps: 2 | 3 | 5;
  /** 🎁 선물 상자 아이템 */
  items: boolean;
  /** 🧸 꼴찌의 장난감 상자 (선두 앞에 장난감 벽을 떨어뜨림) */
  toyBox: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { mode: "single", track: "living", laps: 3, items: true, toyBox: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const mode: RaceMode = o?.mode === "gp" ? "gp" : "single";
  const track = o?.track === "random" || (o?.track && (TRACK_IDS as string[]).includes(o.track)) ? o.track : "living";
  const laps = o?.laps === 2 || o?.laps === 5 ? o.laps : 3;
  return { mode, track: track as GameOptions["track"], laps, items: o?.items !== false, toyBox: o?.toyBox !== false };
}

export const MODE_INFO: Record<RaceMode, { emoji: string; name: string; short: string }> = {
  single: { emoji: "🏁", name: "단판 레이스", short: "트랙 하나를 정해진 바퀴만큼 — 먼저 들어온 순서대로 순위" },
  gp: { emoji: "🏆", name: "그랑프리", short: "거실 → 욕실 → 아이 방 세 트랙을 이어 달려 순위 점수를 합산" },
};

export const TRACK_INFO: Record<TrackId, { emoji: string; name: string; short: string }> = {
  living: { emoji: "🛋️", name: "거실 러그 서킷", short: "소파 밑을 지나 책 점프대를 넘는 입문 코스" },
  bath: { emoji: "🛁", name: "욕실 비누 슬라이드", short: "미끄러운 🫧 비누 거품 구간과 샴푸 통 장애물" },
  bedroom: { emoji: "🧸", name: "아이 방 8자 다리", short: "책 다리로 엇갈리는 8자 코스 + 🚂 장난감 기차 건널목" },
};

/** 그랑프리 순서 */
export const GP_TRACKS: TrackId[] = ["living", "bath", "bedroom"];
/** 그랑프리 순위 점수 (1등부터) */
export const GP_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/* ── 자리 표시: 색 + 모양 + 번호 (색각 이상이어도 구분) ───────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f43f5e"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥", "✚", "⬟"] as const;
export const SEAT_COLOR_NAMES = ["주황", "파랑", "노랑", "초록", "보라", "분홍", "청록", "빨강"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 60;
/** 카운트다운 (3·2·1·출발) */
export const COUNTDOWN_MS = 4000;
/** 🚀 출발 부스트: 출발 이 시간 전 ~ 출발 직후 사이에 누르면 성공 */
export const ROCKET_EARLY_MS = 450;
export const ROCKET_LATE_MS = 150;
export const ROCKET_BOOST_MS = 1000;
/** 그보다 일찍 누르면(마지막 2초 안) 엔진이 꺼져 늦게 출발 */
export const ROCKET_STALL_WINDOW_MS = 2000;
export const STALL_MS = 700;
/** 첫 사람이 들어오면 나머지는 이 시간 안에 들어와야 한다 */
export const FINISH_GRACE_MS = 15_000;
/** 그랑프리: 레이스 사이 결과 보여 주는 시간 */
export const INTERMISSION_MS = 7000;
/** 아무도 못 들어오는 판 방지 — 바퀴당 이 시간 + 여유가 지나면 그 자리 순위로 끝 */
export const LAP_TIMEOUT_MS = 70_000;

/* ── 차 ─────────────────────────────────────────────────────────────── */

/** 부딪힘 판정 원 반지름 (차 길이 1.1, 폭 0.62) */
export const CAR_R = 0.42;
/** 자동 가속 — 손을 떼도 앞으로 간다 (조작은 핸들·브레이크·드리프트·아이템) */
export const V_MAX = 13;
export const ACCEL = 15;
/** 최고 속도보다 빠를 때(부스트가 끝난 뒤) 줄어드는 비율 /s */
export const OVERSPEED_DECAY = 2.2;
export const BRAKE = 24;
export const REVERSE_MAX = 4.5;
/** 핸들: 초당 회전 (속도가 붙어야 돈다, 최고 속도에선 조금 둔해짐) */
export const TURN = 2.55;
export const TURN_FULL_SPEED = 4;
export const TURN_HIGH_SPEED_LOSS = 0.32;
/** 옆으로 미끄러지는 속도가 줄어드는 정도 /s (높을수록 꽉 잡힘) */
export const GRIP = 9;

/** 🌀 드리프트: 이 속도 이상에서 핸들을 꺾은 채 누르고 있으면 미끄러지며 더 돈다 */
export const DRIFT_MIN_SPEED = 6.5;
export const DRIFT_GRIP = 3.4;
export const DRIFT_TURN_MULT = 1.2;
export const DRIFT_SPEED_LOSS = 0.06;
/** 드리프트를 이만큼 유지하고 떼면 ⚡ 부스트 (1단 파랑 / 2단 주황) */
export const DRIFT_T1_MS = 700;
export const DRIFT_T2_MS = 1500;
export const DRIFT_BOOST1_MS = 550;
export const DRIFT_BOOST2_MS = 1050;

export const BOOST_MULT = 1.36;
/** 🧶 러그(도로 밖 카펫) 위에선 최고 속도가 이만큼 */
export const RUG_MULT = 0.55;
/** 🫧 비누 거품: 미끄럽고 핸들이 둔함 */
export const SOAP_GRIP = 1.9;
export const SOAP_TURN = 0.82;

/** 💨 바람막이(슬립스트림): 앞차 바로 뒤에 붙어 있으면 조금 빨라진다 */
export const DRAFT_DIST = 5.5;
export const DRAFT_SIDE = 1.15;
export const DRAFT_CHARGE_MS = 600;
export const DRAFT_MULT = 1.07;

/**
 * 🐢 뒤처짐 바람: 선두보다 CATCHUP_FREE 넘게 뒤처지면 최고 속도가 조금씩 오른다
 * (CATCHUP_RANGE만큼 더 뒤처지면 최대 +CATCHUP_MAX). 선두는 늘 1배.
 */
export const CATCHUP_FREE = 6;
export const CATCHUP_RANGE = 30;
export const CATCHUP_MAX = 0.06;

/** 🧱 벽(블록 울타리): 튕겨 나오며 속도가 준다 */
export const WALL_BOUNCE = 0.35;
export const WALL_SPEED_KEEP = 0.72;

/** 🌀 빙글(맞았을 때): 핸들이 안 먹고 느려진다 */
export const SPIN_MS = 1000;
export const SPIN_SPEED = 0.3;
/** 빙글이 끝난 뒤 이 시간은 다시 안 맞는다 */
export const SPIN_IMMUNE_MS = 900;
/** 🧱 장난감 벽·기차·샴푸 통에 정면으로 박으면 */
export const CRASH_MS = 1000;

/** 📚 점프대: 이 속도 이상으로 넘으면 붕 뜬다 */
export const JUMP_MIN_SPEED = 7;
export const JUMP_BASE_MS = 380;
export const JUMP_PER_SPEED_MS = 32;
export const JUMP_H = 1.25;
/** 착지할 때 차 방향이 길과 이 각도 안이면 ✨ 완벽한 착지 부스트 */
export const PERFECT_LAND_RAD = 0.26;
export const PERFECT_LAND_BOOST_MS = 450;

/** 🔁 제자리로 (R): 길 가운데로 돌아가는 대신 잠깐 멈춤 */
export const RESET_MS = 900;
/** 반대 방향으로 이만큼 가면 경고 */
export const WRONG_WAY_MS = 1200;

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "battery" | "bubble" | "yarn" | "duck" | "yoyo" | "top";
export const ITEM_KINDS: ItemKind[] = ["battery", "bubble", "yarn", "duck", "yoyo", "top"];

/** 🎁 선물 상자: 다시 생기는 시간 */
export const BOX_RESPAWN_MS = 3000;
export const BOX_R = 0.75;
/** 상자를 깨고 아이템이 정해지기까지 (룰렛) */
export const ITEM_ROLL_MS = 900;

export const BATTERY_MS = 1400;
export const BATTERY_MULT = 1.42;
export const BUBBLE_MS = 8000;
export const YARN_SPEED = 24;
export const YARN_LIFE_MS = 2600;
export const YARN_R = 0.45;
export const YARN_SAFE_MS = 350;
export const DUCK_LIFE_MS = 25_000;
export const DUCK_R = 0.5;
export const DUCK_BEHIND = 1.25;
export const DUCK_MAX = 8;
/** 오리를 놓은 사람은 이 시간 동안 자기 오리에 안 걸린다 */
export const DUCK_OWNER_SAFE_MS = 1500;
/** 🪀 요요: 바로 앞 순위 차를 쫓아간다 (트랙을 따라) */
export const YOYO_SPEED = 34;
export const YOYO_MAX_MS = 4200;
export const TOP_MS = 3000;
export const TOP_MULT = 1.2;

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; desc: string; color: string }> = {
  battery: { emoji: "🔋", name: "건전지", desc: `${BATTERY_MS / 1000}초 동안 쭉 빨라져요`, color: "#22c55e" },
  bubble: { emoji: "🫧", name: "비눗방울 방패", desc: `${BUBBLE_MS / 1000}초 동안 한 번 막아 줘요 (장난감 벽·오리·털실·요요)`, color: "#7dd3fc" },
  yarn: { emoji: "🧶", name: "털실 공", desc: "앞으로 굴려요 — 벽에 튕기며 가다가 맞은 차는 빙글", color: "#f472b6" },
  duck: { emoji: "🦆", name: "고무 오리", desc: "뒤에 놓아요 — 밟은 차는 빙글", color: "#facc15" },
  yoyo: { emoji: "🪀", name: "요요", desc: "바로 앞 순위 차를 쫓아가 빙글 (방패로만 막혀요)", color: "#f97316" },
  top: { emoji: "🌀", name: "팽이", desc: `${TOP_MS / 1000}초 동안 무적 + 빨라지고, 부딪힌 차는 빙글`, color: "#c084fc" },
};

/**
 * 순위에 따른 아이템 확률 (q = 0 선두 ~ 1 꼴찌). 앞쪽은 지키는 아이템, 뒤쪽은 따라잡는 아이템이 잘 나온다.
 */
export function itemWeights(q: number): Record<ItemKind, number> {
  if (q < 0.25) return { battery: 10, bubble: 25, yarn: 30, duck: 35, yoyo: 0, top: 0 };
  if (q < 0.6) return { battery: 25, bubble: 15, yarn: 30, duck: 20, yoyo: 10, top: 0 };
  return { battery: 30, bubble: 10, yarn: 15, duck: 5, yoyo: 25, top: 15 };
}

/* ── 🧸 꼴찌의 장난감 상자 ──────────────────────────────────────────── */

/** 선두가 한 바퀴를 돌 때마다 꼴찌가 받는다. 이 시간 안에 안 쓰면 저절로 떨어진다 */
export const TOY_AUTO_MS = 10_000;
/** 선두보다 이만큼 앞의 투하 자리에 떨어진다 */
export const TOY_AHEAD = 24;
/** 그림자로 미리 보여 주는 시간 → 이 뒤에 벽이 생긴다 */
export const TOY_WARN_MS = 1500;
export const TOY_LIFE_MS = 12_000;
/** 벽 길이(트랙 방향) */
export const TOY_LEN = 1.3;

/* ── 점수 표시 ───────────────────────────────────────────────────── */

/** ms → "1:02.34" */
export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-:--.--";
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function ordinal(rank: number): string {
  return `${rank}등`;
}
