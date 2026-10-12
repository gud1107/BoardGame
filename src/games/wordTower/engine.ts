import { seededRng, shuffle } from "@/lib/rng";
import { filterProfanity } from "@/lib/chat/profanity";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { TOPICS, TOPIC_BY_ID, topicDictionary, topicWordList, type Topic } from "./words";

/**
 * 단어 마천루 엔진 (boardGameRule/단어마천루/단어마천루.md).
 *
 * 락스텝: 방장이 보낸 시드로 모든 기기가 같은 주제 순서를 만들고, 이후 액션만 주고받는다.
 * 단어 판정(사전·금칙어·글자 수)은 모두 결정적이라 어느 기기에서 돌려도 결과가 같다.
 * 시간은 엔진 밖에서 잰다 — 방장이 `TIMEOUT { stage }`를 보내고, 엔진은 옛 stage를 무시한다.
 */

export type Seat = number;
export type Phase = "intro" | "build" | "review" | "result" | "ended";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_WORD_LEN = 8;
export const MAX_WORDS_PER_ROUND = 30;
export const MAX_PENDING_PER_ROUND = 6;
export const MAX_BLOCKS_PER_WORD = 4;
export const ROUND_OPTIONS = [3, 5, 7] as const;
export const BUILD_SECONDS_OPTIONS = [45, 60, 90] as const;

export interface GameOptions {
  readonly rounds: number;
  readonly buildSeconds: number;
}

export const DEFAULT_OPTIONS: GameOptions = { rounds: 5, buildSeconds: 60 };

/** 단계별 제한 시간(ms). 쌓기는 방장 설정, 끝난 판은 0(타이머 없음). */
export function phaseDurationMs(state: Pick<GameState, "phase" | "options">): number {
  switch (state.phase) {
    case "intro":
      return 3500;
    case "build":
      return state.options.buildSeconds * 1000;
    case "review":
      return 25_000;
    case "result":
      return 9000;
    default:
      return 0;
  }
}

/** ok = 사전 단어(확정), pending = 심사 대기, approved/rejected = 심사 결과. */
export type EntryStatus = "ok" | "pending" | "approved" | "rejected";

export interface Entry {
  readonly id: number;
  readonly seat: Seat;
  readonly word: string;
  readonly blocks: number;
  readonly status: EntryStatus;
}

export interface RoundRecord {
  readonly topicId: string;
  readonly heights: readonly number[];
  readonly rejected: readonly number[];
  readonly accepted: readonly number[];
  readonly winners: readonly Seat[];
  readonly entries: readonly Entry[];
}

export interface GameState {
  readonly seatCount: number;
  readonly options: GameOptions;
  readonly topics: readonly string[];
  /** 0부터. 화면 표시는 +1. */
  readonly roundIndex: number;
  readonly phase: Phase;
  /** 단계 식별자 — TIMEOUT/NEXT의 중복·지연 도착을 걸러낸다. */
  readonly stage: number;
  /** 이번 라운드에 낸 단어(제출 순서). */
  readonly entries: readonly Entry[];
  readonly nextId: number;
  /** 좌석별로 이번 판에 이미 쓴 단어 — 다시 못 쓴다. */
  readonly used: readonly (readonly string[])[];
  /** 보류 단어 id → 좌석 → 인정(true)/거절(false). */
  readonly votes: Readonly<Record<number, Readonly<Record<Seat, boolean>>>>;
  readonly history: readonly RoundRecord[];
  readonly wins: readonly number[];
  readonly totals: readonly number[];
  readonly streak: readonly number[];
  readonly bestStreak: readonly number[];
  /** 좌석별 "단어를 하나도 못 낸 라운드" 연속 횟수 — 무응답 봇 대체 투표 트리거용. */
  readonly idleStreak: readonly number[];
}

export type EngineAction =
  | { type: "SUBMIT"; seat: Seat; text: string }
  | { type: "VOTE"; seat: Seat; id: number; approve: boolean }
  | { type: "TIMEOUT"; stage: number }
  | { type: "NEXT"; stage: number };

// ---------------------------------------------------------------------------
// 단어 판정
// ---------------------------------------------------------------------------

/** 공백·문장부호·기호를 지운다("아이스 크림" = "아이스크림"). */
export function normalizeWord(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}

export function blocksFor(word: string): number {
  return Math.min(MAX_BLOCKS_PER_WORD, word.length);
}

export function currentTopic(state: GameState): Topic {
  return TOPIC_BY_ID.get(state.topics[state.roundIndex]) ?? TOPICS[0];
}

export type WordCheck = { ok: true; word: string; inDict: boolean; blocks: number } | { ok: false; reason: string };

export function checkWord(state: GameState, seat: Seat, text: string): WordCheck {
  if (state.phase !== "build") return { ok: false, reason: "지금은 쌓을 수 없어요" };
  if (seat < 0 || seat >= state.seatCount) return { ok: false, reason: "자리가 없어요" };
  const word = normalizeWord(text);
  if (!word) return { ok: false, reason: "단어를 입력하세요" };
  if (!/^[가-힣]+$/.test(word)) return { ok: false, reason: "한글 단어만 쓸 수 있어요 (자음·모음만 쓰거나 영어·숫자는 안 돼요)" };
  if (word.length > MAX_WORD_LEN) return { ok: false, reason: `${MAX_WORD_LEN}글자까지만 쓸 수 있어요` };
  if (state.used[seat]?.includes(word)) return { ok: false, reason: `"${word}"은(는) 이미 쓴 단어예요` };
  if (filterProfanity(word).flagged) return { ok: false, reason: "쓸 수 없는 단어예요" };
  const mine = state.entries.filter((e) => e.seat === seat);
  if (mine.length >= MAX_WORDS_PER_ROUND) return { ok: false, reason: `한 라운드에 ${MAX_WORDS_PER_ROUND}개까지 쌓을 수 있어요` };
  const inDict = topicDictionary(state.topics[state.roundIndex]).has(word);
  if (!inDict && mine.filter((e) => e.status === "pending").length >= MAX_PENDING_PER_ROUND) {
    return { ok: false, reason: `사전에 없는 단어는 라운드당 ${MAX_PENDING_PER_ROUND}개까지만 심사받을 수 있어요` };
  }
  return { ok: true, word, inDict, blocks: blocksFor(word) };
}

// ---------------------------------------------------------------------------
// 높이·순위
// ---------------------------------------------------------------------------

/** 탑 높이. `withPending`이면 심사 대기 층도 센다(쌓기 중 표시용). */
export function towerHeight(entries: readonly Entry[], seat: Seat, withPending = false): number {
  let h = 0;
  for (const e of entries) {
    if (e.seat !== seat) continue;
    if (e.status === "ok" || e.status === "approved" || (withPending && e.status === "pending")) h += e.blocks;
    else if (e.status === "rejected") h -= 1;
  }
  return Math.max(0, h);
}

interface RoundLine {
  seat: Seat;
  height: number;
  rejected: number;
  accepted: number;
}

function roundLines(entries: readonly Entry[], seatCount: number, withPending: boolean): RoundLine[] {
  return Array.from({ length: seatCount }, (_, seat) => ({
    seat,
    height: towerHeight(entries, seat, withPending),
    rejected: entries.filter((e) => e.seat === seat && e.status === "rejected").length,
    accepted: entries.filter((e) => e.seat === seat && (e.status === "ok" || e.status === "approved" || (withPending && e.status === "pending"))).length,
  }));
}

/** §8 라운드 순위 비교: 높이 → 거절 적음 → 단어 많음. 0이면 동점. */
function compareLines(a: RoundLine, b: RoundLine): number {
  return b.height - a.height || a.rejected - b.rejected || b.accepted - a.accepted;
}

function leadersOf(lines: RoundLine[]): Seat[] {
  const sorted = [...lines].sort(compareLines);
  const top = sorted[0];
  if (!top || top.height <= 0) return [];
  return sorted.filter((l) => compareLines(l, top) === 0).map((l) => l.seat);
}

/** 지금 1등(왕관) — 쌓기 중엔 보류 층 포함. */
export function currentLeaders(state: GameState): Seat[] {
  return leadersOf(roundLines(state.entries, state.seatCount, state.phase === "build" || state.phase === "review"));
}

/** 라운드 순위(1부터, 공동 순위 허용) — 결과 화면용. */
export function roundRanking(entries: readonly Entry[], seatCount: number): (RoundLine & { rank: number })[] {
  const sorted = roundLines(entries, seatCount, false).sort(compareLines);
  return sorted.map((l) => ({ ...l, rank: sorted.findIndex((o) => compareLines(o, l) === 0) + 1 }));
}

export function computeRankings(state: GameState): { seat: Seat; rank: number; wins: number; total: number }[] {
  const rows = Array.from({ length: state.seatCount }, (_, seat) => ({ seat, wins: state.wins[seat] ?? 0, total: state.totals[seat] ?? 0 }));
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.wins - a.wins || b.total - a.total;
  const sorted = [...rows].sort(cmp);
  return sorted.map((r) => ({ ...r, rank: sorted.findIndex((o) => cmp(o, r) === 0) + 1 }));
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state)
    .filter((r) => r.rank === 1)
    .map((r) => r.seat);
}

export function isLastRound(state: GameState): boolean {
  return state.roundIndex >= state.topics.length - 1;
}

// ---------------------------------------------------------------------------
// 심사
// ---------------------------------------------------------------------------

export function pendingEntries(state: GameState): Entry[] {
  return state.entries.filter((e) => e.status === "pending");
}

/** `voters`(투표할 사람 좌석들) 모두가 자기 것이 아닌 모든 보류 단어에 투표했는지 — 심사 조기 종료용. */
export function reviewComplete(state: GameState, voters: readonly Seat[]): boolean {
  if (state.phase !== "review") return false;
  return pendingEntries(state).every((e) => voters.every((v) => v === e.seat || state.votes[e.id]?.[v] !== undefined));
}

export function voteTally(state: GameState, id: number): { yes: number; no: number } {
  const v = Object.values(state.votes[id] ?? {});
  return { yes: v.filter(Boolean).length, no: v.filter((x) => !x).length };
}

// ---------------------------------------------------------------------------
// 리듀서
// ---------------------------------------------------------------------------

function clampOptions(options: Partial<GameOptions> | undefined): GameOptions {
  const rounds = Math.max(1, Math.min(TOPICS.length, Math.round(options?.rounds ?? DEFAULT_OPTIONS.rounds)));
  const buildSeconds = Math.max(15, Math.min(180, Math.round(options?.buildSeconds ?? DEFAULT_OPTIONS.buildSeconds)));
  return { rounds, buildSeconds };
}

export function startGame(seatCount: number, seed: number, options?: Partial<GameOptions>): GameState {
  const opts = clampOptions(options);
  const topics = shuffle(
    TOPICS.map((t) => t.id),
    seededRng(seed),
  ).slice(0, opts.rounds);
  const zeros = Array.from({ length: seatCount }, () => 0);
  return {
    seatCount,
    options: opts,
    topics,
    roundIndex: 0,
    phase: "intro",
    stage: 0,
    entries: [],
    nextId: 1,
    used: Array.from({ length: seatCount }, () => []),
    votes: {},
    history: [],
    wins: zeros,
    totals: zeros,
    streak: zeros,
    bestStreak: zeros,
    idleStreak: zeros,
  };
}

function finishRound(state: GameState): GameState {
  const lines = roundLines(state.entries, state.seatCount, false);
  const winners = leadersOf(lines);
  const streak = state.streak.map((s, seat) => (winners.includes(seat) ? s + 1 : 0));
  const record: RoundRecord = {
    topicId: state.topics[state.roundIndex],
    heights: lines.map((l) => l.height),
    rejected: lines.map((l) => l.rejected),
    accepted: lines.map((l) => l.accepted),
    winners,
    entries: state.entries,
  };
  return {
    ...state,
    phase: "result",
    stage: state.stage + 1,
    history: [...state.history, record],
    wins: state.wins.map((w, seat) => w + (winners.includes(seat) ? 1 : 0)),
    totals: state.totals.map((t, seat) => t + lines[seat].height),
    streak,
    bestStreak: state.bestStreak.map((b, seat) => Math.max(b, streak[seat])),
  };
}

function endBuild(state: GameState): GameState {
  const idleStreak = state.idleStreak.map((v, seat) => (state.entries.some((e) => e.seat === seat) ? 0 : v + 1));
  const next = { ...state, idleStreak };
  if (pendingEntries(next).length > 0) return { ...next, phase: "review", stage: state.stage + 1 };
  return finishRound(next);
}

function resolveReview(state: GameState): GameState {
  const entries = state.entries.map((e) => {
    if (e.status !== "pending") return e;
    const { yes, no } = voteTally(state, e.id);
    return { ...e, status: yes > no ? ("approved" as const) : ("rejected" as const) };
  });
  return finishRound({ ...state, entries });
}

function advanceRound(state: GameState): GameState {
  if (isLastRound(state)) return { ...state, phase: "ended", stage: state.stage + 1 };
  return { ...state, phase: "intro", stage: state.stage + 1, roundIndex: state.roundIndex + 1, entries: [], votes: {} };
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "SUBMIT": {
      const check = checkWord(state, action.seat, action.text);
      if (!check.ok) return state;
      const entry: Entry = { id: state.nextId, seat: action.seat, word: check.word, blocks: check.blocks, status: check.inDict ? "ok" : "pending" };
      return {
        ...state,
        entries: [...state.entries, entry],
        nextId: state.nextId + 1,
        used: state.used.map((u, seat) => (seat === action.seat ? [...u, check.word] : u)),
      };
    }
    case "VOTE": {
      if (state.phase !== "review") return state;
      if (action.seat < 0 || action.seat >= state.seatCount) return state;
      const entry = state.entries.find((e) => e.id === action.id);
      if (!entry || entry.status !== "pending" || entry.seat === action.seat) return state;
      return { ...state, votes: { ...state.votes, [action.id]: { ...(state.votes[action.id] ?? {}), [action.seat]: action.approve } } };
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      switch (state.phase) {
        case "intro":
          return { ...state, phase: "build", stage: state.stage + 1 };
        case "build":
          return endBuild(state);
        case "review":
          return resolveReview(state);
        case "result":
          return advanceRound(state);
        default:
          return state;
      }
    }
    case "NEXT": {
      if (action.stage !== state.stage || state.phase !== "result") return state;
      return advanceRound(state);
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI 봇 (§11)
// ---------------------------------------------------------------------------

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** 이 레벨 봇이 그 주제 사전에서 "아는" 비율. */
export function botVocabulary(level: BotLevel): number {
  return 0.4 + (0.6 * (Math.max(1, Math.min(10, level)) - 1)) / 9;
}

/** 다음 단어까지 걸리는 시간(ms) — Lv.1 약 8초, Lv.10 약 2.3초, ±40% 흔들림. */
export function botDelayMs(level: BotLevel, rng: () => number = Math.random): number {
  const l = Math.max(1, Math.min(10, level));
  const base = 8000 - ((l - 1) * 5700) / 9;
  return Math.round(base * (0.6 + rng() * 0.8));
}

/** 봇이 낼 단어. 낼 게 없으면 null. */
export function chooseBotWord(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): string | null {
  if (state.phase !== "build") return null;
  const l = Math.max(1, Math.min(10, level));
  const topicId = state.topics[state.roundIndex];
  const used = new Set(state.used[seat] ?? []);
  const mine = state.entries.filter((e) => e.seat === seat);
  if (mine.length >= MAX_WORDS_PER_ROUND) return null;

  // 낮은 레벨은 가끔 다른 주제 단어를 잘못 낸다 → 보류 단어가 되어 사람의 심사를 받는다.
  const mistakeRate = (0.1 * (10 - l)) / 9;
  const pendingCount = mine.filter((e) => e.status === "pending").length;
  if (pendingCount < 2 && rng() < mistakeRate) {
    const dict = topicDictionary(topicId);
    const others = TOPICS.filter((t) => t.id !== topicId);
    const pool = others[Math.floor(rng() * others.length)].words.filter((x) => !dict.has(x) && !used.has(x));
    if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
  }

  const know = botVocabulary(l);
  const candidates = topicWordList(topicId).filter((x) => !used.has(x) && hash01(`${seat}:${topicId}:${x}`) < know);
  if (candidates.length === 0) return null;
  // 높은 레벨일수록 층이 많이 오르는 긴 단어를 고른다.
  const pref = ((l - 1) / 9) * 1.6;
  const weights = candidates.map((x) => Math.pow(blocksFor(x), pref));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
