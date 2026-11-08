import { FORESTS, T_FLOOR, T_RAVINE, T_TREE, T_UNKNOWN, bfs, forestById, generateForest, litCells, manhattan, neighbors4, type ForestId } from "./forest";
import { DIRS, PING_MARKS, WORDS, type Dir, type PingMark } from "./show";

/**
 * 등불 지기 — 2~5인 협력. 룰 원전: boardGameRule/등불지기/등불지기.md (자체 창작).
 *
 * 한 라운드 = 계획(plan) 한 번. 모두 동시에 최대 3걸음을 정하고(다른 사람에게 그대로 보인다),
 * 📍 핑 2개·💬 한마디 1개로 신호를 보낸 뒤 "출발"을 누른다. 전원이 출발(또는 시간 초과)하면
 * 걸음을 한 칸씩 동시에 처리하고(`resolveRound`), 괴물이 한 칸 움직이고, 새 빛으로 지도를 넓힌다.
 *
 * 숨김 정보: 다리·함정·괴물은 색이 있고 그 색 등불 빛 아래서만 보인다. 서버(또는 락스텝 기기)가
 * 전체 상태를 들고, 화면·봇은 언제나 `lanternView(state, seat)`만 본다 — 그 좌석이 볼 수 있는
 * 것만 남긴 같은 모양의 상태. 시드도 지운다(시드로 숲을 다시 만들 수 있으므로).
 */

export type Seat = number;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
/** 한 라운드 최대 걸음 */
export const MOVE_MAX = 3;
/** 등불 빛 반경(길 거리) */
export const LIGHT_RADIUS = 4;
/** 🔆 등불 밝히기 반경 */
export const FLARE_RADIUS = 7;
export const FLARES_PER_PLAYER = 2;
export const PINGS_PER_ROUND = 2;
export const WORDS_PER_ROUND = 1;
/** 한 사람이 동시에 꽂아 둘 수 있는 핑 — 넘치면 가장 오래된 것이 사라진다 */
export const MAX_ACTIVE_PINGS = 5;
/** 괴물이 문 뒤 잠드는 라운드 */
export const SATED_ROUNDS = 2;

export const TURN_SECONDS = [45, 60, 90, 0] as const;

export interface GameOptions {
  forest: ForestId;
  /** 라운드 계획 제한(초), 0 = 무제한 */
  turnSeconds: number;
}

export const DEFAULT_OPTIONS: GameOptions = { forest: "trail", turnSeconds: 60 };

export interface Trap {
  cell: number;
  color: number;
  state: "armed" | "sprung" | "disarmed";
}
export interface Bridge {
  cell: number;
  color: number;
  /** 주인이 아닌 사람이 한 번 건너면 모두에게 보인다 */
  revealed: boolean;
}
export interface Monster {
  id: number;
  color: number;
  path: number[];
  /** path 안의 현재 위치. 보기(view)에서 지금 안 보이면 -1 */
  idx: number;
  dir: 1 | -1;
  sated: number;
  gone: boolean;
  /** 누군가를 물면 모두에게 보인다 */
  revealed: boolean;
  /** 주인 색 빛이 한 번이라도 비추면 주인에게 순찰로가 보인다 */
  spotted: boolean;
}
export interface Pickup {
  cell: number;
  taken: boolean;
  by: number;
}
export interface Ping {
  id: number;
  seat: Seat;
  cell: number;
  mark: PingMark;
  round: number;
}
export interface Word {
  seat: Seat;
  round: number;
  word: number;
}
export type EventKind = "trap" | "disarm" | "fall" | "bridge" | "bite" | "banish" | "shard" | "jar" | "flare" | "altar" | "stunned";
export interface LogEvent {
  round: number;
  /** 몇 번째 걸음에서 (괴물 이동은 MOVE_MAX) */
  step: number;
  kind: EventKind;
  seat: Seat;
  cell: number;
  color: number;
}
export interface PlayerState {
  pos: number;
  /** 남은 기절 라운드 (괴물에게 물리면 다음 라운드 못 움직임) */
  stunned: number;
  flares: number;
  /** 지난 해결 때 🔆을 써서 이번 라운드 빛이 넓다 */
  flaring: boolean;
}
export interface Plan {
  steps: Dir[];
  flare: boolean;
  ready: boolean;
  /** 이번 라운드에 계획을 한 번이라도 냈다 (제자리도 계획) */
  planned: boolean;
  /** 마지막으로 받은 계획 번호 — 늦게 도착한 옛 수정(네트워크 순서 뒤바뀜)은 무시한다 */
  rev: number;
}
export interface Tally {
  shards: number;
  jars: number;
  hurt: number;
  falls: number;
  disarms: number;
  banishes: number;
  pings: number;
  words: number;
  bridgesShown: number;
}
export interface Outcome {
  won: boolean;
  reason: "escaped" | "hearts" | "oil";
  stars: number;
  hearts: number;
  jars: number;
  roundsUsed: number;
}

export interface GameState {
  seed: number;
  /** 전체 상태면 -1, 보기면 그 좌석 */
  viewer: number;
  seatCount: number;
  options: GameOptions;
  w: number;
  h: number;
  /** 전체 상태: 실제 지형. 보기: 아무도 못 본 칸은 "?" */
  tiles: string;
  start: number;
  altar: number;
  phase: "plan" | "ended";
  round: number;
  maxRounds: number;
  /** 단계가 바뀔 때마다 +1 (타이머·TIMEOUT 키) */
  stage: number;
  hearts: number;
  maxHearts: number;
  need: number;
  players: PlayerState[];
  plans: Plan[];
  pingsLeft: number[];
  wordsLeft: number[];
  traps: Trap[];
  bridges: Bridge[];
  monsters: Monster[];
  shards: Pickup[];
  jars: Pickup[];
  /** 누가 빠져서 다리가 없다고 모두 아는 골짜기 */
  noBridge: number[];
  /** 팀 지도 — 누구 빛이든 한 번 비춘 칸 ("1"/"0") */
  explored: string;
  /** 좌석별로 자기 빛이 비춘 칸 (자기 색 물건 기억용). 보기에선 남의 것은 "" */
  seenBy: string[];
  /**
   * 칸마다 그 칸을 비춘 적 있는 등불 색 (비트 마스크) — 공개 정보. 누가 어디를 비췄는지는
   * 모두 보이니까(무엇을 봤는지는 모름). "모든 색이 확인한 길"이 안전한 길이다.
   */
  checked: number[];
  pings: Ping[];
  nextPingId: number;
  words: Word[];
  log: LogEvent[];
  /** 지난 해결의 걸음 경로 (애니메이션) */
  lastMoves: { round: number; from: number[]; paths: number[][] } | null;
  idleStreak: number[];
  tally: Tally[];
  outcome: Outcome | null;
}

export type EngineAction =
  | { type: "PLAN"; seat: Seat; round: number; steps: Dir[]; flare: boolean; rev?: number }
  | { type: "READY"; seat: Seat; round: number; ready: boolean; rev?: number }
  | { type: "SIGNAL"; seat: Seat; round: number; ping?: { cell: number; mark: PingMark | "clear" }; word?: number }
  /** 계획 + 출발을 한 번에 ("출발" 버튼) */
  | { type: "TURN"; seat: Seat; round: number; steps: Dir[]; flare: boolean; rev?: number }
  | { type: "TIMEOUT"; stage: number };

const emptyTally = (): Tally => ({ shards: 0, jars: 0, hurt: 0, falls: 0, disarms: 0, banishes: 0, pings: 0, words: 0, bridgesShown: 0 });

function clampCount(n: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(n)));
}

function orBits(bits: string, cells: Iterable<number>): string {
  const arr = bits.split("");
  for (const c of cells) arr[c] = "1";
  return arr.join("");
}

export function radiusOf(p: PlayerState): number {
  return p.flaring ? FLARE_RADIUS : LIGHT_RADIUS;
}

/** 이 칸을 아직 안 비춘 색 수 (나 빼고) */
export function uncheckedColors(state: GameState, cell: number, except: Seat): number {
  let n = 0;
  for (let s = 0; s < state.seatCount; s++) if (s !== except && !(state.checked[cell] & (1 << s))) n++;
  return n;
}

export function allChecked(state: GameState, cell: number): boolean {
  return state.checked[cell] === (1 << state.seatCount) - 1;
}

/** 좌석 하나가 지금 비추는 칸 — 전체 상태든 보기든 같은 결과 (빛 안의 칸은 늘 탐험된 칸이라) */
export function litBy(state: GameState, seat: Seat): Set<number> {
  const p = state.players[seat];
  if (!p) return new Set();
  return litCells(state.tiles, state.w, state.h, p.pos, radiusOf(p));
}

export function monsterCell(m: Monster): number {
  return m.idx < 0 ? -1 : m.path[m.idx];
}

function nextMonsterIdx(m: Monster): { idx: number; dir: 1 | -1 } {
  if (m.path.length <= 1) return { idx: m.idx, dir: m.dir };
  let dir = m.dir;
  let idx = m.idx + dir;
  if (idx < 0 || idx >= m.path.length) {
    dir = dir === 1 ? -1 : 1;
    idx = m.idx + dir;
  }
  return { idx, dir };
}

/** 괴물이 다음에 갈 칸 (보기에서 위치를 모르면 -1) */
export function monsterNextCell(m: Monster): number {
  if (m.idx < 0 || m.gone) return -1;
  if (m.sated > 0) return monsterCell(m);
  return m.path[nextMonsterIdx(m).idx];
}

function refreshSight(state: GameState): GameState {
  let explored = state.explored;
  const seenBy = [...state.seenBy];
  const monsters = state.monsters.map((m) => ({ ...m }));
  const checked = [...state.checked];
  for (let s = 0; s < state.seatCount; s++) {
    const lit = litBy(state, s);
    explored = orBits(explored, lit);
    seenBy[s] = orBits(seenBy[s], lit);
    for (const c of lit) checked[c] |= 1 << s;
    for (const m of monsters) if (!m.gone && m.color === s && lit.has(monsterCell(m))) m.spotted = true;
  }
  return { ...state, explored, seenBy, monsters, checked };
}

export function startGame(seatCount: number, seed: number, options: Partial<GameOptions> = {}): GameState {
  const n = clampCount(seatCount);
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  const preset = forestById(opts.forest);
  opts.forest = preset.id;
  if (!TURN_SECONDS.includes(opts.turnSeconds as (typeof TURN_SECONDS)[number])) opts.turnSeconds = DEFAULT_OPTIONS.turnSeconds;
  const f = generateForest(preset.id, n, seed);
  const cells = f.w * f.h;
  const base: GameState = {
    seed,
    viewer: -1,
    seatCount: n,
    options: opts,
    w: f.w,
    h: f.h,
    tiles: f.tiles,
    start: f.start,
    altar: f.altar,
    phase: "plan",
    round: 1,
    maxRounds: preset.rounds[n] ?? 24,
    stage: 0,
    hearts: preset.hearts[n] ?? 5,
    maxHearts: preset.hearts[n] ?? 5,
    need: f.shards.length,
    players: Array.from({ length: n }, () => ({ pos: f.start, stunned: 0, flares: FLARES_PER_PLAYER, flaring: false })),
    plans: Array.from({ length: n }, () => ({ steps: [], flare: false, ready: false, planned: false, rev: 0 })),
    pingsLeft: Array(n).fill(PINGS_PER_ROUND),
    wordsLeft: Array(n).fill(WORDS_PER_ROUND),
    traps: f.traps.map((t) => ({ ...t, state: "armed" })),
    bridges: f.bridges.map((b) => ({ ...b, revealed: false })),
    monsters: f.monsters.map((m, id) => ({ id, color: m.color, path: m.path, idx: 0, dir: 1, sated: 0, gone: false, revealed: false, spotted: false })),
    shards: f.shards.map((cell) => ({ cell, taken: false, by: -1 })),
    jars: f.jars.map((cell) => ({ cell, taken: false, by: -1 })),
    noBridge: [],
    explored: "0".repeat(cells),
    seenBy: Array(n).fill("0".repeat(cells)),
    checked: Array(cells).fill(0),
    pings: [],
    nextPingId: 1,
    words: [],
    log: [],
    lastMoves: null,
    idleStreak: Array(n).fill(0),
    tally: Array.from({ length: n }, emptyTally),
    outcome: null,
  };
  return refreshSight(base);
}

export function step(w: number, h: number, c: number, d: Dir): number {
  const x = c % w;
  const y = Math.floor(c / w);
  if (d === "N") return y > 0 ? c - w : -1;
  if (d === "S") return y < h - 1 ? c + w : -1;
  if (d === "E") return x < w - 1 ? c + 1 : -1;
  return x > 0 ? c - 1 : -1;
}

export function dirBetween(w: number, a: number, b: number): Dir | null {
  if (b === a - w) return "N";
  if (b === a + w) return "S";
  if (b === a + 1 && Math.floor(a / w) === Math.floor(b / w)) return "E";
  if (b === a - 1 && Math.floor(a / w) === Math.floor(b / w)) return "W";
  return null;
}

/** 계획한 걸음이 지나갈 칸들 (나무에 막히면 거기서 끊김) */
export function plannedCells(state: GameState, seat: Seat, steps?: Dir[]): number[] {
  const p = state.players[seat];
  if (!p) return [];
  const out: number[] = [];
  let c = p.pos;
  for (const d of steps ?? state.plans[seat]?.steps ?? []) {
    const n = step(state.w, state.h, c, d);
    if (n < 0 || state.tiles[n] === T_TREE || state.tiles[n] === T_UNKNOWN) break;
    out.push(n);
    c = n;
  }
  return out;
}

function validSteps(state: GameState, seat: Seat, steps: unknown): Dir[] | null {
  if (!Array.isArray(steps) || steps.length > MOVE_MAX) return null;
  const out: Dir[] = [];
  let c = state.players[seat].pos;
  for (const d of steps) {
    if (!DIRS.includes(d as Dir)) return null;
    const n = step(state.w, state.h, c, d as Dir);
    if (n < 0 || state.tiles[n] === T_TREE) return null;
    out.push(d as Dir);
    c = n;
  }
  return out;
}

function allReady(state: GameState): boolean {
  return state.plans.every((p, s) => p.ready || state.players[s].stunned > 0);
}

function sameSteps(a: Dir[], b: Dir[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

function bumpIdle(state: GameState, seat: Seat): number[] {
  return state.idleStreak[seat] === 0 ? state.idleStreak : state.idleStreak.map((v, i) => (i === seat ? 0 : v));
}

function addLog(log: LogEvent[], e: LogEvent[]): LogEvent[] {
  return [...log, ...e].slice(-60);
}

function starsFor(won: boolean, hearts: number, maxHearts: number, jars: number, jarTotal: number): number {
  if (!won) return 0;
  return 1 + (hearts * 2 >= maxHearts ? 1 : 0) + (jarTotal > 0 && jars >= jarTotal ? 1 : 0);
}

/**
 * 한 라운드 해결.
 * 1. 걸음 k = 1..3 을 모두 동시에: 나무면 멈춤, 다리 없는 골짜기면 💧 빠짐(♥-1, 제자리, 멈춤),
 *    남의 색 함정이면 💥(♥-1, 멈춤, 모두에게 드러남), 내 색 함정이면 해제, 괴물 칸이면 👹 물림
 *    (♥-1, 한 칸 뒤로, 다음 라운드 기절). 지나가는 칸의 빛 조각·반딧불 병은 줍는다.
 * 2. 괴물 퇴치: 괴물과 같은 색 등불이 괴물 칸 바로 옆(상하좌우)에서 멈추면 괴물이 녹아 사라진다.
 * 3. 괴물 이동: 한 칸. 사람이 있는 칸으로 들어가면 그 사람을 문다.
 * 4. 새 빛으로 지도를 넓히고 승패를 본다. 조각을 다 모으고 모두 제단 위면 탈출 성공.
 */
function resolveRound(state: GameState): GameState {
  const { w, h } = state;
  const round = state.round;
  const players = state.players.map((p) => ({ ...p }));
  const traps = state.traps.map((t) => ({ ...t }));
  const bridges = state.bridges.map((b) => ({ ...b }));
  const monsters = state.monsters.map((m) => ({ ...m }));
  const shards = state.shards.map((p) => ({ ...p }));
  const jars = state.jars.map((p) => ({ ...p }));
  const tally = state.tally.map((t) => ({ ...t }));
  const noBridge = new Set(state.noBridge);
  const events: LogEvent[] = [];
  let hearts = state.hearts;
  const skip = players.map((p) => p.stunned > 0);
  const stopped = players.map((_, s) => skip[s]);
  const paths: number[][] = players.map(() => []);
  const prev = players.map((p) => p.pos);
  const stunNew = new Set<number>();

  const hurt = (seat: Seat) => {
    hearts = Math.max(0, hearts - 1);
    tally[seat].hurt++;
  };
  const pickUp = (seat: Seat, cell: number, k: number) => {
    for (const s of shards) {
      if (!s.taken && s.cell === cell) {
        s.taken = true;
        s.by = seat;
        tally[seat].shards++;
        events.push({ round, step: k, kind: "shard", seat, cell, color: -1 });
      }
    }
    for (const j of jars) {
      if (!j.taken && j.cell === cell) {
        j.taken = true;
        j.by = seat;
        tally[seat].jars++;
        events.push({ round, step: k, kind: "jar", seat, cell, color: -1 });
      }
    }
  };

  for (let k = 0; k < MOVE_MAX; k++) {
    for (let s = 0; s < players.length; s++) {
      if (stopped[s]) continue;
      const d = state.plans[s].steps[k];
      if (!d) {
        stopped[s] = true;
        continue;
      }
      const from = players[s].pos;
      const to = step(w, h, from, d);
      if (to < 0 || state.tiles[to] === T_TREE) {
        stopped[s] = true;
        continue;
      }
      if (state.tiles[to] === T_RAVINE) {
        const b = bridges.find((x) => x.cell === to);
        if (!b) {
          hurt(s);
          tally[s].falls++;
          noBridge.add(to);
          paths[s].push(to, from);
          events.push({ round, step: k, kind: "fall", seat: s, cell: to, color: -1 });
          stopped[s] = true;
          continue;
        }
        if (b.color !== s && !b.revealed) {
          b.revealed = true;
          if (tally[b.color]) tally[b.color].bridgesShown++;
          events.push({ round, step: k, kind: "bridge", seat: s, cell: to, color: b.color });
        }
      }
      const m = monsters.find((x) => !x.gone && x.sated === 0 && monsterCell(x) === to);
      if (m) {
        hurt(s);
        m.revealed = true;
        m.sated = SATED_ROUNDS;
        players[s].stunned = 1;
        stunNew.add(s);
        paths[s].push(to, from);
        events.push({ round, step: k, kind: "bite", seat: s, cell: to, color: m.color });
        stopped[s] = true;
        continue;
      }
      players[s].pos = to;
      paths[s].push(to);
      pickUp(s, to, k);
      const t = traps.find((x) => x.state === "armed" && x.cell === to);
      if (t) {
        if (t.color === s) {
          t.state = "disarmed";
          tally[s].disarms++;
          events.push({ round, step: k, kind: "disarm", seat: s, cell: to, color: t.color });
        } else {
          t.state = "sprung";
          hurt(s);
          events.push({ round, step: k, kind: "trap", seat: s, cell: to, color: t.color });
          stopped[s] = true;
        }
      }
    }
  }

  // 🔆 밝히기 — 이번 해결 뒤 빛이 넓어진다
  for (let s = 0; s < players.length; s++) {
    const want = state.plans[s].flare && !skip[s] && players[s].flares > 0;
    players[s].flaring = want;
    if (want) {
      players[s].flares--;
      events.push({ round, step: MOVE_MAX, kind: "flare", seat: s, cell: players[s].pos, color: s });
    }
  }

  // 괴물 퇴치
  for (const m of monsters) {
    if (m.gone) continue;
    const at = monsterCell(m);
    const owner = players[m.color];
    if (owner && neighbors4(w, h, at).includes(owner.pos)) {
      m.gone = true;
      tally[m.color].banishes++;
      events.push({ round, step: MOVE_MAX, kind: "banish", seat: m.color, cell: at, color: m.color });
    }
  }
  // 괴물 이동
  for (const m of monsters) {
    if (m.gone) continue;
    if (m.sated > 0) {
      m.sated--;
      continue;
    }
    const nx = nextMonsterIdx(m);
    m.idx = nx.idx;
    m.dir = nx.dir;
    const at = monsterCell(m);
    const victim = players.findIndex((p) => p.pos === at);
    if (victim >= 0) {
      hurt(victim);
      m.revealed = true;
      m.sated = SATED_ROUNDS;
      players[victim].stunned = 1;
      stunNew.add(victim);
      events.push({ round, step: MOVE_MAX, kind: "bite", seat: victim, cell: at, color: m.color });
    }
  }
  for (let s = 0; s < players.length; s++) {
    if (skip[s]) {
      if (!stunNew.has(s)) players[s].stunned = Math.max(0, players[s].stunned - 1);
      events.push({ round, step: 0, kind: "stunned", seat: s, cell: players[s].pos, color: -1 });
    }
  }

  const shardsDone = shards.every((x) => x.taken);
  const allAtAltar = players.every((p) => p.pos === state.altar);
  if (shardsDone) for (let s = 0; s < players.length; s++) if (players[s].pos === state.altar && prev[s] !== state.altar) events.push({ round, step: MOVE_MAX, kind: "altar", seat: s, cell: state.altar, color: -1 });

  let next: GameState = {
    ...state,
    players,
    traps,
    bridges,
    monsters,
    shards,
    jars,
    tally,
    hearts,
    noBridge: [...noBridge],
    log: addLog(state.log, events),
    lastMoves: { round, from: prev, paths },
  };
  next = refreshSight(next);

  const won = shardsDone && allAtAltar;
  const reason: Outcome["reason"] | null = won ? "escaped" : hearts <= 0 ? "hearts" : round >= state.maxRounds ? "oil" : null;
  if (reason) {
    const jarCount = jars.filter((j) => j.taken).length;
    return {
      ...next,
      phase: "ended",
      stage: state.stage + 1,
      plans: next.plans.map((p) => ({ ...p, ready: true })),
      outcome: { won, reason, stars: starsFor(won, hearts, state.maxHearts, jarCount, jars.length), hearts, jars: jarCount, roundsUsed: round },
    };
  }
  return {
    ...next,
    round: round + 1,
    stage: state.stage + 1,
    plans: players.map(() => ({ steps: [], flare: false, ready: false, planned: false, rev: 0 })),
    pingsLeft: players.map(() => PINGS_PER_ROUND),
    wordsLeft: players.map(() => WORDS_PER_ROUND),
  };
}

function applySignal(state: GameState, a: Extract<EngineAction, { type: "SIGNAL" }>): GameState {
  let next = state;
  const seat = a.seat;
  if (a.ping) {
    const { cell, mark } = a.ping;
    if (!Number.isInteger(cell) || cell < 0 || cell >= state.w * state.h || state.explored[cell] !== "1") return state;
    const mine = state.pings.find((p) => p.seat === seat && p.cell === cell);
    if (mark === "clear" || (mine && mine.mark === mark)) {
      if (!mine) return state;
      next = { ...next, pings: next.pings.filter((p) => p !== mine) };
    } else {
      if (!PING_MARKS.some((m) => m.id === mark) || state.pingsLeft[seat] <= 0) return state;
      let pings = next.pings.filter((p) => p !== mine);
      pings = [...pings, { id: next.nextPingId, seat, cell, mark, round: state.round }];
      const own = pings.filter((p) => p.seat === seat);
      if (own.length > MAX_ACTIVE_PINGS) pings = pings.filter((p) => p !== own[0]);
      next = {
        ...next,
        pings,
        nextPingId: next.nextPingId + 1,
        pingsLeft: next.pingsLeft.map((v, i) => (i === seat ? v - 1 : v)),
        tally: next.tally.map((t, i) => (i === seat ? { ...t, pings: t.pings + 1 } : t)),
      };
    }
  }
  if (a.word !== undefined) {
    if (!Number.isInteger(a.word) || a.word < 0 || a.word >= WORDS.length || next.wordsLeft[seat] <= 0) return next === state ? state : next;
    next = {
      ...next,
      words: [...next.words, { seat, round: state.round, word: a.word }].slice(-30),
      wordsLeft: next.wordsLeft.map((v, i) => (i === seat ? v - 1 : v)),
      tally: next.tally.map((t, i) => (i === seat ? { ...t, words: t.words + 1 } : t)),
    };
  }
  if (next === state) return state;
  return { ...next, idleStreak: bumpIdle(next, seat) };
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  if (action.type === "TIMEOUT") {
    if (state.phase !== "plan" || action.stage !== state.stage) return state;
    const idleStreak = state.idleStreak.map((v, s) => (!state.plans[s].ready && state.plans[s].steps.length === 0 && state.players[s].stunned === 0 ? v + 1 : v));
    return resolveRound({ ...state, idleStreak });
  }
  if (state.phase !== "plan" || action.round !== state.round) return state;
  const seat = action.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seatCount) return state;
  switch (action.type) {
    case "PLAN":
    case "TURN": {
      if (state.players[seat].stunned > 0) return state;
      const cur = state.plans[seat];
      if (action.rev !== undefined && action.rev < cur.rev) return state;
      const steps = validSteps(state, seat, action.steps);
      if (!steps) return state;
      const flare = action.flare === true && state.players[seat].flares > 0;
      const ready = action.type === "TURN";
      if (cur.planned && sameSteps(cur.steps, steps) && cur.flare === flare && cur.ready === ready) return state;
      const rev = action.rev ?? cur.rev + 1;
      const plans = state.plans.map((p, i) => (i === seat ? { steps, flare, ready, planned: true, rev } : p));
      const next = { ...state, plans, idleStreak: bumpIdle(state, seat) };
      return ready && allReady(next) ? resolveRound(next) : next;
    }
    case "READY": {
      if (state.players[seat].stunned > 0) return state;
      const ready = action.ready !== false;
      const cur = state.plans[seat];
      if (action.rev !== undefined && action.rev < cur.rev) return state;
      if (cur.ready === ready) return state;
      const plans = state.plans.map((p, i) => (i === seat ? { ...p, ready, planned: true, rev: action.rev ?? cur.rev + 1 } : p));
      const next = { ...state, plans, idleStreak: bumpIdle(state, seat) };
      return ready && allReady(next) ? resolveRound(next) : next;
    }
    case "SIGNAL":
      return applySignal(state, action);
  }
  return state;
}

/** 지금 행동을 기다리는 좌석 (출발 안 누른 사람) */
export function pendingSeats(state: GameState): Seat[] {
  if (state.phase !== "plan") return [];
  const out: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) if (!state.plans[s].ready && state.players[s].stunned === 0) out.push(s);
  return out;
}

// ------------------------------------------------------------------ 보기 (숨김 정보 거르기)

/**
 * `seat`가 볼 수 있는 상태 — 판·봇이 그대로 쓸 수 있게 모양은 같고 비밀만 지운다.
 * - 지형: 팀이 한 번도 못 비춘 칸은 "?" (지도 구조·조각 위치가 새지 않게)
 * - 다리: 내 색이고 내 빛이 본 적 있거나, 누가 건너서 드러난 것만
 * - 함정: 내 색이고 내 빛이 본 적 있는 것 + 이미 터지거나 해제된 것
 * - 괴물: 내 색이고 지금 내 빛 안에 있거나, 물어서 드러났고 지금 누구 빛 안에 있을 때만 위치.
 *   순찰로는 내 색이 한 번 비췄거나(spotted) 드러난 괴물만. 그 밖의 괴물은 목록에서 빠진다.
 * - 빛 조각·반딧불 병: 탐험된 칸이거나 이미 주운 것만
 * - 남의 seenBy, 시드는 지운다. 계획·핑·한마디·기록·위치는 원래 모두에게 공개.
 */
export function lanternView(state: GameState, seat: Seat): GameState {
  const me = seat >= 0 && seat < state.seatCount ? seat : -1;
  const seen = me >= 0 ? state.seenBy[me] : "";
  const tiles = state.tiles
    .split("")
    .map((t, i) => (state.explored[i] === "1" ? t : T_UNKNOWN))
    .join("");
  const myLit = me >= 0 ? litBy(state, me) : new Set<number>();
  const anyLit = new Set<number>();
  for (let s = 0; s < state.seatCount; s++) for (const c of litBy(state, s)) anyLit.add(c);
  const monsters: Monster[] = [];
  for (const m of state.monsters) {
    if (m.gone) {
      monsters.push({ ...m, path: [monsterCell(m)], idx: 0, dir: 1, sated: 0 });
      continue;
    }
    const at = monsterCell(m);
    const mine = m.color === me;
    const visibleNow = (mine && myLit.has(at)) || (m.revealed && anyLit.has(at));
    const knowsRoute = (mine && m.spotted) || m.revealed;
    if (!visibleNow && !knowsRoute) continue;
    if (knowsRoute) monsters.push({ ...m, idx: visibleNow ? m.idx : -1, dir: visibleNow ? m.dir : 1, sated: visibleNow ? m.sated : 0 });
    else monsters.push({ ...m, path: [at], idx: 0, dir: 1, sated: m.sated, spotted: false });
  }
  return {
    ...state,
    seed: 0,
    viewer: me,
    tiles,
    traps: state.traps.filter((t) => t.state !== "armed" || (t.color === me && seen[t.cell] === "1")),
    bridges: state.bridges.filter((b) => b.revealed || (b.color === me && seen[b.cell] === "1")),
    monsters,
    shards: state.shards.filter((p) => p.taken || state.explored[p.cell] === "1"),
    jars: state.jars.filter((p) => p.taken || state.explored[p.cell] === "1"),
    seenBy: state.seenBy.map((v, i) => (i === me ? v : "")),
  };
}

// ------------------------------------------------------------------ 결과

export interface Ranking {
  seat: Seat;
  rank: number;
}

/** 협력 게임 — 탈출하면 모두 1위, 실패하면 모두 2위 */
export function computeRankings(state: GameState): Ranking[] {
  const won = state.outcome?.won === true;
  return Array.from({ length: state.seatCount }, (_, seat) => ({ seat, rank: won ? 1 : 2 }));
}

export function winnerSeats(state: GameState): Seat[] {
  return state.outcome?.won ? Array.from({ length: state.seatCount }, (_, s) => s) : [];
}

export function forestName(state: Pick<GameState, "options">): string {
  const f = forestById(state.options.forest);
  return `${f.emoji} ${f.name}`;
}

export { FORESTS, T_FLOOR, T_RAVINE, T_TREE, T_UNKNOWN, bfs, manhattan, neighbors4 };
