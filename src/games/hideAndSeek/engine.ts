import { BASE, DIST, NEIGHBORS, SPOTS, spot, type RoomId } from "./house";

/**
 * 한밤의 숨바꼭질 — 2~6인 동시 행동 숨바꼭질. 룰 원전: boardGameRule/숨바꼭질/숨바꼭질.md (자체 창작 룰).
 *
 * 핵심
 * - 라운드마다 한 명이 술래(돌아가며). 나머지는 비공개로 저택의 숨을 곳 25곳 중 하나를 고른다.
 * - 술래 턴(라운드당 SEEK_TURNS번): 모두 몰래 고르고(커밋) 동시에 공개(리빌).
 *   - 술래: 🔍 뒤지기(1칸 안의 숨을 곳 하나, 그 방으로 이동) · 🚶 이동(2칸까지) · 🔦 손전등(옆방 인원 확인, 라운드당 2번)
 *   - 숨은 사람: 🤫 숨죽이기 · 🐾 살금살금(같은 방/옆방의 다른 곳으로, 떠난 방에 "삐걱" 소리) · 🏃 찜!(마당과 붙은 방에서 술래 기둥으로)
 *   - 같은 곳에서 ITCH_AT턴 연달아 숨죽이면 다리가 저려 매 턴 그 방에 "부스럭" 소리가 난다.
 *   - 잡힌 사람은 술래 편 "꼬마 술래"가 되어 같이 뒤진다.
 * - 판정: 찜하러 뛴 사람은 술래가 마당이나 그 방으로 오면 잡힌다. 움직인 사람이 술래(꼬마 술래)가
 *   들어온 방에 멈추면 딱 마주쳐 잡힌다. 뒤진 곳에 있던 사람은 잡힌다. 술래가 멈춘 방에 누가 있으면
 *   "인기척"이 공개된다.
 * - 마지막 턴까지 안 잡히면 "못 찾겠다 꾀꼬리" — 살아남은 사람 점수.
 * - 점수: 찜 +3 · 끝까지 생존 +2 · 술래는 잡힌 사람마다 +2 · 꼬마 술래는 직접 잡을 때마다 +1. 모든 라운드 합계로 순위.
 *
 * 신뢰 모델: 락스텝이라 각 기기가 전체 상태(숨은 위치 포함)를 들고 있다 — 다른 락스텝 게임과 같은
 * 문서화된 한계(docs/architecture.md §2). 화면과 봇은 공개 정보만 쓴다(`publicTurns`, 자기 자리).
 */

export type Seat = number;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const SCORE_HOME = 3;
export const SCORE_SURVIVE = 2;
export const SCORE_CATCH = 2;
export const SCORE_HELPER = 1;
export const FLASH_CHARGES = 2;
export const SEEKER_MOVE = 2;
export const SEARCH_RANGE = 1;
/** 같은 곳에서 이만큼 연달아 숨죽이면 다리가 저려 꼼지락 — 그 방에 부스럭 소리(매 턴) */
export const ITCH_AT = 3;

/** 숨은 사람 수에 맞춘 술래 턴 수 — 셀프플레이로 맞췄다(봇끼리 잡힘 비율 40~55%) */
export function seekTurnsFor(hiders: number): number {
  return hiders <= 1 ? 8 : hiders === 2 ? 9 : 10;
}

export type MoveKind = "hide" | "stay" | "sneak" | "home" | "search" | "move" | "flash";
export interface Move {
  kind: MoveKind;
  spot?: string;
  room?: RoomId;
}

export type Status = "seeker" | "hiding" | "caught" | "home" | "safe";

export interface Tally {
  catches: number;
  homes: number;
  survives: number;
  /** 술래로 한 라운드에 전원을 잡음 */
  sweeps: number;
  /** 꼬마 술래로 잡은 수 */
  helperCatches: number;
  /** 술래가 같은 방에 있었는데도 안 잡힌 턴 */
  closeCalls: number;
  /** 찜 막기(뛰던 사람을 잡음) */
  blocks: number;
}
const EMPTY_TALLY: Tally = { catches: 0, homes: 0, survives: 0, sweeps: 0, helperCatches: 0, closeCalls: 0, blocks: 0 };

export interface SeatState {
  score: number;
  roundScore: number;
  status: Status;
  /** 지금 있는 방 (숨은 사람이면 비공개) */
  room: RoomId;
  /** 숨은 곳 (비공개) */
  spot: string | null;
  /** 같은 곳에서 연달아 숨죽인 턴 (비공개 — 결과인 부스럭 소리만 공개) */
  still: number;
  caughtTurn: number | null;
  tally: Tally;
}

/** 공개 사건 — 화면·봇이 추리에 쓰는 정보는 전부 여기에 있다 */
export type TurnEvent =
  | { t: "move"; seat: Seat; from: RoomId; to: RoomId; helper: boolean }
  | { t: "search"; seat: Seat; spot: string; found: Seat[]; helper: boolean }
  | { t: "flash"; seat: Seat; room: RoomId; count: number }
  | { t: "noise"; room: RoomId; count: number }
  | { t: "rustle"; room: RoomId; count: number }
  | { t: "bump"; seat: Seat; victim: Seat; room: RoomId; helper: boolean }
  | { t: "home"; seat: Seat; from: RoomId }
  | { t: "blocked"; seat: Seat; by: Seat; from: RoomId; where: RoomId }
  | { t: "sense"; room: RoomId; present: boolean }
  | { t: "survive"; seats: Seat[] }
  | { t: "sweep"; seat: Seat };

export interface PublicTurn {
  turn: number;
  events: TurnEvent[];
}

export type Phase = "choosing" | "revealing" | "resolved" | "ended";
export type Step = "hide" | "seek";

export interface GameOptions {
  /** 고르기 제한 시간(초). 0 = 무제한 */
  chooseSeconds: number;
  /** 1 = 모두 한 번씩 술래, 2 = 두 바퀴 */
  laps: number;
}
export const DEFAULT_OPTIONS: GameOptions = { chooseSeconds: 20, laps: 1 };

export interface GameState {
  seed: number;
  seatCount: number;
  options: GameOptions;
  seats: SeatState[];
  round: number;
  rounds: number;
  seeker: Seat;
  step: Step;
  /** 술래 턴 번호 (숨기 단계는 0) */
  turn: number;
  seekTurns: number;
  flashes: number;
  phase: Phase;
  /** 단계가 바뀔 때마다 +1 — 타이머/재접속 판정용 */
  stage: number;
  commits: (string | null)[];
  moves: (Move | null)[];
  /** 방금 판정된 턴의 사건 */
  events: TurnEvent[];
  /** 이번 라운드의 공개 기록 (턴 순서) */
  history: PublicTurn[];
  /** 판정 직후 이 라운드가 끝났나 */
  roundOver: boolean;
  ready: boolean[];
  idleStreak: number[];
}

export type EngineAction =
  | { type: "COMMIT"; seat: Seat; round: number; turn: number; hash: string }
  | { type: "REVEAL"; seat: Seat; round: number; turn: number; move: Move; salt: string }
  | { type: "READY"; seat: Seat; round: number; turn: number }
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

export function moveHash(move: Move, salt: string): string {
  const body = `${move.kind}:${move.spot ?? "-"}:${move.room ?? "-"}`;
  return `${cyrb53(body + "|" + salt, 7)}${cyrb53(salt + "|" + body, 13)}`;
}

// ---------------------------------------------------------------------------
// 시작

function freshSeat(): SeatState {
  return { score: 0, roundScore: 0, status: "hiding", room: BASE, spot: null, still: 0, caughtTurn: null, tally: { ...EMPTY_TALLY } };
}

export function roundsFor(seatCount: number, laps: number): number {
  return seatCount * Math.max(1, laps) * (seatCount === 2 ? 2 : 1);
}

export function startGame(seatCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, seatCount));
  const base: GameState = {
    seed,
    seatCount: n,
    options,
    seats: Array.from({ length: n }, freshSeat),
    round: 0,
    rounds: roundsFor(n, options.laps),
    seeker: 0,
    step: "hide",
    turn: 0,
    seekTurns: seekTurnsFor(n - 1),
    flashes: FLASH_CHARGES,
    phase: "choosing",
    stage: 0,
    commits: Array(n).fill(null),
    moves: Array(n).fill(null),
    events: [],
    history: [],
    roundOver: false,
    ready: Array(n).fill(false),
    idleStreak: Array(n).fill(0),
  };
  return startRound(base, 1);
}

function startRound(state: GameState, round: number): GameState {
  const n = state.seatCount;
  const seeker = (round - 1 + (state.seed % n)) % n;
  const seats = state.seats.map((s, i): SeatState => ({
    ...s,
    roundScore: 0,
    status: i === seeker ? "seeker" : "hiding",
    room: BASE,
    spot: null,
    still: 0,
    caughtTurn: null,
  }));
  return {
    ...state,
    seats,
    round,
    seeker,
    step: "hide",
    turn: 0,
    flashes: FLASH_CHARGES,
    phase: "choosing",
    stage: state.stage + 1,
    commits: seats.map((s) => (s.status === "hiding" ? null : "x")),
    moves: Array(n).fill(null),
    events: [],
    history: [],
    roundOver: false,
    ready: Array(n).fill(false),
  };
}

// ---------------------------------------------------------------------------
// 합법 행동

/** 이번 단계에 행동을 내야 하는 자리 */
export function isActing(state: GameState, seat: Seat): boolean {
  const s = state.seats[seat];
  if (!s) return false;
  if (state.step === "hide") return s.status === "hiding";
  return s.status === "seeker" || s.status === "caught" || s.status === "hiding";
}

export function legalMoves(state: GameState, seat: Seat): Move[] {
  if (state.phase === "ended" || !isActing(state, seat)) return [];
  const me = state.seats[seat];
  if (state.step === "hide") return SPOTS.map((sp) => ({ kind: "hide", spot: sp.id }));
  if (me.status === "hiding") {
    const out: Move[] = [{ kind: "stay" }];
    for (const sp of SPOTS) {
      if (sp.id === me.spot || sp.room === BASE) continue;
      if (DIST[me.room][sp.room] <= 1) out.push({ kind: "sneak", spot: sp.id });
    }
    if (NEIGHBORS[me.room].includes(BASE)) out.push({ kind: "home" });
    return out;
  }
  const helper = me.status === "caught";
  const out: Move[] = [];
  for (const sp of SPOTS) if (DIST[me.room][sp.room] <= SEARCH_RANGE) out.push({ kind: "search", spot: sp.id });
  const reach = helper ? 1 : SEEKER_MOVE;
  for (const r of Object.keys(DIST[me.room]) as RoomId[]) if (DIST[me.room][r] <= reach) out.push({ kind: "move", room: r });
  if (!helper && state.flashes > 0) for (const r of NEIGHBORS[me.room]) if (r !== BASE) out.push({ kind: "flash", room: r });
  return out;
}

export function isLegal(state: GameState, seat: Seat, move: Move): boolean {
  return legalMoves(state, seat).some((m) => m.kind === move.kind && (m.spot ?? "") === (move.spot ?? "") && (m.room ?? "") === (move.room ?? ""));
}

/** 시간 초과/무효 제출의 기본 행동 */
export function defaultMove(state: GameState, seat: Seat): Move {
  const me = state.seats[seat];
  if (state.step === "hide") {
    const k = Math.abs((state.seed >>> 3) + seat * 7 + state.round * 13) % SPOTS.length;
    return { kind: "hide", spot: SPOTS[k].id };
  }
  if (me.status === "hiding") return { kind: "stay" };
  return { kind: "move", room: me.room };
}

function clean(move: Move): Move {
  return { kind: move.kind, ...(move.spot !== undefined ? { spot: move.spot } : {}), ...(move.room !== undefined ? { room: move.room } : {}) };
}

// ---------------------------------------------------------------------------
// 판정

function resolveHide(state: GameState): GameState {
  const seats = state.seats.map((s, i) => {
    if (s.status !== "hiding") return s;
    const m = state.moves[i];
    const legal = m && isLegal(state, i, m) ? m : defaultMove(state, i);
    const sp = spot(legal.spot!)!;
    return { ...s, spot: sp.id, room: sp.room };
  });
  return finishResolve(state, seats, [], false);
}

function resolveSeek(state: GameState): GameState {
  const n = state.seatCount;
  const moves: (Move | null)[] = state.seats.map((s, i) => {
    if (!isActing(state, i)) return null;
    const m = state.moves[i];
    return m && isLegal(state, i, m) ? m : defaultMove(state, i);
  });
  const seats = state.seats.map((s) => ({ ...s, tally: { ...s.tally } }));
  const events: TurnEvent[] = [];
  let flashes = state.flashes;
  const seekerSeat = state.seeker;

  // 0) 술래 편의 도착 방
  const hunters = seats.map((s, i) => i).filter((i) => seats[i].status === "seeker" || seats[i].status === "caught");
  const endRoom: Partial<Record<Seat, RoomId>> = {};
  for (const h of hunters) {
    const m = moves[h]!;
    const from = seats[h].room;
    const to = m.kind === "search" ? spot(m.spot!)!.room : m.kind === "move" ? m.room! : from;
    endRoom[h] = to;
    if (to !== from) events.push({ t: "move", seat: h, from, to, helper: h !== seekerSeat });
  }
  const seekerEnd = endRoom[seekerSeat]!;
  const catchBy = (victim: Seat, by: Seat) => {
    const v = seats[victim];
    v.status = "caught";
    v.caughtTurn = state.turn;
    v.spot = null;
    seats[seekerSeat].roundScore += SCORE_CATCH;
    seats[seekerSeat].tally.catches++;
    if (by !== seekerSeat) {
      seats[by].roundScore += SCORE_HELPER;
      seats[by].tally.helperCatches++;
    }
  };

  // 1) 찜! — 술래가 마당이나 그 방으로 오면 가로막힌다
  for (let i = 0; i < n; i++) {
    if (seats[i].status !== "hiding" || moves[i]?.kind !== "home") continue;
    const from = seats[i].room;
    if (seekerEnd === BASE || seekerEnd === from) {
      catchBy(i, seekerSeat);
      seats[i].room = seekerEnd;
      seats[seekerSeat].tally.blocks++;
      events.push({ t: "blocked", seat: i, by: seekerSeat, from, where: seekerEnd });
    } else {
      seats[i].status = "home";
      seats[i].room = BASE;
      seats[i].spot = null;
      seats[i].roundScore += SCORE_HOME;
      seats[i].tally.homes++;
      events.push({ t: "home", seat: i, from });
    }
  }

  // 2) 살금살금 — 떠난 방에 소리, 술래 편이 멈춘 방에 들어서면 딱 마주친다
  const noise = new Map<RoomId, number>();
  for (let i = 0; i < n; i++) {
    if (seats[i].status !== "hiding" || moves[i]?.kind !== "sneak") continue;
    const from = seats[i].room;
    const sp = spot(moves[i]!.spot!)!;
    noise.set(from, (noise.get(from) ?? 0) + 1);
    seats[i].still = 0;
    seats[i].room = sp.room;
    seats[i].spot = sp.id;
    const by = seekerEnd === sp.room ? seekerSeat : hunters.find((h) => endRoom[h] === sp.room);
    if (by !== undefined) {
      catchBy(i, by);
      events.push({ t: "bump", seat: by, victim: i, room: sp.room, helper: by !== seekerSeat });
    }
  }
  for (const [r, count] of noise) events.push({ t: "noise", room: r, count });

  // 2-1) 다리 저림 — 오래 숨죽인 사람의 방에서 부스럭
  const rustle = new Map<RoomId, number>();
  for (let i = 0; i < n; i++) {
    if (seats[i].status !== "hiding" || moves[i]?.kind !== "stay") continue;
    seats[i].still += 1;
    if (seats[i].still >= ITCH_AT) rustle.set(seats[i].room, (rustle.get(seats[i].room) ?? 0) + 1);
  }
  for (const [r, count] of rustle) events.push({ t: "rustle", room: r, count });

  // 3) 뒤지기
  for (const h of hunters) {
    const m = moves[h]!;
    if (m.kind !== "search") continue;
    const found = seats.map((_, i) => i).filter((i) => seats[i].status === "hiding" && seats[i].spot === m.spot);
    for (const f of found) catchBy(f, h);
    events.push({ t: "search", seat: h, spot: m.spot!, found, helper: h !== seekerSeat });
  }

  // 4) 손전등
  const sm = moves[seekerSeat]!;
  if (sm.kind === "flash" && flashes > 0) {
    flashes--;
    const count = seats.filter((s) => s.status === "hiding" && s.room === sm.room).length;
    events.push({ t: "flash", seat: seekerSeat, room: sm.room!, count });
  }

  // 술래 편 이동 확정
  for (const h of hunters) seats[h].room = endRoom[h]!;

  // 5) 인기척 — 술래가 멈춘 방
  if (seekerEnd !== BASE) {
    const near = seats.map((_, i) => i).filter((i) => seats[i].status === "hiding" && seats[i].room === seekerEnd);
    for (const i of near) seats[i].tally.closeCalls++;
    events.push({ t: "sense", room: seekerEnd, present: near.length > 0 });
  }

  const left = seats.filter((s) => s.status === "hiding").length;
  const lastTurn = state.turn >= state.seekTurns;
  let roundOver = left === 0 || lastTurn;
  if (roundOver) {
    const survivors = seats.map((_, i) => i).filter((i) => seats[i].status === "hiding");
    for (const i of survivors) {
      seats[i].status = "safe";
      seats[i].roundScore += SCORE_SURVIVE;
      seats[i].tally.survives++;
    }
    if (survivors.length) events.push({ t: "survive", seats: survivors });
    const hiders = seats.filter((_, i) => i !== seekerSeat);
    if (hiders.length > 0 && hiders.every((s) => s.status === "caught")) {
      seats[seekerSeat].tally.sweeps++;
      events.push({ t: "sweep", seat: seekerSeat });
    }
    roundOver = true;
  }
  return finishResolve({ ...state, flashes }, seats, events, roundOver);
}

function finishResolve(state: GameState, seats: SeatState[], events: TurnEvent[], roundOver: boolean): GameState {
  const n = state.seatCount;
  const finalSeats = roundOver ? seats.map((s) => ({ ...s, score: s.score + s.roundScore })) : seats;
  const ended = roundOver && state.round >= state.rounds;
  return {
    ...state,
    seats: finalSeats,
    moves: Array(n).fill(null),
    events,
    history: state.step === "seek" ? [...state.history, { turn: state.turn, events }] : state.history,
    roundOver,
    phase: ended ? "ended" : "resolved",
    stage: state.stage + 1,
    ready: Array(n).fill(false),
  };
}

function resolveTurn(state: GameState): GameState {
  return state.step === "hide" ? resolveHide(state) : resolveSeek(state);
}

function toRevealing(state: GameState): GameState {
  return maybeResolve({ ...state, phase: "revealing", stage: state.stage + 1 });
}

function maybeResolve(state: GameState): GameState {
  // "x" = 커밋 없이 넘어간 자리(행동 없음 / 시간 초과 기본 행동)
  const waiting = state.commits.some((c, i) => c !== null && c !== "x" && state.moves[i] === null);
  return waiting ? state : resolveTurn(state);
}

function nextTurn(state: GameState): GameState {
  if (state.roundOver) return startRound(state, state.round + 1);
  const n = state.seatCount;
  const next: GameState = { ...state, step: "seek", turn: state.turn + 1, phase: "choosing", stage: state.stage + 1, events: [], ready: Array(n).fill(false), moves: Array(n).fill(null) };
  return { ...next, commits: next.seats.map((_, i) => (isActing(next, i) ? null : "x")) };
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "COMMIT": {
      if (state.phase !== "choosing" || action.round !== state.round || action.turn !== state.turn) return state;
      if (!isActing(state, action.seat) || state.commits[action.seat] !== null) return state;
      const commits = state.commits.map((c, i) => (i === action.seat ? String(action.hash) : c));
      const idleStreak = state.idleStreak.map((v, i) => (i === action.seat ? 0 : v));
      const next = { ...state, commits, idleStreak };
      return commits.every((c) => c !== null) ? toRevealing(next) : next;
    }
    case "REVEAL": {
      if (state.phase !== "revealing" || action.round !== state.round || action.turn !== state.turn) return state;
      const hash = state.commits[action.seat];
      if (!hash || hash === "x" || state.moves[action.seat] !== null) return state;
      const ok = moveHash(action.move, action.salt) === hash && isLegal(state, action.seat, action.move);
      const move = ok ? clean(action.move) : defaultMove(state, action.seat);
      const moves = state.moves.map((m, i) => (i === action.seat ? move : m));
      return maybeResolve({ ...state, moves });
    }
    case "READY": {
      if (state.phase !== "resolved" || action.round !== state.round || action.turn !== state.turn || state.ready[action.seat]) return state;
      const ready = state.ready.map((r, i) => (i === action.seat ? true : r));
      return ready.every(Boolean) ? nextTurn({ ...state, ready }) : { ...state, ready };
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      if (state.phase === "choosing") {
        const idleStreak = state.idleStreak.map((v, i) => (state.commits[i] === null ? v + 1 : v));
        const moves = state.moves.map((m, i) => (state.commits[i] === null ? defaultMove(state, i) : m));
        const commits = state.commits.map((c) => c ?? "x");
        return toRevealing({ ...state, idleStreak, moves, commits });
      }
      if (state.phase === "revealing") return resolveTurn(state);
      if (state.phase === "resolved") return nextTurn(state);
      return state;
    }
  }
  return state;
}

/** 지금 무언가를 기다리는 자리 */
export function pendingSeats(state: GameState): Seat[] {
  const all = state.seats.map((_, i) => i);
  switch (state.phase) {
    case "choosing":
      return all.filter((i) => state.commits[i] === null);
    case "revealing":
      return all.filter((i) => state.commits[i] !== null && state.commits[i] !== "x" && state.moves[i] === null);
    case "resolved":
      return all.filter((i) => !state.ready[i]);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 공개 정보 / 결과

export function hidersLeft(state: GameState): number {
  return state.seats.filter((s) => s.status === "hiding").length;
}

/** 이 자리의 위치가 viewer에게 보이나 (술래 편·찜·생존 공개는 보인다, 숨은 사람은 본인만) */
export function positionVisible(state: GameState, seat: Seat, viewer: Seat): boolean {
  const s = state.seats[seat];
  if (seat === viewer) return true;
  if (state.phase === "ended" || state.roundOver) return true;
  return s.status !== "hiding";
}

export interface Ranking {
  seat: Seat;
  rank: number;
}

export function computeRankings(state: GameState): Ranking[] {
  // 점수 → 찜 횟수 → 잡은 수
  const cmp = (a: Seat, b: Seat) => {
    const x = state.seats[a];
    const y = state.seats[b];
    return y.score - x.score || y.tally.homes - x.tally.homes || y.tally.catches - x.tally.catches;
  };
  const order = state.seats.map((_, i) => i).sort(cmp);
  const out: Ranking[] = [];
  order.forEach((seat, idx) => {
    const prev = out[idx - 1];
    const rank = prev && cmp(order[idx - 1], seat) === 0 ? prev.rank : idx + 1;
    out.push({ seat, rank });
  });
  return out;
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state).filter((r) => r.rank === 1).map((r) => r.seat);
}
