import {
  BASH_MS,
  CAMP_R,
  DOOR_RANGE,
  EXIT_RANGE,
  EXPOSE_MS,
  EXTRA_SPOTS,
  FREEZE_MS,
  GATE_OPEN_MS,
  GAUGE_CATCH,
  GAUGE_MIN_ON,
  GAUGE_REGEN_SEC,
  GRACE_MS,
  HIT_CONE,
  HIT_R,
  KICK_LOSS,
  KICK_MS,
  KID_HEAR_MUL,
  MASK_OFF_MS,
  MASK_ON_MS,
  MAX_FREEZES,
  NOISE_RUN,
  NOISE_SEAL,
  NOISE_THAW,
  NOISE_WALK,
  RECOVER_HIT_MS,
  RECOVER_MISS_MS,
  SALT_CONE,
  SALT_MAX,
  SALT_RANGE,
  SALT_SLOW_MS,
  SEAL_HELP,
  STUN_KID_MS,
  STUN_MASK_MS,
  SWING_MS,
  THAW_MS,
  THAW_RANGE,
  THAW_SAFE_MS,
  TICK_MS,
  USE_RANGE,
  sanitizeOptions,
  maskSecFor,
  SALT_START,
  sealMsFor,
  sealsFor,
  timeLimitMs,
  winnerOf,
  type GameOptions,
  type MoveMode,
  type Winner,
} from "./data";
import { DOORS, EXITS, SPAWN_CELLS, SPOTS, centerOf, clearLine, collide } from "./map";

/**
 * 술래는 우리 중에 — 방장 기기가 돌리는 판정 (룰북 §3~§9).
 *
 * 사람의 **몸(위치·시선·걷는 방식)은 각자 기기가** 움직여 `PosReport`로 알리고, 방장은 그 위에서
 * 봉인·얼음땡·가면·터치·소금·교문을 판정한다. 봇과 자리를 비운 사람의 몸은 방장이 `think`(bot.ts)로
 * 움직인다. `MatchState`는 순수 JSON이라 스냅샷 하나로 방장을 넘길 수 있다.
 */

export type Role = "tagger" | "runner";
export type PlayerSt = "alive" | "frozen" | "out" | "escaped";

export interface PlayerStats {
  /** 내가 손댄 채로 끝난 봉인 / 봉인에 쓴 시간(ms) */
  seals: number;
  sealMs: number;
  thaws: number;
  /** 얼음이 된 횟수 */
  frozen: number;
  salts: number;
  saltHits: number;
  /** 변장 중인 술래를 소금으로 들춰낸 횟수 */
  unmasks: number;
  friendly: number;
  doors: number;
  /** 술래: 얼린 횟수 / 끌고 간 수 / 훼손 / 가면 쓴 횟수 / 소금 맞은 횟수 */
  catches: number;
  outs: number;
  kicks: number;
  masks: number;
  stunned: number;
}

export interface PlayerState {
  seat: number;
  bot: boolean;
  level: number;
  /** 사람이 나가서 AI가 대신 움직이는 중 */
  away: boolean;
  role: Role;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  cr: boolean;
  light: boolean;
  st: PlayerSt;
  /** 누르고 있는 대상: s3 봉인 터 · k3 훼손 · t2 얼음 녹이기 */
  use: string | null;
  useMs: number;
  /** 지금까지 얼음이 된 횟수 / 끌려가기까지 남은 시간(ms) */
  freezes: number;
  melt: number;
  salt: number;
  /** 땡! 직후 무적 / 소금 맞아 느려짐 */
  safeUntil: number;
  slowUntil: number;
  stats: PlayerStats;
}

/** kid 변장 · on 가면 쓰는 중 · mask 가면 · off 벗는 중 */
export type TaggerForm = "kid" | "on" | "mask" | "off";

export interface TaggerState {
  seat: number;
  form: TaggerForm;
  until: number;
  gauge: number;
  swingUntil: number;
  recoverUntil: number;
  stunUntil: number;
  exposedUntil: number;
  /** 부수는 중인 문 (-1 없음) */
  bash: number;
  bashUntil: number;
}

export interface SpotState {
  /** SPOTS 번호 */
  i: number;
  /** 진행도 0~1 */
  p: number;
  done: boolean;
}

export type EventKind =
  | "door"
  | "bash"
  | "slam"
  | "sealDone"
  | "kick"
  | "freeze"
  | "thaw"
  | "out"
  | "escape"
  | "maskOn"
  | "masked"
  | "maskOff"
  | "swing"
  | "salt"
  | "saltHit"
  | "saltFriend"
  | "gateWarn"
  | "gatesOpen"
  | "lastMinute"
  | "over";

export interface GameEvent {
  id: number;
  at: number;
  k: EventKind;
  seat?: number;
  x?: number;
  z?: number;
  n?: number;
}

export interface Outcome {
  winner: Winner;
  escaped: number;
  runners: number;
  caught: number;
  tMs: number;
  /** 끝난 까닭 */
  why: "escaped" | "allCaught" | "time";
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  phase: "play" | "gameOver";
  players: PlayerState[];
  tg: TaggerState;
  /** 문이 열려 있나 */
  doors: boolean[];
  doorVer: number;
  spots: SpotState[];
  need: number;
  sealed: number;
  gate: "locked" | "opening" | "open";
  gateAt: number;
  events: GameEvent[];
  eid: number;
  lastMinute: boolean;
  outcome: Outcome | null;
  /** 최종 순위: 이긴 쪽 1위 (도망자는 탈출한 사람만 1위), 나머지 2위 */
  ranks: number[] | null;
}

/** 각자 기기가 10번/초 보내는 내 몸 */
export interface PosReport {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  cr: boolean;
  light: boolean;
  use: string | null;
}

export type PlayerAct = { k: "door"; i: number } | { k: "salt"; yaw: number } | { k: "mask"; on: boolean } | { k: "hit" };

export type BotThink = (rt: HostRuntime, seat: number, dtMs: number) => void;

export interface HostRuntime {
  state: MatchState;
  acc: number;
  think: BotThink | null;
  /** 봇 기억 (자리별, bot.ts가 채운다) */
  mem: Record<number, unknown>;
}

/* ── 도우미 ─────────────────────────────────────────────────────────── */

export function rand(s: MatchState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function pushEvent(s: MatchState, k: EventKind, e: Omit<GameEvent, "id" | "at" | "k"> = {}) {
  s.events.push({ id: ++s.eid, at: s.t, k, ...e });
}

const emptyStats = (): PlayerStats => ({ seals: 0, sealMs: 0, thaws: 0, frozen: 0, salts: 0, saltHits: 0, unmasks: 0, friendly: 0, doors: 0, catches: 0, outs: 0, kicks: 0, masks: 0, stunned: 0 });

function shuffled<T>(s: MatchState, list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** (x,z)에서 (tx,tz)를 바라보는 yaw */
export const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

export const taggerOf = (s: MatchState): PlayerState => s.players[s.tg.seat];
export const runnersOf = (s: MatchState): PlayerState[] => s.players.filter((p) => p.role === "runner");
export const isStunned = (s: MatchState) => s.t < s.tg.stunUntil;
/** 가면을 쓰고 있나 (쓰는 중·벗는 중은 아니다) */
export const isMasked = (s: MatchState) => s.tg.form === "mask";
/** 술래의 정체가 모두에게 드러나 있나 */
export const isExposed = (s: MatchState) => s.t < s.tg.exposedUntil;

/* ── 판 만들기 ──────────────────────────────────────────────────────── */

/**
 * `forcedTagger`: 술래 자리를 정해 줄 때 (방장이 술래 · 연습에서 역할 고르기). 없으면 옵션대로 뽑는다.
 */
export function createMatch(seed: number, seats: { bot: boolean; level: number }[], options?: Partial<GameOptions>, forcedTagger?: number): MatchState {
  const opts = sanitizeOptions(options);
  const n = Math.max(2, Math.min(5, seats.length));
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: n,
    options: opts,
    phase: "play",
    players: [],
    tg: { seat: 0, form: "kid", until: 0, gauge: 100, swingUntil: 0, recoverUntil: 0, stunUntil: 0, exposedUntil: 0, bash: -1, bashUntil: 0 },
    doors: [],
    doorVer: 0,
    spots: [],
    need: sealsFor(n - 1),
    sealed: 0,
    gate: "locked",
    gateAt: 0,
    events: [],
    eid: 0,
    lastMinute: false,
    outcome: null,
    ranks: null,
  };
  for (let i = 0; i < 8; i++) rand(s);

  // 술래
  let tagger = -1;
  if (forcedTagger !== undefined && forcedTagger >= 0 && forcedTagger < n) tagger = forcedTagger;
  else if (opts.pick === "bot") {
    const bots = Array.from({ length: n }, (_, i) => i).filter((i) => seats[i]?.bot);
    if (bots.length) tagger = bots[Math.floor(rand(s) * bots.length)];
  }
  if (tagger < 0) tagger = Math.floor(rand(s) * n);
  s.tg.seat = tagger;

  // 봉인 터: 되도록 서로 다른 방
  const order = shuffled(s, SPOTS.map((d) => d.i));
  const want = Math.min(SPOTS.length, s.need + EXTRA_SPOTS);
  const rooms = new Set<string>();
  const chosen: number[] = [];
  for (const i of order) {
    if (chosen.length >= want) break;
    if (rooms.has(SPOTS[i].room)) continue;
    rooms.add(SPOTS[i].room);
    chosen.push(i);
  }
  for (const i of order) {
    if (chosen.length >= want) break;
    if (!chosen.includes(i)) chosen.push(i);
  }
  s.spots = chosen.sort((a, b) => a - b).map((i) => ({ i, p: 0, done: false }));

  // 문: 강당 문은 열려 있고 나머지는 반쯤
  s.doors = DOORS.map((d) => d.gym || rand(s) < 0.5);

  const spawns = shuffled(s, SPAWN_CELLS);
  s.players = Array.from({ length: n }, (_, seat): PlayerState => {
    const c = centerOf(spawns[seat % spawns.length]);
    return {
      seat,
      bot: !!seats[seat]?.bot,
      level: clamp(Math.round(seats[seat]?.level ?? 5), 1, 10),
      away: false,
      role: seat === tagger ? "tagger" : "runner",
      x: c.x,
      z: c.z,
      yaw: rand(s) * Math.PI * 2,
      pitch: 0,
      mv: 0,
      cr: false,
      light: true,
      st: "alive",
      use: null,
      useMs: 0,
      freezes: 0,
      melt: 0,
      salt: seat === tagger ? 0 : SALT_START,
      safeUntil: 0,
      slowUntil: 0,
      stats: emptyStats(),
    };
  });
  return s;
}

export function createHost(state: MatchState, think: BotThink | null): HostRuntime {
  return { state, acc: 0, think, mem: {} };
}

export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p || p.bot) return;
  p.away = away;
  if (away) p.use = null;
}

/* ── 사람 입력 ──────────────────────────────────────────────────────── */

/** 술래가 지금 못 움직이나 (가면 쓰는 중·벗는 중·기절) */
export function taggerRooted(s: MatchState): boolean {
  return s.tg.form === "on" || s.tg.form === "off" || isStunned(s);
}

export function applyReport(rt: HostRuntime, seat: number, rep: PosReport | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !rep || p.bot || p.away || s.phase !== "play") return;
  p.yaw = num(rep.yaw, p.yaw);
  p.pitch = clamp(num(rep.pitch, p.pitch), -1.4, 1.4);
  if (p.st !== "alive") return;
  if (p.role === "tagger" && taggerRooted(s)) {
    p.mv = 0;
    p.use = null;
    return;
  }
  const pos = { x: num(rep.x, p.x), z: num(rep.z, p.z) };
  // 한 번에 너무 멀리 뛴 보고는 버린다 (순간이동 · 판이 바뀐 직후의 낡은 좌표)
  if (Math.hypot(pos.x - p.x, pos.z - p.z) <= 4) {
    collide(pos, s.doors);
    p.x = pos.x;
    p.z = pos.z;
  }
  const mv = Math.round(num(rep.mv));
  p.mv = (mv >= 0 && mv <= 3 ? mv : 0) as MoveMode;
  p.cr = !!rep.cr;
  p.light = !!rep.light && !(p.role === "tagger" && s.tg.form !== "kid");
  const use = typeof rep.use === "string" && rep.use.length <= 4 ? rep.use : null;
  if (use !== p.use) {
    p.use = use;
    p.useMs = 0;
  }
}

function stunTagger(s: MatchState, by: PlayerState) {
  const tg = s.tg;
  const t = taggerOf(s);
  const masked = tg.form === "mask";
  tg.swingUntil = 0;
  tg.bash = -1;
  t.use = null;
  t.mv = 0;
  t.stats.stunned++;
  by.stats.saltHits++;
  if (masked) tg.stunUntil = s.t + STUN_MASK_MS;
  else {
    // 변장 중(또는 쓰는·벗는 중)에 맞으면 정체가 드러난다
    by.stats.unmasks++;
    tg.form = "kid";
    tg.stunUntil = s.t + STUN_KID_MS;
    tg.exposedUntil = s.t + EXPOSE_MS;
  }
  pushEvent(s, "saltHit", { seat: by.seat, n: masked ? 1 : 0, x: t.x, z: t.z });
}

export function applyAct(rt: HostRuntime, seat: number, act: PlayerAct | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !act || s.phase !== "play" || p.st !== "alive") return;
  const tg = s.tg;
  const isTagger = p.role === "tagger";
  if (isTagger && taggerRooted(s)) return;

  if (act.k === "door") {
    const d = DOORS[Math.round(num(act.i, -1))];
    if (!d) return;
    if (Math.hypot(p.x - d.x, p.z - d.z) > DOOR_RANGE + 0.6) return;
    const open = s.doors[d.i];
    if (isTagger && tg.form === "mask") {
      // 가면 쓴 술래는 문을 못 닫고, 닫힌 문은 부숴서 연다
      if (open || tg.bash >= 0) return;
      tg.bash = d.i;
      tg.bashUntil = s.t + BASH_MS;
      pushEvent(s, "bash", { n: d.i, x: d.x, z: d.z });
      return;
    }
    if (open && s.players.some((q) => (q.st === "alive" || q.st === "frozen") && Math.hypot(q.x - d.x, q.z - d.z) < 0.75)) return;
    s.doors[d.i] = !open;
    s.doorVer++;
    p.stats.doors++;
    pushEvent(s, "door", { seat, n: d.i, x: d.x, z: d.z });
  } else if (act.k === "salt") {
    if (isTagger || p.salt <= 0) return;
    p.salt--;
    p.stats.salts++;
    const yaw = num(act.yaw, p.yaw);
    let hit: PlayerState | null = null;
    let bd = Infinity;
    for (const q of s.players) {
      if (q === p || q.st !== "alive") continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > SALT_RANGE || d >= bd) continue;
      if (d > 0.7 && Math.abs(angleDiff(yawTo(p.x, p.z, q.x, q.z), yaw)) > SALT_CONE) continue;
      if (!clearLine(p.x, p.z, q.x, q.z, s.doors)) continue;
      hit = q;
      bd = d;
    }
    pushEvent(s, "salt", { seat, x: p.x, z: p.z, n: Math.round(yaw * 100) });
    if (!hit) return;
    if (hit.role === "tagger") stunTagger(s, p);
    else {
      hit.slowUntil = s.t + SALT_SLOW_MS;
      p.stats.friendly++;
      pushEvent(s, "saltFriend", { seat, n: hit.seat, x: hit.x, z: hit.z });
    }
  } else if (act.k === "mask") {
    if (!isTagger) return;
    if (act.on) {
      if (tg.form !== "kid" || s.t < GRACE_MS || tg.gauge < GAUGE_MIN_ON) return;
      tg.form = "on";
      tg.until = s.t + MASK_ON_MS;
      p.use = null;
      p.mv = 0;
      p.light = false;
      p.stats.masks++;
      pushEvent(s, "maskOn", { x: p.x, z: p.z });
    } else {
      if (tg.form !== "mask") return;
      tg.form = "off";
      tg.until = s.t + MASK_OFF_MS;
      tg.swingUntil = 0;
      tg.bash = -1;
      p.use = null;
      p.mv = 0;
    }
  } else if (act.k === "hit") {
    if (!isTagger || tg.form !== "mask" || s.t < tg.recoverUntil || s.t < tg.swingUntil) return;
    tg.swingUntil = s.t + SWING_MS;
    tg.recoverUntil = tg.swingUntil + RECOVER_MISS_MS;
    tg.bash = -1;
    p.use = null;
    pushEvent(s, "swing", { x: p.x, z: p.z });
  }
}

/* ── 술래 ───────────────────────────────────────────────────────────── */

function freeze(s: MatchState, q: PlayerState) {
  const t = taggerOf(s);
  q.freezes++;
  q.stats.frozen++;
  q.use = null;
  q.useMs = 0;
  q.mv = 0;
  q.light = false;
  t.stats.catches++;
  s.tg.gauge = Math.min(100, s.tg.gauge + GAUGE_CATCH);
  if (q.freezes >= MAX_FREEZES) {
    q.st = "out";
    t.stats.outs++;
    pushEvent(s, "freeze", { seat: q.seat, x: q.x, z: q.z, n: q.freezes });
    pushEvent(s, "out", { seat: q.seat, x: q.x, z: q.z, n: 1 });
    return;
  }
  q.st = "frozen";
  q.melt = FREEZE_MS[Math.min(FREEZE_MS.length - 1, q.freezes - 1)];
  pushEvent(s, "freeze", { seat: q.seat, x: q.x, z: q.z, n: q.freezes });
}

function taggerStep(rt: HostRuntime, dt: number) {
  const s = rt.state;
  const tg = s.tg;
  const t = taggerOf(s);
  if (tg.form === "on" && s.t >= tg.until) {
    tg.form = "mask";
    pushEvent(s, "masked", { x: t.x, z: t.z });
  } else if (tg.form === "off" && s.t >= tg.until) {
    tg.form = "kid";
    pushEvent(s, "maskOff", { x: t.x, z: t.z });
  }
  if (tg.form === "mask") {
    tg.gauge = Math.max(0, tg.gauge - (100 / maskSecFor(s.seatCount - 1)) * dt);
    if (tg.gauge <= 0 && s.t >= tg.swingUntil) {
      tg.form = "off";
      tg.until = s.t + MASK_OFF_MS;
      tg.bash = -1;
      t.use = null;
    }
  } else if (tg.form === "kid") tg.gauge = Math.min(100, tg.gauge + (100 / GAUGE_REGEN_SEC) * dt);

  if (isStunned(s)) return;

  // 덮치기: 휘두르는 동안 앞에 닿는 첫 도망자를 얼린다
  if (tg.form === "mask" && s.t < tg.swingUntil) {
    for (const q of s.players) {
      if (q.role !== "runner" || q.st !== "alive" || s.t < q.safeUntil) continue;
      const d = Math.hypot(q.x - t.x, q.z - t.z);
      if (d > HIT_R) continue;
      if (d > 0.6 && Math.abs(angleDiff(yawTo(t.x, t.z, q.x, q.z), t.yaw)) > HIT_CONE) continue;
      if (!clearLine(t.x, t.z, q.x, q.z, s.doors)) continue;
      freeze(s, q);
      tg.swingUntil = 0;
      tg.recoverUntil = s.t + RECOVER_HIT_MS;
      break;
    }
  }

  // 문 부수기
  if (tg.bash >= 0 && s.t >= tg.bashUntil) {
    const d = DOORS[tg.bash];
    if (d && !s.doors[d.i]) {
      s.doors[d.i] = true;
      s.doorVer++;
      pushEvent(s, "slam", { n: d.i, x: d.x, z: d.z });
    }
    tg.bash = -1;
  }

  // 봉인 훼손
  const u = t.use;
  if (u && u[0] === "k") {
    const k = Number(u.slice(1));
    const sp = s.spots[k];
    const def = sp ? SPOTS[sp.i] : null;
    const ok = tg.form === "mask" && !!sp && !!def && !sp.done && sp.p > 0 && Math.hypot(t.x - def.x, t.z - def.z) <= USE_RANGE + 0.9;
    if (!ok) {
      if (t.bot || t.away) t.use = null;
      t.useMs = 0;
    } else {
      t.useMs += dt * 1000;
      if (t.useMs >= KICK_MS && sp && def) {
        sp.p = Math.max(0, sp.p - KICK_LOSS);
        t.useMs = 0;
        t.use = null;
        t.stats.kicks++;
        pushEvent(s, "kick", { n: k, x: def.x, z: def.z });
      }
    }
  }
}

/* ── 도망자 ─────────────────────────────────────────────────────────── */

/** 그 사람이 지금 (진짜로든 시늉으로든) 손대고 있는 봉인 터 번호 (-1 없음) */
export function sealingAt(s: MatchState, p: PlayerState): number {
  const u = p.use;
  if (!u || u[0] !== "s" || p.st !== "alive") return -1;
  if (p.role === "tagger" && (s.tg.form !== "kid" || isStunned(s))) return -1;
  const k = Number(u.slice(1));
  const sp = s.spots[k];
  if (!sp || sp.done) return -1;
  const def = SPOTS[sp.i];
  return Math.hypot(p.x - def.x, p.z - def.z) <= USE_RANGE + 0.9 ? k : -1;
}

function sealStep(s: MatchState) {
  const count = s.spots.map(() => 0);
  const who: PlayerState[][] = s.spots.map(() => []);
  for (const p of s.players) {
    const k = sealingAt(s, p);
    if (k < 0) {
      if (p.use?.[0] === "s" && (p.bot || p.away)) p.use = null;
      continue;
    }
    // 변장한 술래는 시늉만 한다 (진행도는 안 오른다)
    if (p.role !== "runner") continue;
    count[k]++;
    who[k].push(p);
    p.stats.sealMs += TICK_MS;
  }
  s.spots.forEach((sp, k) => {
    if (sp.done || count[k] === 0) return;
    sp.p += (TICK_MS / sealMsFor(s.seatCount - 1)) * (1 + SEAL_HELP * (count[k] - 1));
    if (sp.p < 1) return;
    sp.p = 1;
    sp.done = true;
    s.sealed++;
    const def = SPOTS[sp.i];
    for (const p of who[k]) {
      p.stats.seals++;
      p.salt = Math.min(SALT_MAX, p.salt + 1);
    }
    for (const p of s.players) if (p.use === `s${k}` || p.use === `k${k}`) p.use = null;
    pushEvent(s, "sealDone", { n: s.sealed, seat: k, x: def.x, z: def.z });
    if (s.sealed >= s.need && s.gate === "locked") {
      s.gate = "opening";
      s.gateAt = s.t + GATE_OPEN_MS;
      pushEvent(s, "gateWarn");
    }
  });
}

function runnerStep(s: MatchState, p: PlayerState) {
  if (p.st === "frozen") {
    const t = taggerOf(s);
    const camped = s.tg.form === "mask" && Math.hypot(t.x - p.x, t.z - p.z) < CAMP_R;
    if (!camped) p.melt -= TICK_MS;
    if (p.melt <= 0) {
      p.st = "out";
      t.stats.outs++;
      pushEvent(s, "out", { seat: p.seat, x: p.x, z: p.z, n: 0 });
    }
    return;
  }
  if (p.st !== "alive") return;

  // 얼음 녹이기 (땡!)
  const u = p.use;
  if (u && u[0] === "t") {
    const q = s.players[Number(u.slice(1))];
    const ok = !!q && q !== p && q.st === "frozen" && Math.hypot(p.x - q.x, p.z - q.z) <= THAW_RANGE + 0.4;
    if (!ok) {
      if (p.bot || p.away) p.use = null;
      p.useMs = 0;
    } else {
      p.useMs += TICK_MS;
      if (p.useMs >= THAW_MS && q) {
        q.st = "alive";
        q.melt = 0;
        q.safeUntil = s.t + THAW_SAFE_MS;
        q.mv = 0;
        p.stats.thaws++;
        p.use = null;
        p.useMs = 0;
        pushEvent(s, "thaw", { seat: q.seat, n: p.seat, x: q.x, z: q.z });
      }
    }
  }

  // 탈출
  if (s.gate === "open" && EXITS.some((e) => Math.hypot(p.x - e.x, p.z - e.z) <= EXIT_RANGE)) {
    p.st = "escaped";
    p.use = null;
    p.light = false;
    pushEvent(s, "escape", { seat: p.seat, x: p.x, z: p.z });
  }
}

function finish(s: MatchState, why: Outcome["why"]) {
  const t = taggerOf(s);
  for (const p of s.players) {
    if (p.role !== "runner") continue;
    if (p.st === "alive" || p.st === "frozen") {
      p.st = "out";
      t.stats.outs++;
    }
  }
  const runners = runnersOf(s);
  const escaped = runners.filter((p) => p.st === "escaped").length;
  const winner = winnerOf(escaped, runners.length);
  s.outcome = { winner, escaped, runners: runners.length, caught: runners.length - escaped, tMs: s.t, why: why === "time" ? "time" : escaped > 0 ? "escaped" : "allCaught" };
  s.ranks = s.players.map((p) => (p.role === "tagger" ? (winner === "runners" ? 2 : 1) : p.st === "escaped" ? 1 : 2));
  s.phase = "gameOver";
  pushEvent(s, "over", { n: winner === "tagger" ? 0 : winner === "runners" ? 1 : 2 });
}

function tick(rt: HostRuntime) {
  const s = rt.state;
  if (s.phase !== "play") return;
  s.t += TICK_MS;
  const dt = TICK_MS / 1000;
  const limit = timeLimitMs(s.options);

  if (rt.think) for (const p of s.players) if ((p.bot || p.away) && p.st === "alive") rt.think(rt, p.seat, TICK_MS);
  taggerStep(rt, dt);
  for (const p of s.players) if (p.role === "runner") runnerStep(s, p);
  sealStep(s);

  if (s.gate === "opening" && s.t >= s.gateAt) {
    s.gate = "open";
    pushEvent(s, "gatesOpen");
  }
  if (!s.lastMinute && s.t >= limit - 60_000) {
    s.lastMinute = true;
    pushEvent(s, "lastMinute");
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 6000) s.events = s.events.filter((e) => e.at >= s.t - 6000);

  // 끝? — 움직일 수 있는 도망자가 하나도 없으면 (얼음만 남아도) 끝
  const runners = runnersOf(s);
  if (s.t >= limit) finish(s, "time");
  else if (!runners.some((p) => p.st === "alive")) finish(s, "allCaught");
}

/** 방장 루프: 지난 시간만큼 고정 틱으로 */
export function hostStep(rt: HostRuntime, dtMs: number) {
  rt.acc += Math.min(500, dtMs);
  while (rt.acc >= TICK_MS) {
    rt.acc -= TICK_MS;
    tick(rt);
  }
}

/* ── 화면·봇이 함께 쓰는 판단 ───────────────────────────────────────── */

/** 그 사람이 지금 내는 소리 반경 (술래 눈에 벽 너머 파문으로 보인다) */
export function noiseRadiusOf(p: Pick<PlayerState, "mv" | "use" | "st">): number {
  if (p.st !== "alive") return 0;
  let r = p.mv === 3 ? NOISE_RUN : p.mv === 2 ? NOISE_WALK : 0;
  if (p.use?.[0] === "s") r = Math.max(r, NOISE_SEAL);
  if (p.use?.[0] === "t") r = Math.max(r, NOISE_THAW);
  return r;
}

/** 술래 귀에 그 도망자의 소리가 들리나 (변장 중에는 반경이 절반) */
export function taggerHears(s: MatchState, p: PlayerState): boolean {
  const t = taggerOf(s);
  const r = noiseRadiusOf(p) * (s.tg.form === "mask" ? 1 : KID_HEAR_MUL);
  return r > 0 && Math.hypot(p.x - t.x, p.z - t.z) <= r;
}
