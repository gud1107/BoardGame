import {
  ACCEL,
  AMMO_MAX,
  AMMO_MAX_BLIZZARD,
  AMMO_START,
  BALL_R,
  BLIZZARD_AT_MS,
  BLIZZARD_MELT_MS,
  BODY_H,
  BODY_R,
  BUILD_STALL_MS,
  CHARGE_MS,
  CHARGE_SLOW,
  COCOA_MS,
  COUNTDOWN_FIRST_MS,
  COUNTDOWN_MS,
  DASH_CD_MS,
  DASH_MS,
  DASH_SPEED,
  FIELD_HL,
  FIELD_HW,
  FORT_WALL_HP,
  FROZEN_MS,
  GATHER_MS,
  GIANT_DMG,
  GIANT_R,
  GRAVITY,
  HIT_SLACK,
  HP_MAX,
  HP_SMALL_TEAM,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_KINDS,
  ITEM_LIFE_MS,
  ITEM_MAX,
  ITEM_PICK_R,
  LAUNCH_Y,
  PILE_GATHER_K,
  PILE_R,
  PILES,
  PTS_FREEZE,
  PTS_HIT,
  PTS_SNOWMAN,
  RESPAWN_SAFE_MS,
  ROUND_END_MS,
  ROUND_MS,
  SMALL_TEAM_FROZEN_K,
  SMALL_TEAM_GATHER_K,
  SNOWMAN_H,
  SNOWMAN_R,
  SNOWMAN_Z,
  SPEED,
  STEP_MS,
  THROW_CD_MS,
  WALL_COST,
  WALL_H,
  WALL_HP,
  WALL_LEN,
  WALL_LIFE_MS,
  WALL_MAX_TEAM,
  WALL_PLACE_D,
  WALL_REACH_PAST_MID,
  WALL_T,
  launchFor,
  sanitizeOptions,
  sideSign,
  snowmanHpFor,
  teamOf,
  type GameOptions,
  type ItemKind,
} from "./data";

/**
 * 눈싸움 요새전 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다. 그래서 방장이 나가도
 * 손님 하나가 마지막 스냅샷으로 `createHost`를 다시 불러 판을 이어갈 수 있다(방장 승계).
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다.
 *
 * 눈덩이는 던진 순간의 발사값(위치·속도·시각)만 담는다 — 화면은 그 값으로 포물선을 직접
 * 계산해 그려서 스냅샷 사이에도 부드럽게 난다.
 *
 * 한 스텝(1/60초) 순서: 봇 생각 → 조작(던지기·벽·구르기·뭉치기) → 몸 이동·충돌 → 눈덩이
 * 비행·맞음 → 얼었다 녹기 → 아이템 → 눈보라 → 라운드 끝 판정.
 */

export type Phase = "countdown" | "fight" | "roundEnd" | "gameOver";

export interface PlayerStats {
  throws: number;
  hits: number;
  /** 내 눈덩이로 얼린 사람 수 */
  freezes: number;
  /** 내가 얼은 횟수 */
  frozen: number;
  snowmanHits: number;
  walls: number;
  wallBreaks: number;
  gathered: number;
  dodges: number;
  items: number;
  roundWins: number;
  /** 눈사람을 마지막으로 무너뜨린 한 방 */
  finishers: number;
  /** 머리 위로 넘겨 맞힌 포물선 한 방 (높이 1.8m 넘게 날던 공) */
  lobHits: number;
}

const zeroStats = (): PlayerStats => ({
  throws: 0,
  hits: 0,
  freezes: 0,
  frozen: 0,
  snowmanHits: 0,
  walls: 0,
  wallBreaks: 0,
  gathered: 0,
  dodges: 0,
  items: 0,
  roundWins: 0,
  finishers: 0,
  lobHits: 0,
});

export interface PlayerState {
  seat: number;
  team: number;
  bot: boolean;
  lv: number;
  away: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 바라보는(조준) 방향각 (x=cos, z=sin) */
  face: number;
  hp: number;
  hpMax: number;
  ammo: number;
  /** 얼어 있는 동안 (0 = 멀쩡) — 이 시각에 녹아 진영에서 다시 시작 */
  frozenUntil: number;
  safeUntil: number;
  /** 힘 모으기 시작 시각 (0 = 안 모음) */
  chargeAt: number;
  throwCdAt: number;
  /** 뭉치는 중 진행 (ms) */
  gatherMs: number;
  gathering: boolean;
  stallUntil: number;
  dashUntil: number;
  dashCdAt: number;
  dashX: number;
  dashZ: number;
  cocoaUntil: number;
  giant: boolean;
  /** 마지막으로 던진 시각 (화면: 던지는 팔) */
  lastThrowAt: number;
  points: number;
  stats: PlayerStats;
}

export interface Ball {
  id: number;
  seat: number;
  team: number;
  x0: number;
  y0: number;
  z0: number;
  vx: number;
  vy: number;
  vz: number;
  t0: number;
  big: boolean;
  /** 가장 높이 올라간 높이 (포물선 판정) */
  apex: number;
}

export interface Wall {
  id: number;
  team: number;
  x: number;
  z: number;
  /** 길이 방향 각도 (x=cos, z=sin) */
  a: number;
  hp: number;
  hpMax: number;
  /** 이때 녹아 사라짐 (0 = 요새 기본 벽, 안 사라짐) */
  until: number;
  by: number;
}

export interface Snowman {
  team: number;
  x: number;
  z: number;
  hp: number;
  hpMax: number;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
  until: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "throw"; s: number; big: boolean }
  | { k: "hit"; s: number; by: number; x: number; y: number; z: number; big: boolean }
  | { k: "freeze"; s: number; by: number; x: number; z: number }
  | { k: "thaw"; s: number }
  | { k: "splat"; x: number; y: number; z: number; big: boolean }
  | { k: "wallHit"; w: number; by: number; x: number; y: number; z: number }
  | { k: "wallBreak"; w: number; by: number; x: number; z: number }
  | { k: "wallUp"; w: number; s: number }
  | { k: "melt"; w: number }
  | { k: "snowman"; team: number; by: number; hp: number; x: number; y: number; z: number }
  | { k: "gather"; s: number; ammo: number }
  | { k: "dash"; s: number }
  | { k: "denied"; s: number; what: "throw" | "wall" | "dash" }
  | { k: "spawn"; kind: ItemKind; x: number; z: number }
  | { k: "pick"; s: number; kind: ItemKind; x: number; z: number }
  | { k: "expire"; kind: ItemKind; x: number; z: number }
  | { k: "round"; round: number }
  | { k: "go" }
  | { k: "blizzard" }
  | { k: "end"; winner: number; reason: "snowman" | "time" | "draw" }
  | { k: "over" }
);

export interface RoundSummary {
  round: number;
  /** 이긴 팀 (−1 = 무승부) */
  winner: number;
  reason: "snowman" | "time" | "draw";
  snowmanHp: number[];
  freezes: number[];
  ms: number;
  /** 이 라운드 MVP (점수가 가장 높은 사람) */
  mvp: number;
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  teamSize: number[];
  options: GameOptions;
  round: number;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  fightStart: number;
  blizzard: boolean;
  nextMeltAt: number;
  players: PlayerState[];
  balls: Ball[];
  ballSeq: number;
  walls: Wall[];
  wallSeq: number;
  snowmen: Snowman[];
  items: Item[];
  nextItemAt: number;
  itemSeq: number;
  /** 팀별 이긴 라운드 */
  wins: number[];
  events: GameEvent[];
  eventSeq: number;
  history: RoundSummary[];
  /** 끝났을 때 최종 순위 (자리별 등수, 1부터) */
  ranks: number[] | null;
  /** 끝났을 때 이긴 팀 (−1 = 무승부) */
  winnerTeam: number | null;
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

export const isFrozen = (p: PlayerState, t: number) => p.frozenUntil > t;
export const ammoMax = (s: MatchState) => (s.blizzard ? AMMO_MAX_BLIZZARD : AMMO_MAX);

/** 눈덩이의 t 시각 위치 */
export function ballPos(b: Ball, t: number): { x: number; y: number; z: number } {
  const dt = Math.max(0, (t - b.t0) / 1000);
  return { x: b.x0 + b.vx * dt, y: b.y0 + b.vy * dt - 0.5 * GRAVITY * dt * dt, z: b.z0 + b.vz * dt };
}

export function nearPile(x: number, z: number): boolean {
  return PILES.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < PILE_R * PILE_R);
}

/** 이 팀이 (x, z)에 벽을 세울 수 있나 — 이유도 함께 */
export function wallSpotOk(s: MatchState, team: number, x: number, z: number, a: number): boolean {
  if (Math.abs(x) > FIELD_HW - 0.6 || Math.abs(z) > FIELD_HL - 0.6) return false;
  // 자기 진영(가운데선 너머 1m까지)
  if (z * sideSign(team) < -WALL_REACH_PAST_MID) return false;
  for (const w of s.walls) if (Math.hypot(w.x - x, w.z - z) < 1.5) return false;
  for (const m of s.snowmen) if (Math.hypot(m.x - x, m.z - z) < SNOWMAN_R + 1.0) return false;
  for (const p of s.players) {
    if (isFrozen(p, s.t)) continue;
    if (circleBox(p.x, p.z, BODY_R, x, z, a)) return false;
  }
  return true;
}

/** 원이 벽 상자와 겹치나 */
export function circleBox(px: number, pz: number, r: number, wx: number, wz: number, a: number): boolean {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const dx = px - wx;
  const dz = pz - wz;
  const u = dx * c + dz * sn;
  const v = -dx * sn + dz * c;
  const hu = WALL_LEN / 2;
  const hv = WALL_T / 2;
  const cu = Math.max(-hu, Math.min(hu, u));
  const cv = Math.max(-hv, Math.min(hv, v));
  return (u - cu) * (u - cu) + (v - cv) * (v - cv) < r * r;
}

/* ── 이벤트 ─────────────────────────────────────────────────────────── */

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

function emit(s: MatchState, e: EventBody) {
  s.events.push({ ...(e as object), id: ++s.eventSeq, at: s.t } as GameEvent);
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

function newPlayer(seat: number, spec: SeatSpec, teamSize: number[]): PlayerState {
  const team = teamOf(seat);
  const small = teamSize[team] < teamSize[1 - team];
  return {
    seat,
    team,
    bot: spec.bot,
    lv: Math.max(1, Math.min(10, Math.round(spec.level) || 5)),
    away: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    face: 0,
    hp: small ? HP_SMALL_TEAM : HP_MAX,
    hpMax: small ? HP_SMALL_TEAM : HP_MAX,
    ammo: AMMO_START,
    frozenUntil: 0,
    safeUntil: 0,
    chargeAt: 0,
    throwCdAt: 0,
    gatherMs: 0,
    gathering: false,
    stallUntil: 0,
    dashUntil: 0,
    dashCdAt: 0,
    dashX: 0,
    dashZ: 0,
    cocoaUntil: 0,
    giant: false,
    lastThrowAt: 0,
    points: 0,
    stats: zeroStats(),
  };
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const seatCount = Math.max(2, seats.length);
  const teamSize = [0, 0];
  for (let i = 0; i < seatCount; i++) teamSize[teamOf(i)]++;
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount,
    teamSize,
    options: sanitizeOptions(options),
    round: 0,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: 0,
    fightStart: 0,
    blizzard: false,
    nextMeltAt: 0,
    players: Array.from({ length: seatCount }, (_, i) => newPlayer(i, seats[i] ?? { bot: true, level: 5 }, teamSize)),
    balls: [],
    ballSeq: 0,
    walls: [],
    wallSeq: 0,
    snowmen: [],
    items: [],
    nextItemAt: 0,
    itemSeq: 0,
    wins: [0, 0],
    events: [],
    eventSeq: 0,
    history: [],
    ranks: null,
    winnerTeam: null,
  };
  startRound(s, 1);
  return s;
}

/** 팀 안에서 몇 번째인가 (자리 배치용) */
function teamIndex(s: MatchState, seat: number): number {
  let k = 0;
  for (let i = 0; i < seat; i++) if (teamOf(i) === teamOf(seat)) k++;
  return k;
}

export function spawnPoint(s: MatchState, seat: number): { x: number; z: number } {
  const team = teamOf(seat);
  const n = s.teamSize[team];
  const k = teamIndex(s, seat);
  const x = (k - (n - 1) / 2) * 3.2;
  return { x, z: sideSign(team) * 10.2 };
}

function fortWalls(s: MatchState) {
  for (const team of [0, 1]) {
    const sg = sideSign(team);
    // 눈사람 앞 반원 세 칸 (사라지지 않는 요새 벽)
    const spots = [
      { x: 0, z: sg * (SNOWMAN_Z - 2.6), a: 0 },
      { x: -2.3, z: sg * (SNOWMAN_Z - 1.6), a: sg * 0.9 },
      { x: 2.3, z: sg * (SNOWMAN_Z - 1.6), a: -sg * 0.9 },
    ];
    for (const sp of spots) s.walls.push({ id: ++s.wallSeq, team, x: sp.x, z: sp.z, a: sp.a, hp: FORT_WALL_HP, hpMax: FORT_WALL_HP, until: 0, by: -1 });
  }
}

function startRound(s: MatchState, round: number) {
  s.round = round;
  s.phase = "countdown";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + (round === 1 ? COUNTDOWN_FIRST_MS : COUNTDOWN_MS);
  s.fightStart = s.phaseEnd;
  s.blizzard = false;
  s.nextMeltAt = 0;
  s.balls = [];
  s.walls = [];
  s.items = [];
  s.nextItemAt = s.fightStart + ITEM_FIRST_MS;
  fortWalls(s);
  s.snowmen = [0, 1].map((team) => {
    const hp = snowmanHpFor(s.teamSize[1 - team], s.teamSize[team]);
    return { team, x: 0, z: sideSign(team) * SNOWMAN_Z, hp, hpMax: hp };
  });
  for (const p of s.players) {
    const sp = spawnPoint(s, p.seat);
    Object.assign(p, {
      x: sp.x,
      z: sp.z,
      vx: 0,
      vz: 0,
      face: p.team === 0 ? -Math.PI / 2 : Math.PI / 2,
      hp: p.hpMax,
      ammo: AMMO_START,
      frozenUntil: 0,
      safeUntil: 0,
      chargeAt: 0,
      throwCdAt: 0,
      gatherMs: 0,
      gathering: false,
      stallUntil: 0,
      dashUntil: 0,
      dashCdAt: 0,
      cocoaUntil: 0,
      giant: false,
      lastThrowAt: 0,
    } satisfies Partial<PlayerState>);
  }
  emit(s, { k: "round", round });
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 이동 방향 (세계 좌표 x, z), 길이 ≤ 1 */
  mx: number;
  mz: number;
  /** 조준 방향각 (x=cos, z=sin) */
  aim: number;
  /** 힘 모으는 중 (꾹 누름) */
  charge: number;
  /** 눈 뭉치는 중 (꾹 누름) */
  gather: number;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  throw: number;
  /** 던지는 순간 내 기기에서 잰 힘 (0~1000) */
  pow: number;
  wall: number;
  dash: number;
}

export interface BotMemory {
  nextThinkAt: number;
  /** 지금 하려는 일 */
  goal: "gather" | "attack" | "siege" | "defend" | "item" | "idle";
  /** 힘을 다 모으면 던질 시각 */
  releaseAt: number;
  /** 던질 때 쓸 조준각·힘 */
  aim: number;
  pow: number;
  strafe: number;
  strafeUntil: number;
  target: number;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seen: { throw: number[]; wall: number[]; dash: number[] };
  /** 들어온 버튼 요청 시각 (−1 = 없음) */
  req: { throw: number[]; wall: number[]; dash: number[] };
  reqPow: number[];
  acc: number;
  bots: BotMemory[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, aim: 0, charge: 0, gather: 0, throw: 0, pow: 0, wall: 0, dash: 0 });

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seen: { throw: Array(n).fill(0), wall: Array(n).fill(0), dash: Array(n).fill(0) },
    req: { throw: Array(n).fill(-1), wall: Array(n).fill(-1), dash: Array(n).fill(-1) },
    reqPow: Array(n).fill(0),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, goal: "idle", releaseAt: 0, aim: 0, pow: 0, strafe: 1, strafeUntil: 0, target: -1 })),
    think,
    botRng: { rng: (state.seed ^ 0x51f0c7) | 0 },
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
  const aim = Number(inp.aim);
  if (Number.isFinite(aim)) cur.aim = aim;
  cur.charge = inp.charge ? 1 : 0;
  cur.gather = inp.gather ? 1 : 0;
  for (const k of ["throw", "wall", "dash"] as const) {
    const v = Number(inp[k]) || 0;
    if (v > rt.seen[k][seat]) {
      rt.seen[k][seat] = v;
      rt.req[k][seat] = rt.state.t;
      if (k === "throw") rt.reqPow[seat] = Math.max(0, Math.min(1, (Number(inp.pow) || 0) / 1000));
    }
    cur[k] = v;
  }
  cur.pow = Number(inp.pow) || 0;
}

/** 봇용: 버튼 한 번 */
export function press(rt: HostRuntime, seat: number, what: "throw" | "wall" | "dash", pow = 0) {
  rt.req[what][seat] = rt.state.t;
  if (what === "throw") rt.reqPow[seat] = Math.max(0, Math.min(1, pow));
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
    rt.seen.throw[seat] = 0;
    rt.seen.wall[seat] = 0;
    rt.seen.dash[seat] = 0;
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
      s.phase = "fight";
      s.phaseStart = s.t;
      emit(s, { k: "go" });
    }
  } else if (s.phase === "fight") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    fight(rt);
  } else if (s.phase === "roundEnd") {
    for (const p of s.players) {
      p.vx *= 0.85;
      p.vz *= 0.85;
      p.chargeAt = 0;
      p.gathering = false;
    }
    flyBalls(s, true);
    if (s.t >= s.phaseEnd) {
      const need = Math.floor(s.options.rounds / 2) + 1;
      if (s.round >= s.options.rounds || s.wins[0] >= need || s.wins[1] >= need) finishMatch(s);
      else startRound(s, s.round + 1);
    }
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function fight(rt: HostRuntime) {
  const s = rt.state;
  const dt = STEP_MS / 1000;
  const el = s.t - s.fightStart;
  for (const p of s.players) {
    if (isFrozen(p, s.t)) continue;
    if (p.frozenUntil !== 0) thaw(s, p);
    control(rt, p);
    moveBody(rt, p, dt);
  }
  collideBodies(s);
  flyBalls(s, false);
  if (s.options.items) items(s);
  blizzard(s, el);
  for (const w of s.walls) if (w.until !== 0 && s.t >= w.until) {
    w.hp = 0;
    emit(s, { k: "melt", w: w.id });
  }
  s.walls = s.walls.filter((w) => w.hp > 0);
  checkRoundEnd(s, el);
}

function thaw(s: MatchState, p: PlayerState) {
  p.frozenUntil = 0;
  const sp = spawnPoint(s, p.seat);
  p.x = sp.x;
  p.z = sp.z;
  p.vx = 0;
  p.vz = 0;
  p.hp = p.hpMax;
  p.ammo = Math.max(p.ammo, 1);
  p.safeUntil = s.t + RESPAWN_SAFE_MS;
  emit(s, { k: "thaw", s: p.seat });
}

/** 버튼 요청은 0.2초 안에 쓸 수 있으면 쓴다 */
function take(rt: HostRuntime, what: "throw" | "wall" | "dash", seat: number): boolean {
  const q = rt.req[what][seat];
  if (q < 0) return false;
  if (rt.state.t - q > 200) {
    rt.req[what][seat] = -1;
    return false;
  }
  return true;
}

function control(rt: HostRuntime, p: PlayerState) {
  const s = rt.state;
  const inp = rt.inputs[p.seat];
  p.face = inp.aim;
  const cocoa = s.t < p.cocoaUntil;
  // 힘 모으기: 누르기 시작한 시각을 기억 (눈덩이가 있어야)
  if (inp.charge && p.chargeAt === 0 && p.ammo > 0 && s.t >= p.stallUntil) p.chargeAt = s.t;
  // 손을 뗐는데 던지기 요청이 없으면(취소) 모은 힘은 사라진다 — 손님은 떼기와 던지기를 한 패킷에 보낸다
  if (!inp.charge && p.chargeAt !== 0 && !take(rt, "throw", p.seat)) p.chargeAt = 0;
  if (take(rt, "throw", p.seat)) {
    rt.req.throw[p.seat] = -1;
    if (p.ammo <= 0 || s.t < p.throwCdAt || s.t < p.stallUntil) {
      emit(s, { k: "denied", s: p.seat, what: "throw" });
      p.chargeAt = 0;
    } else {
      // 내 기기가 잰 힘을 쓰되, 방장이 본 실제 누른 시간보다 많이 세게는 못 한다
      const held = p.chargeAt ? ((s.t - p.chargeAt) / CHARGE_MS) * (cocoa ? 2 : 1) : 0;
      const pow = Math.min(rt.reqPow[p.seat], held + 0.3);
      throwBall(s, p, pow);
      p.chargeAt = 0;
    }
  }
  if (take(rt, "wall", p.seat)) {
    rt.req.wall[p.seat] = -1;
    buildWall(s, p);
  }
  if (take(rt, "dash", p.seat)) {
    rt.req.dash[p.seat] = -1;
    if (s.t >= p.dashCdAt && s.t >= p.stallUntil) {
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
      p.dashX = dx;
      p.dashZ = dz;
      p.dashUntil = s.t + DASH_MS;
      p.dashCdAt = s.t + DASH_CD_MS;
      p.chargeAt = 0;
      p.gathering = false;
      emit(s, { k: "dash", s: p.seat });
    } else emit(s, { k: "denied", s: p.seat, what: "dash" });
  }
  // 뭉치기: 가만히 쪼그려 앉아 꾹
  const moving = Math.hypot(inp.mx, inp.mz) > 0.15;
  p.gathering = !!inp.gather && !moving && p.chargeAt === 0 && s.t >= p.dashUntil && p.ammo < ammoMax(s);
  if (p.gathering) {
    const small = s.teamSize[p.team] < s.teamSize[1 - p.team];
    const k = (nearPile(p.x, p.z) ? PILE_GATHER_K : 1) * (small ? SMALL_TEAM_GATHER_K : 1) * (cocoa ? 2 : 1) * (s.blizzard ? 1.5 : 1);
    p.gatherMs += STEP_MS * k;
    if (p.gatherMs >= GATHER_MS) {
      p.gatherMs = 0;
      p.ammo += 1;
      p.stats.gathered += 1;
      emit(s, { k: "gather", s: p.seat, ammo: p.ammo });
    }
  } else if (!inp.gather) p.gatherMs = Math.max(0, p.gatherMs - STEP_MS * 0.5);
}

function throwBall(s: MatchState, p: PlayerState, pow: number) {
  const L = launchFor(pow);
  const c = Math.cos(p.face);
  const sn = Math.sin(p.face);
  const big = p.giant;
  const b: Ball = {
    id: ++s.ballSeq,
    seat: p.seat,
    team: p.team,
    x0: p.x + c * (BODY_R + 0.15),
    y0: LAUNCH_Y,
    z0: p.z + sn * (BODY_R + 0.15),
    vx: c * L.vh,
    vy: L.vy,
    vz: sn * L.vh,
    t0: s.t,
    big,
    apex: LAUNCH_Y,
  };
  s.balls.push(b);
  p.giant = false;
  p.ammo -= 1;
  p.throwCdAt = s.t + THROW_CD_MS;
  p.lastThrowAt = s.t;
  p.stats.throws += 1;
  emit(s, { k: "throw", s: p.seat, big });
}

function buildWall(s: MatchState, p: PlayerState) {
  const c = Math.cos(p.face);
  const sn = Math.sin(p.face);
  const x = p.x + c * WALL_PLACE_D;
  const z = p.z + sn * WALL_PLACE_D;
  const a = p.face + Math.PI / 2;
  const mine = s.walls.filter((w) => w.team === p.team && w.until !== 0).length;
  if (p.ammo < WALL_COST || mine >= WALL_MAX_TEAM || !wallSpotOk(s, p.team, x, z, a) || s.t < p.stallUntil) {
    emit(s, { k: "denied", s: p.seat, what: "wall" });
    return;
  }
  p.ammo -= WALL_COST;
  p.stallUntil = s.t + BUILD_STALL_MS;
  p.chargeAt = 0;
  const w: Wall = { id: ++s.wallSeq, team: p.team, x, z, a, hp: WALL_HP, hpMax: WALL_HP, until: s.t + WALL_LIFE_MS, by: p.seat };
  s.walls.push(w);
  p.stats.walls += 1;
  emit(s, { k: "wallUp", w: w.id, s: p.seat });
}

function moveBody(rt: HostRuntime, p: PlayerState, dt: number) {
  const s = rt.state;
  const inp = rt.inputs[p.seat];
  if (s.t < p.dashUntil) {
    p.vx = p.dashX * DASH_SPEED;
    p.vz = p.dashZ * DASH_SPEED;
  } else {
    const stalled = s.t < p.stallUntil || p.gathering;
    const max = stalled ? 0 : SPEED * (p.chargeAt ? CHARGE_SLOW : 1);
    const tx = inp.mx * max;
    const tz = inp.mz * max;
    const dvx = tx - p.vx;
    const dvz = tz - p.vz;
    const dl = Math.hypot(dvx, dvz);
    const lim = ACCEL * dt;
    if (dl > lim) {
      p.vx += (dvx / dl) * lim;
      p.vz += (dvz / dl) * lim;
    } else {
      p.vx = tx;
      p.vz = tz;
    }
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // 눈밭 밖으로는 못 나감
  p.x = Math.max(-FIELD_HW + BODY_R, Math.min(FIELD_HW - BODY_R, p.x));
  p.z = Math.max(-FIELD_HL + BODY_R, Math.min(FIELD_HL - BODY_R, p.z));
  // 벽·눈사람에 막힘
  for (const w of s.walls) pushOutOfWall(p, w);
  for (const m of s.snowmen) {
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const d = Math.hypot(dx, dz);
    const rr = SNOWMAN_R + BODY_R;
    if (d < rr && d > 1e-6) {
      p.x = m.x + (dx / d) * rr;
      p.z = m.z + (dz / d) * rr;
    }
  }
}

function pushOutOfWall(p: PlayerState, w: Wall) {
  const c = Math.cos(w.a);
  const sn = Math.sin(w.a);
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const u = dx * c + dz * sn;
  const v = -dx * sn + dz * c;
  const hu = WALL_LEN / 2;
  const hv = WALL_T / 2;
  const cu = Math.max(-hu, Math.min(hu, u));
  const cv = Math.max(-hv, Math.min(hv, v));
  const ex = u - cu;
  const ev = v - cv;
  const d2 = ex * ex + ev * ev;
  if (d2 >= BODY_R * BODY_R) return;
  let nu: number;
  let nv: number;
  if (d2 < 1e-9) {
    // 몸 중심이 벽 안: 가까운 면으로
    if (hu - Math.abs(u) < hv - Math.abs(v)) {
      nu = Math.sign(u) || 1;
      nv = 0;
      const pu = (hu + BODY_R) * nu;
      p.x = w.x + pu * c - v * sn;
      p.z = w.z + pu * sn + v * c;
    } else {
      nu = 0;
      nv = Math.sign(v) || 1;
      const pv = (hv + BODY_R) * nv;
      p.x = w.x + u * c - pv * sn;
      p.z = w.z + u * sn + pv * c;
    }
    return;
  }
  const d = Math.sqrt(d2);
  nu = ex / d;
  nv = ev / d;
  const push = BODY_R - d;
  p.x += (nu * c - nv * sn) * push;
  p.z += (nu * sn + nv * c) * push;
}

function collideBodies(s: MatchState) {
  const ps = s.players.filter((p) => !isFrozen(p, s.t));
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const rr = BODY_R * 2;
      if (d >= rr || d < 1e-6) continue;
      const push = (rr - d) / 2;
      a.x -= (dx / d) * push;
      a.z -= (dz / d) * push;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
}

/* ── 눈덩이 ─────────────────────────────────────────────────────────── */

function flyBalls(s: MatchState, settling: boolean) {
  const keep: Ball[] = [];
  for (const b of s.balls) {
    const prev = ballPos(b, s.t - STEP_MS);
    const cur = ballPos(b, s.t);
    b.apex = Math.max(b.apex, cur.y);
    const r = b.big ? GIANT_R : BALL_R;
    let gone = false;
    if (!settling) {
      // 사람 (상대 팀만, 얼지 않고, 무적·구르기 중이 아니면)
      for (const p of s.players) {
        if (p.team === b.team || isFrozen(p, s.t) || s.t < p.safeUntil || s.t < p.dashUntil) continue;
        if (cur.y > BODY_H + r || cur.y < -r) continue;
        if (segCircle(prev.x, prev.z, cur.x, cur.z, p.x, p.z, BODY_R + r + HIT_SLACK)) {
          hitPlayer(s, p, b, cur);
          gone = true;
          break;
        }
      }
      // 상대 눈사람
      if (!gone)
        for (const m of s.snowmen) {
          if (m.team === b.team || m.hp <= 0) continue;
          if (cur.y > SNOWMAN_H + r) continue;
          if (segCircle(prev.x, prev.z, cur.x, cur.z, m.x, m.z, SNOWMAN_R + r)) {
            hitSnowman(s, m, b, cur);
            gone = true;
            break;
          }
        }
    }
    // 벽 (어느 팀 벽이든 막는다 — 내 벽도!)
    if (!gone)
      for (const w of s.walls) {
        if (w.hp <= 0 || cur.y > WALL_H + r) continue;
        if (circleBox(cur.x, cur.z, r, w.x, w.z, w.a)) {
          hitWall(s, w, b, cur);
          gone = true;
          break;
        }
      }
    if (!gone && (cur.y <= r || Math.abs(cur.x) > FIELD_HW + 3 || Math.abs(cur.z) > FIELD_HL + 3)) {
      emit(s, { k: "splat", x: cur.x, y: Math.max(0, cur.y), z: cur.z, big: b.big });
      gone = true;
    }
    if (!gone && s.t - b.t0 > 4000) gone = true;
    if (!gone) keep.push(b);
  }
  s.balls = keep;
}

/** 선분 (ax,az)→(bx,bz)가 원과 만나나 */
function segCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((cx - ax) * dx + (cz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx;
  const pz = az + dz * t - cz;
  return px * px + pz * pz < r * r;
}

function hitPlayer(s: MatchState, p: PlayerState, b: Ball, at: { x: number; y: number; z: number }) {
  const by = s.players[b.seat];
  const dmg = b.big ? GIANT_DMG : 1;
  p.hp -= dmg;
  p.chargeAt = 0;
  p.gathering = false;
  // 맞으면 살짝 밀린다
  const l = Math.hypot(b.vx, b.vz) || 1;
  p.vx += (b.vx / l) * (b.big ? 5 : 2.2);
  p.vz += (b.vz / l) * (b.big ? 5 : 2.2);
  if (by) {
    by.stats.hits += 1;
    by.points += PTS_HIT;
    if (b.apex > 1.8) by.stats.lobHits += 1;
  }
  emit(s, { k: "hit", s: p.seat, by: b.seat, x: at.x, y: at.y, z: at.z, big: b.big });
  if (p.hp <= 0) {
    p.hp = 0;
    const small = s.teamSize[p.team] < s.teamSize[1 - p.team];
    p.frozenUntil = s.t + FROZEN_MS * (small ? SMALL_TEAM_FROZEN_K : 1);
    p.stats.frozen += 1;
    p.ammo = Math.min(p.ammo, 1);
    p.giant = false;
    if (by) {
      by.stats.freezes += 1;
      by.points += PTS_FREEZE;
    }
    emit(s, { k: "freeze", s: p.seat, by: b.seat, x: p.x, z: p.z });
  }
}

function hitSnowman(s: MatchState, m: Snowman, b: Ball, at: { x: number; y: number; z: number }) {
  const by = s.players[b.seat];
  const dmg = b.big ? GIANT_DMG : 1;
  m.hp = Math.max(0, m.hp - dmg);
  if (by) {
    by.stats.snowmanHits += 1;
    by.points += PTS_SNOWMAN * dmg;
    if (m.hp === 0) by.stats.finishers += 1;
  }
  emit(s, { k: "snowman", team: m.team, by: b.seat, hp: m.hp, x: at.x, y: at.y, z: at.z });
}

function hitWall(s: MatchState, w: Wall, b: Ball, at: { x: number; y: number; z: number }) {
  w.hp = b.big ? 0 : w.hp - 1;
  emit(s, { k: "wallHit", w: w.id, by: b.seat, x: at.x, y: at.y, z: at.z });
  if (w.hp <= 0) {
    w.hp = 0;
    const by = s.players[b.seat];
    if (by && w.team !== by.team) by.stats.wallBreaks += 1;
    emit(s, { k: "wallBreak", w: w.id, by: b.seat, x: w.x, z: w.z });
  }
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

function items(s: MatchState) {
  for (const it of s.items) {
    if (s.t >= it.until) emit(s, { k: "expire", kind: it.kind, x: it.x, z: it.z });
  }
  s.items = s.items.filter((it) => s.t < it.until);
  for (const p of s.players) {
    if (isFrozen(p, s.t)) continue;
    const it = s.items.find((x) => Math.hypot(x.x - p.x, x.z - p.z) < ITEM_PICK_R + BODY_R);
    if (!it) continue;
    s.items = s.items.filter((x) => x !== it);
    p.stats.items += 1;
    if (it.kind === "cocoa") {
      p.hp = p.hpMax;
      p.cocoaUntil = s.t + COCOA_MS;
    } else p.giant = true;
    emit(s, { k: "pick", s: p.seat, kind: it.kind, x: it.x, z: it.z });
  }
  if (s.t >= s.nextItemAt) {
    s.nextItemAt = s.t + ITEM_EVERY_MS;
    if (s.items.length < ITEM_MAX) {
      const kind = ITEM_KINDS[Math.floor(rnd(s) * ITEM_KINDS.length)];
      // 가운데선 근처, 좌우 대칭이 되게 한 번은 왼쪽 한 번은 오른쪽
      const side = s.itemSeq % 2 === 0 ? 1 : -1;
      const x = side * (1.5 + rnd(s) * 6);
      const z = (rnd(s) - 0.5) * 2.4;
      s.items.push({ id: ++s.itemSeq, kind, x, z, until: s.t + ITEM_LIFE_MS });
      emit(s, { k: "spawn", kind, x, z });
    }
  }
}

/* ── 눈보라 ─────────────────────────────────────────────────────────── */

function blizzard(s: MatchState, el: number) {
  if (!s.options.blizzard) return;
  if (!s.blizzard && el >= BLIZZARD_AT_MS) {
    s.blizzard = true;
    s.nextMeltAt = s.t + BLIZZARD_MELT_MS;
    emit(s, { k: "blizzard" });
  }
  if (s.blizzard && s.t >= s.nextMeltAt) {
    s.nextMeltAt = s.t + BLIZZARD_MELT_MS;
    for (const w of s.walls) {
      w.hp -= 1;
      if (w.hp <= 0) emit(s, { k: "melt", w: w.id });
    }
  }
}

/* ── 라운드 끝 ─────────────────────────────────────────────────────── */

function checkRoundEnd(s: MatchState, el: number) {
  const down = s.snowmen.filter((m) => m.hp <= 0).map((m) => m.team);
  let winner = -2;
  let reason: RoundSummary["reason"] = "snowman";
  if (down.length === 2) {
    winner = -1;
    reason = "draw";
  } else if (down.length === 1) winner = 1 - down[0];
  else if (el >= ROUND_MS) {
    const frac = s.snowmen.map((m) => m.hp / m.hpMax);
    if (Math.abs(frac[0] - frac[1]) > 1e-9) winner = frac[0] > frac[1] ? 0 : 1;
    else {
      const fz = [0, 1].map((team) => s.players.filter((p) => p.team === team).reduce((a, p) => a + p.stats.freezes, 0));
      winner = fz[0] === fz[1] ? -1 : fz[0] > fz[1] ? 0 : 1;
    }
    reason = winner < 0 ? "draw" : "time";
  }
  if (winner === -2) return;
  if (winner >= 0) {
    s.wins[winner] += 1;
    for (const p of s.players) if (p.team === winner) p.stats.roundWins += 1;
  }
  let mvp = 0;
  for (const p of s.players) if (p.points > s.players[mvp].points) mvp = p.seat;
  const freezes = [0, 1].map((team) => s.players.filter((p) => p.team === team).reduce((a, p) => a + p.stats.freezes, 0));
  s.history.push({ round: s.round, winner, reason, snowmanHp: s.snowmen.map((m) => m.hp), freezes, ms: el, mvp });
  s.phase = "roundEnd";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + ROUND_END_MS;
  emit(s, { k: "end", winner, reason });
}

export function computeRanks(s: MatchState): number[] {
  const w = s.wins[0] === s.wins[1] ? -1 : s.wins[0] > s.wins[1] ? 0 : 1;
  return s.players.map((p) => (w < 0 || p.team === w ? 1 : 2));
}

function finishMatch(s: MatchState) {
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.ranks = computeRanks(s);
  s.winnerTeam = s.wins[0] === s.wins[1] ? -1 : s.wins[0] > s.wins[1] ? 0 : 1;
  emit(s, { k: "over" });
}
