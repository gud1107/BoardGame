import {
  CARD_COUNT,
  ROOMS,
  ROOM_BASE,
  ROOM_COUNT,
  ROUNDS_BY_PLAYERS,
  VAULT_BY_PLAYERS,
  START_ROOM,
  SUSPECT_COUNT,
  TRAIT_DIMS,
  WEAPON_BASE,
  WEAPON_COUNT,
  cardsOf,
  categoryOf,
  reachable,
  traitValue,
  type Category,
  type TraitRef,
} from "./data";

/**
 * 안개 저택 살인사건 — 2~6인 경쟁 추리. 규칙 원전: boardGameRule/안개저택살인사건/안개저택살인사건.md (자체 창작).
 *
 * 흐름: turn(이동 0~2칸 → 행동 1개: 심문/수색/고발/쉬기) → (심문 상대가 2장 이상이면) respond(상대가 보여 줄 카드 고르기)
 * → 다음 차례. 모두 한 번씩 = 한 라운드, 시계가 간다. 마지막 라운드가 끝나면 dawn(동시 최종 추리) → ended.
 *
 * 숨김 정보: 정답·남의 손패·🗄️ 금고 증거·방의 단서 더미·남이 본 단서·남에게 보여 준 카드·괘종 단서 계획·남의 새벽 추리.
 * 서버(또는 락스텝 기기)는 전체 상태를 들고, 화면·봇은 언제나 `fogView(state, seat)`만 본다.
 */

export type Seat = number;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const TURN_SECONDS = [45, 60, 90, 0] as const;
/** 보여 줄 카드 고르기 제한 */
export const RESPOND_MS = 25_000;
/** 방마다 단서 장수 */
export const CLUES_PER_ROOM = 2;
/** 시계에 맞춰 공개되는 금고 카드 수 (§13: 마지막 공개가 "다 같이 푸는 순간"이 돼 선 차례가 이겨서 0) */
export const VAULT_REVEALS = 0;

export interface GameOptions {
  /** 차례 제한(초), 0 = 무제한 */
  turnSeconds: number;
}

export const DEFAULT_OPTIONS: GameOptions = { turnSeconds: 60 };

export type Clue = { id: number; kind: "trait"; trait: TraitRef; bell: boolean } | { id: number; kind: "alibi"; card: number; bell: boolean };

export interface Guess {
  suspect: number;
  weapon: number;
  room: number;
}

export type LogEntry =
  | { kind: "move"; round: number; seat: Seat; from: number; to: number; path: number[] }
  | {
      kind: "ask";
      round: number;
      seat: Seat;
      target: Seat;
      cards: [number, number, number];
      /** 공개: 상대가 가진 장수 */
      count: number;
      /** 보여 준 카드. null = 없음(0장)·아직 고르는 중, -1 = 보는 사람에겐 비밀 */
      shown: number | null;
      /** 소환되기 전 용의자 위치 (연출) */
      summonedFrom: number;
    }
  | { kind: "search"; round: number; seat: Seat; room: number; /** -1 = 비밀 */ clue: number }
  | { kind: "bell"; round: number; room: number }
  /** 🗄️ 금고가 열려 카드 한 장이 앞면 공개 */
  | { kind: "vault"; round: number; card: number }
  | { kind: "accuse"; round: number; seat: Seat; guess: Guess; correct: boolean }
  | { kind: "pass"; round: number; seat: Seat; timeout: boolean }
  | { kind: "dawn"; round: number }
  | { kind: "final"; round: number; seat: Seat; guess: Guess | null; correct: boolean };

export interface Tally {
  asks: number;
  searches: number;
  clues: number;
  shownTo: number;
  moves: number;
  passages: number;
  bellClues: number;
}

export interface Outcome {
  solution: Guess;
  winners: Seat[];
  reason: "accused" | "dawn" | "allWrong";
  /** 맞힌 라운드 (새벽이면 maxRounds + 1) */
  solvedRound: number;
}

export interface PendingAsk {
  asker: Seat;
  target: Seat;
  cards: [number, number, number];
  /** log 안의 위치 */
  logIndex: number;
}

export interface BellPlan {
  round: number;
  room: number;
  clue: Clue;
}

export interface GameState {
  seed: number;
  /** 전체 상태면 -1, 보기면 그 좌석 */
  viewer: number;
  seatCount: number;
  options: GameOptions;
  /** 화면에 보이는 사건 번호 (시드를 되살릴 수 없는 짧은 수) */
  caseNo: number;
  phase: "turn" | "respond" | "dawn" | "ended";
  round: number;
  maxRounds: number;
  firstSeat: Seat;
  /** 시작부터 몇 번째 차례인지 (round·차례 계산용) */
  turnIndex: number;
  turn: Seat;
  moved: boolean;
  /** 단계가 바뀔 때마다 +1 (타이머·TIMEOUT 키) */
  stage: number;
  pos: number[];
  suspectPos: number[];
  /** 보기: 남의 것은 [] */
  hands: number[][];
  handCount: number[];
  /** 앞면 공개 카드 ("현장 보존 증거" — 4인 2장·5인 3장) */
  publicCards: number[];
  /** 🗄️ 금고 증거 — 아무도 못 보는 엎어 둔 카드. 보기: 끝나기 전엔 [] */
  vault: number[];
  vaultCount: number;
  /** 보기: 끝나기 전엔 null */
  solution: Guess | null;
  /** 보기: 전부 [] (남은 장수는 deckCount) */
  decks: Clue[][];
  deckCount: number[];
  /** 좌석별로 가져간 단서. 보기: 남의 것은 [] */
  clues: Clue[][];
  /** 괘종 계획 — 보기: [] */
  bellPlan: BellPlan[];
  /** 금고 열림 계획 (라운드 → 카드) — 보기: [] (라운드는 vaultRounds로 공개) */
  vaultPlan: { round: number; card: number }[];
  vaultRounds: number[];
  /** 괘종 라운드 (공개) */
  bellRounds: number[];
  eliminated: boolean[];
  /** 틀린 고발·새벽 오답 */
  wrong: boolean[];
  pending: PendingAsk | null;
  /** 새벽 추리: undefined=아직, null=기권. 보기: 남의 것은 아직 공개 전이면 undefined */
  finals: (Guess | null | undefined)[];
  finalIn: boolean[];
  log: LogEntry[];
  idleStreak: number[];
  /** 이번 차례에 사람이 뭔가 했다 (시간 초과 판정용) */
  acted: boolean;
  tally: Tally[];
  outcome: Outcome | null;
}

export type EngineAction =
  | { type: "MOVE"; seat: Seat; stage: number; room: number }
  | { type: "ASK"; seat: Seat; stage: number; target: Seat; suspect: number; weapon: number }
  | { type: "SEARCH"; seat: Seat; stage: number }
  | { type: "ACCUSE"; seat: Seat; stage: number; guess: Guess }
  | { type: "PASS"; seat: Seat; stage: number }
  | { type: "SHOW"; seat: Seat; stage: number; card: number }
  | { type: "FINAL"; seat: Seat; stage: number; guess: Guess | null }
  | { type: "TIMEOUT"; stage: number };

// ------------------------------------------------------------------ 난수

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const emptyTally = (): Tally => ({ asks: 0, searches: 0, clues: 0, shownTo: 0, moves: 0, passages: 0, bellClues: 0 });

function clampCount(n: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(n)));
}

export function vaultSize(seatCount: number): number {
  return VAULT_BY_PLAYERS[seatCount] ?? 0;
}

export function handSize(seatCount: number): number {
  return Math.floor((CARD_COUNT - 3 - vaultSize(seatCount)) / seatCount);
}

/** 금고 카드 k장을 시계에 고르게 연다 (2라운드부터) */
export function vaultRoundsFor(maxRounds: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => Math.max(2, Math.round(((i + 1) * maxRounds) / (k + 1)) + 1));
}

export function bellRoundsFor(maxRounds: number): number[] {
  return [Math.floor(maxRounds / 3) + 1, Math.floor((2 * maxRounds) / 3) + 1];
}

export function isGuessShape(g: unknown): g is Guess {
  if (!g || typeof g !== "object") return false;
  const o = g as Record<string, unknown>;
  return (
    typeof o.suspect === "number" &&
    Number.isInteger(o.suspect) &&
    o.suspect >= 0 &&
    o.suspect < SUSPECT_COUNT &&
    typeof o.weapon === "number" &&
    Number.isInteger(o.weapon) &&
    o.weapon >= WEAPON_BASE &&
    o.weapon < WEAPON_BASE + WEAPON_COUNT &&
    typeof o.room === "number" &&
    Number.isInteger(o.room) &&
    o.room >= ROOM_BASE &&
    o.room < ROOM_BASE + ROOM_COUNT
  );
}

export function sameGuess(a: Guess, b: Guess): boolean {
  return a.suspect === b.suspect && a.weapon === b.weapon && a.room === b.room;
}

// ------------------------------------------------------------------ 준비

/** 특징 단서 후보: 정답 카드의 실제 특징 */
function traitOf(card: number, cat: Category, dim: number): TraitRef {
  return { cat, dim, value: traitValue(card, dim) };
}

export function startGame(seatCount: number, seed: number, options: Partial<GameOptions> = {}): GameState {
  const n = clampCount(seatCount);
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!TURN_SECONDS.includes(opts.turnSeconds as (typeof TURN_SECONDS)[number])) opts.turnSeconds = DEFAULT_OPTIONS.turnSeconds;
  const rng = mulberry32(seed ^ 0x5f3759df);

  const solution: Guess = {
    suspect: cardsOf("suspect")[Math.floor(rng() * SUSPECT_COUNT)],
    weapon: cardsOf("weapon")[Math.floor(rng() * WEAPON_COUNT)],
    room: cardsOf("room")[Math.floor(rng() * ROOM_COUNT)],
  };
  const solSet = new Set([solution.suspect, solution.weapon, solution.room]);
  const rest = shuffle(
    Array.from({ length: CARD_COUNT }, (_, i) => i).filter((c) => !solSet.has(c)),
    rng,
  );
  const size = handSize(n);
  const hands = Array.from({ length: n }, (_, s) => rest.slice(s * size, (s + 1) * size).sort((a, b) => a - b));
  const vault = rest.slice(n * size, n * size + vaultSize(n)).sort((a, b) => a - b);
  const publicCards = rest.slice(n * size + vaultSize(n)).sort((a, b) => a - b);

  // 단서: 특징 3장(용의자·흉기·장소 하나씩, 종류 무작위) + 알리바이 15장 → 방 9곳 × 2장
  const sDims = shuffle([0, 1, 2], rng);
  const wDim = Math.floor(rng() * TRAIT_DIMS.weapon);
  const rDims = shuffle([0, 1], rng);
  let id = 0;
  const traitClues: Clue[] = [
    { id: id++, kind: "trait", trait: traitOf(solution.suspect, "suspect", sDims[0]), bell: false },
    { id: id++, kind: "trait", trait: traitOf(solution.weapon, "weapon", wDim), bell: false },
    { id: id++, kind: "trait", trait: traitOf(solution.room, "room", rDims[0]), bell: false },
  ];
  // 금고 카드의 알리바이는 반드시 어딘가에 있다 — 금고는 수색으로만 지울 수 있으니까
  const vaultSet = new Set(vault);
  const alibiCards = [
    ...shuffle([...vaultSet], rng),
    ...shuffle(
      Array.from({ length: CARD_COUNT }, (_, i) => i).filter((c) => !solSet.has(c) && !vaultSet.has(c)),
      rng,
    ),
  ].slice(0, ROOM_COUNT * CLUES_PER_ROOM - traitClues.length);
  const alibis: Clue[] = alibiCards.map((card) => ({ id: id++, kind: "alibi", card, bell: false }));
  const all = shuffle([...traitClues, ...alibis], rng);
  const decks = Array.from({ length: ROOM_COUNT }, (_, r) => all.slice(r * CLUES_PER_ROOM, (r + 1) * CLUES_PER_ROOM));

  const maxRounds = ROUNDS_BY_PLAYERS[n] ?? 10;
  const bellRounds = bellRoundsFor(maxRounds);
  const bellClues: Clue[] = [
    { id: id++, kind: "trait", trait: traitOf(solution.suspect, "suspect", sDims[1]), bell: true },
    { id: id++, kind: "trait", trait: traitOf(solution.room, "room", rDims[1]), bell: true },
  ];
  const bellPlan: BellPlan[] = bellRounds.map((round, i) => ({ round, room: Math.floor(rng() * ROOM_COUNT), clue: bellClues[i] }));

  const vaultRounds = vaultRoundsFor(maxRounds, Math.min(VAULT_REVEALS, vault.length));
  const vaultOrder = shuffle(vault, rng);
  const vaultPlan = vaultRounds.map((round, i) => ({ round, card: vaultOrder[i] }));

  const suspectPos = Array.from({ length: SUSPECT_COUNT }, () => Math.floor(rng() * ROOM_COUNT));
  const firstSeat = Math.floor(rng() * n);

  return {
    seed,
    viewer: -1,
    seatCount: n,
    options: opts,
    caseNo: 1000 + (Math.imul(seed >>> 0, 2654435761) >>> 0) % 9000,
    phase: "turn",
    round: 1,
    maxRounds,
    firstSeat,
    turnIndex: 0,
    turn: firstSeat,
    moved: false,
    stage: 0,
    pos: Array(n).fill(START_ROOM),
    suspectPos,
    hands,
    handCount: hands.map((h) => h.length),
    publicCards,
    vault,
    vaultCount: vault.length,
    vaultPlan,
    vaultRounds,
    solution,
    decks,
    deckCount: decks.map((d) => d.length),
    clues: Array.from({ length: n }, () => []),
    bellPlan,
    bellRounds,
    eliminated: Array(n).fill(false),
    wrong: Array(n).fill(false),
    pending: null,
    finals: Array(n).fill(undefined),
    finalIn: Array(n).fill(false),
    log: [],
    idleStreak: Array(n).fill(0),
    acted: false,
    tally: Array.from({ length: n }, emptyTally),
    outcome: null,
  };
}

// ------------------------------------------------------------------ 진행

function activeSeats(state: GameState): Seat[] {
  return Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => !state.eliminated[s]);
}

/** 새 라운드 시작 처리: 괘종 */
function startRound(stateIn: GameState, round: number): GameState {
  let state = { ...stateIn, round };
  for (const v of state.vaultPlan.filter((p) => p.round === round)) {
    const vault = state.vault.filter((c) => c !== v.card);
    state = {
      ...state,
      vault,
      vaultCount: vault.length,
      publicCards: [...state.publicCards, v.card].sort((a, b) => a - b),
      log: [...state.log, { kind: "vault", round, card: v.card }],
    };
  }
  const bell = state.bellPlan.find((b) => b.round === round);
  if (!bell) return state;
  const decks = state.decks.map((d, r) => (r === bell.room ? [bell.clue, ...d] : d));
  return {
    ...state,
    round,
    decks,
    deckCount: decks.map((d) => d.length),
    log: [...state.log, { kind: "bell", round, room: bell.room }],
  };
}

function endGame(state: GameState, winners: Seat[], reason: Outcome["reason"]): GameState {
  return {
    ...state,
    phase: "ended",
    pending: null,
    stage: state.stage + 1,
    outcome: { solution: state.solution!, winners, reason, solvedRound: reason === "dawn" ? state.maxRounds + 1 : state.round },
  };
}

function startDawn(state: GameState): GameState {
  const finals = state.finals.map((f, s) => (state.eliminated[s] ? null : undefined));
  return {
    ...state,
    phase: "dawn",
    round: state.maxRounds,
    pending: null,
    moved: false,
    acted: false,
    finals,
    finalIn: state.eliminated.map((e) => e),
    stage: state.stage + 1,
    log: [...state.log, { kind: "dawn", round: state.maxRounds }],
  };
}

/** 다음 차례로 (누명 쓴 좌석은 건너뛴다) */
function nextTurn(state: GameState): GameState {
  if (activeSeats(state).length === 0) return endGame(state, [], "allWrong");
  let s: GameState = { ...state, pending: null, moved: false, acted: false, phase: "turn", stage: state.stage + 1 };
  let idx = state.turnIndex;
  for (let guard = 0; guard < state.seatCount * (state.maxRounds + 2); guard++) {
    idx += 1;
    const round = Math.floor(idx / state.seatCount) + 1;
    if (round > state.maxRounds) return startDawn({ ...s, turnIndex: idx });
    if (round !== s.round) s = startRound(s, round);
    const seat = (state.firstSeat + idx) % state.seatCount;
    if (!s.eliminated[seat]) return { ...s, turnIndex: idx, turn: seat };
  }
  return startDawn(s);
}

function bumpIdle(state: GameState, seat: Seat, idle: boolean): number[] {
  return state.idleStreak.map((v, i) => (i === seat ? (idle ? v + 1 : 0) : v));
}

function addTally(state: GameState, seat: Seat, patch: Partial<Tally>): Tally[] {
  return state.tally.map((t, i) => {
    if (i !== seat) return t;
    const out = { ...t };
    for (const [k, v] of Object.entries(patch) as [keyof Tally, number][]) out[k] += v;
    return out;
  });
}

function doMove(state: GameState, seat: Seat, room: number): GameState {
  if (state.moved || room === state.pos[seat]) return state;
  const path = reachable(state.pos[seat]).get(room);
  if (!path) return state;
  const from = state.pos[seat];
  let passages = 0;
  let prev = from;
  for (const r of path) {
    if (Math.abs(Math.floor(prev / 3) - Math.floor(r / 3)) + Math.abs((prev % 3) - (r % 3)) > 1) passages++;
    prev = r;
  }
  return {
    ...state,
    pos: state.pos.map((p, i) => (i === seat ? room : p)),
    moved: true,
    acted: true,
    idleStreak: bumpIdle(state, seat, false),
    tally: addTally(state, seat, { moves: 1, passages }),
    log: [...state.log, { kind: "move", round: state.round, seat, from, to: room, path }],
  };
}

function matchingCards(state: GameState, target: Seat, cards: number[]): number[] {
  const hand = new Set(state.hands[target]);
  return cards.filter((c) => hand.has(c));
}

function doAsk(state: GameState, seat: Seat, target: Seat, suspect: number, weapon: number): GameState {
  if (target === seat || target < 0 || target >= state.seatCount) return state;
  if (categoryOf(suspect) !== "suspect" || categoryOf(weapon) !== "weapon") return state;
  const room = ROOM_BASE + state.pos[seat];
  const cards: [number, number, number] = [suspect, weapon, room];
  const have = matchingCards(state, target, cards);
  const summonedFrom = state.suspectPos[suspect];
  const entry: LogEntry = { kind: "ask", round: state.round, seat, target, cards, count: have.length, shown: have.length === 1 ? have[0] : null, summonedFrom };
  const base: GameState = {
    ...state,
    suspectPos: state.suspectPos.map((p, i) => (i === suspect ? state.pos[seat] : p)),
    idleStreak: bumpIdle(state, seat, false),
    tally: addTally(state, seat, { asks: 1 }),
    log: [...state.log, entry],
  };
  if (have.length >= 2) {
    return { ...base, phase: "respond", pending: { asker: seat, target, cards, logIndex: base.log.length - 1 }, stage: state.stage + 1 };
  }
  if (have.length === 1) return nextTurn({ ...base, tally: addTally(base, target, { shownTo: 1 }) });
  return nextTurn(base);
}

function doShow(state: GameState, seat: Seat, card: number, timeout: boolean): GameState {
  const p = state.pending;
  if (!p || seat !== p.target) return state;
  const have = matchingCards(state, seat, p.cards);
  if (!have.includes(card)) return state;
  const log = state.log.map((e, i) => (i === p.logIndex && e.kind === "ask" ? { ...e, shown: card } : e));
  return nextTurn({ ...state, log, idleStreak: bumpIdle(state, seat, timeout), tally: addTally(state, seat, { shownTo: 1 }) });
}

function doSearch(state: GameState, seat: Seat): GameState {
  const room = state.pos[seat];
  const deck = state.decks[room];
  if (deck.length === 0) return state;
  const [clue, ...restDeck] = deck;
  const decks = state.decks.map((d, r) => (r === room ? restDeck : d));
  return nextTurn({
    ...state,
    decks,
    deckCount: decks.map((d) => d.length),
    clues: state.clues.map((c, s) => (s === seat ? [...c, clue] : c)),
    idleStreak: bumpIdle(state, seat, false),
    tally: addTally(state, seat, { searches: 1, clues: 1, bellClues: clue.bell ? 1 : 0 }),
    log: [...state.log, { kind: "search", round: state.round, seat, room, clue: clue.id }],
  });
}

function doAccuse(state: GameState, seat: Seat, guess: Guess): GameState {
  if (!isGuessShape(guess)) return state;
  const correct = sameGuess(guess, state.solution!);
  const next: GameState = {
    ...state,
    idleStreak: bumpIdle(state, seat, false),
    log: [...state.log, { kind: "accuse", round: state.round, seat, guess, correct }],
  };
  if (correct) return endGame(next, [seat], "accused");
  return nextTurn({ ...next, eliminated: next.eliminated.map((e, i) => e || i === seat), wrong: next.wrong.map((w, i) => w || i === seat) });
}

function doPass(state: GameState, seat: Seat, timeout: boolean): GameState {
  const idle = timeout && !state.acted;
  return nextTurn({
    ...state,
    idleStreak: bumpIdle(state, seat, idle),
    log: [...state.log, { kind: "pass", round: state.round, seat, timeout }],
  });
}

function resolveDawn(state: GameState): GameState {
  const sol = state.solution!;
  const winners: Seat[] = [];
  const log = [...state.log];
  const wrong = [...state.wrong];
  for (let s = 0; s < state.seatCount; s++) {
    if (state.eliminated[s]) continue;
    const g = state.finals[s] ?? null;
    const correct = !!g && sameGuess(g, sol);
    if (correct) winners.push(s);
    else if (g) wrong[s] = true;
    log.push({ kind: "final", round: state.maxRounds, seat: s, guess: g, correct });
  }
  return endGame({ ...state, log, wrong }, winners, "dawn");
}

function doFinal(state: GameState, seat: Seat, guess: Guess | null, timeout: boolean): GameState {
  if (state.eliminated[seat] || state.finalIn[seat]) return state;
  if (guess !== null && !isGuessShape(guess)) return state;
  const next: GameState = {
    ...state,
    finals: state.finals.map((f, i) => (i === seat ? guess : f)),
    finalIn: state.finalIn.map((f, i) => f || i === seat),
    idleStreak: bumpIdle(state, seat, timeout),
  };
  return next.finalIn.every((f) => f) ? resolveDawn(next) : next;
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  if (state.phase === "ended") return state;
  if (action.stage !== state.stage) return state;
  if (action.type === "TIMEOUT") {
    if (state.phase === "turn") return doPass(state, state.turn, true);
    if (state.phase === "respond" && state.pending) {
      const have = matchingCards(state, state.pending.target, state.pending.cards);
      return doShow(state, state.pending.target, have[0], true);
    }
    if (state.phase === "dawn") {
      let s = state;
      for (let seat = 0; seat < state.seatCount; seat++) if (!s.finalIn[seat] && s.phase === "dawn") s = doFinal(s, seat, null, true);
      return s;
    }
    return state;
  }
  const seat = action.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seatCount) return state;
  if (action.type === "SHOW") return state.phase === "respond" ? doShow(state, seat, action.card, false) : state;
  if (action.type === "FINAL") return state.phase === "dawn" ? doFinal(state, seat, action.guess, false) : state;
  if (state.phase !== "turn" || seat !== state.turn) return state;
  switch (action.type) {
    case "MOVE":
      return doMove(state, seat, action.room);
    case "ASK":
      return doAsk(state, seat, action.target, action.suspect, action.weapon);
    case "SEARCH":
      return doSearch(state, seat);
    case "ACCUSE":
      return doAccuse(state, seat, action.guess);
    case "PASS":
      return doPass(state, seat, false);
  }
  return state;
}

/** 지금 무언가 해야 하는 좌석들 */
export function pendingSeats(state: GameState): Seat[] {
  if (state.phase === "turn") return [state.turn];
  if (state.phase === "respond" && state.pending) return [state.pending.target];
  if (state.phase === "dawn") return Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => !state.finalIn[s]);
  return [];
}

export function stageDurationMs(state: GameState): number {
  if (state.phase === "respond") return RESPOND_MS;
  if (state.phase === "turn" || state.phase === "dawn") return state.options.turnSeconds > 0 ? state.options.turnSeconds * 1000 : 0;
  return 0;
}

/** 보여 줄 수 있는 카드 (respond 단계의 상대) */
export function showableCards(state: GameState): number[] {
  const p = state.pending;
  if (!p) return [];
  const hand = new Set(state.hands[p.target]);
  return p.cards.filter((c) => hand.has(c));
}

// ------------------------------------------------------------------ 보기 (숨김 정보 거르기)

/**
 * `seat`가 볼 수 있는 상태 — 모양은 같고 비밀만 지운다.
 * - 정답·남의 손패·방의 단서 더미·남의 단서·괘종 계획·시드: 지움 (끝나면 정답·손패·단서는 공개)
 * - 심문 기록의 보여 준 카드: 묻는 사람·답한 사람만, 남에겐 -1
 * - 수색 기록의 단서 번호: 뒤진 사람만, 남에겐 -1
 * - 새벽 추리: 공개 전엔 내 것만
 */
export function fogView(state: GameState, seat: Seat): GameState {
  const me = seat >= 0 && seat < state.seatCount ? seat : -1;
  if (state.phase === "ended") return { ...state, seed: 0, viewer: me, decks: state.decks.map(() => []), bellPlan: [], vaultPlan: [] };
  const log = state.log.map((e): LogEntry => {
    if (e.kind === "ask" && e.shown !== null && e.seat !== me && e.target !== me) return { ...e, shown: -1 };
    if (e.kind === "search" && e.seat !== me) return { ...e, clue: -1 };
    return e;
  });
  return {
    ...state,
    seed: 0,
    viewer: me,
    hands: state.hands.map((h, i) => (i === me ? h : [])),
    vault: [],
    vaultPlan: [],
    solution: null,
    decks: state.decks.map(() => []),
    clues: state.clues.map((c, i) => (i === me ? c : [])),
    bellPlan: [],
    finals: state.finals.map((f, i) => (i === me ? f : undefined)),
    log,
  };
}

// ------------------------------------------------------------------ 결과

export interface Ranking {
  seat: Seat;
  rank: number;
}

/** 맞힘 1위 · 버팀 2위 · 틀림 3위 (§10) */
export function rankOf(state: GameState, seat: Seat): number {
  if (state.outcome?.winners.includes(seat)) return 1;
  return state.wrong[seat] ? 3 : 2;
}

export function computeRankings(state: GameState): Ranking[] {
  return Array.from({ length: state.seatCount }, (_, seat) => ({ seat, rank: rankOf(state, seat) }));
}

export function winnerSeats(state: GameState): Seat[] {
  return state.outcome?.winners ?? [];
}

/** 시계 (분, 00:00 기준) — 라운드 r이 시작하는 시각 */
export function clockMinutes(state: Pick<GameState, "round" | "maxRounds" | "phase">): number {
  if (state.phase === "dawn" || state.phase === "ended") return 360;
  return Math.round(((state.round - 1) * 360) / state.maxRounds / 5) * 5;
}

export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function roundsLeft(state: GameState): number {
  return state.maxRounds - state.round;
}

export { ROOMS };
