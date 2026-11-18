import { arenaFor, inBush, type ArenaGeo } from "./arena";
import {
  ACCEL,
  BANANA_BEHIND,
  BANANA_LIFE_MS,
  BANANA_OWNER_SAFE_MS,
  BANANA_R,
  BANANA_SLIP_MS,
  BODY_R,
  COUNTDOWN_MS,
  CREDIT_MS,
  CROWN_DROP_BAN_MS,
  CROWN_DROP_MS,
  CROWN_PICK_R,
  CURSE_HASTE_MAX,
  CURSE_HASTE_PER_STEP,
  DASH_CD_MS,
  DASH_HIT_STAGGER_MS,
  DASH_MS,
  DASH_SPEED,
  DRAG,
  FAKE_MS,
  FALL_DEPTH,
  FALL_MS,
  GOLDEN_MS,
  GOLDEN_MULT,
  INVULN_MS,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_LIFE_MS,
  ITEM_MAX,
  ITEM_PICK_R,
  LAG_COMP_MS,
  MAGNET_MS,
  MAGNET_REACH,
  PAD_CD_MS,
  PAD_H,
  PAD_MS,
  RESPAWN_GHOST_MS,
  RESPAWN_MS,
  RESTITUTION,
  REVENGE_MS,
  ROAR_PUSH_MAX,
  ROAR_PUSH_MIN,
  ROAR_R,
  ROAR_STAGGER_MS,
  SNARE_MS,
  SNARE_R,
  SNARE_SLOW,
  STAGGER_DRAG,
  STEP_MS,
  TOUCH_DIST,
  TRAP_MAX,
  UNDERDOG_BONUS,
  WEIGHT_MAX,
  WEIGHT_PER_STEP,
  WEIGHT_STEP_MS,
  itemKindsFor,
  sanitizeOptions,
  teamOf,
  type GameOptions,
  type ItemKind,
} from "./data";

/**
 * 왕관 도둑 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다. 그래서 방장이 나가도
 * 손님 하나가 마지막 스냅샷으로 `createHost`를 다시 불러 판을 이어갈 수 있다(방장 승계).
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다 — 같은 입력이면 같은 결과(테스트 재현용).
 *
 * 한 스텝(1/60초) 순서: 봇 생각 → 조작(돌진·호령) → 몸 이동(점프대·가장자리 포함) → 몸끼리 부딪힘 →
 * 위치 기록(핑 보정) → 왕관(떨어짐·줍기·뺏기) → 아이템·바나나 → 점수 → 황금 왕관·시간 끝 판정.
 */

export type Phase = "countdown" | "fight" | "gameOver";
/** 몸 상태: 보통 / 💨 돌진 / 휘청(밀쳐짐·미끄러짐) / 🌀 점프대 비행 / 광장 밖으로 떨어짐 */
export type MoveKind = "none" | "dash" | "stagger" | "pad" | "fall";

export interface PlayerStats {
  /** 왕관을 뺏은 횟수 (저주 모드: 떠넘긴 횟수) */
  steals: number;
  /** 왕관을 뺏긴 횟수 (저주 모드: 떠안은 횟수) */
  lost: number;
  /** 바닥에 떨어진 왕관을 주운 횟수 */
  pickups: number;
  dashes: number;
  /** 돌진으로 박은 사람 수 */
  dashHits: number;
  roars: number;
  /** 호령으로 밀친 사람 수 */
  roarHits: number;
  snares: number;
  falls: number;
  /** 아무도 안 밀었는데 떨어짐 */
  selfFalls: number;
  /** 내가 밀어서 떨어뜨린 사람 수 */
  kos: number;
  /** 떨어뜨린 사람이 왕이었던 횟수 */
  kingKos: number;
  items: number;
  /** 내 바나나에 미끄러진 사람 수 */
  bananaHits: number;
  slipped: number;
  padJumps: number;
  /** 한 번에 가장 오래 쓴 시간 */
  bestReignMs: number;
  /** ✨ 황금 왕관 구간에 쓴 시간 (점수 아님, 실제 시간) */
  goldenMs: number;
  /** 경기가 끝날 때 왕관을 쓰고 있었나 (1/0) */
  crownAtEnd: number;
}

const zeroStats = (): PlayerStats => ({
  steals: 0,
  lost: 0,
  pickups: 0,
  dashes: 0,
  dashHits: 0,
  roars: 0,
  roarHits: 0,
  snares: 0,
  falls: 0,
  selfFalls: 0,
  kos: 0,
  kingKos: 0,
  items: 0,
  bananaHits: 0,
  slipped: 0,
  padJumps: 0,
  bestReignMs: 0,
  goldenMs: 0,
  crownAtEnd: 0,
});

export interface PlayerState {
  seat: number;
  bot: boolean;
  /** 봇 레벨 1~10 (사람은 대신 플레이할 때 쓸 값) */
  lv: number;
  /** 사람이 나가서 봇이 대신 하는 중 */
  away: boolean;
  /** 팀 (0 해 · 1 달) — 팀전이 아니면 화면에 안 쓴다 */
  team: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  face: number;
  move: MoveKind;
  moveAt: number;
  moveUntil: number;
  /** 점프대 비행 시작·도착점 */
  px0: number;
  pz0: number;
  ptx: number;
  ptz: number;
  dashCdAt: number;
  padCdAt: number;
  /** 이번 왕관에서 호령/저주의 손길을 썼나 (왕관을 새로 쓰면 다시 생김) */
  skillUsed: boolean;
  /** 떨어진 뒤 다시 나타나는 시각 (0 = 떨어지지 않음) */
  respawnAt: number;
  /** 다시 나타난 직후 반투명이 풀리는 시각 */
  ghostUntil: number;
  slowUntil: number;
  magnetUntil: number;
  fakeUntil: number;
  lastHitBy: number;
  lastHitAt: number;
  /** 점수 ms (개인전·팀전: 왕관 쓴 시간 · 저주: 저주 쌓인 시간) */
  score: number;
  /** 지금 왕관을 쓴 시각 (왕이 아니면 0) */
  reignStart: number;
  /** 마지막으로 왕관을 쓰고 있던 시각 (동점 판정) */
  lastCrownAt: number;
  stats: PlayerStats;
}

export interface Crown {
  /** pending = 아직 안 떨어짐 · ground = 바닥 · held = 누가 씀 */
  state: "pending" | "ground" | "held";
  holder: number;
  x: number;
  z: number;
  /** 지금 상태가 된 시각 */
  at: number;
  /** 🛡 새 왕 무적이 끝나는 시각 */
  invulnUntil: number;
  /** ✋ 직전 왕(뺏긴 사람) — prevUntil까지 이 사람과는 왕관이 다시 오가지 않는다 */
  prev: number;
  prevUntil: number;
  /** 떨어뜨린 사람은 잠깐 못 줍는다 */
  dropBan: number;
  dropBanUntil: number;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
  until: number;
}

export interface Trap {
  id: number;
  x: number;
  z: number;
  owner: number;
  at: number;
  until: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "go" }
  | { k: "crownLand"; x: number; z: number }
  /** 왕관이 넘어감 (from = -1이면 바닥에서 줍거나 저주가 처음 내려앉음) */
  | { k: "steal"; s: number; from: number; x: number; z: number }
  | { k: "drop"; s: number; x: number; z: number }
  | { k: "dash"; s: number }
  | { k: "dashHit"; a: number; b: number; x: number; z: number }
  | { k: "roar"; s: number; n: number; x: number; z: number }
  | { k: "snare"; s: number; n: number; x: number; z: number }
  | { k: "bump"; a: number; b: number; x: number; z: number; p: number }
  | { k: "fall"; s: number; by: number; x: number; z: number; king: boolean }
  | { k: "respawn"; s: number; x: number; z: number }
  | { k: "pad"; s: number; i: number }
  | { k: "land"; s: number; x: number; z: number }
  | { k: "spawn"; kind: ItemKind; x: number; z: number }
  | { k: "pick"; s: number; kind: ItemKind; x: number; z: number }
  | { k: "expire"; kind: ItemKind; x: number; z: number }
  | { k: "slip"; s: number; by: number; x: number; z: number }
  | { k: "fakeOn"; s: number; by: number }
  | { k: "invulnEnd"; s: number }
  | { k: "golden" }
  | { k: "over" }
);

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  fightStart: number;
  fightEnd: number;
  golden: boolean;
  crown: Crown;
  items: Item[];
  traps: Trap[];
  nextItemAt: number;
  itemSeq: number;
  players: PlayerState[];
  /** 팀 점수 ms (팀전만, 인원이 적은 팀은 배수 적용) */
  teamScores: [number, number];
  /** 인원이 적은 팀 점수 배수 (예: 3대2면 작은 팀 ×1.5) */
  teamMult: [number, number];
  /** 왕관이 주인을 바꾼 횟수 (뺏기·줍기 모두) */
  transfers: number;
  /** 1등이 바뀐 횟수 */
  leadChanges: number;
  leader: number;
  /** 황금 왕관이 시작될 때 1등 (막판 역전 기록) */
  goldenLeader: number;
  events: GameEvent[];
  eventSeq: number;
  /** 끝났을 때 최종 순위 (자리별 등수, 1부터) */
  ranks: number[] | null;
  /** 팀전 이긴 팀 (-1 = 무승부 또는 팀전 아님) */
  winnerTeam: number;
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
  return arenaFor(s.seatCount);
}

/** 지금 땅 위에서 움직이는 몸인가 (떨어짐·점프대 비행·다시 나타나는 중이 아님) */
export function onGround(p: PlayerState): boolean {
  return p.respawnAt === 0 && p.move !== "fall" && p.move !== "pad";
}

/** 뺏고 뺏기는 판정에 끼는 몸인가 */
export function inPlay(s: MatchState, p: PlayerState): boolean {
  return onGround(p) && s.t >= p.ghostUntil;
}

export function isKing(s: MatchState, seat: number): boolean {
  return s.crown.state === "held" && s.crown.holder === seat;
}

export function king(s: MatchState): PlayerState | null {
  return s.crown.state === "held" ? (s.players[s.crown.holder] ?? null) : null;
}

export const isCurse = (s: MatchState) => s.options.mode === "curse";
export const isTeam = (s: MatchState) => s.options.mode === "team";

/** 같은 팀인가 (팀전이 아니면 늘 false) */
export function allies(s: MatchState, a: number, b: number): boolean {
  return isTeam(s) && a !== b && s.players[a]?.team === s.players[b]?.team;
}

/** 🪨 무거운 왕관 / 💀 저주 가속 — 이번 왕관을 쓴 시간에 따른 속도 배수 */
export function crownSpeedMult(s: MatchState, p: PlayerState): number {
  if (!isKing(s, p.seat)) return 1;
  const steps = Math.floor(Math.max(0, s.t - p.reignStart) / WEIGHT_STEP_MS);
  if (isCurse(s)) return 1 + Math.min(CURSE_HASTE_MAX, steps * CURSE_HASTE_PER_STEP);
  return 1 - Math.min(WEIGHT_MAX, steps * WEIGHT_PER_STEP);
}

/** 🐢 꼴찌 보정 대상인가 (점수가 가장 불리한 사람, 왕 제외, 모두 같으면 없음) */
export function isUnderdog(s: MatchState, p: PlayerState): boolean {
  if (s.phase !== "fight" || isKing(s, p.seat)) return false;
  if (isTeam(s)) {
    const [a, b] = s.teamScores;
    if (a === b) return false;
    return p.team === (a < b ? 0 : 1);
  }
  const vals = s.players.map((q) => q.score);
  const worst = isCurse(s) ? Math.max(...vals) : Math.min(...vals);
  const best = isCurse(s) ? Math.min(...vals) : Math.max(...vals);
  return worst !== best && p.score === worst;
}

export function speedMult(s: MatchState, p: PlayerState): number {
  let m = crownSpeedMult(s, p);
  if (isUnderdog(s, p)) m += UNDERDOG_BONUS;
  if (s.t < p.slowUntil) m *= 1 - SNARE_SLOW;
  return m;
}

export function hasMagnet(s: MatchState, p: PlayerState): boolean {
  return s.t < p.magnetUntil;
}

export function wearsFake(s: MatchState, p: PlayerState): boolean {
  return s.t < p.fakeUntil && !isKing(s, p.seat);
}

export function hidden(s: MatchState, p: PlayerState): boolean {
  return onGround(p) && inBush(geoOf(s), p.x, p.z);
}

/** 화면에 왕관을 그릴 사람인가 (진짜 왕 + 🎭 가짜 왕관 — 둘은 똑같이 보인다) */
export function crownOn(s: MatchState, p: PlayerState): "real" | "fake" | null {
  if (s.crown.state === "held" && s.crown.holder === p.seat) return "real";
  if (s.phase === "fight" && s.t < p.fakeUntil) return "fake";
  return null;
}

/** 이 사람이 지금 왕관을 뺏을(저주: 떠안을) 수 없는 "복수 금지" 상태인가 */
export function revengeBanned(s: MatchState, seat: number): boolean {
  return s.crown.prev === seat && s.t < s.crown.prevUntil;
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
    team: teamOf(seat),
    x: 0,
    z: 0,
    y: 0,
    vx: 0,
    vz: 0,
    face: 0,
    move: "none",
    moveAt: 0,
    moveUntil: 0,
    px0: 0,
    pz0: 0,
    ptx: 0,
    ptz: 0,
    dashCdAt: 0,
    padCdAt: 0,
    skillUsed: false,
    respawnAt: 0,
    ghostUntil: 0,
    slowUntil: 0,
    magnetUntil: 0,
    fakeUntil: 0,
    lastHitBy: -1,
    lastHitAt: 0,
    score: 0,
    reignStart: 0,
    lastCrownAt: 0,
    stats: zeroStats(),
  };
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const seatCount = seats.length;
  const opts = sanitizeOptions(options, seatCount);
  const players = seats.map((spec, i) => newPlayer(i, spec));
  const sizes = [0, 1].map((k) => players.filter((p) => p.team === k).length);
  const big = Math.max(...sizes);
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount,
    options: opts,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: COUNTDOWN_MS,
    fightStart: COUNTDOWN_MS,
    fightEnd: COUNTDOWN_MS + opts.seconds * 1000,
    golden: false,
    crown: { state: "pending", holder: -1, x: 0, z: 0, at: 0, invulnUntil: 0, prev: -1, prevUntil: 0, dropBan: -1, dropBanUntil: 0 },
    items: [],
    traps: [],
    nextItemAt: COUNTDOWN_MS + ITEM_FIRST_MS,
    itemSeq: 0,
    players,
    teamScores: [0, 0],
    teamMult: [sizes[0] > 0 ? big / sizes[0] : 1, sizes[1] > 0 ? big / sizes[1] : 1],
    transfers: 0,
    leadChanges: 0,
    leader: -1,
    goldenLeader: -1,
    events: [],
    eventSeq: 0,
    ranks: null,
    winnerTeam: -1,
  };
  // 자리 배치: 광장 반지름 62% 둘레에 고르게, 순서·회전은 무작위 (어느 자리도 왕관에서 같은 거리)
  const geo = geoOf(s);
  const order = players.map((p) => p.seat);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // 팀전은 팀이 번갈아 서게 (같은 팀끼리 뭉쳐 시작하지 않게)
  if (opts.mode === "team") {
    const t0 = order.filter((q) => players[q].team === 0);
    const t1 = order.filter((q) => players[q].team === 1);
    order.length = 0;
    for (let k = 0; k < Math.max(t0.length, t1.length); k++) {
      if (k < t0.length) order.push(t0[k]);
      if (k < t1.length) order.push(t1[k]);
    }
  }
  const rot = rnd(s) * Math.PI * 2;
  const spawnR = geo.radius * 0.62;
  order.forEach((seat, k) => {
    const p = players[seat];
    const a = rot + (k / seatCount) * Math.PI * 2;
    const pos = clearSpot(geo, Math.cos(a) * spawnR, Math.sin(a) * spawnR);
    p.x = pos.x;
    p.z = pos.z;
    p.face = Math.atan2(-p.z, -p.x);
  });
  return s;
}

/** 기둥·점프대와 겹치지 않는 가까운 자리 */
function clearSpot(geo: ArenaGeo, x: number, z: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const c of [...geo.pillars, ...geo.pads]) {
      const d = Math.hypot(px - c.x, pz - c.z);
      const need = c.r + BODY_R + 0.25;
      if (d < need) {
        const nx = d > 1e-6 ? (px - c.x) / d : 1;
        const nz = d > 1e-6 ? (pz - c.z) / d : 0;
        px = c.x + nx * need;
        pz = c.z + nz * need;
        moved = true;
      }
    }
    const r = Math.hypot(px, pz);
    const lim = geo.radius - 1;
    if (r > lim) {
      px *= lim / r;
      pz *= lim / r;
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 이동 방향 (화면 기준 x→오른쪽, z→아래), 길이 ≤ 1 */
  mx: number;
  mz: number;
  /** 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  dash: number;
  /** 📣 호령 / 💀 저주의 손길 */
  skill: number;
}

export interface BotMemory {
  nextThinkAt: number;
  /** 지금 노리는 사람 (봇 화면 표시·디버그용) */
  target: number;
  wander: { x: number; z: number; until: number } | null;
  /** 가짜 왕관에 속는 중인 사람 (-1 = 안 속음) */
  fooledBy: number;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seenDash: number[];
  seenSkill: number[];
  dashReq: number[];
  skillReq: number[];
  acc: number;
  bots: BotMemory[];
  /** 봇 생각 함수 (bot.ts가 꽂는다 — 순환 import 방지) */
  think: ((rt: HostRuntime, seat: number) => void) | null;
  /** 봇 손떨림용 난수 (경기 rng와 따로) */
  botRng: { rng: number };
  /** 핑 보정용 지난 위치 (자리별 최근 몇 스텝) — 방장 기기에만 있음 */
  hist: { x: number; z: number }[][];
}

const idleInput = (): PlayerInput => ({ mx: 0, mz: 0, dash: 0, skill: 0 });
const LAG_STEPS = Math.max(1, Math.round(LAG_COMP_MS / STEP_MS));

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seenDash: Array(n).fill(0),
    seenSkill: Array(n).fill(0),
    dashReq: Array(n).fill(-1),
    skillReq: Array(n).fill(-1),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, target: -1, wander: null, fooledBy: -1 })),
    think,
    botRng: { rng: (state.seed ^ 0x5bd1e995) | 0 },
    hist: state.players.map(() => []),
  };
}

/** 사람 입력 (방장 기기 자신 또는 손님이 보낸 `in`) */
export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= rt.state.seatCount) return;
  const p = rt.state.players[seat];
  if (p.bot) return;
  setInput(rt, seat, inp);
}

/** 봇·사람 공용: 입력 저장 + 새로 누른 돌진/기술 기억 */
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
  const d = Number(inp.dash) || 0;
  const k = Number(inp.skill) || 0;
  if (d > rt.seenDash[seat]) {
    rt.seenDash[seat] = d;
    rt.dashReq[seat] = rt.state.t;
  }
  if (k > rt.seenSkill[seat]) {
    rt.seenSkill[seat] = k;
    rt.skillReq[seat] = rt.state.t;
  }
  cur.dash = d;
  cur.skill = k;
}

/** 봇용: 돌진·기술 한 번 누르기 */
export function press(rt: HostRuntime, seat: number, what: "dash" | "skill") {
  if (what === "dash") rt.dashReq[seat] = rt.state.t;
  else rt.skillReq[seat] = rt.state.t;
}

/** 사람이 나가면 봇이 대신, 돌아오면 돌려준다. 나간 사람이 왕이면 왕관은 그 자리에 떨어진다(저주는 그대로). */
export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const s = rt.state;
  const p = s.players[seat];
  if (!p) return;
  if (away && !p.bot) {
    p.bot = true;
    p.away = true;
    if (isKing(s, seat) && !isCurse(s) && s.phase === "fight") dropCrown(s, p, p.x, p.z);
  } else if (!away && p.away) {
    p.bot = false;
    p.away = false;
    rt.inputs[seat] = idleInput();
    rt.seenDash[seat] = 0;
    rt.seenSkill[seat] = 0;
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
  } else {
    // 끝난 뒤: 남은 몸은 미끄러지다 멈춘다
    for (const p of s.players) {
      p.vx *= 0.9;
      p.vz *= 0.9;
      if (onGround(p)) {
        p.x += (p.vx * STEP_MS) / 1000;
        p.z += (p.vz * STEP_MS) / 1000;
      }
    }
  }
  // 오래된 이벤트 정리 (스냅샷엔 최근 것만)
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function fight(rt: HostRuntime) {
  const s = rt.state;
  const dt = STEP_MS / 1000;
  for (const p of s.players) {
    control(rt, p);
    moveBody(rt, p, dt);
  }
  collideBodies(s);
  for (const p of s.players) {
    const h = rt.hist[p.seat] ?? (rt.hist[p.seat] = []);
    // 땅 위에 있을 때만 기록 (점프대 비행·떨어짐·다시 나타남 사이 위치는 핑 보정에 안 쓴다)
    if (!inPlay(s, p)) h.length = 0;
    else {
      h.push({ x: p.x, z: p.z });
      if (h.length > LAG_STEPS + 1) h.shift();
    }
  }
  crownLogic(rt);
  if (s.options.items) items(s);
  traps(s);
  scoring(s);
  if (!s.golden && s.t >= s.fightEnd - GOLDEN_MS) {
    s.golden = true;
    s.goldenLeader = s.leader;
    emit(s, { k: "golden" });
  }
  if (s.t >= s.fightEnd) finishMatch(s);
}

/** 입력 → 돌진·기술 (누른 뒤 0.2초 안에 쓸 수 있으면 쓴다) */
function control(rt: HostRuntime, p: PlayerState) {
  const s = rt.state;
  const dq = rt.dashReq[p.seat];
  if (dq >= 0) {
    if (s.t - dq > 200) rt.dashReq[p.seat] = -1;
    else if (p.move === "none" && p.respawnAt === 0 && s.t >= p.dashCdAt) {
      rt.dashReq[p.seat] = -1;
      const inp = rt.inputs[p.seat];
      const l = Math.hypot(inp.mx, inp.mz);
      const dx = l > 0.2 ? inp.mx / l : Math.cos(p.face);
      const dz = l > 0.2 ? inp.mz / l : Math.sin(p.face);
      const sp = DASH_SPEED * crownSpeedMult(s, p) * (s.t < p.slowUntil ? 1 - SNARE_SLOW : 1);
      p.vx = dx * sp;
      p.vz = dz * sp;
      p.face = Math.atan2(dz, dx);
      p.move = "dash";
      p.moveAt = s.t;
      p.moveUntil = s.t + DASH_MS;
      p.dashCdAt = s.t + DASH_CD_MS;
      p.stats.dashes += 1;
      emit(s, { k: "dash", s: p.seat });
    }
  }
  const kq = rt.skillReq[p.seat];
  if (kq >= 0) {
    if (s.t - kq > 200) rt.skillReq[p.seat] = -1;
    else if (isKing(s, p.seat) && !p.skillUsed && onGround(p) && p.move !== "stagger") {
      rt.skillReq[p.seat] = -1;
      p.skillUsed = true;
      if (isCurse(s)) snare(s, p);
      else roar(s, p);
    } else if (!isKing(s, p.seat) || p.skillUsed) rt.skillReq[p.seat] = -1;
  }
}

/** 📣 왕의 호령: 주변 사람을 바깥으로 밀쳐낸다 (팀원은 빼고) */
function roar(s: MatchState, k: PlayerState) {
  let n = 0;
  for (const o of s.players) {
    if (o === k || !inPlay(s, o) || allies(s, k.seat, o.seat)) continue;
    const dx = o.x - k.x;
    const dz = o.z - k.z;
    const d = Math.hypot(dx, dz);
    if (d > ROAR_R) continue;
    const nx = d > 1e-6 ? dx / d : Math.cos(k.face);
    const nz = d > 1e-6 ? dz / d : Math.sin(k.face);
    const sp = ROAR_PUSH_MIN + (ROAR_PUSH_MAX - ROAR_PUSH_MIN) * (1 - d / ROAR_R);
    o.vx = nx * sp;
    o.vz = nz * sp;
    stagger(s, o, ROAR_STAGGER_MS, k.seat);
    n++;
  }
  k.stats.roars += 1;
  k.stats.roarHits += n;
  emit(s, { k: "roar", s: k.seat, n, x: k.x, z: k.z });
}

/** 💀 저주의 손길: 주변 사람을 잠깐 느리게 */
function snare(s: MatchState, k: PlayerState) {
  let n = 0;
  for (const o of s.players) {
    if (o === k || !inPlay(s, o)) continue;
    if (Math.hypot(o.x - k.x, o.z - k.z) > SNARE_R) continue;
    o.slowUntil = s.t + SNARE_MS;
    n++;
  }
  k.stats.snares += 1;
  emit(s, { k: "snare", s: k.seat, n, x: k.x, z: k.z });
}

function stagger(s: MatchState, p: PlayerState, ms: number, by: number) {
  if (p.move === "fall" || p.move === "pad") return;
  p.move = "stagger";
  p.moveAt = s.t;
  p.moveUntil = Math.max(p.moveUntil, s.t + ms);
  if (by >= 0) {
    p.lastHitBy = by;
    p.lastHitAt = s.t;
  }
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

/** 몸 움직이기: 보통·돌진·휘청 / 점프대 비행 / 떨어짐 → 다시 나타남 */
function moveBody(rt: HostRuntime, p: PlayerState, dt: number) {
  const s = rt.state;
  const geo = geoOf(s);
  if (p.respawnAt > 0) {
    if (p.move === "fall") {
      const u = (s.t - p.moveAt) / 1000;
      p.y = Math.max(FALL_DEPTH, -7 * u * u);
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vx *= 0.98;
      p.vz *= 0.98;
      if (s.t >= p.moveAt + FALL_MS) p.move = "none";
    }
    if (s.t >= p.respawnAt) respawn(s, p);
    return;
  }
  if (p.move === "pad") {
    const u = Math.min(1, (s.t - p.moveAt) / PAD_MS);
    p.x = p.px0 + (p.ptx - p.px0) * u;
    p.z = p.pz0 + (p.ptz - p.pz0) * u;
    p.y = PAD_H * 4 * u * (1 - u);
    if (u >= 1) {
      p.move = "none";
      p.y = 0;
      const d = Math.hypot(p.ptx - p.px0, p.ptz - p.pz0) || 1;
      p.vx = ((p.ptx - p.px0) / d) * 2;
      p.vz = ((p.ptz - p.pz0) / d) * 2;
      emit(s, { k: "land", s: p.seat, x: p.x, z: p.z });
    }
    return;
  }
  const inp = rt.inputs[p.seat];
  if (p.move === "dash") {
    if (s.t >= p.moveUntil) {
      p.move = "none";
      p.vx *= 0.45;
      p.vz *= 0.45;
    }
  } else if (p.move === "stagger") {
    p.vx -= p.vx * STAGGER_DRAG * dt;
    p.vz -= p.vz * STAGGER_DRAG * dt;
    if (s.t >= p.moveUntil) p.move = "none";
  } else {
    const m = speedMult(s, p);
    p.vx += (inp.mx * ACCEL * m - p.vx * DRAG) * dt;
    p.vz += (inp.mz * ACCEL * m - p.vz * DRAG) * dt;
    if (Math.hypot(inp.mx, inp.mz) > 0.2) p.face = turnTo(p.face, Math.atan2(inp.mz, inp.mx), dt * 14);
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // 기둥: 밀어내고 안쪽 속도를 지운다
  for (const c of geo.pillars) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const need = c.r + BODY_R;
    if (d >= need) continue;
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    p.x = c.x + nx * need;
    p.z = c.z + nz * need;
    const vn = p.vx * nx + p.vz * nz;
    if (vn < 0) {
      p.vx -= nx * vn * 1.3;
      p.vz -= nz * vn * 1.3;
    }
  }
  // 광장 밖 → 떨어짐
  if (Math.hypot(p.x, p.z) > geo.radius) {
    startFall(s, p);
    return;
  }
  // 점프대
  if (s.t >= p.padCdAt && p.move !== "stagger") {
    for (let i = 0; i < geo.pads.length; i++) {
      const pad = geo.pads[i];
      if (Math.hypot(p.x - pad.x, p.z - pad.z) > pad.r) continue;
      p.move = "pad";
      p.moveAt = s.t;
      p.px0 = p.x;
      p.pz0 = p.z;
      p.ptx = pad.tx;
      p.ptz = pad.tz;
      p.padCdAt = s.t + PAD_MS + PAD_CD_MS;
      p.face = Math.atan2(pad.tz - p.z, pad.tx - p.x);
      p.vx = p.vz = 0;
      p.stats.padJumps += 1;
      emit(s, { k: "pad", s: p.seat, i });
      break;
    }
  }
}

function startFall(s: MatchState, p: PlayerState) {
  const wasKing = isKing(s, p.seat);
  p.move = "fall";
  p.moveAt = s.t;
  p.respawnAt = s.t + RESPAWN_MS;
  p.stats.falls += 1;
  const by = p.lastHitBy >= 0 && p.lastHitBy !== p.seat && s.t - p.lastHitAt <= CREDIT_MS ? p.lastHitBy : -1;
  if (by >= 0) {
    s.players[by].stats.kos += 1;
    if (wasKing) s.players[by].stats.kingKos += 1;
  } else p.stats.selfFalls += 1;
  emit(s, { k: "fall", s: p.seat, by, x: p.x, z: p.z, king: wasKing });
  // 개인전·팀전: 왕관은 가장자리 안쪽에 떨어진다 · 저주는 그대로 붙어 있다
  if (wasKing && !isCurse(s)) dropCrown(s, p, p.x, p.z);
}

function dropCrown(s: MatchState, p: PlayerState, x: number, z: number) {
  const geo = geoOf(s);
  endReign(s, p);
  const r = Math.hypot(x, z);
  const lim = geo.radius - 1.4;
  let cx = r > lim ? (x / r) * lim : x;
  let cz = r > lim ? (z / r) * lim : z;
  const spot = clearSpot(geo, cx, cz);
  cx = spot.x;
  cz = spot.z;
  s.crown = { ...s.crown, state: "ground", holder: -1, x: cx, z: cz, at: s.t, invulnUntil: 0, prev: -1, prevUntil: 0, dropBan: p.seat, dropBanUntil: s.t + CROWN_DROP_BAN_MS };
  p.stats.lost += 1;
  emit(s, { k: "drop", s: p.seat, x: cx, z: cz });
}

/** 다시 나타나기: 반지름 55% 둘레에서 다른 사람(특히 왕)과 가장 먼 곳 */
function respawn(s: MatchState, p: PlayerState) {
  const geo = geoOf(s);
  const k = king(s);
  let best = { x: 0, z: 0 };
  let bestScore = -Infinity;
  const off = rnd(s) * Math.PI * 2;
  for (let i = 0; i < 12; i++) {
    const a = off + (i / 12) * Math.PI * 2;
    const spot = clearSpot(geo, Math.cos(a) * geo.radius * 0.55, Math.sin(a) * geo.radius * 0.55);
    let near = Infinity;
    for (const o of s.players) if (o !== p && onGround(o)) near = Math.min(near, Math.hypot(o.x - spot.x, o.z - spot.z));
    const kd = k && k !== p ? Math.hypot(k.x - spot.x, k.z - spot.z) : 10;
    const sc = Math.min(near, 8) + Math.min(kd, 10) * 0.5;
    if (sc > bestScore) {
      bestScore = sc;
      best = spot;
    }
  }
  Object.assign(p, { x: best.x, z: best.z, y: 0, vx: 0, vz: 0, move: "none", respawnAt: 0, ghostUntil: s.t + RESPAWN_GHOST_MS, lastHitBy: -1, slowUntil: 0 } satisfies Partial<PlayerState>);
  p.face = Math.atan2(-p.z, -p.x);
  emit(s, { k: "respawn", s: p.seat, x: p.x, z: p.z });
}

/** 몸끼리 부딪힘 — 같은 무게의 부드러운 탄성 충돌. 돌진한 몸에 박히면 휘청. */
function collideBodies(s: MatchState) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!inPlay(s, a)) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!inPlay(s, b)) continue;
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
      const aDash = a.move === "dash";
      const bDash = b.move === "dash";
      if (aDash !== bDash) {
        // 돌진한 쪽이 상대를 튕겨 낸다 (돌진한 쪽은 멈칫)
        const hit = aDash ? b : a;
        const dasher = aDash ? a : b;
        const dir = aDash ? 1 : -1;
        const sp = Math.hypot(dasher.vx, dasher.vz) * 0.7;
        hit.vx = nx * dir * sp;
        hit.vz = nz * dir * sp;
        dasher.vx *= 0.25;
        dasher.vz *= 0.25;
        dasher.move = "none";
        if (!allies(s, a.seat, b.seat)) {
          stagger(s, hit, DASH_HIT_STAGGER_MS, dasher.seat);
          dasher.stats.dashHits += 1;
        }
        emit(s, { k: "dashHit", a: dasher.seat, b: hit.seat, x: a.x + nx * BODY_R, z: a.z + nz * BODY_R });
        continue;
      }
      const J = ((1 + RESTITUTION) * vn) / 2;
      a.vx -= nx * J;
      a.vz -= nz * J;
      b.vx += nx * J;
      b.vz += nz * J;
      if (vn > 3) {
        a.lastHitBy = b.seat;
        a.lastHitAt = s.t;
        b.lastHitBy = a.seat;
        b.lastHitAt = s.t;
        emit(s, { k: "bump", a: a.seat, b: b.seat, x: a.x + nx * BODY_R, z: a.z + nz * BODY_R, p: Math.round(vn * 10) / 10 });
      }
    }
  }
}

/* ── 왕관 ───────────────────────────────────────────────────────────── */

function endReign(s: MatchState, p: PlayerState) {
  if (p.reignStart > 0 || isKing(s, p.seat)) {
    p.stats.bestReignMs = Math.max(p.stats.bestReignMs, Math.round(s.t - p.reignStart));
    p.lastCrownAt = s.t;
  }
  p.reignStart = 0;
}

/** 왕관 넘기기 (from = -1이면 바닥에서 줍기·저주가 처음 내려앉음) */
function giveCrown(s: MatchState, to: PlayerState, from: number) {
  const prev = from >= 0 ? s.players[from] : null;
  if (prev) {
    endReign(s, prev);
    prev.stats.lost += 1;
    to.stats.steals += 1;
  } else if (s.crown.state === "ground") to.stats.pickups += 1;
  s.crown = {
    ...s.crown,
    state: "held",
    holder: to.seat,
    x: to.x,
    z: to.z,
    at: s.t,
    invulnUntil: s.t + INVULN_MS,
    prev: from,
    prevUntil: from >= 0 ? s.t + REVENGE_MS : 0,
    dropBan: -1,
    dropBanUntil: 0,
  };
  to.reignStart = s.t;
  to.lastCrownAt = s.t;
  to.skillUsed = false;
  to.fakeUntil = 0;
  s.transfers += 1;
  emit(s, { k: "steal", s: to.seat, from, x: to.x, z: to.z });
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function crownLogic(rt: HostRuntime) {
  const s = rt.state;
  const c = s.crown;
  if (c.state === "pending") {
    if (s.t < s.fightStart + CROWN_DROP_MS) return;
    if (isCurse(s)) {
      // 저주는 무작위 한 사람에게 내려앉는다 (다시 나타나는 중인 사람은 빼고)
      const pool = s.players.filter((p) => inPlay(s, p));
      const pick = (pool.length ? pool : s.players)[Math.floor(rnd(s) * (pool.length || s.players.length))];
      giveCrown(s, pick, -1);
    } else {
      s.crown = { ...c, state: "ground", x: 0, z: 0, at: s.t };
      emit(s, { k: "crownLand", x: 0, z: 0 });
    }
    return;
  }
  if (c.state === "ground") {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const p of s.players) {
      if (!inPlay(s, p) || (c.dropBan === p.seat && s.t < c.dropBanUntil)) continue;
      const d = dist(p, c);
      if (d <= CROWN_PICK_R && (d < bestD - 0.005 || (Math.abs(d - bestD) <= 0.005 && best && tieBetter(s, p, best)))) {
        best = p;
        bestD = d;
      }
    }
    if (best) giveCrown(s, best, -1);
    return;
  }
  // held
  const k = s.players[c.holder];
  if (!k) return;
  c.x = k.x;
  c.z = k.z;
  if (s.t >= c.invulnUntil && s.t - STEP_MS < c.invulnUntil) emit(s, { k: "invulnEnd", s: k.seat });
  if (!inPlay(s, k) || s.t < c.invulnUntil) return;
  const kh = rt.hist[k.seat];
  const curse = isCurse(s);
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of s.players) {
    if (p === k || !inPlay(s, p) || revengeBanned(s, p.seat) || allies(s, p.seat, k.seat)) continue;
    // 개인전·팀전: 쫓는 사람(p)이 왕을 만짐 — 왕의 지난 위치까지 봐 준다
    // 저주: 왕이 p를 만짐 — p의 지난 위치까지 봐 준다 (쫓는 쪽 = 왕 유리)
    const reach = TOUCH_DIST + (hasMagnet(s, curse ? k : p) ? MAGNET_REACH : 0);
    let d = dist(p, k);
    const old = curse ? rt.hist[p.seat]?.[0] : kh?.[0];
    if (old) d = Math.min(d, curse ? dist(old, k) : dist(old, p));
    if (d > reach) continue;
    if (d < bestD - 0.005 || (Math.abs(d - bestD) <= 0.005 && best && tieBetter(s, p, best))) {
      best = p;
      bestD = d;
    }
  }
  if (best) giveCrown(s, best, k.seat);
}

/** 동시에 닿았을 때: 거리가 같으면 점수가 불리한 사람 → 자리 번호 낮은 사람 */
function tieBetter(s: MatchState, a: PlayerState, b: PlayerState): boolean {
  if (a.score !== b.score) return isCurse(s) ? a.score > b.score : a.score < b.score;
  return a.seat < b.seat;
}

/* ── 점수 ───────────────────────────────────────────────────────────── */

function scoring(s: MatchState) {
  const k = king(s);
  if (k) {
    const add = STEP_MS * (s.golden ? GOLDEN_MULT : 1);
    k.score += add;
    if (s.golden) k.stats.goldenMs += STEP_MS;
    if (isTeam(s)) s.teamScores[k.team] += add * s.teamMult[k.team];
  }
  // 1등 추적 (동점이면 그대로)
  let lead = -1;
  if (isTeam(s)) {
    const [a, b] = s.teamScores;
    lead = a > b ? 0 : b > a ? 1 : s.leader;
  } else {
    const sorted = [...s.players].sort((a, b) => (isCurse(s) ? a.score - b.score : b.score - a.score));
    lead = sorted.length > 1 && sorted[0].score === sorted[1].score ? s.leader : sorted[0].seat;
  }
  if (lead !== s.leader) {
    if (s.leader >= 0) s.leadChanges += 1;
    s.leader = lead;
  }
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

function freeSpot(s: MatchState, minFromPlayers: number): { x: number; z: number } | null {
  const geo = geoOf(s);
  for (let tries = 0; tries < 24; tries++) {
    const a = rnd(s) * Math.PI * 2;
    const r = Math.sqrt(rnd(s)) * geo.radius * 0.78;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (geo.pillars.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.6)) continue;
    if (geo.pads.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.6)) continue;
    if (geo.bushes.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue;
    if (s.players.some((p) => onGround(p) && Math.hypot(p.x - x, p.z - z) < minFromPlayers)) continue;
    if (s.items.some((it) => Math.hypot(it.x - x, it.z - z) < 2)) continue;
    return { x, z };
  }
  return null;
}

function items(s: MatchState) {
  for (const it of s.items) if (it.until <= s.t) emit(s, { k: "expire", kind: it.kind, x: it.x, z: it.z });
  s.items = s.items.filter((it) => it.until > s.t);
  for (const p of s.players) {
    if (!inPlay(s, p) || s.items.length === 0) continue;
    const got = s.items.find((it) => Math.hypot(it.x - p.x, it.z - p.z) < ITEM_PICK_R);
    if (!got) continue;
    s.items = s.items.filter((it) => it !== got);
    p.stats.items += 1;
    emit(s, { k: "pick", s: p.seat, kind: got.kind, x: got.x, z: got.z });
    if (got.kind === "banana") {
      const geo = geoOf(s);
      let bx = p.x - Math.cos(p.face) * BANANA_BEHIND;
      let bz = p.z - Math.sin(p.face) * BANANA_BEHIND;
      const r = Math.hypot(bx, bz);
      if (r > geo.radius - 0.6) {
        bx *= (geo.radius - 0.6) / r;
        bz *= (geo.radius - 0.6) / r;
      }
      const spot = clearSpot(geo, bx, bz);
      s.traps.push({ id: ++s.itemSeq, x: spot.x, z: spot.z, owner: p.seat, at: s.t, until: s.t + BANANA_LIFE_MS });
      if (s.traps.length > TRAP_MAX) s.traps.shift();
    } else if (got.kind === "magnet") p.magnetUntil = s.t + MAGNET_MS;
    else if (got.kind === "fake") {
      if (isKing(s, p.seat)) {
        // 왕이 주우면 다른 사람에게 가짜를 씌운다 (팀전이면 우리 팀원 우선 — 미끼)
        const pool = s.players.filter((o) => o !== p && onGround(o));
        const mates = pool.filter((o) => allies(s, o.seat, p.seat));
        const from = mates.length ? mates : pool;
        if (from.length) {
          const o = from[Math.floor(rnd(s) * from.length)];
          o.fakeUntil = s.t + FAKE_MS;
          emit(s, { k: "fakeOn", s: o.seat, by: p.seat });
        }
      } else {
        p.fakeUntil = s.t + FAKE_MS;
        emit(s, { k: "fakeOn", s: p.seat, by: p.seat });
      }
    }
  }
  if (s.t >= s.nextItemAt) {
    s.nextItemAt = s.t + ITEM_EVERY_MS;
    if (s.items.length < ITEM_MAX) {
      const spot = freeSpot(s, 2.2);
      if (spot) {
        const kinds = itemKindsFor(s.options.mode);
        const kind = kinds[Math.floor(rnd(s) * kinds.length)];
        s.items.push({ id: ++s.itemSeq, kind, x: spot.x, z: spot.z, until: s.t + ITEM_LIFE_MS });
        emit(s, { k: "spawn", kind, x: spot.x, z: spot.z });
      }
    }
  }
}

function traps(s: MatchState) {
  if (s.traps.length === 0) return;
  s.traps = s.traps.filter((tr) => tr.until > s.t);
  for (const tr of [...s.traps]) {
    for (const p of s.players) {
      if (!inPlay(s, p) || p.move === "stagger") continue;
      if (p.seat === tr.owner && s.t - tr.at < BANANA_OWNER_SAFE_MS) continue;
      if (Math.hypot(p.x - tr.x, p.z - tr.z) > BANANA_R + BODY_R * 0.5) continue;
      // 미끄러짐: 가던 방향으로 쭉 (멈춰 있었으면 보던 쪽으로)
      const sp = Math.max(5.5, Math.hypot(p.vx, p.vz) * 1.2);
      const a = Math.hypot(p.vx, p.vz) > 0.5 ? Math.atan2(p.vz, p.vx) : p.face;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      stagger(s, p, BANANA_SLIP_MS, tr.owner === p.seat ? -1 : tr.owner);
      p.stats.slipped += 1;
      if (tr.owner !== p.seat) s.players[tr.owner].stats.bananaHits += 1;
      s.traps = s.traps.filter((x) => x !== tr);
      emit(s, { k: "slip", s: p.seat, by: tr.owner, x: tr.x, z: tr.z });
      break;
    }
  }
}

/* ── 끝 ─────────────────────────────────────────────────────────────── */

/** 개인전 순위 키 (클수록 앞): 점수 → 끝날 때 왕관 → 마지막으로 왕관 쓴 시각 → 뺏은 횟수 */
export function rankKey(s: MatchState, p: PlayerState): number[] {
  const holding = isKing(s, p.seat) ? 1 : 0;
  if (isCurse(s)) return [-Math.round(p.score), 1 - holding, -p.stats.lost, p.stats.steals];
  return [Math.round(p.score), holding, Math.round(p.lastCrownAt), p.stats.steals];
}

export function computeRanks(s: MatchState): number[] {
  if (isTeam(s)) {
    const [a, b] = s.teamScores.map((v) => Math.round(v));
    let win = a > b ? 0 : b > a ? 1 : -1;
    if (win < 0 && s.crown.state === "held") win = s.players[s.crown.holder].team;
    s.winnerTeam = win;
    return s.players.map((p) => (win < 0 || p.team === win ? 1 : 2));
  }
  const cmp = (a: PlayerState, b: PlayerState) => {
    const ka = rankKey(s, a);
    const kb = rankKey(s, b);
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
  const k = king(s);
  if (k) {
    k.stats.crownAtEnd = 1;
    // 기록만 마무리 (왕관은 끝까지 쓴 채로 결과 화면에)
    k.stats.bestReignMs = Math.max(k.stats.bestReignMs, Math.round(s.t - k.reignStart));
    k.lastCrownAt = s.t;
  }
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.phaseEnd = s.t;
  s.items = [];
  s.traps = [];
  s.ranks = computeRanks(s);
  emit(s, { k: "over" });
}

/** 화면용: 남은 경기 시간 ms */
export function timeLeft(s: MatchState): number {
  if (s.phase === "countdown") return s.fightEnd - s.fightStart;
  if (s.phase === "gameOver") return 0;
  return Math.max(0, s.fightEnd - s.t);
}
