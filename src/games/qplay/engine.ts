import { seededRng, shuffle } from "@/lib/rng";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { TOPICS, topicDictionary } from "@/games/wordTower/words";
import { normalizeWord } from "@/games/wordTower/engine";
import { GENERAL_BANK, IDIOM_BANK, NONSENSE_BANK, OX_BANK, PROVERB_BANK, type ChoiceItem, type Diff } from "./questions";

/**
 * 큐플레이 엔진 (boardGameRule/큐플레이/큐플레이.md).
 *
 * 락스텝: 방장이 보낸 시드로 모든 기기가 같은 미니 게임 순서·문제·보기 순서를 만들고, 이후 액션만
 * 주고받는다. 액션은 방장이 붙인 번호 순서로만 적용되므로(§12) "누가 먼저 맞혔나"가 모두 같다.
 * 시간은 엔진 밖에서 잰다 — 방장이 `TIMEOUT { stage }`를 보내고, 엔진은 옛 stage를 무시한다.
 */

export type Seat = number;
export type Phase = "intro" | "question" | "aim" | "reveal" | "climb" | "miniEnd" | "ended";
export type MiniId = "ox" | "proverb" | "idiom" | "nonsense" | "general" | "chosung" | "climb" | "missile";
export type Length = "short" | "normal" | "long";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MINI_IDS: readonly MiniId[] = ["ox", "proverb", "idiom", "nonsense", "general", "chosung", "climb", "missile"];
export const ROUND_OPTIONS = [3, 5, 8] as const;
export const LENGTH_OPTIONS: readonly { value: Length; label: string }[] = [
  { value: "short", label: "짧게" },
  { value: "normal", label: "보통" },
  { value: "long", label: "길게" },
];

export const MINI_INFO: Record<MiniId, { emoji: string; name: string; short: string; color: string }> = {
  ox: { emoji: "⭕", name: "OX 서바이벌", short: "틀리면 탈락! 끝까지 살아남으면 +30", color: "#0ea5e9" },
  proverb: { emoji: "📜", name: "속담 이어 말하기", short: "속담 앞부분을 보고 뒷부분 고르기", color: "#f59e0b" },
  idiom: { emoji: "🀄", name: "사자성어", short: "뜻을 보고 성어, 성어를 보고 뜻", color: "#ef4444" },
  nonsense: { emoji: "🤪", name: "넌센스 퀴즈", short: "머리를 말랑하게! 말장난 정답 고르기", color: "#a855f7" },
  general: { emoji: "🧠", name: "상식 퀴즈", short: "역사·과학·지리·생활 상식 4지선다", color: "#22c55e" },
  chosung: { emoji: "🔤", name: "초성 퀴즈", short: "주제와 초성을 보고 단어를 직접 입력", color: "#ec4899" },
  climb: { emoji: "🧗", name: "올라올라", short: "맞히면 한 층 위로, 틀리면 아래로 — 10층까지!", color: "#14b8a6" },
  missile: { emoji: "🚀", name: "미사일", short: "먼저 맞히면 미사일 발사! 하트 0이면 탈락", color: "#f97316" },
};

// ---------------------------------------------------------------------------
// 점수·시간 (§3~§11)
// ---------------------------------------------------------------------------

export const CHOICE_POINTS = [30, 25, 20, 15] as const;
export const CHOICE_FLOOR = 10;
export const CHOSUNG_POINTS = [40, 32, 26, 20] as const;
export const CHOSUNG_FLOOR = 15;
export const CHOSUNG_TRIES = 3;
export const OX_CORRECT = 10;
export const OX_SURVIVE = 30;
export const CLIMB_TOP = 10;
export const CLIMB_FLOOR_POINTS = 5;
export const CLIMB_FINISH = [40, 25, 15] as const;
export const CLIMB_FINISH_FLOOR = 10;
export const CLIMB_QUESTIONS = 80;
export const MISSILE_HP = 3;
export const MISSILE_HIT = 10;
export const MISSILE_KILL = 10;
export const MISSILE_DEFEND = 5;
export const MISSILE_HP_POINTS = 10;
export const LAST_SURVIVOR = 30;

const COUNTS: Record<Exclude<MiniId, "climb">, Record<Length, number>> = {
  ox: { short: 6, normal: 8, long: 10 },
  proverb: { short: 4, normal: 6, long: 8 },
  idiom: { short: 4, normal: 6, long: 8 },
  nonsense: { short: 4, normal: 6, long: 8 },
  general: { short: 4, normal: 6, long: 8 },
  chosung: { short: 3, normal: 5, long: 7 },
  missile: { short: 8, normal: 12, long: 16 },
};
const CLIMB_SECONDS: Record<Length, number> = { short: 45, normal: 60, long: 75 };

export function rankPoints(rank: number, table: readonly number[], floor: number): number {
  return table[rank] ?? floor;
}

export interface GameOptions {
  /** 나올 수 있는 미니 게임(방장 선택, 최소 1개). */
  readonly minis: readonly MiniId[];
  readonly rounds: number;
  readonly length: Length;
}

export const DEFAULT_OPTIONS: GameOptions = { minis: MINI_IDS, rounds: 5, length: "normal" };

// ---------------------------------------------------------------------------
// 문제
// ---------------------------------------------------------------------------

/**
 * ox: choices = ["O","X"] · choice: 4지선다(올라올라는 3지선다) · chosung: 직접 입력.
 * `accepted`는 초성 퀴즈에서 정답으로 인정하는 단어 전부(같은 주제·같은 초성).
 */
export interface Question {
  readonly kind: "ox" | "choice" | "chosung";
  readonly prompt: string;
  /** 문제 위에 작게 붙는 안내(예: "뒷부분은?"). */
  readonly label?: string;
  readonly choices: readonly string[];
  readonly answer: number;
  readonly explain?: string;
  readonly d: Diff;
  readonly chosung?: string;
  readonly topic?: { readonly name: string; readonly emoji: string };
  readonly word?: string;
  readonly accepted?: readonly string[];
}

export type BankId = "ox" | "proverb" | "idiom" | "nonsense" | "general" | "chosung";

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 한글 음절의 초성만 뽑는다("사과" → "ㅅㄱ"). 한글이 아닌 글자는 그대로. */
export function toChosung(word: string): string {
  let out = "";
  for (const ch of word) {
    const c = ch.charCodeAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 초성 퀴즈 출제 후보: 2~4글자 단어(주제 id, 단어). */
const CHOSUNG_POOL: readonly { topicId: string; word: string }[] = TOPICS.flatMap((t) =>
  t.words.filter((w) => w.length >= 2 && w.length <= 4).map((word) => ({ topicId: t.id, word })),
);

function bankSize(bank: BankId): number {
  switch (bank) {
    case "ox":
      return OX_BANK.length;
    case "proverb":
      return PROVERB_BANK.length;
    case "idiom":
      return IDIOM_BANK.length;
    case "nonsense":
      return NONSENSE_BANK.length;
    case "general":
      return GENERAL_BANK.length;
    case "chosung":
      return CHOSUNG_POOL.length;
  }
}

/** 시드별 은행 순서 — 커서로 앞에서부터 꺼내 같은 판에 같은 문제가 다시 나오지 않게 한다. */
function bankOrder(seed: number, bank: BankId): number[] {
  return shuffle(
    Array.from({ length: bankSize(bank) }, (_, i) => i),
    seededRng((seed ^ hashString(bank)) >>> 0),
  );
}

function pickFrom<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 정답 + 오답 보기들을 섞어 Question 보기·정답 번호로. */
function arrange(rng: () => number, correct: string, wrong: readonly string[]): { choices: string[]; answer: number } {
  const choices = shuffle([correct, ...wrong], rng);
  return { choices, answer: choices.indexOf(correct) };
}

/** 같은 묶음(g)·같은 글자는 빼고 오답 보기 3개. */
function distractors<T>(rng: () => number, bank: readonly T[], selfIndex: number, text: (t: T) => string, group: (t: T) => string | undefined): string[] {
  const self = bank[selfIndex];
  const g = group(self);
  const pool = bank.filter((t, i) => i !== selfIndex && text(t) !== text(self) && (g === undefined || group(t) !== g));
  const picked: string[] = [];
  for (const t of shuffle([...pool], rng)) {
    const s = text(t);
    if (!picked.includes(s)) picked.push(s);
    if (picked.length === 3) break;
  }
  return picked;
}

function choiceQuestion(rng: () => number, item: ChoiceItem): Question {
  return { kind: "choice", prompt: item.q, ...arrange(rng, item.a, item.wrong), explain: item.x, d: item.d };
}

export function buildQuestion(bank: BankId, index: number, n: number, rng: () => number): Question {
  switch (bank) {
    case "ox": {
      const it = OX_BANK[index];
      return { kind: "ox", prompt: it.q, choices: ["O", "X"], answer: it.a ? 0 : 1, explain: it.x, d: it.d };
    }
    case "proverb": {
      const it = PROVERB_BANK[index];
      const wrong = distractors(rng, PROVERB_BANK, index, (p) => p.back, (p) => p.g);
      return { kind: "choice", prompt: `${it.front} …`, label: "뒷부분은?", ...arrange(rng, it.back, wrong), explain: `${it.front} ${it.back} — ${it.mean}`, d: it.d };
    }
    case "idiom": {
      const it = IDIOM_BANK[index];
      const explain = `${it.word}(${it.hanja}) — ${it.mean}`;
      if (n % 2 === 0) {
        const wrong = distractors(rng, IDIOM_BANK, index, (p) => p.word, (p) => p.g);
        return { kind: "choice", prompt: it.mean, label: "이 뜻의 사자성어는?", ...arrange(rng, it.word, wrong), explain, d: it.d };
      }
      const wrong = distractors(rng, IDIOM_BANK, index, (p) => p.mean, (p) => p.g);
      return { kind: "choice", prompt: it.word, label: "이 사자성어의 뜻은?", ...arrange(rng, it.mean, wrong), explain, d: it.d };
    }
    case "nonsense":
      return choiceQuestion(rng, NONSENSE_BANK[index]);
    case "general":
      return choiceQuestion(rng, GENERAL_BANK[index]);
    case "chosung": {
      const { topicId, word } = CHOSUNG_POOL[index];
      const topic = TOPICS.find((t) => t.id === topicId)!;
      const chosung = toChosung(word);
      const accepted = [...topicDictionary(topicId)].filter((w) => toChosung(w) === chosung).sort();
      return {
        kind: "chosung",
        prompt: chosung,
        label: `${topic.emoji} ${topic.name}`,
        choices: [],
        answer: -1,
        chosung,
        topic: { name: topic.name, emoji: topic.emoji },
        word,
        accepted,
        explain: accepted.length > 1 ? `출제 단어 "${word}" · 함께 인정: ${accepted.filter((w) => w !== word).slice(0, 6).join(", ")}` : `정답 "${word}"`,
        d: word.length >= 4 ? 3 : word.length === 3 ? 2 : 1,
      };
    }
  }
}

/** 올라올라(§10) 3지선다 — 사칙연산·큰 수·짝수 찾기. 시드로 결정적으로 만든다. */
export function buildClimbQuestions(seed: number, count = CLIMB_QUESTIONS): Question[] {
  const rng = seededRng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const nearby = (answer: number, spread: number) => {
    const out = new Set<number>();
    while (out.size < 2) {
      const v = answer + (rng() < 0.5 ? -1 : 1) * int(1, spread);
      if (v !== answer && v >= 0) out.add(v);
    }
    return [...out].map(String);
  };
  const out: Question[] = [];
  for (let i = 0; i < count; i++) {
    const kind = int(0, 5);
    let prompt: string;
    let correct: number;
    let wrong: string[];
    if (kind <= 1) {
      const a = int(11, 69);
      const b = int(5, 39);
      prompt = `${a} + ${b} = ?`;
      correct = a + b;
      wrong = nearby(correct, 10);
    } else if (kind === 2) {
      const a = int(30, 99);
      const b = int(5, a - 10);
      prompt = `${a} − ${b} = ?`;
      correct = a - b;
      wrong = nearby(correct, 10);
    } else if (kind === 3) {
      const a = int(2, 9);
      const b = int(2, 9);
      prompt = `${a} × ${b} = ?`;
      correct = a * b;
      wrong = nearby(correct, Math.max(3, a));
    } else if (kind === 4) {
      const base = int(100, 899);
      const nums = shuffle([base, base + int(1, 60), base + int(61, 99)], rng);
      prompt = "가장 큰 수는?";
      correct = Math.max(...nums);
      wrong = nums.filter((v) => v !== correct).map(String);
    } else {
      const even = int(5, 49) * 2;
      prompt = "짝수는?";
      correct = even;
      wrong = [even + 1, even - 1 + int(0, 1) * 4].map(String);
    }
    out.push({ kind: "choice", prompt, ...arrange(rng, String(correct), wrong), d: 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

export interface Answer {
  /** 고른 보기(초성 퀴즈·무응답은 null). */
  readonly choice: number | null;
  readonly correct: boolean;
  /** 이 문제에서 몇 번째로 도착한 (정답) 응답인지 — 선착순 점수용. */
  readonly order: number;
  /** 초성 퀴즈: 틀린 시도들. */
  readonly wrongs?: readonly string[];
  /** 초성 퀴즈: 맞힌 단어. */
  readonly text?: string;
}

export interface Shot {
  readonly from: Seat;
  readonly to: Seat;
  readonly kill: boolean;
  readonly auto: boolean;
}

export interface MiniRecord {
  readonly mini: MiniId;
  readonly scores: readonly number[];
  readonly winners: readonly Seat[];
}

/** 좌석별 누적 기록(전적용, §15). */
export interface SeatStats {
  readonly correct: readonly number[];
  readonly answered: readonly number[];
  readonly oxSurvived: readonly number[];
  readonly hits: readonly number[];
  readonly kills: readonly number[];
  readonly climbFinish: readonly number[];
  readonly climbFirst: readonly number[];
  readonly chosungFirst: readonly number[];
  readonly lastSurvivor: readonly number[];
}

export interface GameState {
  readonly seatCount: number;
  readonly seed: number;
  readonly options: GameOptions;
  readonly plan: readonly MiniId[];
  /** 0부터. */
  readonly miniIndex: number;
  readonly phase: Phase;
  /** 단계 식별자 — TIMEOUT/NEXT의 중복·지연 도착을 걸러낸다. */
  readonly stage: number;
  readonly questions: readonly Question[];
  readonly qIndex: number;
  readonly answers: Readonly<Record<Seat, Answer>>;
  /** 이번 문제에 도착한 응답 수(정답 순서 매기기). */
  readonly arrivals: number;
  /** OX·미사일에서 살아 있는지. */
  readonly alive: readonly boolean[];
  readonly hp: readonly number[];
  /** 미사일 조준 중인 사람. */
  readonly shooter: Seat | null;
  readonly shot: Shot | null;
  /** 직전 문제에서 얻은 점수(공개 화면 팝업). */
  readonly gained: readonly number[];
  /** OX: 직전 문제에서 탈락한 좌석 · 전원 오답 구제 여부. */
  readonly eliminated: readonly Seat[];
  readonly revived: boolean;
  /** 올라올라 */
  readonly climbIdx: readonly number[];
  readonly floor: readonly number[];
  readonly finishOrder: readonly Seat[];
  readonly lastClimb: readonly (boolean | null)[];
  readonly miniScores: readonly number[];
  readonly scores: readonly number[];
  readonly miniWins: readonly number[];
  readonly history: readonly MiniRecord[];
  readonly cursors: Readonly<Record<BankId, number>>;
  /** 좌석별 "답할 수 있었는데 안 낸 문제" 연속 횟수 — 무응답 봇 대체 투표 트리거용. */
  readonly idle: readonly number[];
  readonly stats: SeatStats;
}

export type EngineAction =
  | { type: "ANSWER"; seat: Seat; q: number; choice: number }
  | { type: "TYPE"; seat: Seat; q: number; text: string }
  | { type: "FIRE"; seat: Seat; target: Seat }
  | { type: "CLIMB"; seat: Seat; idx: number; choice: number }
  | { type: "TIMEOUT"; stage: number }
  | { type: "NEXT"; stage: number };

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export function currentMini(state: Pick<GameState, "plan" | "miniIndex">): MiniId {
  return state.plan[state.miniIndex];
}

export function currentQuestion(state: GameState): Question | null {
  return state.questions[state.qIndex] ?? null;
}

/** 단계별 제한 시간(ms). 끝난 판은 0(타이머 없음). */
export function phaseDurationMs(state: Pick<GameState, "phase" | "plan" | "miniIndex" | "options">): number {
  const mini = currentMini(state);
  switch (state.phase) {
    case "intro":
      return 4500;
    case "question":
      return mini === "ox" ? 8000 : mini === "chosung" ? 25_000 : mini === "missile" ? 10_000 : 12_000;
    case "aim":
      return 7000;
    case "reveal":
      return mini === "ox" ? 3000 : 3500;
    case "climb":
      return CLIMB_SECONDS[state.options.length] * 1000;
    case "miniEnd":
      return 7000;
    default:
      return 0;
  }
}

/** 이번 문제에 답할 수 있는 좌석(OX·미사일은 살아 있는 사람만). */
export function eligibleSeats(state: GameState): Seat[] {
  const mini = currentMini(state);
  return Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => (mini === "ox" || mini === "missile" ? state.alive[s] : true));
}

/** 이 좌석의 이번 문제 응답이 끝났는지(초성은 정답 또는 시도 소진). */
export function hasFinished(state: GameState, seat: Seat): boolean {
  const a = state.answers[seat];
  if (!a) return false;
  if (currentMini(state) !== "chosung") return true;
  return a.correct || (a.wrongs?.length ?? 0) >= CHOSUNG_TRIES;
}

/** 답할 사람이 모두 답했는지 — 방장이 시간 초과를 앞당기는 조건. */
export function allAnswered(state: GameState): boolean {
  if (state.phase === "climb") return eligibleSeats(state).every((s) => state.floor[s] >= CLIMB_TOP || state.climbIdx[s] >= state.questions.length);
  if (state.phase !== "question") return false;
  // OX는 마음을 바꿀 수 있으니 모두 자리를 잡아도 시간이 끝날 때까지 기다린다.
  if (currentQuestion(state)?.kind === "ox") return false;
  return eligibleSeats(state).every((s) => hasFinished(state, s));
}

export function aliveCount(state: Pick<GameState, "alive">): number {
  return state.alive.filter(Boolean).length;
}

export function computeRankings(state: GameState): { seat: Seat; rank: number; score: number; miniWins: number }[] {
  const rows = Array.from({ length: state.seatCount }, (_, seat) => ({ seat, score: state.scores[seat] ?? 0, miniWins: state.miniWins[seat] ?? 0 }));
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.score - a.score || b.miniWins - a.miniWins;
  const sorted = [...rows].sort((a, b) => cmp(a, b) || a.seat - b.seat);
  return sorted.map((r) => ({ ...r, rank: sorted.findIndex((o) => cmp(o, r) === 0) + 1 }));
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state)
    .filter((r) => r.rank === 1)
    .map((r) => r.seat);
}

/** 이 문제의 정답자들(도착 순서대로). */
export function correctOrder(state: GameState): Seat[] {
  return Object.entries(state.answers)
    .filter(([, a]) => a.correct)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([s]) => Number(s));
}

// ---------------------------------------------------------------------------
// 시작·미니 게임 준비
// ---------------------------------------------------------------------------

function clampOptions(options: Partial<GameOptions> | undefined): GameOptions {
  const minis = (Array.isArray(options?.minis) ? options.minis : MINI_IDS).filter((m, i, arr): m is MiniId => MINI_IDS.includes(m as MiniId) && arr.indexOf(m) === i);
  const length: Length = options?.length === "short" || options?.length === "long" ? options.length : "normal";
  const rounds = Math.max(1, Math.min(12, Math.round(options?.rounds ?? DEFAULT_OPTIONS.rounds)));
  return { minis: minis.length > 0 ? minis : MINI_IDS, rounds, length };
}

/** 고른 미니 게임을 섞고, 라운드가 더 많으면 다시 섞어 이어 붙인다(같은 종류가 연달아 나오지 않게). */
function buildPlan(opts: GameOptions, rng: () => number): MiniId[] {
  const plan: MiniId[] = [];
  while (plan.length < opts.rounds) {
    let batch = shuffle([...opts.minis], rng);
    if (plan.length > 0 && batch.length > 1 && batch[0] === plan[plan.length - 1]) batch = [...batch.slice(1), batch[0]];
    plan.push(...batch);
  }
  return plan.slice(0, opts.rounds);
}

const zeros = (n: number) => Array.from({ length: n }, () => 0);

function bankOf(mini: MiniId): BankId | null {
  if (mini === "climb") return null;
  if (mini === "missile") return "general";
  return mini;
}

/** 미니 게임 i를 준비 — 문제 생성, 생존·하트·층 초기화. */
function setupMini(state: GameState, miniIndex: number): GameState {
  const mini = state.plan[miniIndex];
  const n = state.seatCount;
  const rng = seededRng((state.seed + miniIndex * 7919) >>> 0);
  let questions: Question[];
  let cursors = state.cursors;
  const bank = bankOf(mini);
  if (bank === null) {
    questions = buildClimbQuestions((state.seed ^ (miniIndex * 104729)) >>> 0);
  } else {
    const order = bankOrder(state.seed, bank);
    const count = mini === "missile" ? COUNTS.missile[state.options.length] : COUNTS[mini as Exclude<MiniId, "climb">][state.options.length];
    const start = state.cursors[bank];
    questions = Array.from({ length: count }, (_, k) => buildQuestion(bank, order[(start + k) % order.length], k, rng));
    cursors = { ...state.cursors, [bank]: start + count };
  }
  return {
    ...state,
    miniIndex,
    phase: "intro",
    stage: state.stage + 1,
    questions,
    qIndex: 0,
    answers: {},
    arrivals: 0,
    alive: Array.from({ length: n }, () => true),
    hp: Array.from({ length: n }, () => (mini === "missile" ? MISSILE_HP : 0)),
    shooter: null,
    shot: null,
    gained: zeros(n),
    eliminated: [],
    revived: false,
    climbIdx: zeros(n),
    floor: zeros(n),
    finishOrder: [],
    lastClimb: Array.from({ length: n }, () => null),
    miniScores: zeros(n),
    cursors,
  };
}

export function startGame(seatCount: number, seed: number, options?: Partial<GameOptions>): GameState {
  const opts = clampOptions(options);
  const plan = buildPlan(opts, seededRng(seed));
  const n = seatCount;
  const base: GameState = {
    seatCount,
    seed,
    options: opts,
    plan,
    miniIndex: 0,
    phase: "intro",
    stage: -1,
    questions: [],
    qIndex: 0,
    answers: {},
    arrivals: 0,
    alive: [],
    hp: [],
    shooter: null,
    shot: null,
    gained: zeros(n),
    eliminated: [],
    revived: false,
    climbIdx: [],
    floor: [],
    finishOrder: [],
    lastClimb: [],
    miniScores: zeros(n),
    scores: zeros(n),
    miniWins: zeros(n),
    history: [],
    cursors: { ox: 0, proverb: 0, idiom: 0, nonsense: 0, general: 0, chosung: 0 },
    idle: zeros(n),
    stats: {
      correct: zeros(n),
      answered: zeros(n),
      oxSurvived: zeros(n),
      hits: zeros(n),
      kills: zeros(n),
      climbFinish: zeros(n),
      climbFirst: zeros(n),
      chosungFirst: zeros(n),
      lastSurvivor: zeros(n),
    },
  };
  return setupMini(base, 0);
}

// ---------------------------------------------------------------------------
// 진행
// ---------------------------------------------------------------------------

const bump = (arr: readonly number[], seat: Seat, by = 1) => arr.map((v, s) => (s === seat ? v + by : v));
const addAll = (a: readonly number[], b: readonly number[]) => a.map((v, s) => v + (b[s] ?? 0));

/** 문제 마감: 점수·탈락·응답 기록, 미사일은 조준으로. */
function resolveQuestion(state: GameState): GameState {
  const mini = currentMini(state);
  const n = state.seatCount;
  const eligible = eligibleSeats(state);
  const gained = zeros(n);
  const order = correctOrder(state);
  let stats = state.stats;
  for (const s of eligible) {
    if (state.answers[s]) stats = { ...stats, answered: bump(stats.answered, s) };
  }
  for (const s of order) stats = { ...stats, correct: bump(stats.correct, s) };
  const idle = state.idle.map((v, s) => (!eligible.includes(s) ? v : state.answers[s] ? 0 : v + 1));

  let alive = state.alive;
  let eliminated: Seat[] = [];
  let revived = false;
  let shooter: Seat | null = null;

  switch (mini) {
    case "ox": {
      for (const s of order) gained[s] = OX_CORRECT;
      const out = eligible.filter((s) => !state.answers[s]?.correct);
      if (out.length === eligible.length && eligible.length > 0) revived = true;
      else {
        eliminated = out;
        alive = alive.map((a, s) => a && !out.includes(s));
      }
      break;
    }
    case "chosung":
      order.forEach((s, rank) => (gained[s] = rankPoints(rank, CHOSUNG_POINTS, CHOSUNG_FLOOR)));
      if (order[0] !== undefined) stats = { ...stats, chosungFirst: bump(stats.chosungFirst, order[0]) };
      break;
    case "missile":
      order.slice(1).forEach((s) => (gained[s] = MISSILE_DEFEND));
      shooter = order[0] ?? null;
      break;
    default:
      order.forEach((s, rank) => (gained[s] = rankPoints(rank, CHOICE_POINTS, CHOICE_FLOOR)));
  }

  return {
    ...state,
    stage: state.stage + 1,
    phase: shooter !== null ? "aim" : "reveal",
    gained,
    miniScores: addAll(state.miniScores, gained),
    alive,
    eliminated,
    revived,
    shooter,
    shot: null,
    idle,
    stats,
  };
}

/** 자동 조준(§11): 하트 많은 사람 → 총점 높은 사람 → 좌석 번호. */
export function autoTarget(state: GameState, shooter: Seat): Seat | null {
  const targets = Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => s !== shooter && state.alive[s]);
  targets.sort((a, b) => state.hp[b] - state.hp[a] || state.scores[b] + state.miniScores[b] - (state.scores[a] + state.miniScores[a]) || a - b);
  return targets[0] ?? null;
}

function fire(state: GameState, target: Seat, auto: boolean): GameState {
  const from = state.shooter!;
  const hp = state.hp.map((h, s) => (s === target ? Math.max(0, h - 1) : h));
  const kill = hp[target] === 0;
  const alive = state.alive.map((a, s) => (s === target && kill ? false : a));
  const pts = MISSILE_HIT + (kill ? MISSILE_KILL : 0);
  const gained = state.gained.map((g, s) => (s === from ? g + pts : g));
  return {
    ...state,
    phase: "reveal",
    stage: state.stage + 1,
    hp,
    alive,
    gained,
    miniScores: state.miniScores.map((v, s) => (s === from ? v + pts : v)),
    shot: { from, to: target, kill, auto },
    eliminated: kill ? [target] : [],
    stats: { ...state.stats, hits: bump(state.stats.hits, from), kills: kill ? bump(state.stats.kills, from) : state.stats.kills },
  };
}

function miniOver(state: GameState): boolean {
  const mini = currentMini(state);
  if ((mini === "ox" || mini === "missile") && aliveCount(state) <= 1) return true;
  return state.qIndex + 1 >= state.questions.length;
}

/** 미니 게임 마감 보너스·기록(§4·§10·§11). */
function finishMini(state: GameState): GameState {
  const mini = currentMini(state);
  const n = state.seatCount;
  const bonus = zeros(n);
  let stats = state.stats;
  if (mini === "ox") {
    for (let s = 0; s < n; s++) {
      if (!state.alive[s]) continue;
      bonus[s] = OX_SURVIVE;
      stats = { ...stats, oxSurvived: bump(stats.oxSurvived, s) };
    }
  } else if (mini === "climb") {
    for (let s = 0; s < n; s++) bonus[s] = state.floor[s] * CLIMB_FLOOR_POINTS;
    state.finishOrder.forEach((s, rank) => {
      bonus[s] += rankPoints(rank, CLIMB_FINISH, CLIMB_FINISH_FLOOR);
      stats = { ...stats, climbFinish: bump(stats.climbFinish, s) };
    });
    if (state.finishOrder[0] !== undefined) stats = { ...stats, climbFirst: bump(stats.climbFirst, state.finishOrder[0]) };
  } else if (mini === "missile") {
    for (let s = 0; s < n; s++) if (state.alive[s]) bonus[s] = state.hp[s] * MISSILE_HP_POINTS;
    if (aliveCount(state) === 1) {
      const last = state.alive.indexOf(true);
      bonus[last] += LAST_SURVIVOR;
      stats = { ...stats, lastSurvivor: bump(stats.lastSurvivor, last) };
    }
  }
  const miniScores = addAll(state.miniScores, bonus);
  const top = Math.max(...miniScores);
  const winners = top > 0 ? miniScores.map((v, s) => (v === top ? s : -1)).filter((s) => s >= 0) : [];
  return {
    ...state,
    phase: "miniEnd",
    stage: state.stage + 1,
    miniScores,
    gained: bonus,
    scores: addAll(state.scores, miniScores),
    miniWins: state.miniWins.map((w, s) => w + (winners.includes(s) ? 1 : 0)),
    history: [...state.history, { mini, scores: miniScores, winners }],
    stats,
  };
}

function nextQuestion(state: GameState): GameState {
  if (miniOver(state)) return finishMini(state);
  return { ...state, phase: "question", stage: state.stage + 1, qIndex: state.qIndex + 1, answers: {}, arrivals: 0, shooter: null, shot: null, gained: zeros(state.seatCount), eliminated: [], revived: false };
}

function advanceMini(state: GameState): GameState {
  if (state.miniIndex + 1 >= state.plan.length) return { ...state, phase: "ended", stage: state.stage + 1 };
  return setupMini(state, state.miniIndex + 1);
}

function endClimb(state: GameState): GameState {
  // 한 문제도 안 푼 사람은 무응답 2문제로 친다(§12).
  const idle = state.idle.map((v, s) => (state.climbIdx[s] === 0 ? v + 2 : 0));
  let stats = state.stats;
  for (let s = 0; s < state.seatCount; s++) {
    stats = { ...stats, answered: bump(stats.answered, s, state.climbIdx[s]) };
  }
  return finishMini({ ...state, idle, stats });
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "ANSWER": {
      if (state.phase !== "question" || action.q !== state.qIndex) return state;
      const q = currentQuestion(state);
      if (!q || q.kind === "chosung") return state;
      if (!eligibleSeats(state).includes(action.seat)) return state;
      if (!Number.isInteger(action.choice) || action.choice < 0 || action.choice >= q.choices.length) return state;
      const prev = state.answers[action.seat];
      // OX는 시간이 끝날 때 서 있는 쪽이 답 — 그 전엔 몇 번이든 O ↔ X로 옮겨 다닐 수 있다(§4).
      if (prev && (q.kind !== "ox" || prev.choice === action.choice)) return state;
      const answer: Answer = { choice: action.choice, correct: action.choice === q.answer, order: prev?.order ?? state.arrivals };
      return { ...state, answers: { ...state.answers, [action.seat]: answer }, arrivals: prev ? state.arrivals : state.arrivals + 1 };
    }
    case "TYPE": {
      if (state.phase !== "question" || action.q !== state.qIndex) return state;
      const q = currentQuestion(state);
      if (!q || q.kind !== "chosung" || !eligibleSeats(state).includes(action.seat) || hasFinished(state, action.seat)) return state;
      const word = normalizeWord(action.text).slice(0, 12);
      if (!word) return state;
      const prev = state.answers[action.seat];
      if (prev?.wrongs?.includes(word)) return state;
      const correct = q.accepted?.includes(word) ?? false;
      const answer: Answer = correct
        ? { choice: null, correct: true, order: state.arrivals, text: word, wrongs: prev?.wrongs ?? [] }
        : { choice: null, correct: false, order: prev?.order ?? state.arrivals, wrongs: [...(prev?.wrongs ?? []), word] };
      return { ...state, answers: { ...state.answers, [action.seat]: answer }, arrivals: state.arrivals + 1 };
    }
    case "FIRE": {
      if (state.phase !== "aim" || action.seat !== state.shooter) return state;
      if (action.target === action.seat || action.target < 0 || action.target >= state.seatCount || !state.alive[action.target]) return state;
      return fire(state, action.target, false);
    }
    case "CLIMB": {
      if (state.phase !== "climb" || action.seat < 0 || action.seat >= state.seatCount) return state;
      const idx = state.climbIdx[action.seat];
      if (action.idx !== idx || state.floor[action.seat] >= CLIMB_TOP) return state;
      const q = state.questions[idx];
      if (!q || !Number.isInteger(action.choice) || action.choice < 0 || action.choice >= q.choices.length) return state;
      const ok = action.choice === q.answer;
      const floor = state.floor.map((f, s) => (s === action.seat ? (ok ? f + 1 : Math.max(0, f - 1)) : f));
      const finished = floor[action.seat] >= CLIMB_TOP;
      const next: GameState = {
        ...state,
        floor,
        climbIdx: bump(state.climbIdx, action.seat),
        lastClimb: state.lastClimb.map((v, s) => (s === action.seat ? ok : v)),
        finishOrder: finished ? [...state.finishOrder, action.seat] : state.finishOrder,
        stats: ok ? { ...state.stats, correct: bump(state.stats.correct, action.seat) } : state.stats,
      };
      return allAnswered(next) ? endClimb(next) : next;
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      switch (state.phase) {
        case "intro":
          return { ...state, phase: currentMini(state) === "climb" ? "climb" : "question", stage: state.stage + 1 };
        case "question":
          return resolveQuestion(state);
        case "aim": {
          const target = autoTarget(state, state.shooter!);
          return target === null ? { ...state, phase: "reveal", stage: state.stage + 1 } : fire(state, target, true);
        }
        case "reveal":
          return nextQuestion(state);
        case "climb":
          return endClimb(state);
        case "miniEnd":
          return advanceMini(state);
        default:
          return state;
      }
    }
    case "NEXT": {
      if (action.stage !== state.stage || state.phase !== "miniEnd") return state;
      return advanceMini(state);
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI 봇 (§13)
// ---------------------------------------------------------------------------

const lv = (level: BotLevel) => Math.max(1, Math.min(10, level));

/** 4지선다·OX 정답률. 난이도 1은 +12%p, 3은 −12%p. */
export function botAccuracy(level: BotLevel, d: Diff): number {
  const base = 0.35 + (0.57 * (lv(level) - 1)) / 9;
  return Math.max(0.05, Math.min(0.98, base + (2 - d) * 0.12));
}

/** 문제를 보고 답할 때까지(ms) — Lv.1 약 8.5초, Lv.10 약 2.2초, ±35%. */
export function botDelayMs(level: BotLevel, mini: MiniId, rng: () => number = Math.random): number {
  const base = 8500 - ((lv(level) - 1) * 6300) / 9;
  const scale = mini === "chosung" ? 1.8 : mini === "ox" ? 0.7 : 1;
  return Math.round(base * scale * (0.65 + rng() * 0.7));
}

/** 올라올라 한 문제(ms) — Lv.1 약 3초, Lv.10 약 1.1초. */
export function botClimbDelayMs(level: BotLevel, rng: () => number = Math.random): number {
  const base = 3000 - ((lv(level) - 1) * 1900) / 9;
  return Math.round(base * (0.7 + rng() * 0.6));
}

export function botClimbAccuracy(level: BotLevel): number {
  return 0.6 + (0.37 * (lv(level) - 1)) / 9;
}

/** 초성 퀴즈에서 봇이 "아는" 확률. */
export function botChosungKnow(level: BotLevel, d: Diff): number {
  return Math.max(0.05, Math.min(0.95, 0.15 + (0.7 * (lv(level) - 1)) / 9 + (2 - d) * 0.08));
}

/** 봇의 이번 문제 답(보기 번호). */
export function chooseBotChoice(state: GameState, level: BotLevel, rng: () => number = Math.random): number | null {
  const q = currentQuestion(state);
  if (!q || q.kind === "chosung") return null;
  if (rng() < botAccuracy(level, q.d)) return q.answer;
  const wrong = q.choices.map((_, i) => i).filter((i) => i !== q.answer);
  return pickFrom(rng, wrong);
}

/** 봇의 초성 입력. 모르면 다른 주제의 같은 길이 단어로 틀리게 찍거나(낮은 레벨) 포기(null). */
export function chooseBotTyping(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): string | null {
  const q = currentQuestion(state);
  if (!q || q.kind !== "chosung" || hasFinished(state, seat)) return null;
  const tries = state.answers[seat]?.wrongs?.length ?? 0;
  // 문제·좌석마다 "아는지"를 고정 — 다시 시도해도 같은 결론.
  const knows = (hashString(`${state.seed}:${state.miniIndex}:${state.qIndex}:${seat}`) % 10_000) / 10_000 < botChosungKnow(level, q.d);
  if (knows) return pickFrom(rng, q.accepted ?? [q.word!]);
  if (tries >= 1 || rng() > 0.6) return null;
  const sameLen = CHOSUNG_POOL.filter((p) => p.word.length === q.word!.length && !q.accepted?.includes(p.word));
  return sameLen.length > 0 ? pickFrom(rng, sameLen).word : null;
}

/**
 * 봇의 OX 이동 계획 — 마지막 칸이 최종 답(정답률은 `chooseBotChoice` 그대로). 사람처럼
 * 가끔 반대쪽에 먼저 갔다가 넘어오거나, 갔다가 되돌아온다.
 */
export function chooseBotOxPlan(state: GameState, level: BotLevel, rng: () => number = Math.random): number[] {
  const final = chooseBotChoice(state, level, rng);
  if (final === null) return [];
  const other = 1 - final;
  const r = rng();
  if (r < 0.3) return [other, final];
  if (r < 0.42) return [final, other, final];
  return [final];
}

/** 봇의 올라올라 답(보기 번호). */
export function chooseBotClimb(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): { idx: number; choice: number } | null {
  if (state.phase !== "climb" || state.floor[seat] >= CLIMB_TOP) return null;
  const idx = state.climbIdx[seat];
  const q = state.questions[idx];
  if (!q) return null;
  if (rng() < botClimbAccuracy(level)) return { idx, choice: q.answer };
  return { idx, choice: pickFrom(rng, q.choices.map((_, i) => i).filter((i) => i !== q.answer)) };
}

/** 봇 조준(§13): 격추 가능(하트 1) → 총점 1등 → 하트 많은 사람. */
export function chooseBotTarget(state: GameState, shooter: Seat): Seat | null {
  const total = (s: Seat) => state.scores[s] + state.miniScores[s];
  const targets = Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => s !== shooter && state.alive[s]);
  targets.sort((a, b) => Number(state.hp[b] === 1) - Number(state.hp[a] === 1) || total(b) - total(a) || state.hp[b] - state.hp[a] || a - b);
  return targets[0] ?? null;
}

/** 초성 퀴즈 출제 후보 수 — 테스트·룰북 표시용. */
export const CHOSUNG_POOL_SIZE = CHOSUNG_POOL.length;
