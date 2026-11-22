import { buildTower, onPlatform, platPos, type Platform, type Tower } from "./tower";
import {
  AIR_JUMP_V,
  AIR_K,
  BASE_R,
  BODY_R,
  BOOTS_MS,
  BOOTS_MUL,
  BOUNCE_V,
  CAUGHT_DEPTH,
  COLLAPSE_ACCEL,
  COLLAPSE_DELAY_MS,
  COLLAPSE_START_Y,
  COLLAPSE_V0,
  COLLAPSE_VMAX,
  COUNTDOWN_FIRST_MS,
  COUNTDOWN_MS,
  COYOTE_MS,
  CRUMBLE_MS,
  FALL_MAX,
  FINAL_CALL_MUL,
  FOOT_MARGIN,
  GRAVITY,
  GROUND_K,
  ICE_BAND_UP,
  ICE_MS,
  ICY_K,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_KINDS,
  ITEM_LIFE_MS,
  ITEM_MAX,
  ITEM_PICK_R,
  JUMP_BUFFER_MS,
  JUMP_V,
  PILLAR_R,
  RESPAWN_MS,
  ROCK_COUNT,
  ROCK_R,
  ROCK_WARN_MS,
  ROUND_END_MS,
  ROUND_MAX_MS,
  RUN_SPEED,
  SAB_FIRST_MS,
  SAB_GAP,
  SAB_GHOST_MS,
  SAB_KINDS,
  SAB_LAST_MS,
  SAB_PICK_MS,
  SHAKE_MS,
  SHIELD_MS,
  SHOVE_CD_MS,
  SHOVE_CONE,
  SHOVE_LIFT,
  SHOVE_PUSH,
  SHOVE_R,
  STAGGER_MS,
  STEP_MS,
  WIND_ACCEL,
  WIND_MS,
  WIND_WARN_MS,
  finishPoints,
  sanitizeOptions,
  type GameOptions,
  type ItemKind,
  type SabKind,
} from "./data";

/**
 * 무너지는 탑 오르기 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되는 순수 데이터다. 탑 모양은 `towerSeed`로 양쪽이 똑같이
 * 다시 짓고, 상태에는 발판마다 바뀌는 값(무너짐·금·얼음)만 담는다. 방장이 나가면 손님 하나가 마지막
 * 스냅샷으로 `createHost`를 다시 불러 판을 이어간다(방장 승계). 난수는 상태 안의 `rng`만 쓴다.
 *
 * 한 스텝(1/60초): 봇 생각 → 몸(점프·밀치기·달리기·중력·착지) → 몸끼리 → 발판(금·무너짐·다시 생김)
 * → 붕괴선 → 탈락 → 아이템 → 방해 카드(낙석·돌풍) → 라운드 끝 판정.
 */

export type Phase = "countdown" | "climb" | "roundEnd" | "gameOver";
export type Status = "climb" | "done" | "out";

export interface PlayerStats {
  jumps: number;
  airJumps: number;
  bounces: number;
  shoves: number;
  /** 밀치기로 맞힌 사람 수 */
  shoveHits: number;
  /** 3m 넘게 떨어진 횟수 */
  drops: number;
  finishes: number;
  roundWins: number;
  /** 붕괴에 휩쓸림 */
  caught: number;
  cards: number;
  /** 내 방해 카드에 맞은(낙석·흔들기로 떨어진) 사람 */
  sabHits: number;
  items: number;
  blocks: number;
  /** 라운드마다 가장 높이 오른 높이 합 (동점 가르기) */
  heightSum: number;
  bestHeight: number;
  /** 가장 빠른 등정 (ms, 0 = 없음) */
  fastestMs: number;
}

const zeroStats = (): PlayerStats => ({
  jumps: 0,
  airJumps: 0,
  bounces: 0,
  shoves: 0,
  shoveHits: 0,
  drops: 0,
  finishes: 0,
  roundWins: 0,
  caught: 0,
  cards: 0,
  sabHits: 0,
  items: 0,
  blocks: 0,
  heightSum: 0,
  bestHeight: 0,
  fastestMs: 0,
});

export interface SabCard {
  kinds: SabKind[];
  until: number;
}

export interface PlayerState {
  seat: number;
  bot: boolean;
  lv: number;
  away: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  face: number;
  /** 서 있는 발판 번호 (-1 = 공중) */
  on: number;
  /** 마지막으로 밟은 발판 (트램펄린 포함) */
  lastOn: number;
  /** 걸어서 발판을 벗어난 시각 (코요테 타임) */
  groundAt: number;
  /** 이번에 공중에 뜬 뒤 가장 높았던 높이 (큰 낙하 기록) */
  airTop: number;
  status: Status;
  /** 등정 순서 (0 = 아직) */
  place: number;
  /** 탈락 순서 (0 = 아직) */
  outOrder: number;
  doneAt: number;
  /** 이번 라운드 가장 높이 */
  best: number;
  staggerUntil: number;
  shoveCdAt: number;
  feather: boolean;
  bootsUntil: number;
  shieldUntil: number;
  card: SabCard | null;
  cardAt: number;
  lastHitBy: number;
  lastHitAt: number;
  score: number;
  roundPts: number;
  stats: PlayerStats;
}

export interface Item {
  id: number;
  kind: ItemKind;
  plat: number;
  until: number;
}

export interface Rock {
  id: number;
  x: number;
  z: number;
  /** 맞는 높이 (보낼 때 선두 발밑) */
  y: number;
  at: number;
  by: number;
}

export interface Wind {
  at: number;
  until: number;
  minY: number;
  by: number;
  /** 방패로 막은 사람 */
  immune: number[];
}

export type GameEvent = { id: number; at: number } & (
  | { k: "jump"; s: number }
  | { k: "airJump"; s: number }
  | { k: "land"; s: number; p: number; drop: number }
  | { k: "bounce"; s: number; p: number }
  | { k: "shove"; s: number; n: number }
  | { k: "hit"; s: number; by: number; x: number; y: number; z: number }
  | { k: "block"; s: number }
  | { k: "crack"; p: number }
  | { k: "break"; p: number }
  | { k: "respawn"; p: number }
  | { k: "gone"; p: number }
  | { k: "finish"; s: number; place: number; pts: number }
  | { k: "finalCall" }
  | { k: "caught"; s: number; y: number }
  | { k: "card"; s: number }
  | { k: "sab"; s: number; kind: SabKind; target: number }
  | { k: "rock"; x: number; y: number; z: number; n: number }
  | { k: "spawn"; kind: ItemKind; p: number }
  | { k: "pick"; s: number; kind: ItemKind }
  | { k: "round"; round: number }
  | { k: "go" }
  | { k: "end" }
  | { k: "over" }
);

export interface RoundSummary {
  round: number;
  /** 등정 순서 */
  order: number[];
  /** 탈락 순서 */
  outs: number[];
  pts: number[];
  best: number[];
  ms: number;
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  round: number;
  towerSeed: number;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  climbStart: number;
  collapseY: number;
  finalCall: boolean;
  finishCount: number;
  outCount: number;
  /** 발판별: 무너진 시각 (0 = 멀쩡) */
  broke: number[];
  /** 붕괴선에 삼켜져 영영 없음 */
  gone: number[];
  /** 무너지기 시작할 시각 (0 = 없음) */
  crumbleAt: number[];
  respawnAt: number[];
  icyUntil: number[];
  rocks: Rock[];
  wind: Wind | null;
  items: Item[];
  nextItemAt: number;
  /** 아이템·낙석 번호 */
  idSeq: number;
  players: PlayerState[];
  events: GameEvent[];
  eventSeq: number;
  history: RoundSummary[];
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

export function towerOf(s: MatchState): Tower {
  return buildTower(s.towerSeed);
}

export function solid(s: MatchState, i: number): boolean {
  return i >= 0 && s.gone[i] === 0 && s.broke[i] === 0;
}

export function icy(s: MatchState, i: number): boolean {
  return i >= 0 && s.icyUntil[i] > s.t;
}

export function shielded(p: PlayerState, t: number): boolean {
  return t < p.shieldUntil;
}

export function climbing(p: PlayerState): boolean {
  return p.status === "climb";
}

/** 선두: 아직 오르는 사람 중 가장 높은 사람 (-1 = 없음) */
export function leaderOf(s: MatchState, except = -1): number {
  let best = -1;
  let by = -Infinity;
  for (const p of s.players) {
    if (!climbing(p) || p.seat === except) continue;
    if (p.y > by + 1e-6) {
      by = p.y;
      best = p.seat;
    }
  }
  return best;
}

/** 오르는 사람 중 가장 낮은 사람 */
export function lastOf(s: MatchState): number {
  let worst = -1;
  let wy = Infinity;
  for (const p of s.players) {
    if (!climbing(p)) continue;
    if (p.y < wy - 1e-6) {
      wy = p.y;
      worst = p.seat;
    }
  }
  return worst;
}

/** 이 사람이 지금 방해 카드를 모을 수 있나 (👻 탈락자, 또는 선두보다 SAB_GAP 이상 낮은 꼴찌) */
export function cardEligible(s: MatchState, p: PlayerState): boolean {
  if (!s.options.sabotage || s.phase !== "climb") return false;
  if (p.status === "out") return leaderOf(s) >= 0;
  if (p.status !== "climb") return false;
  const climbers = s.players.filter(climbing);
  if (climbers.length < 2 || lastOf(s) !== p.seat) return false;
  const lead = leaderOf(s);
  return lead >= 0 && lead !== p.seat && s.players[lead].y - p.y >= SAB_GAP;
}

/* ── 이벤트 ─────────────────────────────────────────────────────────── */

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

function emit(s: MatchState, e: EventBody) {
  s.events.push({ ...(e as object), id: ++s.eventSeq, at: s.t } as GameEvent);
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

function newPlayer(seat: number, spec: SeatSpec): PlayerState {
  return {
    seat,
    bot: spec.bot,
    lv: Math.max(1, Math.min(10, Math.round(spec.level) || 5)),
    away: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    face: 0,
    on: 0,
    lastOn: 0,
    groundAt: -1e9,
    airTop: 0,
    status: "climb",
    place: 0,
    outOrder: 0,
    doneAt: 0,
    best: 0,
    staggerUntil: 0,
    shoveCdAt: 0,
    feather: false,
    bootsUntil: 0,
    shieldUntil: 0,
    card: null,
    cardAt: 0,
    lastHitBy: -1,
    lastHitAt: 0,
    score: 0,
    roundPts: 0,
    stats: zeroStats(),
  };
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: seats.length,
    options: sanitizeOptions(options),
    round: 0,
    towerSeed: 0,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: 0,
    climbStart: 0,
    collapseY: COLLAPSE_START_Y,
    finalCall: false,
    finishCount: 0,
    outCount: 0,
    broke: [],
    gone: [],
    crumbleAt: [],
    respawnAt: [],
    icyUntil: [],
    rocks: [],
    wind: null,
    items: [],
    nextItemAt: 0,
    idSeq: 0,
    players: seats.map((spec, i) => newPlayer(i, spec)),
    events: [],
    eventSeq: 0,
    history: [],
    ranks: null,
  };
  startRound(s, 1);
  return s;
}

/**
 * 시작 자리: 첫 본길 발판 중심에서 같은 거리(2.7m)의 바닥 위 점들 — 누구나 첫 점프까지 거리가 같다.
 * 라운드마다 자리 순서를 섞는다.
 */
export function spawnPoints(tower: Tower, n: number): { x: number; z: number }[] {
  const p1 = tower.platforms[tower.mainPath[1]];
  const c = platPos(p1, 0);
  const D = 2.7;
  const ok: number[] = [];
  const N = 144;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const x = c.x + Math.cos(a) * D;
    const z = c.z + Math.sin(a) * D;
    const d = Math.hypot(x, z);
    ok.push(d >= PILLAR_R + 0.6 && d <= 6.3 ? 1 : 0);
  }
  // 가장 긴 연속 구간
  let bestStart = 0;
  let bestLen = 0;
  for (let st = 0; st < N; st++) {
    if (!ok[st] || ok[(st - 1 + N) % N]) continue;
    let len = 0;
    while (len < N && ok[(st + len) % N]) len++;
    if (len > bestLen) {
      bestLen = len;
      bestStart = st;
    }
  }
  if (bestLen === 0) {
    bestLen = N;
    bestStart = 0;
  }
  const span = Math.min(bestLen - 2, Math.max(n * 6, Math.round(bestLen * 0.55)));
  const mid = bestStart + bestLen / 2;
  return Array.from({ length: n }, (_, i) => {
    const k = n === 1 ? mid : mid - span / 2 + (span * i) / (n - 1);
    const a = (k / N) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * D, z: c.z + Math.sin(a) * D };
  });
}

function startRound(s: MatchState, round: number) {
  s.round = round;
  s.towerSeed = Math.floor(rnd(s) * 2 ** 31);
  const tower = towerOf(s);
  const n = tower.platforms.length;
  s.phase = "countdown";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + (round === 1 ? COUNTDOWN_FIRST_MS : COUNTDOWN_MS);
  s.climbStart = s.phaseEnd;
  s.collapseY = COLLAPSE_START_Y;
  s.finalCall = false;
  s.finishCount = 0;
  s.outCount = 0;
  s.broke = Array(n).fill(0);
  s.gone = Array(n).fill(0);
  s.crumbleAt = Array(n).fill(0);
  s.respawnAt = Array(n).fill(0);
  s.icyUntil = Array(n).fill(0);
  s.rocks = [];
  s.wind = null;
  s.items = [];
  s.nextItemAt = s.climbStart + ITEM_FIRST_MS;
  const order = s.players.map((p) => p.seat);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const spots = spawnPoints(tower, s.seatCount);
  const c1 = platPos(tower.platforms[tower.mainPath[1]], 0);
  order.forEach((seat, k) => {
    const p = s.players[seat];
    const sp = spots[k];
    Object.assign(p, {
      x: sp.x,
      z: sp.z,
      y: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      face: Math.atan2(c1.z - sp.z, c1.x - sp.x),
      on: 0,
      lastOn: 0,
      groundAt: -1e9,
      airTop: 0,
      status: "climb",
      place: 0,
      outOrder: 0,
      doneAt: 0,
      best: 0,
      staggerUntil: 0,
      shoveCdAt: 0,
      feather: false,
      bootsUntil: 0,
      shieldUntil: 0,
      card: null,
      cardAt: s.climbStart + SAB_FIRST_MS,
      lastHitBy: -1,
      lastHitAt: 0,
      roundPts: 0,
    } satisfies Partial<PlayerState>);
  });
  emit(s, { k: "round", round });
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 이동 방향 (월드 x·z, 길이 ≤ 1) — 화면 기준 방향은 보드가 카메라 각으로 바꿔 보낸다 */
  mx: number;
  mz: number;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  jump: number;
  shove: number;
  /** 방해 카드 고르기: 누른 횟수 카운터 + 고른 칸(0~2) */
  pick: number;
  card: number;
}

export interface BotMemory {
  nextThinkAt: number;
  /** 가려는 발판 */
  goal: number;
  /** 지금 발판에서 출발한 시각 (머뭇거림) */
  waitUntil: number;
  /** 이번 점프를 할 거리 오차 */
  jumpBias: number;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seenJump: number[];
  seenShove: number[];
  seenPick: number[];
  jumpReq: number[];
  shoveReq: number[];
  acc: number;
  bots: BotMemory[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, jump: 0, shove: 0, pick: 0, card: -1 });

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seenJump: Array(n).fill(0),
    seenShove: Array(n).fill(0),
    seenPick: Array(n).fill(0),
    jumpReq: Array(n).fill(-1),
    shoveReq: Array(n).fill(-1),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, goal: -1, waitUntil: 0, jumpBias: 0 })),
    think,
    botRng: { rng: (state.seed ^ 0x2c1b3c6d) | 0 },
  };
}

/** 사람 입력 (방장 기기 자신 또는 손님이 보낸 `in`) */
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
  const j = Number(inp.jump) || 0;
  const sh = Number(inp.shove) || 0;
  const pk = Number(inp.pick) || 0;
  if (j > rt.seenJump[seat]) {
    rt.seenJump[seat] = j;
    rt.jumpReq[seat] = rt.state.t;
  }
  if (sh > rt.seenShove[seat]) {
    rt.seenShove[seat] = sh;
    rt.shoveReq[seat] = rt.state.t;
  }
  cur.jump = j;
  cur.shove = sh;
  if (pk > rt.seenPick[seat]) {
    rt.seenPick[seat] = pk;
    const c = Number(inp.card);
    if (Number.isInteger(c) && c >= 0 && c < 3) playCard(rt.state, seat, c);
  }
  cur.pick = pk;
  const cv = Number(inp.card);
  cur.card = Number.isInteger(cv) ? cv : -1;
}

/** 봇용: 한 번 누르기 */
export function press(rt: HostRuntime, seat: number, what: "jump" | "shove") {
  if (what === "jump") rt.jumpReq[seat] = rt.state.t;
  else rt.shoveReq[seat] = rt.state.t;
}

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
    rt.seenJump[seat] = 0;
    rt.seenShove[seat] = 0;
    rt.seenPick[seat] = 0;
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

export function step(rt: HostRuntime) {
  const s = rt.state;
  s.t += STEP_MS;
  if (s.phase === "countdown") {
    if (s.t >= s.phaseEnd) {
      s.phase = "climb";
      s.phaseStart = s.t;
      emit(s, { k: "go" });
    }
  } else if (s.phase === "climb") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    climb(rt);
  } else if (s.phase === "roundEnd") {
    if (s.t >= s.phaseEnd) {
      if (s.round >= s.options.rounds) finishMatch(s);
      else startRound(s, s.round + 1);
    }
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function climb(rt: HostRuntime) {
  const s = rt.state;
  const dt = STEP_MS / 1000;
  const tower = towerOf(s);
  for (const p of s.players) if (climbing(p)) moveBody(rt, p, tower, dt);
  separate(s);
  platforms(s, tower);
  collapse(s, tower, dt);
  for (const p of s.players) {
    if (!climbing(p)) continue;
    p.best = Math.max(p.best, p.y);
    if (p.y < s.collapseY - CAUGHT_DEPTH || p.y < -14) knockOut(s, p);
  }
  if (s.options.items) items(s, tower);
  if (s.options.sabotage) cards(s);
  hazards(s, dt);
  checkRoundEnd(s);
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

function moveBody(rt: HostRuntime, p: PlayerState, tower: Tower, dt: number) {
  const s = rt.state;
  const inp = rt.inputs[p.seat];
  const stag = s.t < p.staggerUntil;
  // ── 점프 (입력 버퍼·코요테 타임·🪶 공중 점프)
  const jq = rt.jumpReq[p.seat];
  if (jq >= 0) {
    const grounded = p.on >= 0;
    const coyote = !grounded && s.t - p.groundAt <= COYOTE_MS;
    if (s.t - jq > JUMP_BUFFER_MS) rt.jumpReq[p.seat] = -1;
    else if (!stag && (grounded || coyote)) {
      rt.jumpReq[p.seat] = -1;
      p.vy = JUMP_V;
      p.on = -1;
      p.groundAt = -1e9;
      p.airTop = p.y;
      p.stats.jumps += 1;
      emit(s, { k: "jump", s: p.seat });
    } else if (!stag && !grounded && p.feather && s.t - jq <= STEP_MS * 1.5) {
      rt.jumpReq[p.seat] = -1;
      p.feather = false;
      p.vy = AIR_JUMP_V;
      p.stats.airJumps += 1;
      emit(s, { k: "airJump", s: p.seat });
    }
  }
  // ── 밀치기
  const sq = rt.shoveReq[p.seat];
  if (sq >= 0) {
    if (s.t - sq > 200) rt.shoveReq[p.seat] = -1;
    else if (!stag && s.t >= p.shoveCdAt) {
      rt.shoveReq[p.seat] = -1;
      shove(s, p);
    }
  }
  // ── 달리기 (땅: 바로 붙음 · 얼음판: 미끄러움 · 공중: 조금만 틀기 · 휘청: 거의 못 틈)
  const grounded = p.on >= 0;
  const speed = RUN_SPEED * (s.t < p.bootsUntil ? BOOTS_MUL : 1);
  const k = stag ? 0.6 : grounded ? (icy(s, p.on) ? ICY_K : GROUND_K) : AIR_K;
  const f = Math.min(1, k * dt);
  p.vx += (inp.mx * speed - p.vx) * f;
  p.vz += (inp.mz * speed - p.vz) * f;
  // 돌풍
  const w = s.wind;
  if (w && s.t >= w.at && s.t < w.until && p.y >= w.minY && !w.immune.includes(p.seat)) {
    const d = Math.max(0.5, Math.hypot(p.x, p.z));
    const ux = p.x / d;
    const uz = p.z / d;
    p.vx += (ux * WIND_ACCEL - uz * WIND_ACCEL * 0.45) * dt;
    p.vz += (uz * WIND_ACCEL + ux * WIND_ACCEL * 0.45) * dt;
  }
  // 움직이는 발판에 실려 간다
  if (grounded) {
    const pl = tower.platforms[p.on];
    if (pl.kind === "moving") {
      const a = platPos(pl, s.t - STEP_MS);
      const b = platPos(pl, s.t);
      p.x += b.x - a.x;
      p.z += b.z - a.z;
    }
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // 기둥은 못 뚫는다
  const d = Math.hypot(p.x, p.z);
  const minD = PILLAR_R + BODY_R;
  if (d < minD) {
    const ux = d > 1e-6 ? p.x / d : 1;
    const uz = d > 1e-6 ? p.z / d : 0;
    p.x = ux * minD;
    p.z = uz * minD;
    const vin = p.vx * ux + p.vz * uz;
    if (vin < 0) {
      p.vx -= vin * ux;
      p.vz -= vin * uz;
    }
  }
  // 바닥 원판엔 낮은 울타리 (바닥이 무너지기 전까지 밖으로 안 떨어짐)
  if (p.y < 0.6 && s.gone[0] === 0) {
    const dd = Math.hypot(p.x, p.z);
    const maxD = BASE_R - BODY_R;
    if (dd > maxD) {
      const ux = p.x / dd;
      const uz = p.z / dd;
      p.x = ux * maxD;
      p.z = uz * maxD;
      const vout = p.vx * ux + p.vz * uz;
      if (vout > 0) {
        p.vx -= vout * ux;
        p.vz -= vout * uz;
      }
    }
  }
  if (Math.hypot(inp.mx, inp.mz) > 0.2 && !stag) p.face = turnTo(p.face, Math.atan2(inp.mz, inp.mx), dt * 14);
  else if (Math.hypot(p.vx, p.vz) > 1.2) p.face = turnTo(p.face, Math.atan2(p.vz, p.vx), dt * 6);
  // ── 세로
  if (p.on >= 0) {
    const pl = tower.platforms[p.on];
    if (!solid(s, p.on) || !onPlatform(pl, p.x, p.z, s.t, FOOT_MARGIN)) {
      p.on = -1;
      p.groundAt = s.t;
      p.vy = 0;
      p.airTop = p.y;
    } else {
      p.y = pl.y;
      return;
    }
  }
  const prevY = p.y;
  p.vy = Math.max(-FALL_MAX, p.vy - GRAVITY * dt);
  p.y += p.vy * dt;
  p.airTop = Math.max(p.airTop, p.y);
  if (p.vy > 0) return;
  let land = -1;
  let top = -Infinity;
  for (const pl of tower.platforms) {
    if (!solid(s, pl.i)) continue;
    if (prevY < pl.y - 0.02 || p.y > pl.y) continue;
    if (pl.y <= top) continue;
    if (!onPlatform(pl, p.x, p.z, s.t, FOOT_MARGIN)) continue;
    land = pl.i;
    top = pl.y;
  }
  if (land >= 0) landOn(rt, p, tower.platforms[land]);
}

function landOn(rt: HostRuntime, p: PlayerState, pl: Platform) {
  const s = rt.state;
  p.y = pl.y;
  p.vy = 0;
  p.on = pl.i;
  p.lastOn = pl.i;
  const drop = p.airTop - pl.y;
  if (drop >= 3) p.stats.drops += 1;
  if (pl.kind === "crown") {
    finish(s, p, pl);
    return;
  }
  if (pl.kind === "bouncy") {
    p.vy = BOUNCE_V;
    p.on = -1;
    p.groundAt = -1e9;
    p.airTop = p.y;
    p.stats.bounces += 1;
    emit(s, { k: "bounce", s: p.seat, p: pl.i });
    return;
  }
  if (pl.kind === "crumbly" && s.crumbleAt[pl.i] === 0) {
    s.crumbleAt[pl.i] = s.t + CRUMBLE_MS;
    emit(s, { k: "crack", p: pl.i });
  }
  emit(s, { k: "land", s: p.seat, p: pl.i, drop: Math.round(Math.max(0, drop) * 10) / 10 });
}

function finish(s: MatchState, p: PlayerState, crown: Platform) {
  p.status = "done";
  p.place = ++s.finishCount;
  p.doneAt = s.t;
  const pts = finishPoints(p.place);
  p.score += pts;
  p.roundPts += pts;
  p.best = crown.y;
  p.stats.finishes += 1;
  if (p.place === 1) p.stats.roundWins += 1;
  const ms = s.t - s.climbStart;
  p.stats.fastestMs = p.stats.fastestMs === 0 ? ms : Math.min(p.stats.fastestMs, ms);
  // 왕관 위 자리 (도착 순서대로 둘레에)
  const c = platPos(crown, s.t);
  const a = (p.place - 1) * 1.05 + crown.ang;
  p.x = c.x + Math.cos(a) * 0.95;
  p.z = c.z + Math.sin(a) * 0.95;
  p.y = crown.y;
  p.vx = p.vy = p.vz = 0;
  p.face = Math.atan2(-p.z, -p.x) + Math.PI;
  p.card = null;
  emit(s, { k: "finish", s: p.seat, place: p.place, pts });
  if (!s.finalCall) {
    s.finalCall = true;
    emit(s, { k: "finalCall" });
  }
}

function knockOut(s: MatchState, p: PlayerState) {
  p.status = "out";
  p.outOrder = ++s.outCount;
  p.doneAt = s.t;
  p.on = -1;
  p.stats.caught += 1;
  p.cardAt = s.t + 2500;
  p.card = null;
  emit(s, { k: "caught", s: p.seat, y: Math.round(p.y * 10) / 10 });
}

function shove(s: MatchState, p: PlayerState) {
  p.shoveCdAt = s.t + SHOVE_CD_MS;
  p.stats.shoves += 1;
  let n = 0;
  for (const o of s.players) {
    if (o === p || !climbing(o)) continue;
    const dy = o.y - p.y;
    if (Math.abs(dy) > 1.0) continue;
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SHOVE_R) continue;
    if (dist > 0.6) {
      let da = Math.atan2(dz, dx) - p.face;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > SHOVE_CONE) continue;
    }
    n++;
    if (shielded(o, s.t)) {
      o.shieldUntil = 0;
      o.stats.blocks += 1;
      emit(s, { k: "block", s: o.seat });
      continue;
    }
    const nx = dist > 1e-6 ? dx / dist : Math.cos(p.face);
    const nz = dist > 1e-6 ? dz / dist : Math.sin(p.face);
    const k = 0.75 + 0.25 * (1 - dist / SHOVE_R);
    o.vx = nx * SHOVE_PUSH * k;
    o.vz = nz * SHOVE_PUSH * k;
    o.vy = Math.max(o.vy, SHOVE_LIFT);
    if (o.on >= 0) o.airTop = o.y;
    o.on = -1;
    o.groundAt = -1e9;
    o.staggerUntil = s.t + STAGGER_MS;
    o.lastHitBy = p.seat;
    o.lastHitAt = s.t;
    p.stats.shoveHits += 1;
    emit(s, { k: "hit", s: o.seat, by: p.seat, x: o.x, y: o.y + 1, z: o.z });
  }
  emit(s, { k: "shove", s: p.seat, n });
}

/** 몸끼리 겹치면 밀어낸다 (부드럽게, 점수 없음) */
function separate(s: MatchState) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!climbing(a)) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!climbing(b) || Math.abs(a.y - b.y) > 1.0) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const rr = BODY_R * 2;
      if (d >= rr) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const over = (rr - d) / 2;
      a.x -= nx * over;
      a.z -= nz * over;
      b.x += nx * over;
      b.z += nz * over;
    }
  }
}

/** 금 간 발판·흔들린 발판이 무너지고, 시간이 되면 다시 생긴다 */
function platforms(s: MatchState, tower: Tower) {
  for (const pl of tower.platforms) {
    const i = pl.i;
    if (s.crumbleAt[i] > 0 && s.t >= s.crumbleAt[i]) {
      s.crumbleAt[i] = 0;
      if (s.broke[i] === 0 && s.gone[i] === 0) {
        s.broke[i] = s.t;
        s.respawnAt[i] = s.t + RESPAWN_MS;
        emit(s, { k: "break", p: i });
      }
    }
    if (s.respawnAt[i] > 0 && s.t >= s.respawnAt[i]) {
      s.respawnAt[i] = 0;
      if (s.gone[i] === 0) {
        s.broke[i] = 0;
        emit(s, { k: "respawn", p: i });
      }
    }
  }
}

/** 붕괴선: 5초 뒤부터 점점 빨리 올라오며 아래 발판을 삼킨다 (왕관은 안 삼킴) */
export function collapseSpeed(s: MatchState): number {
  const el = s.t - s.climbStart - COLLAPSE_DELAY_MS;
  if (el <= 0) return 0;
  return Math.min(COLLAPSE_VMAX, COLLAPSE_V0 + (COLLAPSE_ACCEL * el) / 1000) * (s.finalCall ? FINAL_CALL_MUL : 1);
}

function collapse(s: MatchState, tower: Tower, dt: number) {
  s.collapseY = Math.min(tower.top - 0.3, s.collapseY + collapseSpeed(s) * dt);
  for (const pl of tower.platforms) {
    if (pl.kind === "crown" || s.gone[pl.i] !== 0) continue;
    if (pl.y < s.collapseY) {
      s.gone[pl.i] = 1;
      s.crumbleAt[pl.i] = 0;
      s.respawnAt[pl.i] = 0;
      if (s.broke[pl.i] === 0) s.broke[pl.i] = s.t;
      s.items = s.items.filter((it) => it.plat !== pl.i);
      emit(s, { k: "gone", p: pl.i });
    }
  }
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

function items(s: MatchState, tower: Tower) {
  s.items = s.items.filter((it) => it.until > s.t && solid(s, it.plat));
  for (const p of s.players) {
    if (!climbing(p) || s.items.length === 0) continue;
    const got = s.items.find((it) => {
      const pl = tower.platforms[it.plat];
      const c = platPos(pl, s.t);
      return Math.abs(p.y - pl.y) < 1.3 && Math.hypot(c.x - p.x, c.z - p.z) < ITEM_PICK_R + 0.2;
    });
    if (!got) continue;
    s.items = s.items.filter((it) => it !== got);
    p.stats.items += 1;
    if (got.kind === "feather") p.feather = true;
    else if (got.kind === "boots") p.bootsUntil = s.t + BOOTS_MS;
    else p.shieldUntil = s.t + SHIELD_MS;
    emit(s, { k: "pick", s: p.seat, kind: got.kind });
  }
  if (s.t < s.nextItemAt) return;
  s.nextItemAt = s.t + ITEM_EVERY_MS;
  if (s.items.length >= ITEM_MAX) return;
  const climbers = s.players.filter(climbing);
  if (climbers.length === 0) return;
  const low = Math.min(...climbers.map((p) => p.y));
  const high = Math.max(...climbers.map((p) => p.y));
  // 아래쪽 절반에 더 자주 (뒤처진 사람 돕기)
  const cap = low + Math.max(3, (high - low) * 0.6) + 1.5;
  const ok = tower.platforms.filter(
    (pl) =>
      pl.kind !== "base" &&
      pl.kind !== "crown" &&
      pl.kind !== "crumbly" &&
      solid(s, pl.i) &&
      pl.y > low + 0.4 &&
      pl.y <= cap &&
      pl.y > s.collapseY + 3 &&
      !s.items.some((it) => it.plat === pl.i) &&
      !climbers.some((p) => p.on === pl.i),
  );
  if (ok.length === 0) return;
  const pl = ok[Math.floor(rnd(s) * ok.length)];
  const kind = ITEM_KINDS[Math.floor(rnd(s) * ITEM_KINDS.length)];
  s.items.push({ id: ++s.idSeq, kind, plat: pl.i, until: s.t + ITEM_LIFE_MS });
  emit(s, { k: "spawn", kind, p: pl.i });
}

/* ── 방해 카드 ─────────────────────────────────────────────────────── */

function cards(s: MatchState) {
  if (s.t - s.climbStart < SAB_FIRST_MS) return;
  for (const p of s.players) {
    if (p.card) {
      if (s.t >= p.card.until) playCard(s, p.seat, Math.floor(rnd(s) * p.card.kinds.length));
      continue;
    }
    if (!cardEligible(s, p)) {
      // 꼴찌가 아니게 되면 다시 모으기 시작
      if (p.status === "climb") p.cardAt = Math.max(p.cardAt, s.t + SAB_LAST_MS * 0.5);
      continue;
    }
    if (s.t < p.cardAt) continue;
    const pool = [...SAB_KINDS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd(s) * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    p.card = { kinds: pool.slice(0, 3), until: s.t + SAB_PICK_MS };
    emit(s, { k: "card", s: p.seat });
  }
}

/** 카드 쓰기 — 과녁은 지금 선두 (쓴 사람 자신은 빼고) */
export function playCard(s: MatchState, seat: number, idx: number) {
  const p = s.players[seat];
  if (!p?.card || s.phase !== "climb") return;
  const kind = p.card.kinds[Math.max(0, Math.min(p.card.kinds.length - 1, idx))];
  p.card = null;
  p.cardAt = s.t + (p.status === "out" ? SAB_GHOST_MS : SAB_LAST_MS);
  p.stats.cards += 1;
  const target = leaderOf(s, seat);
  emit(s, { k: "sab", s: seat, kind, target });
  if (target < 0) return;
  const tg = s.players[target];
  const tower = towerOf(s);
  if (kind === "rocks") {
    const spots = [{ x: tg.x, z: tg.z }];
    for (let k = 1; k < ROCK_COUNT; k++) {
      const a = rnd(s) * Math.PI * 2;
      const r = 1.1 + rnd(s) * 0.7;
      spots.push({ x: tg.x + Math.cos(a) * r, z: tg.z + Math.sin(a) * r });
    }
    const y = tg.on >= 0 ? tower.platforms[tg.on].y : tg.y;
    for (const sp of spots) s.rocks.push({ id: ++s.idSeq, x: sp.x, z: sp.z, y, at: s.t + ROCK_WARN_MS, by: seat });
  } else if (kind === "ice") {
    for (const pl of tower.platforms) if (pl.kind !== "base" && pl.kind !== "crown" && pl.y >= tg.y - 0.5 && pl.y <= tg.y + ICE_BAND_UP) s.icyUntil[pl.i] = s.t + ICE_MS;
  } else if (kind === "wind") {
    const at = s.t + WIND_WARN_MS;
    s.wind = { at, until: at + WIND_MS, minY: tg.y - 2, by: seat, immune: [] };
  } else if (kind === "shake") {
    const shaken: number[] = [];
    const cur = tg.on >= 0 ? tower.platforms[tg.on] : null;
    const chain = cur ? cur.chain : Math.max(0, ...tower.platforms.filter((pl) => pl.main && pl.y <= tg.y + 0.1).map((pl) => pl.chain));
    if (cur && cur.kind !== "base" && cur.kind !== "crown") shaken.push(cur.i);
    for (const pl of tower.platforms) if (pl.main && pl.kind !== "crown" && pl.kind !== "base" && (pl.chain === chain + 1 || pl.chain === chain + 2)) shaken.push(pl.i);
    for (const i of shaken) {
      if (!solid(s, i)) continue;
      if (s.crumbleAt[i] === 0 || s.crumbleAt[i] > s.t + SHAKE_MS) s.crumbleAt[i] = s.t + SHAKE_MS;
      emit(s, { k: "crack", p: i });
    }
  }
}

function hazards(s: MatchState, dt: number) {
  void dt;
  // 낙석
  if (s.rocks.length) {
    const due = s.rocks.filter((r) => s.t >= r.at);
    if (due.length) {
      s.rocks = s.rocks.filter((r) => s.t < r.at);
      for (const r of due) {
        let n = 0;
        for (const p of s.players) {
          if (!climbing(p)) continue;
          if (p.y < r.y - 1.2 || p.y > r.y + 2.6) continue;
          const dx = p.x - r.x;
          const dz = p.z - r.z;
          const d = Math.hypot(dx, dz);
          if (d > ROCK_R + BODY_R) continue;
          n++;
          if (shielded(p, s.t)) {
            p.shieldUntil = 0;
            p.stats.blocks += 1;
            emit(s, { k: "block", s: p.seat });
            continue;
          }
          let nx = dx;
          let nz = dz;
          if (d < 0.15) {
            const a = Math.max(0.5, Math.hypot(p.x, p.z));
            nx = p.x / a;
            nz = p.z / a;
          } else {
            nx /= d;
            nz /= d;
          }
          p.vx = nx * 4.6;
          p.vz = nz * 4.6;
          p.vy = Math.max(p.vy, 2.6);
          if (p.on >= 0) p.airTop = p.y;
          p.on = -1;
          p.groundAt = -1e9;
          p.staggerUntil = s.t + STAGGER_MS + 150;
          p.lastHitBy = r.by;
          p.lastHitAt = s.t;
          if (r.by >= 0 && r.by !== p.seat) s.players[r.by].stats.sabHits += 1;
          emit(s, { k: "hit", s: p.seat, by: r.by, x: p.x, y: p.y + 1, z: p.z });
        }
        emit(s, { k: "rock", x: Math.round(r.x * 100) / 100, y: r.y, z: Math.round(r.z * 100) / 100, n });
      }
    }
  }
  // 돌풍: 시작하는 순간 방패 든 사람은 막는다
  const w = s.wind;
  if (w) {
    if (s.t >= w.until) s.wind = null;
    else if (s.t >= w.at && s.t - STEP_MS < w.at) {
      for (const p of s.players) {
        if (!climbing(p) || p.y < w.minY || !shielded(p, s.t)) continue;
        p.shieldUntil = 0;
        p.stats.blocks += 1;
        w.immune.push(p.seat);
        emit(s, { k: "block", s: p.seat });
      }
    }
  }
}

/* ── 라운드 끝 ─────────────────────────────────────────────────────── */

function checkRoundEnd(s: MatchState) {
  const el = s.t - s.climbStart;
  const left = s.players.filter(climbing);
  if (left.length > 0 && el < ROUND_MAX_MS) return;
  for (const p of left) {
    p.status = "out";
    p.outOrder = ++s.outCount;
    p.doneAt = s.t;
  }
  for (const p of s.players) {
    p.stats.heightSum += Math.round(p.best * 10) / 10;
    p.stats.bestHeight = Math.max(p.stats.bestHeight, Math.round(p.best * 10) / 10);
  }
  s.history.push({
    round: s.round,
    order: s.players.filter((p) => p.place > 0).sort((a, b) => a.place - b.place).map((p) => p.seat),
    outs: s.players.filter((p) => p.outOrder > 0).sort((a, b) => a.outOrder - b.outOrder).map((p) => p.seat),
    pts: s.players.map((p) => p.roundPts),
    best: s.players.map((p) => Math.round(p.best * 10) / 10),
    ms: Math.round(el),
  });
  s.phase = "roundEnd";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + ROUND_END_MS;
  s.rocks = [];
  s.wind = null;
  s.items = [];
  for (const p of s.players) p.card = null;
  emit(s, { k: "end" });
}

/** 최종 순위: 점수 → 라운드 1등 → 오른 높이 합. 그래도 같으면 같은 등수. */
export function rankKey(p: PlayerState): number[] {
  return [p.score, p.stats.roundWins, Math.round(p.stats.heightSum * 10)];
}

export function computeRanks(s: MatchState): number[] {
  const cmp = (a: PlayerState, b: PlayerState) => {
    const ka = rankKey(a);
    const kb = rankKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...s.players].sort(cmp);
  const ranks = s.players.map(() => 0);
  sorted.forEach((p, i) => {
    ranks[p.seat] = i > 0 && cmp(sorted[i - 1], p) === 0 ? ranks[sorted[i - 1].seat] : i + 1;
  });
  return ranks;
}

function finishMatch(s: MatchState) {
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.phaseEnd = s.t;
  s.ranks = computeRanks(s);
  emit(s, { k: "over" });
}
