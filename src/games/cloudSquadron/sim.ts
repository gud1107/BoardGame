import {
  BOSS_RAGE_MS,
  COMBO_BONUS,
  COMBO_MS,
  DIFF,
  ENEMIES,
  GAUGE_PER_DMG,
  GAUGE_PER_GRAZE,
  GAUGE_PER_SEC,
  H,
  INTRO_MS,
  INVULN_MS,
  MAX_POWER,
  MID_TIMEOUT_MS,
  PICK_MS,
  PILOTS,
  PILOT_IDS,
  RESPAWN_INVULN_MS,
  REVIVE_MS,
  REVIVE_R,
  SELF_REVIVE_MS,
  SELF_REVIVE_PENALTY,
  STAGES,
  STAGE_CLEAR_MS,
  STAR_SCORE,
  STEP_MS,
  W,
  hpScale,
  sanitizeOptions,
  type EnemyKind,
  type GameOptions,
  type ItemKind,
  type PilotId,
} from "./data";

/**
 * 구름 편대 시뮬레이션 (룰북 §3~§8). 방장 기기만 돌린다 — 60Hz 고정 스텝.
 *
 * 판정 분담 (룰북 §10):
 * - **사람 기체의 위치와 피격은 그 사람 기기가 정한다.** 손님은 자기 위치·맞은 횟수·스친 횟수를
 *   `in`으로 보내고, 방장은 속도 한도 안에서 받아들인다. 핑이 높아도 "내 화면에서 피했는데 맞음"이
 *   생기지 않게 하려는 것. 봇 기체는 방장이 움직이고 판정한다.
 * - 적·적탄·아이템·점수·스킬 효과는 전부 방장이 정한다. 적탄은 전부 직선 등속이라 손님은
 *   스냅샷(10번/초) 사이를 `x + vx·경과`로 정확히 이어 그린다. 탄을 지우는 효과(방패·레이저·
 *   네이팜·돌진·폭격·신호탄)는 `activeZones()`를 손님도 똑같이 계산해서 미리 숨긴다.
 * - 아군 탄은 방장만 판정용으로 만든다(`HostRuntime.shots`, 스냅샷에 안 실림). 손님 화면의 아군 탄은
 *   같은 발사 규칙(`fireVolley`)으로 그리는 장식이다.
 */

/* ── 타입 ───────────────────────────────────────────────────────────── */

export type Phase = "pick" | "intro" | "play" | "stageClear" | "gameOver";
export type Segment = "wavesA" | "mid" | "wavesB" | "warn" | "boss" | "done";

export interface PlayerStats {
  kills: number;
  damage: number;
  bossDamage: number;
  downs: number;
  revives: number;
  grazes: number;
  hits: number;
  skills: number;
  ults: number;
  combos: number;
  items: number;
  bossKills: number;
}

export interface PlayerState {
  seat: number;
  bot: boolean;
  away: boolean;
  level: number;
  pilot: PilotId | null;
  ready: boolean;
  x: number;
  y: number;
  st: "fly" | "down";
  hp: number;
  power: number;
  score: number;
  gauge: number;
  invulnUntil: number;
  skillReadyAt: number;
  downAt: number;
  /** 부활 진행 (ms, REVIVE_MS가 되면 부활) */
  revive: number;
  focus: boolean;
  /* 스킬·궁극기 진행 (시각 ms, 0 = 없음) */
  dashUntil: number;
  dashX: number;
  dashY: number;
  shieldUntil: number;
  droneUntil: number;
  chargeAt: number;
  beamUntil: number;
  stealthUntil: number;
  stealthUsed: boolean;
  napalmUntil: number;
  vortexUntil: number;
  vortexN: number;
  ramStart: number;
  ramX: number;
  ramY0: number;
  carpetStart: number;
  carpetRow: number;
  flareAt: number;
  ultAt: number;
  comboUntil: number;
  stats: PlayerStats;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  max: number;
  /** 등장 뒤 흐른 시간 (시간 감속이면 천천히 흐른다) */
  age: number;
  x0: number;
  y0: number;
  ty: number;
  dir: number;
  amp: number;
  ph: number;
  fireAt: number;
  cyc: number;
  bphase: number;
  lockX: number;
  /** 맞은 시각 (반짝임) */
  hitAt: number;
  /** 자리별 준 피해 (보스 점수 나누기) */
  dmgBy: number[];
  /** 드롭 */
  drop: ItemKind[];
}

/** 적탄 (직선 등속). k: 0 작은 구슬 · 1 큰 구슬 · 2 쌀알(조준탄) · 3 거품(느리고 큼) */
export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
  r: number;
}

/** 보스 번개 줄기: 예고(warn) → 발사(fireAt~until) */
export interface Lane {
  id: number;
  x: number;
  w: number;
  fireAt: number;
  until: number;
}

export interface Patch {
  x: number;
  y: number;
  until: number;
  seat: number;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  vy: number;
}

export type GameEvent = { id: number; at: number } & EventBody;
type EventBody =
  | { k: "kill"; x: number; y: number; kind: EnemyKind; by: number }
  | { k: "hit"; s: number }
  | { k: "phase"; s: number }
  | { k: "down"; s: number }
  | { k: "revive"; s: number; by: number }
  | { k: "skill"; s: number; pilot: PilotId }
  | { k: "ult"; s: number; pilot: PilotId }
  | { k: "combo"; a: number; b: number }
  | { k: "chain"; s: number; pts: number[] }
  | { k: "item"; s: number; kind: ItemKind }
  | { k: "pick"; s: number; pilot: PilotId }
  | { k: "stage"; stage: number }
  | { k: "warn"; kind: EnemyKind }
  | { k: "midIn" }
  | { k: "midGone" }
  | { k: "bossPhase"; n: number }
  | { k: "bossDown"; kind: EnemyKind; x: number; y: number }
  | { k: "clear"; stage: number }
  | { k: "continue"; left: number }
  | { k: "lane"; x: number }
  | { k: "over"; result: "clear" | "fail" };

export interface StageSummary {
  stage: number;
  ms: number;
  kills: number;
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  phase: Phase;
  phaseEnd: number;
  stage: number;
  stageStart: number;
  seg: Segment;
  segStart: number;
  nextSpawnAt: number;
  players: PlayerState[];
  enemies: Enemy[];
  bullets: Bullet[];
  lanes: Lane[];
  patches: Patch[];
  items: Item[];
  /** 시간 감속 끝 시각 (그림자 궁극기) */
  slowUntil: number;
  continues: number;
  result: "clear" | "fail" | null;
  ranks: number[] | null;
  history: StageSummary[];
  stageKills: number;
  events: GameEvent[];
  eventSeq: number;
  idSeq: number;
}

export interface SeatSpec {
  bot: boolean;
  level: number;
}

/* ── 난수·보조 ──────────────────────────────────────────────────────── */

export function rnd(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function emit(s: MatchState, e: EventBody) {
  s.events.push({ ...(e as object), id: ++s.eventSeq, at: s.t } as GameEvent);
}

export function slowK(s: MatchState, t = s.t): number {
  return t < s.slowUntil ? 0.35 : 1;
}

export const flying = (p: PlayerState) => p.st === "fly" && p.pilot !== null;
export const ramming = (p: PlayerState, t: number) => p.ramStart > 0 && t < p.ramStart + 1000;
export const dashing = (p: PlayerState, t: number) => t < p.dashUntil;
export const vortexing = (p: PlayerState, t: number) => t < p.vortexUntil;
export const beaming = (p: PlayerState, t: number) => p.chargeAt > 0 && t >= p.chargeAt && t < p.beamUntil;
export const charging = (p: PlayerState, t: number) => p.chargeAt > 0 && t < p.chargeAt;

/** 피격 무적인가 (맞은 뒤 무적·대시·돌진·소용돌이) */
export function invulnerable(p: PlayerState, t: number): boolean {
  return t < p.invulnUntil || dashing(p, t) || ramming(p, t) || vortexing(p, t);
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

const emptyStats = (): PlayerStats => ({ kills: 0, damage: 0, bossDamage: 0, downs: 0, revives: 0, grazes: 0, hits: 0, skills: 0, ults: 0, combos: 0, items: 0, bossKills: 0 });

function newPlayer(seat: number, spec: SeatSpec, n: number): PlayerState {
  return {
    seat,
    bot: spec.bot,
    away: false,
    level: spec.level,
    pilot: null,
    ready: false,
    x: startX(seat, n),
    y: H - 90,
    st: "fly",
    hp: 3,
    power: 1,
    score: 0,
    gauge: 0,
    invulnUntil: 0,
    skillReadyAt: 0,
    downAt: 0,
    revive: 0,
    focus: false,
    dashUntil: 0,
    dashX: 0,
    dashY: -1,
    shieldUntil: 0,
    droneUntil: 0,
    chargeAt: 0,
    beamUntil: 0,
    stealthUntil: 0,
    stealthUsed: false,
    napalmUntil: 0,
    vortexUntil: 0,
    vortexN: 0,
    ramStart: 0,
    ramX: 0,
    ramY0: 0,
    carpetStart: 0,
    carpetRow: 0,
    flareAt: 0,
    ultAt: -99999,
    comboUntil: 0,
    stats: emptyStats(),
  };
}

export function startX(seat: number, n: number): number {
  return (W * (seat + 1)) / (n + 1);
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const opts = sanitizeOptions(options);
  const n = Math.max(1, Math.min(4, seats.length));
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: n,
    options: opts,
    phase: "pick",
    phaseEnd: PICK_MS,
    stage: 0,
    stageStart: 0,
    seg: "wavesA",
    segStart: 0,
    nextSpawnAt: 0,
    players: seats.slice(0, n).map((sp, i) => newPlayer(i, sp, n)),
    enemies: [],
    bullets: [],
    lanes: [],
    patches: [],
    items: [],
    slowUntil: 0,
    continues: DIFF[opts.difficulty].continues,
    result: null,
    ranks: null,
    history: [],
    stageKills: 0,
    events: [],
    eventSeq: 0,
    idSeq: 0,
  };
  return s;
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 사람: 자기 기기가 정한 위치 (-1 = 아직 없음) */
  x: number;
  y: number;
  focus: boolean;
  /** 누른 횟수 카운터 */
  skill: number;
  ult: number;
  /** 내 화면에서 맞은 횟수·스친 횟수 (누적) */
  hits: number;
  grazes: number;
  /** 고르기 단계 */
  pick: PilotId | null;
  ready: boolean;
  /** 대시 방향 (스킬 누를 때) */
  dx: number;
  dy: number;
}

export interface BotMemory {
  nextThinkAt: number;
  mx: number;
  my: number;
  focus: boolean;
  pickAt: number;
  /** 스침 세기 간격 카운터 */
  gz: number;
}

/** 방장 전용: 판정용 아군 탄 */
export interface Shot {
  seat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  r: number;
  pierce: boolean;
  homing: boolean;
  until: number;
  hit: number[] | null;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seen: { skill: number; ult: number; hits: number; grazes: number }[];
  /** 사람 위치를 받은 시각 (속도 한도 계산) */
  posAt: number[];
  fireAcc: number[];
  droneAcc: number[];
  napalmAcc: number[];
  shots: Shot[];
  acc: number;
  bots: BotMemory[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ x: -1, y: -1, focus: false, skill: 0, ult: 0, hits: 0, grazes: 0, pick: null, ready: false, dx: 0, dy: -1 });

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seen: Array.from({ length: n }, () => ({ skill: 0, ult: 0, hits: 0, grazes: 0 })),
    posAt: Array(n).fill(0),
    fireAcc: Array(n).fill(0),
    droneAcc: Array(n).fill(0),
    napalmAcc: Array(n).fill(0),
    shots: [],
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, mx: 0, my: 0, focus: false, pickAt: 0, gz: 0 })),
    think,
    botRng: { rng: (state.seed ^ 0x5bd1e995) | 0 },
  };
}

/** 사람 입력 (방장 기기 자신 또는 손님이 보낸 `in`) */
export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= rt.state.seatCount) return;
  const s = rt.state;
  const p = s.players[seat];
  if (p.bot) return;
  const cur = rt.inputs[seat];
  const seen = rt.seen[seat];
  // 고르기
  if (s.phase === "pick") {
    if (typeof inp.pick === "string" && (PILOT_IDS as string[]).includes(inp.pick)) choosePilot(s, seat, inp.pick as PilotId);
    if (typeof inp.ready === "boolean" && p.pilot) p.ready = inp.ready;
  }
  // 위치: 속도 한도 안에서
  const x = Number(inp.x);
  const y = Number(inp.y);
  if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && p.pilot && flying(p) && (s.phase === "play" || s.phase === "intro" || s.phase === "stageClear")) {
    const pilot = PILOTS[p.pilot];
    const dt = clamp((s.t - rt.posAt[seat]) / 1000, 0.02, 0.5);
    let lim = pilot.speed * 1.6 * dt + 24;
    if (dashing(p, s.t + 200)) lim += 1300 * dt;
    if (ramming(p, s.t) || s.t - p.ramStart < 1300) lim += 1600 * dt + 400;
    const tx = clamp(x, 12, W - 12);
    const ty = clamp(y, 30, H - 16);
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d <= lim) {
      p.x = tx;
      p.y = ty;
    } else {
      p.x += ((tx - p.x) / d) * lim;
      p.y += ((ty - p.y) / d) * lim;
    }
    rt.posAt[seat] = s.t;
  }
  p.focus = !!inp.focus;
  cur.focus = p.focus;
  const dx = Number(inp.dx);
  const dy = Number(inp.dy);
  if (Number.isFinite(dx) && Number.isFinite(dy)) {
    cur.dx = dx;
    cur.dy = dy;
  }
  const sk = Number(inp.skill) || 0;
  if (sk > seen.skill) {
    seen.skill = sk;
    castSkill(rt, seat, cur.dx, cur.dy);
  }
  const ul = Number(inp.ult) || 0;
  if (ul > seen.ult) {
    seen.ult = ul;
    castUlt(rt, seat);
  }
  const hits = Number(inp.hits) || 0;
  if (hits > seen.hits) {
    seen.hits = hits;
    if (s.phase === "play") hitPlayer(s, p);
  }
  const gz = Number(inp.grazes) || 0;
  if (gz > seen.grazes) {
    const d = Math.min(20, gz - seen.grazes);
    seen.grazes = gz;
    if (s.phase === "play" && flying(p)) addGraze(p, d);
  }
}

export function addGraze(p: PlayerState, n: number) {
  p.stats.grazes += n;
  p.score += 10 * n;
  p.gauge = Math.min(100, p.gauge + GAUGE_PER_GRAZE * n);
}

/** 조종사 고르기 (한 판에 같은 조종사는 한 명) */
export function choosePilot(s: MatchState, seat: number, id: PilotId): boolean {
  if (s.phase !== "pick") return false;
  const p = s.players[seat];
  if (!p || s.players.some((q) => q.seat !== seat && q.pilot === id)) return false;
  if (p.pilot === id) return true;
  p.pilot = id;
  p.ready = false;
  emit(s, { k: "pick", s: seat, pilot: id });
  return true;
}

/** 사람이 나가면 봇이 대신, 돌아오면 돌려준다 */
export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p) return;
  if (away && !p.bot) {
    p.bot = true;
    p.away = true;
    p.level = Math.max(p.level, 6);
  } else if (!away && p.away) {
    p.bot = false;
    p.away = false;
    rt.inputs[seat] = idleInput();
    rt.seen[seat] = { skill: 0, ult: 0, hits: 0, grazes: 0 };
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
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
  if (s.phase === "pick") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    const allReady = s.players.every((p) => p.pilot && (p.ready || p.bot));
    if (allReady || s.t >= s.phaseEnd) startExpedition(rt);
    return;
  }
  if (s.phase === "gameOver") return;
  if (s.phase === "intro") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    movePlayers(rt, STEP_MS / 1000);
    if (s.t >= s.phaseEnd) {
      s.phase = "play";
      s.stageStart = s.t;
      s.seg = "wavesA";
      s.segStart = s.t;
      s.nextSpawnAt = s.t + 600;
    }
    return;
  }
  if (s.phase === "stageClear") {
    if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
    movePlayers(rt, STEP_MS / 1000);
    collectItems(s);
    moveItems(s, STEP_MS / 1000);
    if (s.t >= s.phaseEnd) {
      if (s.stage + 1 >= s.options.stages) finish(s, "clear");
      else beginStage(s, s.stage + 1);
    }
    return;
  }
  // play
  if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
  const dt = STEP_MS / 1000;
  movePlayers(rt, dt);
  playerFire(rt, dt);
  skillTicks(rt, dt);
  director(s);
  moveEnemies(s, dt);
  moveBullets(s, dt);
  clearZones(s);
  moveShots(rt, dt);
  moveItems(s, dt);
  collectItems(s);
  botHits(rt);
  downed(s, dt);
  for (const p of s.players) if (flying(p)) p.gauge = Math.min(100, p.gauge + GAUGE_PER_SEC * dt);
  s.patches = s.patches.filter((q) => q.until > s.t);
  s.lanes = s.lanes.filter((l) => l.until > s.t);
}

function startExpedition(rt: HostRuntime) {
  const s = rt.state;
  // 못 고른 자리는 남은 조종사 중 무작위
  for (const p of s.players) {
    if (p.pilot) continue;
    const free = PILOT_IDS.filter((id) => !s.players.some((q) => q.pilot === id));
    const id = free[Math.floor(rnd(s) * free.length)];
    p.pilot = id;
    emit(s, { k: "pick", s: p.seat, pilot: id });
  }
  for (const p of s.players) {
    const pilot = PILOTS[p.pilot!];
    p.hp = pilot.maxHp;
    p.ready = true;
  }
  beginStage(s, 0);
}

function beginStage(s: MatchState, stage: number) {
  s.stage = stage;
  s.phase = "intro";
  s.phaseEnd = s.t + INTRO_MS;
  s.enemies = [];
  s.bullets = [];
  s.lanes = [];
  s.items = [];
  s.stageKills = 0;
  s.seg = "wavesA";
  for (const p of s.players) {
    if (p.st === "down") revivePlayer(s, p, -1, true);
    p.y = H - 90;
    p.x = startX(p.seat, s.seatCount);
    p.invulnUntil = s.t + INTRO_MS + 1000;
  }
  emit(s, { k: "stage", stage });
}

function finish(s: MatchState, result: "clear" | "fail") {
  s.phase = "gameOver";
  s.result = result;
  s.ranks = s.players.map(() => (result === "clear" ? 1 : 2));
  s.bullets = [];
  s.lanes = [];
  emit(s, { k: "over", result });
}

/* ── 기체 움직임 (봇은 여기서, 사람은 자기 기기에서 같은 함수로) ──────── */

/** 한 기체를 dt초 움직인다. mx,my = 입력 방향(길이 ≤ 1) */
export function movePlane(p: PlayerState, mx: number, my: number, focus: boolean, dt: number, t: number) {
  if (!p.pilot || p.st !== "fly") return;
  const pilot = PILOTS[p.pilot];
  if (ramming(p, t)) {
    const k = clamp((t - p.ramStart) / 1000, 0, 1);
    p.x = p.ramX;
    p.y = p.ramY0 - (p.ramY0 - 50) * Math.sin(Math.PI * k);
    return;
  }
  if (dashing(p, t)) {
    p.x += p.dashX * 1100 * dt;
    p.y += p.dashY * 1100 * dt;
  } else {
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    const sp = focus ? pilot.focusSpeed : pilot.speed;
    p.x += mx * sp * dt;
    p.y += my * sp * dt;
  }
  p.x = clamp(p.x, 12, W - 12);
  p.y = clamp(p.y, 30, H - 16);
}

function movePlayers(rt: HostRuntime, dt: number) {
  const s = rt.state;
  for (const p of s.players) {
    if (!p.bot) continue;
    const m = rt.bots[p.seat];
    p.focus = m.focus;
    movePlane(p, m.mx, m.my, m.focus, dt, s.t);
  }
}

/* ── 발사 ───────────────────────────────────────────────────────────── */

export interface VolleyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  r: number;
  pierce: boolean;
  homing: boolean;
  life: number;
}

/** 파워별 초당 피해 (모든 조종사 기준) */
export const basePps = (power: number) => 55 + 30 * (power - 1);

export const FIRE_INTERVAL: Record<PilotId, number> = { wind: 70, iron: 220, firefly: 160, bolt: 50, shadow: 420, flame: 120 };

/** 한 번 쏘는 탄들 (방장 판정과 손님 장식이 같은 규칙을 쓴다) */
export function fireVolley(pilot: PilotId, power: number, x: number, y: number): VolleyShot[] {
  const iv = FIRE_INTERVAL[pilot] / 1000;
  const budget = basePps(power) * iv;
  const out: VolleyShot[] = [];
  const add = (dx: number, ang: number, sp: number, dmg: number, r: number, o: Partial<VolleyShot> = {}) =>
    out.push({ x: x + dx, y: y - 14, vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp, dmg, r, pierce: false, homing: false, life: 1.4, ...o });
  switch (pilot) {
    case "wind": {
      const n = power + 1;
      const offs = [-6, 6, -14, 14, 0].slice(0, n);
      const angs = [0, 0, -0.07, 0.07, 0].slice(0, n);
      offs.forEach((o, i) => add(o, power >= 4 && i >= 2 ? angs[i] * 1.8 : angs[i], 900, (budget / n) * 1.12, 3));
      break;
    }
    case "iron": {
      const n = 2 + power;
      const spread = 0.26 + power * 0.06;
      for (let i = 0; i < n; i++) add(0, -spread / 2 + (spread * i) / (n - 1), 560, (budget / n) * 1.05, 6);
      break;
    }
    case "firefly": {
      const n = 1 + power;
      for (let i = 0; i < n; i++) {
        const a = -0.5 + (1 * i) / Math.max(1, n - 1);
        add((i - (n - 1) / 2) * 8, n === 1 ? 0 : a, 430, (budget / n) * 0.92, 4.5, { homing: true, life: 1.8 });
      }
      break;
    }
    case "bolt": {
      add(0, 0, 1250, budget * (power >= 3 ? 0.58 : 0.72), power >= 2 ? 3.5 : 2.5, { pierce: true });
      if (power >= 3) {
        add(-12, -0.05, 1200, budget * 0.19, 2, { pierce: true });
        add(12, 0.05, 1200, budget * 0.19, 2, { pierce: true });
      }
      break;
    }
    case "shadow": {
      add(0, 0, 1050, budget * (power >= 3 ? 0.7 : 0.85), 7, { pierce: true });
      if (power >= 3) {
        add(-10, -0.02, 1000, budget * 0.15, 4, { pierce: true });
        add(10, 0.02, 1000, budget * 0.15, 4, { pierce: true });
      }
      break;
    }
    case "flame": {
      const n = 4 + power;
      const spread = 0.8 + power * 0.08;
      for (let i = 0; i < n; i++) add(0, -spread / 2 + (spread * i) / (n - 1), 660, (budget / n) * 1.55, 4.5, { life: 0.34 });
      break;
    }
  }
  return out;
}

function playerFire(rt: HostRuntime, dt: number) {
  const s = rt.state;
  for (const p of s.players) {
    if (!flying(p) || ramming(p, s.t) || vortexing(p, s.t) || charging(p, s.t)) continue;
    rt.fireAcc[p.seat] += dt * 1000;
    const iv = FIRE_INTERVAL[p.pilot!];
    while (rt.fireAcc[p.seat] >= iv) {
      rt.fireAcc[p.seat] -= iv;
      for (const v of fireVolley(p.pilot!, p.power, p.x, p.y)) rt.shots.push({ seat: p.seat, x: v.x, y: v.y, vx: v.vx, vy: v.vy, dmg: v.dmg, r: v.r, pierce: v.pierce, homing: v.homing, until: s.t + v.life * 1000, hit: v.pierce ? [] : null });
    }
  }
}

function moveShots(rt: HostRuntime, dt: number) {
  const s = rt.state;
  for (const sh of rt.shots) {
    if (sh.homing) {
      let best: Enemy | null = null;
      let bd = 1e9;
      for (const e of s.enemies) {
        if (e.y < -10) continue;
        const d = (e.x - sh.x) ** 2 + (e.y - sh.y) ** 2;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) {
        const dx = best.x - sh.x;
        const dy = best.y - sh.y;
        const d = Math.hypot(dx, dy) || 1;
        sh.vx += (dx / d) * 1700 * dt;
        sh.vy += (dy / d) * 1700 * dt;
        const v = Math.hypot(sh.vx, sh.vy) || 1;
        sh.vx = (sh.vx / v) * 470;
        sh.vy = (sh.vy / v) * 470;
      }
    }
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    for (const e of s.enemies) {
      if (e.hp <= 0 || e.y < -20) continue;
      const rr = ENEMIES[e.kind].r + sh.r;
      if ((e.x - sh.x) ** 2 + (e.y - sh.y) ** 2 > rr * rr) continue;
      if (sh.hit) {
        if (sh.hit.includes(e.id)) continue;
        sh.hit.push(e.id);
        damageEnemy(s, e, sh.dmg, sh.seat);
      } else {
        damageEnemy(s, e, sh.dmg, sh.seat);
        sh.until = 0;
        break;
      }
    }
  }
  rt.shots = rt.shots.filter((sh) => sh.until > s.t && sh.y > -30 && sh.y < H + 30 && sh.x > -30 && sh.x < W + 30);
  sweepDead(s);
}

export function damageEnemy(s: MatchState, e: Enemy, dmg: number, seat: number) {
  if (e.hp <= 0 || dmg <= 0) return;
  const p = s.players[seat];
  const real = Math.min(e.hp, dmg * (p && s.t < p.comboUntil ? COMBO_BONUS : 1));
  e.hp -= real;
  e.hitAt = s.t;
  e.dmgBy[seat] = (e.dmgBy[seat] ?? 0) + real;
  if (p) {
    p.stats.damage += real;
    if (ENEMIES[e.kind].boss || ENEMIES[e.kind].mid) p.stats.bossDamage += real;
    p.gauge = Math.min(100, p.gauge + real * GAUGE_PER_DMG);
  }
}

function sweepDead(s: MatchState) {
  if (!s.enemies.some((e) => e.hp <= 0)) return;
  const alive: Enemy[] = [];
  for (const e of s.enemies) {
    if (e.hp > 0) {
      alive.push(e);
      continue;
    }
    const info = ENEMIES[e.kind];
    // 점수: 보스·중간 보스는 준 피해 비율로 나눔, 잡몹은 막타
    let killer = 0;
    let best = -1;
    e.dmgBy.forEach((d, i) => {
      if ((d ?? 0) > best) {
        best = d ?? 0;
        killer = i;
      }
    });
    if (info.boss || info.mid) {
      const total = e.dmgBy.reduce((a, b) => a + (b ?? 0), 0) || 1;
      e.dmgBy.forEach((d, i) => {
        const p = s.players[i];
        if (p) p.score += Math.round((info.score * (d ?? 0)) / total);
      });
    } else {
      const last = s.players[killer];
      if (last) last.score += info.score;
    }
    const kp = s.players[killer];
    if (kp) kp.stats.kills++;
    s.stageKills++;
    for (let i = 0; i < e.drop.length; i++) dropItem(s, e.drop[i], e.x + (i - (e.drop.length - 1) / 2) * 18, e.y);
    if (info.boss) {
      for (const p of s.players) if ((e.dmgBy[p.seat] ?? 0) > 0) p.stats.bossKills++;
      emit(s, { k: "bossDown", kind: e.kind, x: e.x, y: e.y });
      stageCleared(s);
    } else {
      emit(s, { k: "kill", x: Math.round(e.x), y: Math.round(e.y), kind: e.kind, by: killer });
      if (info.mid) {
        s.seg = "wavesB";
        s.segStart = s.t;
      }
    }
  }
  s.enemies = alive;
}

function stageCleared(s: MatchState) {
  s.history.push({ stage: s.stage, ms: Math.round(s.t - s.stageStart), kills: s.stageKills });
  s.phase = "stageClear";
  s.phaseEnd = s.t + STAGE_CLEAR_MS;
  s.seg = "done";
  s.enemies = [];
  // 남은 적탄은 별이 되어 떨어진다 (보너스)
  const stars = s.bullets.filter((_, i) => i % 6 === 0).slice(0, 24);
  for (const b of stars) dropItem(s, "star", b.x, b.y);
  s.bullets = [];
  s.lanes = [];
  for (const p of s.players) {
    if (p.st === "down") revivePlayer(s, p, -1, true);
    p.score += 1000 + p.hp * 500;
    p.invulnUntil = s.t + STAGE_CLEAR_MS + 1000;
  }
  emit(s, { k: "clear", stage: s.stage });
}

/* ── 스킬 ───────────────────────────────────────────────────────────── */

export function canSkill(p: PlayerState, s: { phase: Phase; t: number }): boolean {
  return s.phase === "play" && flying(p) && s.t >= p.skillReadyAt && !ramming(p, s.t);
}
export function canUlt(p: PlayerState, s: { phase: Phase; t: number }): boolean {
  return s.phase === "play" && flying(p) && p.gauge >= 100 && !ramming(p, s.t);
}

export function castSkill(rt: HostRuntime, seat: number, dx = 0, dy = -1) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !canSkill(p, s)) return false;
  const pilot = PILOTS[p.pilot!];
  p.skillReadyAt = s.t + pilot.skillCd;
  p.stats.skills++;
  switch (pilot.id) {
    case "wind": {
      let l = Math.hypot(dx, dy);
      if (l < 0.2) {
        dx = 0;
        dy = -1;
        l = 1;
      }
      p.dashX = dx / l;
      p.dashY = dy / l;
      p.dashUntil = s.t + 350;
      break;
    }
    case "iron":
      p.shieldUntil = s.t + 3000;
      break;
    case "firefly": {
      p.droneUntil = s.t + 6000;
      const hurt = s.players.filter((q) => flying(q) && q.hp < PILOTS[q.pilot!].maxHp).sort((a, b) => a.hp - b.hp || Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (hurt) hurt.hp += 1;
      break;
    }
    case "bolt":
      p.chargeAt = s.t + 600;
      p.beamUntil = s.t + 1500;
      break;
    case "shadow":
      p.stealthUntil = s.t + 2500;
      p.stealthUsed = false;
      break;
    case "flame":
      p.napalmUntil = s.t + 3000;
      break;
  }
  emit(s, { k: "skill", s: seat, pilot: pilot.id });
  return true;
}

export function castUlt(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !canUlt(p, s)) return false;
  const pilot = PILOTS[p.pilot!];
  p.gauge = 0;
  p.stats.ults++;
  // 합동 궁극기
  const partner = s.players.find((q) => q.seat !== seat && s.t - q.ultAt <= COMBO_MS);
  p.ultAt = s.t;
  if (partner) {
    p.comboUntil = s.t + 2500;
    partner.comboUntil = Math.max(partner.comboUntil, s.t + 2500);
    p.score += 2000;
    partner.score += 2000;
    p.stats.combos++;
    partner.stats.combos++;
    emit(s, { k: "combo", a: partner.seat, b: seat });
  }
  emit(s, { k: "ult", s: seat, pilot: pilot.id });
  switch (pilot.id) {
    case "wind":
      p.vortexUntil = s.t + 1600;
      p.vortexN = 0;
      break;
    case "iron":
      p.ramStart = s.t;
      p.ramX = p.x;
      p.ramY0 = p.y;
      break;
    case "firefly":
      p.flareAt = s.t;
      for (const q of s.players) {
        if (q.st === "down") revivePlayer(s, q, seat, false);
        else if (q.pilot) q.hp = Math.min(PILOTS[q.pilot].maxHp, q.hp + 1);
        q.invulnUntil = Math.max(q.invulnUntil, s.t + 1500);
      }
      break;
    case "bolt": {
      const pts: number[] = [Math.round(p.x), Math.round(p.y - 20)];
      const targets = [...s.enemies].filter((e) => e.y > -10).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      for (const e of targets) {
        damageEnemy(s, e, ENEMIES[e.kind].boss || ENEMIES[e.kind].mid ? 320 : 180, seat);
        pts.push(Math.round(e.x), Math.round(e.y));
      }
      s.bullets = s.bullets.filter((b) => b.id % 2 === 0);
      emit(s, { k: "chain", s: seat, pts: pts.slice(0, 40) });
      sweepDead(s);
      break;
    }
    case "shadow":
      s.slowUntil = s.t + 4000;
      break;
    case "flame":
      p.carpetStart = s.t;
      p.carpetRow = 0;
      break;
  }
  return true;
}

export const CARPET_ROWS = 8;
export const CARPET_ROW_MS = 160;
export const carpetRowY = (r: number) => H - 40 - r * ((H - 120) / (CARPET_ROWS - 1));

function skillTicks(rt: HostRuntime, dt: number) {
  const s = rt.state;
  for (const p of s.players) {
    if (!p.pilot) continue;
    const live = flying(p);
    // 드론 사격
    if (live && s.t < p.droneUntil) {
      rt.droneAcc[p.seat] += dt * 1000;
      while (rt.droneAcc[p.seat] >= 200) {
        rt.droneAcc[p.seat] -= 200;
        const d = dronePos(p, s.t);
        rt.shots.push({ seat: p.seat, x: d.x, y: d.y, vx: 0, vy: -620, dmg: 6, r: 3.5, pierce: false, homing: true, until: s.t + 1500, hit: null });
      }
    }
    // 충전 레이저
    if (live && beaming(p, s.t)) {
      for (const e of s.enemies) if (e.y < p.y && e.y > -20 && Math.abs(e.x - p.x) < 22 + ENEMIES[e.kind].r * 0.6) damageEnemy(s, e, 300 * dt, p.seat);
    }
    // 네이팜
    if (live && s.t < p.napalmUntil) {
      rt.napalmAcc[p.seat] += dt * 1000;
      while (rt.napalmAcc[p.seat] >= 70) {
        rt.napalmAcc[p.seat] -= 70;
        s.patches.push({ x: Math.round(p.x), y: Math.round(p.y + 6), until: s.t + 1300, seat: p.seat });
      }
    }
    // 소용돌이
    if (vortexing(p, s.t)) {
      for (const b of s.bullets) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 210) {
          b.vx = b.vx * 0.85 + (dx / d) * 320 * 0.15;
          b.vy = b.vy * 0.85 + (dy / d) * 320 * 0.15;
        }
      }
      const before = s.bullets.length;
      s.bullets = s.bullets.filter((b) => (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 26 * 26);
      p.vortexN += before - s.bullets.length;
      if (s.t + STEP_MS >= p.vortexUntil) {
        const n = clamp(Math.round(p.vortexN * 1.5), 24, 90);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          rt.shots.push({ seat: p.seat, x: p.x, y: p.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, dmg: 10, r: 5, pierce: true, homing: false, until: s.t + 1200, hit: [] });
        }
        p.vortexUntil = 0;
      }
    }
    // 강철 돌진
    if (ramming(p, s.t)) {
      for (const e of s.enemies) if (Math.abs(e.x - p.x) < 30 + ENEMIES[e.kind].r && Math.abs(e.y - p.y) < 30 + ENEMIES[e.kind].r) damageEnemy(s, e, (ENEMIES[e.kind].boss ? 700 : 1400) * dt, p.seat);
    }
    // 융단 폭격
    if (p.carpetStart > 0) {
      while (p.carpetRow < CARPET_ROWS && s.t >= p.carpetStart + p.carpetRow * CARPET_ROW_MS) {
        const y = carpetRowY(p.carpetRow);
        for (const e of s.enemies) if (Math.abs(e.y - y) < 46 + ENEMIES[e.kind].r * 0.5) damageEnemy(s, e, ENEMIES[e.kind].boss || ENEMIES[e.kind].mid ? 55 : 90, p.seat);
        p.carpetRow++;
      }
      if (p.carpetRow >= CARPET_ROWS && s.t > p.carpetStart + CARPET_ROWS * CARPET_ROW_MS + 300) p.carpetStart = 0;
    }
  }
  // 네이팜 불길 피해
  if (s.patches.length) for (const e of s.enemies) for (const q of s.patches) if ((e.x - q.x) ** 2 + (e.y - q.y) ** 2 < (24 + ENEMIES[e.kind].r) ** 2) damageEnemy(s, e, 70 * dt, q.seat);
  sweepDead(s);
}

export function dronePos(p: PlayerState, t: number): { x: number; y: number } {
  const a = t / 260;
  return { x: p.x + Math.cos(a) * 34, y: p.y + Math.sin(a) * 22 - 6 };
}

/* ── 적탄 지우는 구역 (방장과 손님이 같은 계산) ─────────────────────── */

export type Zone = { k: "arc"; x: number; y: number } | { k: "col"; x: number; w: number; y0: number; y1: number } | { k: "circle"; x: number; y: number; r: number } | { k: "row"; y: number; h: number };

/** posOf: 자리별 화면 위치 (손님은 보간 위치·내 위치를 넘긴다) */
export function activeZones(s: MatchState, t: number, posOf: (seat: number) => { x: number; y: number } = (i) => s.players[i]): Zone[] {
  const z: Zone[] = [];
  for (const p of s.players) {
    if (!p.pilot) continue;
    const live = flying(p);
    const { x, y } = posOf(p.seat);
    if (live && t < p.shieldUntil) z.push({ k: "arc", x, y });
    if (live && beaming(p, t)) z.push({ k: "col", x, w: 20, y0: -40, y1: y - 10 });
    if (ramming(p, t)) z.push({ k: "col", x: p.ramX, w: 48, y0: y - 60, y1: y + 40 });
    if (p.flareAt > 0 && t - p.flareAt < 350) z.push({ k: "circle", x, y, r: 120 });
    if (p.carpetStart > 0) {
      const r = Math.floor((t - p.carpetStart) / CARPET_ROW_MS);
      if (r >= 0 && r < CARPET_ROWS) z.push({ k: "row", y: carpetRowY(r), h: 44 });
    }
  }
  for (const q of s.patches) if (q.until > t) z.push({ k: "circle", x: q.x, y: q.y, r: 20 });
  return z;
}

export function inZone(z: Zone, x: number, y: number): boolean {
  switch (z.k) {
    case "arc": {
      const dx = x - z.x;
      const dy = y - z.y;
      const d = Math.hypot(dx, dy);
      return d < 48 && d > 26 && dy < 6;
    }
    case "col":
      return Math.abs(x - z.x) < z.w && y > z.y0 && y < z.y1;
    case "circle":
      return (x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r;
    case "row":
      return Math.abs(y - z.y) < z.h;
  }
}

function clearZones(s: MatchState) {
  const zs = activeZones(s, s.t);
  if (!zs.length) return;
  s.bullets = s.bullets.filter((b) => !zs.some((z) => inZone(z, b.x, b.y)));
}

/* ── 피격·부활 ──────────────────────────────────────────────────────── */

export function hitPlayer(s: MatchState, p: PlayerState) {
  if (!flying(p) || invulnerable(p, s.t)) return;
  if (s.t < p.stealthUntil && !p.stealthUsed) {
    p.stealthUsed = true;
    p.invulnUntil = s.t + 600;
    emit(s, { k: "phase", s: p.seat });
    return;
  }
  p.hp -= 1;
  p.stats.hits++;
  p.invulnUntil = s.t + INVULN_MS;
  emit(s, { k: "hit", s: p.seat });
  if (p.hp <= 0) {
    p.st = "down";
    p.hp = 0;
    p.downAt = s.t;
    p.revive = 0;
    p.power = Math.max(1, p.power - 1);
    p.stats.downs++;
    p.shieldUntil = p.droneUntil = p.napalmUntil = p.stealthUntil = p.vortexUntil = 0;
    p.chargeAt = p.beamUntil = 0;
    emit(s, { k: "down", s: p.seat });
    if (!s.players.some(flying)) allDown(s);
  }
}

function allDown(s: MatchState) {
  if (s.continues > 0) {
    s.continues--;
    s.bullets = [];
    s.lanes = [];
    for (const p of s.players) {
      revivePlayer(s, p, -1, true);
      p.invulnUntil = s.t + 3000;
      p.score = Math.round(p.score * 0.8);
    }
    emit(s, { k: "continue", left: s.continues });
  } else finish(s, "fail");
}

function revivePlayer(s: MatchState, p: PlayerState, by: number, full: boolean) {
  if (!p.pilot) return;
  p.st = "fly";
  p.hp = full ? PILOTS[p.pilot].maxHp : 1;
  p.revive = 0;
  p.invulnUntil = s.t + RESPAWN_INVULN_MS;
  if (by >= 0) {
    const r = s.players[by];
    if (r && r.seat !== p.seat) {
      r.stats.revives++;
      r.score += 300;
    }
    emit(s, { k: "revive", s: p.seat, by });
  }
}

/** 쓰러진 기체: 천천히 떨어지는 낙하산 — 곁에 동료가 머물면 부활 */
function downed(s: MatchState, dt: number) {
  for (const p of s.players) {
    if (p.st !== "down") continue;
    p.y = Math.min(H - 40, p.y + 14 * dt);
    const helpers = s.players.filter((q) => q.seat !== p.seat && flying(q) && Math.hypot(q.x - p.x, q.y - p.y) < REVIVE_R);
    if (helpers.length) {
      p.revive += dt * 1000 * (1 + 0.5 * (helpers.length - 1));
      if (p.revive >= REVIVE_MS) revivePlayer(s, p, helpers[0].seat, false);
    } else p.revive = Math.max(0, p.revive - dt * 400);
    if (p.st === "down" && s.t - p.downAt >= SELF_REVIVE_MS) {
      p.score = Math.max(0, p.score - SELF_REVIVE_PENALTY);
      revivePlayer(s, p, p.seat, false);
    }
  }
}

/** 봇 기체 피격 판정 (방장이 직접) */
function botHits(rt: HostRuntime) {
  const s = rt.state;
  for (const p of s.players) {
    if (!p.bot || !flying(p)) continue;
    const r = PILOTS[p.pilot!].hitR;
    let hit = false;
    for (const b of s.bullets) {
      const d2 = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
      if (d2 < (b.r * 0.8 + r) ** 2) {
        hit = true;
        break;
      }
    }
    if (!hit) for (const l of s.lanes) if (s.t >= l.fireAt && Math.abs(p.x - l.x) < l.w / 2) hit = true;
    if (hit) hitPlayer(s, p);
    // 스침 (봇은 방장이 센다: 지나가는 탄 중 가까운 것)
    if (!hit && !invulnerable(p, s.t)) {
      const mem = rt.bots[p.seat];
      mem.gz++;
      if (mem.gz % 6 === 0) {
        let n = 0;
        for (const b of s.bullets) if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 16 * 16) n++;
        if (n) addGraze(p, Math.min(2, n));
      }
    }
  }
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

function dropItem(s: MatchState, kind: ItemKind, x: number, y: number) {
  s.items.push({ id: ++s.idSeq, kind, x: clamp(x, 16, W - 16), y, vy: -60 });
}

function moveItems(s: MatchState, dt: number) {
  for (const it of s.items) {
    it.vy = Math.min(80, it.vy + 140 * dt);
    // 가까운 기체 쪽으로 끌려간다 (별은 멀리서도)
    let best: PlayerState | null = null;
    let bd = it.kind === "star" ? 140 : 70;
    for (const p of s.players) {
      if (!flying(p)) continue;
      const d = Math.hypot(p.x - it.x, p.y - it.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      const d = bd || 1;
      it.x += ((best.x - it.x) / d) * 260 * dt;
      it.y += ((best.y - it.y) / d) * 260 * dt;
    } else it.y += it.vy * dt;
  }
  s.items = s.items.filter((it) => it.y < H + 20);
}

function collectItems(s: MatchState) {
  if (!s.items.length) return;
  s.items = s.items.filter((it) => {
    for (const p of s.players) {
      if (!flying(p)) continue;
      if ((p.x - it.x) ** 2 + (p.y - it.y) ** 2 > 22 * 22) continue;
      p.stats.items++;
      if (it.kind === "power") {
        if (p.power < MAX_POWER) p.power++;
        else p.score += 1000;
      } else if (it.kind === "heal") {
        const max = PILOTS[p.pilot!].maxHp;
        if (p.hp < max) p.hp++;
        else p.score += 1000;
      } else p.score += STAR_SCORE;
      emit(s, { k: "item", s: p.seat, kind: it.kind });
      return false;
    }
    return true;
  });
}

/* ── 적 등장 (감독) ─────────────────────────────────────────────────── */

function newEnemy(s: MatchState, kind: EnemyKind, x: number, y: number, o: Partial<Enemy> = {}): Enemy {
  const hp = Math.round(ENEMIES[kind].hp * hpScale(s.seatCount) * DIFF[s.options.difficulty].hp * (1 + s.stage * 0.18));
  const e: Enemy = { id: ++s.idSeq, kind, x, y, hp, max: hp, age: 0, x0: x, y0: y, ty: 140, dir: 1, amp: 0, ph: 0, fireAt: 900 + rnd(s) * 900, cyc: 0, bphase: 0, lockX: x, hitAt: -9999, dmgBy: [], drop: [], ...o };
  s.enemies.push(e);
  return e;
}

const heavyKinds: EnemyKind[] = ["balloon", "gunship", "carrier"];

function director(s: MatchState) {
  const st = STAGES[s.stage];
  const segT = s.t - s.segStart;
  if (s.seg === "wavesA" || s.seg === "wavesB") {
    const len = s.seg === "wavesA" ? st.wavesA : st.wavesB;
    if (segT >= len) {
      if (s.seg === "wavesA") {
        s.seg = "mid";
        s.segStart = s.t;
        newEnemy(s, "frigate", W / 2, -60, { ty: 150, drop: ["power", "heal", "star", "star"] });
        emit(s, { k: "midIn" });
      } else {
        s.seg = "warn";
        s.segStart = s.t;
        emit(s, { k: "warn", kind: st.boss });
      }
      return;
    }
    if (s.t >= s.nextSpawnAt) {
      spawnFormation(s, s.seg === "wavesB");
      const prog = segT / len;
      s.nextSpawnAt = s.t + (2700 - prog * 900 - s.stage * 150) * (s.seg === "wavesB" ? 0.92 : 1);
    }
  } else if (s.seg === "mid") {
    const mid = s.enemies.find((e) => e.kind === "frigate");
    if (!mid) {
      s.seg = "wavesB";
      s.segStart = s.t;
      return;
    }
    if (segT > MID_TIMEOUT_MS && mid.ty > -200) {
      mid.ty = -300;
      emit(s, { k: "midGone" });
    }
    if (mid.ty < -200 && mid.y < -120) {
      s.enemies = s.enemies.filter((e) => e !== mid);
      s.seg = "wavesB";
      s.segStart = s.t;
      return;
    }
    // 중간 보스 동안 가끔 말벌
    if (s.t >= s.nextSpawnAt) {
      s.nextSpawnAt = s.t + 5200;
      formationLine(s, "wasp", 3);
    }
  } else if (s.seg === "warn") {
    if (segT >= 2600) {
      s.seg = "boss";
      s.segStart = s.t;
      newEnemy(s, st.boss, W / 2, -90, { ty: 135, fireAt: 1800 });
    }
  } else if (s.seg === "boss") {
    if (s.t >= s.nextSpawnAt) {
      s.nextSpawnAt = s.t + 9000;
      const boss = s.enemies.find((e) => ENEMIES[e.kind].boss);
      if (boss && boss.bphase >= 1) formationLine(s, s.stage === 0 ? "wasp" : "swallow", 3);
    }
  }
}

function formationLine(s: MatchState, kind: EnemyKind, n: number) {
  const x0 = 50 + rnd(s) * (W - 100);
  for (let i = 0; i < n; i++) newEnemy(s, kind, clamp(x0 + (i - (n - 1) / 2) * 42, 24, W - 24), -30 - i * 34, { amp: 26, ph: i, dir: rnd(s) < 0.5 ? -1 : 1 });
}

function spawnFormation(s: MatchState, late: boolean) {
  const pool = STAGES[s.stage].pool;
  const heavyNow = s.enemies.filter((e) => heavyKinds.includes(e.kind)).length;
  let kind = pool[Math.floor(rnd(s) * pool.length)];
  if (heavyKinds.includes(kind) && heavyNow >= (late ? 2 : 1)) kind = pool.find((k) => !heavyKinds.includes(k)) ?? "wasp";
  const r = rnd(s);
  switch (kind) {
    case "wasp": {
      const n = 4 + Math.floor(r * 3);
      if (r < 0.5) formationLine(s, "wasp", n);
      else {
        // V자
        const cx = 80 + rnd(s) * (W - 160);
        for (let i = 0; i < n; i++) {
          const side = i % 2 === 0 ? 1 : -1;
          const k = Math.ceil(i / 2);
          newEnemy(s, "wasp", clamp(cx + side * k * 30, 20, W - 20), -30 - k * 28, { amp: 18, ph: k });
        }
      }
      break;
    }
    case "swallow": {
      const dir = r < 0.5 ? 1 : -1;
      const y0 = 50 + rnd(s) * 120;
      for (let i = 0; i < 4; i++) newEnemy(s, "swallow", dir > 0 ? -20 - i * 40 : W + 20 + i * 40, y0, { dir, ph: i * 0.3 });
      break;
    }
    case "lancer": {
      const n = 2 + Math.floor(r * 2);
      for (let i = 0; i < n; i++) newEnemy(s, "lancer", 50 + rnd(s) * (W - 100), -30 - i * 50, { ty: 90 + rnd(s) * 90 });
      break;
    }
    case "balloon":
      newEnemy(s, "balloon", 60 + rnd(s) * (W - 120), -40, { ty: 110 + rnd(s) * 80, drop: rnd(s) < 0.5 ? ["power"] : ["star", "star"] });
      break;
    case "gunship":
      newEnemy(s, "gunship", 70 + rnd(s) * (W - 140), -40, { ty: 90 + rnd(s) * 80, amp: 30 + rnd(s) * 30, drop: ["power"] });
      break;
    case "carrier":
      newEnemy(s, "carrier", 80 + rnd(s) * (W - 160), -60, { drop: rnd(s) < 0.55 ? ["heal", "power"] : ["power", "star", "star"] });
      break;
    default:
      formationLine(s, "wasp", 4);
  }
}

/* ── 적 움직임·사격 ─────────────────────────────────────────────────── */

let bulletBudget = 340;

function shoot(s: MatchState, x: number, y: number, ang: number, speed: number, k = 0) {
  if (s.bullets.length >= bulletBudget) s.bullets.shift();
  const sp = speed * DIFF[s.options.difficulty].bulletSpeed;
  const r = k === 1 ? 7 : k === 3 ? 10 : k === 2 ? 4.5 : 5;
  s.bullets.push({ id: ++s.idSeq, x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, k, r });
}

function ring(s: MatchState, x: number, y: number, n: number, speed: number, k = 0, off = 0, gap = -1) {
  for (let i = 0; i < n; i++) {
    if (gap >= 0 && (i === gap || i === (gap + 1) % n)) continue;
    shoot(s, x, y, off + (i / n) * Math.PI * 2, speed, k);
  }
}

function fan(s: MatchState, x: number, y: number, ang: number, n: number, spread: number, speed: number, k = 0) {
  for (let i = 0; i < n; i++) shoot(s, x, y, n === 1 ? ang : ang - spread / 2 + (spread * i) / (n - 1), speed, k);
}

/** 가장 가까운(은신 아닌) 기체 쪽 각도 */
function aimAt(s: MatchState, x: number, y: number): number {
  let best: PlayerState | null = null;
  let bd = 1e9;
  for (const p of s.players) {
    if (!flying(p) || s.t < p.stealthUntil) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return Math.PI / 2 + (rnd(s) - 0.5) * 0.8;
  return Math.atan2(best.y - y, best.x - x);
}

function nearestX(s: MatchState, x: number): number {
  let bx = x;
  let bd = 1e9;
  for (const p of s.players)
    if (flying(p) && s.t >= p.stealthUntil && Math.abs(p.x - x) < bd) {
      bd = Math.abs(p.x - x);
      bx = p.x;
    }
  return bx;
}

function moveEnemies(s: MatchState, dt: number) {
  const k = slowK(s);
  // 사격 빈도: 난이도 × 인원(1인 0.9 ~ 4인 1.2) × 스테이지(+12%씩)
  const fireK = k * DIFF[s.options.difficulty].fire * (0.8 + 0.1 * s.seatCount) * (1 + s.stage * 0.12);
  const edt = dt * k;
  for (const e of s.enemies) {
    e.age += edt * 1000;
    const a = e.age / 1000;
    const info = ENEMIES[e.kind];
    const boss = info.boss || info.mid;
    switch (e.kind) {
      case "wasp":
        e.y += 105 * edt;
        e.x = e.x0 + Math.sin(a * 2.2 + e.ph) * (e.amp || 24);
        break;
      case "swallow":
        e.x += e.dir * 175 * edt;
        e.y = e.y0 + Math.sin(a * 1.6 + e.ph) * 40 + a * 28;
        break;
      case "lancer": {
        const descend = Math.max(0.1, (e.ty - e.y0) / 150);
        if (a < descend) e.y = e.y0 + 150 * a;
        else if (a < descend + 0.85) {
          if (e.cyc === 0) {
            e.lockX = nearestX(s, e.x);
            e.cyc = 1;
          }
        } else {
          e.y += 440 * edt;
          e.x += clamp(e.lockX - e.x, -1, 1) * 70 * edt;
        }
        break;
      }
      case "balloon":
        if (a < 13) e.y += (e.ty - e.y) * Math.min(1, edt * 0.9);
        else e.y += 50 * edt;
        e.x = e.x0 + Math.sin(a * 0.7) * 18;
        break;
      case "gunship":
        if (a < 14) e.y += (e.ty - e.y) * Math.min(1, edt * 1.3);
        else e.y += 70 * edt;
        e.x = clamp(e.x0 + Math.sin(a * 0.8) * e.amp, 30, W - 30);
        break;
      case "carrier":
        e.y += 24 * edt;
        e.x = e.x0 + Math.sin(a * 0.4) * 24;
        break;
      default:
        // 보스·중간 보스: 제자리로 내려와 좌우로 흔들
        e.y += (e.ty - e.y) * Math.min(1, edt * 1.1);
        if (e.y > e.ty - 20 || e.ty < 0) e.x = W / 2 + Math.sin(a * (e.kind === "manta" ? 0.55 : 0.4)) * (e.kind === "citadel" ? 40 : 90);
    }
    // 사격
    if (e.y < (boss ? 40 : 10)) continue;
    e.fireAt -= dt * 1000 * fireK;
    if (e.fireAt > 0) continue;
    if (boss) bossFire(s, e);
    else mobFire(s, e);
  }
  s.enemies = s.enemies.filter((e) => e.y < H + 80 && e.x > -120 && e.x < W + 120);
}

function mobFire(s: MatchState, e: Enemy) {
  switch (e.kind) {
    case "wasp":
      e.cyc++;
      e.fireAt = e.cyc > 2 ? 1e9 : 1700 + rnd(s) * 900;
      if (e.y < H * 0.6) shoot(s, e.x, e.y + 8, aimAt(s, e.x, e.y), 150, 2);
      break;
    case "swallow":
      e.fireAt = e.cyc++ > 0 ? 1e9 : 900 + rnd(s) * 500;
      fan(s, e.x, e.y, aimAt(s, e.x, e.y), 3, 0.42, 145, 0);
      break;
    case "lancer":
      e.fireAt = 130;
      if (e.age > 1600 && e.y > 80) {
        shoot(s, e.x - 8, e.y, Math.PI, 90, 0);
        shoot(s, e.x + 8, e.y, 0, 90, 0);
      }
      break;
    case "balloon":
      e.fireAt = 150;
      e.cyc++;
      for (let i = 0; i < 2; i++) shoot(s, e.x, e.y, e.cyc * 0.33 + i * Math.PI, 115, 0);
      break;
    case "gunship":
      e.cyc++;
      if (e.cyc % 3 === 0) {
        e.fireAt = 2100;
        ring(s, e.x, e.y, 14, 120, 1, rnd(s));
      } else {
        e.fireAt = 380;
        shoot(s, e.x, e.y + 14, aimAt(s, e.x, e.y), 175, 2);
      }
      break;
    case "carrier":
      e.cyc++;
      if (e.cyc % 2 === 0) {
        e.fireAt = 2600;
        if (s.enemies.length < 22) for (const dx of [-30, 30]) newEnemy(s, "wasp", e.x + dx, e.y + 10, { amp: 22, ph: dx });
      } else {
        e.fireAt = 2200;
        fan(s, e.x, e.y + 20, aimAt(s, e.x, e.y), 7, 0.9, 130, 0);
      }
      break;
    default:
      e.fireAt = 1e9;
  }
}

function bossFire(s: MatchState, e: Enemy) {
  const frac = e.hp / e.max;
  const ph = e.kind === "frigate" ? (frac > 0.5 ? 0 : 1) : frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  if (ph !== e.bphase) {
    e.bphase = ph;
    e.cyc = 0;
    if (!ENEMIES[e.kind].mid) {
      emit(s, { k: "bossPhase", n: ph });
      // 단계가 바뀌면 숨 돌릴 틈: 화면 탄 절반이 별이 된다
      const half = s.bullets.filter((b) => b.id % 2 === 0);
      for (const b of half.slice(0, 10)) dropItem(s, "star", b.x, b.y);
      s.bullets = s.bullets.filter((b) => b.id % 2 === 1);
      e.fireAt = 1400;
      return;
    }
  }
  const rage = e.kind !== "frigate" && e.age > BOSS_RAGE_MS ? 1.35 : 1;
  const c = e.cyc++;
  const sp = (v: number) => v * rage;
  const ex = e.x;
  const ey = e.y;
  switch (e.kind) {
    case "frigate":
      if (ph === 0) {
        if (c % 6 < 4) {
          e.fireAt = 260;
          fan(s, ex, ey + 30, Math.PI / 2 + Math.sin(c * 0.6) * 0.6, 5, 0.5, 150, 0);
        } else {
          e.fireAt = 900;
          ring(s, ex, ey, 20, 115, 1, c * 0.2, Math.floor(rnd(s) * 20));
        }
      } else {
        e.fireAt = c % 5 === 4 ? 1100 : 170;
        if (c % 5 === 4) ring(s, ex, ey, 24, 125, 1, c * 0.13);
        else shoot(s, ex + (c % 2 ? -30 : 30), ey + 20, aimAt(s, ex, ey), 200, 2);
      }
      break;
    case "whale":
      if (ph === 0) {
        // 꼬리 부채 + 거품
        if (c % 4 < 3) {
          e.fireAt = 520;
          fan(s, ex, ey + 40, aimAt(s, ex, ey + 40), 9, 1.1, sp(140), 0);
        } else {
          e.fireAt = 1200;
          for (let i = 0; i < 6; i++) shoot(s, ex - 50 + i * 20, ey + 30, Math.PI / 2 + (rnd(s) - 0.5) * 0.9, sp(70 + rnd(s) * 30), 3);
        }
      } else if (ph === 1) {
        // 숨구멍 이중 나선
        e.fireAt = 95;
        for (let i = 0; i < 2; i++) shoot(s, ex, ey - 20, c * 0.23 + i * Math.PI, sp(125), 0);
        if (c % 30 === 29) {
          e.fireAt = 900;
          ring(s, ex, ey, 18, sp(105), 3, c);
        }
      } else {
        e.fireAt = c % 8 === 7 ? 800 : 140;
        if (c % 8 === 7) ring(s, ex, ey, 26, sp(130), 1, c * 0.1);
        else {
          shoot(s, ex - 45, ey + 30, aimAt(s, ex - 45, ey + 30), sp(210), 2);
          shoot(s, ex + 45, ey + 30, aimAt(s, ex + 45, ey + 30), sp(210), 2);
          shoot(s, ex, ey - 10, c * 0.41, sp(115), 0);
        }
      }
      break;
    case "manta":
      if (ph === 0) {
        if (c % 3 === 2) {
          e.fireAt = 1600;
          addLane(s, nearestX(s, ex), 54);
          addLane(s, 30 + rnd(s) * (W - 60), 54);
        } else {
          e.fireAt = 700;
          ring(s, ex, ey + 10, 16, sp(120), 0, c * 0.3);
        }
      } else if (ph === 1) {
        if (c % 6 === 5) {
          e.fireAt = 1500;
          for (let i = 0; i < 3; i++) addLane(s, 50 + ((i + rnd(s)) * (W - 100)) / 3, 46);
        } else {
          e.fireAt = 300;
          const swing = Math.sin(c * 0.9) * 0.7;
          fan(s, ex - 50, ey + 20, Math.PI / 2 + swing, 3, 0.25, sp(160), 2);
          fan(s, ex + 50, ey + 20, Math.PI / 2 - swing, 3, 0.25, sp(160), 2);
        }
      } else {
        e.fireAt = c % 10 === 9 ? 1300 : 110;
        if (c % 10 === 9) {
          addLane(s, nearestX(s, ex), 50);
          ring(s, ex, ey, 22, sp(110), 1, c);
        } else for (let i = 0; i < 4; i++) shoot(s, ex, ey + 10, c * 0.17 + (i * Math.PI) / 2, sp(130), 0);
      }
      break;
    case "citadel": {
      const turrets = [
        [-70, -10],
        [70, -10],
        [-40, 40],
        [40, 40],
      ];
      if (ph === 0) {
        e.fireAt = 150;
        turrets.forEach(([dx, dy], i) => shoot(s, ex + dx, ey + dy, c * 0.19 * (i % 2 ? -1 : 1) + i, sp(120), 0));
        if (c % 20 === 19) {
          e.fireAt = 900;
          fan(s, ex, ey + 30, aimAt(s, ex, ey), 11, 1.4, sp(150), 2);
        }
      } else if (ph === 1) {
        e.fireAt = c % 4 === 3 ? 1000 : 420;
        if (c % 4 === 3) ring(s, ex, ey, 30, sp(115), 1, c * 0.21, Math.floor(rnd(s) * 30));
        else for (const [dx, dy] of turrets) shoot(s, ex + dx, ey + dy, aimAt(s, ex + dx, ey + dy), sp(190), 2);
      } else {
        e.fireAt = c % 12 === 11 ? 1500 : 120;
        if (c % 12 === 11) {
          addLane(s, nearestX(s, ex), 50);
          addLane(s, W - nearestX(s, ex), 50);
        } else {
          for (let i = 0; i < 5; i++) shoot(s, ex, ey, c * 0.11 + (i * Math.PI * 2) / 5, sp(120), i % 2 ? 0 : 1);
          if (c % 3 === 0) shoot(s, ex, ey + 30, aimAt(s, ex, ey), sp(220), 2);
        }
      }
      break;
    }
  }
}

/** 번개 줄기: 0.9초 예고 뒤 0.8초 발사 */
function addLane(s: MatchState, x: number, w: number) {
  const fireAt = s.t + 900 / slowK(s);
  s.lanes.push({ id: ++s.idSeq, x: Math.round(clamp(x, w / 2, W - w / 2)), w, fireAt, until: fireAt + 800 });
  emit(s, { k: "lane", x: Math.round(x) });
}

function moveBullets(s: MatchState, dt: number) {
  const k = slowK(s) * dt;
  for (const b of s.bullets) {
    b.x += b.vx * k;
    b.y += b.vy * k;
  }
  s.bullets = s.bullets.filter((b) => b.x > -20 && b.x < W + 20 && b.y > -30 && b.y < H + 20);
}

/** 보스 (화면 HUD용) */
export function bossOf(s: { enemies: Enemy[] }): Enemy | null {
  return s.enemies.find((e) => ENEMIES[e.kind].boss || ENEMIES[e.kind].mid) ?? null;
}

/** 테스트용: 탄 상한 바꾸기 */
export function setBulletBudget(n: number) {
  bulletBudget = n;
}
