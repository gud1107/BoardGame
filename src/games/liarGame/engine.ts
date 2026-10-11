/**
 * 라이어를 찾아라 — 순수 규칙 엔진.
 *
 * 룰 원전: boardGameRule/라이어게임/라이어게임.md. 이 파일 주석의 §번호는 그 룰북 기준.
 *
 * ARCHITECTURE.md §1 계약: React/네트워크/`Date.now()`/`Math.random()` 직접 호출 없음.
 * 모든 라운드의 카테고리·제시어·라이어·선 플레이어·객관식 보기는 `startGame`이
 * 시드 하나로 미리 계산해 `plan`에 넣는다 — 락스텝이라 모든 기기가 같은 판을 재현한다.
 *
 * 시간 제한은 엔진 밖(LiarGameGame.tsx)에서 잰다. 방장 기기만 `TIMEOUT { stage }`를
 * 보내고, `stage`는 단계가 바뀔 때(설명 한 개가 끝날 때 포함)마다 1씩 오른다 —
 * 늦게 도착한 옛 단계의 TIMEOUT은 모든 기기에서 똑같이 무시된다.
 *
 * 신뢰 모델(docs/architecture.md §2): 락스텝이라 제시어·라이어도 모든 기기의 상태에
 * 들어 있다. UI가 가릴 뿐 개발자 도구로는 볼 수 있다 — 친구끼리 하는 파티게임이라
 * 감수한다(룰북 §18.2 방식 C). 봇은 자기 좌석이 실제로 아는 정보만 쓴다(§7.1).
 *
 * 앱에서 룰북과 다르게(또는 좁혀서) 구현한 부분:
 *  - 설명 금칙어는 반칙 처리 대신 입력 거부(§18.5) — 제시어 포함 / 초성 / 같은 라운드 중복.
 *    "구성 단어"(김치찌개의 김치)는 자동 판별하지 않는다.
 *  - 동점은 기본 규칙(§8.3): 동점자 제외 재투표 1회, 또 동점이면 라이어 승리.
 *  - 점수는 §11.1 기본 점수 + "라이어에게 투표한 시민 +1" 보너스(1차 투표 기준). 감점 없음.
 *  - 바보 모드(§14.1)와 객관식/주관식 정답 맞히기(§14.6)를 방장 옵션으로 지원.
 */

import { seededRng, shuffle } from "@/lib/rng";
import { pickByLevel, type BotLevel, type ScoredCandidate } from "../shared/bot/botDifficulty";
import { CATEGORIES, GENERIC_HINTS, RANDOM_CATEGORY, getCategory, type Category } from "./words";
import { CATEGORY_BROAD, VAGUE_KEYS, WORD_KEYS } from "./lexicon";

export type Seat = number;
export type Mode = "classic" | "fool";
export type GuessMode = "choice" | "text";
export type Phase = "describe" | "discuss" | "vote" | "guess" | "roundEnd" | "ended";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const MAX_DESCRIPTION_LEN = 40;
export const MAX_CHAT_LEN = 80;
export const MAX_GUESS_LEN = 20;
export const CHOICE_COUNT = 6;
const MAX_CHAT_LOG = 200;

export interface GameOptions {
  readonly rounds: number;
  readonly laps: 1 | 2;
  readonly mode: Mode;
  readonly guessMode: GuessMode;
  /** `words.ts`의 카테고리 id 또는 "random". */
  readonly category: string;
}

/**
 * 두 가지 버전(2026-10-11 요청으로 방 만들기 첫 선택으로 분리). 엔진 값은 그대로 `mode`.
 * - classic "아는 라이어": 라이어는 자기가 라이어인 걸 알고, 카테고리만 받는다.
 * - fool "모르는 라이어"(룰북 §14.1 바보 모드): 라이어도 비슷한 가짜 제시어를 받아 자기가 라이어인 줄 모른다.
 */
export const MODE_INFO: Record<Mode, { emoji: string; name: string; short: string; desc: string }> = {
  classic: {
    emoji: "🎭",
    name: "아는 라이어",
    short: "라이어가 알고 시작",
    desc: "라이어는 자기가 라이어인 걸 알고 시작해요. 제시어 없이 카테고리만 듣고, 정체를 숨기며 제시어를 추리하세요.",
  },
  fool: {
    emoji: "🤪",
    name: "모르는 라이어",
    short: "라이어도 모르고 시작",
    desc: "라이어도 비슷한 가짜 제시어를 받아서 자기가 라이어인 줄 몰라요. 모두가 시민인 척… 아니, 진짜 시민이라고 믿고 시작해요!",
  },
};

export const DEFAULT_OPTIONS: GameOptions = { rounds: 5, laps: 1, mode: "classic", guessMode: "choice", category: RANDOM_CATEGORY };

export interface RoundPlan {
  readonly categoryId: string;
  readonly category: string;
  readonly word: string;
  /** 바보 모드에서 라이어가 받는 가짜 제시어. 일반 모드는 null. */
  readonly fakeWord: string | null;
  readonly liarSeat: Seat;
  readonly firstSeat: Seat;
  /** 객관식 정답 맞히기 보기(정답 포함, 섞인 순서). */
  readonly options: readonly string[];
}

export interface Description {
  readonly seat: Seat;
  readonly lap: number;
  readonly text: string;
  /** 시간 초과로 자동 패스된 설명. */
  readonly auto: boolean;
}

export interface ChatMessage {
  readonly seat: Seat;
  readonly round: number;
  /** `{m}`은 `mention` 좌석 이름으로 바꿔 보여준다(봇 발언용). */
  readonly text: string;
  readonly mention?: Seat;
}

export type RoundReason = "wrongAccuse" | "tie" | "guessed" | "missed";

export interface RoundOutcome {
  readonly round: number;
  readonly winner: "liar" | "citizens";
  readonly reason: RoundReason;
  readonly liarSeat: Seat;
  readonly accused: Seat | null;
  readonly category: string;
  readonly word: string;
  readonly fakeWord: string | null;
  readonly guess: string | null;
  /** 1차 투표(동점 재투표 전) — 좌석별 지목 대상, null은 무효표. */
  readonly firstVotes: Readonly<Record<Seat, Seat | null>>;
  /** 결정 투표(재투표가 있었으면 재투표) 집계. */
  readonly tally: Readonly<Record<Seat, number>>;
  readonly points: readonly number[];
}

export interface GameState {
  readonly seatCount: number;
  readonly options: GameOptions;
  readonly plan: readonly RoundPlan[];
  /** 0부터. 화면 표시는 +1. */
  readonly roundIndex: number;
  readonly phase: Phase;
  /** 단계 식별자 — TIMEOUT/NEXT의 중복·지연 도착을 걸러낸다. */
  readonly stage: number;
  readonly descriptions: readonly Description[];
  readonly readySeats: readonly Seat[];
  /** 1 = 1차 투표, 2 = 동점 재투표. */
  readonly voteRound: 1 | 2;
  /** 지목할 수 있는 좌석(1차는 전원, 재투표는 동점자). */
  readonly candidates: readonly Seat[];
  /** 투표권이 있는 좌석(1차는 전원, 재투표는 동점자를 뺀 나머지). */
  readonly voters: readonly Seat[];
  readonly votes: Readonly<Record<Seat, Seat | null>>;
  readonly firstVotes: Readonly<Record<Seat, Seat | null>>;
  readonly accused: Seat | null;
  readonly outcome: RoundOutcome | null;
  readonly history: readonly RoundOutcome[];
  readonly scores: readonly number[];
  readonly chat: readonly ChatMessage[];
  /** 좌석별 연속 시간 초과 횟수 — 무응답 봇 대체 투표 트리거용. */
  readonly idleStreak: readonly number[];
}

export type EngineAction =
  | { type: "DESCRIBE"; seat: Seat; text: string }
  | { type: "CHAT"; seat: Seat; text: string; mention?: Seat }
  | { type: "READY"; seat: Seat }
  | { type: "VOTE"; seat: Seat; target: Seat }
  | { type: "GUESS"; seat: Seat; text: string }
  | { type: "TIMEOUT"; stage: number }
  | { type: "NEXT"; stage: number };

// ---------------------------------------------------------------------------
// 텍스트 판정
// ---------------------------------------------------------------------------

/** 공백·문장부호 제거 + 소문자. 정답 비교와 금칙어 검사의 공통 기준. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,!?~'"`·…\-_()[\]{}:;]/g, "");
}

const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

export function chosungOf(word: string): string {
  let out = "";
  for (const ch of word) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) out += CHOSUNG[Math.floor(code / 588)];
    else out += ch;
  }
  return out;
}

/** 이 좌석이 "자기 제시어"라고 알고 있는 단어. 라이어(일반 모드)는 null. */
export function knownWordFor(state: GameState, seat: Seat): string | null {
  const plan = currentPlan(state);
  if (seat !== plan.liarSeat) return plan.word;
  return plan.fakeWord;
}

/**
 * 설명/채팅 금칙어 검사(§6.2, §18.5). 통과하면 null, 아니면 이유 문구.
 * 엔진과 UI가 같은 함수를 쓴다 — UI가 미리 막고, 엔진은 혹시 들어온 것을 무시한다.
 */
export function rejectReason(state: GameState, seat: Seat, text: string, kind: "describe" | "chat"): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "내용을 입력하세요.";
  const max = kind === "describe" ? MAX_DESCRIPTION_LEN : MAX_CHAT_LEN;
  if (trimmed.length > max) return `${max}자 이내로 입력하세요.`;
  const norm = normalize(trimmed);
  const known = state.phase === "roundEnd" || state.phase === "ended" ? null : knownWordFor(state, seat);
  if (known) {
    const target = normalize(known);
    if (norm.includes(target)) return "제시어를 직접 말하면 안 돼요!";
    const cho = chosungOf(target);
    if (/^[ㄱ-ㅎ]+$/.test(norm) && norm.includes(cho)) return "초성 힌트는 금지예요!";
  }
  if (kind === "describe") {
    if (visibleDescriptions(state, seat).some((d) => !d.auto && normalize(d.text) === norm)) return "이미 나온 설명이에요. 다르게 말해보세요.";
  }
  return null;
}

/** §9.3 정답 인정 — 띄어쓰기·대소문자·문장부호 차이만 허용. */
export function isCorrectGuess(word: string, guess: string): boolean {
  return normalize(word) === normalize(guess) && normalize(guess).length > 0;
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

function clampOptions(options: Partial<GameOptions> | undefined, seatCount: number): GameOptions {
  const o = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
  const rounds = Math.max(1, Math.min(20, Math.floor(o.rounds || seatCount)));
  return {
    rounds,
    laps: o.laps === 2 ? 2 : 1,
    mode: o.mode === "fool" ? "fool" : "classic",
    guessMode: o.guessMode === "text" ? "text" : "choice",
    category: o.category === RANDOM_CATEGORY || getCategory(o.category) ? o.category : RANDOM_CATEGORY,
  };
}

function buildPlan(seatCount: number, seed: number, options: GameOptions): RoundPlan[] {
  const rng = seededRng(seed);
  // 라이어는 좌석을 섞은 순서대로 돌아가며 맡는다 — 한 사람에게 몰리지 않게(§11.2 "모두가 선을 한 번씩").
  let liarQueue: Seat[] = [];
  const used = new Set<string>();
  const plan: RoundPlan[] = [];
  for (let r = 0; r < options.rounds; r++) {
    if (liarQueue.length === 0) liarQueue = shuffle(Array.from({ length: seatCount }, (_, i) => i), rng);
    const liarSeat = liarQueue.shift()!;
    const category: Category =
      options.category === RANDOM_CATEGORY ? CATEGORIES[Math.floor(rng() * CATEGORIES.length)] : getCategory(options.category)!;
    let pool = category.words.filter((w) => !used.has(`${category.id}:${w.word}`));
    if (pool.length === 0) pool = [...category.words];
    const entry = pool[Math.floor(rng() * pool.length)];
    used.add(`${category.id}:${entry.word}`);
    let fakeWord: string | null = null;
    if (options.mode === "fool") {
      const paired = entry.pair && category.words.some((w) => w.word === entry.pair) ? entry.pair : null;
      const others = category.words.filter((w) => w.word !== entry.word);
      fakeWord = paired ?? others[Math.floor(rng() * others.length)].word;
    }
    const decoys = shuffle(
      category.words.map((w) => w.word).filter((w) => w !== entry.word && w !== fakeWord),
      rng,
    ).slice(0, CHOICE_COUNT - 1);
    const options6 = shuffle([entry.word, ...decoys], rng);
    // 선 플레이어(§4.5): 무작위로 시작하되 라이어가 늘 선이 되지는 않도록 그대로 무작위.
    const firstSeat = Math.floor(rng() * seatCount);
    plan.push({ categoryId: category.id, category: category.name, word: entry.word, fakeWord, liarSeat, firstSeat, options: options6 });
  }
  return plan;
}

export function startGame(seatCount: number, seed: number, options?: Partial<GameOptions>): GameState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(seatCount)));
  const opts = clampOptions(options, count);
  return {
    seatCount: count,
    options: opts,
    plan: buildPlan(count, seed, opts),
    roundIndex: 0,
    phase: "describe",
    stage: 1,
    descriptions: [],
    readySeats: [],
    voteRound: 1,
    candidates: [],
    voters: [],
    votes: {},
    firstVotes: {},
    accused: null,
    outcome: null,
    history: [],
    scores: Array(count).fill(0),
    chat: [],
    idleStreak: Array(count).fill(0),
  };
}

// ---------------------------------------------------------------------------
// 파생 조회
// ---------------------------------------------------------------------------

export function currentPlan(state: GameState): RoundPlan {
  return state.plan[Math.min(state.roundIndex, state.plan.length - 1)];
}

export function seatsInOrder(state: GameState): Seat[] {
  const first = currentPlan(state).firstSeat;
  return Array.from({ length: state.seatCount }, (_, i) => (first + i) % state.seatCount);
}

export function totalDescriptions(state: GameState): number {
  return state.seatCount * state.options.laps;
}

export function currentLap(state: GameState): number {
  return Math.floor(state.descriptions.length / state.seatCount) + 1;
}

/**
 * 설명은 바퀴마다 모두 동시에 비공개로 쓴다 — 이번 바퀴에 아직 안 쓴 좌석들.
 * (차례대로 말하면 뒷사람이 앞사람 설명을 보고 따라 쓸 수 있어서 바꿨다, 2026-10-11 요청.)
 */
export function describePending(state: GameState): Seat[] {
  if (state.phase !== "describe") return [];
  const lap = currentLap(state);
  const done = new Set(state.descriptions.filter((d) => d.lap === lap).map((d) => d.seat));
  return seatsInOrder(state).filter((s) => !done.has(s));
}

/** 이번 바퀴에서 아직 안 쓴 첫 좌석(테스트·하위 호환용). 실제로는 대기 좌석 누구나 먼저 낼 수 있다. */
export function currentDescriber(state: GameState): Seat | null {
  return describePending(state)[0] ?? null;
}

/** `viewer`에게 보이는 설명 — 설명 단계에선 이번 바퀴 남의 설명이 모두 제출될 때까지 가려진다. */
export function visibleDescriptions(state: GameState, viewer: Seat): readonly Description[] {
  if (state.phase !== "describe") return state.descriptions;
  const lap = currentLap(state);
  return state.descriptions.filter((d) => d.lap < lap || d.seat === viewer);
}

/** 지금 결정을 기다리는 모든 좌석(동시 행동 단계 포함). 봇 스케줄러와 무응답 판정이 쓴다. */
export function pendingSeats(state: GameState): Seat[] {
  switch (state.phase) {
    case "describe":
      return describePending(state);
    case "discuss":
      return Array.from({ length: state.seatCount }, (_, i) => i).filter((s) => !state.readySeats.includes(s));
    case "vote":
      return state.voters.filter((s) => !(s in state.votes));
    case "guess":
      return [currentPlan(state).liarSeat];
    default:
      return [];
  }
}

export function isLastRound(state: GameState): boolean {
  return state.roundIndex >= state.plan.length - 1;
}

// ---------------------------------------------------------------------------
// 리듀서
// ---------------------------------------------------------------------------

function bumpIdle(state: GameState, seats: readonly Seat[], reset: readonly Seat[]): readonly number[] {
  return state.idleStreak.map((v, s) => (seats.includes(s) ? v + 1 : reset.includes(s) ? 0 : v));
}

/** 바퀴가 다 채워질 때만 단계가 넘어간다(타이머도 바퀴 단위). */
function afterDescription(state: GameState): GameState {
  if (state.descriptions.length % state.seatCount !== 0) return state;
  if (state.descriptions.length < totalDescriptions(state)) return { ...state, stage: state.stage + 1 };
  return { ...state, phase: "discuss", stage: state.stage + 1, readySeats: [] };
}

function startVote(state: GameState): GameState {
  const all = Array.from({ length: state.seatCount }, (_, i) => i);
  return { ...state, phase: "vote", stage: state.stage + 1, voteRound: 1, candidates: all, voters: all, votes: {}, firstVotes: {} };
}

function tallyOf(state: GameState): Record<Seat, number> {
  const tally: Record<Seat, number> = {};
  for (const c of state.candidates) tally[c] = 0;
  for (const target of Object.values(state.votes)) {
    if (target !== null && target in tally) tally[target] += 1;
  }
  return tally;
}

function finishRound(state: GameState, winner: "liar" | "citizens", reason: RoundReason, accused: Seat | null, guess: string | null, tally: Record<Seat, number>): GameState {
  const plan = currentPlan(state);
  const points = Array(state.seatCount).fill(0) as number[];
  if (winner === "liar") {
    points[plan.liarSeat] = reason === "guessed" ? 2 : 3;
  } else {
    for (let s = 0; s < state.seatCount; s++) {
      if (s === plan.liarSeat) continue;
      points[s] = 1 + (state.firstVotes[s] === plan.liarSeat ? 1 : 0);
    }
  }
  const outcome: RoundOutcome = {
    round: state.roundIndex + 1,
    winner,
    reason,
    liarSeat: plan.liarSeat,
    accused,
    category: plan.category,
    word: plan.word,
    fakeWord: plan.fakeWord,
    guess,
    firstVotes: state.firstVotes,
    tally,
    points,
  };
  return {
    ...state,
    phase: "roundEnd",
    stage: state.stage + 1,
    accused,
    outcome,
    history: [...state.history, outcome],
    scores: state.scores.map((v, s) => v + points[s]),
  };
}

function resolveVote(state: GameState): GameState {
  const tally = tallyOf(state);
  const firstVotes = state.voteRound === 1 ? state.votes : state.firstVotes;
  const withFirst = { ...state, firstVotes };
  const best = Math.max(0, ...Object.values(tally));
  const top = best === 0 ? [] : state.candidates.filter((c) => tally[c] === best);
  if (top.length === 1) {
    const accused = top[0];
    const liar = currentPlan(state).liarSeat;
    if (accused !== liar) return finishRound(withFirst, "liar", "wrongAccuse", accused, null, tally);
    return { ...withFirst, phase: "guess", stage: state.stage + 1, accused };
  }
  // 동점(또는 유효표 0) — §8.3: 1차면 동점자 제외 재투표, 재투표도 동점이면 라이어 승리.
  if (state.voteRound === 1 && top.length > 1) {
    const voters = Array.from({ length: state.seatCount }, (_, i) => i).filter((s) => !top.includes(s));
    if (voters.length > 0) {
      return { ...withFirst, phase: "vote", stage: state.stage + 1, voteRound: 2, candidates: top, voters, votes: {} };
    }
  }
  return finishRound(withFirst, "liar", "tie", null, null, tally);
}

function advanceRound(state: GameState): GameState {
  if (isLastRound(state)) return { ...state, phase: "ended", stage: state.stage + 1 };
  return {
    ...state,
    roundIndex: state.roundIndex + 1,
    phase: "describe",
    stage: state.stage + 1,
    descriptions: [],
    readySeats: [],
    voteRound: 1,
    candidates: [],
    voters: [],
    votes: {},
    firstVotes: {},
    accused: null,
    outcome: null,
  };
}

function maybeEndVote(state: GameState): GameState {
  return state.voters.every((s) => s in state.votes) ? resolveVote(state) : state;
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "DESCRIBE": {
      if (!describePending(state).includes(action.seat)) return state;
      if (rejectReason(state, action.seat, action.text, "describe")) return state;
      const next: GameState = {
        ...state,
        descriptions: [...state.descriptions, { seat: action.seat, lap: currentLap(state), text: action.text.trim(), auto: false }],
        idleStreak: bumpIdle(state, [], [action.seat]),
      };
      return afterDescription(next);
    }
    case "CHAT": {
      if (state.phase === "describe" || state.phase === "ended") return state;
      if (action.seat < 0 || action.seat >= state.seatCount) return state;
      if (rejectReason(state, action.seat, action.text, "chat")) return state;
      const msg: ChatMessage = {
        seat: action.seat,
        round: state.roundIndex + 1,
        text: action.text.trim().slice(0, MAX_CHAT_LEN),
        ...(action.mention !== undefined ? { mention: action.mention } : {}),
      };
      return { ...state, chat: [...state.chat, msg].slice(-MAX_CHAT_LOG) };
    }
    case "READY": {
      if (state.phase !== "discuss" || state.readySeats.includes(action.seat)) return state;
      if (action.seat < 0 || action.seat >= state.seatCount) return state;
      const readySeats = [...state.readySeats, action.seat];
      const next = { ...state, readySeats, idleStreak: bumpIdle(state, [], [action.seat]) };
      return readySeats.length >= state.seatCount ? startVote(next) : next;
    }
    case "VOTE": {
      if (state.phase !== "vote") return state;
      if (!state.voters.includes(action.seat) || action.seat in state.votes) return state;
      if (action.target === action.seat || !state.candidates.includes(action.target)) return state;
      const next = { ...state, votes: { ...state.votes, [action.seat]: action.target }, idleStreak: bumpIdle(state, [], [action.seat]) };
      return maybeEndVote(next);
    }
    case "GUESS": {
      if (state.phase !== "guess") return state;
      const plan = currentPlan(state);
      if (action.seat !== plan.liarSeat) return state;
      const guess = action.text.trim().slice(0, MAX_GUESS_LEN);
      if (!guess) return state;
      const tally = tallyFromFinal(state);
      const correct = isCorrectGuess(plan.word, guess);
      const next = { ...state, idleStreak: bumpIdle(state, [], [action.seat]) };
      return finishRound(next, correct ? "liar" : "citizens", correct ? "guessed" : "missed", state.accused, guess, tally);
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      switch (state.phase) {
        case "describe": {
          const missing = describePending(state);
          if (missing.length === 0) return state;
          const lap = currentLap(state);
          const next: GameState = {
            ...state,
            descriptions: [...state.descriptions, ...missing.map((seat) => ({ seat, lap, text: "(시간 초과 — 패스)", auto: true }))],
            idleStreak: bumpIdle(state, missing, []),
          };
          return afterDescription(next);
        }
        case "discuss":
          return startVote({ ...state, idleStreak: bumpIdle(state, pendingSeats(state), []) });
        case "vote": {
          const missing = pendingSeats(state);
          const votes = { ...state.votes };
          for (const s of missing) votes[s] = null;
          return resolveVote({ ...state, votes, idleStreak: bumpIdle(state, missing, []) });
        }
        case "guess": {
          const liar = currentPlan(state).liarSeat;
          return finishRound({ ...state, idleStreak: bumpIdle(state, [liar], []) }, "citizens", "missed", state.accused, null, tallyFromFinal(state));
        }
        case "roundEnd":
          return advanceRound(state);
        default:
          return state;
      }
    }
    case "NEXT": {
      if (action.stage !== state.stage || state.phase !== "roundEnd") return state;
      return advanceRound(state);
    }
    default:
      return state;
  }
}

/** 정답 맞히기 단계에서 기록할 "결정 투표" 집계(투표가 이미 끝난 상태의 votes 기준). */
function tallyFromFinal(state: GameState): Record<Seat, number> {
  return tallyOf(state);
}

// ---------------------------------------------------------------------------
// 순위
// ---------------------------------------------------------------------------

export function computeRankings(state: GameState): { seat: Seat; rank: number; score: number }[] {
  const rows = state.scores.map((score, seat) => ({ seat, score }));
  rows.sort((a, b) => b.score - a.score || a.seat - b.seat);
  return rows.map((r) => ({ ...r, rank: rows.findIndex((x) => x.score === r.score) + 1 }));
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state)
    .filter((r) => r.rank === 1)
    .map((r) => r.seat);
}

// ---------------------------------------------------------------------------
// AI 봇 (§7.1) — 자기 좌석이 아는 정보만 쓴다.
//
// 사람의 자유로운 설명을 알아듣기 위해 단어별 연상어 사전(lexicon.ts)과 봇 힌트 문장을
// 합친 "단서 사전"으로 설명마다 단어별 근거 점수(`wordEvidence`, 여러 단어가 공유하는
// 단서는 IDF로 가중치↓)를 매기고, 카테고리 안 단어들의 확률(`wordPosterior`)로 추리한다.
// 실력은 LiarBotSkill.test.ts(봇 데이터와 분리된 사람 말투 모음으로 채운 판)로 잰다.
// ---------------------------------------------------------------------------

const PARTICLES = /(이에요|예요|에서|해요|어요|아요|이요|으로|하고|이랑|처럼|까지|부터|이죠|이지|죠|지|랑|은|는|이|가|을|를|에|도|요|의|로|와|과|만)$/;

/** 설명을 어절 단위로 자르고 조사·어미를 떼어낸 형태와 원형을 함께 돌려준다. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[\s,.!?~·…()"']+/)) {
    if (!raw) continue;
    out.push(raw);
    const stripped = raw.replace(PARTICLES, "");
    if (stripped && stripped !== raw) out.push(stripped);
  }
  return out;
}

function keyMatches(token: string, key: string): boolean {
  if (key.length === 1) return token.startsWith(key);
  if (token.includes(key)) return true;
  return token.length >= 2 && key.includes(token) && token.length >= Math.ceil(key.length * 0.6);
}

interface CategoryLex {
  readonly words: readonly string[];
  readonly keys: ReadonlyMap<string, readonly string[]>;
  readonly idf: ReadonlyMap<string, number>;
}
const lexCache = new Map<string, CategoryLex>();
const VAGUE = VAGUE_KEYS.split(/\s+/).filter(Boolean);

function categoryLex(categoryId: string): CategoryLex {
  const cached = lexCache.get(categoryId);
  if (cached) return cached;
  const cat = getCategory(categoryId);
  const words = cat ? cat.words.map((w) => w.word) : [];
  const keys = new Map<string, string[]>();
  for (const w of cat?.words ?? []) {
    const set = new Set<string>((WORD_KEYS[`${categoryId}:${w.word}`] ?? "").split(/\s+/).filter(Boolean));
    for (const h of w.hints) for (const t of tokens(h)) if (t.length >= 2 && !VAGUE.includes(t)) set.add(t);
    keys.set(w.word, [...set]);
  }
  const df = new Map<string, number>();
  for (const list of keys.values()) for (const k of list) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [k, n] of df) idf.set(k, Math.log(1 + words.length / n));
  const lex = { words, keys, idf };
  lexCache.set(categoryId, lex);
  return lex;
}

const evidenceCache = new Map<string, number>();

/** 설명 하나가 `word`를 가리킨다는 근거 점수(0 이상). 어절마다 가장 센 단서 하나만 센다. */
export function wordEvidence(categoryId: string, word: string, text: string): number {
  const cacheKey = `${categoryId}|${word}|${text}`;
  const hit = evidenceCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const value = computeEvidence(categoryId, word, text);
  if (evidenceCache.size > 50_000) evidenceCache.clear();
  evidenceCache.set(cacheKey, value);
  return value;
}

function computeEvidence(categoryId: string, word: string, text: string): number {
  const lex = categoryLex(categoryId);
  const keys = lex.keys.get(word);
  if (!keys) return 0;
  let score = 0;
  for (const t of tokens(text)) {
    let best = 0;
    for (const k of keys) if (keyMatches(t, k)) best = Math.max(best, lex.idf.get(k) ?? 0);
    score += best;
  }
  return score;
}

/** 0~1 — 이전 버전 API 호환용(근거가 있으면 1에 가깝다). */
export function wordAffinity(categoryId: string, word: string, text: string): number {
  const e = wordEvidence(categoryId, word, text);
  return e / (e + 1);
}

const POSTERIOR_SHARPNESS = 1.3;

/** 주어진 설명들로 본 카테고리 단어별 확률(합 1). */
function posteriorFrom(categoryId: string, texts: readonly string[]): { word: string; score: number }[] {
  const lex = categoryLex(categoryId);
  const logits = lex.words.map((w) => POSTERIOR_SHARPNESS * texts.reduce((s, t) => s + wordEvidence(categoryId, w, t), 0));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return lex.words.map((word, i) => ({ word, score: exps[i] / sum }));
}

/** `viewer`가 볼 수 있는 남의 설명으로 매긴 카테고리 내 단어별 확률. 라이어 봇의 추리. */
export function candidateScores(state: GameState, viewer: Seat): { word: string; score: number }[] {
  const plan = currentPlan(state);
  const texts = visibleDescriptions(state, viewer).filter((d) => d.seat !== viewer && !d.auto).map((d) => d.text);
  return posteriorFrom(plan.categoryId, texts);
}

export function bestGuessWord(state: GameState, viewer: Seat): string {
  const scored = candidateScores(state, viewer);
  const top = Math.max(...scored.map((c) => c.score));
  return scored.find((c) => c.score === top)!.word;
}

/** "제시어가 `word`라면" 설명 하나가 얼마나 라이어 같은가(0~1). */
function descriptionSuspicion(state: GameState, word: string, d: Description): number {
  const plan = currentPlan(state);
  if (d.auto) return 1;
  const lex = categoryLex(plan.categoryId);
  const own = wordEvidence(plan.categoryId, word, d.text);
  const other = Math.max(0, ...lex.words.filter((w) => w !== word).map((w) => wordEvidence(plan.categoryId, w, d.text)));
  let sus: number;
  if (own > 0 && own >= other * 0.8) sus = 0.08;
  else if (own > 0) sus = 0.4;
  else if (other > 0) sus = 0.92; // 다른 단어 얘기를 한다 — 찍어서 틀린 라이어의 전형
  else {
    // 무난한 말: 첫 바퀴는 조심하는 시민일 수도 있어 덜, 두 번째 바퀴는 더 의심한다.
    sus = d.lap > 1 ? 0.75 : 0.55;
  }
  // 따라쟁이: 이 설명의 단서가 전부 이전 바퀴 남의 설명에 이미 나왔다.
  if (own > 0 && d.lap > 1) {
    const earlier = state.descriptions.filter((e) => e.lap < d.lap && e.seat !== d.seat && !e.auto);
    const newInfo = tokens(d.text).some((t) => t.length >= 2 && !earlier.some((e) => e.text.includes(t)) && wordEvidence(plan.categoryId, word, t) > 0);
    if (!newInfo && earlier.length > 0) sus += 0.15;
  }
  return Math.min(1, sus);
}

/** 봇이 보는 좌석별 의심도(높을수록 라이어 같음). 라이어 봇은 자기가 믿는 단어 분포로 기대값을 낸다. */
export function suspicionScores(state: GameState, viewer: Seat): Record<Seat, number> {
  const known = knownWordFor(state, viewer);
  const belief = known ? [{ word: known, score: 1 }] : candidateScores(state, viewer).filter((c) => c.score > 0.02);
  const out: Record<Seat, number> = {};
  for (let s = 0; s < state.seatCount; s++) {
    if (s === viewer) continue;
    const mine = visibleDescriptions(state, viewer).filter((d) => d.seat === s);
    let sus = 0.5;
    if (mine.length > 0) {
      const total = belief.reduce((a, b) => a + b.score, 0) || 1;
      sus = 0;
      for (const b of belief) {
        const avg = mine.reduce((acc, d) => acc + descriptionSuspicion(state, b.word, d), 0) / mine.length;
        sus += (b.score / total) * avg;
      }
    }
    const mentions = state.chat.filter((m) => m.round === state.roundIndex + 1 && m.mention === s && m.seat !== viewer && m.seat !== s).length;
    out[s] = sus + mentions * CHAT_MENTION_WEIGHT;
  }
  return out;
}

/**
 * 밸런스 손잡이(봇끼리 시뮬레이션 + 사람 말투 평가로 맞춤 — LiarBotSkill.test.ts).
 * - `liarGuessAccuracy`: 들킨 라이어가 "가장 그럴듯한 후보"를 그대로 고를 확률.
 * - `citizenCaution`: 시민 봇이 라이어에게 덜 들키는(여러 단어에 두루 맞는) 힌트를 고르는 정도.
 */
function liarGuessAccuracy(level: BotLevel): number {
  return 0.35 + 0.05 * level;
}
function citizenCaution(level: BotLevel): number {
  return 0.1 * level;
}
/** 토론 채팅에서 다른 사람이 지목한 좌석에 더하는 의심도(1회당). */
const CHAT_MENTION_WEIGHT = 0.12;

function describeCandidates(state: GameState, seat: Seat, level: BotLevel, rng: () => number = () => 0): ScoredCandidate<string>[] {
  void rng;
  const plan = currentPlan(state);
  const cat = getCategory(plan.categoryId)!;
  const visible = visibleDescriptions(state, seat);
  const usedNorm = new Set(visible.map((d) => normalize(d.text)));
  const fresh = (list: readonly string[]) => list.filter((h) => !usedNorm.has(normalize(h)) && !rejectReason(state, seat, h, "describe"));
  // 힌트를 다 써버린 경우(10인 2바퀴 등)에도 항상 합법 설명이 하나는 있게 하는 번호 붙은 예비 문장.
  const fallback = [{ move: `음… 아까 말한 거랑 비슷해요 (${state.descriptions.length + 1})`, score: 0.1 }];
  const heard = visible.filter((d) => d.seat !== seat && !d.auto).map((d) => d.text);
  const known = knownWordFor(state, seat);
  if (known) {
    const bank = cat.words.find((w) => w.word === known)?.hints ?? [];
    let options = fresh(bank);
    // 인원이 많아 힌트를 다 쓰면 같은 힌트를 말투만 바꿔 다시 쓴다(사전 단어는 그대로라 시민끼리 통한다).
    if (options.length === 0) options = fresh(bank.flatMap((h) => [`확실히 ${h}`, `${h} 느낌`, `제 생각엔 ${h}`]));
    if (options.length === 0) {
      const generic = fresh(GENERIC_HINTS).map((h) => ({ move: h, score: 1 }));
      return generic.length > 0 ? generic : fallback;
    }
    // 넓은 표현 중 내 제시어에도 맞는 것(동료 시민 눈엔 자연스럽고 라이어에겐 덜 새는 말).
    const lap = currentLap(state);
    const broad = fresh(CATEGORY_BROAD[plan.categoryId] ?? []).filter((h) => descriptionSuspicion(state, known, { seat, lap, text: h, auto: false }) < 0.2);
    options = [...options, ...broad];
    // 노련한 시민: 동료에겐 통하지만 라이어가 들었을 때 제시어가 덜 드러나는 말을 고른다.
    return options.map((h) => {
      const leak = posteriorFrom(plan.categoryId, [...heard, h]).find((c) => c.word === known)!.score;
      return { move: h, score: 1 - citizenCaution(level) * leak };
    });
  }
  // 라이어: 지금까지 들은 설명으로 단어 확률을 세우고, 시민들 눈에 "가장 덜 의심스러울" 말을 고른다.
  // 기대 의심도 = Σ P(제시어=w) × (제시어가 w일 때 이 말이 얼마나 라이어 같은가).
  const belief = candidateScores(state, seat).filter((b) => b.score > 0.01);
  const total = belief.reduce((a, b) => a + b.score, 0) || 1;
  const lap = currentLap(state);
  const lines = [...new Set([...cat.words.flatMap((w) => w.hints), ...(CATEGORY_BROAD[plan.categoryId] ?? []), ...GENERIC_HINTS])];
  const all = fresh(lines).map((h) => {
    const d: Description = { seat, lap, text: h, auto: false };
    const expSus = belief.reduce((acc, b) => acc + (b.score / total) * descriptionSuspicion(state, b.word, d), 0);
    return { move: h, score: 1 - expSus };
  });
  return all.length > 0 ? all : fallback;
}

const ACCUSE_LINES = ["{m}님 설명이 좀 애매했어요 🤔", "저는 {m}님이 수상해요", "{m}님, 진짜 제시어 아세요?", "{m}님 말이 다른 사람이랑 결이 달라요", "음… {m}님 쪽이 의심돼요"];
const DEFEND_LINES = ["저 아니에요! 진짜 알고 말한 거예요", "에이 저는 시민이에요 😅", "제 설명 다시 보세요, 딱 맞잖아요", "억울해요… 저 말고 다른 분 같아요"];

/** 봇의 다음 행동. 결정할 게 없으면 null. `rng`는 기본 Math.random — 봇 판단은 엔진 결정론 계약 밖이다. */
export function chooseBotAction(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (!pendingSeats(state).includes(seat)) return null;
  switch (state.phase) {
    case "describe": {
      const text = pickByLevel(describeCandidates(state, seat, level, rng), level, rng);
      return { type: "DESCRIBE", seat, text };
    }
    case "discuss": {
      const round = state.roundIndex + 1;
      const mine = state.chat.filter((m) => m.seat === seat && m.round === round);
      const accusedMe = state.chat.some((m) => m.round === round && m.mention === seat && m.seat !== seat);
      if (accusedMe && !mine.some((m) => DEFEND_LINES.includes(m.text))) {
        return { type: "CHAT", seat, text: DEFEND_LINES[Math.floor(rng() * DEFEND_LINES.length)] };
      }
      if (!mine.some((m) => m.mention !== undefined) && rng() < 0.7) {
        const sus = suspicionScores(state, seat);
        const targets = Object.entries(sus).map(([s, v]) => ({ move: Number(s), score: v }));
        if (targets.length > 0) {
          const mention = pickByLevel(targets, level, rng);
          return { type: "CHAT", seat, text: ACCUSE_LINES[Math.floor(rng() * ACCUSE_LINES.length)], mention };
        }
      }
      return { type: "READY", seat };
    }
    case "vote": {
      const sus = suspicionScores(state, seat);
      const targets = state.candidates.filter((c) => c !== seat).map((c) => ({ move: c, score: sus[c] ?? 0.5 }));
      if (targets.length === 0) return null;
      return { type: "VOTE", seat, target: pickByLevel(targets, level, rng) };
    }
    case "guess": {
      const plan = currentPlan(state);
      const scored = candidateScores(state, seat);
      const pool = state.options.guessMode === "choice" ? plan.options : scored.map((c) => c.word);
      const cands = pool
        .filter((w) => w !== plan.fakeWord)
        .map((w) => ({ move: w, score: scored.find((c) => c.word === w)?.score ?? 0 }));
      if (cands.length === 0) return { type: "GUESS", seat, text: pool[0] };
      // 직감이 빗나가면 가장 그럴듯한 후보를 빼고 고른다.
      const best = Math.max(...cands.map((c) => c.score));
      const others = cands.filter((c) => c.score < best);
      const pickFrom = rng() > liarGuessAccuracy(level) && others.length > 0 ? others : cands;
      return { type: "GUESS", seat, text: pickByLevel(pickFrom, level, rng) };
    }
    default:
      return null;
  }
}

/** §7.1 계약 — 이 좌석이 지금 낼 수 있는 대표 합법 액션들(자유 입력은 예시 하나씩). */
export function getValidMoves(state: GameState, seat: Seat): EngineAction[] {
  if (!pendingSeats(state).includes(seat)) return [];
  switch (state.phase) {
    case "describe":
      return describeCandidates(state, seat, 10).map((c) => ({ type: "DESCRIBE", seat, text: c.move }));
    case "discuss":
      return [{ type: "READY", seat }];
    case "vote":
      return state.candidates.filter((c) => c !== seat).map((target) => ({ type: "VOTE", seat, target }));
    case "guess": {
      const plan = currentPlan(state);
      const pool = state.options.guessMode === "choice" ? plan.options : getCategory(plan.categoryId)!.words.map((w) => w.word);
      return pool.map((text) => ({ type: "GUESS", seat, text }));
    }
    default:
      return [];
  }
}
