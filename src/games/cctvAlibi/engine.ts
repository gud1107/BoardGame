import { ERRAND_COUNT, ROOM_COUNT, ROUNDS_BY_PLAYERS, TICKS, guestDist as dist } from "./data";
import { culpritAutoPlan, footageOf, fullRoute, guestAutoRoute, validCulpritRoute, validForge, validGuestRoute, type Forge, type Plan } from "./planner";

/**
 * CCTV 알리바이 — 3~6인 숨은 범인 추리. 규칙 원전: boardGameRule/CCTV알리바이/CCTV알리바이.md (자체 창작).
 *
 * 한 사건의 흐름:
 *   night(모두 동시에 비밀로 밤 동선을 짠다 — 범인은 금고실에 들르고 영상 1~3시각을 바꿔치기)
 *   → watch(CCTV 영상 공개 · 판독 시간)
 *   → investigate(돌아가며 한 번씩: 🔎 센서 대조 / 🗣️ 증언 / 넘기기, 정해진 라운드만큼)
 *   → vote(동시 비밀 투표) → result(다음 사건이 있으면) → … → ended
 *
 * 숨김 정보: 범인이 누구인지 · 실제 동선(영상과 다른 건 범인뿐) · 조작 구간 · 남의 할 일 · 남이 실제로 본 것 · 남의 표.
 * 서버(또는 락스텝 기기)는 전체 상태를 들고, 화면·봇은 언제나 `cctvView(state, seat)`만 본다.
 */

export type Seat = number;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const PLAN_SECONDS = [60, 90, 120, 0] as const;
export const TURN_SECONDS = [20, 30, 45, 0] as const;
export const CASE_COUNTS = [1, 2, 3] as const;
/** 영상 판독 시간 */
export const WATCH_MS = 25_000;
export const VOTE_MS = 45_000;
/** 사건 사이 결과 화면 */
export const RESULT_MS = 25_000;

/** 점수 (§7) */
export const SCORE_GUEST_CATCH = 2;
export const SCORE_VOTE_BONUS = 1;
export const SCORE_ESCAPE = 5;

export interface GameOptions {
  /** 밤 동선 계획 제한(초), 0 = 무제한 */
  planSeconds: number;
  /** 수사 차례 제한(초), 0 = 무제한 */
  turnSeconds: number;
  /** 사건 수 */
  cases: number;
}

export const DEFAULT_OPTIONS: GameOptions = { planSeconds: 90, turnSeconds: 30, cases: 1 };

export type TestimonyKind = "absent" | "present";

export type LogEntry =
  | { kind: "night"; caseIndex: number }
  | { kind: "check"; caseIndex: number; round: number; seat: Seat; t: number; room: number; /** 센서가 센 실제 인원 */ truth: number; /** 영상에 찍힌 인원 */ footage: number }
  | { kind: "testify"; caseIndex: number; round: number; seat: Seat; target: Seat; t: number; /** 증언자가 영상에서 있던 방 */ room: number; claim: TestimonyKind }
  | { kind: "pass"; caseIndex: number; round: number; seat: Seat; timeout: boolean }
  | { kind: "verdict"; caseIndex: number; culprit: Seat; caught: boolean; votes: (Seat | null)[]; gains: number[] };

export interface Tally {
  checks: number;
  /** 불일치를 찾아낸 대조 */
  hits: number;
  testimonies: number;
  correctVotes: number;
  guestCases: number;
  culpritCases: number;
  escapes: number;
  caughtAsCulprit: number;
  /** 손님으로 범인을 잡은 사건 */
  catches: number;
  /** 내 기억과 영상이 어긋난 걸 본(목격자) 사건 */
  witnessed: number;
  /** 범인일 때 받은 표 */
  votesAgainstAsCulprit: number;
  /** 결백한데 받은 표 */
  framedVotes: number;
}

export interface CaseSummary {
  culprit: Seat;
  caught: boolean;
  votes: (Seat | null)[];
  gains: number[];
}

export interface Outcome {
  winners: Seat[];
  scores: number[];
}

export interface GameState {
  seed: number;
  /** 전체 상태면 -1, 보기면 그 좌석 */
  viewer: number;
  seatCount: number;
  options: GameOptions;
  /** 화면에 보이는 사건 번호 (시드를 되살릴 수 없는 짧은 수) */
  caseNo: number;
  caseIndex: number;
  totalCases: number;
  phase: "night" | "watch" | "investigate" | "vote" | "result" | "ended";
  /** 단계·차례가 바뀔 때마다 +1 (타이머·TIMEOUT 키) */
  stage: number;
  /** 사건마다 범인이 될 좌석 순서 — 보기: [] */
  culpritOrder: Seat[];
  /** 범인 좌석. 보기: 내가 범인이거나 결과가 나오기 전엔 -1 */
  culprit: Seat;
  starts: number[];
  /** 손님의 할 일 방. 보기: 남의 것은 [] (범인은 원래 []) */
  errands: number[][];
  /** 낸 계획. 보기: 남의 것은 null */
  plans: (Plan | null)[];
  planned: boolean[];
  /** 실제 동선 (길이 TICKS+1). 보기: 남의 것은 [] */
  truth: number[][];
  /** CCTV 영상 동선 — 밤이 끝나면 모두에게 공개 */
  footage: number[][];
  /** 좌석별·시각별로 실제로 같은 방에 있던 다른 사람. 보기: 남의 것은 [] */
  sight: Seat[][][];
  /** watch·result 단계의 준비 완료 */
  ready: boolean[];
  rounds: number;
  round: number;
  firstSeat: Seat;
  turnIndex: number;
  turn: Seat;
  /** 좌석이 이번 사건에 증언을 했나 (한 사건 1번) */
  testified: boolean[];
  /** 표. undefined=아직, null=기권. 보기: 공개 전엔 내 것만 */
  votes: (Seat | null | undefined)[];
  voteIn: boolean[];
  scores: number[];
  cases: CaseSummary[];
  log: LogEntry[];
  idleStreak: number[];
  tally: Tally[];
  outcome: Outcome | null;
}

export type EngineAction =
  | { type: "PLAN"; seat: Seat; stage: number; plan: Plan }
  | { type: "READY"; seat: Seat; stage: number }
  | { type: "CHECK"; seat: Seat; stage: number; t: number; room: number }
  | { type: "TESTIFY"; seat: Seat; stage: number; target: Seat; t: number }
  | { type: "PASS"; seat: Seat; stage: number }
  | { type: "VOTE"; seat: Seat; stage: number; target: Seat | null }
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

const emptyTally = (): Tally => ({
  checks: 0,
  hits: 0,
  testimonies: 0,
  correctVotes: 0,
  guestCases: 0,
  culpritCases: 0,
  escapes: 0,
  caughtAsCulprit: 0,
  catches: 0,
  witnessed: 0,
  votesAgainstAsCulprit: 0,
  framedVotes: 0,
});

function clampCount(n: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(n)));
}

export function roundsFor(seatCount: number): number {
  return ROUNDS_BY_PLAYERS[seatCount] ?? 2;
}

// ------------------------------------------------------------------ 준비

function caseRng(seed: number, caseIndex: number): () => number {
  return mulberry32((seed ^ Math.imul(caseIndex + 1, 0x9e3779b9)) >>> 0);
}

/** 할 일 2곳: 출발 방이 아니고, 둘 다 들르는 가장 짧은 길이 6걸음 이하 */
function dealErrands(start: number, rng: () => number): number[] {
  for (let guard = 0; guard < 50; guard++) {
    const pool = shuffle(
      Array.from({ length: ROOM_COUNT }, (_, r) => r).filter((r) => r !== start),
      rng,
    ).slice(0, ERRAND_COUNT);
    const [a, b] = pool;
    const tour = Math.min(dist(start, a) + dist(a, b), dist(start, b) + dist(b, a));
    if (tour <= TICKS - 2) return pool.sort((x, y) => x - y);
  }
  return [(start + 1) % ROOM_COUNT, (start + 3) % ROOM_COUNT].sort((x, y) => x - y);
}

function dealCase(base: GameState, caseIndex: number): GameState {
  const n = base.seatCount;
  const rng = caseRng(base.seed, caseIndex);
  const culprit = base.culpritOrder[caseIndex % n];
  const starts = shuffle(
    Array.from({ length: ROOM_COUNT }, (_, r) => r),
    rng,
  ).slice(0, n);
  const errands = starts.map((s, seat) => (seat === culprit ? [] : dealErrands(s, rng)));
  const firstSeat = Math.floor(rng() * n);
  return {
    ...base,
    caseIndex,
    caseNo: 1000 + ((Math.imul((base.seed ^ (caseIndex * 7919)) >>> 0, 2654435761) >>> 0) % 9000),
    phase: "night",
    stage: base.stage + 1,
    culprit,
    starts,
    errands,
    plans: Array(n).fill(null),
    planned: Array(n).fill(false),
    truth: Array.from({ length: n }, () => []),
    footage: Array.from({ length: n }, () => []),
    sight: Array.from({ length: n }, () => []),
    ready: Array(n).fill(false),
    rounds: roundsFor(n),
    round: 1,
    firstSeat,
    turnIndex: 0,
    turn: firstSeat,
    testified: Array(n).fill(false),
    votes: Array(n).fill(undefined),
    voteIn: Array(n).fill(false),
  };
}

export function startGame(seatCount: number, seed: number, options: Partial<GameOptions> = {}): GameState {
  const n = clampCount(seatCount);
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!PLAN_SECONDS.includes(opts.planSeconds as (typeof PLAN_SECONDS)[number])) opts.planSeconds = DEFAULT_OPTIONS.planSeconds;
  if (!TURN_SECONDS.includes(opts.turnSeconds as (typeof TURN_SECONDS)[number])) opts.turnSeconds = DEFAULT_OPTIONS.turnSeconds;
  if (!CASE_COUNTS.includes(opts.cases as (typeof CASE_COUNTS)[number])) opts.cases = DEFAULT_OPTIONS.cases;
  const rng = mulberry32(seed ^ 0x2545f491);
  const culpritOrder = shuffle(
    Array.from({ length: n }, (_, s) => s),
    rng,
  );
  const base: GameState = {
    seed,
    viewer: -1,
    seatCount: n,
    options: opts,
    caseNo: 0,
    caseIndex: 0,
    totalCases: opts.cases,
    phase: "night",
    stage: -1,
    culpritOrder,
    culprit: 0,
    starts: [],
    errands: [],
    plans: [],
    planned: [],
    truth: [],
    footage: [],
    sight: [],
    ready: [],
    rounds: roundsFor(n),
    round: 1,
    firstSeat: 0,
    turnIndex: 0,
    turn: 0,
    testified: [],
    votes: [],
    voteIn: [],
    scores: Array(n).fill(0),
    cases: [],
    log: [],
    idleStreak: Array(n).fill(0),
    tally: Array.from({ length: n }, emptyTally),
    outcome: null,
  };
  return dealCase(base, 0);
}

// ------------------------------------------------------------------ 도우미 (화면·봇도 쓴다)

export interface Contradiction {
  target: Seat;
  t: number;
  /** 내가 있던 방 */
  room: number;
  /** absent = 영상엔 나와 같이 있는데 실제론 없었다 · present = 실제로 같이 있었는데 영상엔 딴 곳 */
  kind: TestimonyKind;
}

/** 내 기억(실제로 본 것)과 영상이 어긋나는 장면들 — 손님에게만 의미가 있다 */
export function contradictionsOf(view: GameState, seat: Seat): Contradiction[] {
  const mine = view.truth[seat];
  const sight = view.sight[seat];
  if (!mine || mine.length === 0 || !sight || sight.length === 0) return [];
  const out: Contradiction[] = [];
  for (let t = 1; t <= TICKS; t++) {
    for (let x = 0; x < view.seatCount; x++) {
      if (x === seat) continue;
      const inFootage = view.footage[x]?.[t] === mine[t];
      const inTruth = sight[t].includes(x);
      if (inFootage && !inTruth) out.push({ target: x, t, room: mine[t], kind: "absent" });
      else if (!inFootage && inTruth) out.push({ target: x, t, room: mine[t], kind: "present" });
    }
  }
  return out;
}

/** 증언 문장의 종류: 영상에서 상대가 나와 같은 방이면 "없었다", 아니면 "여기 있었다" */
export function claimKind(view: GameState, seat: Seat, target: Seat, t: number): TestimonyKind {
  return view.footage[target]?.[t] === view.footage[seat]?.[t] ? "absent" : "present";
}

export function footageCount(view: GameState, t: number, room: number): number {
  let n = 0;
  for (let s = 0; s < view.seatCount; s++) if (view.footage[s]?.[t] === room) n++;
  return n;
}

export function checkedCell(view: GameState, t: number, room: number): Extract<LogEntry, { kind: "check" }> | undefined {
  for (const e of view.log) if (e.kind === "check" && e.caseIndex === view.caseIndex && e.t === t && e.room === room) return e;
  return undefined;
}

/** 이번 사건의 기록만 */
export function caseLog(view: GameState): LogEntry[] {
  return view.log.filter((e) => e.caseIndex === view.caseIndex);
}

export function turnsLeft(view: GameState): number {
  return view.phase === "investigate" ? view.seatCount * view.rounds - view.turnIndex : 0;
}

// ------------------------------------------------------------------ 진행

function bumpIdle(state: GameState, seat: Seat, idle: boolean): number[] {
  return state.idleStreak.map((v, i) => (i === seat ? (idle ? v + 1 : 0) : v));
}

function addTally(tally: Tally[], seat: Seat, patch: Partial<Tally>): Tally[] {
  return tally.map((t, i) => {
    if (i !== seat) return t;
    const out = { ...t };
    for (const [k, v] of Object.entries(patch) as [keyof Tally, number][]) out[k] += v;
    return out;
  });
}

/** 낸 계획이 규칙에 맞나 */
export function planError(state: GameState, seat: Seat, plan: unknown): string | null {
  if (!plan || typeof plan !== "object") return "계획이 비어 있어요";
  const p = plan as Plan;
  const start = state.starts[seat];
  if (seat === state.culprit) {
    if (!validCulpritRoute(start, p.route)) return "금고실에 들르는 올바른 동선이 아니에요";
    if (!validForge(fullRoute(start, p.route), p.forge)) return "영상 조작이 올바르지 않아요";
    return null;
  }
  if (p.forge) return "손님은 영상을 조작할 수 없어요";
  if (!validGuestRoute(start, p.route, state.errands[seat] ?? [])) return "할 일을 모두 들르는 올바른 동선이 아니에요";
  return null;
}

/** 시간 안에 못 낸 좌석의 자동 계획 (모든 기기가 같은 결과를 내도록 시드에서 뽑는다) */
export function autoPlan(state: GameState, seat: Seat): Plan {
  const rng = mulberry32((state.seed ^ Math.imul(state.caseIndex * 31 + seat + 1, 0x85ebca6b)) >>> 0);
  if (seat === state.culprit) return culpritAutoPlan(state.starts[seat], rng, 0.5);
  return { route: guestAutoRoute(state.starts[seat], state.errands[seat] ?? [], rng), forge: null };
}

function resolveNight(state: GameState): GameState {
  const n = state.seatCount;
  const truth = state.plans.map((p, s) => fullRoute(state.starts[s], p!.route));
  const footage = truth.map((full, s) => footageOf(full, s === state.culprit ? state.plans[s]!.forge : null));
  const sight: Seat[][][] = truth.map((mine, s) =>
    mine.map((room, t) => {
      const seen: Seat[] = [];
      for (let x = 0; x < n; x++) if (x !== s && truth[x][t] === room) seen.push(x);
      return seen;
    }),
  );
  let next: GameState = {
    ...state,
    truth,
    footage,
    sight,
    phase: "watch",
    stage: state.stage + 1,
    ready: Array(n).fill(false),
    log: [...state.log, { kind: "night", caseIndex: state.caseIndex }],
  };
  let tally = next.tally;
  for (let s = 0; s < n; s++) {
    if (s === state.culprit) tally = addTally(tally, s, { culpritCases: 1 });
    else tally = addTally(tally, s, { guestCases: 1, witnessed: contradictionsOf(next, s).length > 0 ? 1 : 0 });
  }
  next = { ...next, tally };
  return next;
}

function doPlan(state: GameState, seat: Seat, plan: Plan, timeout: boolean): GameState {
  if (state.planned[seat]) return state;
  if (planError(state, seat, plan)) return state;
  const clean: Plan = { route: [...plan.route], forge: seat === state.culprit && plan.forge ? { from: plan.forge.from, rooms: [...plan.forge.rooms] } : null };
  const next: GameState = {
    ...state,
    plans: state.plans.map((p, i) => (i === seat ? clean : p)),
    planned: state.planned.map((p, i) => p || i === seat),
    idleStreak: bumpIdle(state, seat, timeout),
  };
  return next.planned.every((p) => p) ? resolveNight(next) : next;
}

function startInvestigation(state: GameState): GameState {
  return { ...state, phase: "investigate", stage: state.stage + 1, round: 1, turnIndex: 0, turn: state.firstSeat };
}

function startVote(state: GameState): GameState {
  const n = state.seatCount;
  return { ...state, phase: "vote", stage: state.stage + 1, votes: Array(n).fill(undefined), voteIn: Array(n).fill(false) };
}

function nextTurn(state: GameState): GameState {
  const idx = state.turnIndex + 1;
  if (idx >= state.seatCount * state.rounds) return startVote({ ...state, turnIndex: idx });
  return {
    ...state,
    turnIndex: idx,
    turn: (state.firstSeat + idx) % state.seatCount,
    round: Math.floor(idx / state.seatCount) + 1,
    stage: state.stage + 1,
  };
}

function doReady(state: GameState, seat: Seat): GameState {
  if (state.ready[seat]) return state;
  const next: GameState = { ...state, ready: state.ready.map((r, i) => r || i === seat) };
  if (!next.ready.every((r) => r)) return next;
  return state.phase === "watch" ? startInvestigation(next) : dealCase(next, state.caseIndex + 1);
}

function doCheck(state: GameState, seat: Seat, t: number, room: number): GameState {
  if (!Number.isInteger(t) || t < 1 || t > TICKS) return state;
  if (!Number.isInteger(room) || room < 0 || room >= ROOM_COUNT) return state;
  if (checkedCell(state, t, room)) return state;
  let truth = 0;
  for (let s = 0; s < state.seatCount; s++) if (state.truth[s][t] === room) truth++;
  const footage = footageCount(state, t, room);
  return nextTurn({
    ...state,
    idleStreak: bumpIdle(state, seat, false),
    tally: addTally(state.tally, seat, { checks: 1, hits: truth !== footage ? 1 : 0 }),
    log: [...state.log, { kind: "check", caseIndex: state.caseIndex, round: state.round, seat, t, room, truth, footage }],
  });
}

function doTestify(state: GameState, seat: Seat, target: Seat, t: number): GameState {
  if (state.testified[seat]) return state;
  if (!Number.isInteger(target) || target < 0 || target >= state.seatCount || target === seat) return state;
  if (!Number.isInteger(t) || t < 1 || t > TICKS) return state;
  // 손님은 실제로 어긋난 장면만 증언할 수 있다. 범인은 무엇이든 지어낼 수 있다.
  if (seat !== state.culprit && !contradictionsOf(state, seat).some((c) => c.target === target && c.t === t)) return state;
  const claim = claimKind(state, seat, target, t);
  return nextTurn({
    ...state,
    testified: state.testified.map((v, i) => v || i === seat),
    idleStreak: bumpIdle(state, seat, false),
    tally: addTally(state.tally, seat, { testimonies: 1 }),
    log: [...state.log, { kind: "testify", caseIndex: state.caseIndex, round: state.round, seat, target, t, room: state.footage[seat][t], claim }],
  });
}

function doPass(state: GameState, seat: Seat, timeout: boolean): GameState {
  return nextTurn({
    ...state,
    idleStreak: bumpIdle(state, seat, timeout),
    log: [...state.log, { kind: "pass", caseIndex: state.caseIndex, round: state.round, seat, timeout }],
  });
}

/** 범인이 다른 누구보다 표를 많이 받았나 (동률이면 도주) */
export function isCaught(votes: (Seat | null | undefined)[], culprit: Seat, seatCount: number): boolean {
  const count = Array(seatCount).fill(0);
  for (const v of votes) if (typeof v === "number" && v >= 0 && v < seatCount) count[v]++;
  return count[culprit] > 0 && count.every((c, s) => s === culprit || c < count[culprit]);
}

function resolveVote(state: GameState): GameState {
  const n = state.seatCount;
  const votes = state.votes.map((v) => (v === undefined ? null : v));
  const caught = isCaught(votes, state.culprit, n);
  const gains = Array(n).fill(0);
  let tally = state.tally;
  for (let s = 0; s < n; s++) {
    const right = votes[s] === state.culprit;
    if (s === state.culprit) {
      if (!caught) gains[s] += SCORE_ESCAPE;
      tally = addTally(tally, s, { escapes: caught ? 0 : 1, caughtAsCulprit: caught ? 1 : 0, votesAgainstAsCulprit: votes.filter((v) => v === s).length });
    } else {
      if (caught) gains[s] += SCORE_GUEST_CATCH;
      if (right) gains[s] += SCORE_VOTE_BONUS;
      tally = addTally(tally, s, { correctVotes: right ? 1 : 0, catches: caught ? 1 : 0, framedVotes: votes.filter((v) => v === s).length });
    }
  }
  const scores = state.scores.map((v, s) => v + gains[s]);
  const summary: CaseSummary = { culprit: state.culprit, caught, votes, gains };
  const next: GameState = {
    ...state,
    votes,
    scores,
    tally,
    cases: [...state.cases, summary],
    log: [...state.log, { kind: "verdict", caseIndex: state.caseIndex, culprit: state.culprit, caught, votes, gains }],
    stage: state.stage + 1,
  };
  if (state.caseIndex + 1 < state.totalCases) return { ...next, phase: "result", ready: Array(n).fill(false) };
  const top = Math.max(...scores);
  return { ...next, phase: "ended", outcome: { winners: scores.map((v, s) => (v === top ? s : -1)).filter((s) => s >= 0), scores } };
}

function doVote(state: GameState, seat: Seat, target: Seat | null, timeout: boolean): GameState {
  if (state.voteIn[seat]) return state;
  if (target !== null && (!Number.isInteger(target) || target < 0 || target >= state.seatCount || target === seat)) return state;
  const next: GameState = {
    ...state,
    votes: state.votes.map((v, i) => (i === seat ? target : v)),
    voteIn: state.voteIn.map((v, i) => v || i === seat),
    idleStreak: bumpIdle(state, seat, timeout),
  };
  return next.voteIn.every((v) => v) ? resolveVote(next) : next;
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  if (state.phase === "ended") return state;
  if (action.stage !== state.stage) return state;
  if (action.type === "TIMEOUT") {
    let s = state;
    if (state.phase === "night") {
      for (let seat = 0; seat < state.seatCount; seat++) if (!s.planned[seat] && s.phase === "night") s = doPlan(s, seat, autoPlan(s, seat), true);
      return s;
    }
    if (state.phase === "watch" || state.phase === "result") {
      for (let seat = 0; seat < state.seatCount; seat++) if (!s.ready[seat] && s.phase === state.phase && s.stage === state.stage) s = doReady(s, seat);
      return s;
    }
    if (state.phase === "investigate") return doPass(state, state.turn, true);
    if (state.phase === "vote") {
      for (let seat = 0; seat < state.seatCount; seat++) if (!s.voteIn[seat] && s.phase === "vote") s = doVote(s, seat, null, true);
      return s;
    }
    return state;
  }
  const seat = action.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seatCount) return state;
  switch (action.type) {
    case "PLAN":
      return state.phase === "night" ? doPlan(state, seat, action.plan, false) : state;
    case "READY":
      return state.phase === "watch" || state.phase === "result" ? doReady(state, seat) : state;
    case "VOTE":
      return state.phase === "vote" ? doVote(state, seat, action.target, false) : state;
  }
  if (state.phase !== "investigate" || seat !== state.turn) return state;
  switch (action.type) {
    case "CHECK":
      return doCheck(state, seat, action.t, action.room);
    case "TESTIFY":
      return doTestify(state, seat, action.target, action.t);
    case "PASS":
      return doPass(state, seat, false);
  }
  return state;
}

/** 지금 무언가 해야 하는 좌석들 */
export function pendingSeats(state: GameState): Seat[] {
  const all = Array.from({ length: state.seatCount }, (_, s) => s);
  if (state.phase === "night") return all.filter((s) => !state.planned[s]);
  if (state.phase === "watch" || state.phase === "result") return all.filter((s) => !state.ready[s]);
  if (state.phase === "investigate") return [state.turn];
  if (state.phase === "vote") return all.filter((s) => !state.voteIn[s]);
  return [];
}

export function stageDurationMs(state: GameState): number {
  switch (state.phase) {
    case "night":
      return state.options.planSeconds > 0 ? state.options.planSeconds * 1000 : 0;
    case "watch":
      return WATCH_MS;
    case "investigate":
      return state.options.turnSeconds > 0 ? state.options.turnSeconds * 1000 : 0;
    case "vote":
      return VOTE_MS;
    case "result":
      return RESULT_MS;
    default:
      return 0;
  }
}

// ------------------------------------------------------------------ 보기 (숨김 정보 거르기)

/** 이번 사건의 답이 공개된 단계인가 */
export function revealed(state: Pick<GameState, "phase">): boolean {
  return state.phase === "result" || state.phase === "ended";
}

/**
 * `seat`가 볼 수 있는 상태 — 모양은 같고 비밀만 지운다.
 * - 범인 좌석: 내가 범인일 때만 (결과 단계부터 공개)
 * - 실제 동선·계획·할 일·내가 본 사람: 내 것만 (결과 단계부터 공개)
 * - 표: 공개 전엔 내 것만
 * - 시드·다음 사건 범인 순서: 언제나 지움
 */
export function cctvView(state: GameState, seat: Seat): GameState {
  const me = seat >= 0 && seat < state.seatCount ? seat : -1;
  if (revealed(state)) return { ...state, seed: 0, viewer: me, culpritOrder: [] };
  return {
    ...state,
    seed: 0,
    viewer: me,
    culpritOrder: [],
    culprit: me >= 0 && me === state.culprit ? me : -1,
    errands: state.errands.map((e, i) => (i === me ? e : [])),
    plans: state.plans.map((p, i) => (i === me ? p : null)),
    truth: state.truth.map((r, i) => (i === me ? r : [])),
    sight: state.sight.map((r, i) => (i === me ? r : [])),
    votes: state.votes.map((v, i) => (i === me ? v : undefined)),
  };
}

// ------------------------------------------------------------------ 결과

export interface Ranking {
  seat: Seat;
  rank: number;
}

/** 총점 순위 (동점은 같은 순위) */
export function computeRankings(state: GameState): Ranking[] {
  const sorted = [...new Set(state.scores)].sort((a, b) => b - a);
  return state.scores.map((v, seat) => ({ seat, rank: sorted.indexOf(v) + 1 }));
}

export function rankOf(state: GameState, seat: Seat): number {
  return computeRankings(state).find((r) => r.seat === seat)?.rank ?? state.seatCount;
}

export function winnerSeats(state: GameState): Seat[] {
  return state.outcome?.winners ?? [];
}

/** 범인의 조작 구간 (공개된 뒤에만 의미가 있다) */
export function forgeOf(state: GameState): Forge | null {
  return state.culprit >= 0 ? (state.plans[state.culprit]?.forge ?? null) : null;
}
