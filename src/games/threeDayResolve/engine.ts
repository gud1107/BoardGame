import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";

/**
 * 작심삼일 (Three-Day Resolve) — original 2-6p push-your-luck game.
 * Rules: boardGameRule/작심삼일/작심삼일.md.
 *
 * Every season (6) each player secretly picks a resolution strength, how
 * publicly to declare it, and optionally a cheer/watch bet on someone else.
 * Then 7 days run simultaneously: each still-going player chooses to push
 * (draw from their own temptation bag), compromise (bank partial points) or
 * take a cheat day. Day 3 is the crisis (2 draws). Temptation points over the
 * limit = the resolution breaks. Pure + deterministic for lockstep: all
 * randomness comes from `state.rng`.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const SEASONS = 6;
export const DAYS = 7;
export const CRISIS_DAY = 3;
export const CRISIS_DRAWS = 2;
export const PLAN_MS = 45_000;
export const DAY_MS = 25_000;
export const REVIEW_MS = 15_000;

export type TokenId = "will" | "tired" | "snack" | "lazy" | "excuse" | "guilt";
export const TOKEN_IDS: readonly TokenId[] = ["will", "tired", "snack", "lazy", "excuse", "guilt"];
export const TOKENS: Record<TokenId, { emoji: string; name: string; value: number }> = {
  will: { emoji: "💧", name: "의지", value: 0 },
  tired: { emoji: "😴", name: "피곤", value: 1 },
  snack: { emoji: "🍜", name: "야식", value: 2 },
  lazy: { emoji: "🙄", name: "귀찮음", value: 2 },
  excuse: { emoji: "🗯️", name: "핑계", value: 3 },
  guilt: { emoji: "😞", name: "자책", value: 2 },
};
export type Bag = Record<TokenId, number>;

export type Strength = "light" | "proper" | "hard";
export const STRENGTH_IDS: readonly Strength[] = ["light", "proper", "hard"];
export const STRENGTHS: Record<Strength, { emoji: string; name: string; examples: string[]; reward: number; extra: TokenId[] }> = {
  light: { emoji: "🙂", name: "가볍게", examples: ["하루 10분 산책", "물 2L 마시기", "자기 전 스트레칭"], reward: 5, extra: [] },
  proper: { emoji: "😤", name: "제대로", examples: ["매일 헬스장 가기", "하루 한 챕터 독서", "영단어 50개"], reward: 7, extra: ["snack", "tired"] },
  hard: { emoji: "🔥", name: "독하게", examples: ["새벽 5시 기상 + 금주", "하루 2시간 코딩", "배달 앱 삭제"], reward: 10, extra: ["excuse", "lazy", "snack", "tired"] },
};

export type Declare = "solo" | "friend" | "sns";
export const DECLARE_IDS: readonly Declare[] = ["solo", "friend", "sns"];
export const DECLARES: Record<Declare, { emoji: string; name: string; mult: number; penalty: number; nextLimit: number; facePenalty: number; limit: number }> = {
  solo: { emoji: "🤫", name: "혼자 결심", mult: 1, penalty: 0, nextLimit: 0, facePenalty: 0, limit: 1 },
  friend: { emoji: "💬", name: "친구에게 말함", mult: 1.5, penalty: 2, nextLimit: 0, facePenalty: 1, limit: 0 },
  sns: { emoji: "📢", name: "SNS 공개", mult: 2, penalty: 5, nextLimit: 0, facePenalty: 2, limit: -1 },
};

export type BetKind = "cheer" | "watch";
export interface Bet {
  target: SeatIndex;
  kind: BetKind;
}

/** Numbers tuned by self-play (rulebook §9). */
export const TUNING = {
  startBag: { will: 6, tired: 1, snack: 1, lazy: 1, excuse: 1, guilt: 0 } as Bag,
  startLimit: 7,
  maxLessons: 2,
  /** limit bonus a cheered player gets (stacks up to cheerCap) */
  cheerLimit: 1,
  cheerCap: 1,
  /** 💧 cap: a success adds one will token while below this */
  maxWill: 9,
  cheerPay: 1,
  watchPay: 2,
  cheatCost: 2,
};

export interface SeasonEvent {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  extraAll?: TokenId[];
  limit?: number;
  hardBonus?: number;
  snsBonus?: number;
  crisisDraws?: number;
}
export const EVENTS: SeasonEvent[] = [
  { id: "calm", emoji: "☕", name: "평온한 날들", desc: "특별한 일 없음" },
  { id: "yearEnd", emoji: "🎄", name: "연말 모임", desc: "모두 이번 시즌 주머니에 🍜 야식 +1", extraAll: ["snack"] },
  { id: "spring", emoji: "🌸", name: "봄바람", desc: "모두 이번 시즌 한계치 +1", limit: 1 },
  { id: "rainy", emoji: "🌧️", name: "장마철", desc: "모두 이번 시즌 주머니에 😴 피곤 +1", extraAll: ["tired"] },
  { id: "exam", emoji: "📚", name: "시험 기간", desc: "🔥 독하게 결심을 성공하면 보상 +3", hardBonus: 3 },
  { id: "challenge", emoji: "🏃", name: "챌린지 열풍", desc: "📢 SNS 공개 결심을 성공하면 보상 +3", snsBonus: 3 },
  { id: "holiday", emoji: "🛌", name: "황금 연휴", desc: "3일차 고비에 3개를 뽑아요", crisisDraws: 3 },
  { id: "monday", emoji: "😩", name: "월요병", desc: "모두 이번 시즌 한계치 −1", limit: -1 },
];

export type RunStatus = "going" | "stopped" | "busted" | "done";
export type DayChoice = "push" | "stop" | "cheat";

export interface SeasonRun {
  strength: Strength;
  declare: Declare;
  bet: Bet | null;
  /** tokens still in the bag this season */
  pool: Bag;
  drawn: TokenId[];
  sum: number;
  limit: number;
  status: RunStatus;
  daysDone: number;
  cheatUsed: boolean;
  /** day on which the run ended (stop/bust/done) */
  endDay: number;
  cheers: number;
}

export interface Plan {
  strength: Strength;
  declare: Declare;
  bet: Bet | null;
}

export interface SeasonResult {
  season: number;
  strength: Strength;
  declare: Declare;
  status: RunStatus;
  gain: number;
  betGain: number;
  daysDone: number;
}

export interface PlayerState {
  bag: Bag;
  limit: number;
  lessons: number;
  score: number;
  successes: number;
  fails: number;
  compromises: number;
  /** SNS-fail penalty applied to the next season's limit */
  limitDebt: number;
  plan: Plan | null;
  choice: DayChoice | null;
  ready: boolean;
  run: SeasonRun | null;
  history: SeasonResult[];
}

export type LogKind = "season" | "reveal" | "draw" | "block" | "bust" | "stop" | "cheat" | "crisis" | "success" | "result" | "timeout" | "end";
export interface LogEntry {
  seq: number;
  kind: LogKind;
  seat: SeatIndex;
  token?: TokenId;
  n?: number;
  day?: number;
}

export type Phase = "plan" | "day" | "review" | "gameOver";

export interface ResolveState {
  playerCount: number;
  phase: Phase;
  season: number;
  day: number;
  /** bumps on every phase/day change — actions carry it so a stale tap can't land on the next step */
  step: number;
  events: string[];
  players: PlayerState[];
  rng: number;
  seq: number;
  log: LogEntry[];
  statTally: StatTally;
}

export type EngineAction =
  | { type: "plan"; seat: SeatIndex; step: number; strength: Strength; declare: Declare; bet: Bet | null }
  | { type: "day"; seat: SeatIndex; step: number; choice: DayChoice }
  | { type: "ready"; seat: SeatIndex; step: number }
  | { type: "timeout"; seat: SeatIndex; step: number };

const LOG_KEEP = 80;

export function isStateSyncStale(current: ResolveState | null, synced: ResolveState): boolean {
  if (!current) return false;
  return synced.seq < current.seq;
}

export const eventOf = (state: ResolveState): SeasonEvent => EVENTS.find((e) => e.id === state.events[state.season - 1]) ?? EVENTS[0];
export const bagTotal = (b: Bag) => TOKEN_IDS.reduce((a, k) => a + b[k], 0);
export const temptationPoints = (b: Bag) => TOKEN_IDS.reduce((a, k) => a + b[k] * TOKENS[k].value, 0);

export function startGame(playerCount: number, seed: number): ResolveState {
  const rng = seededRng(seed);
  const others = shuffle(
    EVENTS.filter((e) => e.id !== "calm").map((e) => e.id),
    rng,
  );
  // season 1 is always calm so the first season teaches the base rules
  const events = ["calm", ...others.slice(0, SEASONS - 1)];
  const players: PlayerState[] = Array.from({ length: playerCount }, () => ({
    bag: { ...TUNING.startBag },
    limit: TUNING.startLimit,
    lessons: 0,
    score: 0,
    successes: 0,
    fails: 0,
    compromises: 0,
    limitDebt: 0,
    plan: null,
    choice: null,
    ready: false,
    run: null,
    history: [],
  }));
  const s: ResolveState = {
    playerCount,
    phase: "plan",
    season: 1,
    day: 0,
    step: 1,
    events,
    players,
    rng: (seed ^ 0x5bd1e995) | 0,
    seq: 0,
    log: [],
    statTally: {},
  };
  log(s, { kind: "season", seat: -1, n: 1 });
  return s;
}

function log(s: ResolveState, e: Omit<LogEntry, "seq">) {
  s.seq++;
  s.log.push({ seq: s.seq, ...e });
  if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
}

function nextRandom(s: ResolveState): number {
  const v = seededRng(s.rng)();
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  return v;
}

function clone(state: ResolveState): ResolveState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      bag: { ...p.bag },
      plan: p.plan ? { ...p.plan } : null,
      run: p.run ? { ...p.run, pool: { ...p.run.pool }, drawn: [...p.run.drawn] } : null,
      history: [...p.history],
    })),
    log: [...state.log],
  };
}

/** Seats whose input the current step still waits for. */
export function pendingSeats(state: ResolveState): SeatIndex[] {
  const out: SeatIndex[] = [];
  state.players.forEach((p, seat) => {
    if (state.phase === "plan" && !p.plan) out.push(seat);
    else if (state.phase === "day" && p.run?.status === "going" && !p.choice) out.push(seat);
    else if (state.phase === "review" && !p.ready) out.push(seat);
  });
  return out;
}

export function cheatAllowed(state: ResolveState, seat: SeatIndex): boolean {
  const run = state.players[seat].run;
  return !!run && !run.cheatUsed && state.day !== CRISIS_DAY;
}

export function drawsForDay(state: ResolveState, day = state.day): number {
  return day === CRISIS_DAY ? (eventOf(state).crisisDraws ?? CRISIS_DRAWS) : 1;
}

/** Success reward for a plan under this season's event (before cheat cost). */
export function successGain(strength: Strength, declare: Declare, ev: SeasonEvent): number {
  const base = STRENGTHS[strength].reward + (strength === "hard" ? (ev.hardBonus ?? 0) : 0);
  return Math.ceil(base * DECLARES[declare].mult) + (declare === "sns" ? (ev.snsBonus ?? 0) : 0);
}

/** 타협 points: 0.5 per day held (no multiplier), minus 😅 face lost if you declared it. */
export function compromiseGain(declare: Declare, daysDone: number): number {
  return Math.floor(daysDone / 2) - DECLARES[declare].facePenalty;
}

export function runGain(run: SeasonRun, ev: SeasonEvent): number {
  if (run.status === "done") return successGain(run.strength, run.declare, ev) - (run.cheatUsed ? TUNING.cheatCost : 0);
  if (run.status === "stopped") return compromiseGain(run.declare, run.daysDone);
  if (run.status === "busted") return -DECLARES[run.declare].penalty;
  return 0;
}

export function isLegal(state: ResolveState, a: EngineAction): boolean {
  if (state.phase === "gameOver" || a.step !== state.step) return false;
  const p = state.players[a.seat];
  if (!p) return false;
  switch (a.type) {
    case "plan":
      if (state.phase !== "plan" || p.plan) return false;
      if (!STRENGTH_IDS.includes(a.strength) || !DECLARE_IDS.includes(a.declare)) return false;
      if (a.bet && (a.bet.target === a.seat || !state.players[a.bet.target] || (a.bet.kind !== "cheer" && a.bet.kind !== "watch"))) return false;
      return true;
    case "day":
      if (state.phase !== "day" || p.run?.status !== "going" || p.choice) return false;
      if (a.choice === "cheat") return cheatAllowed(state, a.seat);
      return a.choice === "push" || a.choice === "stop";
    case "ready":
      return state.phase === "review" && !p.ready;
    case "timeout":
      return pendingSeats(state).includes(a.seat);
  }
}

export function applyAction(state: ResolveState, action: EngineAction): ResolveState {
  if (!isLegal(state, action)) return state;
  const s = clone(state);
  const p = s.players[action.seat];
  let a = action;
  if (a.type === "timeout") {
    log(s, { kind: "timeout", seat: a.seat });
    if (s.phase === "plan") a = { type: "plan", seat: a.seat, step: a.step, strength: "light", declare: "solo", bet: null };
    else if (s.phase === "day") a = { type: "day", seat: a.seat, step: a.step, choice: "stop" };
    else a = { type: "ready", seat: a.seat, step: a.step };
  }
  if (a.type === "plan") p.plan = { strength: a.strength, declare: a.declare, bet: a.bet ? { ...a.bet } : null };
  else if (a.type === "day") p.choice = a.choice;
  else if (a.type === "ready") p.ready = true;
  s.seq++;
  if (pendingSeats(s).length === 0) advance(s);
  return s;
}

function advance(s: ResolveState) {
  if (s.phase === "plan") beginSeason(s);
  else if (s.phase === "day") resolveDay(s);
  else if (s.phase === "review") {
    if (s.season >= SEASONS) {
      s.phase = "gameOver";
      s.step++;
      log(s, { kind: "end", seat: -1 });
      finishStats(s);
      return;
    }
    s.season++;
    s.phase = "plan";
    s.day = 0;
    s.step++;
    for (const p of s.players) {
      p.plan = null;
      p.ready = false;
      p.run = null;
    }
    log(s, { kind: "season", seat: -1, n: s.season });
  }
}

function beginSeason(s: ResolveState) {
  const ev = eventOf(s);
  const cheers = s.players.map(() => 0);
  s.players.forEach((p) => {
    if (p.plan?.bet?.kind === "cheer") cheers[p.plan.bet.target]++;
  });
  s.players.forEach((p, seat) => {
    const plan = p.plan!;
    const pool = { ...p.bag };
    for (const t of [...STRENGTHS[plan.strength].extra, ...(ev.extraAll ?? [])]) pool[t]++;
    const cheerBonus = Math.min(TUNING.cheerCap, cheers[seat] * TUNING.cheerLimit);
    const limit = Math.max(1, p.limit + (ev.limit ?? 0) + DECLARES[plan.declare].limit - p.limitDebt + cheerBonus);
    p.limitDebt = 0;
    p.run = { strength: plan.strength, declare: plan.declare, bet: plan.bet, pool, drawn: [], sum: 0, limit, status: "going", daysDone: 0, cheatUsed: false, endDay: 0, cheers: cheers[seat] };
    p.choice = null;
    log(s, { kind: "reveal", seat });
  });
  s.phase = "day";
  s.day = 1;
  s.step++;
}

function drawToken(s: ResolveState, pool: Bag): TokenId | null {
  const total = bagTotal(pool);
  if (total === 0) return null;
  let r = Math.floor(nextRandom(s) * total);
  for (const k of TOKEN_IDS) {
    if (r < pool[k]) return k;
    r -= pool[k];
  }
  return null;
}

function resolveDay(s: ResolveState) {
  const day = s.day;
  if (day === CRISIS_DAY) log(s, { kind: "crisis", seat: -1, day, n: drawsForDay(s) });
  s.players.forEach((p, seat) => {
    const run = p.run;
    if (!run || run.status !== "going") return;
    const choice = p.choice ?? "stop";
    p.choice = null;
    if (choice === "stop") {
      run.status = "stopped";
      run.endDay = day;
      log(s, { kind: "stop", seat, day, n: compromiseGain(run.declare, run.daysDone) });
      return;
    }
    if (choice === "cheat") {
      run.cheatUsed = true;
      run.daysDone = day;
      log(s, { kind: "cheat", seat, day });
      return;
    }
    const draws = drawsForDay(s, day);
    for (let i = 0; i < draws && run.status === "going"; i++) {
      const t = drawToken(s, run.pool);
      if (!t) break;
      const v = TOKENS[t].value;
      if (v > 0 && run.sum + v > run.limit && p.lessons > 0) {
        // 📘 교훈: the token that would break you goes back into the bag
        p.lessons--;
        s.statTally = tallyAdd(s.statTally, seat, "lessonsUsed");
        log(s, { kind: "block", seat, token: t, day });
        continue;
      }
      run.drawn.push(t);
      run.sum += v;
      log(s, { kind: "draw", seat, token: t, day });
      if (run.sum > run.limit) {
        run.status = "busted";
        run.endDay = day;
        log(s, { kind: "bust", seat, day, n: run.sum });
      }
    }
    if (run.status === "going") {
      run.daysDone = day;
      if (day === CRISIS_DAY) s.statTally = tallyAdd(s.statTally, seat, "crisisSurvived");
    }
  });
  if (day >= DAYS) {
    s.players.forEach((p, seat) => {
      if (p.run?.status === "going") {
        p.run.status = "done";
        p.run.endDay = DAYS;
        log(s, { kind: "success", seat });
      }
    });
  }
  if (s.players.some((p) => p.run?.status === "going")) {
    s.day++;
    s.step++;
    return;
  }
  endSeason(s);
}

function endSeason(s: ResolveState) {
  const ev = eventOf(s);
  const runs = s.players.map((p) => p.run!);
  s.players.forEach((p, seat) => {
    const run = p.run!;
    const gain = runGain(run, ev);
    let betGain = 0;
    if (run.bet) {
      const t = runs[run.bet.target];
      if (run.bet.kind === "cheer" && t.status === "done") betGain = TUNING.cheerPay;
      if (run.bet.kind === "watch" && t.status === "busted") betGain = TUNING.watchPay;
      if (betGain) s.statTally = tallyAdd(s.statTally, seat, run.bet.kind === "cheer" ? "cheerHits" : "watchHits");
    }
    p.score += gain + betGain;
    s.statTally = tallyMax(s.statTally, seat, "maxSeasonGain", gain);
    if (run.status === "done") {
      p.successes++;
      s.statTally = tallyAdd(s.statTally, seat, "successes");
      if (run.strength === "hard") s.statTally = tallyAdd(s.statTally, seat, "hardSuccess");
      if (run.declare === "sns") s.statTally = tallyAdd(s.statTally, seat, "snsSuccess");
      // the habit sticks: the worst temptation you beat leaves your bag for good
      // the habit sticks: shake off one 😞, or else grow your 💧 will
      if (p.bag.guilt > 0) p.bag.guilt--;
      else if (p.bag.will < TUNING.maxWill) p.bag.will++;
    } else if (run.status === "stopped") {
      p.compromises++;
      s.statTally = tallyAdd(s.statTally, seat, "compromises");
    } else if (run.status === "busted") {
      p.fails++;
      s.statTally = tallyAdd(s.statTally, seat, "fails");
      p.bag.guilt++;
      p.lessons = Math.min(TUNING.maxLessons, p.lessons + 1);
      p.limitDebt = DECLARES[run.declare].nextLimit;
    }
    p.history.push({ season: s.season, strength: run.strength, declare: run.declare, status: run.status, gain, betGain, daysDone: run.daysDone });
    p.ready = false;
    log(s, { kind: "result", seat, n: gain + betGain });
  });
  s.phase = "review";
  s.step++;
}

function finishStats(s: ResolveState) {
  const ranks = computeRankings(s);
  s.players.forEach((p, seat) => {
    s.statTally = tallyMax(s.statTally, seat, "maxScore", p.score);
    if (ranks.find((r) => r.seat === seat)?.rank === 1) s.statTally = tallyAdd(s.statTally, seat, "gamesWon");
  });
}

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  score: number;
  successes: number;
}

export function computeRankings(state: ResolveState): RankedSeat[] {
  const rows = state.players.map((p, seat) => ({ seat, score: p.score, successes: p.successes, rank: 0 }));
  rows.sort((a, b) => b.score - a.score || b.successes - a.successes || a.seat - b.seat);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.score === r.score && prev.successes === r.successes ? prev.rank : i + 1;
  });
  return rows;
}

// ───────────────────────── probability helpers (UI + bots) ─────────────────────────
// Drawn tokens go back into the bag, so every draw has the same odds and the
// only state is (day, sum, lessons, cheat) — the exact DP stays tiny.

export interface RiskInput {
  pool: Bag;
  sum: number;
  limit: number;
  lessons: number;
}

function weights(pool: Bag): [number, number][] {
  const total = bagTotal(pool);
  return total === 0 ? [] : TOKEN_IDS.filter((k) => pool[k] > 0).map((k) => [TOKENS[k].value, pool[k] / total]);
}

/** Chance that drawing `draws` tokens right now breaks the resolution (📘 lessons included). */
export function bustChance(r: RiskInput, draws: number): number {
  const w = weights(r.pool);
  const rec = (sum: number, lessons: number, k: number): number => {
    if (k === 0) return 0;
    let p = 0;
    for (const [v, q] of w) {
      if (v > 0 && sum + v > r.limit) p += lessons > 0 ? q * rec(sum, lessons - 1, k - 1) : q;
      else p += q * rec(sum + v, lessons, k - 1);
    }
    return p;
  };
  return rec(r.sum, r.lessons, draws);
}

export interface SolveInput extends RiskInput {
  /** next day to play (1..DAYS) */
  day: number;
  daysDone: number;
  cheatUsed: boolean;
  declare: Declare;
  /** points if the run survives day 7 (before cheat cost) */
  winValue: number;
  /** points (usually negative) if it breaks */
  bustValue: number;
  crisisDraws: number;
}

export interface SolveResult {
  /** expected points under optimal stopping */
  value: number;
  best: DayChoice;
  /** P(success) if you push every remaining day (no cheat day) */
  pushAllSuccess: number;
  values: Partial<Record<DayChoice, number>>;
}

/** Exact optimal-stopping DP. Used by the Lv.6+ bots and the UI hints. */
export function solveRun(inp: SolveInput, allowCheat = true): SolveResult {
  const w = weights(inp.pool);
  const drawsOn = (d: number) => (d === CRISIS_DAY ? inp.crisisDraws : 1);
  const memo = new Map<number, number>();
  const stopValue = (daysDone: number) => compromiseGain(inp.declare, daysDone);
  const V = (day: number, sum: number, lessons: number, cheat: boolean, mode: 0 | 1): number => {
    if (day > DAYS) return mode === 1 ? 1 : inp.winValue - (cheat ? TUNING.cheatCost : 0);
    const key = (((mode * 10 + day) * 64 + sum) * 8 + lessons) * 2 + (cheat ? 1 : 0);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let v = drawSeq(day, sum, lessons, drawsOn(day), cheat, mode);
    if (mode === 0) {
      v = Math.max(v, stopValue(day - 1));
      if (allowCheat && !cheat && day !== CRISIS_DAY) v = Math.max(v, V(day + 1, sum, lessons, true, mode));
    }
    memo.set(key, v);
    return v;
  };
  const drawSeq = (day: number, sum: number, lessons: number, k: number, cheat: boolean, mode: 0 | 1): number => {
    if (k === 0 || w.length === 0) return V(day + 1, sum, lessons, cheat, mode);
    let e = 0;
    for (const [v, q] of w) {
      if (v > 0 && sum + v > inp.limit) e += lessons > 0 ? q * drawSeq(day, sum, lessons - 1, k - 1, cheat, mode) : q * (mode === 1 ? 0 : inp.bustValue);
      else e += q * drawSeq(day, sum + v, lessons, k - 1, cheat, mode);
    }
    return e;
  };
  const values: Partial<Record<DayChoice, number>> = {};
  values.push = drawSeq(inp.day, inp.sum, inp.lessons, drawsOn(inp.day), inp.cheatUsed, 0);
  values.stop = stopValue(inp.daysDone);
  if (allowCheat && !inp.cheatUsed && inp.day !== CRISIS_DAY) values.cheat = V(inp.day + 1, inp.sum, inp.lessons, true, 0);
  let best: DayChoice = "push";
  for (const c of ["stop", "cheat"] as DayChoice[]) if (values[c] !== undefined && values[c]! > values[best]! + 1e-9) best = c;
  const pushAllSuccess = drawSeq(inp.day, inp.sum, inp.lessons, drawsOn(inp.day), inp.cheatUsed, 1);
  return { value: values[best]!, best, pushAllSuccess, values };
}

/** Solver input for a seat's live run. */
export function solveInputFor(state: ResolveState, seat: SeatIndex): SolveInput | null {
  const p = state.players[seat];
  const run = p.run;
  if (!run) return null;
  const ev = eventOf(state);
  return {
    pool: run.pool,
    sum: run.sum,
    limit: run.limit,
    lessons: p.lessons,
    day: Math.max(1, state.day),
    daysDone: run.daysDone,
    cheatUsed: run.cheatUsed,
    declare: run.declare,
    winValue: successGain(run.strength, run.declare, ev),
    bustValue: -DECLARES[run.declare].penalty,
    crisisDraws: ev.crisisDraws ?? CRISIS_DRAWS,
  };
}

/** Season pool + limit a plan would get (for the plan screen and bots). */
export function previewPlan(state: ResolveState, seat: SeatIndex, strength: Strength, declare: Declare, cheers = 0): SolveInput {
  const p = state.players[seat];
  const ev = eventOf(state);
  const pool = { ...p.bag };
  for (const t of [...STRENGTHS[strength].extra, ...(ev.extraAll ?? [])]) pool[t]++;
  const limit = Math.max(1, p.limit + (ev.limit ?? 0) + DECLARES[declare].limit - p.limitDebt + Math.min(TUNING.cheerCap, cheers * TUNING.cheerLimit));
  return {
    pool,
    sum: 0,
    limit,
    lessons: p.lessons,
    day: 1,
    daysDone: 0,
    cheatUsed: false,
    declare,
    winValue: successGain(strength, declare, ev),
    bustValue: -DECLARES[declare].penalty,
    crisisDraws: ev.crisisDraws ?? CRISIS_DRAWS,
  };
}
