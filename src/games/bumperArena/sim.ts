import { arenaGeo, postTiles, ringsFor, tileIndexAt, type ArenaGeo } from "./arena";
import {
  ACCEL,
  AIR_ACCEL,
  BIG_MS,
  BIG_SCALE,
  BODY_R,
  BRACE_ACCEL,
  BRACE_DRAIN,
  BRACE_KNOCK,
  BRACE_MASS,
  BRACE_MIN_START,
  BRACE_REGEN,
  COMEBACK_GAP,
  COUNTDOWN_FIRST_MS,
  COUNTDOWN_MS,
  CREDIT_MS,
  CRUMBLE_START_MS,
  DASH_CD_MS,
  DASH_HIT_MULT,
  DASH_MS,
  DASH_SPEED,
  DRAG,
  DRAG_BRACE,
  DRAG_DASH,
  FALL_GONE_Y,
  FIGHT_MAX_MS,
  GHOST_SPEED,
  GRAVITY,
  GUST_CD_MS,
  GUST_R,
  GUST_SPEED,
  HEAT_MAX,
  HEAT_PER_SPEED,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_KINDS,
  ITEM_LIFE_MS,
  ITEM_MAX,
  ITEM_PICK_R,
  JUMP_CD_MS,
  JUMP_H,
  JUMP_MS,
  POST_BOUNCE,
  POST_MIN_SPEED,
  POST_R,
  POUND_R,
  POUND_SPEED,
  PTS_KO,
  PTS_RUNNER_UP,
  PTS_TIE_FALL,
  PTS_TIMEOUT,
  PTS_WIN,
  RESTITUTION,
  ROUND_END_MS,
  SHIELD_MS,
  SHOCK_R,
  SHOCK_SPEED,
  STEP_MS,
  SUDDEN_MS,
  TURBO_MS,
  WARN_MS,
  sanitizeOptions,
  type GameOptions,
  type ItemKind,
} from "./data";

/**
 * 범퍼 아레나 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다. 그래서 방장이 나가도
 * 손님 하나가 마지막 스냅샷으로 `createHost`를 다시 불러 판을 이어갈 수 있다(방장 승계).
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다 — 같은 입력이면 같은 결과(테스트 재현용).
 */

export type Phase = "countdown" | "fight" | "roundEnd" | "gameOver";

export interface PlayerStats {
  kos: number;
  falls: number;
  selfFalls: number;
  roundWins: number;
  draws: number;
  dashHits: number;
  pounds: number;
  gusts: number;
  items: number;
  shieldBlocks: number;
  postBounces: number;
  maxKosRound: number;
  /** 라운드를 이겼을 때의 열기 중 최고 */
  maxHeatWin: number;
  /** 열기 0~19%로 라운드 승리 */
  cleanWins: number;
}

const zeroStats = (): PlayerStats => ({
  kos: 0,
  falls: 0,
  selfFalls: 0,
  roundWins: 0,
  draws: 0,
  dashHits: 0,
  pounds: 0,
  gusts: 0,
  items: 0,
  shieldBlocks: 0,
  postBounces: 0,
  maxKosRound: 0,
  maxHeatWin: 0,
  cleanWins: 0,
});

export interface Ghost {
  x: number;
  z: number;
  face: number;
  cdAt: number;
}

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
  /** 이번 라운드에 아직 섬 위에 있나 */
  alive: boolean;
  /** 떨어지는 중 (alive=false, 화면에선 추락 연출) */
  falling: boolean;
  outAt: number;
  heat: number;
  stamina: number;
  bracing: boolean;
  /** 힘이 바닥나면 버튼을 한 번 뗄 때까지 다시 못 버팀 (켜졌다 꺼졌다 방지) */
  braceLock: boolean;
  dashUntil: number;
  dashCdAt: number;
  /** 점프 시작 시각 (0 = 땅 위) */
  jumpAt: number;
  jumpCdAt: number;
  bigUntil: number;
  turboUntil: number;
  shield: boolean;
  shieldUntil: number;
  /** 방패로 막은 직후 잠깐(같은 충돌이 이어지는 동안) 계속 보호 */
  blockUntil: number;
  lastHitBy: number;
  lastHitAt: number;
  score: number;
  roundKos: number;
  roundPts: number;
  /** 이번 라운드 몇 번째로 떨어졌나 (0 = 아직) */
  place: number;
  ghost: Ghost | null;
  stats: PlayerStats;
}

export interface Post {
  x: number;
  z: number;
  tile: number;
  hitAt: number;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
  tile: number;
  until: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "hit"; a: number; b: number; x: number; z: number; p: number; d: boolean }
  | { k: "post"; s: number; x: number; z: number }
  | { k: "dash"; s: number }
  | { k: "jump"; s: number }
  | { k: "land"; s: number; x: number; z: number; n: number }
  | { k: "fall"; s: number; by: number }
  | { k: "spawn"; kind: ItemKind; x: number; z: number }
  | { k: "pick"; s: number; kind: ItemKind; x: number; z: number }
  | { k: "shock"; s: number; x: number; z: number }
  | { k: "block"; s: number }
  | { k: "gust"; s: number; x: number; z: number; fx: number; fz: number; n: number }
  | { k: "round"; round: number }
  | { k: "go" }
  | { k: "sudden" }
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
  /** 떨어진 순서 (먼저 떨어진 사람 먼저) */
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
  /** 타일별 떨어지는 시각 (0 = 멀쩡). t ≥ 값이면 사라짐, 그 전 WARN_MS 동안 흔들림 */
  tiles: number[];
  nextCrumbleAt: number;
  sudden: boolean;
  posts: Post[];
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

export function geoOf(s: MatchState): ArenaGeo {
  return arenaGeo(s.rings);
}

/** 이 타일이 지금 서 있을 수 있나 (흔들리는 중이어도 아직 서 있음) */
export function tileSolid(s: MatchState, i: number, at = s.t): boolean {
  if (i < 0) return false;
  const f = s.tiles[i];
  return f === 0 || at < f;
}

/** 이 타일이 곧(horizon ms 안에) 사라지나 — 봇·화면 경고용 */
export function tileDoomed(s: MatchState, i: number, horizon: number): boolean {
  if (i < 0) return true;
  const f = s.tiles[i];
  return f !== 0 && s.t + horizon >= f;
}

export function solidAt(s: MatchState, x: number, z: number, at = s.t): boolean {
  return tileSolid(s, tileIndexAt(geoOf(s), x, z), at);
}

export function radiusOf(p: PlayerState, t: number): number {
  return BODY_R * (t < p.bigUntil ? BIG_SCALE : 1);
}

function massOf(p: PlayerState, t: number): number {
  return (t < p.bigUntil ? 2.2 : 1) * (p.bracing ? BRACE_MASS : 1);
}

export function airborne(p: PlayerState): boolean {
  return p.jumpAt > 0;
}

export function dashing(p: PlayerState, t: number): boolean {
  return t < p.dashUntil;
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
    outAt: 0,
    heat: 0,
    stamina: 1,
    bracing: false,
    braceLock: false,
    dashUntil: 0,
    dashCdAt: 0,
    jumpAt: 0,
    jumpCdAt: 0,
    bigUntil: 0,
    turboUntil: 0,
    shield: false,
    shieldUntil: 0,
    blockUntil: 0,
    lastHitBy: -1,
    lastHitAt: 0,
    score: 0,
    roundKos: 0,
    roundPts: 0,
    place: 0,
    ghost: null,
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
    tiles: [],
    nextCrumbleAt: 0,
    sudden: false,
    posts: [],
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
  s.tiles = geo.tiles.map(() => 0);
  s.nextCrumbleAt = s.fightStart + CRUMBLE_START_MS;
  s.sudden = false;
  s.posts = postTiles(geo).map((tile) => ({ x: geo.tiles[tile].x, z: geo.tiles[tile].z, tile, hitAt: 0 }));
  s.items = [];
  s.nextItemAt = s.fightStart + ITEM_FIRST_MS;
  // 자리 배치: 바깥에서 두 번째 링 둘레에 고르게, 라운드마다 회전·순서를 섞는다
  const n = s.seatCount;
  const order = s.players.map((p) => p.seat);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rot = rnd(s) * Math.PI * 2;
  const spawnR = (s.rings - 1.5) * 1.3 * Math.sqrt(3);
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
      outAt: 0,
      heat: 0,
      stamina: 1,
      bracing: false,
      dashUntil: 0,
      dashCdAt: 0,
      jumpAt: 0,
      jumpCdAt: 0,
      bigUntil: 0,
      turboUntil: 0,
      shield: false,
      shieldUntil: 0,
      lastHitBy: -1,
      lastHitAt: 0,
      roundKos: 0,
      roundPts: 0,
      place: 0,
      ghost: null,
    } satisfies Partial<PlayerState>);
    // 꼴찌 보호막 (역전 장치)
    if (round > 1 && leader - p.score >= COMEBACK_GAP) {
      p.shield = true;
      p.shieldUntil = s.fightStart + SHIELD_MS;
    }
  });
  emit(s, { k: "round", round });
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 이동 방향 (화면 기준 x→오른쪽, z→아래), 길이 ≤ 1 */
  mx: number;
  mz: number;
  brace: boolean;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  dash: number;
  jump: number;
}

export interface BotMemory {
  nextThinkAt: number;
  target: number;
  wander: { x: number; z: number; until: number } | null;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seenDash: number[];
  seenJump: number[];
  dashReq: number[];
  jumpReq: number[];
  acc: number;
  bots: BotMemory[];
  /** 봇 생각 함수 (bot.ts가 꽂는다 — 순환 import 방지) */
  think: ((rt: HostRuntime, seat: number) => void) | null;
  /** 봇 손떨림용 난수 (경기 rng와 따로 — 사람 입력 타이밍과 무관하게 재현되도록) */
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, brace: false, dash: 0, jump: 0 });

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seenDash: Array(n).fill(0),
    seenJump: Array(n).fill(0),
    dashReq: Array(n).fill(-1),
    jumpReq: Array(n).fill(-1),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, target: -1, wander: null })),
    think,
    botRng: { rng: (state.seed ^ 0x5bd1e995) | 0 },
  };
}

/** 사람 입력 (방장 기기 자신 또는 손님이 보낸 `in`) */
export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= rt.state.seatCount) return;
  const p = rt.state.players[seat];
  if (p.bot) return;
  setInput(rt, seat, inp);
}

/** 봇·사람 공용: 입력 저장 + 새로 누른 대시/점프 기억 */
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
  cur.brace = !!inp.brace;
  const d = Number(inp.dash) || 0;
  const j = Number(inp.jump) || 0;
  if (d > rt.seenDash[seat]) {
    rt.seenDash[seat] = d;
    rt.dashReq[seat] = rt.state.t;
  }
  if (j > rt.seenJump[seat]) {
    rt.seenJump[seat] = j;
    rt.jumpReq[seat] = rt.state.t;
  }
  cur.dash = d;
  cur.jump = j;
}

/** 봇용: 대시·점프 한 번 누르기 */
export function press(rt: HostRuntime, seat: number, what: "dash" | "jump") {
  if (what === "dash") rt.dashReq[seat] = rt.state.t;
  else rt.jumpReq[seat] = rt.state.t;
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
    rt.seenDash[seat] = 0;
    rt.seenJump[seat] = 0;
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
    // 끝난 뒤: 떨어지던 몸만 마저 떨어진다 (살아남은 사람은 제자리에서 미끄러져 멈춤)
    for (const p of s.players) if (p.alive || p.falling) moveBody(rt, p, STEP_MS / 1000, false);
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
    if (p.alive) control(rt, p, dt);
    if (p.alive || p.falling) moveBody(rt, p, dt, true);
    else if (p.ghost) moveGhost(rt, p, dt);
  }
  collideBodies(s);
  collidePosts(s);
  pickItems(s);
  for (const p of s.players) if (p.shield && s.t >= p.shieldUntil) p.shield = false;
  // 무너짐
  if (!s.sudden && el >= SUDDEN_MS) {
    s.sudden = true;
    emit(s, { k: "sudden" });
  }
  if (s.t >= s.nextCrumbleAt) crumble(s, el);
  // 아이템
  if (s.options.items) {
    s.items = s.items.filter((it) => it.until > s.t && tileSolid(s, it.tile));
    if (s.t >= s.nextItemAt) {
      s.nextItemAt = s.t + ITEM_EVERY_MS;
      if (s.items.length < ITEM_MAX) spawnItem(s);
    }
  }
  for (const post of s.posts) if (!tileSolid(s, post.tile)) post.hitAt = -1;
  s.posts = s.posts.filter((p) => p.hitAt >= 0);
  checkRoundEnd(s, el);
}

/** 입력 → 대시·점프·버티기 */
function control(rt: HostRuntime, p: PlayerState, dt: number) {
  const s = rt.state;
  const inp = rt.inputs[p.seat];
  const air = airborne(p);
  const turbo = s.t < p.turboUntil;
  // 버티기
  if (!inp.brace) p.braceLock = false;
  const wantBrace = inp.brace && !air && !dashing(p, s.t) && !p.braceLock;
  if (wantBrace && (p.bracing ? p.stamina > 0 : p.stamina >= BRACE_MIN_START)) p.bracing = true;
  else p.bracing = false;
  if (p.bracing) p.stamina = Math.max(0, p.stamina - BRACE_DRAIN * dt);
  else p.stamina = Math.min(1, p.stamina + BRACE_REGEN * dt);
  if (p.bracing && p.stamina <= 0) {
    p.bracing = false;
    p.braceLock = true;
  }
  // 대시 (누른 뒤 0.2초 안에 쓸 수 있으면 쓴다)
  const dq = rt.dashReq[p.seat];
  if (dq >= 0) {
    if (s.t - dq > 200) rt.dashReq[p.seat] = -1;
    else if (!air && s.t >= p.dashCdAt) {
      rt.dashReq[p.seat] = -1;
      let dx = inp.mx;
      let dz = inp.mz;
      const l = Math.hypot(dx, dz);
      if (l < 0.2) {
        dx = Math.cos(p.face);
        dz = Math.sin(p.face);
      } else {
        dx /= l;
        dz /= l;
      }
      const sp = DASH_SPEED * (turbo ? 1.15 : 1);
      p.vx = dx * sp + p.vx * 0.25;
      p.vz = dz * sp + p.vz * 0.25;
      p.face = Math.atan2(dz, dx);
      p.bracing = false;
      p.dashUntil = s.t + DASH_MS;
      p.dashCdAt = s.t + DASH_CD_MS * (turbo ? 0.5 : 1);
      emit(s, { k: "dash", s: p.seat });
    }
  }
  // 점프
  const jq = rt.jumpReq[p.seat];
  if (jq >= 0) {
    if (s.t - jq > 200) rt.jumpReq[p.seat] = -1;
    else if (!air && s.t >= p.jumpCdAt) {
      rt.jumpReq[p.seat] = -1;
      p.jumpAt = s.t;
      p.jumpCdAt = s.t + JUMP_CD_MS;
      p.bracing = false;
      emit(s, { k: "jump", s: p.seat });
    }
  }
}

/** 몸 움직이기: 땅 위(가속·마찰) / 공중(포물선) / 추락 */
function moveBody(rt: HostRuntime, p: PlayerState, dt: number, live: boolean) {
  const s = rt.state;
  if (p.falling) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.vx *= 0.995;
    p.vz *= 0.995;
    if (p.y < FALL_GONE_Y) {
      p.falling = false;
      p.y = FALL_GONE_Y;
      p.vx = p.vz = p.vy = 0;
    }
    return;
  }
  const inp = live ? rt.inputs[p.seat] : { mx: 0, mz: 0 };
  const big = s.t < p.bigUntil;
  const turbo = s.t < p.turboUntil;
  if (airborne(p)) {
    p.vx += inp.mx * AIR_ACCEL * dt;
    p.vz += inp.mz * AIR_ACCEL * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const u = (s.t - p.jumpAt) / JUMP_MS;
    if (u >= 1) {
      p.y = 0;
      p.jumpAt = 0;
      if (solidAt(s, p.x, p.z)) pound(s, p);
      else startFall(s, p);
    } else p.y = JUMP_H * 4 * u * (1 - u);
    return;
  }
  // 대시 중엔 방향을 못 바꾸고(가속 0) 미끄러지듯 돌진만 한다
  const accel = dashing(p, s.t) ? 0 : ACCEL * (turbo ? 1.45 : 1) * (big ? 0.9 : 1) * (p.bracing ? BRACE_ACCEL : 1);
  const drag = dashing(p, s.t) ? DRAG_DASH : p.bracing ? DRAG_BRACE : DRAG;
  p.vx += (inp.mx * accel - p.vx * drag) * dt;
  p.vz += (inp.mz * accel - p.vz * drag) * dt;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const sp = Math.hypot(p.vx, p.vz);
  if (Math.hypot(inp.mx, inp.mz) > 0.2) p.face = turnTo(p.face, Math.atan2(inp.mz, inp.mx), dt * 12);
  else if (sp > 1.5) p.face = turnTo(p.face, Math.atan2(p.vz, p.vx), dt * 6);
  if (live && !solidAt(s, p.x, p.z)) startFall(s, p);
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

function startFall(s: MatchState, p: PlayerState) {
  if (!p.alive) return;
  p.alive = false;
  p.falling = true;
  p.bracing = false;
  p.jumpAt = 0;
  p.vy = Math.max(p.vy, 1.5);
  p.outAt = s.t;
  const fallen = s.players.filter((q) => q.place > 0).length;
  p.place = fallen + 1;
  p.stats.falls += 1;
  const by = p.lastHitBy >= 0 && s.t - p.lastHitAt <= CREDIT_MS && p.lastHitBy !== p.seat ? p.lastHitBy : -1;
  if (by >= 0) {
    const k = s.players[by];
    k.score += PTS_KO;
    k.roundPts += PTS_KO;
    k.roundKos += 1;
    k.stats.kos += 1;
    k.stats.maxKosRound = Math.max(k.stats.maxKosRound, k.roundKos);
  } else p.stats.selfFalls += 1;
  if (s.options.ghosts) p.ghost = { x: p.x, z: p.z, face: p.face, cdAt: s.t + 2500 };
  emit(s, { k: "fall", s: p.seat, by });
}

/** 착지 충격파 */
function pound(s: MatchState, p: PlayerState) {
  let n = 0;
  const big = s.t < p.bigUntil;
  const R = POUND_R * (big ? 1.25 : 1);
  for (const o of s.players) {
    if (o === p || !o.alive || airborne(o)) continue;
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > R || d < 1e-6) continue;
    const sp = POUND_SPEED * (1 - (d / R) * 0.5) * (big ? 1.3 : 1);
    if (knock(s, o, dx / d, dz / d, sp, p.seat, 6)) n++;
  }
  if (n > 0) p.stats.pounds += n;
  emit(s, { k: "land", s: p.seat, x: p.x, z: p.z, n });
}

/**
 * 한 방향으로 밀기 (충격파·입김·아이템). 열기·버티기·방패를 반영한다.
 * 반환: 실제로 밀렸나.
 */
function knock(s: MatchState, o: PlayerState, nx: number, nz: number, speed: number, by: number, heat: number, useHeat = true): boolean {
  let k = (useHeat ? 1 + o.heat / 100 : 1) * (o.bracing ? BRACE_KNOCK : 1);
  if (speed * k > 2 && by !== o.seat && shieldTake(s, o)) {
    k *= 0.2;
    heat = 0;
  }
  o.vx += nx * speed * k;
  o.vz += nz * speed * k;
  if (heat > 0) o.heat = Math.min(HEAT_MAX, o.heat + heat * (o.bracing ? 0.5 : 1));
  if (by >= 0 && by !== o.seat) {
    o.lastHitBy = by;
    o.lastHitAt = s.t;
  }
  return true;
}

/** 방패가 이 충격을 막나 — 막으면 방패를 쓰고 0.5초 동안 이어지는 충돌도 같이 막는다 */
function shieldTake(s: MatchState, p: PlayerState): boolean {
  if (s.t < p.blockUntil) return true;
  if (!p.shield) return false;
  p.shield = false;
  p.blockUntil = s.t + 500;
  p.stats.shieldBlocks += 1;
  emit(s, { k: "block", s: p.seat });
  return true;
}

/** 몸끼리 부딪힘 — 탄성 충돌 + 열기·대시·버티기 배수 (오락실식: 운동량 보존 안 함) */
function collideBodies(s: MatchState) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!b.alive) continue;
      if (Math.abs(a.y - b.y) > 0.8) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const rr = radiusOf(a, s.t) + radiusOf(b, s.t);
      if (d >= rr) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const ma = massOf(a, s.t);
      const mb = massOf(b, s.t);
      // 겹친 만큼 밀어 떼기 (가벼운 쪽이 더)
      const over = rr - d;
      const ia = 1 / ma;
      const ib = 1 / mb;
      a.x -= nx * over * (ia / (ia + ib));
      a.z -= nz * over * (ia / (ia + ib));
      b.x += nx * over * (ib / (ia + ib));
      b.z += nz * over * (ib / (ia + ib));
      const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (vn <= 0) continue;
      const J = ((1 + RESTITUTION) * vn) / (ia + ib);
      const aDash = dashing(a, s.t);
      const bDash = dashing(b, s.t);
      // 대시로 박힌 쪽만 더 날아간다. 박은 쪽은 반동을 그대로 받아 대부분 멈춘다(지나쳐 떨어지기 덜함).
      const kOf = (me: PlayerState, otherDash: boolean) => (1 + me.heat / 100) * (otherDash ? DASH_HIT_MULT : 1) * (me.bracing ? BRACE_KNOCK : 1);
      let ka = kOf(a, bDash);
      let kb = kOf(b, aDash);
      let heatA = vn * HEAT_PER_SPEED * (bDash ? 1.6 : 1) * (aDash ? 0.35 : 1) * (a.bracing ? 0.5 : 1);
      let heatB = vn * HEAT_PER_SPEED * (aDash ? 1.6 : 1) * (bDash ? 0.35 : 1) * (b.bracing ? 0.5 : 1);
      const dva = J * ia * ka;
      const dvb = J * ib * kb;
      if (dvb > 2 && shieldTake(s, b)) {
        kb *= 0.2;
        heatB = 0;
      }
      if (dva > 2 && shieldTake(s, a)) {
        ka *= 0.2;
        heatA = 0;
      }
      a.vx -= nx * J * ia * ka;
      a.vz -= nz * J * ia * ka;
      b.vx += nx * J * ib * kb;
      b.vz += nz * J * ib * kb;
      if (vn > 1.2) {
        a.heat = Math.min(HEAT_MAX, a.heat + heatA);
        b.heat = Math.min(HEAT_MAX, b.heat + heatB);
      }
      if (J * ib * kb > 1.5) {
        b.lastHitBy = a.seat;
        b.lastHitAt = s.t;
      }
      if (J * ia * ka > 1.5) {
        a.lastHitBy = b.seat;
        a.lastHitAt = s.t;
      }
      if (aDash && vn > 3) a.stats.dashHits += 1;
      if (bDash && vn > 3) b.stats.dashHits += 1;
      if (vn > 1.2) {
        // 대시로 박은 쪽을 a(공격)로 기록
        const att = aDash || !bDash ? a : b;
        const def = att === a ? b : a;
        emit(s, { k: "hit", a: att.seat, b: def.seat, x: a.x + nx * radiusOf(a, s.t), z: a.z + nz * radiusOf(a, s.t), p: Math.round(vn * 10) / 10, d: aDash || bDash });
      }
    }
  }
}

/** 범퍼 기둥: 핀볼처럼 더 세게 튕겨낸다 */
function collidePosts(s: MatchState) {
  for (const post of s.posts) {
    for (const p of s.players) {
      if (!p.alive || airborne(p)) continue;
      const dx = p.x - post.x;
      const dz = p.z - post.z;
      const d = Math.hypot(dx, dz);
      const rr = POST_R + radiusOf(p, s.t);
      if (d >= rr) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      p.x = post.x + nx * rr;
      p.z = post.z + nz * rr;
      const vn = p.vx * nx + p.vz * nz;
      if (vn >= 0) continue;
      const out = Math.max(POST_MIN_SPEED, -vn * POST_BOUNCE);
      p.vx += nx * (out - vn);
      p.vz += nz * (out - vn);
      post.hitAt = s.t;
      p.stats.postBounces += 1;
      emit(s, { k: "post", s: p.seat, x: post.x + nx * POST_R, z: post.z + nz * POST_R });
    }
  }
}

function pickItems(s: MatchState) {
  if (s.items.length === 0) return;
  for (const p of s.players) {
    if (!p.alive || airborne(p)) continue;
    const got = s.items.find((it) => Math.hypot(it.x - p.x, it.z - p.z) < ITEM_PICK_R + radiusOf(p, s.t) - BODY_R);
    if (!got) continue;
    s.items = s.items.filter((it) => it !== got);
    p.stats.items += 1;
    emit(s, { k: "pick", s: p.seat, kind: got.kind, x: got.x, z: got.z });
    if (got.kind === "big") p.bigUntil = s.t + BIG_MS;
    else if (got.kind === "turbo") p.turboUntil = s.t + TURBO_MS;
    else if (got.kind === "shield") {
      p.shield = true;
      p.shieldUntil = s.t + SHIELD_MS;
    } else if (got.kind === "shock") {
      for (const o of s.players) {
        if (o === p || !o.alive || airborne(o)) continue;
        const dx = o.x - p.x;
        const dz = o.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > SHOCK_R || d < 1e-6) continue;
        knock(s, o, dx / d, dz / d, SHOCK_SPEED * (1 - (d / SHOCK_R) * 0.4), p.seat, 12);
      }
      emit(s, { k: "shock", s: p.seat, x: p.x, z: p.z });
    }
  }
}

function spawnItem(s: MatchState) {
  const geo = geoOf(s);
  const ok: number[] = [];
  for (let i = 0; i < geo.tiles.length; i++) {
    if (s.tiles[i] !== 0) continue;
    if (s.posts.some((p) => p.tile === i)) continue;
    if (s.items.some((it) => it.tile === i)) continue;
    const t = geo.tiles[i];
    if (s.players.some((p) => p.alive && Math.hypot(p.x - t.x, p.z - t.z) < 1.6)) continue;
    ok.push(i);
  }
  if (ok.length === 0) return;
  const tile = ok[Math.floor(rnd(s) * ok.length)];
  const kind = ITEM_KINDS[Math.floor(rnd(s) * ITEM_KINDS.length)];
  const t = geo.tiles[tile];
  s.items.push({ id: ++s.itemSeq, kind, x: t.x, z: t.z, tile, until: s.t + ITEM_LIFE_MS });
  emit(s, { k: "spawn", kind, x: t.x, z: t.z });
}

/** 바깥 링부터 무너뜨리기. 가운데 칸(링 0)은 끝까지 남는다. */
export function crumbleInterval(el: number, sudden: boolean): number {
  if (sudden) return 380;
  const k = Math.min(1, Math.max(0, (el - CRUMBLE_START_MS) / 60_000));
  return 2000 - k * 1300;
}

function crumble(s: MatchState, el: number) {
  const geo = geoOf(s);
  s.nextCrumbleAt = s.t + crumbleInterval(el, s.sudden);
  const per = Math.ceil(geo.tiles.length / 40);
  for (let n = 0; n < per; n++) {
    let pickedTile = -1;
    for (let ring = geo.rings; ring >= 1 && pickedTile < 0; ring--) {
      const left = geo.byRing[ring].filter((i) => s.tiles[i] === 0);
      if (left.length === 0) continue;
      pickedTile = left[Math.floor(rnd(s) * left.length)];
    }
    if (pickedTile < 0) return;
    s.tiles[pickedTile] = s.t + WARN_MS;
  }
}

function moveGhost(rt: HostRuntime, p: PlayerState, dt: number) {
  const s = rt.state;
  const g = p.ghost;
  if (!g) return;
  const inp = rt.inputs[p.seat];
  g.x += inp.mx * GHOST_SPEED * dt;
  g.z += inp.mz * GHOST_SPEED * dt;
  const lim = geoOf(s).radius + 1.5;
  const d = Math.hypot(g.x, g.z);
  if (d > lim) {
    g.x *= lim / d;
    g.z *= lim / d;
  }
  if (Math.hypot(inp.mx, inp.mz) > 0.2) g.face = turnTo(g.face, Math.atan2(inp.mz, inp.mx), dt * 10);
  const dq = rt.dashReq[p.seat];
  if (dq >= 0) {
    if (s.t - dq > 200) rt.dashReq[p.seat] = -1;
    else if (s.t >= g.cdAt) {
      rt.dashReq[p.seat] = -1;
      g.cdAt = s.t + GUST_CD_MS;
      const fx = Math.cos(g.face);
      const fz = Math.sin(g.face);
      let n = 0;
      for (const o of s.players) {
        if (!o.alive || airborne(o)) continue;
        if (Math.hypot(o.x - g.x, o.z - g.z) > GUST_R) continue;
        // 입김: 열기 영향 없음, KO 점수도 없음(by -1)
        knock(s, o, fx, fz, GUST_SPEED, -1, 0, false);
        n++;
      }
      if (n > 0) p.stats.gusts += n;
      emit(s, { k: "gust", s: p.seat, x: g.x, z: g.z, fx, fz, n });
    }
  }
  rt.jumpReq[p.seat] = -1;
}

function checkRoundEnd(s: MatchState, el: number) {
  const alive = s.players.filter((p) => p.alive);
  if (alive.length >= 2 && el < FIGHT_MAX_MS) return;
  const pts = s.players.map(() => 0);
  let winner = -1;
  let draw = false;
  if (alive.length === 1) {
    const w = alive[0];
    winner = w.seat;
    pts[w.seat] += PTS_WIN;
    w.stats.roundWins += 1;
    w.stats.maxHeatWin = Math.max(w.stats.maxHeatWin, Math.round(w.heat));
    if (w.heat < 20) w.stats.cleanWins += 1;
    // 2등 = 마지막으로 떨어진 사람
    const last = s.players.filter((p) => p.place > 0).sort((a, b) => b.place - a.place)[0];
    if (last) pts[last.seat] += PTS_RUNNER_UP;
  } else if (alive.length === 0) {
    // 동시 추락: 같은 순간(같은 스텝) 떨어진 마지막 사람들이 나눠 갖는다
    draw = true;
    const lastAt = Math.max(...s.players.map((p) => p.outAt));
    for (const p of s.players) if (p.outAt >= lastAt - STEP_MS * 0.5) {
      pts[p.seat] += PTS_TIE_FALL;
      p.stats.draws += 1;
    }
  } else {
    // 시간 종료
    draw = true;
    for (const p of alive) {
      pts[p.seat] += PTS_TIMEOUT;
      p.stats.draws += 1;
    }
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
  emit(s, { k: "end", winner, draw });
}

/** 최종 순위: 점수 → 라운드 승 → KO → 덜 떨어짐. 그래도 같으면 같은 등수. */
export function rankKey(p: PlayerState): number[] {
  return [p.score, p.stats.roundWins, p.stats.kos, -p.stats.falls];
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
