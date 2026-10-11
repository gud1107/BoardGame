/**
 * 갓생 플래너 엔진 — boardGameRule/갓생플래너/갓생플래너.md 구현.
 *
 * 락스텝: 방장이 시드+옵션을 보내면 모든 기기가 `startGame`으로 7일치 이벤트·기회 카드·
 * 유혹 카드·인생 목표 후보·주간 도전을 똑같이 미리 계산한다. 이후에는 `EngineAction`만
 * 주고받는다. 리듀서 안에서는 Math.random을 쓰지 않는다.
 *
 * 계획은 커밋-공개(§22.3): 계획 단계에서 해시만(`COMMIT_PLAN`) 보내고, 전원이 커밋하면
 * 각자 원문(`REVEAL_PLAN`)을 보낸다. 해시가 안 맞거나 시간 안에 공개하지 못하면 기본 계획.
 * 제출 순서와 무관하게 결과가 같다 — currentTurn 같은 건 없다.
 */

import { seededRng, shuffle } from "@/lib/rng";
import {
  BLOCK_COUNT,
  CHALLENGES,
  GOAL_BY_ID,
  LIFE_GOALS,
  NIGHT_BLOCKS,
  OFFICE_BLOCKS,
  OPPORTUNITIES,
  OPPORTUNITY_BY_ID,
  TEMPTATIONS,
  TEMPTATION_DECK,
  TRACKS,
  TUNING,
  WEEKDAY_EVENT_DECK,
  opportunitiesPerDay,
  type Activity,
  type EventId,
  type OpportunityCard,
  type TemptationCard,
  type Track,
} from "./data";

export type Seat = number;
export type Cell = Activity | "temptation";
export type Tracks = Record<Track, number>;

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;

export interface GameOptions {
  /** 7 = 월~일, 5 = 짧은 게임(월~금, 인생 목표 수치 −4) */
  days: 5 | 7;
  /** 계획 제한 시간(초). 엔진은 쓰지 않고 방 전체가 같은 값을 보게 하려고 여기 둔다. */
  planSeconds: number;
  /** 하드: 저항 비용 2, 수면 부족 기준 3블록 */
  hard: boolean;
  /** 비교 지옥: 마감 때 그날 성장 1등 멘탈 +1, 꼴찌 −1 */
  sns: boolean;
  /** 쉬운 습관: 2일 연속이면 형성 */
  easyHabit: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { days: 7, planSeconds: 90, hard: false, sns: false, easyHabit: false };

/** 클라이언트가 보내는 계획 원문 */
export interface Plan {
  cells: Cell[];
  temptation: "resist" | "yield";
  opportunityId: string | null;
}

/** 엔진이 검증·보정한 계획 */
export interface ResolvedPlan {
  cells: Cell[];
  temptation: "resist" | "yield";
  /** 굴복했지만 블록을 차지하지 않는 경우(즉시형 카드, 놓을 자리 없음) */
  instant: boolean;
  opportunityId: string | null;
  auto: boolean;
}

export interface Habit {
  block: number;
  activity: Activity;
  shaken: boolean;
}

export type OutcomeKind = "ok" | "fail" | "void" | "nap" | "temptation" | "empty";

export interface BlockOutcome {
  cell: Cell;
  kind: OutcomeKind;
  hp: number;
  mp: number;
  gains: Partial<Tracks>;
  matched?: boolean;
  noShow?: boolean;
  opp?: string;
  overtime?: boolean;
}

export interface DayRecord {
  plan: ResolvedPlan;
  temptationId: string;
  outcomes: BlockOutcome[];
  startHp: number;
  startMp: number;
  endHp: number;
  endMp: number;
  growth: number;
  exhausted: boolean;
  burnout: boolean;
  nightSleep: number;
  notes: string[];
}

export interface SeatState {
  hp: number;
  mp: number;
  tracks: Tracks;
  habits: Habit[];
  streak: { activity: Activity | null; count: number }[];
  goalPick: 0 | 1 | null;
  /** 오늘 적용 중인 상태 */
  sick: boolean;
  apathy: boolean;
  /** 다음 날 아침에 적용할 것 */
  pendingSick: boolean;
  pendingApathy: boolean;
  hangover: boolean;
  emergencyHp: boolean;
  emergencyMp: boolean;
  collapses: number;
  resists: number;
  matches: number;
  oppWins: number;
  overtimeWorks: number;
  morningDays: number;
  morningStudyExDays: number;
  habitsFormed: number;
  challengePoints: number;
  days: DayRecord[];
}

export type Phase = "goalDraft" | "planning" | "revealing" | "dayResult" | "ended";

export interface GameState {
  seatCount: number;
  seed: number;
  options: GameOptions;
  phase: Phase;
  /** 단계가 바뀔 때마다 +1 — 늦게 온 TIMEOUT을 거르는 기준 */
  stage: number;
  day: number;
  events: EventId[];
  markets: string[][];
  temptations: string[][];
  friendBlocks: (number | null)[];
  challenges: string[];
  goalOptions: string[][];
  seats: SeatState[];
  commits: (string | null)[];
  plans: (ResolvedPlan | null)[];
  ready: boolean[];
  idleStreak: number[];
  challengeAwards: Record<string, { first: Seat[]; second: Seat[] }>;
}

export type EngineAction =
  | { type: "CHOOSE_GOAL"; seat: Seat; pick: 0 | 1 }
  | { type: "COMMIT_PLAN"; seat: Seat; day: number; hash: string }
  | { type: "REVEAL_PLAN"; seat: Seat; day: number; plan: Plan; salt: string }
  | { type: "READY"; seat: Seat }
  | { type: "TIMEOUT"; stage: number };

// ---------------------------------------------------------------------------
// 해시 (커밋-공개용, cyrb53)

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function planHash(plan: Plan, salt: string): string {
  const body = JSON.stringify({ c: plan.cells, t: plan.temptation, o: plan.opportunityId });
  return `${cyrb53(body + "|" + salt, 7)}${cyrb53(salt + "|" + body, 13)}`;
}

// ---------------------------------------------------------------------------
// 시작

function emptyTracks(): Tracks {
  return { knowledge: 0, body: 0, wealth: 0, social: 0 };
}

function newSeat(): SeatState {
  return {
    hp: TUNING.gaugeStart,
    mp: TUNING.gaugeStart,
    tracks: emptyTracks(),
    habits: [],
    streak: Array.from({ length: BLOCK_COUNT }, () => ({ activity: null, count: 0 })),
    goalPick: null,
    sick: false,
    apathy: false,
    pendingSick: false,
    pendingApathy: false,
    hangover: false,
    emergencyHp: false,
    emergencyMp: false,
    collapses: 0,
    resists: 0,
    matches: 0,
    oppWins: 0,
    overtimeWorks: 0,
    morningDays: 0,
    morningStudyExDays: 0,
    habitsFormed: 0,
    challengePoints: 0,
    days: [],
  };
}

/** 덱에서 n장씩 뽑고, 모자라면 지금 손에 든 것 빼고 다시 섞는다. */
function dealRounds<T>(all: readonly T[], rounds: number, perRound: number, rng: () => number): T[][] {
  let deck = shuffle([...all], rng);
  const out: T[][] = [];
  for (let r = 0; r < rounds; r++) {
    const hand: T[] = [];
    for (let i = 0; i < perRound; i++) {
      if (deck.length === 0) {
        // 이번 라운드에 이미 나온 카드만큼 빼고 전체를 다시 섞는다(같은 장수 카드가 여러 장인 덱도 처리).
        const pool = [...all];
        for (const h of hand) pool.splice(pool.indexOf(h), 1);
        deck = shuffle(pool, rng);
      }
      hand.push(deck.pop()!);
    }
    out.push(hand);
  }
  return out;
}

export function startGame(seatCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(seatCount)));
  const rng = seededRng(seed);
  const weekday = shuffle([...WEEKDAY_EVENT_DECK], rng).slice(0, 5);
  const events: EventId[] = options.days === 7 ? [...weekday, "SAT", "SUN"] : weekday;
  const days = events.length;
  const markets = dealRounds(
    OPPORTUNITIES.map((o) => o.id),
    days,
    opportunitiesPerDay(count),
    rng,
  );
  const temptations = dealRounds(TEMPTATION_DECK, days, count, rng);
  const friendBlocks = Array.from({ length: days }, () => (count <= 3 ? 2 + Math.floor(rng() * 6) : null));
  const challenges = shuffle(CHALLENGES.map((c) => c.id), rng).slice(0, 3);
  const goals = shuffle(LIFE_GOALS.map((g) => g.id), rng);
  const goalOptions = Array.from({ length: count }, (_, s) => [goals[(2 * s) % goals.length], goals[(2 * s + 1) % goals.length]]);
  return {
    seatCount: count,
    seed,
    options,
    phase: "goalDraft",
    stage: 0,
    day: 0,
    events,
    markets,
    temptations,
    friendBlocks,
    challenges,
    goalOptions,
    seats: Array.from({ length: count }, newSeat),
    commits: Array(count).fill(null),
    plans: Array(count).fill(null),
    ready: Array(count).fill(false),
    idleStreak: Array(count).fill(0),
    challengeAwards: Object.fromEntries(challenges.map((c) => [c, { first: [], second: [] }])),
  };
}

// ---------------------------------------------------------------------------
// 규칙 도우미 (UI·봇도 같이 쓴다)

export function totalDays(state: GameState): number {
  return state.events.length;
}

export function todayEvent(state: GameState): EventId {
  return state.events[state.day];
}

export function isWeekend(state: GameState, day = state.day): boolean {
  const e = state.events[day];
  return e === "SAT" || e === "SUN";
}

export function goalIdOf(state: GameState, seat: Seat): string | null {
  const pick = state.seats[seat].goalPick;
  return pick === null ? null : state.goalOptions[seat][pick];
}

export function temptationOf(state: GameState, seat: Seat, day = state.day): TemptationCard {
  return TEMPTATIONS[state.temptations[day][seat]];
}

export function resistCost(state: GameState): number {
  return (state.options.hard ? 2 : 1) + (todayEvent(state) === "E10" ? 1 : 0);
}

/** 저항 가능 여부 — 저항 비용으로 멘탈이 0이 되면 안 된다(§14.2). */
export function canResist(state: GameState, seat: Seat): boolean {
  const s = state.seats[seat];
  return !s.apathy && s.mp > resistCost(state);
}

export function forcedBlocks(state: GameState, seat: Seat): Map<number, Activity> {
  const m = new Map<number, Activity>();
  if (todayEvent(state) === "E7" && !state.seats[seat].apathy) m.set(6, "work");
  return m;
}

export function bannedActivities(state: GameState, seat: Seat): Set<Activity> {
  const s = state.seats[seat];
  const banned = new Set<Activity>();
  if (s.sick) banned.add("exercise");
  if (s.apathy) {
    banned.add("study");
    banned.add("work");
  }
  return banned;
}

/** 굴복 시 유혹 카드를 놓을 수 있는 블록 묶음들. 빈 배열이면 놓을 곳이 없다(즉시형처럼 처리). */
export function temptationPlacements(state: GameState, seat: Seat): number[][] {
  const card = temptationOf(state, seat);
  if (card.kind === "instant") return [];
  const forced = forcedBlocks(state, seat);
  if (card.fixedBlocks) {
    const blocks = card.fixedBlocks.filter((b) => !forced.has(b));
    return blocks.length > 0 ? [blocks] : [];
  }
  const starts = card.allowed ?? Array.from({ length: BLOCK_COUNT }, (_, b) => b);
  const out: number[][] = [];
  for (const b of starts) {
    const blocks = card.span === 2 ? [b, b + 1] : [b];
    if (blocks.some((x) => x >= BLOCK_COUNT || forced.has(x))) continue;
    out.push(blocks);
  }
  return out;
}

function sameBlocks(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 클라이언트 계획을 규칙에 맞게 보정한다 — 거부하지 않고 고쳐서 동기화가 멈추지 않게 한다(§22.5). */
export function sanitizePlan(state: GameState, seat: Seat, raw: Plan | null, auto = false): ResolvedPlan {
  const banned = bannedActivities(state, seat);
  const forced = forcedBlocks(state, seat);
  const validCells = new Set<string>(["sleep", "study", "exercise", "work", "meet", "rest", "empty", "temptation"]);
  const cells: Cell[] = Array.from({ length: BLOCK_COUNT }, (_, b) => {
    const c = raw?.cells?.[b];
    if (typeof c !== "string" || !validCells.has(c)) return "empty";
    if (c !== "temptation" && banned.has(c)) return "empty";
    return c;
  });
  for (const [b, act] of forced) cells[b] = act;

  const card = temptationOf(state, seat);
  const wantsResist = raw?.temptation === "resist";
  const temptation: "resist" | "yield" = wantsResist && canResist(state, seat) ? "resist" : "yield";
  let instant = false;
  const strip = () => {
    for (let b = 0; b < BLOCK_COUNT; b++) if (cells[b] === "temptation") cells[b] = "empty";
  };
  if (temptation === "resist") {
    strip();
  } else if (card.kind === "instant") {
    strip();
    instant = true;
  } else {
    const placed = cells.map((c, b) => (c === "temptation" ? b : -1)).filter((b) => b >= 0);
    const placements = temptationPlacements(state, seat);
    const sleepingInB3 = card.id === "T4" && placed.length === 0 && cells[2] === "sleep";
    if (sleepingInB3) {
      // 늦잠인데 B3에 이미 수면 — 그대로 수면(§14.4).
    } else if (placements.some((p) => sameBlocks(p, placed))) {
      // 정상 배치
    } else if (placements.length > 0) {
      strip();
      for (const b of placements[0]) cells[b] = "temptation";
    } else {
      strip();
      instant = true;
    }
  }
  const market = state.markets[state.day];
  const opportunityId = raw?.opportunityId && market.includes(raw.opportunityId) ? raw.opportunityId : null;
  return { cells, temptation, instant, opportunityId, auto };
}

/** 시간 안에 계획을 못 낸 자리의 기본 계획(§19 이탈 규칙과 같은 틀). */
export function defaultPlan(state: GameState, seat: Seat): ResolvedPlan {
  const cells: Cell[] = ["sleep", "sleep", "rest", "work", "study", "work", "rest", "sleep"];
  return sanitizePlan(state, seat, { cells, temptation: "resist", opportunityId: null }, true);
}

// ---------------------------------------------------------------------------
// 블록 효과 계산 (§5, §6, §11.3, §15)

export interface ActivityEffect {
  hpCost: number;
  mpCost: number;
  hpGain: number;
  mpGain: number;
  gains: Partial<Tracks>;
  overtime: boolean;
}

export function habitAt(seat: SeatState, block: number): Habit | undefined {
  return seat.habits.find((h) => h.block === block);
}

export function activityEffect(state: GameState, seat: SeatState, act: Activity, b: number): ActivityEffect {
  const ev = todayEvent(state);
  const weekend = isWeekend(state);
  let hpCost = 0;
  let mpCost = 0;
  let hpGain = 0;
  let mpGain = 0;
  const g: Partial<Tracks> = {};
  const add = (t: Track, n: number) => {
    g[t] = (g[t] ?? 0) + n;
  };
  const night = NIGHT_BLOCKS.includes(b);
  let overtime = false;
  switch (act) {
    case "sleep":
      hpGain = night ? 2 : 1;
      if (night && ev === "E8") mpGain += 1;
      break;
    case "study":
      hpCost = 1;
      mpCost = 1;
      add("knowledge", 2);
      break;
    case "exercise":
      hpCost = 2;
      add("body", 2);
      break;
    case "work":
      hpCost = 1;
      mpCost = 1;
      add("wealth", 2);
      break;
    case "meet":
      hpCost = 1;
      add("social", 1);
      break;
    case "rest":
      mpGain = 2;
      break;
    case "empty":
      break;
  }
  // 시간대
  if ((b === 0 || b === 1) && (act === "study" || act === "exercise" || act === "work")) hpCost += 1;
  if (b === 2 && act === "study") add("knowledge", 1);
  if (b === 2 && act === "exercise" && ev !== "E2") add("body", 1);
  if (b === 6 && act === "exercise" && ev !== "E2") add("body", 1);
  if (b === 6 && act === "meet") add("social", 1);
  if (act === "work" && (weekend || !OFFICE_BLOCKS.includes(b))) {
    overtime = true;
    mpCost += 1;
    add("wealth", 1);
  }
  // 이벤트
  if (ev === "E1" && (act === "study" || act === "work")) mpCost += 1;
  if (ev === "E2" && act === "rest") mpGain += 1;
  if (ev === "E3" && act === "exercise") add("body", 1);
  if (ev === "E4" && act === "work") add("wealth", 1);
  if (ev === "E5" && act === "study") add("knowledge", 1);
  if (ev === "E5" && act === "meet") add("social", -1);
  if (weekend && act === "meet") add("social", 1);
  if (ev === "SUN" && act === "rest") mpGain += 1;
  // 습관
  const habit = habitAt(seat, b);
  if (habit && habit.activity === act) {
    if (act === "study") {
      mpCost -= 1;
      add("knowledge", 1);
    } else if (act === "work") {
      mpCost -= 1;
      add("wealth", 1);
    } else if (act === "exercise") {
      hpCost -= 1;
      add("body", 1);
    } else if (act === "meet") {
      hpCost -= 1;
      add("social", 1);
    } else if (act === "sleep") {
      hpGain += 1;
    } else if (act === "rest") {
      mpGain += 1;
    }
  }
  // 상태
  if (seat.sick && act === "study") add("knowledge", -1);
  if (seat.sick && act === "work") add("wealth", -1);
  for (const t of TRACKS) if (g[t] !== undefined && g[t]! < 0) g[t] = 0;
  return { hpCost: Math.max(0, hpCost), mpCost: Math.max(0, mpCost), hpGain, mpGain, gains: g, overtime };
}

// ---------------------------------------------------------------------------
// 하루 실행 (§8 ④⑤, §9, §10, §11, §12, §13)

const clampGauge = (n: number) => Math.max(0, Math.min(TUNING.gaugeMax, n));
const clampTrack = (n: number) => Math.max(0, Math.min(TUNING.trackMax, n));

function addTracks(tracks: Tracks, gains: Partial<Tracks>): Partial<Tracks> {
  const applied: Partial<Tracks> = {};
  for (const t of TRACKS) {
    const n = gains[t];
    if (!n) continue;
    const before = tracks[t];
    tracks[t] = clampTrack(before + n);
    if (tracks[t] !== before) applied[t] = tracks[t] - before;
  }
  return applied;
}

function trackSum(t: Tracks): number {
  return t.knowledge + t.body + t.wealth + t.social;
}

function cloneSeat(s: SeatState): SeatState {
  return {
    ...s,
    tracks: { ...s.tracks },
    habits: s.habits.map((h) => ({ ...h })),
    streak: s.streak.map((x) => ({ ...x })),
    days: s.days, // 새 날 기록만 push하므로 배열은 아래에서 복사
  };
}

interface Working {
  seat: SeatState;
  plan: ResolvedPlan;
  outcomes: BlockOutcome[];
  exhausted: boolean;
  burnout: boolean;
  nightSleep: number;
  growth: number;
  workDone: boolean;
  meetDone: boolean;
  temptationDone: boolean;
  startHp: number;
  startMp: number;
  notes: string[];
}

function growthOf(applied: Partial<Tracks>): number {
  let n = 0;
  for (const t of TRACKS) n += Math.max(0, applied[t] ?? 0);
  return n;
}

/**
 * 하루를 실행한다. `plans[seat] === null`인 자리는 건너뛴다 — 봇·UI의 "나 혼자 했을 때"
 * 미리보기(`previewDay`)도 같은 함수를 쓴다.
 */
export function simulateDay(state: GameState, plans: readonly (ResolvedPlan | null)[]): { seats: SeatState[]; awards: GameState["challengeAwards"] } {
  const ev = todayEvent(state);
  const friendBlock = state.friendBlocks[state.day];
  const first = state.day % state.seatCount;
  const order = Array.from({ length: state.seatCount }, (_, i) => (first + i) % state.seatCount);
  const work: (Working | null)[] = state.seats.map((orig, i) => {
    const plan = plans[i];
    if (!plan) return null;
    const seat = cloneSeat(orig);
    return {
      seat,
      plan,
      outcomes: [],
      exhausted: false,
      burnout: false,
      nightSleep: 0,
      growth: 0,
      workDone: false,
      meetDone: false,
      temptationDone: false,
      startHp: seat.hp,
      startMp: seat.mp,
      notes: [],
    };
  });

  const card = (i: number) => temptationOf(state, i);

  // 실행 시작: 저항 비용, 즉시형 유혹
  work.forEach((w, i) => {
    if (!w) return;
    if (w.plan.temptation === "resist") {
      w.seat.mp = clampGauge(w.seat.mp - resistCost(state));
      w.seat.resists += 1;
      w.notes.push(`🛡️ ${card(i).name} 유혹을 참았어요`);
    } else if (w.plan.instant) {
      const eff = card(i).effect;
      w.seat.hp = clampGauge(w.seat.hp + (eff.hp ?? 0));
      w.seat.mp = clampGauge(w.seat.mp + (eff.mp ?? 0));
      w.growth += growthOf(addTracks(w.seat.tracks, eff.tracks ?? {}));
      w.temptationDone = true;
      w.notes.push(`${card(i).emoji} ${card(i).name}에 넘어갔어요`);
    }
  });

  const checkCollapse = (w: Working, when: string) => {
    if (w.seat.hp === 0 && !w.exhausted) {
      w.exhausted = true;
      w.seat.collapses += 1;
      w.notes.push(`🥵 ${when} 탈진!`);
    }
    if (w.seat.mp === 0 && !w.burnout) {
      w.burnout = true;
      w.seat.collapses += 1;
      w.notes.push(`😵 ${when} 번아웃!`);
    }
  };

  for (let b = 0; b < BLOCK_COUNT; b++) {
    // 1) 각자 블록 처리
    work.forEach((w, i) => {
      if (!w) return;
      const s = w.seat;
      const cell = w.plan.cells[b];
      let kind: OutcomeKind = "empty";
      let gains: Partial<Tracks> = {};
      let noShow = false;
      let overtime = false;
      const runActivity = (act: Activity) => {
        const eff = activityEffect(state, s, act, b);
        if (eff.hpCost > s.hp || eff.mpCost > s.mp) {
          if (eff.hpCost > s.hp) s.hp = 0;
          if (eff.mpCost > s.mp) s.mp = 0;
          kind = "fail";
          if (act === "meet") {
            noShow = true;
            gains = addTracks(s.tracks, { social: -1 });
          }
          return;
        }
        s.hp = clampGauge(s.hp - eff.hpCost + eff.hpGain);
        s.mp = clampGauge(s.mp - eff.mpCost + eff.mpGain);
        gains = addTracks(s.tracks, eff.gains);
        kind = "ok";
        overtime = eff.overtime;
        if (act === "sleep" && NIGHT_BLOCKS.includes(b)) w.nightSleep += 1;
        if (act === "work") {
          w.workDone = true;
          if (eff.overtime) s.overtimeWorks += 1;
        }
        if (act === "meet") w.meetDone = true;
      };
      if (w.exhausted) {
        if (cell === "sleep") runActivity("sleep");
        else {
          kind = "nap";
          s.hp = clampGauge(s.hp + 1);
          if (cell === "meet") {
            noShow = true;
            gains = addTracks(s.tracks, { social: -1 });
          }
        }
      } else if (w.burnout) {
        if (cell === "sleep" || cell === "rest") runActivity(cell);
        else if (cell !== "empty") {
          kind = "void";
          if (cell === "meet") {
            noShow = true;
            gains = addTracks(s.tracks, { social: -1 });
          }
        }
      } else if (cell === "temptation") {
        kind = "temptation";
        const c = card(i);
        const firstBlock = w.plan.cells.indexOf("temptation") === b;
        if (firstBlock) {
          s.hp = clampGauge(s.hp + (c.effect.hp ?? 0));
          s.mp = clampGauge(s.mp + (c.effect.mp ?? 0));
          gains = addTracks(s.tracks, c.effect.tracks ?? {});
          w.temptationDone = true;
          w.notes.push(`${c.emoji} ${c.name}에 넘어갔어요`);
        }
      } else if (cell !== "empty") {
        runActivity(cell);
      }
      // T4 늦잠 + B3 수면: 블록은 수면 그대로, 굴복 처리만
      if (b === 2 && cell === "sleep" && w.plan.temptation === "yield" && !w.plan.instant && card(i).id === "T4" && !w.plan.cells.includes("temptation")) {
        w.temptationDone = true;
      }
      if (noShow) w.notes.push(`🙇 ${b + 1}번째 블록 약속 펑크(관계 −1)`);
      w.growth += growthOf(gains);
      w.outcomes.push({ cell, kind, hp: s.hp, mp: s.mp, gains, ...(noShow ? { noShow } : {}), ...(overtime ? { overtime } : {}) });
    });

    // 2) 약속 성사 (§12)
    const meeters = work.map((w, i) => (w && w.outcomes[b].kind === "ok" && w.plan.cells[b] === "meet" ? i : -1)).filter((i) => i >= 0);
    const people = meeters.length + (friendBlock === b ? 1 : 0);
    const partyNight = ev === "E6" && (b === 6 || b === 7);
    if (meeters.length > 0 && (people >= 2 || partyNight)) {
      for (const i of meeters) {
        const w = work[i]!;
        w.seat.mp = clampGauge(w.seat.mp + 1);
        const applied = addTracks(w.seat.tracks, { social: 1 + (ev === "E9" ? 2 : 0) });
        w.growth += growthOf(applied);
        const o = w.outcomes[b];
        o.matched = true;
        o.mp = w.seat.mp;
        for (const t of TRACKS) if (applied[t]) o.gains[t] = (o.gains[t] ?? 0) + applied[t]!;
        w.seat.matches += 1;
      }
    }

    // 3) 기회 카드 (§13)
    for (const oppId of state.markets[state.day]) {
      const opp: OpportunityCard = OPPORTUNITY_BY_ID[oppId];
      const candidates = order.filter((i) => {
        const w = work[i];
        if (!w || w.plan.opportunityId !== oppId) return false;
        const at = opp.block ?? w.plan.cells.indexOf(opp.activity);
        if (at !== b) return false;
        return w.plan.cells[b] === opp.activity && w.outcomes[b].kind === "ok";
      });
      if (candidates.length === 0) continue;
      const already = work.filter((w) => w && w.outcomes.some((o) => o.opp === oppId)).length;
      const friendCounts = friendBlock === b ? 1 : 0;
      if (opp.minPeople && candidates.length + already + friendCounts < opp.minPeople) continue;
      const ranked = [...candidates].sort((x, y) => {
        const a = work[x]!.seat;
        const c = work[y]!.seat;
        const d1 = trackSum(a.tracks) - trackSum(c.tracks);
        if (d1 !== 0) return d1;
        const d2 = c.mp - a.mp;
        if (d2 !== 0) return d2;
        return order.indexOf(x) - order.indexOf(y);
      });
      let room = opp.capacity - already;
      for (const i of ranked) {
        if (room <= 0) break;
        const w = work[i]!;
        const cost = opp.cost ?? 0;
        if (w.seat.tracks.wealth < cost) continue;
        if (cost) w.seat.tracks.wealth -= cost;
        w.seat.hp = clampGauge(w.seat.hp + (opp.reward.hp ?? 0));
        w.seat.mp = clampGauge(w.seat.mp + (opp.reward.mp ?? 0));
        const applied = addTracks(w.seat.tracks, opp.reward.tracks ?? {});
        w.growth += growthOf(applied);
        const o = w.outcomes[b];
        o.opp = oppId;
        o.hp = w.seat.hp;
        o.mp = w.seat.mp;
        for (const t of TRACKS) if (applied[t]) o.gains[t] = (o.gains[t] ?? 0) + applied[t]!;
        if (cost) o.gains.wealth = (o.gains.wealth ?? 0) - cost;
        w.seat.oppWins += 1;
        w.notes.push(`${opp.emoji} 기회 카드 「${opp.name}」 획득!`);
        room -= 1;
      }
    }

    // 4) 붕괴 판정
    for (const w of work) if (w) checkCollapse(w, `${b + 1}번째 블록에서`);
  }

  // ---- 마감 (§8 ⑤)
  const habitDays = state.options.easyHabit ? 2 : 3;
  const sleepNeed = state.options.hard ? 3 : 2;
  work.forEach((w, i) => {
    if (!w) return;
    const s = w.seat;
    if (w.nightSleep < sleepNeed) {
      s.hp = clampGauge(s.hp - 2);
      s.mp = clampGauge(s.mp - 1);
      w.notes.push(`🥱 수면 부족(밤잠 ${w.nightSleep}블록) 체력 −2, 멘탈 −1`);
    }
    const c = card(i);
    if (w.temptationDone && c.dayEndHp) {
      s.hp = clampGauge(s.hp + c.dayEndHp);
      w.notes.push(`${c.emoji} 야식 여운: 체력 ${c.dayEndHp}`);
    }
    if (ev === "E4" && !w.workDone) {
      s.mp = clampGauge(s.mp - 1);
      w.notes.push("⏰ 마감을 못 지켜 멘탈 −1");
    }
    if (ev === "E9" && !w.meetDone) {
      addTracks(s.tracks, { social: -1 });
      w.notes.push("🎂 친구 생일을 놓쳐 관계 −1");
    }
  });
  if (state.options.sns) {
    const active = work.filter((w): w is Working => w !== null);
    if (active.length > 1) {
      const max = Math.max(...active.map((w) => w.growth));
      const min = Math.min(...active.map((w) => w.growth));
      for (const w of active) {
        if (w.growth === max) {
          w.seat.mp = clampGauge(w.seat.mp + 1);
          w.notes.push("📸 오늘의 갓생 1등! 멘탈 +1");
        }
        if (w.growth === min) {
          w.seat.mp = clampGauge(w.seat.mp - 1);
          w.notes.push("📉 남과 비교돼서 멘탈 −1");
        }
      }
    }
  }
  for (const w of work) if (w) checkCollapse(w, "마감 때");

  // 습관 (§11)
  for (const w of work) {
    if (!w) continue;
    const s = w.seat;
    const done: (Activity | null)[] = w.outcomes.map((o) => (o.kind === "ok" && o.cell !== "temptation" && o.cell !== "empty" ? (o.cell as Activity) : null));
    const kept: Habit[] = [];
    for (const h of s.habits) {
      if (done[h.block] === h.activity) {
        if (h.shaken) w.notes.push(`🔁 ${h.block + 1}번째 블록 습관 회복`);
        kept.push({ ...h, shaken: false });
      } else if (h.shaken) {
        w.notes.push(`💔 ${h.block + 1}번째 블록 습관을 잃었어요`);
      } else {
        kept.push({ ...h, shaken: true });
        w.notes.push(`⚠️ ${h.block + 1}번째 블록 습관이 흔들려요`);
      }
    }
    s.habits = kept;
    for (let b = 0; b < BLOCK_COUNT; b++) {
      const a = done[b];
      const st = s.streak[b];
      s.streak[b] = a && st.activity === a ? { activity: a, count: st.count + 1 } : { activity: a, count: a ? 1 : 0 };
      if (!a || s.streak[b].count < habitDays || habitAt(s, b)) continue;
      if (s.habits.length >= TUNING.habitMax) {
        const shakenIdx = s.habits.findIndex((h) => h.shaken);
        if (shakenIdx < 0) continue;
        s.habits.splice(shakenIdx, 1);
      }
      s.habits.push({ block: b, activity: a, shaken: false });
      s.habitsFormed += 1;
      w.notes.push(`🌱 ${b + 1}번째 블록 습관 형성!`);
    }
    // 집계
    const b2 = w.outcomes[1];
    if (b2.kind === "ok" && b2.cell !== "sleep") s.morningDays += 1;
    const b3 = w.outcomes[2];
    if (b3.kind === "ok" && b3.cell === "study") s.morningStudyExDays += 1;
  }

  // 주간 도전 (§16.2)
  const awards: GameState["challengeAwards"] = Object.fromEntries(Object.entries(state.challengeAwards).map(([k, v]) => [k, { first: [...v.first], second: [...v.second] }]));
  for (const cid of state.challenges) {
    const aw = awards[cid];
    const done = new Set([...aw.first, ...aw.second]);
    const achievers = work
      .map((w, i) => (w && !done.has(i) && challengeMet(cid, w.seat, w.growth, w.nightSleep) ? i : -1))
      .filter((i) => i >= 0);
    if (achievers.length === 0) continue;
    if (state.seatCount === 1) {
      const pts = state.day <= 3 ? TUNING.challengeFirst : TUNING.challengeSecond;
      for (const i of achievers) {
        (pts === TUNING.challengeFirst ? aw.first : aw.second).push(i);
        work[i]!.seat.challengePoints += pts;
        work[i]!.notes.push(`🏁 주간 도전 달성 +${pts}`);
      }
    } else if (aw.first.length === 0) {
      const pts = state.seatCount === 2 ? TUNING.challengeTwoPlayer : TUNING.challengeFirst;
      for (const i of achievers) {
        aw.first.push(i);
        work[i]!.seat.challengePoints += pts;
        work[i]!.notes.push(`🏁 주간 도전 1등 달성 +${pts}`);
      }
    } else if (aw.second.length === 0 && state.seatCount > 2) {
      for (const i of achievers) {
        aw.second.push(i);
        work[i]!.seat.challengePoints += TUNING.challengeSecond;
        work[i]!.notes.push(`🏁 주간 도전 2등 달성 +${TUNING.challengeSecond}`);
      }
    }
  }

  // 다음 날 상태 · 기록
  const seats = state.seats.map((orig, i) => {
    const w = work[i];
    if (!w) return orig;
    const s = w.seat;
    s.pendingSick = w.exhausted || (ev === "E12" && s.hp <= 4);
    s.pendingApathy = w.burnout;
    s.emergencyHp = w.exhausted;
    s.emergencyMp = w.burnout;
    s.hangover = w.temptationDone && !!card(i).nextMorningHp;
    if (ev === "E12" && !w.exhausted && s.hp <= 4) w.notes.push("🤧 감기 기운 — 내일 몸살");
    s.days = [
      ...orig.days,
      {
        plan: w.plan,
        temptationId: card(i).id,
        outcomes: w.outcomes,
        startHp: w.startHp,
        startMp: w.startMp,
        endHp: s.hp,
        endMp: s.mp,
        growth: w.growth,
        exhausted: w.exhausted,
        burnout: w.burnout,
        nightSleep: w.nightSleep,
        notes: w.notes,
      },
    ];
    return s;
  });
  return { seats, awards };
}

export function nonSleepHabits(s: SeatState): number {
  return s.habits.filter((h) => h.activity !== "sleep").length;
}

function challengeMet(id: string, s: SeatState, dayGrowth: number, nightSleep: number): boolean {
  const t = s.tracks;
  switch (id) {
    case "C1":
      return s.habits.some((h) => h.activity === "exercise");
    case "C2":
      return TRACKS.some((k) => t[k] >= 20);
    case "C3":
      return dayGrowth >= 18;
    case "C4":
      return s.resists >= 5;
    case "C5":
      return s.matches >= 6;
    case "C6":
      return TRACKS.every((k) => t[k] >= 12);
    case "C7":
      return s.oppWins >= 3;
    case "C8":
      return s.morningStudyExDays >= 3;
    case "C9":
      return nightSleep >= 3 && s.hp === TUNING.gaugeMax;
    case "C10":
      return nonSleepHabits(s) >= 2;
    default:
      return false;
  }
}

/** UI·봇용: 이 자리만 이 계획대로 했을 때(약속은 친구 일정만 고려) 결과. */
export function previewDay(state: GameState, seat: Seat, raw: Plan): { record: DayRecord; after: SeatState } {
  const plans: (ResolvedPlan | null)[] = state.seats.map(() => null);
  plans[seat] = sanitizePlan(state, seat, raw);
  const { seats } = simulateDay(state, plans);
  const after = seats[seat];
  return { record: after.days[after.days.length - 1], after };
}

// ---------------------------------------------------------------------------
// 단계 전환

function beginDay(state: GameState, day: number): GameState {
  const seats = state.seats.map((orig) => {
    const s = cloneSeat(orig);
    s.sick = s.pendingSick;
    s.apathy = s.pendingApathy;
    s.pendingSick = false;
    s.pendingApathy = false;
    if (s.hangover) s.hp = Math.max(1, s.hp - 2);
    s.hangover = false;
    if (s.emergencyHp) s.hp = Math.max(TUNING.emergencyFloor, s.hp);
    if (s.emergencyMp) s.mp = Math.max(TUNING.emergencyFloor, s.mp);
    s.emergencyHp = false;
    s.emergencyMp = false;
    if (state.events[day] === "E11") s.mp = clampGauge(s.mp + 2);
    return s;
  });
  return {
    ...state,
    day,
    seats,
    phase: "planning",
    stage: state.stage + 1,
    commits: Array(state.seatCount).fill(null),
    plans: Array(state.seatCount).fill(null),
    ready: Array(state.seatCount).fill(false),
  };
}

function resolve(state: GameState): GameState {
  const plans = state.plans.map((p, i) => p ?? defaultPlan(state, i));
  const { seats, awards } = simulateDay({ ...state, plans }, plans);
  return {
    ...state,
    plans,
    seats,
    challengeAwards: awards,
    phase: "dayResult",
    stage: state.stage + 1,
    ready: Array(state.seatCount).fill(false),
  };
}

/** 커밋한 자리가 전부 공개했으면 실행 */
function maybeResolve(state: GameState): GameState {
  const waiting = state.commits.some((c, i) => c !== null && state.plans[i] === null);
  return waiting ? state : resolve(state);
}

function toRevealing(state: GameState): GameState {
  return maybeResolve({ ...state, phase: "revealing", stage: state.stage + 1 });
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "CHOOSE_GOAL": {
      if (state.phase !== "goalDraft") return state;
      const s = state.seats[action.seat];
      if (!s || s.goalPick !== null) return state;
      const seats = state.seats.map((x, i) => (i === action.seat ? { ...x, goalPick: action.pick === 1 ? (1 as const) : (0 as const) } : x));
      const next = { ...state, seats };
      return seats.every((x) => x.goalPick !== null) ? beginDay(next, 0) : next;
    }
    case "COMMIT_PLAN": {
      if (state.phase !== "planning" || action.day !== state.day) return state;
      if (!state.seats[action.seat] || state.commits[action.seat] !== null) return state;
      const commits = state.commits.map((c, i) => (i === action.seat ? String(action.hash) : c));
      const idleStreak = state.idleStreak.map((n, i) => (i === action.seat ? 0 : n));
      const next = { ...state, commits, idleStreak };
      return commits.every((c) => c !== null) ? toRevealing(next) : next;
    }
    case "REVEAL_PLAN": {
      if (state.phase !== "revealing" || action.day !== state.day) return state;
      const hash = state.commits[action.seat];
      if (!hash || state.plans[action.seat] !== null) return state;
      const ok = planHash(action.plan, action.salt) === hash;
      const plan = ok ? sanitizePlan(state, action.seat, action.plan) : defaultPlan(state, action.seat);
      const plans = state.plans.map((p, i) => (i === action.seat ? plan : p));
      return maybeResolve({ ...state, plans });
    }
    case "READY": {
      if (state.phase !== "dayResult" || !state.seats[action.seat] || state.ready[action.seat]) return state;
      const ready = state.ready.map((r, i) => (i === action.seat ? true : r));
      const next = { ...state, ready };
      return ready.every(Boolean) ? advanceDay(next) : next;
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      if (state.phase === "goalDraft") {
        const seats = state.seats.map((x) => (x.goalPick === null ? { ...x, goalPick: 0 as const } : x));
        return beginDay({ ...state, seats }, 0);
      }
      if (state.phase === "planning") {
        const idleStreak = state.idleStreak.map((n, i) => (state.commits[i] === null ? n + 1 : n));
        const plans = state.plans.map((p, i) => (state.commits[i] === null ? defaultPlan(state, i) : p));
        return toRevealing({ ...state, idleStreak, plans });
      }
      if (state.phase === "revealing") return resolve(state);
      if (state.phase === "dayResult") return advanceDay(state);
      return state;
    }
  }
  return state;
}

function advanceDay(state: GameState): GameState {
  if (state.day + 1 >= totalDays(state)) return { ...state, phase: "ended", stage: state.stage + 1 };
  return beginDay(state, state.day + 1);
}

/** 지금 행동을 기다리는 자리 */
export function pendingSeats(state: GameState): Seat[] {
  const all = Array.from({ length: state.seatCount }, (_, i) => i);
  switch (state.phase) {
    case "goalDraft":
      return all.filter((i) => state.seats[i].goalPick === null);
    case "planning":
      return all.filter((i) => state.commits[i] === null);
    case "revealing":
      return all.filter((i) => state.commits[i] !== null && state.plans[i] === null);
    case "dayResult":
      return all.filter((i) => !state.ready[i]);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 점수 (§17)

export function goalAchieved(goalId: string, s: SeatState, short: boolean): boolean {
  const t = s.tracks;
  const need = (n: number) => (short ? Math.round((n * 5) / 7) : n);
  switch (goalId) {
    case "G1":
      return t.body >= need(32);
    case "G2":
      return t.knowledge >= need(32);
    case "G3":
      return t.wealth >= need(32);
    case "G4":
      return t.social >= need(32);
    case "G5":
      return TRACKS.every((x) => t[x] >= need(22));
    case "G6":
      return s.morningDays >= (short ? 4 : 5);
    case "G7":
      return nonSleepHabits(s) >= 4;
    case "G8":
      return s.collapses === 0 && s.mp >= 8;
    case "G9":
      return s.overtimeWorks >= need(7);
    case "G10":
      return t.knowledge >= need(25) && t.wealth >= need(25);
    case "G11":
      return s.matches >= need(10);
    case "G12":
      return s.habits.some((h) => h.activity === "study") && t.knowledge >= need(28);
    default:
      return false;
  }
}

export interface ScoreBreakdown {
  growth: number;
  balance: number;
  habits: number;
  goal: number;
  goalMet: boolean;
  challenges: number;
  condition: number;
  penalty: number;
  total: number;
}

export function scoreBreakdown(state: GameState, seat: Seat): ScoreBreakdown {
  const s = state.seats[seat];
  const growth = trackSum(s.tracks);
  const balance = Math.min(...TRACKS.map((t) => s.tracks[t]));
  const habits = s.habits.reduce((n, h) => n + (h.shaken ? 1 : 2), 0);
  const goalId = goalIdOf(state, seat);
  const goalMet = goalId ? goalAchieved(goalId, s, state.options.days === 5) : false;
  const goal = goalMet && goalId ? GOAL_BY_ID[goalId].points : 0;
  const condition = Math.floor((s.hp + s.mp) / 4);
  const penalty = s.collapses * TUNING.collapsePenalty;
  const total = growth + balance + habits + goal + s.challengePoints + condition - penalty;
  return { growth, balance, habits, goal, goalMet, challenges: s.challengePoints, condition, penalty, total };
}

export function computeRankings(state: GameState): { seat: Seat; rank: number; score: number }[] {
  const rows = state.seats.map((s, seat) => ({ seat, score: scoreBreakdown(state, seat).total, habits: s.habits.length, collapses: s.collapses, mp: s.mp }));
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.score - a.score || b.habits - a.habits || a.collapses - b.collapses || b.mp - a.mp;
  const sorted = [...rows].sort((a, b) => cmp(a, b) || a.seat - b.seat);
  return sorted.map((r) => ({ seat: r.seat, score: r.score, rank: sorted.findIndex((x) => cmp(x, r) === 0) + 1 }));
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state)
    .filter((r) => r.rank === 1)
    .map((r) => r.seat);
}

/** 솔로 등급(§20.2) */
export function soloGrade(score: number): string {
  if (score >= 165) return "인생 2회차";
  if (score >= 150) return "갓생 장인";
  if (score >= 135) return "성실한 갓생러";
  if (score >= 120) return "평범한 직장인";
  return "작심삼일러";
}

export function blankPlan(state: GameState, seat: Seat): Plan {
  const cells: Cell[] = Array(BLOCK_COUNT).fill("empty");
  for (const [b, act] of forcedBlocks(state, seat)) cells[b] = act;
  return { cells, temptation: canResist(state, seat) ? "resist" : "yield", opportunityId: null };
}
