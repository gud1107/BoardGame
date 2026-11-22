import {
  BATTERY_PACK,
  BATTERY_SEC,
  BUDDY_R,
  BURN_MS,
  BURN_R,
  CHILL_R,
  DIFFICULTY_INFO,
  ENERGY_MAX,
  ENERGY_PANIC_BONUS,
  ENERGY_REGEN,
  FEAR_ALONE,
  FEAR_CARRY,
  FEAR_CHILL,
  FEAR_COURTYARD,
  FEAR_DARK,
  FEAR_LIT,
  FEAR_NO_LIGHT,
  FEAR_TOGETHER,
  GHOST_SPAWN_MIN,
  GRACE_MS,
  ITEM_ORDER,
  LANTERN_MS,
  LIGHT_CONE,
  MANIFEST_CONE,
  MANIFEST_FEAR,
  MANIFEST_FEAR_SIDE,
  MANIFEST_MS,
  MANIFEST_R,
  MAX_CARRY,
  MAX_TEA,
  MAX_WATER,
  PANIC_CLEAR,
  PANIC_FEAR,
  PICK_MS,
  POSSESS_FEAR,
  POSSESS_R,
  POWERS,
  QUENCH_LOSS,
  QUENCH_R,
  REVIVED_FEAR,
  REVIVE_MS,
  REVIVE_RANGE,
  RITUAL_R,
  SAFE_MS,
  SEARCH_MS,
  SHIMMER_BEAM_R,
  SHIMMER_CONE,
  SHIMMER_LIT_R,
  SLAM_FEAR,
  SLAM_FEAR_ALONE,
  SLAM_HEAR_R,
  SLAM_R,
  SOLO_ALONE_MUL,
  SNUFF_FEAR,
  SNUFF_MS,
  SNUFF_R,
  TEA_CALM,
  TICK_MS,
  TIME_LIMIT_MS,
  USE_RANGE,
  WARD_R,
  WATER_CONE,
  WATER_DRAIN,
  WATER_R,
  WATER_REVEAL_MS,
  WATER_STUN_MS,
  WHISPER_FEAR,
  WHISPER_FEAR_ALONE,
  WHISPER_R,
  cursesFor,
  energyScale,
  emfLevel,
  ritualRate,
  selfWakeMs,
  soulsFor,
  sanitizeOptions,
  type GameOptions,
  type ItemKind,
  type MoveMode,
  type PowerKind,
} from "./data";
import { BRAZIER, CONTAINERS, DOOR_CELLS, FURNITURE, LANTERNS, START_CELLS, WALKABLE, centerOf, clampGhost, clearLine, collide, lanternOf, pathDist, roomAt } from "./map";

/**
 * 빙의의 밤 — 판정 (룰북 §3~§9). **원귀 자리의 기기가** 이것을 돌린다(원귀가 봇이면 방장 기기).
 *
 * 원귀의 위치와 저주받은 물건이 든 곳은 판정하는 기기만 안다: 다른 기기로 보내는 스냅샷(`net.ts makeSnap`)은
 * 원귀가 모습을 드러냈을 때만 위치를 싣고, 안 뒤진 수납의 내용물은 지운다. 그래서 판정 기기가 바뀌면
 * (원귀가 나가 퇴마사 하나가 이어받으면) `rebuildSecrets`로 원귀 자리·물건 자리를 새로 정한다.
 *
 * 퇴마사의 몸은 각자 기기가 움직여 `PosReport`로 알리고, 원귀는 판정 기기 안에서 바로 움직인다.
 * 봇과 자리를 비운 사람은 `think`(bot.ts)가 움직인다. `MatchState`는 순수 JSON.
 */

export interface HunterStats {
  searches: number;
  cursesFound: number;
  burned: number;
  revives: number;
  possessed: number;
  waters: number;
  waterHits: number;
  teas: number;
  lanterns: number;
  panics: number;
  ritualSec: number;
}

export interface GhostStats {
  whispers: number;
  slams: number;
  snuffs: number;
  manifests: number;
  possessions: number;
  quenches: number;
  /** 성수에 맞은 횟수 */
  hits: number;
}

export type Role = "hunter" | "ghost";
export type PlayerSt = "alive" | "possessed";

export interface PlayerState {
  seat: number;
  bot: boolean;
  level: number;
  away: boolean;
  role: Role;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  light: boolean;
  st: PlayerSt;
  /** 공포 0~100 */
  fear: number;
  panic: boolean;
  battery: number;
  water: number;
  tea: number;
  /** 들고 있는 저주받은 물건 (물건 번호) */
  carry: number[];
  /** 원귀의 🕯️ 소등으로 손전등이 꺼져 있는 시각까지 */
  lightOffUntil: number;
  /** 누르고 있는 대상: c12 뒤지기 · b 화로에 태우기 · l3 등잔 · r2 퇴마(되살리기) · g5 떨어진 물건 줍기 */
  use: string | null;
  useMs: number;
  downAt: number;
  safeUntil: number;
  /** 🔮 영기 탐지기 0~3 */
  emf: number;
  hunter: HunterStats;
  ghost: GhostStats;
}

export interface GhostState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  energy: number;
  /** 힘마다 다시 쓸 수 있는 시각 */
  ready: Record<PowerKind, number>;
  stunUntil: number;
  revealUntil: number;
  manifestUntil: number;
  moving: boolean;
}

export type EventKind =
  | "found"
  | "full"
  | "burn"
  | "ritualStart"
  | "ritualDone"
  | "lantern"
  | "pick"
  | "drop"
  | "water"
  | "ghostHit"
  | "tea"
  | "panic"
  | "calm"
  | "possess"
  | "revive"
  | "whisper"
  | "slam"
  | "snuff"
  | "manifest"
  | "quench"
  | "fail"
  | "awaken"
  | "lastMinute"
  | "over";

export interface GameEvent {
  id: number;
  at: number;
  k: EventKind;
  seat?: number;
  /** 이 자리에게만 보이는 알림 (속삭임은 그 사람만 듣는다) */
  to?: number;
  x?: number;
  z?: number;
  n?: number;
}

export interface Outcome {
  winner: Role;
  why: "ritual" | "souls" | "allPossessed" | "dawn";
  tMs: number;
  burned: number;
  standing: number;
}

export interface GroundItem {
  id: number;
  curse: number;
  x: number;
  z: number;
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  ghostSeat: number;
  options: GameOptions;
  phase: "play" | "gameOver";
  players: PlayerState[];
  ghost: GhostState;
  /** 0 안 보임 · 1 희미한 그림자 · 2 모습이 드러남 (현신·성수) */
  ghostVis: 0 | 1 | 2;
  /** 수납 내용물 (ITEM_ORDER 번호, 물건이면 100+물건 번호 · 감춘 스냅샷에선 -1) / 뒤졌나 */
  contents: number[];
  searched: boolean[];
  ground: GroundItem[];
  gid: number;
  need: number;
  burned: number;
  /** 원귀가 빼앗은 혼 (빙의 횟수) / 이기려면 */
  souls: number;
  soulsNeed: number;
  /** 퇴마 의식 진행 0~100 (-1 = 아직) */
  ritual: number;
  lanterns: boolean[];
  events: GameEvent[];
  eid: number;
  lastMinute: boolean;
  outcome: Outcome | null;
  ranks: number[] | null;
  /** 비밀(원귀 위치·수납 내용물)이 들어 있나 — 다른 기기로 보낸 스냅샷이면 false */
  secret: boolean;
}

/** 퇴마사 기기가 10번/초 보내는 내 몸 (원귀는 판정 기기 안에서 같은 꼴로 넣는다) */
export interface PosReport {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  light: boolean;
  use: string | null;
}

export type PlayerAct = { k: "water"; yaw: number; pitch: number } | { k: "tea" } | { k: "power"; p: PowerKind };

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

export function pushEvent(s: MatchState, k: EventKind, e: Omit<GameEvent, "id" | "at" | "k"> = {}) {
  s.events.push({ id: ++s.eid, at: s.t, k, ...e });
}

const emptyHunter = (): HunterStats => ({ searches: 0, cursesFound: 0, burned: 0, revives: 0, possessed: 0, waters: 0, waterHits: 0, teas: 0, lanterns: 0, panics: 0, ritualSec: 0 });
const emptyGhost = (): GhostStats => ({ whispers: 0, slams: 0, snuffs: 0, manifests: 0, possessions: 0, quenches: 0, hits: 0 });

export const CURSE_BASE = 100;
export const isCurse = (v: number) => v >= CURSE_BASE;

export function hunters(s: MatchState): PlayerState[] {
  return s.players.filter((p) => p.role === "hunter");
}

export function standing(s: MatchState): PlayerState[] {
  return s.players.filter((p) => p.role === "hunter" && p.st === "alive");
}

/** 이 퇴마사의 손전등이 지금 켜져 있나 */
export function lightOn(s: MatchState, p: PlayerState): boolean {
  return p.role === "hunter" && p.st === "alive" && p.light && p.battery > 0 && s.t >= p.lightOffUntil;
}

/** 방이 밝은가 (등잔이 켜졌나) */
export function roomLit(s: MatchState, room: string): boolean {
  const i = lanternOf(room);
  return i >= 0 && !!s.lanterns[i];
}

/** 6m 안에 서 있는 동료가 있나 */
export function hasBuddy(s: MatchState, p: PlayerState): boolean {
  for (const q of s.players) if (q !== p && q.role === "hunter" && q.st === "alive" && Math.hypot(q.x - p.x, q.z - p.z) <= BUDDY_R) return true;
  return false;
}

export function ghostDist(s: MatchState, p: { x: number; z: number }): number {
  return Math.hypot(s.ghost.x - p.x, s.ghost.z - p.z);
}

/** 시선 방향(yaw)과 (x,z) 방향 사이 각 */
export function angleTo(p: { x: number; z: number; yaw: number }, x: number, z: number): number {
  const want = Math.atan2(-(x - p.x), -(z - p.z));
  let d = want - p.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** 원귀가 지금 힘을 쓸 수 있나 (기력·대기 시간 빼고) */
export function ghostFree(s: MatchState): boolean {
  return s.phase === "play" && s.t >= GRACE_MS && s.t >= s.ghost.stunUntil;
}

/** 원귀가 이 힘을 지금 쓸 수 있나 + 대상 */
export function powerCheck(s: MatchState, k: PowerKind): { ok: boolean; target?: number; why?: string } {
  const g = s.ghost;
  const info = POWERS[k];
  if (s.phase !== "play") return { ok: false, why: "끝났다" };
  if (s.t < GRACE_MS) return { ok: false, why: "아직 힘이 모이지 않았다" };
  if (s.t < g.stunUntil) return { ok: false, why: "성수에 묶여 있다" };
  if (s.t < g.ready[k]) return { ok: false, why: `${Math.ceil((g.ready[k] - s.t) / 1000)}초 뒤에` };
  if (g.energy < info.cost) return { ok: false, why: `원한이 모자라다 (${info.cost})` };
  const alive = standing(s);
  if (k === "whisper") {
    let best = -1;
    let bd = WHISPER_R;
    for (const p of alive) {
      const d = ghostDist(s, p);
      if (d <= bd) {
        bd = d;
        best = p.seat;
      }
    }
    return best >= 0 ? { ok: true, target: best } : { ok: false, why: `${WHISPER_R}m 안에 아무도 없다` };
  }
  if (k === "slam") {
    const o = slamTarget(s);
    return o ? { ok: true, target: o.id } : { ok: false, why: `${SLAM_R}m 안에 덜컹거릴 장롱·문이 없다` };
  }
  if (k === "snuff") {
    const room = roomAt(g.x, g.z);
    const lit = roomLit(s, room);
    const near = alive.some((p) => ghostDist(s, p) <= SNUFF_R && lightOn(s, p));
    return lit || near ? { ok: true } : { ok: false, why: "꺼뜨릴 등잔도 손전등도 없다" };
  }
  if (k === "manifest") return { ok: true };
  if (k === "possess") {
    const t = possessTarget(s);
    return t >= 0 ? { ok: true, target: t } : { ok: false, why: "씔 사람이 없다 — 2.2m 안, 공포 75↑, 혼자(공황이면 상관없음)" };
  }
  if (k === "quench") {
    if (s.ritual < 0) return { ok: false, why: "아직 의식이 시작되지 않았다" };
    return Math.hypot(g.x - BRAZIER.x, g.z - BRAZIER.z) <= QUENCH_R ? { ok: true } : { ok: false, why: `화로 ${QUENCH_R}m 안으로` };
  }
  return { ok: false };
}

/** 원귀 곁에 있는 덜컹 대상: 수납(가구 번호) 또는 문(1000+칸) */
export function slamTarget(s: MatchState): { id: number; x: number; z: number } | null {
  const g = s.ghost;
  let best: { id: number; x: number; z: number } | null = null;
  let bd = SLAM_R;
  for (let i = 0; i < FURNITURE.length; i++) {
    const f = FURNITURE[i];
    const d = Math.hypot(f.x - g.x, f.z - g.z);
    if (d <= bd) {
      bd = d;
      best = { id: i, x: f.x, z: f.z };
    }
  }
  for (const cell of DOOR_CELLS) {
    const c = centerOf(cell);
    const d = Math.hypot(c.x - g.x, c.z - g.z);
    if (d <= bd) {
      bd = d;
      best = { id: 1000 + cell, x: c.x, z: c.z };
    }
  }
  return best;
}

/** 빙의할 수 있는 사람 (가장 가까운) */
export function possessTarget(s: MatchState): number {
  let best = -1;
  let bd = POSSESS_R;
  for (const p of standing(s)) {
    if (s.t < p.safeUntil) continue;
    const d = ghostDist(s, p);
    if (d > bd) continue;
    if (!canBePossessed(s, p)) continue;
    bd = d;
    best = p.seat;
  }
  return best;
}

export function canBePossessed(s: MatchState, p: PlayerState): boolean {
  if (p.st !== "alive" || s.t < p.safeUntil) return false;
  if (p.panic) return true;
  return p.fear >= POSSESS_FEAR && !hasBuddy(s, p);
}

/* ── 판 만들기 ──────────────────────────────────────────────────────── */

function shuffle<T>(s: MatchState, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 수납에 물건 나눠 담기 — `curses`개의 저주받은 물건(번호 `ids`)과 쓸 것들을, 안 뒤진 곳에만 */
function dealContents(s: MatchState, ids: number[], hunterCount: number) {
  const open = shuffle(
    s,
    CONTAINERS.filter((c) => !s.searched[c.i]).map((c) => c.i),
  );
  for (const ci of open) s.contents[ci] = 0;
  // 물건은 되도록 서로 다른 방에
  const usedRooms = new Set<string>();
  const curseAt: number[] = [];
  for (const ci of open) {
    if (curseAt.length >= ids.length) break;
    const room = CONTAINERS[ci].room;
    if (usedRooms.has(room)) continue;
    usedRooms.add(room);
    curseAt.push(ci);
  }
  for (const ci of open) {
    if (curseAt.length >= ids.length) break;
    if (!curseAt.includes(ci)) curseAt.push(ci);
  }
  curseAt.forEach((ci, k) => (s.contents[ci] = CURSE_BASE + ids[k]));
  const rest = open.filter((ci) => !curseAt.includes(ci));
  const loot: ItemKind[] = [...Array<ItemKind>(hunterCount + 1).fill("water"), ...Array<ItemKind>(hunterCount).fill("tea"), ...Array<ItemKind>(2 + Math.ceil(hunterCount / 2)).fill("battery")];
  rest.forEach((ci, k) => {
    s.contents[ci] = k < loot.length ? ITEM_ORDER.indexOf(loot[k]) : 0;
  });
}

/** 원귀가 나타날 자리: 퇴마사 모두에게서 길로 멀리 */
function ghostSpawn(s: MatchState): { x: number; z: number } {
  const hs = s.players.filter((p) => p.role === "hunter");
  let cand = WALKABLE.filter((cell) => {
    const c = centerOf(cell);
    if (Math.hypot(c.x - BRAZIER.x, c.z - BRAZIER.z) < WARD_R + 2) return false;
    return hs.every((p) => pathDist(c.x, c.z, p.x, p.z) >= GHOST_SPAWN_MIN);
  });
  if (!cand.length) cand = WALKABLE.filter((cell) => Math.hypot(centerOf(cell).x - BRAZIER.x, centerOf(cell).z - BRAZIER.z) > WARD_R + 2);
  const c = centerOf(cand[Math.floor(rand(s) * cand.length)]);
  return { x: c.x, z: c.z };
}

export function createMatch(seed: number, seats: { bot: boolean; level: number }[], ghostSeat: number, options?: Partial<GameOptions>): MatchState {
  const opts = sanitizeOptions(options);
  const info = DIFFICULTY_INFO[opts.difficulty];
  const n = Math.max(3, Math.min(6, seats.length));
  const gs = clamp(Math.round(ghostSeat), 0, n - 1);
  const hunterCount = n - 1;
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: n,
    ghostSeat: gs,
    options: opts,
    phase: "play",
    players: [],
    ghost: { x: 0, z: 0, yaw: 0, pitch: 0, energy: 30, ready: { whisper: 0, slam: 0, snuff: 0, manifest: 0, possess: 0, quench: 0 }, stunUntil: 0, revealUntil: 0, manifestUntil: 0, moving: false },
    ghostVis: 0,
    contents: CONTAINERS.map(() => 0),
    searched: CONTAINERS.map(() => false),
    ground: [],
    gid: 0,
    need: cursesFor(hunterCount),
    burned: 0,
    souls: 0,
    soulsNeed: soulsFor(hunterCount),
    ritual: -1,
    lanterns: LANTERNS.map(() => false),
    events: [],
    eid: 0,
    lastMinute: false,
    outcome: null,
    ranks: null,
    secret: true,
  };
  for (let i = 0; i < 8; i++) rand(s);

  // 저주받은 물건 번호 (이름표) — 8가지 중 need개
  const names = shuffle(s, [0, 1, 2, 3, 4, 5, 6, 7]).slice(0, s.need);
  dealContents(s, names, hunterCount);

  let hi = 0;
  s.players = Array.from({ length: n }, (_, seat): PlayerState => {
    const role: Role = seat === gs ? "ghost" : "hunter";
    const c = role === "hunter" ? centerOf(START_CELLS[hi++ % START_CELLS.length]) : { x: 0, z: 0 };
    return {
      seat,
      bot: !!seats[seat]?.bot,
      level: clamp(Math.round(seats[seat]?.level ?? 5), 1, 10),
      away: false,
      role,
      x: c.x,
      z: c.z,
      yaw: 0,
      pitch: 0,
      mv: 0,
      light: role === "hunter",
      st: "alive",
      fear: 0,
      panic: false,
      battery: 100,
      water: role === "hunter" ? info.water + (hunterCount === 1 ? 1 : 0) : 0,
      tea: role === "hunter" && hunterCount === 1 ? 1 : 0,
      carry: [],
      lightOffUntil: 0,
      use: null,
      useMs: 0,
      downAt: 0,
      safeUntil: 0,
      emf: 0,
      hunter: emptyHunter(),
      ghost: emptyGhost(),
    };
  });
  const sp = ghostSpawn(s);
  s.ghost.x = sp.x;
  s.ghost.z = sp.z;
  s.ghost.yaw = Math.atan2(-(BRAZIER.x - sp.x), -(BRAZIER.z - sp.z));
  return s;
}

/**
 * 비밀이 지워진 스냅샷으로 판정을 이어받을 때: 원귀 자리와 남은 물건 자리를 새로 정한다
 * (다른 기기는 그 둘을 모르니, 새로 정해도 아무도 손해 보지 않는다).
 */
export function rebuildSecrets(s: MatchState) {
  if (s.secret) return;
  const held = s.players.reduce((n, p) => n + p.carry.length, 0);
  const known = new Set<number>();
  for (const p of s.players) for (const c of p.carry) known.add(c);
  for (const g of s.ground) known.add(g.curse);
  for (const ci of CONTAINERS.map((c) => c.i)) if (s.searched[ci] && isCurse(s.contents[ci])) known.add(s.contents[ci] - CURSE_BASE);
  const left = Math.max(0, s.need - s.burned - held - s.ground.length);
  const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !known.has(i));
  dealContents(s, shuffle(s, free).slice(0, left), s.seatCount - 1);
  const sp = ghostSpawn(s);
  s.ghost.x = sp.x;
  s.ghost.z = sp.z;
  s.secret = true;
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

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function applyReport(rt: HostRuntime, seat: number, rep: PosReport | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !rep || p.bot || p.away || s.phase !== "play") return;
  if (p.role === "ghost") {
    const g = s.ghost;
    g.yaw = num(rep.yaw, g.yaw);
    g.pitch = clamp(num(rep.pitch, g.pitch), -1.4, 1.4);
    if (s.t < g.stunUntil) return;
    const pos = { x: num(rep.x, g.x), z: num(rep.z, g.z) };
    clampGhost(pos, WARD_R);
    g.moving = Math.hypot(pos.x - g.x, pos.z - g.z) > 0.01;
    g.x = pos.x;
    g.z = pos.z;
    return;
  }
  p.yaw = num(rep.yaw, p.yaw);
  p.pitch = clamp(num(rep.pitch, p.pitch), -1.4, 1.4);
  if (p.st !== "alive") return;
  const pos = { x: num(rep.x, p.x), z: num(rep.z, p.z) };
  collide(pos);
  p.x = pos.x;
  p.z = pos.z;
  const mv = Math.round(num(rep.mv));
  p.mv = (mv === 2 || (mv === 3 && !p.panic) ? mv : 0) as MoveMode;
  p.light = !!rep.light && p.battery > 0;
  const use = typeof rep.use === "string" && rep.use.length <= 4 ? rep.use : null;
  if (use !== p.use) {
    p.use = use;
    p.useMs = 0;
  }
}

function addFear(s: MatchState, p: PlayerState, v: number) {
  if (p.st !== "alive") return;
  p.fear = clamp(p.fear + v * DIFFICULTY_INFO[s.options.difficulty].fear, 0, 100);
}

export function applyAct(rt: HostRuntime, seat: number, act: PlayerAct | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !act || s.phase !== "play") return;
  if (act.k === "power") {
    if (p.role !== "ghost") return;
    castPower(s, act.p);
    return;
  }
  if (p.role !== "hunter" || p.st !== "alive") return;
  if (act.k === "tea") {
    if (p.tea <= 0) return;
    p.tea--;
    p.hunter.teas++;
    p.fear = Math.max(0, p.fear - TEA_CALM);
    pushEvent(s, "tea", { seat });
    return;
  }
  if (act.k === "water") {
    if (p.water <= 0) return;
    p.water--;
    p.hunter.waters++;
    const yaw = num(act.yaw, p.yaw);
    const g = s.ghost;
    const d = Math.hypot(g.x - p.x, g.z - p.z);
    const hit = d <= WATER_R && (d < 0.8 || angleTo({ x: p.x, z: p.z, yaw }, g.x, g.z) <= WATER_CONE + Math.atan2(0.4, Math.max(0.3, d))) && clearLine(p.x, p.z, g.x, g.z);
    pushEvent(s, "water", { seat, x: p.x - Math.sin(yaw) * 2, z: p.z - Math.cos(yaw) * 2, n: hit ? 1 : 0 });
    if (hit) {
      g.stunUntil = Math.max(g.stunUntil, s.t + WATER_STUN_MS);
      g.revealUntil = Math.max(g.revealUntil, s.t + WATER_REVEAL_MS);
      g.energy = Math.max(0, g.energy - WATER_DRAIN);
      p.hunter.waterHits++;
      const gp = s.players[s.ghostSeat];
      if (gp) gp.ghost.hits++;
      pushEvent(s, "ghostHit", { seat, x: g.x, z: g.z });
    }
  }
}

/* ── 원귀의 힘 ──────────────────────────────────────────────────────── */

export function castPower(s: MatchState, k: PowerKind): boolean {
  const chk = powerCheck(s, k);
  const gp = s.players[s.ghostSeat];
  const g = s.ghost;
  if (!chk.ok || !gp) {
    if (gp) pushEvent(s, "fail", { to: s.ghostSeat, n: Math.max(0, ["whisper", "slam", "snuff", "manifest", "possess", "quench"].indexOf(k)) });
    return false;
  }
  const info = POWERS[k];
  g.energy -= info.cost;
  g.ready[k] = s.t + info.cdMs;
  const alive = standing(s);
  if (k === "whisper") {
    const p = s.players[chk.target ?? -1];
    if (!p) return false;
    addFear(s, p, hasBuddy(s, p) || s.seatCount <= 2 ? WHISPER_FEAR : WHISPER_FEAR_ALONE);
    gp.ghost.whispers++;
    // 속삭임은 그 사람에게만 들린다 — 들리는 쪽(대략)만 알려 준다
    pushEvent(s, "whisper", { to: p.seat, seat: p.seat, x: g.x + (rand(s) - 0.5) * 1.6, z: g.z + (rand(s) - 0.5) * 1.6 });
  } else if (k === "slam") {
    const o = slamTarget(s);
    if (!o) return false;
    for (const p of alive) {
      if (Math.hypot(p.x - o.x, p.z - o.z) > SLAM_HEAR_R) continue;
      addFear(s, p, hasBuddy(s, p) || s.seatCount <= 2 ? SLAM_FEAR : SLAM_FEAR_ALONE);
    }
    // 그 수납을 뒤지던 사람은 처음부터 다시
    const f = o.id < 1000 ? FURNITURE[o.id] : null;
    if (f && f.container >= 0) for (const p of alive) if (p.use === `c${f.container}`) p.useMs = 0;
    gp.ghost.slams++;
    pushEvent(s, "slam", { x: o.x, z: o.z, n: o.id });
  } else if (k === "snuff") {
    const room = roomAt(g.x, g.z);
    const li = lanternOf(room);
    if (li >= 0 && s.lanterns[li]) {
      s.lanterns[li] = false;
      pushEvent(s, "snuff", { n: li, x: LANTERNS[li].x, z: LANTERNS[li].z });
    } else pushEvent(s, "snuff", { n: -1 });
    for (const p of alive) {
      if (ghostDist(s, p) > SNUFF_R) continue;
      p.lightOffUntil = s.t + SNUFF_MS;
      addFear(s, p, SNUFF_FEAR);
      pushEvent(s, "snuff", { n: -2, to: p.seat, seat: p.seat });
    }
    gp.ghost.snuffs++;
  } else if (k === "manifest") {
    g.manifestUntil = s.t + MANIFEST_MS;
    for (const p of alive) {
      const d = ghostDist(s, p);
      if (d > MANIFEST_R || !clearLine(p.x, p.z, g.x, g.z)) continue;
      const looking = angleTo(p, g.x, g.z) <= MANIFEST_CONE;
      addFear(s, p, looking ? MANIFEST_FEAR : MANIFEST_FEAR_SIDE);
    }
    gp.ghost.manifests++;
    pushEvent(s, "manifest", { x: g.x, z: g.z });
  } else if (k === "possess") {
    const p = s.players[chk.target ?? -1];
    if (!p) return false;
    possess(s, p);
    gp.ghost.possessions++;
  } else if (k === "quench") {
    s.ritual = Math.max(0, s.ritual - QUENCH_LOSS);
    gp.ghost.quenches++;
    pushEvent(s, "quench", { x: g.x, z: g.z, n: Math.round(s.ritual) });
  }
  return true;
}

function possess(s: MatchState, p: PlayerState) {
  p.st = "possessed";
  p.downAt = s.t;
  p.use = null;
  p.useMs = 0;
  p.light = false;
  p.mv = 0;
  p.panic = false;
  p.hunter.possessed++;
  s.souls++;
  // 들고 있던 물건은 그 자리에 떨어진다
  for (const c of p.carry) {
    const a = rand(s) * Math.PI * 2;
    const pos = { x: p.x + Math.cos(a) * 0.6, z: p.z + Math.sin(a) * 0.6 };
    collide(pos, 0.2);
    s.ground.push({ id: ++s.gid, curse: c, x: pos.x, z: pos.z });
    pushEvent(s, "drop", { seat: p.seat, x: pos.x, z: pos.z, n: c });
  }
  p.carry = [];
  pushEvent(s, "possess", { seat: p.seat, x: p.x, z: p.z });
}

/* ── 퇴마사 ─────────────────────────────────────────────────────────── */

function giveItem(s: MatchState, p: PlayerState, ci: number): boolean {
  const v = s.contents[ci];
  if (isCurse(v)) {
    if (p.carry.length >= MAX_CARRY) return false;
    p.carry.push(v - CURSE_BASE);
    p.hunter.cursesFound++;
    return true;
  }
  const kind = ITEM_ORDER[v] ?? "empty";
  if (kind === "water") {
    if (p.water >= MAX_WATER) return false;
    p.water++;
  } else if (kind === "tea") {
    if (p.tea >= MAX_TEA) return false;
    p.tea++;
  } else if (kind === "battery") p.battery = Math.min(100, p.battery + BATTERY_PACK);
  return true;
}

function holdStep(s: MatchState, p: PlayerState, dtMs: number) {
  const u = p.use;
  if (!u) {
    p.useMs = 0;
    return;
  }
  const kind = u[0];
  const id = Number(u.slice(1));
  let ok = false;
  let need = SEARCH_MS;
  if (kind === "c") {
    const f = FURNITURE.find((it) => it.container === id);
    ok = !!f && !s.searched[id] && Math.hypot(p.x - f.x, p.z - f.z) <= USE_RANGE + 0.9;
  } else if (kind === "b") {
    ok = p.carry.length > 0 && Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z) <= BURN_R + 0.5;
    need = BURN_MS;
  } else if (kind === "l") {
    const l = LANTERNS[id];
    ok = !!l && !s.lanterns[id] && Math.hypot(p.x - l.x, p.z - l.z) <= USE_RANGE + 0.5;
    need = LANTERN_MS;
  } else if (kind === "r") {
    const q = s.players[id];
    ok = !!q && q !== p && q.role === "hunter" && q.st === "possessed" && Math.hypot(p.x - q.x, p.z - q.z) <= REVIVE_RANGE + 0.4;
    need = REVIVE_MS;
  } else if (kind === "g") {
    const gi = s.ground.find((it) => it.id === id);
    ok = !!gi && p.carry.length < MAX_CARRY && Math.hypot(p.x - gi.x, p.z - gi.z) <= USE_RANGE;
    need = PICK_MS;
  }
  if (!ok) {
    p.use = p.bot || p.away ? null : p.use;
    p.useMs = 0;
    return;
  }
  p.useMs += dtMs;
  if (p.useMs < need) return;
  p.useMs = 0;
  if (kind === "c") {
    if (!giveItem(s, p, id)) {
      pushEvent(s, "full", { seat: p.seat, n: s.contents[id], to: p.seat });
      p.use = null;
      return;
    }
    s.searched[id] = true;
    p.hunter.searches++;
    pushEvent(s, "found", { seat: p.seat, n: s.contents[id], x: id });
    p.use = null;
  } else if (kind === "b") {
    const c = p.carry.shift() as number;
    s.burned++;
    p.hunter.burned++;
    pushEvent(s, "burn", { seat: p.seat, n: c, x: s.burned });
    if (s.burned >= s.need && s.ritual < 0) {
      s.ritual = 0;
      pushEvent(s, "ritualStart");
    }
    if (p.carry.length === 0) p.use = null;
  } else if (kind === "l") {
    s.lanterns[id] = true;
    p.hunter.lanterns++;
    pushEvent(s, "lantern", { seat: p.seat, n: id, x: LANTERNS[id].x, z: LANTERNS[id].z });
    p.use = null;
  } else if (kind === "r") {
    const q = s.players[id];
    q.st = "alive";
    q.mv = 0;
    q.safeUntil = s.t + SAFE_MS;
    q.fear = REVIVED_FEAR;
    q.light = q.battery > 0;
    p.hunter.revives++;
    pushEvent(s, "revive", { seat: q.seat, n: p.seat });
    p.use = null;
  } else if (kind === "g") {
    const gi = s.ground.find((it) => it.id === id);
    if (gi) {
      s.ground = s.ground.filter((it) => it !== gi);
      p.carry.push(gi.curse);
      pushEvent(s, "pick", { seat: p.seat, n: gi.curse });
    }
    p.use = null;
  }
}

function fearStep(s: MatchState, p: PlayerState, dt: number) {
  const room = roomAt(p.x, p.z);
  const buddy = hasBuddy(s, p);
  let up = 0;
  let down = 0;
  if (buddy) down += -FEAR_TOGETHER;
  else up += FEAR_ALONE * (s.seatCount <= 2 ? SOLO_ALONE_MUL : 1);
  if (roomLit(s, room)) down += -FEAR_LIT;
  else if (room === "m") down += -FEAR_COURTYARD;
  else {
    up += FEAR_DARK;
    if (!lightOn(s, p)) up += FEAR_NO_LIGHT;
  }
  if (p.carry.length > 0) up += FEAR_CARRY;
  if (s.t >= GRACE_MS && ghostDist(s, p) <= CHILL_R) up += FEAR_CHILL;
  const k = DIFFICULTY_INFO[s.options.difficulty].fear;
  p.fear = clamp(p.fear + (up * k - down) * dt, 0, 100);
}

function hunterStep(s: MatchState, p: PlayerState, dtMs: number) {
  const dt = dtMs / 1000;
  if (p.st === "possessed") {
    if (s.t - p.downAt >= selfWakeMs(s.seatCount - 1)) {
      p.st = "alive";
      p.safeUntil = s.t + SAFE_MS;
      p.fear = REVIVED_FEAR;
      p.light = p.battery > 0;
      pushEvent(s, "revive", { seat: p.seat, n: -1 });
    }
    return;
  }
  if (p.st !== "alive") return;
  if (lightOn(s, p)) {
    p.battery = Math.max(0, p.battery - (100 / BATTERY_SEC) * dt);
    if (p.battery <= 0) p.light = false;
  }
  fearStep(s, p, dt);
  if (!p.panic && p.fear >= PANIC_FEAR) {
    p.panic = true;
    p.hunter.panics++;
    s.ghost.energy = Math.min(ENERGY_MAX, s.ghost.energy + ENERGY_PANIC_BONUS);
    pushEvent(s, "panic", { seat: p.seat });
  } else if (p.panic && p.fear <= PANIC_CLEAR) {
    p.panic = false;
    pushEvent(s, "calm", { seat: p.seat });
  }
  if (p.panic && p.mv === 3) p.mv = 2;
  holdStep(s, p, dtMs);
  p.emf = s.t >= GRACE_MS ? emfLevel(ghostDist(s, p)) : 0;
}

/** 원귀가 지금 보이나 (화면·봇·스냅샷 공용) */
function visStep(s: MatchState) {
  const g = s.ghost;
  if (s.t < g.manifestUntil || s.t < g.revealUntil) {
    s.ghostVis = 2;
    return;
  }
  const lit = roomLit(s, roomAt(g.x, g.z));
  for (const p of standing(s)) {
    const d = ghostDist(s, p);
    if (d > Math.max(SHIMMER_LIT_R, SHIMMER_BEAM_R)) continue;
    if (!clearLine(p.x, p.z, g.x, g.z)) continue;
    if (lit && d <= SHIMMER_LIT_R) {
      s.ghostVis = 1;
      return;
    }
    if (lightOn(s, p) && d <= SHIMMER_BEAM_R && angleTo(p, g.x, g.z) <= Math.max(SHIMMER_CONE, LIGHT_CONE * 0.9)) {
      s.ghostVis = 1;
      return;
    }
  }
  s.ghostVis = 0;
}

function finish(s: MatchState, winner: Role, why: Outcome["why"]) {
  s.outcome = { winner, why, tMs: s.t, burned: s.burned, standing: standing(s).length };
  s.ranks = s.players.map((p) => (p.role === winner ? 1 : 2));
  s.phase = "gameOver";
  pushEvent(s, "over", { n: winner === "hunter" ? 1 : 0 });
}

function tick(rt: HostRuntime) {
  const s = rt.state;
  if (s.phase !== "play") return;
  const wasGrace = s.t < GRACE_MS;
  s.t += TICK_MS;
  const dt = TICK_MS / 1000;
  if (wasGrace && s.t >= GRACE_MS) pushEvent(s, "awaken");

  if (rt.think) for (const p of s.players) if ((p.bot || p.away) && (p.role === "ghost" || p.st === "alive")) rt.think(rt, p.seat, TICK_MS);

  const g = s.ghost;
  g.energy = Math.min(ENERGY_MAX, g.energy + ENERGY_REGEN * DIFFICULTY_INFO[s.options.difficulty].energy * energyScale(s.seatCount - 1) * dt);
  clampGhost(g, WARD_R);
  for (const p of s.players) if (p.role === "hunter") hunterStep(s, p, TICK_MS);

  if (s.ritual >= 0) {
    const n = standing(s).filter((p) => Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z) <= RITUAL_R);
    s.ritual = Math.min(100, s.ritual + ritualRate(n.length) * dt);
    for (const p of n) p.hunter.ritualSec += dt;
  }
  visStep(s);

  if (!s.lastMinute && s.t >= TIME_LIMIT_MS - 60_000) {
    s.lastMinute = true;
    pushEvent(s, "lastMinute");
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 6000) s.events = s.events.filter((e) => e.at >= s.t - 6000);

  if (s.ritual >= 100) {
    pushEvent(s, "ritualDone");
    finish(s, "hunter", "ritual");
  } else if (s.souls >= s.soulsNeed) finish(s, "ghost", "souls");
  else if (standing(s).length === 0 && s.seatCount > 2) finish(s, "ghost", "allPossessed");
  else if (s.t >= TIME_LIMIT_MS) finish(s, "ghost", "dawn");
}

/** 판정 루프: 지난 시간만큼 고정 틱으로 */
export function hostStep(rt: HostRuntime, dtMs: number) {
  rt.acc += Math.min(500, dtMs);
  while (rt.acc >= TICK_MS) {
    rt.acc -= TICK_MS;
    tick(rt);
  }
}

export { BRAZIER };
