import {
  ALERT_DECAY,
  ALERT_HUNT,
  BATTERY_PACK,
  BATTERY_SEC,
  BATTERY_START,
  BEAT_MS_1,
  BEAT_MS_2,
  BLEED_MS,
  BOTTLE_DIVERT_R,
  BREATH_MAX,
  BREATH_REGEN,
  BUMP_R,
  CROWD_HEAR,
  CHARM_STUN_MS,
  DIFFICULTY_INFO,
  DOOR_RANGE,
  ENRAGED_SPEED,
  EXIT_RANGE,
  FEAR_BEAT_1,
  FEAR_BEAT_2,
  FEAR_DARK,
  FEAR_GHOST,
  FEAR_GHOST_R,
  FEAR_HUSH,
  FEAR_LIT,
  FEAR_MATE,
  FEAR_MATE_R,
  FEAR_WITNESS,
  FEAR_WITNESS_R,
  FEED_MS,
  GASP_LOCK_MS,
  GHOST_DOOR_MS,
  GHOST_HUNT,
  GHOST_INVESTIGATE,
  GHOST_ROAM,
  GRAB_R,
  GRACE_MS,
  HUNT_MEMORY_MS,
  HUNT_NEAR,
  HUSH_FIRST_MS,
  HUSH_GAP_MIN_MS,
  HUSH_GAP_MS,
  HUSH_GAP_RAGE_MS,
  HUSH_MS,
  HUSH_MUL,
  HUSH_WARN_MS,
  LISTEN_MS,
  MAX_BOTTLES,
  MAX_PILLS,
  NOISE_BEAT_1,
  NOISE_BEAT_2,
  NOISE_BOTTLE,
  NOISE_CROUCH_HUSH,
  NOISE_DOOR,
  NOISE_EVERY_MS,
  NOISE_EXIT,
  NOISE_GASP,
  NOISE_PLACE,
  NOISE_REVIVE,
  NOISE_RUN,
  NOISE_SEARCH,
  NOISE_WALK,
  PILL_CALM,
  PLACE_MS,
  RAGE_HEAR,
  RAGE_HUNT,
  RAGE_ROAM,
  REVIVE_FEAR,
  REVIVE_MS,
  REVIVE_RANGE,
  SATED_HEAR,
  SATED_MS,
  SEARCH_MS,
  THROW_SPEED,
  TICK_MS,
  TIME_LIMIT_MS,
  USE_RANGE,
  gradeOf,
  sanitizeOptions,
  talismansFor,
  type GameOptions,
  type Grade,
  type ItemKind,
  type MoveMode,
} from "./data";
import {
  ALTAR,
  CONTAINERS,
  DOORS,
  DOOR_AT,
  EXIT,
  GHOST_SPAWNS,
  KIND,
  ROOM_CELLS,
  START_CELLS,
  WALKABLE,
  cellAt,
  centerOf,
  collide,
  distField,
  nextCell,
  throwLanding,
  walkCellAt,
  walkField,
} from "./map";

/**
 * 숨죽인 병동 — 방장 기기가 돌리는 판정 (룰북 §3~§9).
 *
 * 사람의 **몸(위치·시선·걷는 방식)은 각자 기기가** 움직여 `PosReport`로 알리고(협동 게임이라 믿는다),
 * 방장은 그 위에서 소리·공포·숨·건전지·서랍·제단·귀신을 판정한다. 봇과 자리를 비운 사람의 몸은
 * 방장이 `think`(bot.ts)로 움직인다. `MatchState`는 순수 JSON이라 스냅샷 하나로 방장을 넘길 수 있다.
 */

export const ITEM_ORDER: ItemKind[] = ["empty", "talisman", "battery", "bottle", "pill", "charm"];

export interface PlayerStats {
  searches: number;
  talFound: number;
  talPlaced: number;
  revives: number;
  downs: number;
  bottles: number;
  pills: number;
  /** 정적을 들키지 않고 넘긴 횟수 */
  hushOk: number;
  /** 귀신이 나를 쫓기 시작한 횟수 */
  hunted: number;
  doors: number;
  charmsBurnt: number;
  maxFear: number;
}

export type PlayerSt = "alive" | "down" | "dead" | "escaped";

export interface PlayerState {
  seat: number;
  bot: boolean;
  level: number;
  /** 사람이 나가서 AI가 대신 움직이는 중 */
  away: boolean;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  cr: boolean;
  /** 숨 참기를 누르고 있나 (바람) / 실제로 참는 중인가 */
  hb: boolean;
  hold: boolean;
  light: boolean;
  st: PlayerSt;
  fear: number;
  breath: number;
  gaspUntil: number;
  battery: number;
  tal: number;
  bottles: number;
  pills: number;
  charms: number;
  /** 누르고 있는 대상: c12 서랍 · a 제단 · r2 동료 일으키기 */
  use: string | null;
  useMs: number;
  downAt: number;
  beatAt: number;
  noiseAt: number;
  useNoiseAt: number;
  /** 이번 정적에서 들켰나 */
  hushHeard: boolean;
  stats: PlayerStats;
}

export type GhostMode = "sleep" | "roam" | "investigate" | "listen" | "hunt" | "feed" | "hush" | "door";

export interface GhostState {
  x: number;
  z: number;
  yaw: number;
  mode: GhostMode;
  /** 문을 여는 동안 기억해 둔 직전 상태 */
  prev: GhostMode;
  /** 추격 대상 자리 (-1 없음) */
  seat: number;
  tx: number;
  tz: number;
  until: number;
  heardAt: number;
  alert: number;
  satedUntil: number;
  enraged: boolean;
  door: number;
}

export type EventKind =
  | "found"
  | "full"
  | "door"
  | "slam"
  | "place"
  | "exitOpen"
  | "throw"
  | "shatter"
  | "hushWarn"
  | "hushOn"
  | "hushOff"
  | "wake"
  | "notice"
  | "hunt"
  | "lost"
  | "grab"
  | "charm"
  | "revive"
  | "dead"
  | "escape"
  | "gasp"
  | "pill"
  | "lastMinute"
  | "over";

export interface GameEvent {
  id: number;
  at: number;
  k: EventKind;
  seat?: number;
  x?: number;
  z?: number;
  x2?: number;
  z2?: number;
  n?: number;
}

export interface Bottle {
  id: number;
  x: number;
  z: number;
  x2: number;
  z2: number;
  t0: number;
  t1: number;
}

export interface Outcome {
  win: boolean;
  escaped: number;
  grade: Grade;
  tMs: number;
  /** 끝난 까닭 */
  why: "escaped" | "allDown" | "time";
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
  ghost: GhostState;
  /** 문이 열려 있나 */
  doors: boolean[];
  doorVer: number;
  /** 서랍 내용물 (ITEM_ORDER 번호) / 뒤졌나 */
  contents: number[];
  searched: boolean[];
  need: number;
  placed: number;
  exitOpen: boolean;
  hush: { st: "idle" | "warn" | "on"; at: number; until: number; heard: boolean; count: number };
  bottles: Bottle[];
  events: GameEvent[];
  eid: number;
  lastMinute: boolean;
  outcome: Outcome | null;
  /** 최종 순위 (협동: 탈출한 사람 1위, 나머지 2위 — 아무도 못 나가면 모두 2위) */
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
  hb: boolean;
  light: boolean;
  use: string | null;
}

export type PlayerAct = { k: "door"; i: number } | { k: "throw"; yaw: number; pitch: number } | { k: "pill" };

export type BotThink = (rt: HostRuntime, seat: number, dtMs: number) => void;

export interface HostRuntime {
  state: MatchState;
  acc: number;
  think: BotThink | null;
  /** 귀신 귀까지의 소리 거리장 (귀신 칸·문 상태가 바뀔 때만 다시 계산) */
  sound: { key: string; field: Float32Array } | null;
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

const between = (s: MatchState, [a, b]: [number, number]) => a + (b - a) * rand(s);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function pushEvent(s: MatchState, k: EventKind, e: Omit<GameEvent, "id" | "at" | "k"> = {}) {
  s.events.push({ id: ++s.eid, at: s.t, k, ...e });
}

const emptyStats = (): PlayerStats => ({ searches: 0, talFound: 0, talPlaced: 0, revives: 0, downs: 0, bottles: 0, pills: 0, hushOk: 0, hunted: 0, doors: 0, charmsBurnt: 0, maxFear: 0 });

export function rage(s: MatchState): number {
  return s.placed;
}

function turnToward(cur: number, want: number, max: number): number {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + clamp(d, -max, max);
}

/* ── 판 만들기 ──────────────────────────────────────────────────────── */

export function createMatch(seed: number, seats: { bot: boolean; level: number }[], options?: Partial<GameOptions>): MatchState {
  const opts = sanitizeOptions(options);
  const info = DIFFICULTY_INFO[opts.difficulty];
  const n = Math.max(1, Math.min(4, seats.length));
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: n,
    options: opts,
    phase: "play",
    players: [],
    ghost: { x: 0, z: 0, yaw: 0, mode: "sleep", prev: "roam", seat: -1, tx: 0, tz: 0, until: 0, heardAt: 0, alert: 0, satedUntil: 0, enraged: false, door: -1 },
    doors: [],
    doorVer: 0,
    contents: CONTAINERS.map(() => 0),
    searched: CONTAINERS.map(() => false),
    need: talismansFor(n),
    placed: 0,
    exitOpen: false,
    hush: { st: "idle", at: 0, until: 0, heard: false, count: 0 },
    bottles: [],
    events: [],
    eid: 0,
    lastMinute: false,
    outcome: null,
    ranks: null,
  };
  for (let i = 0; i < 8; i++) rand(s);

  // 서랍 내용물: 부적은 되도록 서로 다른 방에
  const order = CONTAINERS.map((c) => c.i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const usedRooms = new Set<string>();
  const talAt: number[] = [];
  for (const ci of order) {
    if (talAt.length >= s.need) break;
    const room = CONTAINERS[ci].room;
    if (usedRooms.has(room)) continue;
    usedRooms.add(room);
    talAt.push(ci);
  }
  for (const ci of order) {
    if (talAt.length >= s.need) break;
    if (!talAt.includes(ci)) talAt.push(ci);
  }
  for (const ci of talAt) s.contents[ci] = ITEM_ORDER.indexOf("talisman");
  const rest = order.filter((ci) => !talAt.includes(ci));
  const loot: ItemKind[] = [
    ...Array<ItemKind>(Math.min(6, 3 + n)).fill("battery"),
    ...Array<ItemKind>(4 + n).fill("bottle"),
    ...Array<ItemKind>(n >= 3 ? 3 : 2).fill("pill"),
    ...(opts.difficulty === "easy" || opts.difficulty === "normal" ? (["charm"] as ItemKind[]) : []),
  ];
  rest.forEach((ci, k) => {
    s.contents[ci] = k < loot.length ? ITEM_ORDER.indexOf(loot[k]) : 0;
  });

  // 문: 로비 문은 열려 있고 나머지는 반쯤
  const lobbyDoor = DOOR_AT[cellAt(ALTAR.x, 14 * 2 + 1)];
  s.doors = DOORS.map((d) => d.i === lobbyDoor || rand(s) < 0.45);

  const charms = info.charms + (n === 1 ? 1 : 0);
  s.players = Array.from({ length: n }, (_, seat): PlayerState => {
    const c = centerOf(START_CELLS[seat]);
    return {
      seat,
      bot: !!seats[seat]?.bot,
      level: clamp(Math.round(seats[seat]?.level ?? 5), 1, 10),
      away: false,
      x: c.x,
      z: c.z,
      yaw: 0,
      pitch: 0,
      mv: 0,
      cr: false,
      hb: false,
      hold: false,
      light: true,
      st: "alive",
      fear: 10,
      breath: BREATH_MAX,
      gaspUntil: 0,
      battery: BATTERY_START,
      tal: 0,
      bottles: 0,
      pills: 0,
      charms,
      use: null,
      useMs: 0,
      downAt: 0,
      beatAt: 0,
      noiseAt: 0,
      useNoiseAt: 0,
      hushHeard: false,
      stats: emptyStats(),
    };
  });

  const g = centerOf(GHOST_SPAWNS[Math.floor(rand(s) * GHOST_SPAWNS.length)]);
  s.ghost.x = g.x;
  s.ghost.z = g.z;
  s.ghost.tx = g.x;
  s.ghost.tz = g.z;
  s.hush.at = between(s, HUSH_FIRST_MS) * info.hushGap;
  return s;
}

export function createHost(state: MatchState, think: BotThink | null): HostRuntime {
  return { state, acc: 0, think, sound: null, mem: {} };
}

export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p || p.bot) return;
  p.away = away;
  if (away) {
    p.use = null;
    p.hb = false;
  }
}

/* ── 사람 입력 ──────────────────────────────────────────────────────── */

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function applyReport(rt: HostRuntime, seat: number, rep: PosReport | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !rep || p.bot || p.away || s.phase !== "play") return;
  if (p.st !== "alive") {
    // 쓰러져도 고개는 돌릴 수 있다
    p.yaw = num(rep.yaw, p.yaw);
    p.pitch = clamp(num(rep.pitch, p.pitch), -1.4, 1.4);
    return;
  }
  const pos = { x: num(rep.x, p.x), z: num(rep.z, p.z) };
  collide(pos, s.doors);
  p.x = pos.x;
  p.z = pos.z;
  p.yaw = num(rep.yaw, p.yaw);
  p.pitch = clamp(num(rep.pitch, p.pitch), -1.4, 1.4);
  const mv = Math.round(num(rep.mv));
  p.mv = (mv >= 0 && mv <= 3 ? mv : 0) as MoveMode;
  p.cr = !!rep.cr;
  p.hb = !!rep.hb;
  p.light = !!rep.light && p.battery > 0;
  const use = typeof rep.use === "string" && rep.use.length <= 4 ? rep.use : null;
  if (use !== p.use) {
    p.use = use;
    p.useMs = 0;
  }
}

export function applyAct(rt: HostRuntime, seat: number, act: PlayerAct | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !act || s.phase !== "play" || p.st !== "alive") return;
  if (act.k === "door") {
    const d = DOORS[Math.round(num(act.i, -1))];
    if (!d) return;
    if (Math.hypot(p.x - d.x, p.z - d.z) > DOOR_RANGE + 0.6) return;
    const open = s.doors[d.i];
    if (open) {
      // 문간에 누가 서 있으면 못 닫는다
      const g = s.ghost;
      if (Math.hypot(g.x - d.x, g.z - d.z) < 1.1) return;
      if (s.players.some((q) => q.st !== "dead" && q.st !== "escaped" && Math.hypot(q.x - d.x, q.z - d.z) < 0.75)) return;
    }
    s.doors[d.i] = !open;
    s.doorVer++;
    p.stats.doors++;
    const loud = !p.cr;
    pushEvent(s, "door", { seat, n: d.i, x: open ? 0 : 1, z: loud ? 1 : 0 });
    if (loud) emitNoise(rt, d.x, d.z, NOISE_DOOR, seat);
  } else if (act.k === "throw") {
    if (p.bottles <= 0) return;
    p.bottles--;
    p.stats.bottles++;
    const land = throwLanding(p.x, p.z, num(act.yaw, p.yaw), clamp(num(act.pitch), -1.4, 1.4), s.doors);
    const dur = Math.max(250, (land.dist / THROW_SPEED) * 1000);
    s.bottles.push({ id: ++s.eid, x: p.x, z: p.z, x2: land.x, z2: land.z, t0: s.t, t1: s.t + dur });
    pushEvent(s, "throw", { seat, x: p.x, z: p.z, x2: land.x, z2: land.z, n: Math.round(dur) });
  } else if (act.k === "pill") {
    if (p.pills <= 0) return;
    p.pills--;
    p.stats.pills++;
    p.fear = Math.max(0, p.fear - PILL_CALM);
    pushEvent(s, "pill", { seat });
  }
}

/* ── 소리 ───────────────────────────────────────────────────────────── */

function soundField(rt: HostRuntime): Float32Array {
  const s = rt.state;
  const cell = walkCellAt(s.ghost.x, s.ghost.z);
  const key = `${cell}:${s.doorVer}`;
  if (!rt.sound || rt.sound.key !== key) rt.sound = { key, field: distField(cell, s.doors) };
  return rt.sound.field;
}

/** 귀신 귀까지 길 따라 잰 거리 (같은 칸·옆 칸이면 직선거리) */
export function ghostDist(rt: HostRuntime, x: number, z: number): number {
  const g = rt.state.ghost;
  const direct = Math.hypot(g.x - x, g.z - z);
  const f = soundField(rt)[walkCellAt(x, z)];
  return Math.max(direct, Number.isFinite(f) ? f - 1 : Infinity);
}

export function hearMul(s: MatchState): number {
  const info = DIFFICULTY_INFO[s.options.difficulty];
  return info.hear * (1 + RAGE_HEAR * rage(s)) * (1 + CROWD_HEAR * (s.seatCount - 1)) * (s.t < s.ghost.satedUntil ? SATED_HEAR : 1) * (s.hush.st === "on" ? HUSH_MUL : 1);
}

function startHunt(rt: HostRuntime, seat: number, x: number, z: number, enraged: boolean) {
  const s = rt.state;
  const g = s.ghost;
  const fresh = g.mode !== "hunt" || g.seat !== seat;
  if (g.mode === "door") g.prev = "hunt";
  else g.mode = "hunt";
  g.seat = seat;
  g.tx = x;
  g.tz = z;
  g.heardAt = s.t;
  g.enraged = enraged || (g.enraged && !fresh);
  if (fresh) {
    const p = s.players[seat];
    if (p) p.stats.hunted++;
    pushEvent(s, "hunt", { seat, x: g.x, z: g.z });
  }
}

function startInvestigate(rt: HostRuntime, x: number, z: number) {
  const s = rt.state;
  const g = s.ghost;
  const was = g.mode;
  if (g.mode === "door") g.prev = "investigate";
  else g.mode = "investigate";
  g.seat = -1;
  g.tx = x;
  g.tz = z;
  g.enraged = false;
  if (was === "roam" || was === "listen" || was === "hush") pushEvent(s, "notice", { x: g.x, z: g.z });
}

/**
 * 소리가 났다. `seat` -1 = 물건(깨진 병·제단·현관). 귀신이 들으면 경계심이 쌓이고,
 * 가깝거나 여러 번 들리면 추격한다.
 */
export function emitNoise(rt: HostRuntime, x: number, z: number, radius: number, seat: number) {
  const s = rt.state;
  const g = s.ghost;
  if (g.mode === "sleep" || g.mode === "feed" || s.phase !== "play") return;
  const rad = radius * hearMul(s);
  const d = ghostDist(rt, x, z);
  if (d > rad) return;
  const strength = rad - d;
  const eff = g.mode === "door" ? g.prev : g.mode;
  const p = seat >= 0 ? s.players[seat] : null;

  if (s.hush.st === "on") {
    s.hush.heard = true;
    if (p) {
      p.hushHeard = true;
      startHunt(rt, seat, x, z, true);
    } else startInvestigate(rt, x, z);
    return;
  }
  g.alert += 1 + strength * 0.3;
  if (eff === "hunt") {
    const target = s.players[g.seat];
    if (p && seat === g.seat) {
      g.tx = x;
      g.tz = z;
      g.heardAt = s.t;
    } else if (p && target) {
      // 더 가까운 다른 사람 소리로 갈아탄다
      const td = Math.hypot(target.x - g.x, target.z - g.z);
      if (d < td - 3 || s.t - g.heardAt > HUNT_MEMORY_MS * 0.6) startHunt(rt, seat, x, z, false);
    } else if (!p) {
      const td = target ? Math.hypot(target.x - g.x, target.z - g.z) : Infinity;
      if (td > BOTTLE_DIVERT_R) startInvestigate(rt, x, z);
    }
    return;
  }
  if (p && (d <= HUNT_NEAR || g.alert >= ALERT_HUNT)) {
    startHunt(rt, seat, x, z, false);
    return;
  }
  startInvestigate(rt, x, z);
}

/* ── 귀신 ───────────────────────────────────────────────────────────── */

function active(s: MatchState): PlayerState[] {
  return s.players.filter((p) => p.st === "alive");
}

function pickRoam(rt: HostRuntime) {
  const s = rt.state;
  const g = s.ghost;
  const here = walkCellAt(g.x, g.z);
  let cell = ROOM_CELLS[Math.floor(rand(s) * ROOM_CELLS.length)];
  const alive = active(s);
  if (s.t < g.satedUntil) {
    // 배부르면 멀리 간다
    const f = walkField(here);
    const far = WALKABLE.filter((c) => f[c] >= 22);
    if (far.length) cell = far[Math.floor(rand(s) * far.length)];
  } else if (alive.length && rand(s) < Math.min(0.8, 0.35 + 0.1 * rage(s))) {
    // 연출가: 누군가의 근처로 어슬렁 (정확한 위치는 모른다)
    const p = alive[Math.floor(rand(s) * alive.length)];
    const f = walkField(walkCellAt(p.x, p.z));
    const near = WALKABLE.filter((c) => f[c] >= 6 && f[c] <= 16);
    if (near.length) cell = near[Math.floor(rand(s) * near.length)];
  }
  const c = centerOf(cell);
  g.mode = "roam";
  g.seat = -1;
  g.enraged = false;
  g.tx = c.x;
  g.tz = c.z;
}

/** 목적지로 한 걸음. 닫힌 문을 만나면 여는 상태로 들어간다. 도착하면 true. */
function ghostMove(rt: HostRuntime, tx: number, tz: number, speed: number, dt: number): boolean {
  const s = rt.state;
  const g = s.ghost;
  const here = walkCellAt(g.x, g.z);
  const tc = walkCellAt(tx, tz);
  let ax = tx;
  let az = tz;
  if (here !== tc) {
    const n = nextCell(here, tc);
    if (n === here) return true;
    if (KIND[n] === 2 && !s.doors[DOOR_AT[n]]) {
      g.prev = g.mode;
      g.mode = "door";
      g.door = DOOR_AT[n];
      g.until = s.t + GHOST_DOOR_MS;
      return false;
    }
    const c = centerOf(n);
    ax = c.x;
    az = c.z;
  }
  const dx = ax - g.x;
  const dz = az - g.z;
  const d = Math.hypot(dx, dz);
  const step = speed * dt;
  if (d <= step) {
    g.x = ax;
    g.z = az;
  } else {
    g.x += (dx / d) * step;
    g.z += (dz / d) * step;
  }
  if (d > 0.05) g.yaw = turnToward(g.yaw, Math.atan2(-dx, -dz), 7 * dt);
  if (here === tc) {
    const pos = { x: g.x, z: g.z };
    collide(pos, s.doors, 0.25);
    g.x = pos.x;
    g.z = pos.z;
    return d <= Math.max(step, 0.2) || Math.hypot(pos.x - tx, pos.z - tz) > d - 1e-4;
  }
  return false;
}

function grab(rt: HostRuntime, p: PlayerState) {
  const s = rt.state;
  const g = s.ghost;
  g.alert = 0;
  g.seat = -1;
  g.enraged = false;
  g.mode = "feed";
  if (p.charms > 0) {
    p.charms--;
    p.stats.charmsBurnt++;
    p.fear = 100;
    g.until = s.t + CHARM_STUN_MS;
    g.satedUntil = g.until + SATED_MS;
    pushEvent(s, "charm", { seat: p.seat, x: g.x, z: g.z });
    return;
  }
  p.st = "down";
  p.downAt = s.t;
  p.use = null;
  p.useMs = 0;
  p.light = false;
  p.hold = false;
  p.mv = 0;
  p.stats.downs++;
  g.until = s.t + FEED_MS;
  g.satedUntil = g.until + SATED_MS;
  pushEvent(s, "grab", { seat: p.seat, x: p.x, z: p.z });
  for (const q of s.players) if (q !== p && q.st === "alive" && Math.hypot(q.x - p.x, q.z - p.z) < FEAR_WITNESS_R) q.fear = Math.min(100, q.fear + FEAR_WITNESS);
}

function ghostStep(rt: HostRuntime, dt: number) {
  const s = rt.state;
  const g = s.ghost;
  const info = DIFFICULTY_INFO[s.options.difficulty];
  if (g.mode === "sleep") {
    if (s.t >= GRACE_MS) {
      pushEvent(s, "wake", { x: g.x, z: g.z });
      pickRoam(rt);
    }
    return;
  }
  g.alert = Math.max(0, g.alert - ALERT_DECAY * dt);

  switch (g.mode) {
    case "roam": {
      if (ghostMove(rt, g.tx, g.tz, (GHOST_ROAM + RAGE_ROAM * rage(s)) * info.speed, dt)) {
        g.mode = "listen";
        g.until = s.t + LISTEN_MS * 0.5;
      }
      break;
    }
    case "investigate": {
      if (ghostMove(rt, g.tx, g.tz, GHOST_INVESTIGATE * info.speed, dt)) {
        g.mode = "listen";
        g.until = s.t + LISTEN_MS;
      }
      break;
    }
    case "listen": {
      g.yaw += Math.sin(s.t / 380) * 1.6 * dt;
      if (s.t >= g.until) pickRoam(rt);
      break;
    }
    case "hunt": {
      const p = s.players[g.seat];
      if (!p || p.st !== "alive") {
        pickRoam(rt);
        break;
      }
      const speed = (GHOST_HUNT + RAGE_HUNT * rage(s)) * info.speed * (g.enraged ? ENRAGED_SPEED : 1);
      const reached = ghostMove(rt, g.tx, g.tz, speed, dt);
      if (g.mode !== "hunt") break;
      if (Math.hypot(p.x - g.x, p.z - g.z) < GRAB_R) {
        grab(rt, p);
        break;
      }
      if (reached && s.t - g.heardAt > HUNT_MEMORY_MS) {
        g.mode = "listen";
        g.until = s.t + LISTEN_MS;
        g.alert = ALERT_HUNT * 0.5;
        g.seat = -1;
        g.enraged = false;
        pushEvent(s, "lost", { x: g.x, z: g.z });
      }
      break;
    }
    case "feed": {
      if (s.t >= g.until) pickRoam(rt);
      break;
    }
    case "hush": {
      g.yaw += Math.sin(s.t / 300) * 2.2 * dt;
      break;
    }
    case "door": {
      if (s.t >= g.until) {
        if (g.door >= 0 && !s.doors[g.door]) {
          s.doors[g.door] = true;
          s.doorVer++;
          pushEvent(s, "slam", { n: g.door, x: DOORS[g.door].x, z: DOORS[g.door].z });
        }
        g.mode = g.prev === "door" ? "roam" : g.prev;
        g.door = -1;
      }
      break;
    }
  }

  // 몸이 닿으면 어떤 상태든 붙잡힌다
  if (g.mode !== "feed") {
    for (const p of s.players) {
      if (p.st !== "alive") continue;
      if (Math.hypot(p.x - g.x, p.z - g.z) < BUMP_R) {
        grab(rt, p);
        break;
      }
    }
  }
}

/* ── 정적 (종) ──────────────────────────────────────────────────────── */

function hushStep(rt: HostRuntime) {
  const s = rt.state;
  const h = s.hush;
  const g = s.ghost;
  const info = DIFFICULTY_INFO[s.options.difficulty];
  if (h.st === "idle") {
    if (s.t < h.at) return;
    if (g.mode === "sleep" || g.mode === "hunt" || g.mode === "feed" || g.mode === "door") {
      h.at = s.t + 4000;
      return;
    }
    h.st = "warn";
    h.until = s.t + HUSH_WARN_MS;
    pushEvent(s, "hushWarn");
  } else if (h.st === "warn") {
    if (s.t < h.until) return;
    if (g.mode === "hunt" || g.mode === "feed") {
      // 추격이 벌어졌으면 이번 종은 건너뛴다
      h.st = "idle";
      h.at = s.t + 8000;
      pushEvent(s, "hushOff", { n: 2 });
      return;
    }
    h.st = "on";
    h.until = s.t + HUSH_MS;
    h.heard = false;
    h.count++;
    for (const p of s.players) p.hushHeard = false;
    if (g.mode === "door") g.prev = "hush";
    else g.mode = "hush";
    pushEvent(s, "hushOn");
  } else {
    if (s.t < h.until) return;
    h.st = "idle";
    const gap = Math.max(HUSH_GAP_MIN_MS, between(s, HUSH_GAP_MS) - HUSH_GAP_RAGE_MS * rage(s));
    h.at = s.t + gap * info.hushGap;
    for (const p of s.players) if (p.st === "alive" && !p.hushHeard) p.stats.hushOk++;
    pushEvent(s, "hushOff", { n: h.heard ? 1 : 0 });
    if (g.mode === "hush") pickRoam(rt);
    else if (g.mode === "door" && g.prev === "hush") g.prev = "roam";
  }
}

/* ── 사람 ───────────────────────────────────────────────────────────── */

function giveItem(s: MatchState, p: PlayerState, ci: number): boolean {
  const kind = ITEM_ORDER[s.contents[ci]] ?? "empty";
  if (kind === "bottle" && p.bottles >= MAX_BOTTLES) return false;
  if (kind === "pill" && p.pills >= MAX_PILLS) return false;
  if (kind === "talisman") {
    p.tal++;
    p.stats.talFound++;
  } else if (kind === "battery") p.battery = Math.min(100, p.battery + BATTERY_PACK);
  else if (kind === "bottle") p.bottles++;
  else if (kind === "pill") p.pills++;
  else if (kind === "charm") p.charms++;
  return true;
}

function holdStep(rt: HostRuntime, p: PlayerState, dtMs: number) {
  const s = rt.state;
  const u = p.use;
  if (!u) {
    p.useMs = 0;
    return;
  }
  const kind = u[0];
  const id = Number(u.slice(1));
  let ok = false;
  let need = SEARCH_MS;
  let noise = 0;
  let nx = p.x;
  let nz = p.z;
  if (kind === "c") {
    const c = CONTAINERS[id];
    ok = !!c && !s.searched[id] && Math.hypot(p.x - c.x, p.z - c.z) <= USE_RANGE + 0.9;
    noise = NOISE_SEARCH;
  } else if (kind === "a") {
    ok = p.tal > 0 && s.placed < s.need && Math.hypot(p.x - ALTAR.x, p.z - ALTAR.z) <= USE_RANGE + 0.4;
    need = PLACE_MS;
  } else if (kind === "r") {
    const q = s.players[id];
    ok = !!q && q !== p && q.st === "down" && Math.hypot(p.x - q.x, p.z - q.z) <= REVIVE_RANGE + 0.4;
    need = REVIVE_MS;
    noise = NOISE_REVIVE;
    if (q) {
      nx = q.x;
      nz = q.z;
    }
  }
  if (!ok) {
    p.use = p.bot || p.away ? null : p.use;
    p.useMs = 0;
    return;
  }
  p.useMs += dtMs;
  if (noise > 0 && s.t >= p.useNoiseAt) {
    p.useNoiseAt = s.t + 500;
    emitNoise(rt, nx, nz, noise, p.seat);
  }
  if (p.useMs < need) return;
  p.useMs = 0;
  if (kind === "c") {
    if (!giveItem(s, p, id)) {
      pushEvent(s, "full", { seat: p.seat, n: s.contents[id], x: id });
      p.use = null;
      return;
    }
    s.searched[id] = true;
    p.stats.searches++;
    pushEvent(s, "found", { seat: p.seat, n: s.contents[id], x: id });
    p.use = null;
  } else if (kind === "a") {
    p.tal--;
    p.stats.talPlaced++;
    s.placed++;
    pushEvent(s, "place", { seat: p.seat, n: s.placed });
    emitNoise(rt, ALTAR.x, ALTAR.z + 1, NOISE_PLACE, -1);
    if (s.placed >= s.need && !s.exitOpen) {
      s.exitOpen = true;
      pushEvent(s, "exitOpen");
      emitNoise(rt, EXIT.x, EXIT.z, NOISE_EXIT, -1);
    }
    if (p.tal <= 0 || s.placed >= s.need) p.use = null;
  } else if (kind === "r") {
    const q = s.players[id];
    q.st = "alive";
    q.fear = REVIVE_FEAR;
    q.breath = BREATH_MAX * 0.5;
    q.mv = 0;
    q.cr = true;
    p.stats.revives++;
    pushEvent(s, "revive", { seat: q.seat, n: p.seat });
    p.use = null;
  }
}

function playerStep(rt: HostRuntime, p: PlayerState, dtMs: number) {
  const s = rt.state;
  const dt = dtMs / 1000;
  if (p.st === "down") {
    if (s.t - p.downAt >= BLEED_MS) {
      p.st = "dead";
      pushEvent(s, "dead", { seat: p.seat });
    }
    return;
  }
  if (p.st !== "alive") return;

  // 손전등
  if (p.light) {
    p.battery = Math.max(0, p.battery - (100 / BATTERY_SEC) * dt);
    if (p.battery <= 0) p.light = false;
  }
  const mates = s.players.filter((q) => q !== p && q.st === "alive");
  const lit = p.light || mates.some((q) => q.light && Math.hypot(q.x - p.x, q.z - p.z) < 4);

  // 공포
  let df = lit ? FEAR_LIT : FEAR_DARK;
  const g = s.ghost;
  if (g.mode !== "sleep") {
    const gd = ghostDist(rt, p.x, p.z);
    if (gd < FEAR_GHOST_R) df += FEAR_GHOST * (1 - gd / FEAR_GHOST_R);
  }
  if (s.hush.st === "on") df += FEAR_HUSH;
  if (mates.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < FEAR_MATE_R)) df += FEAR_MATE;
  p.fear = clamp(p.fear + df * dt, 0, 100);
  if (p.fear > p.stats.maxFear) p.stats.maxFear = Math.round(p.fear);

  // 숨
  const canHold = p.hb && s.t >= p.gaspUntil && p.mv !== 3 && p.breath > 0;
  if (canHold) {
    p.hold = true;
    p.breath -= dt;
    if (p.breath <= 0) {
      p.breath = 0;
      p.hold = false;
      p.gaspUntil = s.t + GASP_LOCK_MS;
      pushEvent(s, "gasp", { seat: p.seat });
      emitNoise(rt, p.x, p.z, NOISE_GASP, p.seat);
    }
  } else {
    p.hold = false;
    if (s.t >= p.gaspUntil) p.breath = Math.min(BREATH_MAX, p.breath + BREATH_REGEN * dt);
  }

  // 발소리
  if (s.t >= p.noiseAt) {
    p.noiseAt = s.t + NOISE_EVERY_MS;
    const rad = p.mv === 3 ? NOISE_RUN : p.mv === 2 ? NOISE_WALK : p.mv === 1 && s.hush.st === "on" ? NOISE_CROUCH_HUSH : 0;
    if (rad > 0) emitNoise(rt, p.x, p.z, rad, p.seat);
  }
  // 심장 소리
  if (p.fear >= FEAR_BEAT_1 && !p.hold) {
    if (s.t >= p.beatAt) {
      const hard = p.fear >= FEAR_BEAT_2;
      p.beatAt = s.t + (hard ? BEAT_MS_2 : BEAT_MS_1);
      emitNoise(rt, p.x, p.z, hard ? NOISE_BEAT_2 : NOISE_BEAT_1, p.seat);
    }
  }

  holdStep(rt, p, dtMs);

  // 탈출
  if (s.exitOpen && Math.hypot(p.x - EXIT.x, p.z - EXIT.z) <= EXIT_RANGE) {
    p.st = "escaped";
    p.use = null;
    p.light = false;
    pushEvent(s, "escape", { seat: p.seat });
  }
}

function finish(rt: HostRuntime, why: Outcome["why"]) {
  const s = rt.state;
  for (const p of s.players) {
    if (p.st === "alive" || p.st === "down") {
      p.st = "dead";
    }
  }
  const escaped = s.players.filter((p) => p.st === "escaped").length;
  const everDown = s.players.reduce((n, p) => n + p.stats.downs, 0);
  s.outcome = { win: escaped > 0, escaped, grade: gradeOf(escaped, s.seatCount, everDown), tMs: s.t, why: escaped > 0 && why !== "time" ? "escaped" : why };
  s.ranks = s.players.map((p) => (p.st === "escaped" ? 1 : 2));
  s.phase = "gameOver";
  pushEvent(s, "over", { n: escaped > 0 ? 1 : 0 });
}

function tick(rt: HostRuntime) {
  const s = rt.state;
  if (s.phase !== "play") return;
  s.t += TICK_MS;
  const dt = TICK_MS / 1000;

  if (rt.think) for (const p of s.players) if ((p.bot || p.away) && p.st === "alive") rt.think(rt, p.seat, TICK_MS);
  for (const p of s.players) playerStep(rt, p, TICK_MS);

  // 날아가던 병이 깨진다
  if (s.bottles.length) {
    const left: Bottle[] = [];
    for (const b of s.bottles) {
      if (s.t >= b.t1) {
        pushEvent(s, "shatter", { x: b.x2, z: b.z2 });
        emitNoise(rt, b.x2, b.z2, NOISE_BOTTLE, -1);
      } else left.push(b);
    }
    s.bottles = left;
  }

  hushStep(rt);
  ghostStep(rt, dt);

  if (!s.lastMinute && s.t >= TIME_LIMIT_MS - 60_000) {
    s.lastMinute = true;
    pushEvent(s, "lastMinute");
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 6000) s.events = s.events.filter((e) => e.at >= s.t - 6000);

  // 끝?
  if (s.t >= TIME_LIMIT_MS) finish(rt, "time");
  else if (!s.players.some((p) => p.st === "alive")) finish(rt, "allDown");
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

/** 그 사람이 지금 내는 소리 반경 (HUD의 소리 표시) */
export function noiseRadiusOf(p: Pick<PlayerState, "mv" | "fear" | "hold" | "use">, hushOn: boolean): number {
  let r = p.mv === 3 ? NOISE_RUN : p.mv === 2 ? NOISE_WALK : p.mv === 1 && hushOn ? NOISE_CROUCH_HUSH : 0;
  if (!p.hold && p.fear >= FEAR_BEAT_1) r = Math.max(r, p.fear >= FEAR_BEAT_2 ? NOISE_BEAT_2 : NOISE_BEAT_1);
  if (p.use?.[0] === "c") r = Math.max(r, NOISE_SEARCH);
  if (p.use?.[0] === "r") r = Math.max(r, NOISE_REVIVE);
  return r;
}

export { ALTAR, EXIT };
