import { LEVELS, levelById, type LevelDef } from "./levels";
import { simulate, type SelfTrack, type SimResult } from "./sim";

/**
 * 시간 루프 도둑단 — 1~4인 협력 퍼즐. 룰 원전: boardGameRule/시간루프도둑단/시간루프도둑단.md (자체 창작).
 *
 * 흐름
 * - 작전 하나 = 최대 `maxLoops`번의 루프. 루프마다 모든 플레이어가 "동시에" 자기 자아 하나를
 *   녹화한다(record). 녹화 화면에는 지난 루프의 유령들만 보이고, 같은 루프의 동료는 안 보인다.
 * - 전원이 녹화를 내면(SUBMIT) 지금까지의 모든 자아를 합쳐 재생한다(replay). 그 재생에서 필요한
 *   보석이 밴에 다 들어오면 작전 성공, 아니면 다음 루프(이번 자아들은 유령이 되어 계속 반복).
 * - 마지막 루프까지 못 채우면 실패.
 * - 별: 성공 ⭐ · 기준 루프 이하 ⭐ · 동전을 모두 입금 ⭐ (최대 3).
 *
 * 락스텝: 방장이 시드+옵션을 보내면 모두 `startGame`을 재현하고, 이후 `EngineAction`만 주고받는다.
 * 숨길 정보가 없어서 커밋-공개는 쓰지 않는다 — 녹화는 낼 때 바로 보낸다(같은 루프 동료 화면에는
 * 재생 전까지 그리지 않는다).
 */

export type Seat = number;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;

/** 재생 한 틱 길이(ms) */
export const REPLAY_TICK_MS = 260;
/** 재생이 끝난 뒤 결과를 보는 시간 */
export const RESULT_MS = 9_000;

export interface GameOptions {
  levelId: string;
  /** 한 루프 녹화 제한(초), 0 = 무제한 */
  recordSeconds: number;
}

export const DEFAULT_OPTIONS: GameOptions = { levelId: LEVELS[0].id, recordSeconds: 120 };
export const RECORD_SECONDS = [60, 90, 120, 180, 0];

export type Phase = "record" | "replay" | "ended";

export interface LoopSummary {
  loop: number;
  gems: number;
  coins: number;
  paradoxes: number;
  caught: number;
  clearedAt: number | null;
}

export interface Outcome {
  cleared: boolean;
  loopsUsed: number;
  stars: number;
  gems: number;
  coins: number;
  coinTotal: number;
}

export interface GameState {
  seed: number;
  seatCount: number;
  options: GameOptions;
  levelId: string;
  maxLoops: number;
  par: number;
  need: number;
  phase: Phase;
  loop: number;
  /** 단계가 바뀔 때마다 +1 (타이머·TIMEOUT 키) */
  stage: number;
  /** 끝난 루프들의 자아 */
  tracks: SelfTrack[];
  /** 이번 루프에 낸 녹화 (좌석별) */
  pending: (string | null)[];
  ready: boolean[];
  idleStreak: number[];
  history: LoopSummary[];
  outcome: Outcome | null;
}

export type EngineAction =
  | { type: "SUBMIT"; seat: Seat; loop: number; moves: string; auto?: boolean }
  | { type: "READY"; seat: Seat; loop: number }
  | { type: "TIMEOUT"; stage: number };

export function levelOf(state: Pick<GameState, "levelId">): LevelDef {
  return levelById(state.levelId);
}

function clampCount(n: number): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(4, Math.floor(n))) as 1 | 2 | 3 | 4;
}

export function startGame(seatCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const n = clampCount(seatCount);
  const level = levelById(options.levelId);
  return {
    seed,
    seatCount: n,
    options: { ...DEFAULT_OPTIONS, ...options, levelId: level.id },
    levelId: level.id,
    maxLoops: level.loops[n],
    par: level.par[n],
    need: level.need[n],
    phase: "record",
    loop: 1,
    stage: 0,
    tracks: [],
    pending: Array(n).fill(null),
    ready: Array(n).fill(false),
    idleStreak: Array(n).fill(0),
    history: [],
    outcome: null,
  };
}

const MOVE_RE = /[^NSEWU.]/g;
export function sanitizeMoves(moves: string, ticks: number): string {
  return String(moves ?? "")
    .toUpperCase()
    .replace(MOVE_RE, ".")
    .slice(0, ticks);
}

/** 이번 루프까지의 모든 자아 (재생용) — 낸 녹화가 없는 좌석은 가만히 서 있는 자아 */
export function mergedTracks(state: GameState): SelfTrack[] {
  const now = state.pending.map((m, seat) => ({ seat, loop: state.loop, moves: m ?? "" }));
  return [...state.tracks, ...now];
}

/** 지난 루프 유령만 (녹화 화면) */
export function ghostTracks(state: GameState): SelfTrack[] {
  return state.tracks;
}

export function replayOf(state: GameState): SimResult {
  return simulate(levelOf(state), mergedTracks(state), state.need);
}

function summarize(state: GameState, run: SimResult): LoopSummary {
  return {
    loop: state.loop,
    gems: run.final.gems,
    coins: run.final.coins,
    paradoxes: run.events.filter((e) => e.kind === "paradox").length,
    caught: run.events.filter((e) => e.kind === "caught").length,
    clearedAt: run.clearedAt,
  };
}

export function coinTotal(level: LevelDef): number {
  return level.rows.join("").split("$").length - 1;
}

export function starsFor(cleared: boolean, loopsUsed: number, par: number, coins: number, coinsAll: number): number {
  if (!cleared) return 0;
  return 1 + (loopsUsed <= par ? 1 : 0) + (coinsAll > 0 && coins >= coinsAll ? 1 : 0);
}

function toReplay(state: GameState): GameState {
  const run = replayOf(state);
  const summary = summarize(state, run);
  return { ...state, phase: "replay", stage: state.stage + 1, ready: Array(state.seatCount).fill(false), history: [...state.history, summary] };
}

function afterReplay(state: GameState): GameState {
  const last = state.history[state.history.length - 1];
  const tracks = mergedTracks(state);
  const level = levelOf(state);
  const cleared = !!last && last.clearedAt !== null;
  if (cleared || state.loop >= state.maxLoops) {
    const coinsAll = coinTotal(level);
    const outcome: Outcome = {
      cleared,
      loopsUsed: state.loop,
      stars: starsFor(cleared, state.loop, state.par, last?.coins ?? 0, coinsAll),
      gems: last?.gems ?? 0,
      coins: last?.coins ?? 0,
      coinTotal: coinsAll,
    };
    return { ...state, tracks, pending: Array(state.seatCount).fill(null), phase: "ended", stage: state.stage + 1, outcome };
  }
  return {
    ...state,
    tracks,
    pending: Array(state.seatCount).fill(null),
    ready: Array(state.seatCount).fill(false),
    phase: "record",
    loop: state.loop + 1,
    stage: state.stage + 1,
  };
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "SUBMIT": {
      if (state.phase !== "record" || action.loop !== state.loop) return state;
      if (action.seat < 0 || action.seat >= state.seatCount || state.pending[action.seat] !== null) return state;
      const moves = sanitizeMoves(action.moves, levelOf(state).ticks);
      const pending = state.pending.map((m, i) => (i === action.seat ? moves : m));
      const idle = action.auto === true && !/[NSEWU]/.test(moves);
      const idleStreak = state.idleStreak.map((v, i) => (i === action.seat ? (idle ? v + 1 : 0) : v));
      const next = { ...state, pending, idleStreak };
      return pending.every((m) => m !== null) ? toReplay(next) : next;
    }
    case "READY": {
      if (state.phase !== "replay" || action.loop !== state.loop) return state;
      if (action.seat < 0 || action.seat >= state.seatCount || state.ready[action.seat]) return state;
      const ready = state.ready.map((r, i) => (i === action.seat ? true : r));
      const next = { ...state, ready };
      return ready.every(Boolean) ? afterReplay(next) : next;
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      if (state.phase === "record") {
        const idleStreak = state.idleStreak.map((v, i) => (state.pending[i] === null ? v + 1 : v));
        const pending = state.pending.map((m) => m ?? "");
        return toReplay({ ...state, pending, idleStreak });
      }
      if (state.phase === "replay") return afterReplay(state);
      return state;
    }
  }
  return state;
}

/** 지금 행동해야 하는 좌석 */
export function pendingSeats(state: GameState): Seat[] {
  const out: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) {
    if (state.phase === "record" && state.pending[s] === null) out.push(s);
    if (state.phase === "replay" && !state.ready[s]) out.push(s);
  }
  return out;
}

/** 재생 연출 길이 */
export function replayDurationMs(state: GameState): number {
  return levelOf(state).ticks * REPLAY_TICK_MS + 1_200;
}

export interface Ranking {
  seat: Seat;
  rank: number;
}

/** 협력 게임 — 성공하면 모두 1위, 실패하면 모두 2위 */
export function computeRankings(state: GameState): Ranking[] {
  const won = state.outcome?.cleared === true;
  return Array.from({ length: state.seatCount }, (_, seat) => ({ seat, rank: won ? 1 : 2 }));
}

export function winnerSeats(state: GameState): Seat[] {
  return state.outcome?.cleared ? Array.from({ length: state.seatCount }, (_, s) => s) : [];
}

/** 좌석별 통계(이 판 전체) — 이 좌석이 녹화한 자아들 기준 */
export function seatTally(state: GameState, seat: Seat): { banked: number; coins: number; paradoxes: number; caught: number; selves: number } {
  const tracks = state.phase === "ended" ? state.tracks : mergedTracks(state);
  const run = simulate(levelOf(state), tracks, state.need);
  const sorted = [...tracks].sort((a, b) => a.loop - b.loop || a.seat - b.seat);
  const mine = new Set(sorted.map((t, i) => (t.seat === seat ? i : -1)).filter((i) => i >= 0));
  const level = levelOf(state);
  let banked = 0;
  let coins = 0;
  for (const e of run.events) {
    if (!mine.has(e.self) || e.kind !== "bank" || e.loot === undefined) continue;
    const kind = level.rows.length > 0 ? lootKind(level, e.loot) : "gem";
    if (kind === "gem") banked++;
    else coins++;
  }
  return {
    banked,
    coins,
    paradoxes: run.events.filter((e) => mine.has(e.self) && e.kind === "paradox").length,
    caught: run.events.filter((e) => mine.has(e.self) && e.kind === "caught").length,
    selves: mine.size,
  };
}

function lootKind(level: LevelDef, id: number): "gem" | "coin" {
  let k = 0;
  for (const row of level.rows) {
    for (const c of row) {
      if (c === "*" || c === "$") {
        if (k === id) return c === "*" ? "gem" : "coin";
        k++;
      }
    }
  }
  return "gem";
}
