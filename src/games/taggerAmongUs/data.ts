/**
 * 술래는 우리 중에 — 규칙 수치와 공용 타입 (룰북: boardGameRule/술래는우리중에/술래는우리중에.md).
 *
 * 단위: 거리 m, 속도 m/s, 시간 ms(시뮬 시각). 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다.
 */

export const GAME_ID = "tagger-among-us";
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;

/** 술래 정하기: 무작위 · 방장 · AI(봇 자리가 있을 때) */
export type TaggerPick = "random" | "host" | "bot";
export const TAGGER_PICKS: TaggerPick[] = ["random", "host", "bot"];
export const PICK_INFO: Record<TaggerPick, { label: string; desc: string }> = {
  random: { label: "🎲 무작위", desc: "누가 술래인지 아무도 몰라요 (술래 본인만 알아요)" },
  host: { label: "👑 방장이 술래", desc: "방장이 술래를 맡아요 — 처음 하는 친구들을 데리고 할 때" },
  bot: { label: "🤖 AI가 술래", desc: "AI 자리 중 하나가 술래 — 사람은 모두 도망자 (AI 자리가 없으면 무작위)" },
};

export type MatchMinutes = 7 | 9 | 12;
export const MATCH_MINUTES: MatchMinutes[] = [7, 9, 12];

export interface GameOptions {
  pick: TaggerPick;
  minutes: MatchMinutes;
}

export const DEFAULT_OPTIONS: GameOptions = { pick: "random", minutes: 9 };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const pick = o?.pick === "host" || o?.pick === "bot" ? o.pick : "random";
  const minutes = o?.minutes === 7 || o?.minutes === 12 ? o.minutes : 9;
  return { pick, minutes };
}

/* ── 자리 표시: 색 + 모양 (색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#a3e635", "#f472b6", "#c4b5fd"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★"] as const;

/* ── 시간 ───────────────────────────────────────────────────────────── */

/** 시뮬 한 틱 (20Hz) */
export const TICK_MS = 50;
/** 시작하고 이 시간 동안 술래는 가면을 쓸 수 없다 (흩어질 시간) */
export const GRACE_MS = 20_000;
export const timeLimitMs = (o: GameOptions) => o.minutes * 60_000;

/* ── 몸 ─────────────────────────────────────────────────────────────── */

export const BODY_R = 0.3;
export const EYE_STAND = 1.5;
export const EYE_CROUCH = 0.9;
/** 가면 쓴 술래의 눈높이 (키가 훌쩍 커진다) */
export const EYE_MASK = 1.95;
export const SPEED_CROUCH = 1.35;
export const SPEED_WALK = 2.6;
export const SPEED_RUN = 4.8;
/** 달리기 체력: 100에서 초당 22 줄고(약 4.5초), 안 달리면 초당 14 찬다 */
export const STAMINA_DRAIN = 22;
export const STAMINA_REGEN = 14;
export const STAMINA_MIN_RUN = 25;

/** 이동 상태: 0 멈춤 · 1 앉아 걷기 · 2 걷기 · 3 달리기 */
export type MoveMode = 0 | 1 | 2 | 3;

/* ── 술래 ───────────────────────────────────────────────────────────── */

/** 가면 쓴 술래의 속도 (체력 없이 늘 이 속도) */
export const TAG_SPEED = 4.25;
/** 덮치기(터치) 동안의 돌진 속도와 시간 */
export const LUNGE_SPEED = 7.2;
export const SWING_MS = 350;
/** 터치가 닿는 거리 / 좌우 각도(라디안) */
export const HIT_R = 1.45;
export const HIT_CONE = 0.95;
/** 터치 뒤 숨 고르기: 맞혔을 때 / 헛쳤을 때. 그동안 속도 ×RECOVER_MUL, 터치 불가 */
export const RECOVER_HIT_MS = 3200;
export const RECOVER_MISS_MS = 1500;
export const RECOVER_MUL = 0.4;
/** 가면 쓰기 / 벗기에 걸리는 시간 (그동안 못 움직인다) */
export const MASK_ON_MS = 1500;
export const MASK_OFF_MS = 800;
/** 탈 기운: 가면을 쓰면 100에서 maskSecFor(도망자 수)초에 바닥, 벗으면 GAUGE_REGEN_SEC초에 가득 */
const MASK_SEC = [11, 11, 11, 17, 23] as const;
/** 도망자가 적을수록 가면을 오래 못 쓴다 (2명 12초 · 3명 20초 · 4명 27초) — 셀프플레이로 맞춘 값 */
export function maskSecFor(runners: number): number {
  return MASK_SEC[Math.max(0, Math.min(MASK_SEC.length - 1, Math.round(runners)))];
}
export const GAUGE_REGEN_SEC = 26;
/** 이만큼은 차야 다시 쓸 수 있다 */
export const GAUGE_MIN_ON = 40;
/** 한 명 얼릴 때마다 */
export const GAUGE_CATCH = 8;
/** 가면 쓴 술래는 닫힌 문을 이 시간 걸려 부수고 연다 */
export const BASH_MS = 1100;
/** 봉인 훼손(차기): 걸리는 시간 / 깎이는 진행도 */
export const KICK_MS = 1800;
export const KICK_LOSS = 0.25;
/** 🧂 소금에 맞으면: 변장 중 / 가면 중 기절 시간, 정체가 드러나는 시간 */
export const STUN_KID_MS = 4000;
export const STUN_MASK_MS = 3200;
export const EXPOSE_MS = 30_000;

/* ── 소리 (술래 눈에 벽 너머 파문으로 보이는 반경 m, 직선거리) ─────────── */

export const NOISE_WALK = 6;
export const NOISE_RUN = 14;
export const NOISE_SEAL = 7;
export const NOISE_THAW = 5;
export const NOISE_DOOR = 10;
/** 변장 중에는 귀가 어둡다 */
export const KID_HEAR_MUL = 0.5;
/** 가면 쓴 술래가 이 거리 안이면 도망자에게 심장 소리가 들린다 */
export const HEART_R = 13;

/* ── 봉인 ───────────────────────────────────────────────────────────── */

/** 혼자 봉인 터 하나를 끝내는 시간. 함께 하면 한 명 늘 때마다 +SEAL_HELP 배속 */
const SEAL_MS_BY = [13_000, 13_000, 13_000, 17_000, 20_000] as const;
/** 도망자가 많을수록 봉인 하나가 오래 걸린다 (2명 15초 · 3명 20초 · 4명 24초) */
export function sealMsFor(runners: number): number {
  return SEAL_MS_BY[Math.max(0, Math.min(SEAL_MS_BY.length - 1, Math.round(runners)))];
}
export const SEAL_HELP = 0.75;
/** 필요한 봉인 수 = 도망자 수 + 1 (최대 5), 도망자가 둘뿐이면 2. 봉인 터는 그보다 2곳 많다 */
export function sealsFor(runners: number): number {
  return runners <= 2 ? 2 : Math.min(5, runners + 1);
}
export const EXTRA_SPOTS = 2;
/** 마지막 봉인 뒤 교문 빗장이 풀리기까지 */
export const GATE_OPEN_MS = 6000;
export const EXIT_RANGE = 1.7;

/* ── 얼음땡 ─────────────────────────────────────────────────────────── */

/** 세 번째로 잡히면 바로 끌려간다 */
export const MAX_FREEZES = 3;
/** n번째 얼음이 녹지 못하고 끌려가기까지 */
export const FREEZE_MS = [50_000, 35_000] as const;
/** 가면 쓴 술래가 이 거리 안에서 지키고 있으면 얼음 시계가 멈춘다 (지키기 방지) */
export const CAMP_R = 7;
export const THAW_MS = 2500;
/** 땡! 직후 무적 */
export const THAW_SAFE_MS = 2200;

/* ── 소금 ───────────────────────────────────────────────────────────── */

export const SALT_START = 1;
export const SALT_MAX = 2;
export const SALT_RANGE = 6.5;
export const SALT_CONE = 0.4;
/** 같은 편이 맞으면 잠깐 눈을 못 뜬다 (느려짐) */
export const SALT_SLOW_MS = 2500;
export const SLOW_MUL = 0.55;

/* ── 상호작용 ───────────────────────────────────────────────────────── */

export const USE_RANGE = 2.3;
export const DOOR_RANGE = 2.2;
export const THAW_RANGE = 2.0;

/* ── 결과 ───────────────────────────────────────────────────────────── */

export type Winner = "tagger" | "runners" | "draw";

/** 탈출한 도망자가 절반을 넘으면 도망자 승, 절반이면 무승부, 못 미치면 술래 승 */
export function winnerOf(escaped: number, runners: number): Winner {
  if (escaped * 2 > runners) return "runners";
  if (escaped * 2 === runners && escaped > 0) return "draw";
  return "tagger";
}

export function timeText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
