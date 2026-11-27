import { tallyAdd, tallyOf, type StatTally } from "@/games/shared/statTally";
import { ROLES, ROLE_BY_ID, SCENE_COUNT, type ChoiceDef, type EndingDef, type Fx, type RoleDef, type SceneDef } from "./data";

/**
 * 인생 상황극 — 1~8명이 각자 배역(조선 노비·양반·임금, 재벌 3세·흙수저·회사원·자수성가 CEO,
 * 아들/딸 키우기, 아이돌 연습생…)을 골라 7장면짜리 인생을 동시에 살아 보는 상황극 게임.
 *
 * 한 장면 = 모두 동시에 세 선택지 중 하나를 고른다 → 한꺼번에 공개(reveal) → 다음 장면.
 * 선택지에는 눈에 보이는 이득(힌트)만 적혀 있고, 대가와 "성격 변화(trait)"는 공개 때 드러난다.
 * 성격은 뒤 장면의 선택지를 바꿔 놓고(swap) 나비효과(echo)를 부른다 — ⚡ 지름길로 승진한
 * CEO는 딸 생일을 "비서에게 맡길지"가 아니라 "내일이 무슨 날인지도 모르는" 사람이 된다.
 *
 * 숨길 정보가 없는 파티 게임이라 커밋-공개 없이 락스텝으로 CHOOSE를 그대로 보낸다
 * (공개 전까지 화면이 남의 선택을 그리지 않을 뿐).
 */

export type Seat = number;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const CHOOSE_SECONDS = [0, 20, 30, 45] as const;
export const STAT_MAX = 12;
export const SCORE_PER_STAT = 4;
export const SCORE_PER_CLAP = 2;
export const CAST_MS = 45_000;
export const REVEAL_MS = 30_000;

export interface GameOptions {
  /** 장면마다 고르는 제한 시간(초). 0 = 무제한 */
  chooseSeconds: number;
}
export const DEFAULT_OPTIONS: GameOptions = { chooseSeconds: 30 };

export interface LogEntry {
  /** 고른 선택지 번호 */
  choice: number;
  /** 성격 때문에 바뀐 선택지였는지 */
  swapped: boolean;
  /** 시간 초과로 대신 골라졌는지 */
  auto: boolean;
  /** 이번 선택으로 새로 생긴 성격 */
  gained: string[];
  /** 이번 장면에서 터진 나비효과(장면 echoes의 번호) */
  echoes: number[];
  /** 이번 장면에서 실제로 변한 수치(선택 + 나비효과, 한계 적용 후) */
  fx: Fx;
  /** 박수 쳐 준 좌석들 */
  claps: Seat[];
}

export interface SeatState {
  role: string | null;
  stats: Fx;
  tags: string[];
  pending: number | null;
  ready: boolean;
  /** 이번 장면에서 내가 박수 친 좌석 */
  clapTo: Seat | null;
  log: LogEntry[];
  ending: string | null;
  score: number;
}

export type Phase = "cast" | "choose" | "reveal" | "ended";

export interface GameState {
  seed: number;
  options: GameOptions;
  seatCount: number;
  phase: Phase;
  /** 단계가 바뀔 때마다 +1 — 타이머와 재접속 동기화의 기준 */
  stage: number;
  scene: number;
  seats: SeatState[];
  idleStreak: number[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "PICK_ROLE"; seat: Seat; role: string }
  | { type: "CHOOSE"; seat: Seat; scene: number; choice: number }
  | { type: "CLAP"; seat: Seat; scene: number; to: Seat }
  | { type: "READY"; seat: Seat; scene: number }
  | { type: "TIMEOUT"; stage: number };

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startGame(playerCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const seatCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  return {
    seed,
    options: { ...DEFAULT_OPTIONS, ...options },
    seatCount,
    phase: "cast",
    stage: 0,
    scene: 0,
    seats: Array.from({ length: seatCount }, () => ({ role: null, stats: [0, 0, 0, 0], tags: [], pending: null, ready: false, clapTo: null, log: [], ending: null, score: 0 })),
    idleStreak: Array.from({ length: seatCount }, () => 0),
  };
}

export function roleOf(state: GameState, seat: Seat): RoleDef | null {
  const id = state.seats[seat]?.role;
  return id ? (ROLE_BY_ID[id] ?? null) : null;
}

export function sceneOf(state: GameState, seat: Seat, scene = state.scene): SceneDef | null {
  return roleOf(state, seat)?.scenes[scene] ?? null;
}

export interface ResolvedChoice {
  label: string;
  result: string;
  fx: Fx;
  tags: string[];
  fast: boolean;
  /** 이 성격 때문에 바뀐 선택지 (없으면 null) */
  swappedBy: string | null;
  /** 고르기 전에 보이는 "얻을 것 같은 것" (수치 번호) */
  hint: number[];
}

/** 성격(tags)에 따라 실제로 보이는 선택지 */
export function resolveChoice(def: ChoiceDef, tags: readonly string[]): ResolvedChoice {
  const sw = def.swap && tags.includes(def.swap.tag) ? def.swap : null;
  const src = sw ?? def;
  const hint = src.lure ?? src.fx.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  return { label: src.label, result: src.result, fx: src.fx, tags: src.tags ?? [], fast: !!def.fast, swappedBy: sw ? sw.tag : null, hint };
}

export function choicesFor(state: GameState, seat: Seat, scene = state.scene, tags: readonly string[] = state.seats[seat].tags): ResolvedChoice[] {
  const sc = sceneOf(state, seat, scene);
  return sc ? sc.choices.map((c) => resolveChoice(c, tags)) : [];
}

/** 현재 단계에서 아직 할 일이 남은 좌석 */
export function pendingSeats(state: GameState): Seat[] {
  const out: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) {
    const st = state.seats[s];
    if (state.phase === "cast" ? st.role === null : state.phase === "choose" ? st.pending === null : state.phase === "reveal" ? !st.ready : false) out.push(s);
  }
  return out;
}

export function phaseDurationMs(state: GameState): number {
  const timed = state.options.chooseSeconds > 0;
  switch (state.phase) {
    case "cast":
      return timed ? CAST_MS : 0;
    case "choose":
      return timed ? state.options.chooseSeconds * 1000 + 2_000 : 0;
    case "reveal":
      return timed ? REVEAL_MS : 0;
    default:
      return 0;
  }
}

const clampStat = (v: number) => Math.max(0, Math.min(STAT_MAX, v));

function applyFx(stats: Fx, fx: Fx): { stats: Fx; delta: Fx } {
  const next = stats.map((v, i) => clampStat(v + fx[i])) as Fx;
  return { stats: next, delta: next.map((v, i) => v - stats[i]) as Fx };
}

/** 한 좌석의 장면 결과 — 선택 + 나비효과를 적용한 새 좌석 상태 */
export function resolveSeat(role: RoleDef, sceneIdx: number, seat: SeatState, choice: number, auto: boolean): SeatState {
  const sc = role.scenes[sceneIdx];
  const ch = resolveChoice(sc.choices[choice], seat.tags);
  // 나비효과는 "이 장면에 들어올 때" 갖고 있던 성격으로 판정한다
  const echoes: number[] = [];
  let stats = seat.stats;
  const total: Fx = [0, 0, 0, 0];
  const add = (fx: Fx) => {
    const r = applyFx(stats, fx);
    stats = r.stats;
    r.delta.forEach((d, i) => (total[i] += d));
  };
  add(ch.fx);
  (sc.echoes ?? []).forEach((e, i) => {
    if (seat.tags.includes(e.tag)) {
      echoes.push(i);
      add(e.fx);
    }
  });
  const gained = ch.tags.filter((t) => !seat.tags.includes(t));
  return {
    ...seat,
    stats,
    tags: [...seat.tags, ...gained],
    pending: choice,
    log: [...seat.log, { choice, swapped: ch.swappedBy !== null, auto, gained, echoes, fx: total, claps: [] }],
  };
}

export function endingFor(role: RoleDef, seat: Pick<SeatState, "stats" | "tags">): EndingDef {
  for (const e of role.endings) {
    if (e.tags && !e.tags.every((t) => seat.tags.includes(t))) continue;
    if (e.min && !e.min.every((m, i) => seat.stats[i] >= m)) continue;
    if (e.max && !e.max.every((m, i) => seat.stats[i] <= m)) continue;
    return e;
  }
  return role.endings[role.endings.length - 1];
}

export function growthOf(role: RoleDef, stats: Fx): number {
  return stats.reduce((sum, v, i) => sum + (v - role.start[i]), 0);
}

export function clapsOf(seat: SeatState): number {
  return seat.log.reduce((n, l) => n + l.claps.length, 0);
}

/** 보정 전 인생 점수 — 수치 성장 + 엔딩 */
export function rawOf(role: RoleDef, seat: Pick<SeatState, "stats" | "tags">): number {
  return SCORE_PER_STAT * growthOf(role, seat.stats) + endingFor(role, seat).bonus;
}

/** 박수를 뺀 점수. 배역마다 `par`(기본점)와 `rate`(배율)로 난이도를 맞춘다(셀프플레이 보정). */
export function lifeScoreOf(role: RoleDef, seat: Pick<SeatState, "stats" | "tags">): number {
  return Math.max(0, Math.round(role.par + role.rate * rawOf(role, seat)));
}

export function scoreOf(role: RoleDef, seat: SeatState): number {
  return lifeScoreOf(role, seat) + SCORE_PER_CLAP * clapsOf(seat);
}

function bump(state: GameState, patch: Partial<GameState>): GameState {
  return { ...state, ...patch, stage: state.stage + 1 };
}

function toReveal(state: GameState, autoSeats: ReadonlySet<Seat>): GameState {
  let tally = state.statTally;
  const seats = state.seats.map((st, s) => {
    const role = ROLE_BY_ID[st.role!];
    const next = resolveSeat(role, state.scene, st, st.pending!, autoSeats.has(s));
    const log = next.log[next.log.length - 1];
    const def = role.scenes[state.scene].choices[st.pending!];
    tally = tallyAdd(tally, s, "scenes");
    if (def.fast) tally = tallyAdd(tally, s, "fastPicks");
    if (log.swapped) tally = tallyAdd(tally, s, "swaps");
    if (log.gained.length) tally = tallyAdd(tally, s, "traits", log.gained.length);
    if (log.echoes.length) tally = tallyAdd(tally, s, "echoes", log.echoes.length);
    return { ...next, ready: false, clapTo: null };
  });
  return bump(state, { phase: "reveal", seats, statTally: tally });
}

function advance(state: GameState): GameState {
  if (state.scene + 1 < SCENE_COUNT) {
    return bump(state, { phase: "choose", scene: state.scene + 1, seats: state.seats.map((st) => ({ ...st, pending: null, ready: false, clapTo: null })) });
  }
  const seats = state.seats.map((st) => {
    const role = ROLE_BY_ID[st.role!];
    return { ...st, ending: endingFor(role, st).id, score: scoreOf(role, st) };
  });
  return bump(state, { phase: "ended", seats });
}

function toFirstScene(state: GameState): GameState {
  return bump(state, {
    phase: "choose",
    scene: 0,
    seats: state.seats.map((st) => ({ ...st, stats: [...ROLE_BY_ID[st.role!].start] as Fx, pending: null, ready: false })),
  });
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "PICK_ROLE": {
      const st = state.seats[action.seat];
      if (state.phase !== "cast" || !st || st.role !== null || !ROLE_BY_ID[action.role]) return state;
      const seats = state.seats.map((x, i) => (i === action.seat ? { ...x, role: action.role } : x));
      const next = { ...state, seats };
      return seats.every((x) => x.role !== null) ? toFirstScene(next) : next;
    }
    case "CHOOSE": {
      const st = state.seats[action.seat];
      if (state.phase !== "choose" || !st || action.scene !== state.scene || st.pending !== null) return state;
      const sc = sceneOf(state, action.seat);
      if (!sc || !Number.isInteger(action.choice) || action.choice < 0 || action.choice >= sc.choices.length) return state;
      const seats = state.seats.map((x, i) => (i === action.seat ? { ...x, pending: action.choice } : x));
      const idleStreak = state.idleStreak.map((v, i) => (i === action.seat ? 0 : v));
      const next = { ...state, seats, idleStreak };
      return seats.every((x) => x.pending !== null) ? toReveal(next, new Set()) : next;
    }
    case "CLAP": {
      const me = state.seats[action.seat];
      const to = state.seats[action.to];
      if (state.phase !== "reveal" || action.scene !== state.scene || !me || !to || action.seat === action.to || me.clapTo !== null) return state;
      const seats = state.seats.map((x, i) => {
        if (i === action.seat) return { ...x, clapTo: action.to };
        if (i === action.to) return { ...x, log: x.log.map((l, li) => (li === state.scene ? { ...l, claps: [...l.claps, action.seat] } : l)) };
        return x;
      });
      return { ...state, seats, statTally: tallyAdd(tallyAdd(state.statTally, action.to, "claps"), action.seat, "clapsGiven") };
    }
    case "READY": {
      const st = state.seats[action.seat];
      if (state.phase !== "reveal" || action.scene !== state.scene || !st || st.ready) return state;
      const seats = state.seats.map((x, i) => (i === action.seat ? { ...x, ready: true } : x));
      const next = { ...state, seats };
      return seats.every((x) => x.ready) ? advance(next) : next;
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      const rng = mulberry32(state.seed ^ Math.imul(state.stage + 1, 0x9e3779b1));
      if (state.phase === "cast") {
        const seats = state.seats.map((x) => (x.role === null ? { ...x, role: ROLES[Math.floor(rng() * ROLES.length)].id } : x));
        return toFirstScene({ ...state, seats });
      }
      if (state.phase === "choose") {
        const auto = new Set<Seat>();
        const seats = state.seats.map((x, i) => {
          if (x.pending !== null) return x;
          auto.add(i);
          const n = ROLE_BY_ID[x.role!].scenes[state.scene].choices.length;
          return { ...x, pending: Math.floor(rng() * n) };
        });
        const idleStreak = state.idleStreak.map((v, i) => (auto.has(i) ? v + 1 : v));
        return toReveal({ ...state, seats, idleStreak }, auto);
      }
      if (state.phase === "reveal") return advance(state);
      return state;
    }
    default:
      return state;
  }
}

export function computeRankings(state: GameState): { seat: Seat; rank: number }[] {
  const key = (s: Seat) => [state.seats[s].score, state.seats[s].stats[1], state.seats[s].stats[3]];
  const order = Array.from({ length: state.seatCount }, (_, s) => s).sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return a - b;
  });
  const out: { seat: Seat; rank: number }[] = [];
  order.forEach((seat, i) => {
    const prev = out[i - 1];
    const same = prev && key(prev.seat).every((v, k) => v === key(seat)[k]);
    out.push({ seat, rank: same ? prev.rank : i + 1 });
  });
  return out;
}

export function winnerSeats(state: GameState): Seat[] {
  return state.phase === "ended" ? computeRankings(state).filter((r) => r.rank === 1).map((r) => r.seat) : [];
}

/** 개인 기록(src/lib/stats/details.ts): max* 는 최고값, 나머지는 합산 */
export function seatDetails(state: GameState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const st = state.seats[seat];
  const role = roleOf(state, seat);
  const ending = role && st.ending ? role.endings.find((e) => e.id === st.ending) : null;
  return {
    lives: 1,
    scenes: t.scenes ?? 0,
    fastPicks: t.fastPicks ?? 0,
    traits: t.traits ?? 0,
    echoes: t.echoes ?? 0,
    swaps: t.swaps ?? 0,
    claps: t.claps ?? 0,
    clapsGiven: t.clapsGiven ?? 0,
    bestEndings: ending && ending.bonus >= 14 ? 1 : 0,
    noFast: (t.fastPicks ?? 0) === 0 ? 1 : 0,
    maxScore: st.score,
    maxLove: st.stats[1],
    maxMoney: st.stats[0],
  };
}
