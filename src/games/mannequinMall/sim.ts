import {
  BATTERY_PACK,
  BATTERY_SEC,
  BIND_HOLD_MS,
  BIND_MS,
  BIND_RANGE,
  BLEED_MS,
  DARK_CONE,
  DARK_RANGE,
  DIFFICULTY_INFO,
  EXIT_RANGE,
  EYE,
  FLASH_CONE,
  FLASH_RANGE,
  FLASH_STUN_MS,
  FLICKER_AFTER_FUSE_MS,
  FLICKER_FIRST_MS,
  FLICKER_GAP_MIN_MS,
  FLICKER_GAP_MS,
  FLICKER_MS,
  FLICKER_WARN_MS,
  GRAB_R,
  GRACE_MS,
  LIGHT_CONE,
  LIGHT_RANGE,
  MANNEQUIN_EYE_Y,
  MAX_CAMERAS,
  MAX_RIBBONS,
  MQ_DARK_MUL,
  MQ_RAGE_SPEED,
  MQ_REST_MS,
  MQ_SEP,
  MQ_SPEED,
  NIGHTMARE_CONE,
  PLACE_MS,
  POSES,
  REVEAL_MS,
  REVIVE_MS,
  REVIVE_RANGE,
  MQ_FAR,
  MQ_FAR_SPEED,
  SEARCH_MS,
  STARE_DECAY,
  STARE_MS,
  STARE_RANGE,
  STARE_TOUGHEN,
  TOPPLE_MS,
  TICK_MS,
  TIME_LIMIT_MS,
  USE_RANGE,
  WAKE_MIN_DIST,
  awakeAtStart,
  fusesFor,
  gradeOf,
  sanitizeOptions,
  type GameOptions,
  type Grade,
  type ItemKind,
  type MoveMode,
} from "./data";
import { CONTAINERS, EXIT, MANNEQUIN_CELLS, PANEL, START_CELLS, centerOf, clearLine, collide, nextCell, pathDist, walkCellAt } from "./map";

/**
 * 마네킹 백화점 — 방장 기기가 돌리는 판정 (룰북 §3~§9).
 *
 * 사람의 **몸(위치·시선)은 각자 기기가** 움직여 `PosReport`로 알리고(협동 게임이라 믿는다), 방장은 그 시선으로
 * "누가 어느 마네킹을 보고 있나"를 매 틱 판정한다. 아무도 안 보는 살아 있는 마네킹만 가장 가까운 사람에게
 * 다가간다. 봇과 자리를 비운 사람의 몸은 방장이 `think`(bot.ts)로 움직인다.
 * `MatchState`는 순수 JSON이라 스냅샷 하나로 방장을 넘길 수 있다.
 */

export const ITEM_ORDER: ItemKind[] = ["empty", "fuse", "battery", "camera", "ribbon"];

export interface PlayerStats {
  searches: number;
  fuseFound: number;
  fusePlaced: number;
  revives: number;
  downs: number;
  flashes: number;
  /** 플래시로 정체를 드러낸 마네킹 수 */
  revealed: number;
  binds: number;
  /** 묶어 봤더니 그냥 마네킹 */
  decoys: number;
  /** 살아 있는 마네킹을 붙들어 둔 시간(초) — 보고 있지 않았다면 움직였을 것 */
  stareSec: number;
  /** 동료 3m 안까지 온 마네킹을 내 눈으로 멈춘 횟수 */
  saves: number;
  /** 노려봐서 쓰러뜨린 마네킹 (함께 비춘 사람 모두) */
  topples: number;
}

export type PlayerSt = "alive" | "down" | "dead" | "escaped";

export interface PlayerState {
  seat: number;
  bot: boolean;
  level: number;
  away: boolean;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  light: boolean;
  st: PlayerSt;
  battery: number;
  fuses: number;
  cameras: number;
  ribbons: number;
  /** 누르고 있는 대상: c12 상자 · p 배전반 · r2 동료 풀어 주기 · m5 마네킹 묶기 */
  use: string | null;
  useMs: number;
  downAt: number;
  /** 풀려난 직후 잠깐 안전 */
  safeUntil: number;
  stats: PlayerStats;
}

export interface Mannequin {
  id: number;
  x: number;
  z: number;
  yaw: number;
  /** 살아 있나 (겉으로는 안 보인다) */
  awake: boolean;
  pose: number;
  /** 이번 틱에 움직였나 (삐걱 소리·화면) */
  moving: boolean;
  /** 마지막으로 굳은 뒤 처음 움직일 때 포즈를 바꾼다 */
  frozen: boolean;
  stunUntil: number;
  boundUntil: number;
  revealUntil: number;
  restUntil: number;
  /** 묶어 보거나 플래시로 비춰 "그냥 마네킹"으로 확인됐다 */
  checked: boolean;
  target: number;
  /** 노려보기 0~1 — 다 차면 쓰러진다 */
  stare: number;
  /** 쓰러져 있는 동안 */
  downUntil: number;
  /** 몇 번 쓰러졌나 (그만큼 더 버틴다) */
  topples: number;
}

export type EventKind =
  | "found"
  | "full"
  | "place"
  | "exitOpen"
  | "wake"
  | "flickerWarn"
  | "flickerOn"
  | "flickerOff"
  | "grab"
  | "revive"
  | "dead"
  | "escape"
  | "flash"
  | "bound"
  | "decoy"
  | "unbound"
  | "topple"
  | "rise"
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
  win: boolean;
  escaped: number;
  grade: Grade;
  tMs: number;
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
  mannequins: Mannequin[];
  /** 상자 내용물 (ITEM_ORDER 번호) / 뒤졌나 */
  contents: number[];
  searched: boolean[];
  need: number;
  placed: number;
  exitOpen: boolean;
  /** 깨어 있어야 할 마네킹 수 (깨어나기는 마네킹이 안 보일 때까지 미뤄질 수 있다) */
  awakeWant: number;
  flicker: { st: "idle" | "warn" | "dark"; at: number; until: number; count: number };
  events: GameEvent[];
  eid: number;
  lastMinute: boolean;
  outcome: Outcome | null;
  ranks: number[] | null;
}

/** 각자 기기가 10번/초 보내는 내 몸 */
export interface PosReport {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mv: MoveMode;
  light: boolean;
  use: string | null;
}

export type PlayerAct = { k: "flash"; yaw: number; pitch: number };

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

const between = (s: MatchState, [a, b]: [number, number]) => a + (b - a) * rand(s);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function pushEvent(s: MatchState, k: EventKind, e: Omit<GameEvent, "id" | "at" | "k"> = {}) {
  s.events.push({ id: ++s.eid, at: s.t, k, ...e });
}

const emptyStats = (): PlayerStats => ({ searches: 0, fuseFound: 0, fusePlaced: 0, revives: 0, downs: 0, flashes: 0, revealed: 0, binds: 0, decoys: 0, stareSec: 0, saves: 0, topples: 0 });

function turnToward(cur: number, want: number, max: number): number {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + clamp(d, -max, max);
}

/** 깨어 있을 수 있는 최대 수 */
export function awakeCap(s: MatchState): number {
  return (s.seatCount >= 3 ? 5 : 4) + (s.options.difficulty === "nightmare" ? 1 : 0);
}

/* ── 시선 ───────────────────────────────────────────────────────────── */

/** 지금 이 사람의 손전등이 켜져 있나 (정전 중엔 모두 꺼진다) */
export function lightOn(s: MatchState, p: PlayerState): boolean {
  return p.light && p.battery > 0 && s.flicker.st !== "dark";
}

/**
 * 이 사람이 (x, z)에 선 마네킹을 보고 있나. 시선 원뿔(위아래 포함) + 거리 + 벽·진열장 가림.
 * 가까울수록 몸이 시야를 많이 차지하므로 원뿔을 몸 폭만큼 넓혀 준다.
 */
export function sees(s: MatchState, p: PlayerState, x: number, z: number): boolean {
  if (p.st !== "alive" || s.flicker.st === "dark") return false;
  const lit = lightOn(s, p);
  const range = lit ? LIGHT_RANGE : DARK_RANGE;
  const dx = x - p.x;
  const dz = z - p.z;
  const flat = Math.hypot(dx, dz);
  if (flat > range) return false;
  const dy = MANNEQUIN_EYE_Y - EYE;
  const d = Math.hypot(flat, dy);
  if (d < 0.05) return true;
  const cp = Math.cos(p.pitch);
  const fx = -Math.sin(p.yaw) * cp;
  const fy = Math.sin(p.pitch);
  const fz = -Math.cos(p.yaw) * cp;
  const dot = (fx * dx + fy * dy + fz * dz) / d;
  const ang = Math.acos(clamp(dot, -1, 1));
  const base = lit ? (s.options.difficulty === "nightmare" ? NIGHTMARE_CONE : LIGHT_CONE) : DARK_CONE;
  if (ang > base + Math.atan2(0.36, d)) return false;
  return clearLine(p.x, p.z, x, z);
}

/** 누군가 이 마네킹을 보고 있나 */
export function watched(s: MatchState, m: Mannequin): boolean {
  for (const p of s.players) if (sees(s, p, m.x, m.z)) return true;
  return false;
}

/** 마네킹이 지금 멈춰 있는 까닭 없이 움직일 수 있나 (보는 사람 판정 전) */
export function canMove(s: MatchState, m: Mannequin): boolean {
  return m.awake && s.t >= m.stunUntil && s.t >= m.boundUntil && s.t >= m.restUntil && s.t >= m.downUntil;
}

/** 이 사람이 켠 손전등으로 마네킹을 정면으로 노려보고 있나 (응시가 차오르는 조건) */
export function glares(s: MatchState, p: PlayerState, m: Mannequin): boolean {
  return lightOn(s, p) && Math.hypot(m.x - p.x, m.z - p.z) <= STARE_RANGE && sees(s, p, m.x, m.z);
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
    mannequins: [],
    contents: CONTAINERS.map(() => 0),
    searched: CONTAINERS.map(() => false),
    need: fusesFor(n),
    placed: 0,
    exitOpen: false,
    awakeWant: 0,
    flicker: { st: "idle", at: 0, until: 0, count: 0 },
    events: [],
    eid: 0,
    lastMinute: false,
    outcome: null,
    ranks: null,
  };
  for (let i = 0; i < 8; i++) rand(s);

  // 상자 내용물: 퓨즈는 되도록 서로 다른 매장에
  const order = CONTAINERS.map((c) => c.i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const usedRooms = new Set<string>();
  const fuseAt: number[] = [];
  for (const ci of order) {
    if (fuseAt.length >= s.need) break;
    const room = CONTAINERS[ci].room;
    // 안내 데스크(배전반 바로 옆)에는 퓨즈를 두지 않는다
    if (usedRooms.has(room) || room === "e") continue;
    usedRooms.add(room);
    fuseAt.push(ci);
  }
  for (const ci of order) {
    if (fuseAt.length >= s.need) break;
    if (!fuseAt.includes(ci) && CONTAINERS[ci].room !== "e") fuseAt.push(ci);
  }
  for (const ci of fuseAt) s.contents[ci] = ITEM_ORDER.indexOf("fuse");
  const rest = order.filter((ci) => !fuseAt.includes(ci));
  const loot: ItemKind[] = [...Array<ItemKind>(Math.min(7, 3 + n)).fill("battery"), ...Array<ItemKind>(n >= 3 ? 4 : 3).fill("camera"), ...Array<ItemKind>(n >= 3 ? 4 : 3).fill("ribbon")];
  rest.forEach((ci, k) => {
    s.contents[ci] = k < loot.length ? ITEM_ORDER.indexOf(loot[k]) : 0;
  });

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
      light: true,
      st: "alive",
      battery: info.battery,
      fuses: 0,
      cameras: info.cameras + (n === 1 ? 1 : 0),
      ribbons: 0,
      use: null,
      useMs: 0,
      downAt: 0,
      safeUntil: 0,
      stats: emptyStats(),
    };
  });

  s.mannequins = MANNEQUIN_CELLS.map((cell, id): Mannequin => {
    const c = centerOf(cell);
    return {
      id,
      x: c.x + (rand(s) - 0.5) * 0.5,
      z: c.z + (rand(s) - 0.5) * 0.5,
      yaw: rand(s) * Math.PI * 2,
      awake: false,
      pose: Math.floor(rand(s) * POSES),
      moving: false,
      frozen: true,
      stunUntil: 0,
      boundUntil: 0,
      revealUntil: 0,
      restUntil: 0,
      checked: false,
      target: -1,
      stare: 0,
      downUntil: 0,
      topples: 0,
    };
  });
  s.awakeWant = awakeAtStart(n, opts.difficulty);
  s.flicker.at = between(s, FLICKER_FIRST_MS) * info.flickerGap;
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

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function applyReport(rt: HostRuntime, seat: number, rep: PosReport | null | undefined) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !rep || p.bot || p.away || s.phase !== "play") return;
  p.yaw = num(rep.yaw, p.yaw);
  p.pitch = clamp(num(rep.pitch, p.pitch), -1.4, 1.4);
  if (p.st !== "alive") return;
  const pos = { x: num(rep.x, p.x), z: num(rep.z, p.z) };
  collide(pos);
  p.x = pos.x;
  p.z = pos.z;
  const mv = Math.round(num(rep.mv));
  p.mv = (mv === 2 || mv === 3 ? mv : 0) as MoveMode;
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
  if (act.k === "flash") {
    if (p.cameras <= 0) return;
    p.cameras--;
    p.stats.flashes++;
    const yaw = num(act.yaw, p.yaw);
    const pitch = clamp(num(act.pitch, p.pitch), -1.4, 1.4);
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cp;
    let caught = 0;
    for (const m of s.mannequins) {
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      const dy = MANNEQUIN_EYE_Y - EYE;
      const d = Math.hypot(dx, dy, dz);
      if (d > FLASH_RANGE || d < 0.01) continue;
      const ang = Math.acos(clamp((fx * dx + fy * dy + fz * dz) / d, -1, 1));
      if (ang > FLASH_CONE + Math.atan2(0.36, d) || !clearLine(p.x, p.z, m.x, m.z)) continue;
      if (m.awake) {
        m.stunUntil = Math.max(m.stunUntil, s.t + FLASH_STUN_MS);
        m.revealUntil = Math.max(m.revealUntil, s.t + REVEAL_MS);
        caught++;
      } else m.checked = true;
    }
    p.stats.revealed += caught;
    pushEvent(s, "flash", { seat, x: p.x, z: p.z, n: caught });
  }
}

/* ── 마네킹 ─────────────────────────────────────────────────────────── */

function wakeOne(s: MatchState): boolean {
  const alive = s.players.filter((p) => p.st === "alive" || p.st === "down");
  const cand = s.mannequins.filter((m) => !m.awake && !watched(s, m) && alive.every((p) => pathDist(m.x, m.z, p.x, p.z) >= WAKE_MIN_DIST));
  if (!cand.length) return false;
  // 확인된 "그냥 마네킹"은 되도록 깨우지 않는다
  const fresh = cand.filter((m) => !m.checked);
  const pool = fresh.length ? fresh : cand;
  const m = pool[Math.floor(rand(s) * pool.length)];
  m.awake = true;
  m.frozen = true;
  m.restUntil = s.t + 600;
  pushEvent(s, "wake", { n: m.id });
  return true;
}

function grab(s: MatchState, m: Mannequin, p: PlayerState) {
  p.st = "down";
  p.downAt = s.t;
  p.use = null;
  p.useMs = 0;
  p.light = false;
  p.mv = 0;
  p.stats.downs++;
  m.restUntil = s.t + MQ_REST_MS;
  m.target = -1;
  m.moving = false;
  pushEvent(s, "grab", { seat: p.seat, x: p.x, z: p.z, n: m.id });
}

function mannequinStep(s: MatchState, dt: number) {
  const info = DIFFICULTY_INFO[s.options.difficulty];
  const speed = (MQ_SPEED + MQ_RAGE_SPEED * s.placed) * info.speed * (s.flicker.st === "dark" ? MQ_DARK_MUL : 1);
  const prey = s.players.filter((p) => p.st === "alive" && s.t >= p.safeUntil);
  for (const m of s.mannequins) {
    m.moving = false;
    if (m.downUntil > 0 && s.t >= m.downUntil && s.t - TICK_MS < m.downUntil) {
      m.frozen = true;
      m.stare = 0;
      pushEvent(s, "rise", { n: m.id, x: m.x, z: m.z });
    }
    if (!m.awake) continue;
    // 노려보기 (묶이거나 굳어 있어도 차오른다 — 쓰러져 있을 땐 멈춘다)
    if (s.t >= m.downUntil) {
      const glarers = s.players.filter((p) => glares(s, p, m));
      if (glarers.length) {
        m.stare += (dt * 1000 * Math.min(2, glarers.length)) / (STARE_MS * (1 + STARE_TOUGHEN * m.topples));
        if (m.stare >= 1) {
          m.stare = 0;
          m.topples++;
          m.downUntil = s.t + TOPPLE_MS;
          m.revealUntil = Math.max(m.revealUntil, s.t + TOPPLE_MS);
          m.moving = false;
          for (const p of glarers) p.stats.topples++;
          pushEvent(s, "topple", { n: m.id, x: m.x, z: m.z, seat: glarers[0].seat });
          continue;
        }
      } else m.stare = Math.max(0, m.stare - STARE_DECAY * dt);
    }
    if (!canMove(s, m)) continue;
    if (watched(s, m)) {
      m.frozen = true;
      continue;
    }
    if (!prey.length) continue;
    // 가장 가까운(걸어서) 사람
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const p of prey) {
      const d = pathDist(m.x, m.z, p.x, p.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) continue;
    m.target = best.seat;
    if (m.frozen) {
      // 다시 움직이기 시작할 때 포즈가 바뀐다 (돌아보면 자세가 달라져 있다)
      m.frozen = false;
      m.pose = (m.pose + 1 + Math.floor(rand(s) * (POSES - 1))) % POSES;
    }
    const here = walkCellAt(m.x, m.z);
    const tc = walkCellAt(best.x, best.z);
    let ax = best.x;
    let az = best.z;
    if (here !== tc) {
      const n = nextCell(here, tc);
      const c = centerOf(n);
      ax = c.x;
      az = c.z;
    }
    const dx = ax - m.x;
    const dz = az - m.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, (bd > MQ_FAR ? Math.min(speed, MQ_FAR_SPEED) : speed) * dt);
    if (d > 1e-4) {
      const pos = { x: m.x + (dx / d) * step, z: m.z + (dz / d) * step };
      // 다른 마네킹과 겹치지 않게
      for (const o of s.mannequins) {
        if (o === m) continue;
        const ox = pos.x - o.x;
        const oz = pos.z - o.z;
        const od = Math.hypot(ox, oz);
        if (od < MQ_SEP && od > 1e-4) {
          pos.x = o.x + (ox / od) * MQ_SEP;
          pos.z = o.z + (oz / od) * MQ_SEP;
        }
      }
      collide(pos, 0.28);
      m.x = pos.x;
      m.z = pos.z;
      m.yaw = turnToward(m.yaw, Math.atan2(-(best.x - m.x), -(best.z - m.z)), 9 * dt);
      m.moving = true;
    }
    if (Math.hypot(best.x - m.x, best.z - m.z) < GRAB_R) grab(s, m, best);
  }
}

/* ── 정전 ───────────────────────────────────────────────────────────── */

function flickerStep(s: MatchState) {
  const f = s.flicker;
  const info = DIFFICULTY_INFO[s.options.difficulty];
  if (f.st === "idle") {
    if (s.t < f.at) return;
    f.st = "warn";
    f.until = s.t + FLICKER_WARN_MS;
    pushEvent(s, "flickerWarn");
  } else if (f.st === "warn") {
    if (s.t < f.until) return;
    f.st = "dark";
    f.until = s.t + FLICKER_MS;
    f.count++;
    pushEvent(s, "flickerOn");
  } else {
    if (s.t < f.until) return;
    f.st = "idle";
    const gap = Math.max(FLICKER_GAP_MIN_MS, between(s, FLICKER_GAP_MS) - 3000 * s.placed);
    f.at = s.t + gap * info.flickerGap;
    pushEvent(s, "flickerOff");
  }
}

/* ── 사람 ───────────────────────────────────────────────────────────── */

function giveItem(s: MatchState, p: PlayerState, ci: number): boolean {
  const kind = ITEM_ORDER[s.contents[ci]] ?? "empty";
  if (kind === "camera" && p.cameras >= MAX_CAMERAS) return false;
  if (kind === "ribbon" && p.ribbons >= MAX_RIBBONS) return false;
  if (kind === "fuse") {
    p.fuses++;
    p.stats.fuseFound++;
  } else if (kind === "battery") p.battery = Math.min(100, p.battery + BATTERY_PACK);
  else if (kind === "camera") p.cameras++;
  else if (kind === "ribbon") p.ribbons++;
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
    const c = CONTAINERS[id];
    ok = !!c && !s.searched[id] && Math.hypot(p.x - c.x, p.z - c.z) <= USE_RANGE + 0.9;
  } else if (kind === "p") {
    ok = p.fuses > 0 && s.placed < s.need && Math.hypot(p.x - PANEL.x, p.z - PANEL.z) <= USE_RANGE + 0.5;
    need = PLACE_MS;
  } else if (kind === "r") {
    const q = s.players[id];
    ok = !!q && q !== p && q.st === "down" && Math.hypot(p.x - q.x, p.z - q.z) <= REVIVE_RANGE + 0.4;
    need = REVIVE_MS;
  } else if (kind === "m") {
    const m = s.mannequins[id];
    ok = !!m && p.ribbons > 0 && s.t >= m.boundUntil && Math.hypot(p.x - m.x, p.z - m.z) <= BIND_RANGE + 0.4;
    need = BIND_MS;
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
      pushEvent(s, "full", { seat: p.seat, n: s.contents[id], x: id });
      p.use = null;
      return;
    }
    s.searched[id] = true;
    p.stats.searches++;
    pushEvent(s, "found", { seat: p.seat, n: s.contents[id], x: id });
    p.use = null;
  } else if (kind === "p") {
    p.fuses--;
    p.stats.fusePlaced++;
    s.placed++;
    pushEvent(s, "place", { seat: p.seat, n: s.placed });
    // 퓨즈가 꽂힐 때마다 마네킹이 하나 더 깨어나고, 전력이 출렁인다
    s.awakeWant = Math.min(awakeCap(s), s.awakeWant + 1);
    if (s.flicker.st === "idle") s.flicker.at = Math.min(s.flicker.at, s.t + FLICKER_AFTER_FUSE_MS - FLICKER_WARN_MS);
    if (s.placed >= s.need && !s.exitOpen) {
      s.exitOpen = true;
      pushEvent(s, "exitOpen");
    }
    if (p.fuses <= 0 || s.placed >= s.need) p.use = null;
  } else if (kind === "r") {
    const q = s.players[id];
    q.st = "alive";
    q.mv = 0;
    q.safeUntil = s.t + 3000;
    q.light = q.battery > 0;
    p.stats.revives++;
    pushEvent(s, "revive", { seat: q.seat, n: p.seat });
    p.use = null;
  } else if (kind === "m") {
    const m = s.mannequins[id];
    p.ribbons--;
    p.stats.binds++;
    if (m.awake) {
      m.boundUntil = s.t + BIND_HOLD_MS;
      m.revealUntil = Math.max(m.revealUntil, s.t + BIND_HOLD_MS);
      pushEvent(s, "bound", { seat: p.seat, n: m.id, x: m.x, z: m.z });
    } else {
      m.checked = true;
      p.stats.decoys++;
      pushEvent(s, "decoy", { seat: p.seat, n: m.id, x: m.x, z: m.z });
    }
    p.use = null;
  }
}

function playerStep(s: MatchState, p: PlayerState, dtMs: number) {
  const dt = dtMs / 1000;
  if (p.st === "down") {
    if (s.t - p.downAt >= BLEED_MS) {
      p.st = "dead";
      pushEvent(s, "dead", { seat: p.seat });
    }
    return;
  }
  if (p.st !== "alive") return;
  if (p.light && s.flicker.st !== "dark") {
    p.battery = Math.max(0, p.battery - (100 / BATTERY_SEC) * dt);
    if (p.battery <= 0) p.light = false;
  }
  holdStep(s, p, dtMs);
  if (s.exitOpen && Math.hypot(p.x - EXIT.x, p.z - EXIT.z) <= EXIT_RANGE) {
    p.st = "escaped";
    p.use = null;
    p.light = false;
    pushEvent(s, "escape", { seat: p.seat });
  }
}

/** 응시 기록: 살아 있는 마네킹을 붙들어 둔 사람에게 시간을, 동료 코앞에서 멈췄다면 "구함"을 */
function stareStats(s: MatchState, dt: number, wasMoving: boolean[]) {
  for (const m of s.mannequins) {
    if (!canMove(s, m)) continue;
    const eyes = s.players.filter((p) => sees(s, p, m.x, m.z));
    if (!eyes.length) continue;
    for (const p of eyes) p.stats.stareSec += dt / eyes.length;
    if (wasMoving[m.id]) {
      const t = s.players[m.target];
      if (t && t.st === "alive" && Math.hypot(t.x - m.x, t.z - m.z) < 3) for (const p of eyes) if (p !== t) p.stats.saves++;
    }
  }
}

function finish(s: MatchState, why: Outcome["why"]) {
  for (const p of s.players) if (p.st === "alive" || p.st === "down") p.st = "dead";
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
  for (const p of s.players) playerStep(s, p, TICK_MS);

  // 깨어나기: 잠깐의 유예가 끝나면, 그 뒤엔 퓨즈가 꽂힐 때마다 하나씩 (안 보이는 곳에서)
  if (s.t >= GRACE_MS) {
    const awake = s.mannequins.filter((m) => m.awake).length;
    if (awake < s.awakeWant && s.t % 1000 < TICK_MS) wakeOne(s);
  }
  for (const m of s.mannequins) {
    if (m.boundUntil > 0 && s.t >= m.boundUntil && s.t - TICK_MS < m.boundUntil) pushEvent(s, "unbound", { n: m.id, x: m.x, z: m.z });
  }
  const wasMoving = s.mannequins.map((m) => m.moving);
  flickerStep(s);
  mannequinStep(s, dt);
  stareStats(s, dt, wasMoving);

  if (!s.lastMinute && s.t >= TIME_LIMIT_MS - 60_000) {
    s.lastMinute = true;
    pushEvent(s, "lastMinute");
  }
  if (s.events.length > 0 && s.events[0].at < s.t - 6000) s.events = s.events.filter((e) => e.at >= s.t - 6000);

  if (s.t >= TIME_LIMIT_MS) finish(s, "time");
  else if (!s.players.some((p) => p.st === "alive")) finish(s, "allDown");
}

/** 방장 루프: 지난 시간만큼 고정 틱으로 */
export function hostStep(rt: HostRuntime, dtMs: number) {
  rt.acc += Math.min(500, dtMs);
  while (rt.acc >= TICK_MS) {
    rt.acc -= TICK_MS;
    tick(rt);
  }
}

export { EXIT, PANEL };
