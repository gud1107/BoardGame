import {
  BASE,
  CHEST_SLOTS,
  DOORS,
  FILLER_SLOTS,
  FIXED_THINGS,
  FLOOR,
  GOAL_SLOTS,
  LADDER,
  NAV_ADJ,
  NAV_NODES,
  ROAD,
  ROOMS,
  STATIC_SOLIDS,
  THING_SIZE,
  WINDOWS,
  doorSolid,
  navPath,
  nearestNode,
  slotY,
  thingSolid,
  windowSolid,
  type PlacedThing,
  type Solid,
  type ThingKind,
} from "./map";
import {
  DECOY_CHARGES,
  DEFAULT_OPTIONS,
  DISGUISES,
  EMOTES,
  FILLER_KINDS,
  GOAL_OPEN_AT,
  GOAL_RADIUS,
  HIDE_SEC,
  PICK_SEC,
  REROLLS,
  ROUND_END_SEC,
  RUN_MULT,
  SEEKER_HP,
  SEEKER_SPEED,
  WEAPONS,
  disguise,
  poseOf,
  seekerCount,
  weaponSchedule,
  weaponTier,
  type FormKind,
  type GameOptions,
  type WeaponDef,
} from "./data";
import { SolidGrid, lineOfSight, raycast, stepBody, type Body, type CollWorld, type Cyl, type RayBody } from "./physics";

/**
 * 변신 숨바꼭질 — 방장 시뮬레이션.
 *
 * 네트워크 모델 (docs/cloud-sync.md §5의 "방장 권위" 변형):
 * - **내 몸의 이동은 내 기기가** 같은 물리(physics.ts)로 바로 계산하고 위치를 방장에게 보낸다
 *   (그래야 조작이 부드럽다). 방장은 그 위치를 믿고 쓴다.
 * - **판정은 전부 방장이**: 단계·시간, 무기 단계, 공격 명중, 잡힘/탈락, 문·창문·상자, NPC, 봇.
 *   방장이 순간이동시킬 때(라운드 시작 등)는 `tp`를 올려, 그보다 옛날 위치 보고는 버린다.
 */

export type Role = "hider" | "seeker";
export type Phase = "pick" | "hide" | "hunt" | "roundEnd" | "gameOver";

export interface PlayerStats {
  catches: number;
  maxCatches: number;
  wrongHits: number;
  survives: number;
  escapes: number;
  caught: number;
  decoys: number;
  emotes: number;
  chests: number;
  seekerWins: number;
}

export interface PlayerState {
  seat: number;
  bot: boolean;
  level: number;
  role: Role;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vy: number;
  grounded: boolean;
  anim: string;
  pose: number;
  /** 방장이 순간이동시킨 횟수 */
  tp: number;
  alive: boolean;
  escaped: boolean;
  hp: number;
  disguise: string | null;
  offer: string[];
  rerolls: number;
  decoys: number;
  ammo: number;
  tier: number;
  nextAtkAt: number;
  emote: { id: string; at: number } | null;
  score: number;
  roundCatches: number;
  caughtAt: number | null;
  stats: PlayerStats;
}

export type NpcKind = "ped" | "guard" | "dog" | "cat" | "vacuum" | "car";

export interface NpcState {
  id: number;
  kind: NpcKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
  /** 생김새 */
  look: number;
}

export interface DecoyState {
  id: number;
  owner: number;
  disguise: string;
  pose: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
}

export type GameEvent =
  | { id: number; at: number; type: "catch"; by: number; target: number; x: number; y: number; z: number; weapon: string }
  | { id: number; at: number; type: "wrong"; by: number; x: number; y: number; z: number; hp: number; what: string }
  | { id: number; at: number; type: "shot"; by: number; from: [number, number, number]; to: [number, number, number]; weapon: string }
  | { id: number; at: number; type: "swing"; by: number; weapon: string }
  | { id: number; at: number; type: "seekerDown"; seat: number }
  | { id: number; at: number; type: "door"; door: number; open: boolean }
  | { id: number; at: number; type: "window"; window: number; open: boolean }
  | { id: number; at: number; type: "chest"; seat: number; slot: number; reward: "decoy" | "pulse"; count?: number }
  | { id: number; at: number; type: "emote"; seat: number; emote: string }
  | { id: number; at: number; type: "decoy"; seat: number }
  | { id: number; at: number; type: "tier"; tier: number; weapon: string }
  | { id: number; at: number; type: "goalOpen"; slot: number }
  | { id: number; at: number; type: "escape"; seat: number }
  | { id: number; at: number; type: "phase"; phase: Phase; round: number }
  | { id: number; at: number; type: "roundEnd"; winner: "seekers" | "hiders" };

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

export interface RoundSummary {
  round: number;
  seekers: number[];
  winner: "seekers" | "hiders";
  hiders: { seat: number; disguise: string | null; result: "survived" | "escaped" | "caught"; by?: number }[];
}

export interface MatchState {
  seed: number;
  seatCount: number;
  options: GameOptions;
  round: number;
  phase: Phase;
  /** 시뮬레이션 시각 (ms) */
  t: number;
  phaseStart: number;
  phaseEnd: number;
  seekers: number[];
  players: PlayerState[];
  npcs: NpcState[];
  decoys: DecoyState[];
  doors: boolean[];
  windows: boolean[];
  chests: { slot: number; opened: boolean }[];
  goal: { slot: number; open: boolean } | null;
  /** 보행 신호 (true = 사람 건너는 신호) */
  pedLight: boolean;
  events: GameEvent[];
  nextEventId: number;
  history: RoundSummary[];
  winners: number[] | null;
  /** 지금 술래 무기 단계 */
  tier: number;
}

// ---------------------------------------------------------------------------
// 난수

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// 판마다 깔리는 소품 (모든 기기가 시드로 똑같이 만든다)

export function buildFillers(seed: number, round: number): PlacedThing[] {
  const rng = mulberry(seed * 31 + round * 977 + 5);
  const slots = FILLER_SLOTS.map((s, i) => ({ s, i, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 30);
  // 종류는 골고루: 한 바퀴씩 섞어서 돌린다
  const kinds: ThingKind[] = [];
  while (kinds.length < slots.length) {
    const lap = [...FILLER_KINDS].sort(() => rng() - 0.5);
    kinds.push(...lap);
  }
  return slots.map(({ s, i }, j) => {
    const kind = kinds[j];
    const rot = s.lock ? (rng() < 0.5 ? 0 : Math.PI) : Math.floor(rng() * 4) * (Math.PI / 2);
    return { id: `x${i}`, kind, x: s.x, y: slotY(s), z: s.z, rot };
  });
}

export function chestThings(state: Pick<MatchState, "chests">): PlacedThing[] {
  return state.chests
    .filter((c) => !c.opened)
    .map((c) => {
      const s = CHEST_SLOTS[c.slot];
      return { id: `chest${c.slot}`, kind: "chest" as ThingKind, x: s.x, y: slotY(s), z: s.z, rot: 0 };
    });
}

/** 판(라운드)마다 고정되는 상자 격자: 정적 + 채움 소품 */
export function roundGrid(seed: number, round: number): { grid: SolidGrid; fillers: PlacedThing[] } {
  const fillers = buildFillers(seed, round);
  const extra = fillers.map(thingSolid).filter((s): s is Solid => s !== null);
  return { grid: new SolidGrid([...STATIC_SOLIDS, ...extra]), fillers };
}

/** 문·창문(닫힌 것)·상자·자동차 */
export function dynamicSolids(state: Pick<MatchState, "doors" | "windows" | "chests" | "npcs">): Solid[] {
  const out: Solid[] = [];
  state.doors.forEach((open, i) => {
    if (!open) out.push(doorSolid(DOORS[i]));
  });
  state.windows.forEach((open, i) => {
    if (!open) out.push(windowSolid(WINDOWS[i]));
  });
  for (const c of chestThings(state)) {
    const s = thingSolid(c);
    if (s) out.push(s);
  }
  for (const n of state.npcs) if (n.kind === "car") out.push(carSolid(n));
  return out;
}

export function carSolid(n: { x: number; z: number }): Solid {
  return { x0: n.x - 2.0, x1: n.x + 2.0, y0: 0, y1: 1.45, z0: n.z - 0.9, z1: n.z + 0.9, k: "car" };
}

// ---------------------------------------------------------------------------
// 몸 크기

export function formOf(p: { role: Role; disguise: string | null }): FormKind | "seeker" {
  if (p.role === "seeker") return "seeker";
  return disguise(p.disguise)?.form ?? "person";
}

export function bodySize(p: { role: Role; disguise: string | null }): { r: number; h: number } {
  if (p.role === "seeker") return { r: 0.3, h: 1.75 };
  const d = disguise(p.disguise);
  return d ? { r: d.r, h: d.h } : { r: 0.3, h: 1.7 };
}

export function npcSize(kind: NpcKind): { r: number; h: number } {
  switch (kind) {
    case "dog":
      return { r: 0.32, h: 0.7 };
    case "cat":
      return { r: 0.25, h: 0.5 };
    case "vacuum":
      return { r: 0.3, h: 0.25 };
    case "car":
      return { r: 2, h: 1.45 };
    default:
      return { r: 0.3, h: 1.75 };
  }
}

export function walkSpeed(p: { role: Role; disguise: string | null }): number {
  if (p.role === "seeker") return SEEKER_SPEED;
  return disguise(p.disguise)?.speed ?? 1.8;
}

/** 몸 목록 (충돌용) — `except`는 빼고 */
export function bodiesFor(state: Pick<MatchState, "players" | "npcs" | "decoys" | "phase">, except: { seat?: number; npc?: number; decoy?: number }): Cyl[] {
  const out: Cyl[] = [];
  for (const p of state.players) {
    if (p.seat === except.seat || !visibleOnMap(p, state.phase)) continue;
    const { r, h } = bodySize(p);
    out.push({ x: p.x, z: p.z, y0: p.y, y1: p.y + h, r });
  }
  for (const n of state.npcs) {
    if (n.id === except.npc || n.kind === "car") continue;
    const { r, h } = npcSize(n.kind);
    out.push({ x: n.x, z: n.z, y0: n.y, y1: n.y + h, r });
  }
  for (const d of state.decoys) {
    if (d.id === except.decoy) continue;
    const def = disguise(d.disguise);
    out.push({ x: d.x, z: d.z, y0: d.y, y1: d.y + (def?.h ?? 1), r: def?.r ?? 0.3 });
  }
  return out;
}

/** 맵 위에 보이는 플레이어인가 (잡혔거나 찜해서 나간 사람은 안 보인다) */
export function visibleOnMap(p: PlayerState, phase: Phase): boolean {
  if (phase === "gameOver") return false;
  if (p.role === "hider") return p.alive && !p.escaped && p.disguise !== null;
  return p.alive;
}

// ---------------------------------------------------------------------------
// 시작

const NPC_PLAN: NpcKind[] = ["ped", "ped", "ped", "ped", "ped", "ped", "guard", "guard", "dog", "dog", "cat", "cat", "vacuum", "car", "car"];

function freshStats(): PlayerStats {
  return { catches: 0, maxCatches: 0, wrongHits: 0, survives: 0, escapes: 0, caught: 0, decoys: 0, emotes: 0, chests: 0, seekerWins: 0 };
}

export interface SeatInfo {
  bot: boolean;
  level: number;
}

export function createMatch(seed: number, seats: SeatInfo[], options: Partial<GameOptions> = {}): MatchState {
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  const players: PlayerState[] = seats.map((s, seat) => ({
    seat,
    bot: s.bot,
    level: s.level,
    role: "hider",
    x: BASE.x,
    y: 0,
    z: BASE.z,
    yaw: 0,
    vy: 0,
    grounded: true,
    anim: "idle",
    pose: 0,
    tp: 0,
    alive: true,
    escaped: false,
    hp: SEEKER_HP,
    disguise: null,
    offer: [],
    rerolls: REROLLS,
    decoys: DECOY_CHARGES,
    ammo: 0,
    tier: 0,
    nextAtkAt: 0,
    emote: null,
    score: 0,
    roundCatches: 0,
    caughtAt: null,
    stats: freshStats(),
  }));
  const state: MatchState = {
    seed,
    seatCount: seats.length,
    options: opts,
    round: 0,
    phase: "pick",
    t: 0,
    phaseStart: 0,
    phaseEnd: 0,
    seekers: [],
    players,
    npcs: [],
    decoys: [],
    doors: DOORS.map((d) => d.open),
    windows: WINDOWS.map(() => false),
    chests: [],
    goal: null,
    pedLight: false,
    events: [],
    nextEventId: 1,
    history: [],
    winners: null,
    tier: 0,
  };
  return state;
}

// ---------------------------------------------------------------------------
// 방장 런타임 (상태 + 판 격자 + AI 메모리)

interface WalkerAi {
  path: number[];
  idx: number;
  goal: [number, number, number] | null;
  waitUntil: number;
  stuck: number;
  lastX: number;
  lastZ: number;
  /** 지금 동작 모드 */
  mode: string;
  focus: { kind: "p" | "n" | "d" | "t"; id: number | string } | null;
  focusUntil: number;
  nextScan: number;
  visited: Set<number>;
  run: boolean;
  /** 숨는 봇: 이번 판 목표 */
  plan: "hold" | "wander" | "goal" | null;
  decoyAt: number;
  home: [number, number, number] | null;
  lastMoveAt: number;
  movedRecently: boolean;
}

function freshAi(): WalkerAi {
  return { path: [], idx: 0, goal: null, waitUntil: 0, stuck: 0, lastX: 0, lastZ: 0, mode: "idle", focus: null, focusUntil: 0, nextScan: 0, visited: new Set(), run: false, plan: null, decoyAt: 0, home: null, lastMoveAt: -1e9, movedRecently: false };
}

export interface HostRuntime {
  state: MatchState;
  grid: SolidGrid;
  fillers: PlacedThing[];
  rng: () => number;
  npcAi: Map<number, WalkerAi & { body: Body }>;
  botAi: Map<number, WalkerAi>;
  decoyAi: Map<number, WalkerAi & { body: Body }>;
  /** 사람이 마지막으로 움직인 시각 (술래 봇이 "움직이는 물건"을 알아챈다) */
  movedAt: Map<number, number>;
  lightT: number;
  nextDecoyId: number;
}

export function createHost(state: MatchState): HostRuntime {
  const { grid, fillers } = roundGrid(state.seed, Math.max(1, state.round));
  const rt: HostRuntime = { state, grid, fillers, rng: mulberry(state.seed ^ 0x5bd1e995), npcAi: new Map(), botAi: new Map(), decoyAi: new Map(), movedAt: new Map(), lightT: 0, nextDecoyId: 1 };
  spawnNpcs(rt);
  startRound(rt);
  return rt;
}

function emit(state: MatchState, e: EventBody) {
  state.events.push({ ...e, id: state.nextEventId++, at: state.t } as GameEvent);
  if (state.events.length > 60) state.events.splice(0, state.events.length - 60);
}

function setPhase(rt: HostRuntime, phase: Phase, sec: number) {
  const s = rt.state;
  s.phase = phase;
  s.phaseStart = s.t;
  s.phaseEnd = s.t + sec * 1000;
  emit(s, { type: "phase", phase, round: s.round });
}

function rollOffer(rng: () => number, exclude: readonly string[] = []): string[] {
  const pool = DISGUISES.filter((d) => !exclude.includes(d.id));
  const living = pool.filter((d) => d.form !== "prop");
  const props = pool.filter((d) => d.form === "prop");
  const draw = (from: typeof pool, taken: string[]) => {
    const cand = from.filter((d) => !taken.includes(d.id));
    const total = cand.reduce((a, d) => a + d.weight, 0);
    let r = rng() * total;
    for (const d of cand) {
      r -= d.weight;
      if (r <= 0) return d.id;
    }
    return cand[cand.length - 1].id;
  };
  const out: string[] = [];
  out.push(draw(living, out));
  out.push(draw(props, out));
  out.push(draw(pool, out));
  // 섞기
  return out.sort(() => rng() - 0.5);
}

function spawnRing(i: number, n: number): [number, number] {
  const a = (i / Math.max(1, n)) * Math.PI * 1.2 + Math.PI * 0.9;
  return [5.2 + Math.cos(a) * 2.2, 9.6 + Math.sin(a) * 1.6];
}

export function startRound(rt: HostRuntime) {
  const s = rt.state;
  s.round += 1;
  const { grid, fillers } = roundGrid(s.seed, s.round);
  rt.grid = grid;
  rt.fillers = fillers;
  const k = seekerCount(s.seatCount);
  s.seekers = Array.from({ length: k }, (_, i) => ((s.round - 1) * k + i) % s.seatCount);
  s.decoys = [];
  rt.decoyAi.clear();
  rt.botAi.clear();
  rt.movedAt.clear();
  s.doors = DOORS.map((d) => d.open);
  s.windows = WINDOWS.map(() => false);
  // 보물 상자 3개, 찜 장소 1곳
  const chestSlots = CHEST_SLOTS.map((_, i) => i).sort(() => rt.rng() - 0.5);
  s.chests = chestSlots.slice(0, 3).map((slot) => ({ slot, opened: false }));
  s.goal = s.options.goalMode ? { slot: Math.floor(rt.rng() * GOAL_SLOTS.length), open: false } : null;
  let hi = 0;
  const hiders = s.players.filter((p) => !s.seekers.includes(p.seat)).length;
  for (const p of s.players) {
    const seeker = s.seekers.includes(p.seat);
    p.role = seeker ? "seeker" : "hider";
    p.alive = true;
    p.escaped = false;
    p.hp = SEEKER_HP;
    p.disguise = null;
    p.offer = seeker ? [] : rollOffer(rt.rng);
    p.rerolls = REROLLS;
    p.decoys = DECOY_CHARGES;
    p.ammo = 0;
    p.tier = 0;
    p.nextAtkAt = 0;
    p.emote = null;
    p.pose = 0;
    p.anim = "idle";
    p.roundCatches = 0;
    p.caughtAt = null;
    p.vy = 0;
    p.grounded = true;
    if (seeker) {
      const j = s.seekers.indexOf(p.seat);
      p.x = BASE.x + j * 0.9;
      p.z = BASE.z;
    } else {
      [p.x, p.z] = spawnRing(hi++, hiders);
    }
    p.y = 0;
    p.yaw = seeker ? Math.PI : 0;
    p.tp += 1;
  }
  setPhase(rt, "pick", PICK_SEC);
}

function spawnNpcs(rt: HostRuntime) {
  const s = rt.state;
  s.npcs = [];
  rt.npcAi.clear();
  const outNodes = NAV_NODES.filter((n) => n.out);
  const houseNodes = NAV_NODES.filter((n) => n.inspect);
  NPC_PLAN.forEach((kind, id) => {
    let x = 0;
    let y = 0;
    let z = 0;
    if (kind === "ped") {
      const n = outNodes[(id * 7) % outNodes.length];
      x = n.x;
      z = n.z;
    } else if (kind === "guard") {
      const n = houseNodes[(id * 3) % houseNodes.length];
      x = n.x;
      y = n.y;
      z = n.z;
    } else if (kind === "dog" || kind === "cat") {
      [x, z] = kind === "dog" ? (id % 2 ? [-4, 33] : [-8, 10]) : id % 2 ? [7, 30] : [-11, 6.5];
    } else if (kind === "vacuum") {
      x = 3;
      z = 1.2;
    } else {
      const east = id % 2 === 0;
      x = east ? -18 : 14;
      z = east ? 17.8 : 21.2;
    }
    const { r, h } = npcSize(kind);
    s.npcs.push({ id, kind, x, y, z, yaw: 0, anim: "idle", look: (id * 5 + 3) % 8 });
    rt.npcAi.set(id, { ...freshAi(), body: { x, y, z, vy: 0, grounded: true, r, h } });
  });
}

// ---------------------------------------------------------------------------
// 행동 (사람·봇 공통 입구)

export type Act =
  | { t: "pick"; id: string }
  | { t: "reroll" }
  | { t: "atk"; o: [number, number, number]; d: [number, number, number] }
  | { t: "door"; id: number }
  | { t: "window"; id: number }
  | { t: "chest"; slot: number }
  | { t: "decoy" }
  | { t: "emote"; id: string };

export interface PosReport {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
  pose: number;
  tp: number;
}

/** 사람 기기가 보낸 위치 */
export function applyPos(rt: HostRuntime, seat: number, pos: PosReport) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || p.bot || pos.tp !== p.tp) return;
  if (!visibleOnMap(p, s.phase) && p.role === "hider") return;
  if (s.phase === "pick" || s.phase === "roundEnd") return;
  if (p.role === "seeker" && s.phase === "hide") return;
  if (![pos.x, pos.y, pos.z, pos.yaw].every(Number.isFinite)) return;
  const moved = Math.hypot(pos.x - p.x, pos.z - p.z) > 0.03 || Math.abs(pos.y - p.y) > 0.05;
  if (moved) rt.movedAt.set(seat, s.t);
  p.x = pos.x;
  p.y = pos.y;
  p.z = pos.z;
  p.yaw = pos.yaw;
  p.anim = String(pos.anim).slice(0, 16);
  p.pose = Math.max(0, Math.min(9, Math.floor(pos.pose) || 0));
}

const INTERACT = 1.7;

function near3(p: { x: number; y: number; z: number }, x: number, y: number, z: number, r: number) {
  return Math.hypot(p.x - x, p.z - z) <= r && Math.abs(p.y - y) < 1.6;
}

export function applyAct(rt: HostRuntime, seat: number, act: Act) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p) return;
  switch (act.t) {
    case "pick": {
      if (s.phase !== "pick" && s.phase !== "hide") return;
      if (p.role !== "hider" || p.disguise || !p.offer.includes(act.id)) return;
      p.disguise = act.id;
      p.pose = 0;
      return;
    }
    case "reroll": {
      if (s.phase !== "pick" || p.role !== "hider" || p.disguise || p.rerolls <= 0) return;
      p.rerolls -= 1;
      p.offer = rollOffer(rt.rng, p.offer);
      return;
    }
    case "atk":
      attack(rt, p, act.o, act.d);
      return;
    case "door": {
      const d = DOORS[act.id];
      if (!d || !visibleOnMap(p, s.phase) || s.phase === "pick" || s.phase === "roundEnd") return;
      if (!near3(p, d.x, d.y, d.z, INTERACT + 0.4)) return;
      s.doors[act.id] = !s.doors[act.id];
      emit(s, { type: "door", door: act.id, open: s.doors[act.id] });
      return;
    }
    case "window": {
      const w = WINDOWS[act.id];
      if (!w || !visibleOnMap(p, s.phase) || s.phase === "pick" || s.phase === "roundEnd") return;
      if (!near3(p, w.x, w.y + 0.3, w.z, INTERACT + 0.4)) return;
      s.windows[act.id] = !s.windows[act.id];
      emit(s, { type: "window", window: act.id, open: s.windows[act.id] });
      return;
    }
    case "chest": {
      const c = s.chests.find((ch) => ch.slot === act.slot && !ch.opened);
      if (!c || !visibleOnMap(p, s.phase) || (s.phase !== "hide" && s.phase !== "hunt")) return;
      if (p.role === "seeker" && s.phase !== "hunt") return;
      const sl = CHEST_SLOTS[c.slot];
      if (!near3(p, sl.x, slotY(sl), sl.z, INTERACT)) return;
      c.opened = true;
      p.stats.chests += 1;
      if (p.role === "hider") {
        p.decoys += 1;
        emit(s, { type: "chest", seat, slot: c.slot, reward: "decoy" });
      } else {
        const count = s.players.filter((q) => q.role === "hider" && visibleOnMap(q, s.phase) && Math.hypot(q.x - p.x, q.z - p.z) <= 12).length;
        emit(s, { type: "chest", seat, slot: c.slot, reward: "pulse", count });
      }
      return;
    }
    case "decoy": {
      if (p.role !== "hider" || !visibleOnMap(p, s.phase) || p.decoys <= 0 || (s.phase !== "hide" && s.phase !== "hunt") || !p.disguise) return;
      p.decoys -= 1;
      p.stats.decoys += 1;
      const id = rt.nextDecoyId++;
      const def = disguise(p.disguise)!;
      // 내 바로 옆(뒤쪽)에 똑같은 모양을 하나 더
      const ox = p.x - Math.sin(p.yaw) * (def.r * 2 + 0.25);
      const oz = p.z - Math.cos(p.yaw) * (def.r * 2 + 0.25);
      s.decoys.push({ id, owner: seat, disguise: p.disguise, pose: p.pose, x: ox, y: p.y, z: oz, yaw: p.yaw, anim: def.form === "prop" ? "idle" : "idle" });
      rt.decoyAi.set(id, { ...freshAi(), body: { x: ox, y: p.y, z: oz, vy: 0, grounded: true, r: def.r, h: def.h }, home: [ox, p.y, oz] });
      emit(s, { type: "decoy", seat });
      return;
    }
    case "emote": {
      const em = EMOTES.find((e) => e.id === act.id);
      if (!em || !visibleOnMap(p, s.phase)) return;
      if (p.emote && s.t - p.emote.at < em.dur * 1000) return;
      p.emote = { id: em.id, at: s.t };
      p.stats.emotes += 1;
      emit(s, { type: "emote", seat, emote: em.id });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 공격

export function currentWeapon(state: MatchState): WeaponDef {
  const sched = weaponSchedule(state.options.huntSec);
  if (state.phase !== "hunt") return WEAPONS[sched[0]];
  return WEAPONS[sched[weaponTier(state.options.huntSec, (state.t - state.phaseStart) / 1000)]];
}

interface Target {
  kind: "p" | "n" | "d";
  id: number;
  body: RayBody;
  label: string;
}

function targetsFor(s: MatchState, attacker: number): Target[] {
  const out: Target[] = [];
  for (const q of s.players) {
    if (q.seat === attacker || q.role !== "hider" || !visibleOnMap(q, s.phase)) continue;
    const { r, h } = bodySize(q);
    out.push({ kind: "p", id: q.seat, body: { x: q.x, y: q.y, z: q.z, r, h }, label: disguise(q.disguise)?.name ?? "사람" });
  }
  for (const n of s.npcs) {
    if (n.kind === "car") continue;
    const { r, h } = npcSize(n.kind);
    out.push({ kind: "n", id: n.id, body: { x: n.x, y: n.y, z: n.z, r, h }, label: NPC_LABEL[n.kind] });
  }
  for (const d of s.decoys) {
    const def = disguise(d.disguise);
    out.push({ kind: "d", id: d.id, body: { x: d.x, y: d.y, z: d.z, r: def?.r ?? 0.3, h: def?.h ?? 1 }, label: def?.name ?? "물건" });
  }
  return out;
}

const NPC_LABEL: Record<NpcKind, string> = { ped: "행인", guard: "점검원", dog: "강아지", cat: "고양이", vacuum: "로봇 청소기", car: "자동차" };

function thingLabel(rt: HostRuntime, id: string | undefined): string {
  if (!id) return "물건";
  const t = FIXED_THINGS.find((f) => f.id === id) ?? rt.fillers.find((f) => f.id === id);
  if (!t) return id.startsWith("crate") ? "나무 상자" : "물건";
  return disguiseNameOfThing(t.kind);
}

export function disguiseNameOfThing(kind: ThingKind): string {
  return DISGUISES.find((d) => d.thing === kind)?.name ?? THING_NAMES[kind] ?? "물건";
}

const THING_NAMES: Partial<Record<ThingKind, string>> = {
  shelf: "공구 선반",
  bike: "자전거",
  shoecab: "신발장",
  sofa: "소파",
  curtain: "커튼",
  piano: "피아노",
  tub: "욕조",
  table: "식탁",
  pantry: "팬트리",
  sink: "싱크대",
  wardrobe: "옷장",
  bed: "침대",
  vanity: "화장대",
  tent: "텐트",
  bunk: "이층 침대",
  bookcase: "책장",
  doghouse: "개집",
  lamp: "가로등",
  tree: "나무",
  fountain: "분수",
  trafficLight: "신호등",
  chest: "보물 상자",
};

function allSolids(rt: HostRuntime): Solid[] {
  return [...rt.grid.all, ...dynamicSolids(rt.state)];
}

function attack(rt: HostRuntime, p: PlayerState, o: [number, number, number], d: [number, number, number]) {
  const s = rt.state;
  if (s.phase !== "hunt" || p.role !== "seeker" || !p.alive || s.t < p.nextAtkAt) return;
  const w = currentWeapon(s);
  if (w.kind === "ray" && p.ammo <= 0) return;
  if (![...o, ...d].every(Number.isFinite)) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const dir: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
  p.nextAtkAt = s.t + w.cooldownMs;
  if (w.kind === "ray") p.ammo -= 1;
  const eye: [number, number, number] = [p.x, p.y + 1.55, p.z];
  const origin: [number, number, number] = Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) <= 7 ? o : eye;
  const targets = targetsFor(s, p.seat);
  const bodies = targets.map((t) => t.body);
  const solids = allSolids(rt);
  const skipGlass = (sol: Solid) => sol.k === "glass";
  let resolved = false;
  let wrongWhat: string | null = null;
  let caught: Target | null = null;

  if (w.kind === "melee") {
    emit(s, { type: "swing", by: p.seat, weapon: w.id });
    // 1) 눈에서 앞으로 곧장
    const hit = raycast(solids, bodies, eye, dir, w.range + 0.4, skipGlass);
    if (hit?.body !== undefined) {
      const t = targets[hit.body];
      if (t.kind === "p") caught = t;
      else wrongWhat = t.label;
      resolved = true;
    } else if (hit?.solid?.k === "prop" && hit.solid.id) {
      wrongWhat = thingLabel(rt, hit.solid.id);
      resolved = true;
    }
    // 2) 못 맞췄으면 앞쪽 부채꼴에서 가장 가까운 것 (손을 뻗어 더듬는다)
    if (!resolved) {
      const fx = dir[0];
      const fz = dir[2];
      const fl = Math.hypot(fx, fz) || 1;
      let best: Target | null = null;
      let bd = Infinity;
      for (const t of targets) {
        const dx = t.body.x - p.x;
        const dz = t.body.z - p.z;
        const dist = Math.hypot(dx, dz) - t.body.r;
        if (dist > w.range || Math.abs(t.body.y - p.y) > 1.6) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (Math.hypot(dx, dz) * fl || 1))));
        if (ang > (w.cone ?? 0.7)) continue;
        if (!lineOfSight(solids, eye, [t.body.x, t.body.y + t.body.h * 0.5, t.body.z])) continue;
        if (dist < bd) {
          bd = dist;
          best = t;
        }
      }
      if (best) {
        if (best.kind === "p") caught = best;
        else wrongWhat = best.label;
      }
    }
  } else {
    const pellets = w.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      let pd = dir;
      if (pellets > 1) {
        const sx = (rt.rng() - 0.5) * 0.14;
        const sy = (rt.rng() - 0.5) * 0.1;
        const v = [dir[0] + sx, dir[1] + sy, dir[2] - sx * 0.5];
        const l = Math.hypot(v[0], v[1], v[2]);
        pd = [v[0] / l, v[1] / l, v[2] / l];
      }
      const hit = raycast(solids, bodies, origin, pd, w.range);
      const tt = hit?.t ?? w.range;
      emit(s, { type: "shot", by: p.seat, from: [r2(eye[0]), r2(eye[1] - 0.2), r2(eye[2])], to: [r2(origin[0] + pd[0] * tt), r2(origin[1] + pd[1] * tt), r2(origin[2] + pd[2] * tt)], weapon: w.id });
      if (hit?.body !== undefined) {
        const t = targets[hit.body];
        if (t.kind === "p") {
          if (!caught) caught = t;
        } else wrongWhat ??= t.label;
      } else if (hit?.solid?.k === "prop" && hit.solid.id) {
        wrongWhat ??= thingLabel(rt, hit.solid.id);
      }
    }
  }

  if (caught) {
    const q = s.players[caught.id];
    if (q.alive) {
      q.alive = false;
      q.caughtAt = s.t;
      q.stats.caught += 1;
      p.roundCatches += 1;
      p.stats.catches += 1;
      p.score += 2;
      emit(s, { type: "catch", by: p.seat, target: q.seat, x: r2(q.x), y: r2(q.y), z: r2(q.z), weapon: w.id });
    }
  } else if (wrongWhat) {
    p.hp = Math.max(0, p.hp - w.penalty);
    p.stats.wrongHits += 1;
    emit(s, { type: "wrong", by: p.seat, x: r2(p.x), y: r2(p.y), z: r2(p.z), hp: p.hp, what: wrongWhat });
    if (p.hp <= 0) {
      p.alive = false;
      emit(s, { type: "seekerDown", seat: p.seat });
    }
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// 한 틱

export function hostStep(rt: HostRuntime, dtMs: number) {
  const s = rt.state;
  if (s.phase === "gameOver") return;
  const dt = Math.min(dtMs, 100) / 1000;
  s.t += dtMs;
  // 신호등 (16초: 사람 6초 → 차 10초)
  rt.lightT = (rt.lightT + dt) % 16;
  s.pedLight = rt.lightT < 6;

  const world = (except: { seat?: number; npc?: number; decoy?: number }): CollWorld => ({ grid: rt.grid, dynamic: dynamicSolids(s), bodies: bodiesFor(s, except) });

  stepNpcs(rt, dt, world);
  stepDecoys(rt, dt, world);
  stepBots(rt, dt, world);

  // 감정표현 끝
  for (const p of s.players) {
    if (p.emote) {
      const em = EMOTES.find((e) => e.id === p.emote!.id);
      if (!em || s.t - p.emote.at > em.dur * 1000) p.emote = null;
    }
  }

  switch (s.phase) {
    case "pick": {
      const allPicked = s.players.every((p) => p.role === "seeker" || p.disguise);
      if (s.t >= s.phaseEnd || allPicked) {
        // 시간 안에 안 고르면 랜덤
        for (const p of s.players) if (p.role === "hider" && !p.disguise) p.disguise = pick(rt.rng, p.offer);
        setPhase(rt, "hide", HIDE_SEC);
      }
      break;
    }
    case "hide": {
      for (const p of s.players) {
        if (p.role === "seeker") {
          const j = s.seekers.indexOf(p.seat);
          p.x = BASE.x + j * 0.9;
          p.z = BASE.z;
          p.y = 0;
        }
      }
      if (s.t >= s.phaseEnd) {
        setPhase(rt, "hunt", s.options.huntSec);
        const w = currentWeapon(s);
        for (const p of s.players) {
          if (p.role !== "seeker") continue;
          p.tier = 0;
          p.ammo = w.ammo;
        }
        s.tier = 0;
        emit(s, { type: "tier", tier: 0, weapon: w.id });
      }
      break;
    }
    case "hunt": {
      const elapsed = (s.t - s.phaseStart) / 1000;
      const tier = weaponTier(s.options.huntSec, elapsed);
      const sched = weaponSchedule(s.options.huntSec);
      for (const p of s.players) {
        if (p.role !== "seeker" || p.tier === tier) continue;
        p.tier = tier;
        p.ammo = WEAPONS[sched[tier]].ammo;
      }
      if (s.tier !== tier) {
        s.tier = tier;
        emit(s, { type: "tier", tier, weapon: sched[tier] });
      }
      // 꼼꼼이: 찜 장소 열림 + 도착 판정
      if (s.goal && !s.goal.open && elapsed >= s.options.huntSec * GOAL_OPEN_AT) {
        s.goal.open = true;
        emit(s, { type: "goalOpen", slot: s.goal.slot });
      }
      if (s.goal?.open) {
        const g = GOAL_SLOTS[s.goal.slot];
        const gy = slotY(g);
        for (const p of s.players) {
          if (p.role !== "hider" || !visibleOnMap(p, s.phase)) continue;
          if (Math.hypot(p.x - g.x, p.z - g.z) <= GOAL_RADIUS && Math.abs(p.y - gy) < 1.3) {
            p.escaped = true;
            p.score += 4;
            p.stats.escapes += 1;
            emit(s, { type: "escape", seat: p.seat });
          }
        }
      }
      const hidersLeft = s.players.filter((p) => p.role === "hider" && p.alive && !p.escaped).length;
      const seekersLeft = s.players.filter((p) => p.role === "seeker" && p.alive).length;
      if (hidersLeft === 0 || seekersLeft === 0 || s.t >= s.phaseEnd) endRound(rt, hidersLeft === 0 && !s.players.some((p) => p.escaped) ? "seekers" : "hiders");
      break;
    }
    case "roundEnd": {
      if (s.t >= s.phaseEnd) {
        if (s.round >= s.options.rounds) {
          s.phase = "gameOver";
          const top = Math.max(...s.players.map((p) => p.score));
          s.winners = s.players.filter((p) => p.score === top).map((p) => p.seat);
          emit(s, { type: "phase", phase: "gameOver", round: s.round });
        } else startRound(rt);
      }
      break;
    }
  }
}

function endRound(rt: HostRuntime, winner: "seekers" | "hiders") {
  const s = rt.state;
  const summary: RoundSummary = { round: s.round, seekers: [...s.seekers], winner, hiders: [] };
  for (const p of s.players) {
    if (p.role === "hider") {
      let result: "survived" | "escaped" | "caught" = "caught";
      if (p.escaped) result = "escaped";
      else if (p.alive) {
        result = "survived";
        p.score += 3;
        p.stats.survives += 1;
      } else {
        // 오래 버틸수록 위로 점수 (1분마다 1점)
        p.score += Math.floor(((p.caughtAt ?? s.t) - s.phaseStart) / 60000);
      }
      const by = s.events.find((e) => e.type === "catch" && e.target === p.seat);
      summary.hiders.push({ seat: p.seat, disguise: p.disguise, result, by: by && by.type === "catch" ? by.by : undefined });
    } else {
      p.stats.maxCatches = Math.max(p.stats.maxCatches, p.roundCatches);
      if (winner === "seekers") {
        p.score += 2;
        p.stats.seekerWins += 1;
      }
    }
  }
  s.history.push(summary);
  emit(s, { type: "roundEnd", winner });
  setPhase(rt, "roundEnd", ROUND_END_SEC);
}

// ---------------------------------------------------------------------------
// 걷는 것들 공용: 길찾기 경로 따라가기

function followPath(ai: WalkerAi, body: Body, speed: number, dt: number, w: CollWorld, rng: () => number, onLadder?: () => void): "moving" | "arrived" {
  let tx: number;
  let ty: number;
  let tz: number;
  if (ai.idx < ai.path.length) {
    const n = NAV_NODES[ai.path[ai.idx]];
    tx = n.x;
    ty = n.y;
    tz = n.z;
  } else if (ai.goal) {
    [tx, ty, tz] = ai.goal;
  } else return "arrived";
  const dx = tx - body.x;
  const dz = tz - body.z;
  const dist = Math.hypot(dx, dz);
  // 사다리: 위아래 노드 사이는 순간이동
  if (ai.idx > 0 && ai.idx < ai.path.length) {
    const prev = ai.path[ai.idx - 1];
    const cur = ai.path[ai.idx];
    if (NAV_ADJ[prev].some((e) => e.to === cur && e.edge.ladder)) {
      body.x = tx;
      body.y = ty;
      body.z = tz;
      body.vy = 0;
      body.grounded = true;
      ai.idx += 1;
      onLadder?.();
      return "moving";
    }
  }
  const reach = ai.idx < ai.path.length ? 0.45 : 0.3;
  if (dist < reach && Math.abs(body.y - ty) < 1.2) {
    if (ai.idx < ai.path.length) ai.idx += 1;
    else {
      ai.goal = null;
      return "arrived";
    }
    return "moving";
  }
  const moved = stepBody(body, { dx: dx / (dist || 1), dz: dz / (dist || 1), jump: ai.stuck > 0.6 }, speed, dt, w);
  if (moved < speed * dt * 0.25) ai.stuck += dt;
  else ai.stuck = Math.max(0, ai.stuck - dt * 2);
  if (ai.stuck > 2.5) {
    // 오래 막히면 옆으로 비켜 보고, 그래도 안 되면 다음 점으로 건너뛴다
    body.x += (rng() - 0.5) * 0.4;
    body.z += (rng() - 0.5) * 0.4;
    ai.stuck = 0;
    if (ai.idx < ai.path.length) ai.idx += 1;
    else ai.goal = null;
  }
  return "moving";
}

function routeTo(ai: WalkerAi, body: Body, goal: [number, number, number] | null, node?: number, filter?: (n: (typeof NAV_NODES)[number]) => boolean) {
  const from = nearestNode(body.x, body.y, body.z, filter);
  const to = node ?? (goal ? nearestNode(goal[0], goal[1], goal[2]) : from);
  ai.path = navPath(from, to);
  ai.idx = 0;
  ai.goal = goal;
  ai.stuck = 0;
}

function yawOf(dx: number, dz: number, fallback: number): number {
  return Math.hypot(dx, dz) > 1e-4 ? Math.atan2(dx, dz) : fallback;
}

/** 닫힌 문 앞을 지나가면 열어 준다 (봇·NPC) */
function openDoorsNear(rt: HostRuntime, x: number, y: number, z: number) {
  const s = rt.state;
  DOORS.forEach((d, i) => {
    if (s.doors[i]) return;
    if (Math.hypot(d.x - x, d.z - z) < 1.0 && Math.abs(d.y - y) < 1.2) {
      s.doors[i] = true;
      emit(s, { type: "door", door: i, open: true });
    }
  });
}

// ---------------------------------------------------------------------------
// NPC

const PARK = [-14.5, 10.5, 26, 39] as const;
const YARD = [-14.5, 10.5, 6.5, 13.2] as const;
const LIVING = [0.6, 6.9, 0.6, 4.6] as const;

function randomIn(rng: () => number, box: readonly [number, number, number, number]): [number, number, number] {
  return [box[0] + rng() * (box[1] - box[0]), 0, box[2] + rng() * (box[3] - box[2])];
}

function stepNpcs(rt: HostRuntime, dt: number, world: (e: { npc?: number }) => CollWorld) {
  const s = rt.state;
  for (const n of s.npcs) {
    const ai = rt.npcAi.get(n.id)!;
    const b = ai.body;
    if (n.kind === "car") {
      stepCar(rt, n, dt);
      continue;
    }
    const w = world({ npc: n.id });
    const px = b.x;
    const pz = b.z;
    if (s.t < ai.waitUntil) {
      n.anim = ai.mode;
    } else if (n.kind === "ped") {
      if (ai.idx >= ai.path.length) {
        // 다음 갈 곳: 바깥 길 위의 아무 이웃 (왔던 길은 되도록 피한다)
        const cur = nearestNode(b.x, b.y, b.z, (q) => !!q.out);
        const nbs = NAV_ADJ[cur].filter((e) => NAV_NODES[e.to].out);
        const prev = ai.mode === "walk" ? ai.lastX : -1;
        const choices = nbs.filter((e) => e.to !== prev);
        const nxt = pick(rt.rng, choices.length ? choices : nbs);
        ai.lastX = cur;
        ai.path = [nxt.to];
        ai.idx = 0;
        ai.goal = null;
        // 건널목은 보행 신호를 기다린다
        if (nxt.edge.cross && !s.pedLight) {
          ai.path = [];
          ai.waitUntil = s.t + 500;
          ai.mode = rt.rng() < 0.5 ? "phone" : "idle";
          n.anim = ai.mode;
          continue;
        }
        if (rt.rng() < 0.12) {
          ai.waitUntil = s.t + 1500 + rt.rng() * 3000;
          ai.mode = rt.rng() < 0.6 ? "phone" : "idle";
        }
      }
      ai.mode = "walk";
      followPath(ai, b, 1.45, dt, w, rt.rng);
      n.anim = "walk";
    } else if (n.kind === "guard") {
      if (ai.idx >= ai.path.length) {
        if (ai.mode === "walk") {
          // 점검: 손을 앞으로 내밀고 잠시 멈춘다
          ai.mode = "inspect";
          ai.waitUntil = s.t + 1800 + rt.rng() * 2200;
          n.anim = "inspect";
          continue;
        }
        const targets = NAV_NODES.filter((q) => q.inspect || (!q.out && q.y === 0 && q.z > 5));
        const to = pick(rt.rng, targets);
        routeTo(ai, b, null, to.id);
      }
      ai.mode = "walk";
      followPath(ai, b, 1.5, dt, w, rt.rng);
      openDoorsNear(rt, b.x, b.y, b.z);
      n.anim = "walk";
    } else if (n.kind === "dog" || n.kind === "cat") {
      const region = n.id % 2 ? PARK : YARD;
      if (!ai.goal) {
        if (ai.mode === "walk" || ai.mode === "run") {
          ai.mode = n.kind === "dog" ? pick(rt.rng, ["sit", "idle", "lie"]) : pick(rt.rng, ["loaf", "idle", "stretch"]);
          ai.waitUntil = s.t + (n.kind === "dog" ? 1500 + rt.rng() * 3500 : 3000 + rt.rng() * 6000);
          n.anim = ai.mode;
          continue;
        }
        ai.goal = randomIn(rt.rng, region);
        ai.path = [];
        ai.idx = 0;
        ai.run = n.kind === "dog" ? rt.rng() < 0.5 : rt.rng() < 0.2;
      }
      ai.mode = ai.run ? "run" : "walk";
      const sp = n.kind === "dog" ? (ai.run ? 4.2 : 1.6) : ai.run ? 3.2 : 1.1;
      followPath(ai, b, sp, dt, w, rt.rng);
      n.anim = ai.mode;
    } else if (n.kind === "vacuum") {
      const dirX = Math.sin(n.yaw);
      const dirZ = Math.cos(n.yaw);
      const moved = stepBody(b, { dx: dirX, dz: dirZ, jump: false }, 0.8, dt, w);
      const out = b.x < LIVING[0] || b.x > LIVING[1] || b.z < LIVING[2] || b.z > LIVING[3];
      if (moved < 0.8 * dt * 0.5 || out) {
        n.yaw += Math.PI * (0.5 + rt.rng());
        if (out) {
          b.x = Math.max(LIVING[0], Math.min(LIVING[1], b.x));
          b.z = Math.max(LIVING[2], Math.min(LIVING[3], b.z));
        }
      }
      n.anim = "walk";
    }
    if (n.kind !== "vacuum") n.yaw = yawOf(b.x - px, b.z - pz, n.yaw);
    n.x = b.x;
    n.y = b.y;
    n.z = b.z;
  }
}

function stepCar(rt: HostRuntime, n: NpcState, dt: number) {
  const s = rt.state;
  const east = n.z < 19.5;
  const dir = east ? 1 : -1;
  // 앞에 건널목 (보행 신호면 그 앞에서 선다)
  const stopLine = east ? ROAD.crossX0 - 2.4 : ROAD.crossX1 + 2.4;
  const before = east ? n.x <= stopLine && n.x > stopLine - 6 : n.x >= stopLine && n.x < stopLine + 6;
  let go = !(s.pedLight && before);
  // 길 위에 누가 서 있으면 선다 (빵빵)
  const ahead = (x: number, z: number) => Math.abs(z - n.z) < 1.4 && (x - n.x) * dir > 0 && (x - n.x) * dir < 4.5;
  if (go) {
    for (const p of s.players) if (visibleOnMap(p, s.phase) && p.y < 1 && ahead(p.x, p.z)) go = false;
    for (const q of s.npcs) if (q.kind !== "car" && ahead(q.x, q.z)) go = false;
    for (const q of s.npcs) if (q.kind === "car" && q.id !== n.id && Math.abs(q.z - n.z) < 1 && (q.x - n.x) * dir > 0 && (q.x - n.x) * dir < 6) go = false;
  }
  if (go) n.x += dir * 6.5 * dt;
  n.anim = go ? "drive" : "stop";
  if (east && n.x > 18) n.x = -20;
  if (!east && n.x < -20) n.x = 18;
  n.yaw = east ? Math.PI / 2 : -Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 분신 (살아 있는 모양이면 그 자리 근처를 어슬렁)

function stepDecoys(rt: HostRuntime, dt: number, world: (e: { decoy?: number }) => CollWorld) {
  const s = rt.state;
  for (const d of s.decoys) {
    const def = disguise(d.disguise);
    const ai = rt.decoyAi.get(d.id);
    if (!def || !ai || def.form === "prop") continue;
    const b = ai.body;
    if (s.t < ai.waitUntil) {
      d.anim = ai.mode;
      continue;
    }
    if (!ai.goal) {
      if (ai.mode === "walk") {
        ai.mode = poseOf(def.form, 1 + Math.floor(rt.rng() * 2)).anim ?? "idle";
        ai.waitUntil = s.t + 1500 + rt.rng() * 3500;
        d.anim = ai.mode;
        continue;
      }
      const home = ai.home!;
      ai.goal = [home[0] + (rt.rng() - 0.5) * 6, home[1], home[2] + (rt.rng() - 0.5) * 6];
      ai.path = [];
      ai.idx = 0;
    }
    ai.mode = "walk";
    const px = b.x;
    const pz = b.z;
    followPath(ai, b, def.speed * 0.9, dt, world({ decoy: d.id }), rt.rng);
    d.yaw = yawOf(b.x - px, b.z - pz, d.yaw);
    d.x = b.x;
    d.y = b.y;
    d.z = b.z;
    d.anim = "walk";
  }
}

// ---------------------------------------------------------------------------
// 봇

function botBody(p: PlayerState): Body {
  const { r, h } = bodySize(p);
  return { x: p.x, y: p.y, z: p.z, vy: p.vy, grounded: p.grounded, r, h };
}

function syncBody(p: PlayerState, b: Body) {
  p.x = b.x;
  p.y = b.y;
  p.z = b.z;
  p.vy = b.vy;
  p.grounded = b.grounded;
}

function stepBots(rt: HostRuntime, dt: number, world: (e: { seat?: number }) => CollWorld) {
  const s = rt.state;
  for (const p of s.players) {
    if (!p.bot) continue;
    let ai = rt.botAi.get(p.seat);
    if (!ai) rt.botAi.set(p.seat, (ai = freshAi()));
    if (p.role === "hider") botHider(rt, p, ai, dt, world({ seat: p.seat }));
    else botSeeker(rt, p, ai, dt, world({ seat: p.seat }));
  }
}

/** 같은 모양의 진짜 물건 옆자리 (봇 숨는 곳) */
function lookalikeSpot(rt: HostRuntime, p: PlayerState): [number, number, number] | null {
  const def = disguise(p.disguise);
  if (!def?.thing) return null;
  const same = [...FIXED_THINGS, ...rt.fillers].filter((t) => t.kind === def.thing);
  if (same.length === 0) return null;
  const t = pick(rt.rng, same);
  const [w, , d] = THING_SIZE[t.kind];
  const a = rt.rng() * Math.PI * 2;
  const off = Math.max(w, d) * 0.5 + def.r + 0.35;
  return [t.x + Math.cos(a) * off, t.y, t.z + Math.sin(a) * off];
}

function hidingGoal(rt: HostRuntime, p: PlayerState): { goal: [number, number, number] | null; node?: number; plan: "hold" | "wander" } {
  const def = disguise(p.disguise);
  const form = def?.form ?? "prop";
  const rng = rt.rng;
  if (form === "person") {
    const n = pick(rng, NAV_NODES.filter((q) => q.out));
    return { goal: null, node: n.id, plan: "wander" };
  }
  if (form === "dog" || form === "cat") return { goal: randomIn(rng, rng() < 0.5 ? PARK : YARD), plan: "wander" };
  if (form === "guard") {
    const n = pick(rng, NAV_NODES.filter((q) => q.inspect));
    return { goal: null, node: n.id, plan: "wander" };
  }
  if (form === "vacuum") return { goal: randomIn(rng, LIVING), plan: "wander" };
  // 물건: 레벨이 높을수록 같은 모양 진짜 옆에 숨는다
  if (rng() < 0.35 + p.level * 0.06) {
    const spot = lookalikeSpot(rt, p);
    if (spot) return { goal: spot, plan: "hold" };
  }
  const n = pick(rng, NAV_NODES);
  const a = rng() * Math.PI * 2;
  return { goal: [n.x + Math.cos(a) * 1.2, n.y, n.z + Math.sin(a) * 1.2], plan: "hold" };
}

function botHider(rt: HostRuntime, p: PlayerState, ai: WalkerAi, dt: number, w: CollWorld) {
  const s = rt.state;
  if (s.phase === "pick") {
    if (!p.disguise && s.t - s.phaseStart > 1500 + ((p.seat * 977) % 3000)) {
      if (p.rerolls > 0 && rt.rng() < 0.15) applyAct(rt, p.seat, { t: "reroll" });
      applyAct(rt, p.seat, { t: "pick", id: pick(rt.rng, p.offer) });
    }
    return;
  }
  if (!visibleOnMap(p, s.phase) || (s.phase !== "hide" && s.phase !== "hunt")) return;
  const def = disguise(p.disguise)!;
  const b = botBody(p);
  const px = b.x;
  const pz = b.z;
  if (!ai.plan) {
    const g = hidingGoal(rt, p);
    ai.plan = g.plan;
    routeTo(ai, b, g.goal, g.node);
    ai.run = true;
    ai.decoyAt = p.level >= 3 && rt.rng() < 0.6 ? 0.5 : -1;
  }
  // 꼼꼼이: 찜 장소가 열리면 달려갈지 정한다
  if (s.goal?.open && ai.plan !== "goal" && rt.rng() < dt * (0.02 + p.level * 0.006)) {
    const g = GOAL_SLOTS[s.goal.slot];
    ai.plan = "goal";
    routeTo(ai, b, [g.x, slotY(g), g.z]);
    ai.run = true;
  }
  let moving = false;
  if (s.t >= ai.waitUntil) {
    const seekerNear = s.players.some((q) => q.role === "seeker" && q.alive && Math.hypot(q.x - b.x, q.z - b.z) < 3.5);
    if (ai.plan === "hold" && ai.idx >= ai.path.length && !ai.goal) {
      // 가만히 — 낮은 레벨은 술래가 코앞이면 겁먹고 뛰기도 한다
      if (seekerNear && s.phase === "hunt" && rt.rng() < dt * (0.5 - p.level * 0.045)) {
        const g = hidingGoal(rt, p);
        routeTo(ai, b, g.goal, g.node);
        ai.run = true;
      }
    } else if (ai.plan === "wander" && ai.idx >= ai.path.length && !ai.goal) {
      // 살아 있는 모양: NPC처럼 쉬었다 걷기
      if (ai.mode === "walk") {
        ai.mode = poseOf(def.form, 1 + Math.floor(rt.rng() * 2)).anim ?? "idle";
        ai.waitUntil = s.t + 1500 + rt.rng() * 4000;
      } else {
        const g = hidingGoal(rt, p);
        routeTo(ai, b, g.goal, g.node);
        ai.run = s.phase === "hide" && rt.rng() < 0.5;
        ai.mode = "walk";
      }
    } else {
      const sp = def.speed * (ai.run && !(seekerNear && p.level >= 5) ? RUN_MULT : 1);
      const r = followPath(ai, b, sp, dt, w, rt.rng, () => p.tp++);
      openDoorsNear(rt, b.x, b.y, b.z);
      moving = r === "moving";
      if (r === "arrived") {
        ai.run = false;
        if (ai.plan === "hold") {
          p.pose = Math.floor(rt.rng() * (def.form === "prop" ? 4 : 2));
          p.yaw = Math.floor(rt.rng() * 4) * (Math.PI / 2);
        }
      }
      // 가는 길 중간쯤에 분신을 하나 떨군다
      if (ai.decoyAt > 0 && ai.path.length > 2 && ai.idx >= ai.path.length * ai.decoyAt) {
        ai.decoyAt = -1;
        applyAct(rt, p.seat, { t: "decoy" });
      }
    }
  }
  syncBody(p, b);
  if (moving) {
    if (def.form !== "prop" && def.form !== "vacuum") p.yaw = yawOf(b.x - px, b.z - pz, p.yaw);
    rt.movedAt.set(p.seat, s.t);
    p.anim = ai.run ? "run" : "walk";
    p.pose = def.form === "prop" ? p.pose : 0;
  } else {
    p.anim = def.form === "prop" ? "idle" : (poseOf(def.form, p.pose).anim ?? "idle");
    if (ai.plan === "wander" && s.t < ai.waitUntil) p.anim = ai.mode;
  }
}

interface Suspect {
  kind: "p" | "n" | "d" | "t";
  id: number | string;
  x: number;
  y: number;
  z: number;
  h: number;
}

function botSeeker(rt: HostRuntime, p: PlayerState, ai: WalkerAi, dt: number, w: CollWorld) {
  const s = rt.state;
  if (s.phase !== "hunt" || !p.alive) return;
  const b = botBody(p);
  const px = b.x;
  const pz = b.z;
  const weapon = currentWeapon(s);
  const lvl = p.level;
  const solids = allSolids(rt);
  const eye: [number, number, number] = [b.x, b.y + 1.55, b.z];

  // 1) 둘러보기: 눈에 띄는 것 중 수상한 것을 고른다
  if (!ai.focus && s.t >= ai.nextScan) {
    ai.nextScan = s.t + 450;
    const view = weapon.kind === "melee" ? 9 : Math.min(weapon.range * 0.8, 28);
    const cands: { sus: Suspect; chance: number }[] = [];
    const consider = (sus: Suspect, chance: number) => {
      const d = Math.hypot(sus.x - b.x, sus.z - b.z);
      if (d > view || Math.abs(sus.y - b.y) > 2.2) return;
      if (!lineOfSight(solids, eye, [sus.x, sus.y + sus.h * 0.6, sus.z])) return;
      cands.push({ sus, chance: chance * (1.4 - d / view) });
    };
    for (const q of s.players) {
      if (q.role !== "hider" || !visibleOnMap(q, s.phase)) continue;
      const def = disguise(q.disguise);
      const movedAgo = s.t - (rt.movedAt.get(q.seat) ?? -1e9);
      const moving = movedAgo < 600;
      const base = def?.form === "prop" ? (moving ? 0.45 : 0.012 + lvl * 0.005) : 0.008 + lvl * 0.003 + (moving && def?.form === "vacuum" ? 0.05 : 0);
      consider({ kind: "p", id: q.seat, x: q.x, y: q.y, z: q.z, h: bodySize(q).h }, base);
    }
    for (const d of s.decoys) {
      const def = disguise(d.disguise);
      consider({ kind: "d", id: d.id, x: d.x, y: d.y, z: d.z, h: def?.h ?? 1 }, def?.form === "prop" ? 0.012 + lvl * 0.005 : 0.008 + lvl * 0.003);
    }
    for (const n of s.npcs) {
      if (n.kind === "car") continue;
      consider({ kind: "n", id: n.id, x: n.x, y: n.y, z: n.z, h: npcSize(n.kind).h }, 0.004 * (11 - lvl));
    }
    for (const t of [...FIXED_THINGS, ...rt.fillers]) {
      if (!DISGUISES.some((d) => d.thing === t.kind)) continue;
      if (Math.abs(t.x - b.x) > view || Math.abs(t.z - b.z) > view) continue;
      consider({ kind: "t", id: t.id, x: t.x, y: t.y, z: t.z, h: THING_SIZE[t.kind][1] }, 0.003 * (11 - lvl));
    }
    for (const c of cands) {
      if (rt.rng() < c.chance) {
        ai.focus = { kind: c.sus.kind, id: c.sus.id };
        ai.focusUntil = s.t + 7000;
        ai.path = [];
        ai.goal = null;
        break;
      }
    }
  }

  // 2) 노리는 게 있으면 다가가서 친다
  let moving = false;
  if (ai.focus) {
    const f = ai.focus;
    let sus: Suspect | null = null;
    if (f.kind === "p") {
      const q = s.players[f.id as number];
      if (q && visibleOnMap(q, s.phase)) sus = { kind: "p", id: q.seat, x: q.x, y: q.y, z: q.z, h: bodySize(q).h };
    } else if (f.kind === "d") {
      const d = s.decoys.find((x) => x.id === f.id);
      if (d) sus = { kind: "d", id: d.id, x: d.x, y: d.y, z: d.z, h: disguise(d.disguise)?.h ?? 1 };
    } else if (f.kind === "n") {
      const n = s.npcs.find((x) => x.id === f.id);
      if (n) sus = { kind: "n", id: n.id, x: n.x, y: n.y, z: n.z, h: npcSize(n.kind).h };
    } else {
      const t = [...FIXED_THINGS, ...rt.fillers].find((x) => x.id === f.id);
      if (t) sus = { kind: "t", id: t.id, x: t.x, y: t.y, z: t.z, h: THING_SIZE[t.kind][1] };
    }
    if (!sus || s.t > ai.focusUntil) {
      ai.focus = null;
    } else {
      const dx = sus.x - b.x;
      const dz = sus.z - b.z;
      const dist = Math.hypot(dx, dz);
      const reach = weapon.kind === "melee" ? weapon.range * 0.75 : Math.min(weapon.range * 0.7, 18);
      p.yaw = Math.atan2(dx, dz);
      if (dist > reach) {
        const st = stepBody(b, { dx: dx / dist, dz: dz / dist, jump: ai.stuck > 0.6 }, SEEKER_SPEED * RUN_MULT * 0.8, dt, w);
        if (st < 0.05 * dt) ai.stuck += dt;
        else ai.stuck = 0;
        if (ai.stuck > 2) ai.focus = null;
        moving = true;
      } else if (s.t >= p.nextAtkAt && (weapon.kind === "melee" || p.ammo > 0)) {
        const err = (11 - lvl) * 0.014;
        const ty = sus.y + sus.h * 0.5;
        const ad: [number, number, number] = [dx + (rt.rng() - 0.5) * err * dist * 2, ty - eye[1] + (rt.rng() - 0.5) * err * dist, dz + (rt.rng() - 0.5) * err * dist * 2];
        syncBody(p, b);
        attack(rt, p, eye, ad);
        // 맞혔든 틀렸든 잠깐 뒤 다시 생각
        if (f.kind !== "p" || !visibleOnMap(s.players[f.id as number], s.phase) || rt.rng() < 0.5) ai.focus = null;
        p.anim = weapon.kind === "melee" ? "inspect" : "aim";
        return;
      }
    }
  }

  // 3) 아니면 순찰 (안 가 본 곳 위주)
  if (!ai.focus && !moving) {
    if (ai.idx >= ai.path.length && !ai.goal) {
      const here = nearestNode(b.x, b.y, b.z);
      ai.visited.add(here);
      const pool = NAV_NODES.filter((n) => !ai.visited.has(n.id));
      const to = pick(rt.rng, pool.length > 0 ? pool : NAV_NODES);
      if (pool.length === 0) ai.visited.clear();
      routeTo(ai, b, null, to.id);
    }
    const r = followPath(ai, b, SEEKER_SPEED * (lvl >= 5 ? RUN_MULT * 0.8 : 1.5), dt, w, rt.rng, () => p.tp++);
    openDoorsNear(rt, b.x, b.y, b.z);
    if (r === "moving") {
      moving = true;
      ai.visited.add(nearestNode(b.x, b.y, b.z));
    }
  }
  syncBody(p, b);
  if (moving) p.yaw = yawOf(b.x - px, b.z - pz, p.yaw);
  p.anim = moving ? "run" : "idle";
}

// ---------------------------------------------------------------------------
// 결과

export function computeRankings(state: MatchState): { seat: number; rank: number }[] {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  let rank = 0;
  let last = Infinity;
  return sorted.map((p, i) => {
    if (p.score !== last) {
      rank = i + 1;
      last = p.score;
    }
    return { seat: p.seat, rank };
  });
}

/** 방 바닥 높이 범위 확인용 (테스트) */
export const _internal = { ROOMS, FLOOR, LADDER };
