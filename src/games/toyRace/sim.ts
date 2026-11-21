import {
  BATTERY_MS,
  BATTERY_MULT,
  BOX_R,
  BOX_RESPAWN_MS,
  BUBBLE_MS,
  CAR_R,
  CATCHUP_FREE,
  CATCHUP_MAX,
  CATCHUP_RANGE,
  COUNTDOWN_MS,
  CRASH_MS,
  DUCK_BEHIND,
  DUCK_LIFE_MS,
  DUCK_MAX,
  DUCK_OWNER_SAFE_MS,
  DUCK_R,
  FINISH_GRACE_MS,
  GP_POINTS,
  GP_TRACKS,
  INTERMISSION_MS,
  ITEM_KINDS,
  ITEM_ROLL_MS,
  LAP_TIMEOUT_MS,
  RESET_MS,
  ROCKET_BOOST_MS,
  SPIN_IMMUNE_MS,
  SPIN_MS,
  STALL_MS,
  STEP_MS,
  TOP_MS,
  TOY_AHEAD,
  TOY_AUTO_MS,
  TOY_LEN,
  TOY_LIFE_MS,
  TOY_WARN_MS,
  TRACK_IDS,
  V_MAX,
  YARN_LIFE_MS,
  YARN_R,
  YARN_SAFE_MS,
  YARN_SPEED,
  YOYO_MAX_MS,
  YOYO_SPEED,
  itemWeights,
  sanitizeOptions,
  type GameOptions,
  type ItemKind,
  type TrackId,
} from "./data";
import { collidePair, draftUpdate, driftTier, giveBoost, inAir, newCar, placeCar, stepCar, type Car, type CarEvent, type CarInput, IDLE_INPUT } from "./physics";
import { gridSpot, latLimit, pointAt, project, trackFor, trainState, wrapDelta, wrapS, type Track } from "./track";

/**
 * 장난감 방 레이스 시뮬레이션 — 방장 기기만 돌린다 (룰북 §10).
 *
 * - 봇 차: 방장이 physics.ts로 직접 움직인다.
 * - 사람 차: 각자 기기가 physics.ts로 **자기 차를 미리 움직이고**(입력 지연 없음) 위치를 `pos`로 보낸다.
 *   방장은 그 위치를 검사(속도 한계·울타리)해 받아들이고, 진행 거리·바퀴·순위·아이템·맞음은 방장이 정한다.
 *   사람 차에 생기는 효과(빙글·부스트·팽이·순간이동 보정)는 카운터(fxSpin…, tp)로 내려보내 그 기기가 적용한다.
 * - 고정 위험물(고무 오리·장난감 벽·기차)은 차 주인이 스스로 판정한다(사람 = 자기 기기, 봇 = 방장).
 *   사람은 부딪힌 것을 `hz`로 알려 방장이 오리를 치우고 기록을 남긴다.
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다 → 방장이 나가도 손님이 이어받는다.
 * 난수는 상태 안의 `rng`(mulberry32)만 쓴다.
 */

export type Phase = "countdown" | "race" | "raceEnd" | "gameOver";

export interface PlayerStats {
  /** 이번 판 아이템 상자 깬 수 */
  boxes: number;
  items: number;
  /** 내 아이템으로 남을 빙글 돌린 수 (털실·오리·요요·팽이) */
  hits: number;
  /** 내가 빙글 돈 수 */
  spun: number;
  /** 🫧 방패로 막은 수 */
  blocked: number;
  walls: number;
  driftBoosts: number;
  /** 2단(주황) 드리프트 부스트 */
  bigDrifts: number;
  jumps: number;
  perfectLands: number;
  rockets: number;
  stalls: number;
  /** 🧸 꼴찌 장난감을 던진 수 / 그 벽에 선두가 박은 수 */
  toyDrops: number;
  toyHits: number;
  /** 장난감 벽·기차·샴푸 통에 박은 수 */
  crashes: number;
  /** 순위를 올린 횟수 (추월) */
  passes: number;
  resets: number;
  /** 이번 판(그랑프리는 레이스마다 더함) 가장 빠른 랩 ms */
  bestLapMs: number;
  /** 1등으로 들어온 레이스 수 */
  raceWins: number;
}

const zeroStats = (): PlayerStats => ({
  boxes: 0,
  items: 0,
  hits: 0,
  spun: 0,
  blocked: 0,
  walls: 0,
  driftBoosts: 0,
  bigDrifts: 0,
  jumps: 0,
  perfectLands: 0,
  rockets: 0,
  stalls: 0,
  toyDrops: 0,
  toyHits: 0,
  crashes: 0,
  passes: 0,
  resets: 0,
  bestLapMs: 0,
  raceWins: 0,
});

/** 화면용 상태 비트 (사람 차는 자기 기기가, 봇 차는 방장이 채운다) */
export const FL = { drift: 1, drift1: 2, drift2: 4, boost: 8, brake: 16, spin: 32, air: 64, top: 128, reset: 256, stall: 512, draft: 1024 } as const;

export interface PlayerState extends Car {
  seat: number;
  bot: boolean;
  lv: number;
  /** 사람이 나가서 봇이 대신 하는 중 */
  away: boolean;
  item: ItemKind | null;
  /** 아이템을 받은 시각 (룰렛이 끝나야 쓸 수 있음) */
  itemAt: number;
  /** 🧸 꼴찌의 장난감 (0/1) · 받은 시각 */
  toy: number;
  toyAt: number;
  shieldUntil: number;
  /** 빙글 뒤 잠깐 무적 */
  immuneUntil: number;
  /** 다 돈 바퀴 */
  laps: number;
  lapStart: number;
  lastLapMs: number;
  /** 지금 순위 (1부터) */
  rank: number;
  /** 들어온 시각 (0 = 아직) · 들어온 순서 */
  finishedAt: number;
  finishRank: number;
  /** 출발 부스트 결과 (1 성공 · −1 시동 꺼짐 · 0 아무것도 안 함) */
  rocket: number;
  flags: number;
  /** 사람 차에 내려보내는 효과 카운터 */
  fxSpin: number;
  fxSpinMs: number;
  fxBoost: number;
  fxBoostMs: number;
  fxBoostMult: number;
  fxTop: number;
  /** 순간이동 보정 카운터 (늘면 그 기기가 지금 위치로 차를 옮긴다) */
  tp: number;
  /** 그랑프리 누적 점수 · 레이스별 순위 */
  points: number;
  raceRanks: number[];
  stats: PlayerStats;
}

export interface Box {
  /** 다시 생기는 시각 (0 = 지금 있음) */
  back: number;
}

export interface Projectile {
  id: number;
  kind: "yarn" | "yoyo";
  owner: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  seg: number;
  born: number;
  until: number;
  /** 요요: 쫓는 차 · 트랙 진행 거리 · 옆 위치 */
  target: number;
  d: number;
  lat: number;
}

export interface Duck {
  id: number;
  x: number;
  z: number;
  y: number;
  owner: number;
  at: number;
  until: number;
}

export interface Toy {
  id: number;
  /** 트랙 위치 · 막는 쪽(+1 오른쪽 반 / −1 왼쪽 반, 운전석 기준) */
  s: number;
  side: number;
  owner: number;
  target: number;
  /** 표적(선두)의 진행 거리로 본 벽 위치 — 표적이 이걸 지나가면 벽이 무너진다 */
  d: number;
  /** 그림자가 보이기 시작 · 벽이 생김 · 사라짐 */
  at: number;
  activeAt: number;
  until: number;
  x: number;
  z: number;
  y: number;
  h: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "go" }
  | { k: "rocket"; s: number; ok: boolean }
  | { k: "lap"; s: number; lap: number; ms: number; best: boolean }
  | { k: "finalLap"; s: number }
  | { k: "finish"; s: number; rank: number; ms: number }
  | { k: "box"; s: number; i: number; kind: ItemKind | null; x: number; z: number }
  | { k: "use"; s: number; kind: ItemKind; x: number; z: number }
  | { k: "hit"; s: number; by: number; kind: ItemKind | "toy" | "train" | "bottle"; x: number; z: number }
  | { k: "block"; s: number; kind: ItemKind | "toy" | "train"; x: number; z: number }
  | { k: "toyGet"; s: number }
  | { k: "toyDrop"; s: number; target: number; toy: number; x: number; z: number }
  | { k: "toyLand"; toy: number; x: number; z: number }
  | { k: "toyBreak"; toy: number; x: number; z: number }
  | { k: "bump"; a: number; b: number; x: number; z: number; p: number }
  | { k: "wall"; s: number; p: number; x: number; z: number }
  | { k: "driftBoost"; s: number; tier: 1 | 2 }
  | { k: "jump"; s: number }
  | { k: "land"; s: number; perfect: boolean; x: number; z: number }
  | { k: "pass"; s: number; over: number }
  | { k: "firstFinish"; s: number }
  | { k: "raceOver"; race: number }
  | { k: "nextRace"; race: number; track: TrackId }
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
  /** 몇 번째 레이스 (0부터, 단판은 0만) · 레이스 수 */
  race: number;
  races: number;
  track: TrackId;
  /** 출발 시각 (카운트다운 끝) */
  goAt: number;
  firstFinishAt: number;
  finishCount: number;
  /** 지금까지 가장 많이 돈 바퀴 (꼴찌 장난감 줄 때) */
  maxLap: number;
  players: PlayerState[];
  boxes: Box[];
  projectiles: Projectile[];
  ducks: Duck[];
  toys: Toy[];
  objSeq: number;
  events: GameEvent[];
  eventSeq: number;
  /** 순위가 바뀐 횟수 (기록·밸런스) */
  passes: number;
  /** 마지막 바퀴를 시작할 때 선두 (막판 역전 기록) */
  finalLeader: number;
  /** 직전 레이스 순위 (자리별) — 레이스 사이 결과 화면 */
  raceRanks: number[] | null;
  /** 끝났을 때 최종 순위 (자리별, 1부터) */
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

export const trackOf = (s: MatchState): Track => trackFor(s.track);

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

function emit(s: MatchState, e: EventBody) {
  s.events.push({ ...(e as object), id: ++s.eventSeq, at: s.t } as GameEvent);
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

function newPlayer(seat: number, spec: SeatSpec, track: Track): PlayerState {
  const g = gridSpot(track, seat);
  return {
    ...newCar(track, g.x, g.z, g.h, g.s, g.i),
    seat,
    bot: spec.bot,
    lv: Math.max(1, Math.min(10, Math.round(spec.level) || 5)),
    away: false,
    item: null,
    itemAt: 0,
    toy: 0,
    toyAt: 0,
    shieldUntil: 0,
    immuneUntil: 0,
    laps: 0,
    lapStart: 0,
    lastLapMs: 0,
    rank: seat + 1,
    finishedAt: 0,
    finishRank: 0,
    rocket: 0,
    flags: 0,
    fxSpin: 0,
    fxSpinMs: 0,
    fxBoost: 0,
    fxBoostMs: 0,
    fxBoostMult: 1,
    fxTop: 0,
    tp: 0,
    points: 0,
    raceRanks: [],
    stats: zeroStats(),
  };
}

function trackForRace(opts: GameOptions, race: number, s: { rng: number }): TrackId {
  if (opts.mode === "gp") return GP_TRACKS[race % GP_TRACKS.length];
  if (opts.track === "random") return TRACK_IDS[Math.floor(rnd(s) * TRACK_IDS.length)];
  return opts.track;
}

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const opts = sanitizeOptions(options);
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: seats.length,
    options: opts,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: COUNTDOWN_MS,
    race: 0,
    races: opts.mode === "gp" ? GP_TRACKS.length : 1,
    track: "living",
    goAt: COUNTDOWN_MS,
    firstFinishAt: 0,
    finishCount: 0,
    maxLap: 0,
    players: [],
    boxes: [],
    projectiles: [],
    ducks: [],
    toys: [],
    objSeq: 0,
    events: [],
    eventSeq: 0,
    passes: 0,
    finalLeader: -1,
    raceRanks: null,
    ranks: null,
  };
  s.track = trackForRace(opts, 0, s);
  const tr = trackOf(s);
  s.players = seats.map((spec, i) => newPlayer(i, spec, tr));
  // 첫 레이스 출발 순서는 무작위
  const order = s.players.map((p) => p.seat);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  setupRace(s, order);
  return s;
}

/** 레이스 준비: 트랙 표본·상자·출발 자리 (order[k] = k번째 출발 칸에 설 자리) */
function setupRace(s: MatchState, order: number[]) {
  const tr = trackOf(s);
  s.boxes = tr.boxes.map(() => ({ back: 0 }));
  s.projectiles = [];
  s.ducks = [];
  s.toys = [];
  s.firstFinishAt = 0;
  s.finishCount = 0;
  s.maxLap = 0;
  s.finalLeader = -1;
  s.phase = "countdown";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + COUNTDOWN_MS;
  s.goAt = s.phaseEnd;
  order.forEach((seat, slot) => {
    const p = s.players[seat];
    const g = gridSpot(tr, slot);
    const keep = { seat: p.seat, bot: p.bot, lv: p.lv, away: p.away, points: p.points, raceRanks: p.raceRanks, stats: p.stats, fxSpin: p.fxSpin, fxBoost: p.fxBoost, fxTop: p.fxTop, tp: p.tp + 1 };
    Object.assign(p, newPlayer(seat, { bot: p.bot, level: p.lv }, tr), keep, newCar(tr, g.x, g.z, g.h, g.s, g.i));
    p.rank = slot + 1;
    p.lapStart = s.goAt;
    p.stallUntil = s.goAt;
  });
}

/* ── 입력·보고 ─────────────────────────────────────────────────────── */

/** 사람 기기가 보내는 내 차 보고 (~15번/초) */
export interface PosReport {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  h: number;
  /** FL 비트 */
  fl: number;
  /** 누른 횟수 카운터: 아이템 · 꼴찌 장난감 · 제자리로 */
  ni: number;
  nt: number;
  nr: number;
  /** 출발 부스트 결과 (1/−1/0) */
  rk: number;
  /** 받은 순간이동 보정 번호 (이보다 오래된 보고는 버림) */
  tp: number;
  /** 몇 번째 레이스의 보고인가 */
  race: number;
  /** 스스로 부딪힌 위험물 (오리 id · 장난감 벽 id · 기차 −1 · 샴푸 통 −2) — 막았으면 b = 1 */
  hz?: { k: "duck" | "toy" | "train" | "bottle"; id: number; b?: number }[];
  /** 내 기기에서 생긴 기록 (누적): 울타리 · 드리프트 부스트(1단/2단) · 점프 · 완벽 착지 */
  st?: { w: number; d1: number; d2: number; j: number; pl: number };
}

export interface BotBrain {
  nextThinkAt: number;
  /** 고른 옆 위치 (레이싱 라인) */
  lane: number;
  laneUntil: number;
  /** 드리프트 중인 코너 */
  drifting: boolean;
  /** 아이템을 쓰려고 기다린 시각 */
  holdSince: number;
  /** 막혀서 못 가는 시간 */
  stuckMs: number;
}

export interface HostRuntime {
  state: MatchState;
  inputs: CarInput[];
  acc: number;
  bots: BotBrain[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
  /** 사람 보고: 마지막 받은 시각(방장 시계)·카운터·누적 기록 */
  rep: { at: number; ni: number; nt: number; nr: number; st: { w: number; d1: number; d2: number; j: number; pl: number } }[];
}

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, () => ({ ...IDLE_INPUT })),
    acc: 0,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, lane: 0, laneUntil: 0, drifting: false, holdSince: 0, stuckMs: 0 })),
    think,
    botRng: { rng: (state.seed ^ 0x5bd1e995) | 0 },
    rep: Array.from({ length: n }, () => ({ at: -1, ni: -1, nt: -1, nr: -1, st: { w: 0, d1: 0, d2: 0, j: 0, pl: 0 } })),
  };
}

export function setInput(rt: HostRuntime, seat: number, inp: Partial<CarInput>) {
  const cur = rt.inputs[seat];
  if (!cur) return;
  cur.steer = Math.max(-1, Math.min(1, Number(inp.steer) || 0));
  cur.brake = !!inp.brake;
  cur.drift = !!inp.drift;
}

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/**
 * 사람 차 보고 받기. 이상한 값(너무 빨리 이동·울타리 밖)은 버리고 순간이동 보정(tp)을 보낸다.
 * 돌려주는 값: 받아들였나.
 */
export function applyReport(rt: HostRuntime, seat: number, r: Partial<PosReport> | null | undefined): boolean {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || p.bot || !r || !Number.isInteger(seat)) return false;
  if (!finite(r.x) || !finite(r.z) || !finite(r.h) || !finite(r.vx) || !finite(r.vz)) return false;
  if ((r.race ?? -1) !== s.race) return false;
  // 순간이동 보정을 아직 못 받은 보고는 버림 (옛 위치로 되돌아가지 않게)
  if ((r.tp ?? -1) < p.tp) return false;
  const rep = rt.rep[seat];
  // 누른 횟수: 처음 보는 기기면 기준만 잡는다
  const first = rep.ni < 0;
  if (first) {
    rep.ni = r.ni ?? 0;
    rep.nt = r.nt ?? 0;
    rep.nr = r.nr ?? 0;
    rep.st = { ...(r.st ?? { w: 0, d1: 0, d2: 0, j: 0, pl: 0 }) };
  }
  if (s.phase === "race" && !p.finishedAt) {
    const tr = trackOf(s);
    const dt = rep.at >= 0 ? Math.max(30, s.t - rep.at) : 200;
    const moved = Math.hypot(r.x! - p.x, r.z! - p.z);
    const maxMove = V_MAX * BATTERY_MULT * 1.5 * (dt / 1000) + 2.5;
    const pr = project(tr, r.x!, r.z!, p.seg);
    const side = pr.lat >= 0 ? 1 : -1;
    if (moved > maxMove || Math.abs(pr.lat) > latLimit(tr, pr.i, side) + 0.8) {
      // 믿을 수 없는 위치 → 방장이 아는 자리로 되돌린다
      p.tp += 1;
      rep.at = s.t;
      return false;
    }
    p.x = r.x!;
    p.z = r.z!;
    p.y = finite(r.y) ? r.y! : pr.y;
    p.vx = r.vx!;
    p.vz = r.vz!;
    p.h = r.h!;
    const d = wrapDelta(pr.s - p.lastS, tr.L);
    if (Math.abs(d) < 25) p.dist += d;
    p.lastS = pr.s;
    p.seg = pr.i;
  }
  p.flags = (r.fl ?? 0) | 0;
  if (s.phase === "race" && r.rk && p.rocket === 0) {
    p.rocket = r.rk > 0 ? 1 : -1;
    if (p.rocket > 0) p.stats.rockets += 1;
    else p.stats.stalls += 1;
    emit(s, { k: "rocket", s: seat, ok: p.rocket > 0 });
  }
  if (!first) {
    if ((r.ni ?? 0) > rep.ni) {
      rep.ni = r.ni!;
      fireItem(rt, seat);
    }
    if ((r.nt ?? 0) > rep.nt) {
      rep.nt = r.nt!;
      dropToy(rt, seat);
    }
    if ((r.nr ?? 0) > rep.nr) {
      rep.nr = r.nr!;
      p.stats.resets += 1;
    }
    if (r.st) {
      const st = r.st;
      p.stats.walls += Math.max(0, (st.w | 0) - rep.st.w);
      const d1 = Math.max(0, (st.d1 | 0) - rep.st.d1);
      const d2 = Math.max(0, (st.d2 | 0) - rep.st.d2);
      p.stats.driftBoosts += d1 + d2;
      p.stats.bigDrifts += d2;
      p.stats.jumps += Math.max(0, (st.j | 0) - rep.st.j);
      p.stats.perfectLands += Math.max(0, (st.pl | 0) - rep.st.pl);
      rep.st = { w: st.w | 0, d1: st.d1 | 0, d2: st.d2 | 0, j: st.j | 0, pl: st.pl | 0 };
    }
  }
  if (r.hz && s.phase === "race") for (const h of r.hz.slice(0, 4)) selfHazard(rt, seat, h);
  rep.at = s.t;
  return true;
}

/** 사람이 스스로 판정한 위험물 충돌 (기록·오리 치우기·방패 소모) */
function selfHazard(rt: HostRuntime, seat: number, h: { k: string; id: number; b?: number }) {
  const s = rt.state;
  const p = s.players[seat];
  if (h.k === "duck") {
    const d = s.ducks.find((x) => x.id === h.id);
    if (!d) return;
    s.ducks = s.ducks.filter((x) => x !== d);
    if (h.b) {
      p.shieldUntil = 0;
      p.stats.blocked += 1;
      emit(s, { k: "block", s: seat, kind: "duck", x: d.x, z: d.z });
    } else {
      p.stats.spun += 1;
      if (d.owner !== seat) s.players[d.owner].stats.hits += 1;
      p.spinUntil = s.t + SPIN_MS;
      emit(s, { k: "hit", s: seat, by: d.owner, kind: "duck", x: d.x, z: d.z });
    }
  } else if (h.k === "toy") {
    const toy = s.toys.find((x) => x.id === h.id);
    if (!toy) return;
    if (h.b) {
      p.shieldUntil = 0;
      p.stats.blocked += 1;
      s.toys = s.toys.filter((x) => x !== toy);
      emit(s, { k: "toyBreak", toy: toy.id, x: toy.x, z: toy.z });
    } else {
      p.stats.crashes += 1;
      if (toy.owner !== seat) s.players[toy.owner].stats.toyHits += 1;
      s.toys = s.toys.filter((x) => x !== toy);
      emit(s, { k: "hit", s: seat, by: toy.owner, kind: "toy", x: p.x, z: p.z });
      emit(s, { k: "toyBreak", toy: toy.id, x: toy.x, z: toy.z });
    }
  } else if (h.k === "train") {
    p.stats.crashes += 1;
    emit(s, { k: "hit", s: seat, by: -1, kind: "train", x: p.x, z: p.z });
  }
}

/** 사람이 나가면 봇이 대신, 돌아오면 돌려준다 (돌려줄 때 그 기기 차를 지금 위치로 맞춘다) */
export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p) return;
  if (away && !p.bot) {
    p.bot = true;
    p.away = true;
  } else if (!away && p.away) {
    p.bot = false;
    p.away = false;
    p.tp += 1;
    rt.inputs[seat] = { ...IDLE_INPUT };
    rt.rep[seat] = { at: -1, ni: -1, nt: -1, nr: -1, st: { w: 0, d1: 0, d2: 0, j: 0, pl: 0 } };
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
    if (s.t >= s.phaseEnd) startRace(rt);
  } else if (s.phase === "race") {
    race(rt);
  } else if (s.phase === "raceEnd") {
    coast(rt);
    if (s.t >= s.phaseEnd) nextRace(rt);
  } else coast(rt);
  if (s.events.length > 0 && s.events[0].at < s.t - 3000) s.events = s.events.filter((e) => e.at >= s.t - 3000);
}

function startRace(rt: HostRuntime) {
  const s = rt.state;
  s.phase = "race";
  s.phaseStart = s.t;
  s.goAt = s.t;
  for (const p of s.players) {
    p.stallUntil = 0;
    p.lapStart = s.t;
  }
  emit(s, { k: "go" });
}

/** 레이스가 끝난 뒤: 봇 차는 천천히 선다 (사람 차는 자기 기기가) */
function coast(rt: HostRuntime) {
  const s = rt.state;
  const tr = trackOf(s);
  for (const p of s.players) {
    if (!p.bot) continue;
    const inp = rt.inputs[p.seat];
    inp.brake = true;
    stepCar(p, inp, tr, s.t, STEP_MS / 1000);
  }
}

function race(rt: HostRuntime) {
  const s = rt.state;
  const tr = trackOf(s);
  const dt = STEP_MS / 1000;
  // 🐢 뒤처짐 바람 (사람 차는 스냅샷으로 받아 자기 기기에서 적용)
  let leadDist = -Infinity;
  for (const p of s.players) if (!p.finishedAt) leadDist = Math.max(leadDist, p.dist);
  for (const p of s.players) p.catchup = p.finishedAt ? 1 : catchupFor(leadDist - p.dist);
  if (rt.think) for (const p of s.players) if (p.bot && !p.finishedAt) rt.think(rt, p.seat);
  for (const p of s.players) {
    if (!p.bot) continue;
    const inp: CarInput = p.finishedAt ? { steer: rt.inputs[p.seat].steer * 0.5, brake: s.t - p.finishedAt > 1500, drift: false } : rt.inputs[p.seat];
    const ev = stepCar(p, inp, tr, s.t, dt);
    for (const e of ev) botCarEvent(s, p, e);
    p.flags = botFlags(s, p, inp);
  }
  // 차끼리 부딪힘: 봇 차만 밀린다 (사람 차는 자기 기기가 피한다)
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      if (a.finishedAt || b.finishedAt) continue;
      topBump(rt, a, b);
      if (!a.bot && !b.bot) continue;
      if (inAir(a, s.t) || inAir(b, s.t)) continue;
      const vn = collidePair(a, b, a.bot, b.bot);
      if (vn > 3.2) emit(s, { k: "bump", a: a.seat, b: b.seat, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, p: Math.round(vn * 10) / 10 });
    }
  }
  for (const p of ps) if (p.bot) p.draftMs = draftUpdate(p, ps.filter((o) => o !== p), STEP_MS);
  for (const p of ps) if (p.bot && !p.finishedAt) botHazards(rt, p);
  boxes(rt);
  projectiles(rt);
  toys(rt);
  ducksExpire(s);
  progressAll(rt);
  // 레이스 끝: 모두 들어옴 · 첫 사람 뒤 15초 · 너무 오래 걸림
  const allIn = ps.every((p) => p.finishedAt > 0);
  const grace = s.firstFinishAt > 0 && s.t >= s.firstFinishAt + FINISH_GRACE_MS;
  const timeout = s.t >= s.goAt + s.options.laps * LAP_TIMEOUT_MS;
  if (allIn || grace || timeout) endRace(rt);
}

/** 선두와의 거리 → 최고 속도 배수 */
export function catchupFor(gap: number): number {
  return 1 + Math.max(0, Math.min(1, (gap - CATCHUP_FREE) / CATCHUP_RANGE)) * CATCHUP_MAX;
}

function botCarEvent(s: MatchState, p: PlayerState, e: CarEvent) {
  if (e.k === "wall" || e.k === "obstacle") {
    p.stats.walls += 1;
    if (e.p > 4) emit(s, { k: "wall", s: p.seat, p: e.p, x: e.x, z: e.z });
  } else if (e.k === "driftBoost") {
    p.stats.driftBoosts += 1;
    if (e.tier === 2) p.stats.bigDrifts += 1;
    emit(s, { k: "driftBoost", s: p.seat, tier: e.tier });
  } else if (e.k === "jump") {
    p.stats.jumps += 1;
    emit(s, { k: "jump", s: p.seat });
  } else if (e.k === "land") {
    if (e.perfect) p.stats.perfectLands += 1;
    emit(s, { k: "land", s: p.seat, perfect: e.perfect, x: p.x, z: p.z });
  }
}

export function botFlags(s: MatchState, p: Car, inp: CarInput): number {
  let f = 0;
  const tier = driftTier(p);
  if (p.drift !== 0) f |= FL.drift;
  if (tier === 1) f |= FL.drift1;
  if (tier === 2) f |= FL.drift2;
  if (s.t < p.boostUntil) f |= FL.boost;
  if (inp.brake) f |= FL.brake;
  if (s.t < p.spinUntil) f |= FL.spin;
  if (inAir(p, s.t)) f |= FL.air;
  if (s.t < p.topUntil) f |= FL.top;
  if (s.t < p.resetUntil) f |= FL.reset;
  if (s.t < p.stallUntil) f |= FL.stall;
  if (p.draftMs >= 600) f |= FL.draft;
  return f;
}

/* ── 맞음 ───────────────────────────────────────────────────────────── */

/** 지금 무적인가 (팽이·빙글 직후) */
export function immune(s: MatchState, p: PlayerState): boolean {
  return s.t < p.immuneUntil || s.t < p.topUntil || p.finishedAt > 0;
}

/** 빙글 (털실·요요·팽이 — 방장이 판정하는 것). 방패면 터지고 끝. */
function applyHit(rt: HostRuntime, v: PlayerState, by: number, kind: ItemKind, x: number, z: number): boolean {
  const s = rt.state;
  if (immune(s, v)) return false;
  if (s.t < v.shieldUntil) {
    v.shieldUntil = 0;
    v.stats.blocked += 1;
    emit(s, { k: "block", s: v.seat, kind, x, z });
    return true;
  }
  spin(s, v, SPIN_MS);
  if (by >= 0 && by !== v.seat) s.players[by].stats.hits += 1;
  emit(s, { k: "hit", s: v.seat, by, kind, x, z });
  return true;
}

function spin(s: MatchState, v: PlayerState, ms: number) {
  v.stats.spun += 1;
  v.spinUntil = s.t + ms;
  v.immuneUntil = s.t + ms + SPIN_IMMUNE_MS;
  v.drift = 0;
  v.driftMs = 0;
  if (!v.bot) {
    v.fxSpin += 1;
    v.fxSpinMs = ms;
  }
}

/** 🌀 팽이로 부딪힘: 팽이 쪽이 아닌 차가 빙글 */
function topBump(rt: HostRuntime, a: PlayerState, b: PlayerState) {
  const s = rt.state;
  const ta = s.t < a.topUntil;
  const tb = s.t < b.topUntil;
  if (ta === tb) return;
  const [top, other] = ta ? [a, b] : [b, a];
  if (Math.abs(top.y - other.y) > 0.8 || Math.hypot(top.x - other.x, top.z - other.z) > CAR_R * 2 + 0.15) return;
  applyHit(rt, other, top.seat, "top", other.x, other.z);
}

/* ── 봇 차 위험물 (사람 차는 자기 기기가 같은 함수로 판정) ───────────── */

export type HazardHit = { k: "duck"; id: number; owner: number } | { k: "toy"; id: number; owner: number } | { k: "train" };

/**
 * 이 차가 지금 부딪힌 위험물 (오리·장난감 벽·기차). `t`는 방장 시각 기준.
 * 사람 기기도 스냅샷으로 같은 판정을 한다 (`LocalDriver`).
 */
export function hazardAt(s: MatchState, car: Car, seat: number, t: number, carT = t): HazardHit | null {
  // 공중이거나 이미 빙글·박는 중이면 안 맞는다 (같은 벽에 연달아 박히지 않게). carT = 이 차 타이머의 시계
  if (inAir(car, carT) || carT < car.spinUntil) return null;
  const tr = trackOf(s);
  for (const d of s.ducks) {
    if (d.owner === seat && t - d.at < DUCK_OWNER_SAFE_MS) continue;
    if (Math.abs(d.y - car.y) > 0.8) continue;
    if (Math.hypot(d.x - car.x, d.z - car.z) < DUCK_R + CAR_R * 0.6) return { k: "duck", id: d.id, owner: d.owner };
  }
  if (s.toys.length) {
    const pr = project(tr, car.x, car.z, car.seg);
    for (const toy of s.toys) {
      if (t < toy.activeAt || t >= toy.until) continue;
      if (Math.abs(toy.y - car.y) > 0.8) continue;
      if (Math.abs(wrapDelta(pr.s - toy.s, tr.L)) > TOY_LEN / 2 + CAR_R) continue;
      if (pr.lat * toy.side > -CAR_R * 0.4) return { k: "toy", id: toy.id, owner: toy.owner };
    }
  }
  if (tr.train && trainState(tr, t - s.goAt) === "cross") {
    const pr = project(tr, car.x, car.z, car.seg);
    if (Math.abs(wrapDelta(pr.s - tr.train.s, tr.L)) < 1 + CAR_R && Math.abs(car.y - tr.y[pr.i]) < 0.5) return { k: "train" };
  }
  return null;
}

/** 벽·기차에 박았을 때 차를 뒤로 튕기고 멈칫 (사람 기기·방장 공용) */
export function crashBack(car: Car, tr: Track, t: number, ms: number) {
  const fx = tr.tx[car.seg];
  const fz = tr.tz[car.seg];
  const vf = car.vx * fx + car.vz * fz;
  car.vx = -fx * Math.max(2.5, vf * 0.25);
  car.vz = -fz * Math.max(2.5, vf * 0.25);
  car.x -= fx * 0.35;
  car.z -= fz * 0.35;
  car.spinUntil = t + ms;
  car.drift = 0;
  car.driftMs = 0;
}

function botHazards(rt: HostRuntime, p: PlayerState) {
  const s = rt.state;
  const tr = trackOf(s);
  const h = hazardAt(s, p, p.seat, s.t);
  if (!h) return;
  if (h.k === "duck") {
    const d = s.ducks.find((x) => x.id === h.id)!;
    s.ducks = s.ducks.filter((x) => x.id !== h.id);
    applyHit(rt, p, d.owner, "duck", d.x, d.z);
  } else if (h.k === "toy") {
    const toy = s.toys.find((x) => x.id === h.id)!;
    if (s.t < p.topUntil || s.t < p.shieldUntil) {
      if (s.t >= p.topUntil) {
        p.shieldUntil = 0;
        p.stats.blocked += 1;
      }
      s.toys = s.toys.filter((x) => x !== toy);
      emit(s, { k: "toyBreak", toy: toy.id, x: toy.x, z: toy.z });
      return;
    }
    crashBack(p, tr, s.t, CRASH_MS);
    p.stats.crashes += 1;
    if (toy.owner !== p.seat) s.players[toy.owner].stats.toyHits += 1;
    // 장난감 벽은 한 번 박히면 와르르 무너진다
    s.toys = s.toys.filter((x) => x !== toy);
    emit(s, { k: "hit", s: p.seat, by: toy.owner, kind: "toy", x: p.x, z: p.z });
    emit(s, { k: "toyBreak", toy: toy.id, x: toy.x, z: toy.z });
  } else if (h.k === "train") {
    if (s.t < p.topUntil) return;
    crashBack(p, tr, s.t, CRASH_MS);
    p.stats.crashes += 1;
    emit(s, { k: "hit", s: p.seat, by: -1, kind: "train", x: p.x, z: p.z });
  }
}

/* ── 🎁 선물 상자 · 아이템 ───────────────────────────────────────────── */

function rollItem(s: MatchState, p: PlayerState): ItemKind {
  const n = s.seatCount;
  const q = n <= 1 ? 0 : (p.rank - 1) / (n - 1);
  const w = itemWeights(q);
  const total = ITEM_KINDS.reduce((a, k) => a + w[k], 0);
  let r = rnd(s) * total;
  for (const k of ITEM_KINDS) {
    r -= w[k];
    if (r < 0) return k;
  }
  return "battery";
}

function boxes(rt: HostRuntime) {
  const s = rt.state;
  const tr = trackOf(s);
  for (let i = 0; i < s.boxes.length; i++) {
    const b = s.boxes[i];
    if (b.back > 0) {
      if (s.t >= b.back) b.back = 0;
      else continue;
    }
    const pos = tr.boxes[i];
    const by = tr.y[Math.round(pos.s / tr.ds) % tr.n] ?? 0;
    for (const p of s.players) {
      if (p.finishedAt || inAir(p, s.t) || Math.abs(p.y - by) > 0.8) continue;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > BOX_R + CAR_R) continue;
      b.back = s.t + BOX_RESPAWN_MS;
      p.stats.boxes += 1;
      let kind: ItemKind | null = null;
      if (s.options.items && p.item === null) {
        kind = rollItem(s, p);
        p.item = kind;
        p.itemAt = s.t;
      }
      emit(s, { k: "box", s: p.seat, i, kind, x: pos.x, z: pos.z });
      break;
    }
  }
}

/** 아이템을 지금 쓸 수 있나 (룰렛 끝) */
export function itemReady(s: MatchState, p: PlayerState): boolean {
  return p.item !== null && s.t >= p.itemAt + ITEM_ROLL_MS && !p.finishedAt && s.phase === "race";
}

/** 바로 앞 순위 차 (요요 표적) — 없으면 −1 */
export function carAhead(s: MatchState, p: PlayerState): number {
  const ahead = s.players.filter((o) => o !== p && !o.finishedAt && o.rank < p.rank).sort((a, b) => b.rank - a.rank)[0];
  return ahead ? ahead.seat : -1;
}

export function fireItem(rt: HostRuntime, seat: number): boolean {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || !itemReady(s, p)) return false;
  const kind = p.item!;
  p.item = null;
  p.stats.items += 1;
  const tr = trackOf(s);
  const fx = Math.cos(p.h);
  const fz = Math.sin(p.h);
  emit(s, { k: "use", s: seat, kind, x: p.x, z: p.z });
  if (kind === "battery") {
    if (p.bot) giveBoost(p, s.t, BATTERY_MS, BATTERY_MULT);
    else {
      p.fxBoost += 1;
      p.fxBoostMs = BATTERY_MS;
      p.fxBoostMult = BATTERY_MULT;
      p.boostUntil = s.t + BATTERY_MS;
    }
  } else if (kind === "bubble") {
    p.shieldUntil = s.t + BUBBLE_MS;
  } else if (kind === "top") {
    p.topUntil = s.t + TOP_MS;
    p.immuneUntil = Math.max(p.immuneUntil, s.t + TOP_MS);
    if (!p.bot) p.fxTop += 1;
  } else if (kind === "duck") {
    const pr = project(tr, p.x - fx * DUCK_BEHIND, p.z - fz * DUCK_BEHIND, p.seg);
    const lim = latLimit(tr, pr.i, pr.lat >= 0 ? 1 : -1) - 0.2;
    const q = pointAt(tr, pr.s, Math.max(-lim, Math.min(lim, pr.lat)));
    s.ducks.push({ id: ++s.objSeq, x: q.x, z: q.z, y: q.y, owner: seat, at: s.t, until: s.t + DUCK_LIFE_MS });
    if (s.ducks.length > DUCK_MAX) s.ducks.shift();
  } else {
    const target = kind === "yoyo" ? carAhead(s, p) : -1;
    const pr = project(tr, p.x, p.z, p.seg);
    const fwd = Math.max(0, p.vx * fx + p.vz * fz);
    s.projectiles.push({
      id: ++s.objSeq,
      kind: target >= 0 ? "yoyo" : "yarn",
      owner: seat,
      x: p.x + fx * (CAR_R + 0.55),
      z: p.z + fz * (CAR_R + 0.55),
      y: p.y,
      vx: fx * (YARN_SPEED + fwd * 0.3),
      vz: fz * (YARN_SPEED + fwd * 0.3),
      seg: p.seg,
      born: s.t,
      until: s.t + (target >= 0 ? YOYO_MAX_MS : YARN_LIFE_MS),
      target,
      d: p.dist,
      lat: pr.lat,
    });
  }
  return true;
}

function projectiles(rt: HostRuntime) {
  const s = rt.state;
  const tr = trackOf(s);
  const dt = STEP_MS / 1000;
  const keep: Projectile[] = [];
  for (const pj of s.projectiles) {
    let hit: PlayerState | null = null;
    if (pj.kind === "yoyo") {
      const tg = s.players[pj.target];
      if (!tg || tg.finishedAt) continue;
      // 트랙을 따라 쫓아간다 — 옆 위치는 표적 쪽으로 서서히
      pj.d += YOYO_SPEED * dt;
      const gap = tg.dist - pj.d;
      const tl = project(tr, tg.x, tg.z, tg.seg).lat;
      pj.lat += (tl - pj.lat) * Math.min(1, dt * (gap < 8 ? 8 : 2));
      const q = pointAt(tr, wrapS(pj.d, tr.L), pj.lat);
      pj.x = q.x;
      pj.z = q.z;
      pj.y = q.y + 0.4;
      pj.seg = q.i;
      if (gap <= 0.4 || s.t >= pj.until) hit = tg;
    } else {
      pj.x += pj.vx * dt;
      pj.z += pj.vz * dt;
      const pr = project(tr, pj.x, pj.z, pj.seg);
      pj.seg = pr.i;
      pj.y = pr.y;
      const side = pr.lat >= 0 ? 1 : -1;
      const lim = latLimit(tr, pr.i, side) + CAR_R - YARN_R;
      if (Math.abs(pr.lat) > lim) {
        // 울타리에 튕김 (옆 성분 뒤집기)
        const nx = -tr.tz[pr.i];
        const nz = tr.tx[pr.i];
        const vn = (pj.vx * nx + pj.vz * nz) * side;
        if (vn > 0) {
          pj.vx -= nx * side * vn * 2;
          pj.vz -= nz * side * vn * 2;
        }
        const over = Math.abs(pr.lat) - lim;
        pj.x -= nx * side * over;
        pj.z -= nz * side * over;
      }
      for (const p of s.players) {
        if (p.finishedAt || inAir(p, s.t) || Math.abs(p.y - pj.y) > 0.8) continue;
        if (p.seat === pj.owner && s.t - pj.born < YARN_SAFE_MS) continue;
        if (Math.hypot(p.x - pj.x, p.z - pj.z) < YARN_R + CAR_R) {
          hit = p;
          break;
        }
      }
      if (!hit) {
        // 오리와 털실은 서로 부딪혀 둘 다 없어진다
        const duck = s.ducks.find((d) => Math.abs(d.y - pj.y) < 0.8 && Math.hypot(d.x - pj.x, d.z - pj.z) < DUCK_R + YARN_R);
        if (duck) {
          s.ducks = s.ducks.filter((d) => d !== duck);
          continue;
        }
      }
    }
    if (hit) {
      applyHit(rt, hit, pj.owner, pj.kind, hit.x, hit.z);
      continue;
    }
    if (s.t < pj.until) keep.push(pj);
  }
  s.projectiles = keep;
}

function ducksExpire(s: MatchState) {
  if (s.ducks.length && s.ducks[0].until <= s.t) s.ducks = s.ducks.filter((d) => d.until > s.t);
}

/* ── 🧸 꼴찌의 장난감 상자 ──────────────────────────────────────────── */

/** 지금 선두 (아직 안 들어온 사람 중) */
export function leader(s: MatchState): PlayerState | null {
  let best: PlayerState | null = null;
  for (const p of s.players) if (!p.finishedAt && (!best || p.rank < best.rank)) best = p;
  return best;
}

export function dropToy(rt: HostRuntime, seat: number): boolean {
  const s = rt.state;
  const p = s.players[seat];
  if (!p || p.toy <= 0 || s.phase !== "race" || p.finishedAt) return false;
  const lead = leader(s);
  if (!lead || lead === p) {
    p.toy = 0;
    return false;
  }
  const tr = trackOf(s);
  const ls = project(tr, lead.x, lead.z, lead.seg);
  // 선두보다 TOY_AHEAD 이상 앞의 첫 투하 자리 (이미 벽이 있는 자리는 건너뜀)
  const cands = tr.sockets
    .map((sock) => ({ sock, ahead: wrapS(sock - ls.s, tr.L) }))
    .filter((c) => c.ahead >= TOY_AHEAD && !s.toys.some((t) => Math.abs(wrapDelta(t.s - c.sock, tr.L)) < 2))
    .sort((a, b) => a.ahead - b.ahead);
  if (cands.length === 0) return false;
  const sock = cands[0].sock;
  const side = Math.abs(ls.lat) < 0.3 ? (rnd(s) < 0.5 ? 1 : -1) : ls.lat > 0 ? 1 : -1;
  const i = Math.round(sock / tr.ds) % tr.n;
  const mid = (tr.w[i] + (side > 0 ? tr.rugA[i] : tr.rugB[i])) / 2;
  const q = pointAt(tr, sock, side * mid);
  p.toy = 0;
  p.stats.toyDrops += 1;
  const toy: Toy = { id: ++s.objSeq, s: sock, side, owner: seat, target: lead.seat, d: lead.dist + cands[0].ahead, at: s.t, activeAt: s.t + TOY_WARN_MS, until: s.t + TOY_WARN_MS + TOY_LIFE_MS, x: q.x, z: q.z, y: q.y, h: q.h };
  s.toys.push(toy);
  if (s.toys.length > 3) s.toys.shift();
  emit(s, { k: "toyDrop", s: seat, target: lead.seat, toy: toy.id, x: q.x, z: q.z });
  return true;
}

function toys(rt: HostRuntime) {
  const s = rt.state;
  for (const toy of s.toys) if (s.t >= toy.activeAt && s.t - STEP_MS < toy.activeAt) emit(s, { k: "toyLand", toy: toy.id, x: toy.x, z: toy.z });
  if (s.toys.length && s.toys.some((t) => t.until <= s.t)) s.toys = s.toys.filter((t) => t.until > s.t);
  // 표적(선두)이 피해서 지나가면 벽은 와르르 — 뒤따르던 차가 대신 박지 않게
  for (const toy of [...s.toys]) {
    const tg = s.players[toy.target];
    if (tg && (tg.finishedAt || tg.dist > toy.d + 2)) {
      s.toys = s.toys.filter((x) => x !== toy);
      emit(s, { k: "toyBreak", toy: toy.id, x: toy.x, z: toy.z });
    }
  }
  // 안 쓰고 버티면 저절로
  for (const p of s.players) if (p.toy > 0 && s.t - p.toyAt >= TOY_AUTO_MS) dropToy(rt, p.seat);
}

/** 선두가 새 바퀴에 들어설 때 꼴찌(6명 이상이면 뒤 두 명)에게 장난감 */
function giveToys(s: MatchState) {
  if (!s.options.toyBox) return;
  const racing = s.players.filter((p) => !p.finishedAt).sort((a, b) => b.rank - a.rank);
  const n = s.seatCount >= 6 ? 2 : 1;
  for (const p of racing.slice(0, n)) {
    if (p.rank === 1 || p.toy > 0) continue;
    p.toy = 1;
    p.toyAt = s.t;
    emit(s, { k: "toyGet", s: p.seat });
  }
}

/* ── 바퀴·순위·끝 ───────────────────────────────────────────────────── */

function progressAll(rt: HostRuntime) {
  const s = rt.state;
  const tr = trackOf(s);
  const goal = s.options.laps;
  for (const p of s.players) {
    if (p.finishedAt) continue;
    const done = Math.max(0, Math.floor(p.dist / tr.L));
    if (done > p.laps) {
      const ms = s.t - p.lapStart;
      const best = p.stats.bestLapMs === 0 || ms < p.stats.bestLapMs;
      if (best) p.stats.bestLapMs = Math.round(ms);
      p.laps = done;
      p.lastLapMs = Math.round(ms);
      p.lapStart = s.t;
      if (done >= goal) {
        s.finishCount += 1;
        p.finishedAt = s.t;
        p.finishRank = s.finishCount;
        p.item = null;
        p.toy = 0;
        if (s.finishCount === 1) {
          s.firstFinishAt = s.t;
          p.stats.raceWins += 1;
          emit(s, { k: "firstFinish", s: p.seat });
        }
        emit(s, { k: "finish", s: p.seat, rank: p.finishRank, ms: Math.round(s.t - s.goAt) });
      } else {
        emit(s, { k: "lap", s: p.seat, lap: done, ms: Math.round(ms), best });
        if (done === goal - 1) emit(s, { k: "finalLap", s: p.seat });
      }
    }
  }
  // 순위
  const order = [...s.players].sort(raceOrder);
  const prev = s.players.map((p) => p.rank);
  order.forEach((p, k) => (p.rank = k + 1));
  if (s.t - s.goAt > 1500) {
    for (const p of s.players) {
      if (p.rank < prev[p.seat] && !p.finishedAt) {
        p.stats.passes += 1;
        s.passes += 1;
        const over = s.players.find((o) => o.rank === p.rank + 1);
        if (over && prev[over.seat] === p.rank) emit(s, { k: "pass", s: p.seat, over: over.seat });
      }
    }
  }
  // 선두가 새 바퀴 → 꼴찌 장난감
  const maxLap = Math.max(...s.players.map((p) => p.laps));
  if (maxLap > s.maxLap) {
    s.maxLap = maxLap;
    if (maxLap < goal) giveToys(s);
    if (maxLap === goal - 1 && s.finalLeader < 0) s.finalLeader = order[0].seat;
  }
}

/** 순위 비교: 들어온 사람(먼저 들어온 순) → 진행 거리 → 자리 번호 */
export function raceOrder(a: PlayerState, b: PlayerState): number {
  if (a.finishedAt && b.finishedAt) return a.finishRank - b.finishRank;
  if (a.finishedAt) return -1;
  if (b.finishedAt) return 1;
  if (Math.abs(a.dist - b.dist) > 1e-6) return b.dist - a.dist;
  return a.seat - b.seat;
}

function endRace(rt: HostRuntime) {
  const s = rt.state;
  const order = [...s.players].sort(raceOrder);
  const ranks = s.players.map(() => 0);
  order.forEach((p, k) => (ranks[p.seat] = k + 1));
  for (const p of s.players) {
    p.raceRanks = [...p.raceRanks, ranks[p.seat]];
    p.points += GP_POINTS[ranks[p.seat] - 1] ?? 0;
    p.item = null;
    p.toy = 0;
  }
  s.raceRanks = ranks;
  s.projectiles = [];
  emit(s, { k: "raceOver", race: s.race });
  if (s.race + 1 < s.races) {
    s.phase = "raceEnd";
    s.phaseStart = s.t;
    s.phaseEnd = s.t + INTERMISSION_MS;
  } else finishMatch(s);
}

function nextRace(rt: HostRuntime) {
  const s = rt.state;
  s.race += 1;
  s.track = trackForRace(s.options, s.race, s);
  // 그랑프리: 점수가 낮은 사람이 앞줄 (같으면 직전 레이스 순위가 나쁜 쪽이 앞)
  const order = [...s.players].sort((a, b) => a.points - b.points || (b.raceRanks.at(-1) ?? 0) - (a.raceRanks.at(-1) ?? 0) || a.seat - b.seat).map((p) => p.seat);
  setupRace(s, order);
  for (let i = 0; i < rt.rep.length; i++) rt.rep[i].at = -1;
  for (const b of rt.bots) Object.assign(b, { nextThinkAt: 0, lane: 0, laneUntil: 0, drifting: false, holdSince: 0, stuckMs: 0 });
  emit(s, { k: "nextRace", race: s.race, track: s.track });
}

/** 최종 순위: 단판 = 레이스 순위 · 그랑프리 = 점수 → 마지막 레이스 순위 */
export function computeRanks(s: MatchState): number[] {
  if (s.races <= 1) return s.raceRanks ?? s.players.map((p) => p.rank);
  const cmp = (a: PlayerState, b: PlayerState) => b.points - a.points || (a.raceRanks.at(-1) ?? 99) - (b.raceRanks.at(-1) ?? 99);
  const sorted = [...s.players].sort((a, b) => cmp(a, b) || a.seat - b.seat);
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
  s.ducks = [];
  s.toys = [];
  s.ranks = computeRanks(s);
  emit(s, { k: "over" });
}

/* ── 화면용 ─────────────────────────────────────────────────────────── */

/** 지금 몇 바퀴째 (1부터, 화면 "랩 2/3") */
export function lapShown(s: MatchState, p: PlayerState): number {
  return Math.min(s.options.laps, p.laps + 1);
}

/** 레이스 경과 ms */
export function raceTime(s: MatchState): number {
  if (s.phase === "countdown") return 0;
  return Math.max(0, s.t - s.goAt);
}

/** 봇: 출발 부스트 (레벨이 높을수록 잘 맞춘다) */
export function botRocket(rt: HostRuntime, p: PlayerState, chance: number, stallChance: number) {
  const s = rt.state;
  const r = rnd(rt.botRng);
  if (r < chance) {
    giveBoost(p, s.t, ROCKET_BOOST_MS);
    p.rocket = 1;
    p.stats.rockets += 1;
    emit(s, { k: "rocket", s: p.seat, ok: true });
  } else if (r > 1 - stallChance) {
    p.stallUntil = s.t + STALL_MS;
    p.rocket = -1;
    p.stats.stalls += 1;
    emit(s, { k: "rocket", s: p.seat, ok: false });
  }
}

/** 봇: 🔁 제자리로 */
export function botReset(rt: HostRuntime, p: PlayerState) {
  const s = rt.state;
  const tr = trackOf(s);
  const q = project(tr, p.x, p.z, p.seg);
  const pt = pointAt(tr, q.s, Math.max(-1.5, Math.min(1.5, q.lat * 0.3)));
  placeCar(p, tr, pt.x, pt.z, pt.h);
  p.vx = 0;
  p.vz = 0;
  p.resetUntil = s.t + RESET_MS;
  p.stats.resets += 1;
}

export { BUBBLE_MS, SPIN_MS, TOP_MS };
