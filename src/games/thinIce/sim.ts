import { lakeGeo, ringsFor, sectorOf, tileIndexAt, type LakeGeo } from "./lake";
import {
  ACCEL,
  AIR_ACCEL,
  AIR_MAX_SPEED,
  BODY_R,
  COMEBACK_GAP,
  COUNTDOWN_FIRST_MS,
  COUNTDOWN_MS,
  CREDIT_MS,
  DOOM_MIN_MS,
  DOOM_SPREAD_MS,
  DRAG,
  FIGHT_MAX_MS,
  FROST_R,
  GRAVITY,
  ICE_DRAIN,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_KINDS,
  ITEM_LIFE_MS,
  ITEM_MAX,
  ITEM_PICK_R,
  JUMP_CD_MS,
  JUMP_H,
  JUMP_MS,
  JUMP_SPEED,
  KNOCK_MAX,
  KNOCK_MIN,
  KNOCK_R,
  LAND_CRACK,
  PTS_DRAW,
  PTS_FISH,
  PTS_KO,
  REFREEZE,
  RESTITUTION,
  ROUND_END_MS,
  SINK_GONE_Y,
  SLAM_MS,
  SPIKES_DRAIN,
  SPIKES_KNOCK,
  SPIKES_MS,
  STAGGER_H,
  STAGGER_MS,
  STEP_MS,
  STOMP_CD_MS,
  STOMP_CENTER_DMG,
  STOMP_DMG,
  STOMP_H,
  STOMP_R,
  STOMP_RISE_MS,
  SUDDEN_MS,
  SUDDEN_RING_MS,
  THAW_DAMAGE,
  THAW_FIRST_WARN_MS,
  THAW_GAP_MIN_MS,
  THAW_GAP_START_MS,
  THAW_GAP_STEP_MS,
  THAW_WARN_MS,
  WATER_Y,
  placePoints,
  sanitizeOptions,
  type GameOptions,
  type ItemKind,
} from "./data";

/**
 * 살얼음 파티 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다. 그래서 방장이 나가도
 * 손님 하나가 마지막 스냅샷으로 `createHost`를 다시 불러 판을 이어갈 수 있다(방장 승계).
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다 — 같은 입력이면 같은 결과(테스트 재현용).
 *
 * 한 스텝(1/60초) 순서: 봇 생각 → 조작(점프·내려찍기) → 몸 이동·착지 → 몸끼리 부딪힘 →
 * 얼음 깎기·다시 얼기·깨짐 → 빠짐 판정 → 아이템 → 해빙 경보 → 서든데스 → 라운드 끝 판정.
 */

export type Phase = "countdown" | "fight" | "roundEnd" | "gameOver";
/** 공중 상태: 점프 / 내려찍기 / 밀쳐져 휘청 */
export type AirKind = "none" | "jump" | "stomp" | "stagger";

export interface PlayerStats {
  kos: number;
  falls: number;
  /** 아무도 안 밀었는데 빠짐 */
  selfFalls: number;
  roundWins: number;
  /** 라운드 3등 안 */
  podiums: number;
  stomps: number;
  /** 내려찍기로 밀쳐낸 사람 수 */
  stompHits: number;
  /** 내 내려찍기로 깨뜨린 얼음 칸 */
  tilesBroken: number;
  jumps: number;
  items: number;
  fish: number;
  frosts: number;
  /** 유령으로 해빙 구역을 고른 횟수 (내 표가 이긴 것만) */
  votes: number;
  /** 내가 고른 해빙으로 빠진 사람 수 */
  voteHits: number;
  maxKosRound: number;
  /** 버틴 시간 합 (싸움 시작부터 빠지거나 라운드가 끝날 때까지) */
  surviveMs: number;
  bestSurviveMs: number;
}

const zeroStats = (): PlayerStats => ({
  kos: 0,
  falls: 0,
  selfFalls: 0,
  roundWins: 0,
  podiums: 0,
  stomps: 0,
  stompHits: 0,
  tilesBroken: 0,
  jumps: 0,
  items: 0,
  fish: 0,
  frosts: 0,
  votes: 0,
  voteHits: 0,
  maxKosRound: 0,
  surviveMs: 0,
  bestSurviveMs: 0,
});

export interface PlayerState {
  seat: number;
  bot: boolean;
  /** 봇 레벨 1~10 (사람은 대신 플레이할 때 쓸 값) */
  lv: number;
  /** 사람이 나가서 봇이 대신 하는 중 */
  away: boolean;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  face: number;
  /** 이번 라운드에 아직 얼음 위에 있나 */
  alive: boolean;
  /** 물에 빠지는 중 (alive=false, 화면에선 첨벙 연출) */
  falling: boolean;
  /** 물 표면에 닿았나 (첨벙 이벤트 한 번만) */
  splashed: boolean;
  outAt: number;
  /** 이번 라운드 몇 번째로 빠졌나 (0 = 아직) */
  place: number;
  air: AirKind;
  airAt: number;
  airMs: number;
  airH: number;
  /** 내려꽂기 시작 시각 (0 = 아직) */
  slamAt: number;
  slamFrom: number;
  jumpCdAt: number;
  stompCdAt: number;
  spikesUntil: number;
  lastHitBy: number;
  lastHitAt: number;
  score: number;
  roundPts: number;
  roundKos: number;
  /** 빠진 뒤 유령인가 (옵션 켜짐) */
  ghost: boolean;
  /** 유령이 고른 다음 해빙 구역 (-1 = 아직) */
  vote: number;
  stats: PlayerStats;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
  tile: number;
  until: number;
}

export interface Thaw {
  sector: number;
  /** 해가 내리쬐는 시각 (경보는 이 3초 전부터) */
  at: number;
  /** 이 구역을 고른 유령들 (빈 배열 = 해님이 무작위로) */
  by: number[];
}

export type GameEvent = { id: number; at: number } & (
  | { k: "jump"; s: number }
  | { k: "stomp"; s: number }
  | { k: "land"; s: number; x: number; z: number }
  | { k: "slam"; s: number; x: number; z: number; n: number; broke: number }
  | { k: "bump"; a: number; b: number; x: number; z: number; p: number }
  | { k: "break"; i: number; by: number }
  | { k: "fall"; s: number; by: number; x: number; z: number }
  | { k: "splash"; s: number; x: number; z: number }
  | { k: "spawn"; kind: ItemKind; x: number; z: number }
  | { k: "pick"; s: number; kind: ItemKind; x: number; z: number }
  | { k: "warn"; sector: number; by: number[] }
  | { k: "thaw"; sector: number; broke: number }
  | { k: "vote"; s: number; sector: number }
  | { k: "round"; round: number }
  | { k: "go" }
  | { k: "sudden" }
  | { k: "ring"; ring: number }
  | { k: "end"; winner: number; draw: boolean }
  | { k: "over" }
);

export interface RoundSummary {
  round: number;
  winner: number;
  draw: boolean;
  /** 자리별 이번 라운드 얻은 점수 */
  pts: number[];
  kos: number[];
  /** 빠진 순서 (먼저 빠진 사람 먼저) */
  order: number[];
  ms: number;
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  rings: number;
  round: number;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  fightStart: number;
  /** 칸별 얼음 상태 1(멀쩡)~0 */
  hp: number[];
  /** 칸이 깨진 시각 (0 = 아직 멀쩡) */
  broke: number[];
  /** 서든데스로 깨질 예정 시각 (0 = 없음) */
  doom: number[];
  /** 지금 경보 중인 해빙 (없으면 null) */
  thaw: Thaw | null;
  /** 바로 전에 내리쬔 해빙 (빠진 사람을 고른 유령 기록용) */
  lastThaw: Thaw | null;
  /** 다음 경보가 시작되는 시각 */
  nextThawAt: number;
  thawCount: number;
  lastSector: number;
  sudden: boolean;
  /** 다음에 무너질 고리 (-1 = 다 끝남) */
  suddenRing: number;
  nextSuddenAt: number;
  items: Item[];
  nextItemAt: number;
  itemSeq: number;
  players: PlayerState[];
  events: GameEvent[];
  eventSeq: number;
  history: RoundSummary[];
  /** 끝났을 때 최종 순위 (자리별 등수, 1부터) */
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

export function geoOf(s: MatchState): LakeGeo {
  return lakeGeo(s.rings);
}

/** 이 칸에 지금 설 수 있나 */
export function tileSolid(s: MatchState, i: number): boolean {
  return i >= 0 && s.broke[i] === 0;
}

/** 이 칸이 곧(horizon ms 안에) 깨질 운명인가 — 서든데스 예정 칸 (봇·화면 경고용) */
export function tileDoomed(s: MatchState, i: number, horizon: number): boolean {
  if (i < 0) return true;
  if (s.broke[i] !== 0) return true;
  const d = s.doom[i];
  return d !== 0 && s.t + horizon >= d;
}

/** 해빙 경보가 이 칸을 비추고 있나 */
export function tileWarned(s: MatchState, i: number): boolean {
  return !!s.thaw && i >= 0 && geoOf(s).tiles[i].sector === s.thaw.sector;
}

export function tileAt(s: MatchState, x: number, z: number): number {
  return tileIndexAt(geoOf(s), x, z);
}

export function airborne(p: PlayerState): boolean {
  return p.air !== "none";
}

export function spiked(p: PlayerState, t: number): boolean {
  return t < p.spikesUntil;
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
    z: 0,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    face: 0,
    alive: true,
    falling: false,
    splashed: false,
    outAt: 0,
    place: 0,
    air: "none",
    airAt: 0,
    airMs: 0,
    airH: 0,
    slamAt: 0,
    slamFrom: 0,
    jumpCdAt: 0,
    stompCdAt: 0,
    spikesUntil: 0,
    lastHitBy: -1,
    lastHitAt: 0,
    score: 0,
    roundPts: 0,
    roundKos: 0,
    ghost: false,
    vote: -1,
    stats: zeroStats(),
  };
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const seatCount = seats.length;
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount,
    options: sanitizeOptions(options),
    rings: ringsFor(seatCount),
    round: 0,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: 0,
    fightStart: 0,
    hp: [],
    broke: [],
    doom: [],
    thaw: null,
    lastThaw: null,
    nextThawAt: 0,
    thawCount: 0,
    lastSector: -1,
    sudden: false,
    suddenRing: 0,
    nextSuddenAt: 0,
    items: [],
    nextItemAt: 0,
    itemSeq: 0,
    players: seats.map((spec, i) => newPlayer(i, spec)),
    events: [],
    eventSeq: 0,
    history: [],
    ranks: null,
  };
  startRound(s, 1);
  return s;
}

function startRound(s: MatchState, round: number) {
  const geo = geoOf(s);
  s.round = round;
  s.phase = "countdown";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + (round === 1 ? COUNTDOWN_FIRST_MS : COUNTDOWN_MS);
  s.fightStart = s.phaseEnd;
  s.hp = geo.tiles.map(() => 1);
  s.broke = geo.tiles.map(() => 0);
  s.doom = geo.tiles.map(() => 0);
  s.thaw = null;
  s.lastThaw = null;
  s.nextThawAt = s.fightStart + THAW_FIRST_WARN_MS;
  s.thawCount = 0;
  s.lastSector = -1;
  s.sudden = false;
  s.suddenRing = s.rings;
  s.nextSuddenAt = s.fightStart + SUDDEN_MS;
  s.items = [];
  s.nextItemAt = s.fightStart + ITEM_FIRST_MS;
  // 자리 배치: 가운데에서 반지름의 절반 둘레에 고르게, 라운드마다 회전·순서를 섞는다
  const n = s.seatCount;
  const order = s.players.map((p) => p.seat);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rot = rnd(s) * Math.PI * 2;
  const spawnR = geo.radius * 0.48;
  const leader = Math.max(...s.players.map((p) => p.score));
  order.forEach((seat, k) => {
    const p = s.players[seat];
    const a = rot + (k / n) * Math.PI * 2;
    let x = Math.cos(a) * spawnR;
    let z = Math.sin(a) * spawnR;
    const ti = tileIndexAt(geo, x, z);
    if (ti >= 0) {
      x = geo.tiles[ti].x;
      z = geo.tiles[ti].z;
    }
    Object.assign(p, {
      x,
      z,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      face: Math.atan2(-z, -x),
      alive: true,
      falling: false,
      splashed: false,
      outAt: 0,
      place: 0,
      air: "none",
      airAt: 0,
      airMs: 0,
      airH: 0,
      slamAt: 0,
      slamFrom: 0,
      jumpCdAt: 0,
      stompCdAt: 0,
      spikesUntil: 0,
      lastHitBy: -1,
      lastHitAt: 0,
      roundPts: 0,
      roundKos: 0,
      ghost: false,
      vote: -1,
    } satisfies Partial<PlayerState>);
    // 꼴찌 보호 (역전 장치): 아이젠을 신고 시작
    if (round > 1 && leader - p.score >= COMEBACK_GAP) p.spikesUntil = s.fightStart + SPIKES_MS;
  });
  emit(s, { k: "round", round });
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 이동 방향 (화면 기준 x→오른쪽, z→아래), 길이 ≤ 1 */
  mx: number;
  mz: number;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  jump: number;
  stomp: number;
  /** 유령일 때 고른 해빙 구역 (-1 = 없음) */
  vote: number;
}

export interface BotMemory {
  nextThinkAt: number;
  /** 가려는 칸 */
  goal: number;
  wander: { x: number; z: number; until: number } | null;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seenJump: number[];
  seenStomp: number[];
  jumpReq: number[];
  stompReq: number[];
  acc: number;
  bots: BotMemory[];
  /** 봇 생각 함수 (bot.ts가 꽂는다 — 순환 import 방지) */
  think: ((rt: HostRuntime, seat: number) => void) | null;
  /** 봇 손떨림용 난수 (경기 rng와 따로) */
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, jump: 0, stomp: 0, vote: -1 });

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seenJump: Array(n).fill(0),
    seenStomp: Array(n).fill(0),
    jumpReq: Array(n).fill(-1),
    stompReq: Array(n).fill(-1),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, goal: -1, wander: null })),
    think,
    botRng: { rng: (state.seed ^ 0x2c1b3c6d) | 0 },
  };
}

/** 사람 입력 (방장 기기 자신 또는 손님이 보낸 `in`) */
export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= rt.state.seatCount) return;
  const p = rt.state.players[seat];
  if (p.bot) return;
  setInput(rt, seat, inp);
}

/** 봇·사람 공용: 입력 저장 + 새로 누른 점프/내려찍기 기억 + 유령 표 */
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
  const st = Number(inp.stomp) || 0;
  if (j > rt.seenJump[seat]) {
    rt.seenJump[seat] = j;
    rt.jumpReq[seat] = rt.state.t;
  }
  if (st > rt.seenStomp[seat]) {
    rt.seenStomp[seat] = st;
    rt.stompReq[seat] = rt.state.t;
  }
  cur.jump = j;
  cur.stomp = st;
  const v = Number(inp.vote);
  cur.vote = Number.isInteger(v) && v >= 0 && v < 6 ? v : -1;
  castVote(rt.state, seat, cur.vote);
}

/** 유령 표: 바뀌었을 때만 기록 (화면에 누가 어디 골랐는지 보여 준다) */
function castVote(s: MatchState, seat: number, vote: number) {
  const p = s.players[seat];
  if (!p || p.alive || !p.ghost || s.phase !== "fight") return;
  if (p.vote === vote) return;
  p.vote = vote;
  if (vote >= 0) emit(s, { k: "vote", s: seat, sector: vote });
}

/** 봇용: 점프·내려찍기 한 번 누르기 */
export function press(rt: HostRuntime, seat: number, what: "jump" | "stomp") {
  if (what === "jump") rt.jumpReq[seat] = rt.state.t;
  else rt.stompReq[seat] = rt.state.t;
}

/** 사람이 나가면 봇이 대신, 돌아오면 돌려준다 */
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
    rt.seenStomp[seat] = 0;
  }
}

/* ── 진행 ───────────────────────────────────────────────────────────── */

/** 방장 루프: 실제 경과 ms를 받아 1/60초 고정 스텝으로 나눠 돈다 */
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
      s.phase = "fight";
      s.phaseStart = s.t;
      emit(s, { k: "go" });
    }
  } else if (s.phase === "fight") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    fight(rt);
  } else if (s.phase === "roundEnd") {
    // 끝난 뒤: 빠지던 몸은 마저 가라앉고, 남은 사람은 미끄러지다 멈춘다 (얼음은 더 안 깎임)
    for (const p of s.players) {
      if (p.falling) sink(s, p, STEP_MS / 1000);
      else if (p.alive) {
        p.vx *= 0.92;
        p.vz *= 0.92;
        p.x += (p.vx * STEP_MS) / 1000;
        p.z += (p.vz * STEP_MS) / 1000;
        if (airborne(p)) {
          p.air = "none";
          p.y = 0;
        }
      }
    }
    if (s.t >= s.phaseEnd) {
      if (s.round >= s.options.rounds) finishMatch(s);
      else startRound(s, s.round + 1);
    }
  }
  // 오래된 이벤트 정리 (스냅샷엔 최근 것만)
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function fight(rt: HostRuntime) {
  const s = rt.state;
  const dt = STEP_MS / 1000;
  const el = s.t - s.fightStart;
  for (const p of s.players) {
    if (p.alive) {
      control(rt, p);
      moveBody(rt, p, dt);
    } else if (p.falling) sink(s, p, dt);
  }
  collideBodies(s);
  ice(s, dt);
  for (const p of s.players) if (p.alive && !airborne(p) && !tileSolid(s, tileAt(s, p.x, p.z))) startFall(s, p);
  if (s.options.items) items(s);
  thaw(s);
  sudden(s, el);
  checkRoundEnd(s, el);
}

/** 입력 → 점프·내려찍기 (누른 뒤 0.2초 안에 쓸 수 있으면 쓴다) */
function control(rt: HostRuntime, p: PlayerState) {
  const s = rt.state;
  const jq = rt.jumpReq[p.seat];
  if (jq >= 0) {
    if (s.t - jq > 200) rt.jumpReq[p.seat] = -1;
    else if (!airborne(p) && s.t >= p.jumpCdAt) {
      rt.jumpReq[p.seat] = -1;
      p.air = "jump";
      p.airAt = s.t;
      p.airMs = JUMP_MS;
      p.airH = JUMP_H;
      p.slamAt = 0;
      p.jumpCdAt = s.t + JUMP_CD_MS;
      // 누르는 쪽으로 뛰어나간다 (안 누르면 제자리·지금 미끄러지던 대로)
      const inp = rt.inputs[p.seat];
      const l = Math.hypot(inp.mx, inp.mz);
      if (l > 0.2) {
        const dx = inp.mx / l;
        const dz = inp.mz / l;
        const along = p.vx * dx + p.vz * dz;
        if (along < JUMP_SPEED) {
          p.vx += dx * (JUMP_SPEED - along);
          p.vz += dz * (JUMP_SPEED - along);
        }
      }
      p.stats.jumps += 1;
      emit(s, { k: "jump", s: p.seat });
    }
  }
  const sq = rt.stompReq[p.seat];
  if (sq >= 0) {
    if (s.t - sq > 200) rt.stompReq[p.seat] = -1;
    else if (s.t >= p.stompCdAt && p.air !== "stomp" && p.air !== "stagger") {
      rt.stompReq[p.seat] = -1;
      p.stompCdAt = s.t + STOMP_CD_MS;
      p.stats.stomps += 1;
      if (p.air === "jump") {
        // 점프 중이면 그 자리에서 바로 내리꽂기
        p.air = "stomp";
        p.slamAt = s.t;
        p.slamFrom = Math.max(0.05, p.y);
      } else {
        p.air = "stomp";
        p.airAt = s.t;
        p.airMs = STOMP_RISE_MS * 2;
        p.airH = STOMP_H;
        p.slamAt = 0;
      }
      p.vx *= 0.35;
      p.vz *= 0.35;
      emit(s, { k: "stomp", s: p.seat });
    }
  }
}

/** 몸 움직이기: 얼음 위(미끄러운 가속·마찰) / 공중(포물선) */
function moveBody(rt: HostRuntime, p: PlayerState, dt: number) {
  const s = rt.state;
  const inp = rt.inputs[p.seat];
  if (airborne(p)) {
    if (p.air === "jump") {
      // 공중 방향 틀기 — 단, 뛰어나간 속도보다 더 빨라지지는 않는다
      const before = Math.hypot(p.vx, p.vz);
      p.vx += inp.mx * AIR_ACCEL * dt;
      p.vz += inp.mz * AIR_ACCEL * dt;
      const after = Math.hypot(p.vx, p.vz);
      const cap = Math.max(before, AIR_MAX_SPEED);
      if (after > cap) {
        p.vx *= cap / after;
        p.vz *= cap / after;
      }
    } else if (p.air === "stomp") {
      // 떠오르는 동안 아주 조금만 방향을 튼다
      p.vx += inp.mx * AIR_ACCEL * 0.3 * dt;
      p.vz += inp.mz * AIR_ACCEL * 0.3 * dt;
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    let landed = false;
    if (p.slamAt > 0) {
      const u = (s.t - p.slamAt) / SLAM_MS;
      if (u >= 1) landed = true;
      else p.y = p.slamFrom * (1 - u);
    } else {
      const u = (s.t - p.airAt) / p.airMs;
      if (p.air === "stomp" && s.t - p.airAt >= STOMP_RISE_MS) {
        p.slamAt = s.t;
        p.slamFrom = Math.max(0.05, p.airH * 4 * u * (1 - u));
        p.y = p.slamFrom;
      } else if (u >= 1) landed = true;
      else p.y = p.airH * 4 * u * (1 - u);
    }
    if (landed) land(s, p);
    return;
  }
  p.vx += (inp.mx * ACCEL - p.vx * DRAG) * dt;
  p.vz += (inp.mz * ACCEL - p.vz * DRAG) * dt;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const sp = Math.hypot(p.vx, p.vz);
  if (Math.hypot(inp.mx, inp.mz) > 0.2) p.face = turnTo(p.face, Math.atan2(inp.mz, inp.mx), dt * 12);
  else if (sp > 1.2) p.face = turnTo(p.face, Math.atan2(p.vz, p.vx), dt * 6);
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

function land(s: MatchState, p: PlayerState) {
  const kind = p.air;
  p.air = "none";
  p.y = 0;
  p.vy = 0;
  p.slamAt = 0;
  const ti = tileAt(s, p.x, p.z);
  if (!tileSolid(s, ti)) {
    startFall(s, p);
    return;
  }
  if (kind === "stomp") slam(s, p);
  else {
    if (kind === "jump") damage(s, ti, LAND_CRACK * (spiked(p, s.t) ? SPIKES_DRAIN : 1), -1);
    emit(s, { k: "land", s: p.seat, x: p.x, z: p.z });
  }
}

/** 얼음 깎기 — 0 이하가 되면 깨진다. by = 깨뜨린 사람(내려찍기), 아니면 -1 */
function damage(s: MatchState, i: number, amount: number, by: number): boolean {
  if (!tileSolid(s, i) || amount <= 0) return false;
  s.hp[i] = Math.max(0, s.hp[i] - amount);
  if (s.hp[i] <= 0) {
    breakTile(s, i, by);
    return true;
  }
  return false;
}

function breakTile(s: MatchState, i: number, by: number) {
  if (s.broke[i] !== 0) return;
  s.hp[i] = 0;
  s.broke[i] = s.t;
  s.items = s.items.filter((it) => it.tile !== i);
  if (by >= 0) s.players[by].stats.tilesBroken += 1;
  emit(s, { k: "break", i, by });
}

/** 내려찍기 착지: 주변 얼음에 금 + 가까운 사람 밀쳐내기 */
function slam(s: MatchState, p: PlayerState) {
  const geo = geoOf(s);
  const center = tileAt(s, p.x, p.z);
  let broke = 0;
  for (let i = 0; i < geo.tiles.length; i++) {
    if (!tileSolid(s, i)) continue;
    const t = geo.tiles[i];
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (i !== center && d > STOMP_R) continue;
    if (damage(s, i, i === center ? STOMP_CENTER_DMG : STOMP_DMG, p.seat)) broke++;
  }
  let n = 0;
  for (const o of s.players) {
    if (o === p || !o.alive) continue;
    if (o.y > 0.6) continue;
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > KNOCK_R) continue;
    const nx = d > 1e-6 ? dx / d : Math.cos(p.face);
    const nz = d > 1e-6 ? dz / d : Math.sin(p.face);
    const sp = (KNOCK_MIN + (KNOCK_MAX - KNOCK_MIN) * (1 - d / KNOCK_R)) * (spiked(o, s.t) ? SPIKES_KNOCK : 1);
    o.vx += nx * sp;
    o.vz += nz * sp;
    o.lastHitBy = p.seat;
    o.lastHitAt = s.t;
    if (o.air === "none" || o.air === "jump") {
      // 휘청 — 짧게 떠서 조작 불가 (공중에서 맞은 점프는 끊긴다)
      o.air = "stagger";
      o.airAt = s.t;
      o.airMs = STAGGER_MS;
      o.airH = STAGGER_H;
      o.slamAt = 0;
    }
    n++;
  }
  p.stats.stompHits += n;
  emit(s, { k: "slam", s: p.seat, x: p.x, z: p.z, n, broke });
}

/** 몸끼리 부딪힘 — 같은 무게의 부드러운 탄성 충돌 (밀쳐내기 점수는 없음, 기록만) */
function collideBodies(s: MatchState) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!b.alive) continue;
      if (Math.abs(a.y - b.y) > 0.7) continue;
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
      const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (vn <= 0) continue;
      const J = ((1 + RESTITUTION) * vn) / 2;
      const ka = spiked(a, s.t) ? SPIKES_KNOCK : 1;
      const kb = spiked(b, s.t) ? SPIKES_KNOCK : 1;
      a.vx -= nx * J * ka;
      a.vz -= nz * J * ka;
      b.vx += nx * J * kb;
      b.vz += nz * J * kb;
      if (vn > 3) {
        // 세게 박으면 KO 기록 (밀려서 빠지면 박은 사람 점수)
        const fast = Math.hypot(a.vx, a.vz) < Math.hypot(b.vx, b.vz) ? a : b;
        const slow = fast === a ? b : a;
        slow.lastHitBy = fast.seat;
        slow.lastHitAt = s.t;
        fast.lastHitBy = slow.seat;
        fast.lastHitAt = s.t;
        emit(s, { k: "bump", a: a.seat, b: b.seat, x: a.x + nx * BODY_R, z: a.z + nz * BODY_R, p: Math.round(vn * 10) / 10 });
      }
    }
  }
}

/** 얼음: 서 있는 사람마다 깎이고, 빈 칸은 아주 천천히 다시 언다. 서든데스 예정 칸은 시간이 되면 깨짐. */
function ice(s: MatchState, dt: number) {
  const geo = geoOf(s);
  const occupied = new Set<number>();
  for (const p of s.players) {
    if (!p.alive || airborne(p)) continue;
    const i = tileAt(s, p.x, p.z);
    if (!tileSolid(s, i)) continue;
    occupied.add(i);
    damage(s, i, ICE_DRAIN * dt * (spiked(p, s.t) ? SPIKES_DRAIN : 1), -1);
  }
  for (let i = 0; i < geo.tiles.length; i++) {
    if (s.broke[i] !== 0) continue;
    if (s.doom[i] !== 0 && s.t >= s.doom[i]) {
      breakTile(s, i, -1);
      continue;
    }
    if (!occupied.has(i) && s.hp[i] < 1 && !tileWarned(s, i) && s.doom[i] === 0) s.hp[i] = Math.min(1, s.hp[i] + REFREEZE * dt);
  }
}

function startFall(s: MatchState, p: PlayerState) {
  if (!p.alive) return;
  p.alive = false;
  p.falling = true;
  p.splashed = false;
  p.air = "none";
  p.slamAt = 0;
  p.vy = 0;
  p.outAt = s.t;
  const fallen = s.players.filter((q) => q.place > 0).length;
  p.place = fallen + 1;
  p.stats.falls += 1;
  const survived = s.t - s.fightStart;
  p.stats.surviveMs += survived;
  p.stats.bestSurviveMs = Math.max(p.stats.bestSurviveMs, survived);
  const by = p.lastHitBy >= 0 && s.t - p.lastHitAt <= CREDIT_MS && p.lastHitBy !== p.seat ? p.lastHitBy : -1;
  if (by >= 0) {
    const k = s.players[by];
    k.score += PTS_KO;
    k.roundPts += PTS_KO;
    k.roundKos += 1;
    k.stats.kos += 1;
    k.stats.maxKosRound = Math.max(k.stats.maxKosRound, k.roundKos);
  } else {
    p.stats.selfFalls += 1;
    // 유령이 고른 해빙 구역에서 해빙 직후 4초 안에 빠졌으면 그 유령들 기록
    const ti = tileAt(s, p.x, p.z);
    const sec = ti >= 0 ? geoOf(s).tiles[ti].sector : sectorOf(p.x, p.z);
    if (s.lastThaw && s.lastThaw.sector === sec && s.t - s.lastThaw.at <= 4000) for (const g of s.lastThaw.by) s.players[g].stats.voteHits += 1;
  }
  p.ghost = s.options.ghosts;
  p.vote = -1;
  emit(s, { k: "fall", s: p.seat, by, x: p.x, z: p.z });
}

/** 물에 빠지는 몸: 얼음 높이에서 물 표면까지 떨어지고(첨벙), 천천히 가라앉는다 */
function sink(s: MatchState, p: PlayerState, dt: number) {
  if (!p.splashed) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.vx *= 0.97;
    p.vz *= 0.97;
    if (p.y <= WATER_Y) {
      p.splashed = true;
      p.y = WATER_Y;
      p.vx = p.vz = 0;
      p.vy = -0.9;
      emit(s, { k: "splash", s: p.seat, x: p.x, z: p.z });
    }
    return;
  }
  p.y += p.vy * dt;
  if (p.y < SINK_GONE_Y) {
    p.falling = false;
    p.y = SINK_GONE_Y;
    p.vy = 0;
  }
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

function items(s: MatchState) {
  s.items = s.items.filter((it) => it.until > s.t && tileSolid(s, it.tile));
  for (const p of s.players) {
    if (!p.alive || airborne(p) || s.items.length === 0) continue;
    const got = s.items.find((it) => Math.hypot(it.x - p.x, it.z - p.z) < ITEM_PICK_R);
    if (!got) continue;
    s.items = s.items.filter((it) => it !== got);
    p.stats.items += 1;
    if (got.kind === "frost") {
      p.stats.frosts += 1;
      const geo = geoOf(s);
      for (let i = 0; i < geo.tiles.length; i++) {
        if (!tileSolid(s, i) || s.doom[i] !== 0) continue;
        const t = geo.tiles[i];
        if (Math.hypot(t.x - got.x, t.z - got.z) <= FROST_R) s.hp[i] = 1;
      }
    } else if (got.kind === "spikes") p.spikesUntil = s.t + SPIKES_MS;
    else if (got.kind === "fish") {
      p.stats.fish += 1;
      p.score += PTS_FISH;
      p.roundPts += PTS_FISH;
    }
    emit(s, { k: "pick", s: p.seat, kind: got.kind, x: got.x, z: got.z });
  }
  if (s.t >= s.nextItemAt) {
    s.nextItemAt = s.t + ITEM_EVERY_MS;
    if (s.items.length < ITEM_MAX) spawnItem(s);
  }
}

function spawnItem(s: MatchState) {
  const geo = geoOf(s);
  const kind = ITEM_KINDS[Math.floor(rnd(s) * ITEM_KINDS.length)];
  const ok: number[] = [];
  for (let i = 0; i < geo.tiles.length; i++) {
    if (!tileSolid(s, i) || s.doom[i] !== 0 || tileWarned(s, i)) continue;
    if (s.items.some((it) => it.tile === i)) continue;
    const t = geo.tiles[i];
    if (s.players.some((p) => p.alive && Math.hypot(p.x - t.x, p.z - t.z) < 1.4)) continue;
    // 물고기는 금 간 얼음(위험한 칸)에, 나머지는 단단한 칸에
    if (kind === "fish" ? s.hp[i] > 0.7 || s.hp[i] < 0.25 : s.hp[i] < 0.6) continue;
    ok.push(i);
  }
  if (ok.length === 0) {
    // 조건 맞는 칸이 없으면 아무 멀쩡한 칸
    for (let i = 0; i < geo.tiles.length; i++) if (tileSolid(s, i) && s.doom[i] === 0 && !s.items.some((it) => it.tile === i)) ok.push(i);
  }
  if (ok.length === 0) return;
  const tile = ok[Math.floor(rnd(s) * ok.length)];
  const t = geo.tiles[tile];
  s.items.push({ id: ++s.itemSeq, kind, x: t.x, z: t.z, tile, until: s.t + ITEM_LIFE_MS });
  emit(s, { k: "spawn", kind, x: t.x, z: t.z });
}

/* ── 해빙 경보 ─────────────────────────────────────────────────────── */

/** 이 구역에 아직 해빙을 받을 칸이 충분한가 (멀쩡하고 무너질 예정이 아닌 칸 2개 이상) */
export function sectorAlive(s: MatchState, sector: number): number {
  return geoOf(s).bySector[sector].filter((i) => tileSolid(s, i) && s.doom[i] === 0).length;
}

/** 다음 해빙 구역 고르기: 유령 표가 가장 많은 구역 (동점이면 무작위). 표가 없으면 해님이 무작위로. */
export function chooseSector(s: MatchState): { sector: number; by: number[] } {
  const valid = [0, 1, 2, 3, 4, 5].filter((k) => sectorAlive(s, k) >= 2);
  if (valid.length === 0) return { sector: -1, by: [] };
  const tally = [0, 0, 0, 0, 0, 0];
  for (const p of s.players) if (!p.alive && p.ghost && p.vote >= 0 && valid.includes(p.vote)) tally[p.vote]++;
  const top = Math.max(...valid.map((k) => tally[k]));
  if (top > 0) {
    const tied = valid.filter((k) => tally[k] === top);
    const sector = tied[Math.floor(rnd(s) * tied.length)];
    return { sector, by: s.players.filter((p) => !p.alive && p.ghost && p.vote === sector).map((p) => p.seat) };
  }
  // 해님: 바로 전 구역은 웬만하면 피한다
  const pool = valid.length > 1 ? valid.filter((k) => k !== s.lastSector) : valid;
  return { sector: pool[Math.floor(rnd(s) * pool.length)], by: [] };
}

function thaw(s: MatchState) {
  if (!s.thaw && s.t >= s.nextThawAt) {
    const pick = chooseSector(s);
    if (pick.sector < 0) {
      s.nextThawAt = s.t + 4000;
      return;
    }
    s.thaw = { sector: pick.sector, at: s.t + THAW_WARN_MS, by: pick.by };
    for (const g of pick.by) s.players[g].stats.votes += 1;
    // 표는 한 번 쓰면 비운다 (다음 경보 때 다시 고른다)
    for (const p of s.players) if (!p.alive) p.vote = -1;
    emit(s, { k: "warn", sector: pick.sector, by: pick.by });
    return;
  }
  if (s.thaw && s.t >= s.thaw.at) {
    const { sector, by } = s.thaw;
    let broke = 0;
    for (const i of geoOf(s).bySector[sector]) if (damage(s, i, THAW_DAMAGE, -1)) broke++;
    s.lastThaw = { sector, at: s.t, by };
    s.lastSector = sector;
    s.thaw = null;
    s.thawCount += 1;
    s.nextThawAt = s.t + Math.max(THAW_GAP_MIN_MS, THAW_GAP_START_MS - s.thawCount * THAW_GAP_STEP_MS);
    emit(s, { k: "thaw", sector, broke });
  }
}

/* ── 서든데스 ──────────────────────────────────────────────────────── */

function sudden(s: MatchState, el: number) {
  if (el < SUDDEN_MS || s.suddenRing < 0) return;
  if (!s.sudden) {
    s.sudden = true;
    emit(s, { k: "sudden" });
  }
  if (s.t < s.nextSuddenAt) return;
  const geo = geoOf(s);
  const ring = s.suddenRing;
  for (const i of geo.byRing[ring]) {
    if (s.broke[i] !== 0 || s.doom[i] !== 0) continue;
    s.doom[i] = s.t + DOOM_MIN_MS + rnd(s) * DOOM_SPREAD_MS;
  }
  emit(s, { k: "ring", ring });
  s.suddenRing -= 1;
  s.nextSuddenAt = s.t + SUDDEN_RING_MS;
}

/* ── 라운드 끝 ─────────────────────────────────────────────────────── */

function checkRoundEnd(s: MatchState, el: number) {
  const alive = s.players.filter((p) => p.alive);
  if (alive.length >= 2 && el < FIGHT_MAX_MS) return;
  const pts = s.players.map(() => 0);
  let winner = -1;
  let draw = false;
  const n = s.seatCount;
  if (alive.length === 1) {
    const w = alive[0];
    winner = w.seat;
    w.stats.roundWins += 1;
  } else if (alive.length >= 2) {
    draw = true;
    for (const p of alive) pts[p.seat] += PTS_DRAW;
  }
  // 생존 순위: 살아남은 사람 1등, 그다음 늦게 빠진 순 (같은 순간 빠지면 같은 등수)
  const fallen = s.players.filter((p) => !p.alive).sort((a, b) => b.outAt - a.outAt);
  let rank = alive.length === 1 ? 2 : alive.length >= 2 ? alive.length + 1 : 1;
  if (alive.length === 1) pts[alive[0].seat] += placePoints(1, n);
  let k = 0;
  while (k < fallen.length) {
    const at = fallen[k].outAt;
    const group = fallen.filter((p) => Math.abs(p.outAt - at) < STEP_MS * 0.5);
    for (const p of group) {
      if (alive.length === 0 && rank === 1) {
        // 마지막 사람들이 동시에 빠짐: 그 사람들끼리 무승부
        draw = true;
        pts[p.seat] += PTS_DRAW;
      } else pts[p.seat] += placePoints(rank, n);
      if (rank <= 3) p.stats.podiums += 1;
    }
    rank += group.length;
    k += group.length;
  }
  for (const p of alive) {
    p.stats.podiums += 1;
    const survived = s.t - s.fightStart;
    p.stats.surviveMs += survived;
    p.stats.bestSurviveMs = Math.max(p.stats.bestSurviveMs, survived);
  }
  for (const p of s.players) {
    p.score += pts[p.seat];
    p.roundPts += pts[p.seat];
  }
  s.history.push({
    round: s.round,
    winner,
    draw,
    pts: s.players.map((p) => p.roundPts),
    kos: s.players.map((p) => p.roundKos),
    order: s.players.filter((p) => p.place > 0).sort((a, b) => a.place - b.place).map((p) => p.seat),
    ms: Math.round(el),
  });
  s.phase = "roundEnd";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + ROUND_END_MS;
  s.items = [];
  s.thaw = null;
  emit(s, { k: "end", winner, draw });
}

/** 최종 순위: 점수 → 라운드 승 → KO → 버틴 시간. 그래도 같으면 같은 등수. */
export function rankKey(p: PlayerState): number[] {
  return [p.score, p.stats.roundWins, p.stats.kos, Math.round(p.stats.surviveMs / 100)];
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
