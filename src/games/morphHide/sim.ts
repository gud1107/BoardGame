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
  NAV_EDGES,
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
  GOAL_RADIUS,
  HIDE_SEC,
  KKOM_CALL_R,
  KKOM_CAMP_MS,
  KKOM_CAMP_R,
  KKOM_ERRANDS,
  KKOM_HIDE_MAX,
  KKOM_HIDE_MIN,
  PICK_SEC,
  REROLLS,
  ROUND_END_SEC,
  RUN_MULT,
  SEEKER_HP,
  SPAM_STEP,
  SPAM_WINDOW_MS,
  CATCH_HEAL,
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
import { hiderParamsFor, seekerParamsFor, type HiderParams, type SeekerParams } from "./botParams";
import { AUG_N, AUG_PICKS, AUG_REROLLS, HIDER_AUG_PICKS, aug, augAmmo, augCooldownMult, augMaxHp, augSpeedMult, hasAug, rollAugOffer } from "./augments";

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
  /** 이번 라운드에 나를 잡은 술래 (-1 = 꼼꼼이 "찾는다!"에 아웃) */
  caughtBy: number | null;
  /** 최근 헛손질 시각들 (연속 가중) */
  wrongAt: number[];
  /** 꼼꼼이: 기지 옆에 붙어 있던 시간 (ms, 집 지키기) */
  campMs: number;
  /** 술래 증강 (이번 라운드) — augments.ts */
  augs: string[];
  augOffer: string[];
  augRerolls: number;
  maxHp: number;
  /** 보호막 남은 횟수 · 덫 · 충격파 */
  shieldLeft: number;
  traps: number;
  shocks: number;
  resolveUsed: boolean;
  /** 추격 본능이 끝나는 시각 */
  hunterUntil: number;
  /** 숨는 쪽 재변신 남은 횟수 (shieldLeft는 숨는 쪽에선 갑옷) */
  remorphs: number;
  /** 육감: 2m 안에 숨은 사람이 있다 */
  sense: boolean;
  /** 증강 타이머 (다음 레이더·냄새 등 시각) */
  augT: Record<string, number>;
  stats: PlayerStats;
}

/** 증강이 지도·화면에 찍는 표시 (술래만 그린다) */
export interface PingState {
  id: number;
  owner: number;
  kind: "scent" | "last" | "trap" | "shock" | "ear";
  x: number;
  y: number;
  z: number;
  r: number;
  until: number;
}

export interface TrapState {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
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
  | { id: number; at: number; type: "kkomCall"; out: number[] }
  | { id: number; at: number; type: "escape"; seat: number }
  | { id: number; at: number; type: "phase"; phase: Phase; round: number }
  | { id: number; at: number; type: "aug"; seat: number; aug: string }
  /** 술래 한 명에게만 보이는 증강 알림 */
  | { id: number; at: number; type: "intel"; seat: number; icon: string; text: string }
  /** 증강 표시가 찍혔다 — notify = 들킨(근처에 있던) 숨는 사람 */
  | { id: number; at: number; type: "ping"; seat: number; kind: PingState["kind"]; notify: number[] }
  | { id: number; at: number; type: "shock"; seat: number; x: number; y: number; z: number }
  | { id: number; at: number; type: "roundEnd"; winner: "seekers" | "hiders" };

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

export interface RoundSummary {
  round: number;
  seekers: number[];
  winner: "seekers" | "hiders";
  hiders: { seat: number; disguise: string | null; result: "survived" | "escaped" | "caught"; by?: number }[];
  /** 그 라운드에 자리마다 고른 증강 (고른 순서) — 라운드가 끝나면 모두에게 공개 */
  augs?: Record<number, string[]>;
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
  goal: { slot: number; open: boolean; errand?: number } | null;
  /** 보행 신호 (true = 사람 건너는 신호) */
  pedLight: boolean;
  events: GameEvent[];
  nextEventId: number;
  history: RoundSummary[];
  winners: number[] | null;
  /** 지금 술래 무기 단계 */
  tier: number;
  traps: TrapState[];
  pings: PingState[];
  nextAugId: number;
  /** 연장전·급한 술래는 라운드당 한 번만 */
  overtimeDone: boolean;
  hastyDone: boolean;
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
    caughtBy: null,
    wrongAt: [],
    campMs: 0,
    augs: [],
    augOffer: [],
    augRerolls: AUG_REROLLS,
    maxHp: SEEKER_HP,
    shieldLeft: 0,
    traps: 0,
    shocks: 0,
    resolveUsed: false,
    hunterUntil: 0,
    remorphs: 0,
    sense: false,
    augT: {},
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
    traps: [],
    pings: [],
    nextAugId: 1,
    overtimeDone: false,
    hastyDone: false,
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
  /** 술래 봇 기억: 본 모양들, 본 자리(2m 칸), 헛친 것 */
  mem: Map<string, SeenRec>;
  viewed: Map<string, number>;
  struck: Set<string>;
  tries: number;
}

function freshAi(): WalkerAi {
  return { path: [], idx: 0, goal: null, waitUntil: 0, stuck: 0, lastX: 0, lastZ: 0, mode: "idle", focus: null, focusUntil: 0, nextScan: 0, visited: new Set(), run: false, plan: null, decoyAt: 0, home: null, lastMoveAt: -1e9, movedRecently: false, mem: new Map(), viewed: new Map(), struck: new Set(), tries: 0 };
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
  /** 셀프플레이 학습용: 모든 봇에 이 정책을 쓴다 */
  overrides?: { hider?: HiderParams; seeker?: SeekerParams };
  /** 이번 판 맵의 변신 가능한 물건들 (술래 봇 관찰용) */
  thingObs: Obs[];
  /** 길찾기 점마다 근처(7m) 변신 후보 물건 수 */
  nodeDensity: number[];
  /** 정보원 증강: 술래 자리 → 이번 판 변신 id 목록 (봇 판단용) */
  dossier: Map<number, string[]>;
  /** 밸런스 측정용: 봇이 이 증강만 (순서대로) 고른다 — 빈 배열이면 증강 없음 */
  forceAugs?: { seeker?: string[]; hider?: string[] };
}

export function createHost(state: MatchState): HostRuntime {
  const { grid, fillers } = roundGrid(state.seed, Math.max(1, state.round));
  const rt: HostRuntime = { state, grid, fillers, rng: mulberry(state.seed ^ 0x5bd1e995), npcAi: new Map(), botAi: new Map(), decoyAi: new Map(), movedAt: new Map(), lightT: 0, nextDecoyId: 1, thingObs: [], nodeDensity: [], dossier: new Map() };
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
  const disguiseKinds = new Set(DISGUISES.map((d) => d.thing).filter(Boolean));
  rt.thingObs = [...FIXED_THINGS, ...fillers]
    .filter((t) => disguiseKinds.has(t.kind))
    .map((t) => ({ key: `t${t.id}`, x: t.x, y: t.y, z: t.z, h: THING_SIZE[t.kind][1], form: "prop" as FormKind, thing: t.kind, anim: "idle", tipped: false }));
  rt.nodeDensity = NAV_NODES.map((n) => rt.thingObs.filter((o) => Math.abs(o.y - n.y) < 1 && Math.hypot(o.x - n.x, o.z - n.z) < 7).length / 4);
  const k = seekerCount(s.seatCount);
  const first = Math.max(0, s.options.firstSeeker ?? 0);
  s.seekers = Array.from({ length: k }, (_, i) => (first + (s.round - 1) * k + i) % s.seatCount);
  // 꼼꼼이: 잡힌 사람이 다음 술래 (먼저 잡힌 순). 아무도 안 잡혔으면 술래가 한 번 더, 모자라면 순서대로 채운다
  const last = s.history[s.history.length - 1];
  if (s.options.goalMode && last) {
    const caught = s.players.filter((p) => last.hiders.some((h) => h.seat === p.seat && h.result === "caught")).sort((a, b) => (a.caughtAt ?? 0) - (b.caughtAt ?? 0));
    const next: number[] = caught.map((p) => p.seat).slice(0, k);
    for (const q of [...last.seekers, ...s.seekers]) if (next.length < k && !next.includes(q)) next.push(q);
    s.seekers = next;
  }
  s.decoys = [];
  s.traps = [];
  s.pings = [];
  s.overtimeDone = false;
  s.hastyDone = false;
  rt.decoyAi.clear();
  rt.botAi.clear();
  rt.movedAt.clear();
  rt.dossier.clear();
  s.doors = DOORS.map((d) => d.open);
  s.windows = WINDOWS.map(() => false);
  // 보물 상자 3개, 찜 장소 1곳
  const chestSlots = CHEST_SLOTS.map((_, i) => i).sort(() => rt.rng() - 0.5);
  s.chests = chestSlots.slice(0, 3).map((slot) => ({ slot, opened: false }));
  s.goal = s.options.goalMode ? { slot: 0, open: true, errand: Math.floor(rt.rng() * KKOM_ERRANDS.length) } : null;
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
    p.caughtBy = null;
    p.wrongAt = [];
    p.campMs = 0;
    p.augs = [];
    p.augOffer = seeker ? rollAugOffer(rt.rng, 0, s.options.goalMode, []) : rollAugOffer(rt.rng, 0, s.options.goalMode, [], [], "hider");
    p.augRerolls = AUG_REROLLS;
    p.maxHp = SEEKER_HP;
    p.shieldLeft = 0;
    p.traps = 0;
    p.shocks = 0;
    p.resolveUsed = false;
    p.hunterUntil = 0;
    p.remorphs = 0;
    p.sense = false;
    p.augT = {};
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
  /** b = 쏜 사람 기기에서의 내 몸 위치 [x, z] (방장 위치가 늦게 도착한 만큼 보정, 꼼꼼이 집 지키기 판정용) */
  | { t: "atk"; o: [number, number, number]; d: [number, number, number]; b?: [number, number] }
  | { t: "door"; id: number }
  | { t: "window"; id: number }
  | { t: "chest"; slot: number }
  | { t: "decoy" }
  | { t: "emote"; id: string }
  /** 술래 증강 고르기 / 다시 뽑기 / 덫 놓기 / 충격파 */
  | { t: "aug"; id: string }
  | { t: "augReroll" }
  | { t: "trap" }
  | { t: "shock" }
  /** 숨는 쪽 재변신 증강: 처음 받은 카드 중 다른 모양으로 */
  | { t: "remorph"; id: string };

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
      attack(rt, p, act.o, act.d, act.b);
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
        p.decoys += hasAug(p, "h_chest") ? 2 : 1;
        emit(s, { type: "chest", seat, slot: c.slot, reward: "decoy" });
      } else {
        const big = hasAug(p, "chest");
        const count = s.players.filter((q) => q.role === "hider" && visibleOnMap(q, s.phase) && Math.hypot(q.x - p.x, q.z - p.z) <= (big ? AUG_N.chestR : 12)).length;
        if (big) p.hp = Math.min(p.maxHp, p.hp + AUG_N.chestHeal);
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
      // 내가 지금 서 있는 자리에 똑같은 모양을 하나 더 (분신은 몸이 없어 겹쳐도 안 막힌다 — 떠나면 그 자리에 남는다)
      const ox = p.x;
      const oz = p.z;
      s.decoys.push({ id, owner: seat, disguise: p.disguise, pose: p.pose, x: ox, y: p.y, z: oz, yaw: p.yaw, anim: def.form === "prop" ? "idle" : "idle" });
      rt.decoyAi.set(id, { ...freshAi(), body: { x: ox, y: p.y, z: oz, vy: 0, grounded: true, r: def.r, h: def.h }, home: [ox, p.y, oz] });
      emit(s, { type: "decoy", seat });
      return;
    }
    case "aug": {
      if (s.phase !== "pick" && s.phase !== "hide") return;
      if (!p.augOffer.includes(act.id)) return;
      if (p.role === "hider") {
        if (p.augs.length < HIDER_AUG_PICKS) takeAug(rt, p, act.id);
        return;
      }
      if (p.augs.length >= AUG_PICKS) return;
      // 1번째는 고르기·숨기 단계 아무 때나, 2번째는 숨는 시간에만
      if (s.phase === "pick" && p.augs.length >= 1) return;
      takeAug(rt, p, act.id);
      return;
    }
    case "augReroll": {
      if ((s.phase !== "pick" && s.phase !== "hide") || p.augRerolls <= 0 || p.augOffer.length === 0) return;
      p.augRerolls -= 1;
      p.augOffer = rollAugOffer(rt.rng, p.augs.length, s.options.goalMode, p.augs, p.augOffer, p.role);
      return;
    }
    case "remorph": {
      if ((s.phase !== "hide" && s.phase !== "hunt") || p.role !== "hider" || !visibleOnMap(p, s.phase) || p.remorphs <= 0) return;
      if (!p.offer.includes(act.id) || act.id === p.disguise) return;
      p.remorphs -= 1;
      p.disguise = act.id;
      p.pose = 0;
      rt.movedAt.set(seat, s.t);
      emit(s, { type: "intel", seat, icon: "🎭", text: `재변신 — ${disguise(act.id)?.name ?? "?"}(으)로 바꿨어요` });
      return;
    }
    case "trap": {
      if (s.phase !== "hunt" || p.role !== "seeker" || !p.alive || p.traps <= 0) return;
      // 덫끼리 너무 붙이면 하나로 친다
      if (s.traps.some((t) => t.owner === seat && Math.hypot(t.x - p.x, t.z - p.z) < 2)) return;
      p.traps -= 1;
      s.traps.push({ id: s.nextAugId++, owner: seat, x: r2(p.x), y: r2(p.y), z: r2(p.z) });
      emit(s, { type: "intel", seat, icon: "🔔", text: `방울 덫을 놓았어요 (남은 덫 ${p.traps})` });
      return;
    }
    case "shock": {
      if (s.phase !== "hunt" || p.role !== "seeker" || !p.alive || p.shocks <= 0) return;
      p.shocks -= 1;
      const hit = hidersNear(s, p.x, p.y, p.z, AUG_N.shockR, 2.5);
      for (const q of hit) addPing(s, p.seat, "shock", q.x, q.y, q.z, 0.9, AUG_N.shockMs);
      emit(s, { type: "shock", seat, x: r2(p.x), y: r2(p.y), z: r2(p.z) });
      if (hit.length) emit(s, { type: "ping", seat, kind: "shock", notify: hit.map((q) => q.seat) });
      emit(s, { type: "intel", seat, icon: "💥", text: hit.length ? `충격파! 숨은 사람 ${hit.length}명이 드러났어요` : "충격파 — 6m 안엔 아무도 없어요" });
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
// 술래 증강

function addPing(s: MatchState, owner: number, kind: PingState["kind"], x: number, y: number, z: number, r: number, ms: number) {
  s.pings.push({ id: s.nextAugId++, owner, kind, x: r2(x), y: r2(y), z: r2(z), r, until: s.t + ms });
}

/** 숨은 사람이 원 안 어딘가에 있도록 중심을 흔든다 (정확한 위치를 주지 않는다) */
function fuzzPing(rt: HostRuntime, x: number, z: number, r: number): [number, number] {
  const a = rt.rng() * Math.PI * 2;
  const d = Math.sqrt(rt.rng()) * r * 0.65;
  return [x + Math.cos(a) * d, z + Math.sin(a) * d];
}

function takeAug(rt: HostRuntime, p: PlayerState, id: string) {
  const s = rt.state;
  if (!aug(id) || p.augs.includes(id)) return;
  p.augs.push(id);
  p.augOffer = [];
  if (p.role === "hider") {
    if (id === "h_decoy") p.decoys += 1;
    if (id === "h_armor") p.shieldLeft = 1;
    if (id === "h_remorph") p.remorphs = 1;
    // 숨는 쪽 증강은 술래에게 안 알린다 (이벤트 없음)
    return;
  }
  // 몸에 바로 붙는 것
  const nextMax = augMaxHp(SEEKER_HP, p.augs);
  p.hp += nextMax - p.maxHp;
  p.maxHp = nextMax;
  if (id === "shield") p.shieldLeft = AUG_N.shieldHits;
  if (id === "hasty" && !s.hastyDone && s.phase === "hide") {
    s.hastyDone = true;
    s.phaseEnd = Math.max(s.t + 3000, s.phaseEnd - AUG_N.hastyMs);
  }
  emit(s, { type: "aug", seat: p.seat, aug: id });
  // 숨는 시간에 1번째를 골랐으면 바로 2번째를
  if (s.phase === "hide" && p.augs.length < AUG_PICKS) p.augOffer = rollAugOffer(rt.rng, p.augs.length, s.options.goalMode, p.augs);
}

/** 봇·시간 초과: 3장 중 하나 (봇은 선호도 + 레벨이 낮을수록 막 고른다) */
function autoAug(rt: HostRuntime, p: PlayerState) {
  if (p.augOffer.length === 0) return;
  const forced = rt.forceAugs?.[p.role];
  if (forced && p.bot) {
    const id = forced.find((x) => !p.augs.includes(x));
    if (id) takeAug(rt, p, id);
    p.augOffer = [];
    return;
  }
  if (!p.bot) {
    takeAug(rt, p, pick(rt.rng, p.augOffer));
    return;
  }
  const noise = p.level <= 3 ? 10 : p.level <= 6 ? 5 : 2;
  let best = p.augOffer[0];
  let bs = -Infinity;
  for (const id of p.augOffer) {
    const sc = (aug(id)?.bot ?? 0) + rt.rng() * noise;
    if (sc > bs) {
      bs = sc;
      best = id;
    }
  }
  takeAug(rt, p, best);
}

/** 헛손질 벌점 (증강 반영) — what: 무엇을 잘못 쳤나 */
export function wrongPenalty(s: Pick<MatchState, "t">, p: PlayerState, w: WeaponDef, what: "npc" | "prop" | "decoy" | null): number {
  const recent = p.wrongAt.filter((t) => s.t - t < SPAM_WINDOW_MS).length;
  if (p.shieldLeft > 0 || (hasAug(p, "hunter") && s.t < p.hunterUntil)) return 0;
  let m = 1 + (hasAug(p, "steady") ? 0 : SPAM_STEP * recent);
  if (hasAug(p, "calm")) m *= AUG_N.calm;
  if (hasAug(p, "sixth")) m *= AUG_N.sixthPen;
  if (what === "npc" && hasAug(p, "npcpass")) m *= AUG_N.npcpass;
  if ((what === "prop" || what === "decoy") && hasAug(p, "propeye")) m *= AUG_N.propeye;
  return Math.round(w.penalty * m);
}

function hidersNear(s: MatchState, x: number, y: number, z: number, r: number, dy = 2.4, immune?: string): PlayerState[] {
  return s.players.filter((q) => q.role === "hider" && visibleOnMap(q, s.phase) && Math.hypot(q.x - x, q.z - z) <= r && Math.abs(q.y - y) < dy && !(immune && hasAug(q, immune)));
}

/** 사냥이 시작될 때: 연장전·탄창·정찰·정보원·덫·충격파 */
function augHuntStart(rt: HostRuntime) {
  const s = rt.state;
  for (const p of s.players) {
    if (p.role !== "seeker") continue;
    p.ammo = augAmmo(p.ammo, p.augs);
    if (hasAug(p, "trap")) p.traps = AUG_N.trapCount;
    if (hasAug(p, "shock")) p.shocks = AUG_N.shockCount;
    p.augT = { radar: s.t + AUG_N.radarMs, scent: s.t + AUG_N.scentMs / 2, ear: s.t + AUG_N.earMs, last: s.t, camp: s.t };
    if (hasAug(p, "overtime") && !s.overtimeDone) {
      s.overtimeDone = true;
      s.phaseEnd += AUG_N.overtimeMs;
      emit(s, { type: "intel", seat: p.seat, icon: "⏱️", text: "연장전 — 술래 시간 +40초" });
    }
    const hiders = s.players.filter((q) => q.role === "hider" && visibleOnMap(q, s.phase));
    if (hasAug(p, "scout")) {
      const inside = hiders.filter((q) => isIndoor(q.x, q.y + 0.1, q.z)).length;
      emit(s, { type: "intel", seat: p.seat, icon: "🔭", text: `첫 정찰 — 집 안 ${inside}명 · 밖 ${hiders.length - inside}명` });
    }
    if (hasAug(p, "dossier")) {
      const names = hiders.map((q) => disguise(q.disguise)?.name ?? "?").sort();
      emit(s, { type: "intel", seat: p.seat, icon: "🗂️", text: `정보원 — 이번 판 변신: ${names.join(", ")}` });
      rt.dossier.set(p.seat, hiders.map((q) => q.disguise ?? ""));
    }
  }
}

/** 사냥 중 매 틱: 레이더·귀·냄새·마지막 사냥·경보·육감·덫 */
function augHuntTick(rt: HostRuntime) {
  const s = rt.state;
  s.pings = s.pings.filter((g) => g.until > s.t);
  const alive = s.players.filter((q) => q.role === "hider" && visibleOnMap(q, s.phase));
  // 숨는 쪽 위험 감지: 술래가 10m 안에서 나를 보고 있나 (0.25초마다)
  for (const q of alive) {
    if (!hasAug(q, "h_danger") || s.t < (q.augT.danger ?? 0)) continue;
    q.augT.danger = s.t + 250;
    const { h } = bodySize(q);
    q.sense = seekersSeeing(rt, q.x, q.y, q.z, h).some((k) => Math.hypot(k.x - q.x, k.z - q.z) <= AUG_N.hDangerR);
  }
  for (const p of s.players) {
    if (p.role === "hider") continue;
    if (p.role !== "seeker" || !p.alive || p.augs.length === 0) {
      p.sense = false;
      continue;
    }
    const T = p.augT;
    p.sense = hasAug(p, "sixth") && alive.some((q) => Math.hypot(q.x - p.x, q.z - p.z) <= AUG_N.sixthR && Math.abs(q.y - p.y) < 2);
    if (hasAug(p, "radar") && s.t >= T.radar) {
      T.radar = s.t + AUG_N.radarMs;
      emit(s, { type: "intel", seat: p.seat, icon: "📡", text: `레이더 — 반경 15m 안 숨은 사람 ${hidersNear(s, p.x, p.y, p.z, AUG_N.radarR, 99, "h_perfume").length}명` });
    }
    if (hasAug(p, "ear") && s.t >= T.ear) {
      T.ear = s.t + AUG_N.earMs;
      const movers = hidersNear(s, p.x, p.y, p.z, AUG_N.earR, 2.4, "h_silent").filter((q) => s.t - (rt.movedAt.get(q.seat) ?? -1e9) < 1200);
      if (movers.length) {
        const q = movers.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
        const [x, z] = fuzzPing(rt, q.x, q.z, AUG_N.earPingR);
        addPing(s, p.seat, "ear", x, q.y, z, AUG_N.earPingR, 2500);
        emit(s, { type: "ping", seat: p.seat, kind: "ear", notify: [] });
      }
    }
    const smelly = alive.filter((q) => !hasAug(q, "h_perfume"));
    if (hasAug(p, "scent") && s.t >= T.scent && smelly.length) {
      T.scent = s.t + AUG_N.scentMs;
      const q = pick(rt.rng, smelly);
      const [x, z] = fuzzPing(rt, q.x, q.z, AUG_N.scentR);
      addPing(s, p.seat, "scent", x, q.y, z, AUG_N.scentR, 9000);
      emit(s, { type: "ping", seat: p.seat, kind: "scent", notify: [q.seat] });
    }
    if (hasAug(p, "lastone") && alive.length === 1 && smelly.length === 1 && s.t >= T.last) {
      T.last = s.t + AUG_N.lastMs;
      const q = alive[0];
      const [x, z] = fuzzPing(rt, q.x, q.z, AUG_N.lastR);
      addPing(s, p.seat, "last", x, q.y, z, AUG_N.lastR, 7000);
      emit(s, { type: "ping", seat: p.seat, kind: "last", notify: [q.seat] });
    }
    if (hasAug(p, "camp") && s.goal && s.t >= T.camp) {
      const n = hidersNear(s, BASE.x, 0, BASE.z, AUG_N.campR).length;
      if (n > 0) {
        T.camp = s.t + AUG_N.campMs;
        emit(s, { type: "intel", seat: p.seat, icon: "🚨", text: `전봇대 경보 — 기지 10m 안에 ${n}명!` });
      }
    }
  }
  // 덫: 숨은 사람이 밟으면 딸랑
  for (const tr of [...s.traps]) {
    const q = alive.find((h) => !hasAug(h, "h_silent") && Math.hypot(h.x - tr.x, h.z - tr.z) <= AUG_N.trapR && Math.abs(h.y - tr.y) < 1.2);
    if (!q) continue;
    s.traps = s.traps.filter((t) => t.id !== tr.id);
    const [x, z] = fuzzPing(rt, q.x, q.z, 3);
    addPing(s, tr.owner, "trap", x, q.y, z, 3, 7000);
    emit(s, { type: "ping", seat: tr.owner, kind: "trap", notify: [q.seat] });
    emit(s, { type: "intel", seat: tr.owner, icon: "🔔", text: "딸랑! 덫을 누가 밟았어요" });
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

/** 술래가 지금 기지(전봇대) 반경 안인가 — 손님 기기가 보낸 위치를 쓰되, 방장이 아는 위치에서 너무 멀면 무시 */
export function inCampZone(p: Pick<PlayerState, "x" | "y" | "z">, reported?: [number, number]): boolean {
  let x = p.x;
  let z = p.z;
  if (reported && reported.every(Number.isFinite) && Math.hypot(reported[0] - p.x, reported[1] - p.z) <= CAMP_TRUST_M) [x, z] = reported;
  return Math.hypot(x - BASE.x, z - BASE.z) <= KKOM_CAMP_R && p.y < 1.5;
}
/** 위치 보고 지연(0.1초 간격 + 전송) 동안 달릴 수 있는 거리보다 넉넉히 */
const CAMP_TRUST_M = 2.5;

function attack(rt: HostRuntime, p: PlayerState, o: [number, number, number], d: [number, number, number], b?: [number, number]) {
  const s = rt.state;
  if (s.phase !== "hunt" || p.role !== "seeker" || !p.alive || s.t < p.nextAtkAt) return;
  const w = currentWeapon(s);
  if (w.kind === "ray" && p.ammo <= 0) return;
  // 꼼꼼이 집 지키기: 기지 옆에 오래 붙어 있던 술래가 "지금도" 기지 안에서 휘두르면 못 잡는다.
  // 기지를 벗어나는 순간 바로 풀린다 (게이지가 남아 있어도) — 내 화면 위치(b) 기준.
  const camping = !!s.goal && p.campMs >= KKOM_CAMP_MS && inCampZone(p, b);
  if (![...o, ...d].every(Number.isFinite)) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const dir: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
  p.nextAtkAt = s.t + w.cooldownMs * augCooldownMult(p.augs);
  if (w.kind === "ray") p.ammo -= 1;
  // 내 화면 위치(b)를 믿을 만하면 그 자리에서 휘두른 것으로 — 위치 보고가 늦게 와서 앞에 있는 걸 못 치는 일 방지
  const trusted = !!b && b.every(Number.isFinite) && Math.hypot(b[0] - p.x, b[1] - p.z) <= CAMP_TRUST_M;
  const px = trusted ? b![0] : p.x;
  const pz = trusted ? b![1] : p.z;
  const eye: [number, number, number] = [px, p.y + 1.55, pz];
  const origin: [number, number, number] = Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) <= 7 ? o : eye;
  const targets = targetsFor(s, p.seat);
  const bodies = targets.map((t) => t.body);
  const solids = allSolids(rt);
  const skipGlass = (sol: Solid) => sol.k === "glass";
  let resolved = false;
  let wrongWhat: string | null = null;
  /** 잘못 친 것의 종류·자리 (증강: 벌점 할인·헛손질 단서·분신 감별) */
  let wrongKind: "npc" | "prop" | "decoy" | null = null;
  let wrongAt: [number, number, number] = [p.x, p.y, p.z];
  let wrongDecoy: number | null = null;
  const noteWrong = (t: Target | null, sol?: Solid) => {
    if (t) {
      wrongKind = t.kind === "n" ? "npc" : "decoy";
      wrongAt = [t.body.x, t.body.y, t.body.z];
      if (t.kind === "d") wrongDecoy = t.id;
    } else if (sol) {
      wrongKind = "prop";
      wrongAt = [(sol.x0 + sol.x1) / 2, sol.y0, (sol.z0 + sol.z1) / 2];
    }
  };
  const reachM = hasAug(p, "reach") ? AUG_N.reachM : 0;
  let caught: Target | null = null;

  if (w.kind === "melee") {
    emit(s, { type: "swing", by: p.seat, weapon: w.id });
    // 1) 눈에서 앞으로 곧장
    const hit = raycast(solids, bodies, eye, dir, w.range + reachM + 0.4, skipGlass);
    if (hit?.body !== undefined) {
      const t = targets[hit.body];
      if (t.kind === "p") caught = t;
      else {
        wrongWhat = t.label;
        noteWrong(t);
      }
      resolved = true;
    } else if (hit?.solid?.k === "prop" && hit.solid.id) {
      wrongWhat = thingLabel(rt, hit.solid.id);
      noteWrong(null, hit.solid);
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
        const dx = t.body.x - px;
        const dz = t.body.z - pz;
        const dist = Math.hypot(dx, dz) - t.body.r;
        if (dist > w.range + reachM || Math.abs(t.body.y - p.y) > 1.6) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (Math.hypot(dx, dz) * fl || 1))));
        if (ang > (w.cone ?? 0.7) + (reachM ? AUG_N.reachCone : 0)) continue;
        if (!lineOfSight(solids, eye, [t.body.x, t.body.y + t.body.h * 0.5, t.body.z])) continue;
        if (dist < bd) {
          bd = dist;
          best = t;
        }
      }
      if (best) {
        if (best.kind === "p") caught = best;
        else {
          wrongWhat = best.label;
          noteWrong(best);
        }
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
        } else if (!wrongWhat) {
          wrongWhat = t.label;
          noteWrong(t);
        }
      } else if (hit?.solid?.k === "prop" && hit.solid.id && !wrongWhat) {
        wrongWhat = thingLabel(rt, hit.solid.id);
        noteWrong(null, hit.solid);
      }
    }
  }

  if (camping) {
    caught = null;
    wrongWhat = null;
  }
  const armored = caught ? s.players[caught.id] : null;
  if (armored && hasAug(armored, "h_armor") && armored.shieldLeft > 0) {
    // 갑옷: 한 번 막아 준다 — 술래에겐 근처라고 알린다 (벌점 없음)
    armored.shieldLeft = 0;
    const [x, z] = fuzzPing(rt, armored.x, armored.z, 3);
    addPing(s, p.seat, "trap", x, armored.y, z, 3, 6000);
    emit(s, { type: "intel", seat: p.seat, icon: "🛡️", text: "뭔가 단단한 걸 쳤어요! 근처에 숨어 있어요" });
    emit(s, { type: "intel", seat: armored.seat, icon: "🛡️", text: "갑옷이 막아 줬어요 — 지금 도망쳐요!" });
    emit(s, { type: "ping", seat: p.seat, kind: "trap", notify: [armored.seat] });
  } else if (caught) {
    const q = s.players[caught.id];
    if (q.alive) {
      q.alive = false;
      q.caughtAt = s.t;
      q.caughtBy = p.seat;
      q.stats.caught += 1;
      p.roundCatches += 1;
      p.stats.catches += 1;
      p.score += 2;
      p.hp = Math.min(p.maxHp, p.hp + CATCH_HEAL + (hasAug(p, "vamp") ? AUG_N.vampHeal : 0));
      if (hasAug(p, "hunter")) p.hunterUntil = s.t + AUG_N.hunterMs;
      emit(s, { type: "catch", by: p.seat, target: q.seat, x: r2(q.x), y: r2(q.y), z: r2(q.z), weapon: w.id });
    }
  } else if (wrongWhat) {
    p.wrongAt = p.wrongAt.filter((t) => s.t - t < SPAM_WINDOW_MS);
    let penalty = wrongPenalty(s, p, w, wrongKind);
    const thornOwner = wrongDecoy !== null ? s.decoys.find((d) => d.id === wrongDecoy)?.owner : undefined;
    if (thornOwner !== undefined && hasAug(s.players[thornOwner], "h_thorn")) penalty = Math.round(penalty * AUG_N.hThorn);
    if (wrongDecoy !== null && hasAug(p, "decoyx")) {
      // 분신 감별: 분신을 터뜨리고 벌점 절반, 주인이 가까이 있는지 알려 준다
      penalty = Math.round(penalty * AUG_N.decoyPen);
      const dc = s.decoys.find((d) => d.id === wrongDecoy);
      s.decoys = s.decoys.filter((d) => d.id !== wrongDecoy);
      rt.decoyAi.delete(wrongDecoy);
      const owner = dc ? s.players[dc.owner] : undefined;
      const near = !!owner && visibleOnMap(owner, s.phase) && Math.hypot(owner.x - wrongAt[0], owner.z - wrongAt[2]) <= AUG_N.decoyR;
      emit(s, { type: "intel", seat: p.seat, icon: "🪞", text: near ? "분신이었어요! 주인이 15m 안에 있어요" : "분신이었어요 — 주인은 멀리 갔어요" });
    }
    if (p.shieldLeft > 0) p.shieldLeft -= 1;
    p.wrongAt.push(s.t);
    p.hp = Math.max(0, p.hp - penalty);
    p.stats.wrongHits += 1;
    emit(s, { type: "wrong", by: p.seat, x: r2(p.x), y: r2(p.y), z: r2(p.z), hp: p.hp, what: wrongWhat });
    if (hasAug(p, "mark")) {
      const n = hidersNear(s, wrongAt[0], wrongAt[1], wrongAt[2], AUG_N.markR, 2.4, "h_perfume").length;
      emit(s, { type: "intel", seat: p.seat, icon: "📍", text: n ? `헛손질 단서 — 여기 8m 안에 ${n}명 숨어 있어요` : "헛손질 단서 — 8m 안엔 아무도 없어요" });
    }
    if (p.hp <= 0 && hasAug(p, "resolve") && !p.resolveUsed) {
      p.resolveUsed = true;
      p.hp = AUG_N.resolveHp;
      emit(s, { type: "intel", seat: p.seat, icon: "🔥", text: `불굴! 체력 ${AUG_N.resolveHp}으로 버텼어요` });
    } else if (p.hp <= 0) {
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
      // 사람 술래가 아직 증강을 안 골랐으면 일찍 끝내지 않는다 (봇들이 바로 골라 버려 술래가 고를 틈이 없던 문제)
      // 봇 숨는 사람은 증강을 바로 고른다
      for (const p of s.players) if (p.role === "hider" && p.bot && p.augs.length === 0) autoAug(rt, p);
      // 사람이 아직 증강을 안 골랐으면 일찍 끝내지 않는다 (봇들이 바로 골라 버려 고를 틈이 없던 문제)
      const allPicked = s.players.every((p) => (p.role === "seeker" ? p.bot || p.augs.length > 0 : !!p.disguise && (p.bot || p.augs.length > 0)));
      if (s.t >= s.phaseEnd || allPicked) {
        // 시간 안에 안 고르면 랜덤
        for (const p of s.players) if (p.role === "hider" && !p.disguise) p.disguise = pick(rt.rng, p.offer);
        for (const p of s.players) if (p.role === "hider" && p.augs.length === 0) autoAug(rt, p);
        // 술래 증강 1번째: 안 골랐으면 자동, 그리고 2번째 3장
        for (const p of s.players) {
          if (p.role !== "seeker") continue;
          if (p.augs.length === 0) autoAug(rt, p);
          if (p.augs.length < AUG_PICKS) p.augOffer = rollAugOffer(rt.rng, p.augs.length, s.options.goalMode, p.augs);
        }
        // 꼼꼼이: 술래가 숫자를 세지 않고 먼 곳을 찍고 온다 — 언제 돌아올지 모른다
        let hideSec = s.options.goalMode ? KKOM_HIDE_MIN + Math.floor(rt.rng() * (KKOM_HIDE_MAX - KKOM_HIDE_MIN + 1)) : HIDE_SEC;
        if (s.players.some((p) => p.role === "seeker" && hasAug(p, "hasty"))) {
          s.hastyDone = true;
          hideSec -= AUG_N.hastyMs / 1000;
        }
        setPhase(rt, "hide", hideSec);
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
      // 봇 술래는 2번째 증강을 숨는 시간 중간쯤 고른다
      for (const p of s.players) if (p.role === "seeker" && p.bot && p.augOffer.length && s.t - s.phaseStart > 4000) autoAug(rt, p);
      if (s.t >= s.phaseEnd) {
        for (const p of s.players) if (p.role === "seeker") autoAug(rt, p);
        setPhase(rt, "hunt", s.options.huntSec);
        const w = currentWeapon(s);
        for (const p of s.players) {
          if (p.role !== "seeker") continue;
          p.tier = 0;
          p.ammo = w.ammo;
        }
        s.tier = 0;
        augHuntStart(rt);
        emit(s, { type: "tier", tier: 0, weapon: w.id });
        if (s.goal) {
          // "찾는다!" — 아직 기지 근처에서 우물쭈물하던 사람은 아웃
          const out: number[] = [];
          for (const p of s.players) {
            if (p.role !== "hider" || !visibleOnMap(p, s.phase)) continue;
            if (Math.hypot(p.x - BASE.x, p.z - BASE.z) <= KKOM_CALL_R && p.y < 1.5) {
              p.alive = false;
              p.caughtAt = s.t;
              p.caughtBy = -1;
              p.stats.caught += 1;
              out.push(p.seat);
            }
          }
          emit(s, { type: "kkomCall", out });
        }
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
        p.ammo = augAmmo(WEAPONS[sched[tier]].ammo, p.augs);
      }
      augHuntTick(rt);
      if (s.tier !== tier) {
        s.tier = tier;
        emit(s, { type: "tier", tier, weapon: sched[tier] });
      }
      // 꼼꼼이: 기지 전봇대 찍기 + 집 지키기
      if (s.goal) {
        for (const p of s.players) {
          if (p.role !== "seeker" || !p.alive) continue;
          const near = Math.hypot(p.x - BASE.x, p.z - BASE.z) <= KKOM_CAMP_R && p.y < 1.5;
          // 8초에서 멈춘다 (넘쳐 쌓이면 떠난 뒤에도 한참 못 잡던 문제)
          p.campMs = near ? Math.min(KKOM_CAMP_MS, p.campMs + dtMs) : Math.max(0, p.campMs - dtMs * 2);
        }
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
      if (hidersLeft === 0 || seekersLeft === 0 || s.t >= s.phaseEnd) {
        let winner: "seekers" | "hiders" = hidersLeft === 0 && !s.players.some((p) => p.escaped) ? "seekers" : "hiders";
        if (s.goal) {
          // 꼼꼼이: 숨는 쪽 절반 이상이 전봇대를 찍어야 숨는 쪽 승 (숨어서 버티기만 하면 안 된다)
          const hiders = s.players.filter((p) => p.role === "hider");
          const esc = hiders.filter((p) => p.escaped).length;
          winner = seekersLeft === 0 || esc * 2 >= hiders.length ? "hiders" : "seekers";
        }
        endRound(rt, winner);
      }
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
  const summary: RoundSummary = { round: s.round, seekers: [...s.seekers], winner, hiders: [], augs: {} };
  for (const p of s.players) if (p.augs.length > 0) summary.augs![p.seat] = [...p.augs];
  for (const p of s.players) {
    if (p.role === "hider") {
      let result: "survived" | "escaped" | "caught" = "caught";
      if (p.escaped) result = "escaped";
      else if (p.alive) {
        result = "survived";
        // 꼼꼼이에선 끝까지 숨기만 한 건 반쪽 성공
        p.score += (s.goal ? 1 : 3) + (hasAug(p, "h_survive") ? AUG_N.hSurvive : 0);
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
// 봇 — 정답을 보지 않는다. 술래 봇은 "사람 술래가 볼 수 있는 것"만으로 의심하고,
// 숨는 봇은 술래가 보이는지(시야)만 보고 굳거나 옮긴다. 판단 가중치는 botParams.ts.

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

function hParams(rt: HostRuntime, p: PlayerState): HiderParams {
  return rt.overrides?.hider ?? hiderParamsFor(p.level);
}

function sParams(rt: HostRuntime, p: PlayerState): SeekerParams {
  return rt.overrides?.seeker ?? seekerParamsFor(p.level);
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

const OUTDOOR_KINDS = new Set<ThingKind>(["hydrant", "bench", "cone", "mailbox", "vending", "barrel", "gnome"]);
const INDOOR_KINDS = new Set<ThingKind>(["hamper", "toybox", "trunk", "mannequin", "coats", "washer", "desk"]);
const OUT_SEGMENTS = NAV_EDGES.filter((e) => NAV_NODES[e.a].out && NAV_NODES[e.b].out).map((e) => [NAV_NODES[e.a], NAV_NODES[e.b]] as const);

export function isIndoor(x: number, y: number, z: number): boolean {
  const floor = y > FLOOR[2] - 0.6 ? 2 : y > FLOOR[1] - 0.6 ? 1 : 0;
  return ROOMS.some((r) => r.floor === floor && x >= r.box[0] && x <= r.box[1] && z >= r.box[2] && z <= r.box[3]);
}

function distToOutPath(x: number, z: number): number {
  let best = Infinity;
  for (const [a, b] of OUT_SEGMENTS) {
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)));
  }
  return best;
}

function inBox(x: number, z: number, b: readonly [number, number, number, number]) {
  return x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3];
}

// --- 숨는 봇 -----------------------------------------------------------------

function sameKindNear(rt: HostRuntime, kind: ThingKind, x: number, z: number, y: number, r: number): number {
  let n = 0;
  for (const t of FIXED_THINGS) if (t.kind === kind && Math.abs(t.y - y) < 1 && Math.hypot(t.x - x, t.z - z) < r) n++;
  for (const t of rt.fillers) if (t.kind === kind && Math.abs(t.y - y) < 1 && Math.hypot(t.x - x, t.z - z) < r) n++;
  return n;
}

function lookalikeSpot(rt: HostRuntime, kind: ThingKind, rad: number): [number, number, number] | null {
  const same = [...FIXED_THINGS, ...rt.fillers].filter((t) => t.kind === kind);
  if (same.length === 0) return null;
  const t = pick(rt.rng, same);
  const [w, , d] = THING_SIZE[t.kind];
  const a = rt.rng() * Math.PI * 2;
  const off = Math.max(w, d) * 0.5 + rad + 0.35;
  return [t.x + Math.cos(a) * off, t.y, t.z + Math.sin(a) * off];
}

/** 물건으로 숨을 자리 고르기 — 후보 여러 개를 점수로 (같은 모양이 많은 곳·멀리·실내 선호) */
function propSpot(rt: HostRuntime, p: PlayerState, hp: HiderParams, awayFrom?: { x: number; z: number }): [number, number, number] {
  const def = disguise(p.disguise)!;
  let best: [number, number, number] | null = null;
  let bs = -Infinity;
  for (let i = 0; i < 14; i++) {
    let c: [number, number, number] | null = rt.rng() < 0.6 ? lookalikeSpot(rt, def.thing!, def.r) : null;
    if (!c) {
      const n = pick(rt.rng, NAV_NODES);
      const a = rt.rng() * Math.PI * 2;
      c = [n.x + Math.cos(a) * 1.2, n.y, n.z + Math.sin(a) * 1.2];
    }
    let sc = hp.cluster * (sameKindNear(rt, def.thing!, c[0], c[2], c[1], 8) / 3) + hp.far * (Math.hypot(c[0] - BASE.x, c[2] - BASE.z) / 30) + hp.indoor * (isIndoor(c[0], c[1] + 0.1, c[2]) ? 0.5 : -0.5) + rt.rng() * 0.6;
    if (awayFrom) sc += Math.min(1.5, Math.hypot(c[0] - awayFrom.x, c[2] - awayFrom.z) / 8);
    if (sc > bs) {
      bs = sc;
      best = c;
    }
  }
  return best!;
}

function livingGoal(rt: HostRuntime, p: PlayerState, hp: HiderParams): { goal: [number, number, number] | null; node?: number } {
  const form = disguise(p.disguise)?.form ?? "person";
  const rng = rt.rng;
  const good = rng() < hp.mimic;
  if (form === "person") {
    // 흉내 잘 내면 행인처럼 바깥 길로, 아니면 아무 데나
    const pool = good ? NAV_NODES.filter((q) => q.out) : NAV_NODES;
    return { goal: null, node: pick(rng, pool).id };
  }
  if (form === "dog" || form === "cat") return { goal: good ? randomIn(rng, rng() < 0.5 ? PARK : YARD) : randomIn(rng, rng() < 0.7 ? YARD : LIVING) };
  if (form === "guard") return { goal: null, node: pick(rng, NAV_NODES.filter((q) => q.inspect || !good)).id };
  return { goal: good ? randomIn(rng, LIVING) : [pick(rng, NAV_NODES).x, 0, pick(rng, NAV_NODES).z] };
}

/** 지금 나를 볼 수 있는 술래 (시야 부채꼴 + 가림 없음) */
function seekersSeeing(rt: HostRuntime, x: number, y: number, z: number, h: number): PlayerState[] {
  const s = rt.state;
  const out: PlayerState[] = [];
  const solids = allSolids(rt);
  for (const q of s.players) {
    if (q.role !== "seeker" || !q.alive || s.phase !== "hunt") continue;
    const dx = x - q.x;
    const dz = z - q.z;
    const d = Math.hypot(dx, dz);
    if (d > 22 || Math.abs(y - q.y) > 2.4) continue;
    const ang = Math.abs(angleDiff(Math.atan2(dx, dz), q.yaw));
    if (d > 2 && ang > 1.35) continue;
    if (lineOfSight(solids, [q.x, q.y + 1.55, q.z], [x, y + h * 0.6, z])) out.push(q);
  }
  return out;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function pickCard(rt: HostRuntime, p: PlayerState, hp: HiderParams): string {
  const w = (id: string) => {
    const f = disguise(id)?.form;
    const v = f === "prop" ? hp.wProp : f === "person" ? hp.wPerson : f === "dog" ? hp.wDog : f === "cat" ? hp.wCat : f === "guard" ? hp.wGuard : hp.wVacuum;
    return Math.max(0.02, v) ** 2;
  };
  const total = p.offer.reduce((a, id) => a + w(id), 0);
  let r = rt.rng() * total;
  for (const id of p.offer) {
    r -= w(id);
    if (r <= 0) return id;
  }
  return p.offer[p.offer.length - 1];
}

function botHider(rt: HostRuntime, p: PlayerState, ai: WalkerAi, dt: number, w: CollWorld) {
  const s = rt.state;
  const hp = hParams(rt, p);
  if (s.phase === "pick") {
    if (!p.disguise && s.t - s.phaseStart > 1500 + ((p.seat * 977) % 3000)) applyAct(rt, p.seat, { t: "pick", id: pickCard(rt, p, hp) });
    return;
  }
  if (!visibleOnMap(p, s.phase) || (s.phase !== "hide" && s.phase !== "hunt")) return;
  const def = disguise(p.disguise)!;
  const isProp = def.form === "prop";
  const b = botBody(p);
  const px = b.x;
  const pz = b.z;
  if (!ai.plan) {
    ai.plan = isProp ? "hold" : "wander";
    if (isProp) routeTo(ai, b, propSpot(rt, p, hp));
    else {
      const g = livingGoal(rt, p, hp);
      routeTo(ai, b, g.goal, g.node);
    }
    ai.run = true;
    ai.decoyAt = hp.decoy < 0.33 ? -1 : hp.decoy < 0.66 ? 2 : 0.5;
  }
  // 꼼꼼이
  // 술래가 전봇대 가까이 있으면 안 뛴다 (보는 앞에서 뛰면 잡힌다)
  const guard = s.goal ? s.players.reduce((m, q) => (q.role === "seeker" && q.alive ? Math.min(m, Math.hypot(q.x - BASE.x, q.z - BASE.z)) : m), Infinity) : 0;
  if (s.goal?.open && ai.plan !== "goal" && guard > 13 && rt.rng() < dt * hp.goalRush) {
    const g = GOAL_SLOTS[s.goal.slot];
    ai.plan = "goal";
    routeTo(ai, b, [g.x, slotY(g), g.z]);
    ai.run = true;
  }
  // 술래가 보고 있나 (0.3초마다)
  if (s.t >= ai.nextScan) {
    ai.nextScan = s.t + 300;
    const seers = s.phase === "hunt" ? seekersSeeing(rt, b.x, b.y, b.z, b.h) : [];
    ai.focusUntil = seers.length;
    const closest = seers.reduce((m, q) => Math.min(m, Math.hypot(q.x - b.x, q.z - b.z)), Infinity);
    const moving = ai.idx < ai.path.length || !!ai.goal;
    if (isProp && ai.plan !== "goal") {
      if (seers.length > 0 && moving && rt.rng() < hp.freeze) {
        // 보는 눈이 있으면 그 자리에서 굳는다
        ai.path = [];
        ai.goal = null;
      } else if (seers.length > 0 && !moving && closest < 2.6 && rt.rng() < hp.flee * 0.3) {
        routeTo(ai, b, propSpot(rt, p, hp, seers[0]));
        ai.run = true;
      } else if (seers.length === 0 && !moving && s.phase === "hunt" && rt.rng() < hp.relocate * 0.3) {
        routeTo(ai, b, propSpot(rt, p, hp));
        ai.run = false;
      }
    }
    if (!isProp && seers.length > 0 && ai.run && rt.rng() < hp.mimic) ai.run = false;
  }
  let moving = false;
  if (s.t >= ai.waitUntil) {
    if (ai.plan === "wander" && ai.idx >= ai.path.length && !ai.goal) {
      // 살아 있는 모양: NPC처럼 쉬었다 걷기 (점검원은 점검 동작)
      if (ai.mode === "walk") {
        const good = rt.rng() < hp.mimic;
        ai.mode = def.form === "guard" ? (good ? "inspect" : "idle") : good ? (poseOf(def.form, 1).anim ?? "idle") : (poseOf(def.form, 2 + Math.floor(rt.rng() * 2)).anim ?? "idle");
        ai.waitUntil = s.t + (good ? 1500 + rt.rng() * 3500 : 4000 + rt.rng() * 9000);
      } else {
        const g = livingGoal(rt, p, hp);
        routeTo(ai, b, g.goal, g.node);
        ai.run = s.phase === "hide" ? rt.rng() < 0.6 : rt.rng() > hp.mimic && rt.rng() < 0.4;
        ai.mode = "walk";
      }
    } else if (ai.idx < ai.path.length || ai.goal) {
      const nearBase = Math.hypot(b.x - BASE.x, b.z - BASE.z) <= AUG_N.hHomeR;
      const r = followPath(ai, b, def.speed * (ai.run ? RUN_MULT : 1) * augSpeedMult(p.augs, false, nearBase), dt, w, rt.rng, () => p.tp++);
      openDoorsNear(rt, b.x, b.y, b.z);
      moving = r === "moving";
      if (r === "arrived") {
        ai.run = false;
        if (isProp) {
          p.pose = Math.floor(rt.rng() * 4);
          if (ai.decoyAt === 2) {
            // 숨은 자리에 분신을 두고 근처 다른 자리로 옮긴다 — 같은 게 둘
            ai.decoyAt = -1;
            applyAct(rt, p.seat, { t: "decoy" });
            routeTo(ai, b, propSpot(rt, p, hp));
          }
        }
      }
      if (ai.decoyAt > 0 && ai.decoyAt < 1 && ai.path.length > 2 && ai.idx >= ai.path.length * ai.decoyAt) {
        ai.decoyAt = -1;
        applyAct(rt, p.seat, { t: "decoy" });
      }
    }
  }
  syncBody(p, b);
  if (moving) {
    if (!isProp) p.yaw = yawOf(b.x - px, b.z - pz, p.yaw);
    rt.movedAt.set(p.seat, s.t);
    p.anim = ai.run ? "run" : "walk";
    if (!isProp) p.pose = 0;
  } else {
    p.anim = isProp ? "idle" : (poseOf(def.form, p.pose).anim ?? "idle");
    if (ai.plan === "wander" && s.t < ai.waitUntil) p.anim = ai.mode;
  }
}

// --- 술래 봇 -----------------------------------------------------------------

interface Obs {
  key: string;
  x: number;
  y: number;
  z: number;
  h: number;
  form: FormKind;
  thing?: ThingKind;
  anim: string;
  tipped: boolean;
}

interface SeenRec {
  x: number;
  y: number;
  z: number;
  first: number;
  moved: number;
  stillSince: number;
  novel: boolean;
}

/** 술래 눈에 보이는 "모양"들 — 숨은 사람·분신·NPC·진짜 물건을 구분하는 정보는 없다 */
function observables(rt: HostRuntime): Obs[] {
  const s = rt.state;
  const out: Obs[] = [];
  for (const q of s.players) {
    if (q.role !== "hider" || !visibleOnMap(q, s.phase)) continue;
    const d = disguise(q.disguise)!;
    out.push({ key: `a${q.seat}`, x: q.x, y: q.y, z: q.z, h: d.h, form: d.form, thing: d.thing, anim: q.anim, tipped: d.form === "prop" && !!poseOf("prop", q.pose).tip });
  }
  for (const dc of s.decoys) {
    const d = disguise(dc.disguise)!;
    out.push({ key: `b${dc.id}`, x: dc.x, y: dc.y, z: dc.z, h: d.h, form: d.form, thing: d.thing, anim: dc.anim, tipped: d.form === "prop" && !!poseOf("prop", dc.pose).tip });
  }
  for (const n of s.npcs) {
    if (n.kind === "car") continue;
    const form: FormKind = n.kind === "ped" ? "person" : n.kind;
    out.push({ key: `c${n.id}`, x: n.x, y: n.y, z: n.z, h: npcSize(n.kind).h, form, anim: n.anim, tipped: false });
  }
  for (const t of rt.thingObs) out.push(t);
  return out;
}

const cellKey = (x: number, y: number, z: number) => `${y > 4.5 ? 2 : y > 1.5 ? 1 : 0}:${Math.floor(x / 2)}:${Math.floor(z / 2)}`;

function suspicion(o: Obs, rec: SeenRec, now: number, sp: SeekerParams, near: number): number {
  let move = 0;
  let novel = 0;
  let ctx = 0;
  let beh = 0;
  let still = 0;
  const indoor = isIndoor(o.x, o.y + 0.1, o.z);
  const stillFor = now - rec.stillSince;
  if (o.form === "prop") {
    move = now - rec.moved < 2500 ? 1 : 0;
    novel = rec.novel ? 1 : 0;
    ctx = o.thing && ((indoor && OUTDOOR_KINDS.has(o.thing)) || (!indoor && INDOOR_KINDS.has(o.thing))) ? 1 : 0;
    beh = o.tipped ? 1 : 0;
  } else if (o.form === "person") {
    ctx = indoor ? 1 : distToOutPath(o.x, o.z) > 2.5 ? 0.5 : 0;
    beh = o.anim === "run" ? 1 : o.anim === "sit" || o.anim === "lie" || o.anim === "crouch" ? 0.6 : 0;
    still = Math.max(0, Math.min(1, (stillFor - 6000) / 8000));
  } else if (o.form === "guard") {
    beh = o.anim === "run" ? 0.8 : stillFor > 3000 && o.anim !== "inspect" ? 1 : 0;
    still = Math.max(0, Math.min(1, (stillFor - 6000) / 8000));
  } else if (o.form === "dog" || o.form === "cat") {
    ctx = indoor ? 1 : 0;
    still = Math.max(0, Math.min(1, (stillFor - (o.form === "cat" ? 10000 : 6000)) / 8000));
  } else if (o.form === "vacuum") {
    ctx = inBox(o.x, o.z, LIVING) && o.y < 1 ? 0 : 1;
    beh = stillFor > 3000 ? 0.7 : 0;
  }
  return sp.wMove * move + sp.wNovel * novel + sp.wCtx * ctx + sp.wBeh * beh + sp.wStill * still + sp.bias + sp.wNear * near;
}

/** 증강이 주는 단서를 봇 의심 점수에 더한다 (원 안이면 +, 정보원 목록에 있는 모양이면 +) */
function augHint(rt: HostRuntime, p: PlayerState, o: Obs): number {
  const s = rt.state;
  let h = 0;
  for (const g of s.pings) {
    if (!s.seekers.includes(g.owner)) continue;
    const d = Math.hypot(o.x - g.x, o.z - g.z);
    if (d > g.r || Math.abs(o.y - g.y) > 2) continue;
    h = Math.max(h, g.kind === "shock" ? 3 : 0.7 * (1 - d / (g.r + 0.01)));
  }
  const list = rt.dossier.get(p.seat);
  if (list?.length) {
    const hit = list.some((id) => {
      const d = disguise(id);
      return !!d && (d.form === "prop" ? d.thing === o.thing : d.form === o.form);
    });
    h += hit ? 0.3 : -0.15;
  }
  return h;
}

/** 봇의 덫·충격파: 변신 후보가 많은 곳에서 가끔 */
function botAugActives(rt: HostRuntime, p: PlayerState, ai: WalkerAi, b: Body) {
  const s = rt.state;
  if (p.traps <= 0 && p.shocks <= 0) return;
  if (s.t < (p.augT.botAct ?? 0)) return;
  p.augT.botAct = s.t + 1000;
  const dens = rt.nodeDensity[nearestNode(b.x, b.y, b.z)] ?? 0;
  if (p.traps > 0 && dens >= 1 && rt.rng() < 0.25) {
    syncBody(p, b);
    applyAct(rt, p.seat, { t: "trap" });
  }
  if (p.shocks > 0 && s.t - s.phaseStart > 15_000 && dens >= 1.2 && rt.rng() < 0.12 && s.t >= (p.augT.botShock ?? 0)) {
    p.augT.botShock = s.t + 25_000;
    syncBody(p, b);
    applyAct(rt, p.seat, { t: "shock" });
    ai.focus = null;
  }
}

function botSeeker(rt: HostRuntime, p: PlayerState, ai: WalkerAi, dt: number, w: CollWorld) {
  const s = rt.state;
  if (s.phase !== "hunt" || !p.alive) return;
  const sp = sParams(rt, p);
  const b = botBody(p);
  const px = b.x;
  const pz = b.z;
  const weapon = currentWeapon(s);
  const solids = allSolids(rt);
  const eye: [number, number, number] = [b.x, b.y + 1.55, b.z];
  const mem = ai.mem;
  const spdMul = augSpeedMult(p.augs, s.t < p.hunterUntil);
  botAugActives(rt, p, ai, b);

  // 1) 둘러보기 — 보이는 모양을 기억하고 의심 점수를 매긴다
  if (s.t >= ai.nextScan) {
    ai.nextScan = s.t + 400;
    const view = weapon.kind === "melee" ? 13 : Math.min(weapon.range * 0.8, 30);
    // 지나온 자리는 "봤다"
    for (let dx = -2; dx <= 2; dx += 2) for (let dz = -2; dz <= 2; dz += 2) if (!ai.viewed.has(cellKey(b.x + dx, b.y, b.z + dz))) ai.viewed.set(cellKey(b.x + dx, b.y, b.z + dz), s.t);
    let best: { o: Obs; score: number } | null = null;
    for (const o of observables(rt)) {
      if (ai.struck.has(o.key)) continue;
      const dx = o.x - b.x;
      const dz = o.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > view || Math.abs(o.y - b.y) > 2.2) continue;
      if (d > 1.5 && Math.abs(angleDiff(Math.atan2(dx, dz), p.yaw)) > 1.3) continue;
      if (!lineOfSight(solids, eye, [o.x, o.y + o.h * 0.6, o.z])) continue;
      const ck = cellKey(o.x, o.y, o.z);
      let rec = mem.get(o.key);
      if (!rec) {
        const seenCell = ai.viewed.get(ck);
        rec = { x: o.x, y: o.y, z: o.z, first: s.t, moved: -1e9, stillSince: s.t, novel: seenCell !== undefined && seenCell < s.t - 4000 };
        mem.set(o.key, rec);
      } else if (Math.hypot(o.x - rec.x, o.z - rec.z) > 0.12 || Math.abs(o.y - rec.y) > 0.2) {
        rec.moved = s.t;
        rec.stillSince = s.t;
        rec.x = o.x;
        rec.y = o.y;
        rec.z = o.z;
      }
      if (!ai.viewed.has(ck)) ai.viewed.set(ck, s.t);
      if (ai.focus) continue;
      const score = suspicion(o, rec, s.t, sp, 1 - d / view) + augHint(rt, p, o) + (rt.rng() - 0.5) * 0.3;
      if (!best || score > best.score) best = { o, score };
    }
    // 다음 헛손질 벌점 (최근에 헛쳤으면 커진다) — 자기 상태라 봇도 안다
    const nextPen = wrongPenalty(s, p, weapon, null);
    const th = sp.th0 + sp.thHp * (1 - p.hp / p.maxHp) + sp.thPen * (nextPen / 10);
    if (!ai.focus && best && best.score > th) {
      ai.focus = { kind: "t", id: best.o.key };
      ai.focusUntil = s.t + 8000;
      ai.tries = 0;
      ai.path = [];
      ai.goal = null;
    }
  }

  // 2) 노리는 게 있으면 다가가서 친다
  let moving = false;
  if (ai.focus) {
    const key = String(ai.focus.id);
    const o = observables(rt).find((x) => x.key === key);
    if (!o || s.t > ai.focusUntil) {
      ai.focus = null;
    } else {
      const dx = o.x - b.x;
      const dz = o.z - b.z;
      const dist = Math.hypot(dx, dz);
      const reach = weapon.kind === "melee" ? weapon.range * 0.75 : Math.min(weapon.range * 0.7, 18);
      p.yaw = Math.atan2(dx, dz);
      if (dist > reach) {
        const st = stepBody(b, { dx: dx / dist, dz: dz / dist, jump: ai.stuck > 0.6 }, SEEKER_SPEED * RUN_MULT * 0.8 * spdMul, dt, w);
        if (st < 0.05 * dt) ai.stuck += dt;
        else ai.stuck = 0;
        if (ai.stuck > 2) ai.focus = null;
        moving = true;
      } else if (s.t >= p.nextAtkAt && (weapon.kind === "melee" || p.ammo > 0)) {
        const err = sp.aimErr;
        const ty = o.y + o.h * 0.5;
        const ad: [number, number, number] = [dx + (rt.rng() - 0.5) * err * dist * 2, ty - eye[1] + (rt.rng() - 0.5) * err * dist, dz + (rt.rng() - 0.5) * err * dist * 2];
        syncBody(p, b);
        const before = s.nextEventId;
        attack(rt, p, eye, ad);
        const evs = s.events.filter((e) => e.id >= before);
        const caught = evs.some((e) => e.type === "catch" && e.by === p.seat);
        const wrong = evs.some((e) => e.type === "wrong" && e.by === p.seat);
        ai.tries += 1;
        // "✖ 행인였어" — 맞힌 게 아니면 다시는 안 친다 (빗맞으면 세 번까지)
        if (wrong || (!caught && ai.tries >= 3)) ai.struck.add(key);
        if (caught || wrong || ai.tries >= 3) ai.focus = null;
        p.anim = weapon.kind === "melee" ? "inspect" : "aim";
        return;
      }
    }
  }

  // 3) 아니면 순찰 — 안 가 본 곳, 변신 후보가 많은 곳 위주 (증강 표시가 있으면 그쪽 먼저)
  if (!ai.focus && !moving) {
    const ping = s.pings.filter((g) => s.seekers.includes(g.owner) && !ai.struck.has(`g${g.id}`) && Math.hypot(g.x - b.x, g.z - b.z) > Math.max(1.5, g.r * 0.5)).sort((a, c) => c.until - a.until)[0];
    if (ping) {
      ai.struck.add(`g${ping.id}`);
      routeTo(ai, b, [ping.x, ping.y, ping.z]);
    }
    if (ai.idx >= ai.path.length && !ai.goal) {
      const here = nearestNode(b.x, b.y, b.z);
      ai.visited.add(here);
      let bestN = -1;
      let bs = -Infinity;
      for (const n of NAV_NODES) {
        if (ai.visited.has(n.id)) continue;
        const sc = sp.density * (rt.nodeDensity[n.id] ?? 0) - Math.hypot(n.x - b.x, n.z - b.z) / 25 - Math.abs(n.y - b.y) / 6 + rt.rng() * 0.8;
        if (sc > bs) {
          bs = sc;
          bestN = n.id;
        }
      }
      if (bestN < 0) {
        ai.visited.clear();
        bestN = pick(rt.rng, NAV_NODES).id;
      }
      routeTo(ai, b, null, bestN);
    }
    const r = followPath(ai, b, SEEKER_SPEED * RUN_MULT * 0.75 * spdMul, dt, w, rt.rng, () => p.tp++);
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
