import { clampFloor, clampWalls, inRect, layoutFor, pushOutRect, type Layout } from "./arena";
import {
  ACCEL,
  BELT_GAP,
  BELT_REACH,
  BELT_SPEED,
  BLACKOUT_BURST,
  BODY_R,
  BOX_INFO,
  BASE_PER_MIN,
  CARRY_MULT,
  CATCH_GRACE_MS,
  CATCH_R,
  COLD_LIFE_MS,
  COUNTDOWN_MS,
  DASH_CD_MS,
  DASH_MS,
  DASH_SPEED,
  DRAG,
  DROP_NOPICK_MS,
  EXPRESS_BONUS,
  EXPRESS_MS,
  FORK_HALF,
  FORK_SPEED,
  FORK_WARN_MS,
  FULL_BONUS,
  HEAVY_DUO,
  HEAVY_HANDLE,
  HEAVY_R,
  HEAVY_SOLO,
  HEAVY_STRONG,
  HOLD_AHEAD,
  INCIDENT_EVERY_MS,
  INCIDENT_FIRST_MS,
  INCIDENT_INFO,
  INCIDENT_KINDS,
  INSPECTOR_COLD_MS,
  KIND_WEIGHTS_EARLY,
  KIND_WEIGHTS_LATE,
  LEVEL_INFO,
  LOAD_GAP_MS,
  MISS_PENALTY,
  REACH,
  RESTITUTION,
  ROLES,
  RUNNER_DASH_CD_MS,
  RUNNER_SPEED,
  SCAN_BONUS,
  SHOT_BONUS,
  STAGGER_DRAG,
  STAGGER_MS,
  STEP_MS,
  THROW_MIN,
  THROW_RANGE,
  THROW_RANGE_PITCHER,
  THROW_SPEED,
  TRUCK_AWAY_MS,
  TRUCK_STAY_MS,
  UNDERDOG_BONUS,
  UNKNOWN_AFTER_MS,
  UNKNOWN_RATE,
  WET_ACCEL,
  WET_DRAG,
  peopleFactor,
  ramp,
  sanitizeOptions,
  starTargets,
  truckCap,
  type BoxKind,
  type GameOptions,
  type IncidentKind,
  type Role,
} from "./data";

/**
 * 택배 대란 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다(상자·트럭·지게차까지 상태에 있다).
 * 그래서 방장이 나가도 손님 하나가 마지막 스냅샷으로 `createHost`를 다시 불러 판을 이어갈 수 있다.
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다 — 같은 입력이면 같은 결과.
 *
 * 한 스텝(1/60초): 봇 생각 → 조작(잡기·놓기·던지기·돌진) → 몸 이동 → 🛋️ 가구 이동(들고 있는 사람들과 한 덩어리) →
 * 몸끼리 부딪힘 → 🚜 지게차 → 든 상자 따라오기 → 🔍 스캔·🚚 싣기 → 날아가는 상자(받기·착지) →
 * 컨베이어(반송) → 🧊 녹음 → 트럭 출발·도착 → 상자 나오기 → 🚨 돌발 사건 → 시간 끝.
 */

export type Phase = "countdown" | "work" | "gameOver";
export type MoveKind = "none" | "dash" | "stagger";

export interface PlayerStats {
  /** 실은 상자 수 / 점수 (덤 포함) */
  loads: number;
  loadValue: number;
  /** 종류별로 실은 수 */
  normals: number;
  fragiles: number;
  colds: number;
  heavies: number;
  expresses: number;
  /** ⚡ 시간 안에 실은 특급 */
  expressOnTime: number;
  /** 🛋️ 둘이 들어 실은 가구 */
  heavyDuo: number;
  /** 🎯 트럭에 던져 넣기 */
  shots: number;
  throws: number;
  /** 날아온 상자 받기 (⚔️ 남의 것 가로채기 포함) */
  catches: number;
  steals: number;
  /** 🔍 스캔 */
  scans: number;
  /** 🚚 마지막 상자로 트럭 가득 채움 */
  fullTrucks: number;
  /** 내가 떨어뜨려 깨진 🥚 · 내가 들고 있다 녹은 🧊 */
  breaks: number;
  dashes: number;
  /** ⚔️ 돌진으로 남의 상자 떨어뜨림 / 당함 */
  knocks: number;
  knocked: number;
  /** 🚜 지게차에 부딪힘 */
  forkHits: number;
  /** 가장 길게 이어 실은 연속 (6초 안에 다음 상자) */
  bestStreak: number;
}

const zeroStats = (): PlayerStats => ({
  loads: 0,
  loadValue: 0,
  normals: 0,
  fragiles: 0,
  colds: 0,
  heavies: 0,
  expresses: 0,
  expressOnTime: 0,
  heavyDuo: 0,
  shots: 0,
  throws: 0,
  catches: 0,
  steals: 0,
  scans: 0,
  fullTrucks: 0,
  breaks: 0,
  dashes: 0,
  knocks: 0,
  knocked: 0,
  forkHits: 0,
  bestStreak: 0,
});

export const STREAK_MS = 6000;

export interface PlayerState {
  seat: number;
  bot: boolean;
  lv: number;
  away: boolean;
  role: Role;
  x: number;
  z: number;
  vx: number;
  vz: number;
  face: number;
  move: MoveKind;
  moveAt: number;
  moveUntil: number;
  dashCdAt: number;
  /** 들고 있는 상자 id (없으면 -1) */
  hold: number;
  /** ⚔️ 개인 점수 (협동은 내가 실은 값) */
  score: number;
  streak: number;
  lastLoadAt: number;
  warnAt: number;
  stats: PlayerStats;
}

export interface Box {
  id: number;
  kind: BoxKind;
  dest: number;
  /** 라벨이 보이나 (❓ 상자는 스캔 전까지 false) */
  known: boolean;
  state: "belt" | "floor" | "held" | "air" | "gone";
  x: number;
  z: number;
  /** 🛋️ 가구 속도 (들고 움직일 때) */
  vx: number;
  vz: number;
  holders: number[];
  /** 들고 있는 사람 손잡이 방향 (가구 중심 기준 각도, holders와 같은 순서) */
  handles: number[];
  bornAt: number;
  /** 🧊 녹는 시각 (0 = 안 녹음) */
  expireAt: number;
  coldExt: boolean;
  /** ⚡ 덤 마감 (0 = 특급 아님) */
  deadline: number;
  noPickUntil: number;
  air: { x0: number; z0: number; x1: number; z1: number; at: number; until: number; by: number } | null;
  /** 마지막으로 든 사람 */
  lastBy: number;
}

export interface DockState {
  dest: number;
  state: "here" | "away";
  /** 실린 상자 */
  load: BoxKind[];
  leaveAt: number;
  backAt: number;
  loadNextAt: number;
  /** 🔀 자리 바꾸기로 잠깐 나간 것 (돌아와도 짐 그대로) */
  swapping: boolean;
  /** 마지막으로 실은 사람 */
  lastBy: number;
  /** 이번 트럭에 실은 사람별 개수 (⚔️ 가득 채움 보너스 몫) */
  shippedTrips: number;
}

export interface Incident {
  k: IncidentKind;
  at: number;
  until: number;
}

export interface Forklift {
  z: number;
  x: number;
  dir: number;
  /** 이 시각까지는 노란 줄 경고만 */
  goAt: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "go" }
  | { k: "spawn"; box: number; kind: BoxKind; unknown: boolean }
  | { k: "grab"; s: number; box: number; kind: BoxKind; x: number; z: number; join: boolean }
  | { k: "put"; s: number; box: number; x: number; z: number }
  | { k: "load"; s: number; dock: number; kind: BoxKind; v: number; shot: boolean; onTime: boolean; duo: boolean; x: number; z: number; streak: number }
  | { k: "truckGo"; dock: number; n: number; full: boolean; bonus: number; s: number }
  | { k: "truckBack"; dock: number; dest: number }
  | { k: "throw"; s: number; box: number; x: number; z: number; tx: number; tz: number }
  | { k: "catch"; s: number; box: number; from: number; steal: boolean; x: number; z: number }
  | { k: "land"; box: number; x: number; z: number }
  | { k: "break"; box: number; s: number; why: "throw" | "knock" | "fork"; x: number; z: number }
  | { k: "melt"; box: number; x: number; z: number }
  | { k: "miss"; box: number; x: number; z: number }
  | { k: "scan"; s: number; box: number; dest: number; x: number; z: number }
  | { k: "blocked"; s: number; why: "wrong" | "unknown" | "away" | "noThrow" }
  | { k: "dash"; s: number }
  | { k: "knock"; a: number; b: number; x: number; z: number }
  | { k: "forkHit"; s: number; x: number; z: number }
  | { k: "bump"; a: number; b: number; x: number; z: number; p: number }
  | { k: "incident"; e: IncidentKind; a: number; b: number }
  | { k: "incidentEnd"; e: IncidentKind }
  | { k: "star"; n: number }
  | { k: "over" }
);

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  workStart: number;
  workEnd: number;
  boxes: Box[];
  boxSeq: number;
  docks: DockState[];
  players: PlayerState[];
  /** 🤝 팀 점수 (⚔️는 개인 점수 합) */
  teamScore: number;
  /** ★ 기준 [1★, 2★, 3★] */
  targets: [number, number, number];
  /** 지금까지 달성한 별 */
  stars: number;
  loaded: number;
  missed: number;
  broken: number;
  melted: number;
  spawned: number;
  nextSpawnAt: number;
  /** 정전 뒤 몰아서 나올 상자 */
  burst: number;
  incident: Incident | null;
  nextIncidentAt: number;
  lastIncident: IncidentKind | null;
  fork: Forklift | null;
  events: GameEvent[];
  eventSeq: number;
  ranks: number[] | null;
}

export interface SeatSpec {
  bot: boolean;
  level: number;
}

/* ── 난수 ───────────────────────────────────────────────────────────── */

export function rnd(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ── 조회 ───────────────────────────────────────────────────────────── */

const layoutCache = new Map<number, Layout>();
export function layoutOf(s: { seatCount: number }): Layout {
  let L = layoutCache.get(s.seatCount);
  if (!L) layoutCache.set(s.seatCount, (L = layoutFor(s.seatCount)));
  return L;
}

export const isCoop = (s: MatchState) => s.options.mode === "coop";

export function boxOf(s: MatchState, id: number): Box | undefined {
  return s.boxes.find((b) => b.id === id);
}

export function isWet(s: MatchState): boolean {
  return s.incident?.k === "wet" && s.t < s.incident.until;
}
export function isBlackout(s: MatchState): boolean {
  return s.incident?.k === "blackout" && s.t < s.incident.until;
}
export function isRush(s: MatchState): boolean {
  return s.incident?.k === "rush" && s.t < s.incident.until;
}
export function isLabelChaos(s: MatchState): boolean {
  return s.incident?.k === "labels" && s.t < s.incident.until;
}

export function throwRange(p: PlayerState): number {
  return p.role === "pitcher" ? THROW_RANGE_PITCHER : THROW_RANGE;
}

export function dashCd(p: PlayerState): number {
  return p.role === "runner" ? RUNNER_DASH_CD_MS : DASH_CD_MS;
}

export function isUnderdog(s: MatchState, p: PlayerState): boolean {
  if (isCoop(s) || s.phase !== "work") return false;
  const vals = s.players.map((q) => q.score);
  const lo = Math.min(...vals);
  return lo !== Math.max(...vals) && p.score === lo && vals.filter((v) => v === lo).length === 1;
}

/** 빈손 이동 속도 배수 */
export function speedMult(s: MatchState, p: PlayerState): number {
  let m = 1;
  if (p.role === "runner") m += RUNNER_SPEED;
  if (isUnderdog(s, p)) m += UNDERDOG_BONUS;
  if (p.hold >= 0 && p.role !== "strong") m *= CARRY_MULT;
  return m;
}

/** 이 상자를 어느 트럭(칸 번호)에 실어야 하나 (-1 = 지금 그 목적지 트럭이 없음) */
export function dockFor(s: MatchState, dest: number): number {
  return s.docks.findIndex((d) => d.dest === dest);
}

/** 점수 (협동은 팀, 경쟁은 그 사람) */
function addScore(s: MatchState, seat: number, v: number) {
  if (seat >= 0 && s.players[seat]) s.players[seat].score += v;
  s.teamScore += v;
}

/* ── 준비 ───────────────────────────────────────────────────────────── */

function newPlayer(seat: number, spec: SeatSpec): PlayerState {
  return {
    seat,
    bot: spec.bot,
    lv: Math.max(1, Math.min(10, Math.round(spec.level || 5))),
    away: false,
    role: "none",
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    face: -Math.PI / 2,
    move: "none",
    moveAt: 0,
    moveUntil: 0,
    dashCdAt: 0,
    hold: -1,
    score: 0,
    streak: 0,
    lastLoadAt: -1e9,
    warnAt: 0,
    stats: zeroStats(),
  };
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const seatCount = Math.max(1, seats.length);
  const opts = sanitizeOptions(options, seatCount);
  const players = seats.map((spec, i) => newPlayer(i, spec));
  const L = layoutFor(seatCount);
  const workEnd = COUNTDOWN_MS + opts.seconds * 1000;
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount,
    options: opts,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: COUNTDOWN_MS,
    workStart: COUNTDOWN_MS,
    workEnd,
    boxes: [],
    boxSeq: 0,
    docks: [],
    players,
    teamScore: 0,
    targets: starTargets(seatCount, opts.seconds, opts.level),
    stars: 0,
    loaded: 0,
    missed: 0,
    broken: 0,
    melted: 0,
    spawned: 0,
    nextSpawnAt: COUNTDOWN_MS + 400,
    burst: 0,
    incident: null,
    nextIncidentAt: COUNTDOWN_MS + INCIDENT_FIRST_MS,
    lastIncident: null,
    fork: null,
    events: [],
    eventSeq: 0,
    ranks: null,
  };
  // 목적지: 칸마다 하나 (판마다 순서를 섞는다)
  const dests = L.docks.map((_, k) => k);
  for (let i = dests.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [dests[i], dests[j]] = [dests[j], dests[i]];
  }
  s.docks = L.docks.map((_, k) => ({
    dest: dests[k],
    state: "here",
    load: [],
    // 트럭마다 떠나는 시각을 엇갈리게
    leaveAt: COUNTDOWN_MS + TRUCK_STAY_MS + k * 7000,
    backAt: 0,
    loadNextAt: 0,
    swapping: false,
    lastBy: -1,
    shippedTrips: 0,
  }));
  // 역할: 섞어서 자리 순서대로 (5~6명은 두 번째 바퀴)
  if (opts.roles) {
    const order = [...ROLES];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd(s) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    players.forEach((p, i) => (p.role = order[i % order.length]));
  }
  // 시작 자리: 가운데 줄 (선반 아래·컨베이어 위)
  const z = (L.racks[0].z1 + (L.belt.z - L.belt.hw)) / 2;
  players.forEach((p, i) => {
    p.x = -L.W / 2 + 3 + ((L.W - 6) * (i + 0.5)) / seatCount;
    p.z = z;
    p.face = -Math.PI / 2;
  });
  return s;
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  mx: number;
  mz: number;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  grab: number;
  throw: number;
  dash: number;
  /** 던지는 거리 (최대의 몇 배, 0.25~1) — 봇이 트럭을 겨냥할 때. 사람은 1 */
  aim?: number;
}

export interface BotMemory {
  nextThinkAt: number;
  plan: "fetch" | "deliver" | "scan" | "help" | "wait" | "wander" | "steal";
  target: number;
  tx: number;
  tz: number;
  stuckAt: number;
  lastX: number;
  lastZ: number;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seen: { grab: number; throw: number; dash: number }[];
  req: { grab: number; throw: number; dash: number }[];
  acc: number;
  bots: BotMemory[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, grab: 0, throw: 0, dash: 0, aim: 1 });

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seen: Array.from({ length: n }, () => ({ grab: 0, throw: 0, dash: 0 })),
    req: Array.from({ length: n }, () => ({ grab: -1, throw: -1, dash: -1 })),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, plan: "wander" as const, target: -1, tx: 0, tz: 0, stuckAt: 0, lastX: 0, lastZ: 0 })),
    think,
    botRng: { rng: (state.seed ^ 0x5bd1e995) | 0 },
  };
}

export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= rt.state.seatCount) return;
  if (rt.state.players[seat].bot) return;
  setInput(rt, seat, inp);
}

export function setInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput>) {
  const cur = rt.inputs[seat];
  let mx = Number(inp.mx) || 0;
  let mz = Number(inp.mz) || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  cur.mx = mx;
  cur.mz = mz;
  const aim = Number(inp.aim);
  cur.aim = Number.isFinite(aim) ? Math.max(0.25, Math.min(1, aim)) : 1;
  for (const k of ["grab", "throw", "dash"] as const) {
    const v = Number(inp[k]) || 0;
    if (v > rt.seen[seat][k]) {
      rt.seen[seat][k] = v;
      rt.req[seat][k] = rt.state.t;
    }
    cur[k] = v;
  }
}

export function press(rt: HostRuntime, seat: number, what: "grab" | "throw" | "dash") {
  rt.req[seat][what] = rt.state.t;
}

/** 사람이 나가면 봇이 대신, 돌아오면 돌려준다 (들고 있던 상자는 그대로) */
export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p) return;
  if (away && !p.bot) {
    p.bot = true;
    p.away = true;
  } else if (!away && p.away) {
    p.bot = false;
    p.away = false;
    rt.inputs[seat] = idleInput();
    rt.seen[seat] = { grab: 0, throw: 0, dash: 0 };
  }
}

/* ── 진행 ───────────────────────────────────────────────────────────── */

export function hostStep(rt: HostRuntime, dtMs: number) {
  rt.acc += Math.min(dtMs, 250);
  while (rt.acc >= STEP_MS) {
    rt.acc -= STEP_MS;
    step(rt);
  }
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventBody = DistOmit<GameEvent, "id" | "at">;

export function emit(s: MatchState, e: EventBody) {
  s.events.push({ ...(e as object), id: ++s.eventSeq, at: s.t } as GameEvent);
}

export function step(rt: HostRuntime) {
  const s = rt.state;
  s.t += STEP_MS;
  if (s.phase === "countdown") {
    if (s.t >= s.phaseEnd) {
      s.phase = "work";
      s.phaseStart = s.t;
      emit(s, { k: "go" });
    }
  } else if (s.phase === "work") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    work(rt);
  } else {
    for (const p of s.players) {
      p.vx *= 0.9;
      p.vz *= 0.9;
      p.x += (p.vx * STEP_MS) / 1000;
      p.z += (p.vz * STEP_MS) / 1000;
    }
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function work(rt: HostRuntime) {
  const s = rt.state;
  const L = layoutOf(s);
  const dt = STEP_MS / 1000;
  for (const p of s.players) control(rt, p, L);
  for (const p of s.players) if (!heavyHeld(s, p)) moveBody(rt, p, dt, L);
  for (const b of s.boxes) if (b.kind === "heavy" && b.state === "held") moveHeavy(rt, b, dt, L);
  collideBodies(s);
  if (s.fork) forklift(s, dt, L);
  followHeld(s);
  scanAndLoad(s, L);
  airBoxes(s, L);
  belt(s, dt, L);
  expiry(s);
  trucks(s);
  spawns(s, L);
  incidents(s, L);
  if (s.boxes.some((b) => b.state === "gone")) s.boxes = s.boxes.filter((b) => b.state !== "gone");
  updateStars(s);
  if (s.t >= s.workEnd) finishMatch(s);
}

function heavyHeld(s: MatchState, p: PlayerState): boolean {
  if (p.hold < 0) return false;
  const b = boxOf(s, p.hold);
  return !!b && b.kind === "heavy";
}

/* ── 조작 ───────────────────────────────────────────────────────────── */

function control(rt: HostRuntime, p: PlayerState, L: Layout) {
  const s = rt.state;
  const r = rt.req[p.seat];
  const fresh = (at: number) => at >= 0 && s.t - at <= 200;
  if (r.grab >= 0 && !fresh(r.grab)) r.grab = -1;
  if (r.throw >= 0 && !fresh(r.throw)) r.throw = -1;
  if (r.dash >= 0 && !fresh(r.dash)) r.dash = -1;
  if (p.move === "stagger") return;
  if (r.grab >= 0) {
    r.grab = -1;
    if (p.hold >= 0) release(s, p, L);
    else tryGrab(s, p, L);
  }
  if (r.throw >= 0) {
    r.throw = -1;
    if (p.hold >= 0) throwBox(rt, p, L);
  }
  if (r.dash >= 0 && p.move === "none" && s.t >= p.dashCdAt) {
    if (heavyHeld(s, p)) {
      r.dash = -1;
    } else {
      r.dash = -1;
      const inp = rt.inputs[p.seat];
      const l = Math.hypot(inp.mx, inp.mz);
      const dx = l > 0.2 ? inp.mx / l : Math.cos(p.face);
      const dz = l > 0.2 ? inp.mz / l : Math.sin(p.face);
      const sp = DASH_SPEED * (p.hold >= 0 && p.role !== "strong" ? 0.85 : 1);
      p.vx = dx * sp;
      p.vz = dz * sp;
      p.face = Math.atan2(dz, dx);
      p.move = "dash";
      p.moveAt = s.t;
      p.moveUntil = s.t + DASH_MS;
      p.dashCdAt = s.t + dashCd(p);
      p.stats.dashes += 1;
      emit(s, { k: "dash", s: p.seat });
    }
  }
}

/** 잡을 수 있는 상자 중 가장 좋은 것 (가깝고 앞에 있는 것) */
export function grabTarget(s: MatchState, p: PlayerState): Box | null {
  let best: Box | null = null;
  let bs = Infinity;
  const fx = Math.cos(p.face);
  const fz = Math.sin(p.face);
  for (const b of s.boxes) {
    let reach: number;
    if (b.state === "belt") reach = BELT_REACH;
    else if (b.state === "floor") reach = REACH + (b.kind === "heavy" ? 0.35 : 0);
    else if (b.state === "held" && b.kind === "heavy" && b.holders.length === 1 && isCoop(s) && !b.holders.includes(p.seat)) reach = HEAVY_HANDLE + 0.6;
    else continue;
    if (b.state !== "held" && s.t < b.noPickUntil) continue;
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > reach) continue;
    const dot = d > 1e-6 ? (dx * fx + dz * fz) / d : 1;
    const sc = d - dot * 0.35;
    if (sc < bs) {
      bs = sc;
      best = b;
    }
  }
  return best;
}

function tryGrab(s: MatchState, p: PlayerState, L: Layout) {
  const b = grabTarget(s, p);
  if (!b) return;
  if (b.state === "held") {
    // 🛋️ 팀원이 혼자 든 가구에 붙기 — 반대쪽 손잡이
    const other = s.players[b.holders[0]];
    const a0 = Math.atan2(other.z - b.z, other.x - b.x);
    const a1 = a0 + Math.PI;
    b.holders.push(p.seat);
    b.handles = [a0, a1];
    p.hold = b.id;
    const hx = b.x + Math.cos(a1) * HEAVY_HANDLE;
    const hz = b.z + Math.sin(a1) * HEAVY_HANDLE;
    const q = clampFloor(L, hx, hz, BODY_R);
    p.x = q.x;
    p.z = q.z;
    p.vx = b.vx;
    p.vz = b.vz;
    emit(s, { k: "grab", s: p.seat, box: b.id, kind: b.kind, x: b.x, z: b.z, join: true });
    return;
  }
  b.state = "held";
  b.holders = [p.seat];
  b.handles = [Math.atan2(p.z - b.z, p.x - b.x)];
  b.vx = 0;
  b.vz = 0;
  b.lastBy = p.seat;
  p.hold = b.id;
  p.face = Math.atan2(b.z - p.z, b.x - p.x);
  emit(s, { k: "grab", s: p.seat, box: b.id, kind: b.kind, x: b.x, z: b.z, join: false });
  if (p.role === "inspector") {
    if (!b.known) scan(s, b, p.seat);
    if (b.kind === "cold" && !b.coldExt && b.expireAt > 0) {
      b.coldExt = true;
      b.expireAt += INSPECTOR_COLD_MS;
    }
  }
}

/** 손에서 놓기 (내려놓기). 가구를 둘이 들고 있으면 나만 손을 뗀다 */
function release(s: MatchState, p: PlayerState, L: Layout) {
  const b = boxOf(s, p.hold);
  p.hold = -1;
  if (!b) return;
  const i = b.holders.indexOf(p.seat);
  if (i >= 0) {
    b.holders.splice(i, 1);
    b.handles.splice(i, 1);
  }
  if (b.holders.length > 0) return;
  const r = b.kind === "heavy" ? HEAVY_R : 0.3;
  const fx = b.kind === "heavy" ? b.x : p.x + Math.cos(p.face) * HOLD_AHEAD;
  const fz = b.kind === "heavy" ? b.z : p.z + Math.sin(p.face) * HOLD_AHEAD;
  const q = clampFloor(L, fx, fz, r);
  b.state = "floor";
  b.x = q.x;
  b.z = q.z;
  b.vx = 0;
  b.vz = 0;
  b.noPickUntil = 0;
  emit(s, { k: "put", s: p.seat, box: b.id, x: b.x, z: b.z });
}

/** 손에서 떨어뜨림 (부딪힘·지게차). 🥚는 깨진다 */
export function knockOut(s: MatchState, p: PlayerState, L: Layout, why: "knock" | "fork", pushX: number, pushZ: number) {
  const b = boxOf(s, p.hold);
  p.hold = -1;
  if (!b) return;
  const i = b.holders.indexOf(p.seat);
  if (i >= 0) {
    b.holders.splice(i, 1);
    b.handles.splice(i, 1);
  }
  if (b.holders.length > 0) return;
  if (b.kind === "fragile") {
    breakBox(s, b, p.seat, why);
    return;
  }
  const r = b.kind === "heavy" ? HEAVY_R : 0.3;
  const q = clampFloor(L, b.x + pushX * 0.9, b.z + pushZ * 0.9, r);
  b.state = "floor";
  b.x = q.x;
  b.z = q.z;
  b.vx = 0;
  b.vz = 0;
  b.noPickUntil = s.t + DROP_NOPICK_MS;
  emit(s, { k: "put", s: p.seat, box: b.id, x: b.x, z: b.z });
}

function breakBox(s: MatchState, b: Box, seat: number, why: "throw" | "knock" | "fork") {
  b.state = "gone";
  b.holders = [];
  s.broken += 1;
  if (seat >= 0 && s.players[seat]) s.players[seat].stats.breaks += 1;
  if (isCoop(s)) s.teamScore -= MISS_PENALTY;
  emit(s, { k: "break", box: b.id, s: seat, why, x: b.x, z: b.z });
}

function throwBox(rt: HostRuntime, p: PlayerState, L: Layout) {
  const s = rt.state;
  const b = boxOf(s, p.hold);
  if (!b) return;
  if (b.kind === "heavy") {
    emit(s, { k: "blocked", s: p.seat, why: "noThrow" });
    return;
  }
  const inp = rt.inputs[p.seat];
  const l = Math.hypot(inp.mx, inp.mz);
  const a = l > 0.3 ? Math.atan2(inp.mz, inp.mx) : p.face;
  p.face = a;
  const range = Math.max(THROW_MIN, throwRange(p) * (inp.aim ?? 1));
  const x0 = p.x + Math.cos(a) * HOLD_AHEAD;
  const z0 = p.z + Math.sin(a) * HOLD_AHEAD;
  let x1 = x0 + Math.cos(a) * range;
  let z1 = z0 + Math.sin(a) * range;
  // 윗벽 너머 = 트럭 칸이면 그대로 트럭으로, 아니면 벽에서 멈춘다
  const topIntoDock = z1 < -L.H / 2 && L.docks.some((d) => x1 >= d.zone.x0 && x1 <= d.zone.x1);
  if (topIntoDock) z1 = -L.H / 2 + 0.6;
  x1 = Math.max(-L.W / 2 + 0.3, Math.min(L.W / 2 - 0.3, x1));
  z1 = Math.max(-L.H / 2 + 0.3, Math.min(L.H / 2 - 0.3, z1));
  const dist = Math.hypot(x1 - x0, z1 - z0);
  p.hold = -1;
  b.holders = [];
  b.handles = [];
  b.state = "air";
  b.x = x0;
  b.z = z0;
  b.air = { x0, z0, x1, z1, at: s.t, until: s.t + Math.max(350, (dist / THROW_SPEED) * 1000), by: p.seat };
  b.lastBy = p.seat;
  p.stats.throws += 1;
  emit(s, { k: "throw", s: p.seat, box: b.id, x: x0, z: z0, tx: x1, tz: z1 });
}

/* ── 이동 ───────────────────────────────────────────────────────────── */

function moveBody(rt: HostRuntime, p: PlayerState, dt: number, L: Layout) {
  const s = rt.state;
  const inp = rt.inputs[p.seat];
  const wet = isWet(s);
  if (p.move !== "none" && s.t >= p.moveUntil) p.move = "none";
  if (p.move === "dash") {
    // 돌진: 속도 유지
  } else if (p.move === "stagger") {
    const k = Math.exp(-STAGGER_DRAG * dt);
    p.vx *= k;
    p.vz *= k;
  } else {
    const accel = (wet ? WET_ACCEL : ACCEL) * speedMult(s, p);
    const drag = wet ? WET_DRAG : DRAG;
    p.vx += (inp.mx * accel - p.vx * drag) * dt;
    p.vz += (inp.mz * accel - p.vz * drag) * dt;
    if (Math.hypot(inp.mx, inp.mz) > 0.15) {
      const want = Math.atan2(inp.mz, inp.mx);
      let d = want - p.face;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.face += d * Math.min(1, dt * 14);
    }
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  solidCollide(L, p, BODY_R);
}

/** 몸·가구를 선반·컨베이어·벽 밖으로 (부딪힌 쪽 속도는 튕김) */
function solidCollide(L: Layout, o: { x: number; z: number; vx: number; vz: number }, r: number) {
  for (const sd of L.solids) {
    const n = pushOutRect(sd, o, r);
    if (n) bounce(o, n.nx, n.nz);
  }
  const w = clampWalls(L, o, r);
  if (w) bounce(o, w.nx, w.nz);
}

function bounce(o: { vx: number; vz: number }, nx: number, nz: number) {
  const vn = o.vx * nx + o.vz * nz;
  if (vn < 0) {
    o.vx -= (1 + RESTITUTION) * vn * nx;
    o.vz -= (1 + RESTITUTION) * vn * nz;
  }
}

/** 🛋️ 가구: 들고 있는 사람들의 입력 평균으로 한 덩어리처럼 움직인다 (둘이 같은 쪽으로 밀어야 빠르다) */
function moveHeavy(rt: HostRuntime, b: Box, dt: number, L: Layout) {
  const s = rt.state;
  const hs = b.holders.map((i) => s.players[i]).filter(Boolean);
  if (hs.length === 0) return;
  let ix = 0;
  let iz = 0;
  for (const h of hs) {
    if (h.move === "stagger") continue;
    ix += rt.inputs[h.seat].mx;
    iz += rt.inputs[h.seat].mz;
  }
  // 둘이면 합 ÷ 2 — 한 명만 밀면 절반 힘
  ix /= Math.max(1, hs.length);
  iz /= Math.max(1, hs.length);
  const duo = hs.length >= 2;
  const mult = duo ? HEAVY_DUO : hs[0].role === "strong" ? HEAVY_STRONG : HEAVY_SOLO;
  const wet = isWet(s);
  const accel = (wet ? WET_ACCEL : ACCEL) * mult;
  const drag = wet ? WET_DRAG : DRAG;
  b.vx += (ix * accel - b.vx * drag) * dt;
  b.vz += (iz * accel - b.vz * drag) * dt;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  solidCollide(L, b, HEAVY_R);
  // 혼자 들면 손잡이가 움직이는 반대쪽(뒤에서 민다)으로 천천히 돈다
  if (!duo && Math.hypot(ix, iz) > 0.2) {
    const want = Math.atan2(-iz, -ix);
    let d = want - b.handles[0];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.handles[0] += d * Math.min(1, dt * 5);
  }
  // 사람 위치 = 가구 + 손잡이. 사람이 벽에 막히면 가구도 같이 밀린다
  for (let pass = 0; pass < 2; pass++) {
    hs.forEach((h, k) => {
      const a = b.handles[k];
      const q = { x: b.x + Math.cos(a) * HEAVY_HANDLE, z: b.z + Math.sin(a) * HEAVY_HANDLE, vx: 0, vz: 0 };
      const ox = q.x;
      const oz = q.z;
      solidCollide(L, q, BODY_R);
      const px = q.x - ox;
      const pz = q.z - oz;
      if (Math.abs(px) + Math.abs(pz) > 1e-5) {
        b.x += px;
        b.z += pz;
        if (px * b.vx < 0) b.vx *= 0.3;
        if (pz * b.vz < 0) b.vz *= 0.3;
      }
    });
    solidCollide(L, b, HEAVY_R);
  }
  hs.forEach((h, k) => {
    const a = b.handles[k];
    h.x = b.x + Math.cos(a) * HEAVY_HANDLE;
    h.z = b.z + Math.sin(a) * HEAVY_HANDLE;
    h.vx = b.vx;
    h.vz = b.vz;
    h.face = a + Math.PI;
    if (h.move === "dash") h.move = "none";
  });
}

function coHolders(s: MatchState, a: PlayerState, b: PlayerState): boolean {
  if (a.hold < 0 || a.hold !== b.hold) return false;
  return true;
}

function collideBodies(s: MatchState) {
  const ps = s.players;
  const L = layoutOf(s);
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      if (coHolders(s, a, b)) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = BODY_R * 2;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d;
      const nz = dz / d;
      const over = min - d;
      const aHeavy = heavyHeld(s, a);
      const bHeavy = heavyHeld(s, b);
      // 가구를 든 사람은 안 밀린다 (상대만)
      const ka = aHeavy ? 0 : bHeavy ? 1 : 0.5;
      const kb = 1 - ka;
      a.x -= nx * over * ka;
      a.z -= nz * over * ka;
      b.x += nx * over * kb;
      b.z += nz * over * kb;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = -(1 + RESTITUTION) * rv * 0.5;
        if (!aHeavy) {
          a.vx -= imp * nx;
          a.vz -= imp * nz;
        }
        if (!bHeavy) {
          b.vx += imp * nx;
          b.vz += imp * nz;
        }
        if (-rv > 3) emit(s, { k: "bump", a: a.seat, b: b.seat, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, p: -rv });
      }
      // ⚔️ 돌진으로 들이받으면 상대가 든 상자를 떨어뜨린다 (가구 제외)
      if (!isCoop(s)) {
        for (const [atk, vic, sx] of [
          [a, b, 1],
          [b, a, -1],
        ] as const) {
          if (atk.move !== "dash" || vic.hold < 0 || vic.move === "stagger") continue;
          const vb = boxOf(s, vic.hold);
          if (!vb || vb.kind === "heavy") continue;
          knockOut(s, vic, L, "knock", nx * sx, nz * sx);
          vic.move = "stagger";
          vic.moveAt = s.t;
          vic.moveUntil = s.t + STAGGER_MS;
          vic.vx += nx * sx * 4;
          vic.vz += nz * sx * 4;
          atk.stats.knocks += 1;
          vic.stats.knocked += 1;
          emit(s, { k: "knock", a: atk.seat, b: vic.seat, x: vic.x, z: vic.z });
        }
      }
    }
}

/* ── 🚜 지게차 ───────────────────────────────────────────────────── */

function forklift(s: MatchState, dt: number, L: Layout) {
  const f = s.fork!;
  if (s.t < f.goAt) return;
  f.x += f.dir * FORK_SPEED * dt;
  if ((f.dir > 0 && f.x > L.W / 2 + 2.5) || (f.dir < 0 && f.x < -L.W / 2 - 2.5)) {
    s.fork = null;
    return;
  }
  for (const p of s.players) {
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    if (Math.abs(dx) > FORK_HALF.x + BODY_R || Math.abs(dz) > FORK_HALF.z + BODY_R) continue;
    const side = dz >= 0 ? 1 : -1;
    if (p.move !== "stagger") {
      if (p.hold >= 0) knockOut(s, p, L, "fork", 0, side);
      p.move = "stagger";
      p.moveAt = s.t;
      p.moveUntil = s.t + STAGGER_MS;
      p.stats.forkHits += 1;
      emit(s, { k: "forkHit", s: p.seat, x: p.x, z: p.z });
    }
    p.z = f.z + side * (FORK_HALF.z + BODY_R + 0.02);
    p.vz = side * 5;
    p.vx += f.dir * 2;
  }
  for (const b of s.boxes) {
    if (b.state !== "floor") continue;
    const r = b.kind === "heavy" ? HEAVY_R : 0.3;
    if (Math.abs(b.x - f.x) > FORK_HALF.x + r || Math.abs(b.z - f.z) > FORK_HALF.z + r) continue;
    const side = b.z >= f.z ? 1 : -1;
    const q = clampFloor(L, b.x, f.z + side * (FORK_HALF.z + r + 0.05), r);
    b.x = q.x;
    b.z = q.z;
  }
}

/* ── 든 상자 · 스캔 · 싣기 ─────────────────────────────────────────── */

function followHeld(s: MatchState) {
  for (const p of s.players) {
    if (p.hold < 0) continue;
    const b = boxOf(s, p.hold);
    if (!b || b.state !== "held") {
      p.hold = -1;
      continue;
    }
    if (b.kind === "heavy") continue;
    b.x = p.x + Math.cos(p.face) * HOLD_AHEAD;
    b.z = p.z + Math.sin(p.face) * HOLD_AHEAD;
  }
}

function scan(s: MatchState, b: Box, seat: number) {
  b.known = true;
  const p = s.players[seat];
  if (p) p.stats.scans += 1;
  addScore(s, seat, SCAN_BONUS);
  emit(s, { k: "scan", s: seat, box: b.id, dest: b.dest, x: b.x, z: b.z });
}

function scanAndLoad(s: MatchState, L: Layout) {
  for (const b of s.boxes) {
    if (b.state !== "held") continue;
    const hs = b.holders.map((i) => s.players[i]).filter(Boolean);
    if (!b.known) {
      const sc = L.scanner;
      if (hs.some((h) => Math.hypot(h.x - sc.x, h.z - sc.z) <= sc.r) || Math.hypot(b.x - sc.x, b.z - sc.z) <= sc.r) scan(s, b, hs[0]?.seat ?? -1);
    }
    for (let k = 0; k < L.docks.length; k++) {
      const zone = L.docks[k].zone;
      const inside = hs.some((h) => inRect(zone, h.x, h.z)) || inRect(zone, b.x, b.z);
      if (!inside) continue;
      const d = s.docks[k];
      const warn = (why: "wrong" | "unknown" | "away") => {
        for (const h of hs) {
          if (s.t < h.warnAt) continue;
          h.warnAt = s.t + 1500;
          emit(s, { k: "blocked", s: h.seat, why });
        }
      };
      if (!b.known) {
        warn("unknown");
        continue;
      }
      if (d.dest !== b.dest) {
        warn("wrong");
        continue;
      }
      if (d.state !== "here") {
        warn("away");
        continue;
      }
      if (s.t < d.loadNextAt) continue;
      loadBox(s, b, k, hs.map((h) => h.seat), false);
      break;
    }
  }
}

function loadBox(s: MatchState, b: Box, dockIdx: number, seats: number[], shot: boolean) {
  const d = s.docks[dockIdx];
  const onTime = b.kind === "express" && s.t <= b.deadline;
  const v = BOX_INFO[b.kind].value + (onTime ? EXPRESS_BONUS : 0) + (shot ? SHOT_BONUS : 0);
  const duo = seats.length >= 2;
  const L = layoutOf(s);
  // 점수: 협동은 팀(실은 사람에게도 기록), 경쟁은 실은 사람(둘이면 나눔)
  const share = Math.round(v / Math.max(1, seats.length));
  for (const seat of seats) {
    const p = s.players[seat];
    if (!p) continue;
    p.hold = -1;
    p.score += share;
    const st = p.stats;
    st.loads += 1;
    st.loadValue += share;
    if (b.kind === "normal") st.normals += 1;
    else if (b.kind === "fragile") st.fragiles += 1;
    else if (b.kind === "cold") st.colds += 1;
    else if (b.kind === "heavy") st.heavies += 1;
    else st.expresses += 1;
    if (onTime) st.expressOnTime += 1;
    if (duo) st.heavyDuo += 1;
    if (shot) st.shots += 1;
    p.streak = s.t - p.lastLoadAt <= STREAK_MS ? p.streak + 1 : 1;
    p.lastLoadAt = s.t;
    st.bestStreak = Math.max(st.bestStreak, p.streak);
  }
  s.teamScore += share * Math.max(1, seats.length);
  s.loaded += 1;
  b.state = "gone";
  b.holders = [];
  d.load.push(b.kind);
  d.loadNextAt = s.t + LOAD_GAP_MS;
  d.lastBy = seats[0] ?? -1;
  emit(s, { k: "load", s: seats[0] ?? -1, dock: dockIdx, kind: b.kind, v, shot, onTime, duo, x: L.docks[dockIdx].x, z: L.docks[dockIdx].z, streak: s.players[seats[0]]?.streak ?? 1 });
  if (d.load.length >= truckCap(s.seatCount)) truckLeave(s, dockIdx, true);
}

function truckLeave(s: MatchState, k: number, full: boolean) {
  const d = s.docks[k];
  const bonus = full ? FULL_BONUS : 0;
  if (full) {
    const seat = d.lastBy;
    if (seat >= 0 && s.players[seat]) {
      s.players[seat].stats.fullTrucks += 1;
      s.players[seat].score += bonus;
    }
    s.teamScore += bonus;
  }
  emit(s, { k: "truckGo", dock: k, n: d.load.length, full, bonus, s: d.lastBy });
  d.state = "away";
  d.backAt = s.t + TRUCK_AWAY_MS;
  d.swapping = false;
  d.shippedTrips += 1;
}

/* ── 날아가는 상자 ───────────────────────────────────────────────── */

function airBoxes(s: MatchState, L: Layout) {
  for (const b of s.boxes) {
    if (b.state !== "air" || !b.air) continue;
    const a = b.air;
    const u = Math.min(1, (s.t - a.at) / Math.max(1, a.until - a.at));
    b.x = a.x0 + (a.x1 - a.x0) * u;
    b.z = a.z0 + (a.z1 - a.z0) * u;
    // 받기: 빈손인 사람이 가까이 (던진 사람 제외, 날아가는 마지막 85%까지)
    if (s.t - a.at >= CATCH_GRACE_MS && u < 0.97) {
      let catcher: PlayerState | null = null;
      let cd = CATCH_R;
      for (const p of s.players) {
        if (p.seat === a.by || p.hold >= 0 || p.move === "stagger") continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d <= cd) {
          cd = d;
          catcher = p;
        }
      }
      if (catcher) {
        const steal = !isCoop(s);
        b.state = "held";
        b.air = null;
        b.holders = [catcher.seat];
        b.handles = [0];
        b.lastBy = catcher.seat;
        catcher.hold = b.id;
        catcher.stats.catches += 1;
        if (steal) catcher.stats.steals += 1;
        emit(s, { k: "catch", s: catcher.seat, box: b.id, from: a.by, steal, x: b.x, z: b.z });
        if (catcher.role === "inspector" && !b.known) scan(s, b, catcher.seat);
        continue;
      }
    }
    if (s.t < a.until) continue;
    // 착지
    b.air = null;
    const k = L.docks.findIndex((d) => inRect(d.zone, a.x1, a.z1, 0.2));
    if (k >= 0 && b.known && s.docks[k].dest === b.dest && s.docks[k].state === "here") {
      loadBox(s, b, k, [a.by], true);
      continue;
    }
    const thrower = s.players[a.by];
    if (b.kind === "fragile" && thrower?.role !== "pitcher") {
      b.x = a.x1;
      b.z = a.z1;
      breakBox(s, b, a.by, "throw");
      continue;
    }
    const q = clampFloor(L, a.x1, a.z1, 0.3);
    b.state = "floor";
    b.x = q.x;
    b.z = q.z;
    b.noPickUntil = s.t + 150;
    emit(s, { k: "land", box: b.id, x: b.x, z: b.z });
  }
}

/* ── 컨베이어 · 녹음 · 트럭 · 나오기 ─────────────────────────────── */

function belt(s: MatchState, dt: number, L: Layout) {
  if (isBlackout(s)) return;
  for (const b of s.boxes) {
    if (b.state !== "belt") continue;
    b.x += BELT_SPEED * dt;
    b.z = L.belt.z;
    if (b.x >= L.belt.x1) {
      b.state = "gone";
      s.missed += 1;
      if (isCoop(s)) s.teamScore -= MISS_PENALTY;
      emit(s, { k: "miss", box: b.id, x: L.belt.x1, z: L.belt.z });
    }
  }
}

function expiry(s: MatchState) {
  for (const b of s.boxes) {
    if (b.state === "gone" || b.expireAt <= 0 || s.t < b.expireAt) continue;
    for (const seat of b.holders) {
      const p = s.players[seat];
      if (p) {
        p.hold = -1;
        p.stats.breaks += 1;
      }
    }
    b.state = "gone";
    b.holders = [];
    s.melted += 1;
    if (isCoop(s)) s.teamScore -= MISS_PENALTY;
    emit(s, { k: "melt", box: b.id, x: b.x, z: b.z });
  }
}

function trucks(s: MatchState) {
  s.docks.forEach((d, k) => {
    if (d.state === "here") {
      if (s.t < d.leaveAt) return;
      if (d.load.length === 0) {
        // 빈 트럭은 그냥 더 기다린다
        d.leaveAt = s.t + TRUCK_STAY_MS / 2;
        return;
      }
      truckLeave(s, k, false);
    } else if (s.t >= d.backAt) {
      d.state = "here";
      if (d.swapping) {
        d.swapping = false;
        d.leaveAt = Math.max(d.leaveAt, s.t + 15_000);
      } else {
        d.load = [];
        d.leaveAt = s.t + TRUCK_STAY_MS;
      }
      emit(s, { k: "truckBack", dock: k, dest: d.dest });
    }
  });
}

function pickWeighted(s: MatchState, table: [BoxKind, number][]): BoxKind {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rnd(s) * total;
  for (const [k, w] of table) {
    r -= w;
    if (r <= 0) return k;
  }
  return table[0][0];
}

/** 근무 진행(0~1)에 따른 종류 비율 */
export function kindTable(s: MatchState): [BoxKind, number][] {
  const u = Math.min(1, Math.max(0, (s.t - s.workStart) / (s.workEnd - s.workStart)));
  const out: [BoxKind, number][] = KIND_WEIGHTS_EARLY.map(([k, w], i) => [k, w + (KIND_WEIGHTS_LATE[i][1] - w) * u]);
  if (isRush(s)) for (const row of out) if (row[0] === "express") row[1] += 35;
  return out;
}

/** 지금 분당 상자 수 */
export function spawnRate(s: MatchState): number {
  const u = (s.t - s.workStart) / (s.workEnd - s.workStart);
  return BASE_PER_MIN * peopleFactor(s.seatCount) * LEVEL_INFO[s.options.level].rate * ramp(u) * (isRush(s) ? 2 : 1);
}

export function spawnBox(s: MatchState, L: Layout, kind?: BoxKind, opts: { unknown?: boolean; x?: number; z?: number; state?: Box["state"] } = {}): Box {
  const k = kind ?? pickWeighted(s, kindTable(s));
  const unknown = opts.unknown ?? ((isLabelChaos(s) || (s.t - s.workStart >= UNKNOWN_AFTER_MS && rnd(s) < UNKNOWN_RATE)) && k !== "heavy");
  const dest = s.docks[Math.floor(rnd(s) * s.docks.length)].dest;
  const b: Box = {
    id: ++s.boxSeq,
    kind: k,
    dest,
    known: !unknown,
    state: opts.state ?? "belt",
    x: opts.x ?? L.belt.x0 + 0.45,
    z: opts.z ?? L.belt.z,
    vx: 0,
    vz: 0,
    holders: [],
    handles: [],
    bornAt: s.t,
    expireAt: k === "cold" ? s.t + COLD_LIFE_MS : 0,
    coldExt: false,
    deadline: k === "express" ? s.t + EXPRESS_MS : 0,
    noPickUntil: 0,
    air: null,
    lastBy: -1,
  };
  s.boxes.push(b);
  s.spawned += 1;
  emit(s, { k: "spawn", box: b.id, kind: k, unknown });
  return b;
}

function spawns(s: MatchState, L: Layout) {
  if (isBlackout(s)) return;
  const due = s.t >= s.nextSpawnAt || s.burst > 0;
  if (!due) return;
  // 컨베이어 입구가 비어 있어야 나온다
  const blocked = s.boxes.some((b) => b.state === "belt" && b.x < L.belt.x0 + 0.45 + BELT_GAP);
  if (blocked) return;
  spawnBox(s, L);
  if (s.burst > 0) s.burst -= 1;
  else {
    const interval = 60_000 / Math.max(0.1, spawnRate(s));
    s.nextSpawnAt = s.t + interval * (0.75 + rnd(s) * 0.5);
  }
}

/* ── 🚨 돌발 사건 ──────────────────────────────────────────────────── */

function incidents(s: MatchState, L: Layout) {
  const inc = s.incident;
  if (inc && s.t >= inc.until) {
    s.incident = null;
    if (inc.k === "blackout") s.burst += BLACKOUT_BURST;
    emit(s, { k: "incidentEnd", e: inc.k });
  }
  if (!s.options.incidents || s.incident || s.t < s.nextIncidentAt) return;
  // 마지막 8초엔 새 사건 없음
  if (s.workEnd - s.t < 8000) return;
  const here = s.docks.map((d, k) => (d.state === "here" ? k : -1)).filter((k) => k >= 0);
  const pool = INCIDENT_KINDS.filter((k) => k !== s.lastIncident && !(k === "swap" && here.length < 2));
  const k = pool[Math.floor(rnd(s) * pool.length)];
  s.lastIncident = k;
  s.nextIncidentAt = s.t + INCIDENT_EVERY_MS;
  s.incident = { k, at: s.t, until: s.t + INCIDENT_INFO[k].ms };
  let a = -1;
  let b = -1;
  if (k === "swap") {
    a = here[Math.floor(rnd(s) * here.length)];
    const rest = here.filter((x) => x !== a);
    b = rest[Math.floor(rnd(s) * rest.length)];
    const da = s.docks[a];
    const db = s.docks[b];
    // 트럭이 통째로 자리를 바꾼다 (짐·떠나는 시각 그대로)
    [da.dest, db.dest] = [db.dest, da.dest];
    [da.load, db.load] = [db.load, da.load];
    [da.leaveAt, db.leaveAt] = [db.leaveAt, da.leaveAt];
    for (const d of [da, db]) {
      d.state = "away";
      d.swapping = true;
      d.backAt = s.t + INCIDENT_INFO.swap.ms;
    }
  } else if (k === "forklift") {
    const lane = L.lanes[Math.floor(rnd(s) * L.lanes.length)];
    const dir = rnd(s) < 0.5 ? 1 : -1;
    s.fork = { z: lane, x: dir > 0 ? -L.W / 2 - 2 : L.W / 2 + 2, dir, goAt: s.t + FORK_WARN_MS };
    a = L.lanes.indexOf(lane);
    b = dir;
  }
  emit(s, { k: "incident", e: k, a, b });
}

/* ── 별 · 끝 ─────────────────────────────────────────────────────── */

export function starsFor(s: MatchState, score = s.teamScore): number {
  return s.targets.filter((t) => score >= t).length;
}

function updateStars(s: MatchState) {
  if (!isCoop(s)) return;
  const n = starsFor(s);
  if (n > s.stars) {
    s.stars = n;
    emit(s, { k: "star", n });
  }
}

export function computeRanks(s: MatchState): number[] {
  if (isCoop(s)) {
    const ok = starsFor(s) >= 1;
    return s.players.map(() => (ok ? 1 : 2));
  }
  const key = (p: PlayerState) => [p.score, p.stats.loads, -p.stats.breaks];
  return s.players.map((p) => {
    const kp = key(p);
    let better = 0;
    for (const q of s.players) {
      const kq = key(q);
      for (let i = 0; i < kp.length; i++) {
        if (kq[i] > kp[i]) {
          better++;
          break;
        }
        if (kq[i] < kp[i]) break;
      }
    }
    return better + 1;
  });
}

function finishMatch(s: MatchState) {
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.fork = null;
  s.incident = null;
  // 들고 있던 상자는 그대로 내려놓는다 (점수 없음)
  for (const p of s.players) {
    p.hold = -1;
    p.move = "none";
  }
  s.stars = isCoop(s) ? starsFor(s) : 0;
  s.ranks = computeRanks(s);
  emit(s, { k: "over" });
}

export function timeLeft(s: MatchState): number {
  if (s.phase === "countdown") return s.workEnd - s.workStart;
  if (s.phase === "gameOver") return 0;
  return Math.max(0, s.workEnd - s.t);
}
