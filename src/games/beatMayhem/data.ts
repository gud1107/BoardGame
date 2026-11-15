/**
 * 박자 난장판 — 규칙 수치와 공용 타입 (룰북: boardGameRule/박자난장판/박자난장판.md).
 *
 * 시간 단위는 ms. "곡 시각"은 카운트인 마디가 시작하는 순간이 0이다.
 * 수치는 `balance.sim.test.ts` 셀프플레이로 확인한다(레벨별 점수 차·방해 영향·판 길이).
 */

export const GAME_ID = "beat-mayhem";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const LANES = 4;

export type Difficulty = "easy" | "normal" | "hard";
export type StyleId = "polka" | "city" | "rush";
export type StyleChoice = StyleId | "random";
export const STYLE_IDS: StyleId[] = ["polka", "city", "rush"];

export interface GameOptions {
  /** 곡 수 */
  rounds: 1 | 2 | 3;
  difficulty: Difficulty;
  /** 장난(방해) 게이지를 쓰나 */
  mayhem: boolean;
  style: StyleChoice;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 2, difficulty: "normal", mayhem: true, style: "random" };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const rounds = o?.rounds === 1 || o?.rounds === 3 ? o.rounds : 2;
  const difficulty = o?.difficulty === "easy" || o?.difficulty === "hard" ? o.difficulty : "normal";
  const style = o?.style === "polka" || o?.style === "city" || o?.style === "rush" ? o.style : "random";
  return { rounds, difficulty, mayhem: o?.mayhem !== false, style };
}

export const DIFFICULTY_INFO: Record<Difficulty, { name: string; desc: string }> = {
  easy: { name: "쉬움", desc: "8분음표까지만, 듬성듬성" },
  normal: { name: "보통", desc: "16분음표가 섞여요" },
  hard: { name: "어려움", desc: "빽빽하고 두 줄 동시 누르기가 나와요" },
};

/* ── 자리 표시: 색 + 모양(색각 이상이어도 모양으로 구분) ───────────────── */

export const SEAT_COLORS = ["#f97316", "#3b82f6", "#eab308", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f43f5e"] as const;
export const SEAT_SYMBOLS = ["●", "▲", "■", "◆", "★", "♥", "✚", "⬟"] as const;

/** 줄(레인) 색과 키 — 위치·글자로도 구분된다 */
export const LANE_COLORS = ["#38bdf8", "#facc15", "#fb7185", "#a3e635"] as const;
export const LANE_KEYS = ["D", "F", "J", "K"] as const;

/* ── 판정 ───────────────────────────────────────────────────────────── */

export type Judge = "perfect" | "great" | "good" | "miss";
export const JUDGES: Judge[] = ["perfect", "great", "good", "miss"];
export const JUDGE_INFO: Record<Judge, { name: string; color: string }> = {
  perfect: { name: "퍼펙트", color: "#fde047" },
  great: { name: "그레이트", color: "#4ade80" },
  good: { name: "굿", color: "#60a5fa" },
  miss: { name: "미스", color: "#f87171" },
};

/** 판정 창 (± ms) */
export const PERFECT_MS = 45;
export const GREAT_MS = 90;
export const GOOD_MS = 135;

export const PTS: Record<Judge, number> = { perfect: 100, great: 70, good: 40, miss: 0 };
/** 콤보 보너스: 맞힐 때마다 +min(콤보, 이 값) */
export const COMBO_BONUS_MAX = 40;

export function judgeOf(absMs: number): Judge {
  return absMs <= PERFECT_MS ? "perfect" : absMs <= GREAT_MS ? "great" : absMs <= GOOD_MS ? "good" : "miss";
}

export interface Tally {
  score: number;
  combo: number;
  maxCombo: number;
  /** 퍼펙트·그레이트·굿·미스 개수 */
  judges: [number, number, number, number];
  /** 판정이 끝난 노트 수 */
  judged: number;
  /** 지금까지 모은 장난 게이지 (쓴 것 빼기 전) */
  earned: number;
}

export const zeroTally = (): Tally => ({ score: 0, combo: 0, maxCombo: 0, judges: [0, 0, 0, 0], judged: 0, earned: 0 });

/* ── 장난 (방해) ────────────────────────────────────────────────────── */

export const GAUGE_MAX = 100;
export const GAUGE_PERFECT = 3;
export const GAUGE_GREAT = 1;
/** 게이지가 이만큼 있으면 날아온 장난을 자동으로 막는다 (이만큼 소모) */
export const SHIELD_COST = 80;
/** 장난은 쏜 뒤 이만큼 박자 뒤에 시작 (예고) */
export const PRANK_LEAD_BEATS = 4;
/** 장난이 이어지는 박자 수 */
export const PRANK_BEATS = 8;

export type PrankKind = "fog" | "mirror" | "tiny" | "wobble" | "rush";
export const PRANK_KINDS: PrankKind[] = ["fog", "mirror", "tiny", "wobble", "rush"];
export const PRANK_INFO: Record<PrankKind, { emoji: string; name: string; desc: string }> = {
  fog: { emoji: "🌫️", name: "안개", desc: "노트가 가까이 올 때까지 안 보여요" },
  mirror: { emoji: "🔀", name: "뒤집기", desc: "노트 줄이 좌우로 뒤집혀 와요" },
  tiny: { emoji: "🐜", name: "콩알", desc: "노트가 콩알만 해져요" },
  wobble: { emoji: "🌀", name: "흔들흔들", desc: "판이 좌우로 출렁여요" },
  rush: { emoji: "⚡", name: "급가속", desc: "노트가 훨씬 빨리 달려와요" },
};

export function applyJudge(t: Tally, j: Judge) {
  t.judges[JUDGES.indexOf(j)]++;
  t.judged++;
  if (j === "miss") {
    t.combo = 0;
    return;
  }
  t.combo++;
  if (t.combo > t.maxCombo) t.maxCombo = t.combo;
  t.score += PTS[j] + Math.min(t.combo, COMBO_BONUS_MAX);
  t.earned += j === "perfect" ? GAUGE_PERFECT : j === "great" ? GAUGE_GREAT : 0;
}

/** 정확도 0~100 (퍼펙트 1 · 그레이트 0.7 · 굿 0.4) */
export function accuracy(judges: readonly number[], total: number): number {
  if (total <= 0) return 0;
  return Math.round(((judges[0] + judges[1] * 0.7 + judges[2] * 0.4) / total) * 1000) / 10;
}

/* ── 시간 ───────────────────────────────────────────────────────────── */

export const STEP_MS = 1000 / 30;
export const COUNTDOWN_MS = 3500;
/** 곡이 끝난 뒤 마지막 기록이 도착하길 기다리는 시간 */
export const SONG_TAIL_MS = 2200;
export const ROUND_END_MS = 8000;

/** 스크롤 빠르기 (노트가 보이기 시작해서 판정선까지 걸리는 ms) */
export const SPEEDS = [
  { id: "slow", name: "느림", ms: 2100 },
  { id: "normal", name: "보통", ms: 1550 },
  { id: "fast", name: "빠름", ms: 1150 },
] as const;
export type SpeedId = (typeof SPEEDS)[number]["id"];
