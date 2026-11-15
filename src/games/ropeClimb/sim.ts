import { buildCourse, cellIndex, distanceField, grippable, type Course } from "./course";
import {
  AIR_ACCEL,
  BODY_R,
  CATCH_COST,
  CATCH_SPEED,
  CLIMB_SPEED,
  COUNTDOWN_MS,
  COURSES,
  CRUMBLE_MS,
  CRUMBLY,
  GRAB_MIN,
  GRAVITY,
  HANG_REGEN,
  HARD_LAND,
  HARD_LAND_STUN_MS,
  HAUL_DRAIN,
  HAUL_SPEED,
  HOLD_DRAIN,
  LEAP_COST,
  LEAP_SPEED,
  LEDGE,
  LEDGE_REGEN,
  LEDGE_SPEED,
  LOAD_DRAIN,
  MAX_FALL,
  MOVE_DRAIN,
  OVERHANG,
  OVERHANG_MULT,
  OVERHANG_SPEED,
  PTS_CATCH,
  PTS_HAUL,
  PTS_LEAD,
  PTS_STAR,
  PTS_SUMMIT,
  REGRAB_MS,
  RESPAWN_STUN_MS,
  ROCK_HIT_COST,
  ROCK_R,
  ROCK_SPEED,
  ROCK_STUN_MS,
  ROCK_WARN_MS,
  ROPE_LEN,
  ROPE_MIN,
  SMOOTH,
  STAM_MAX,
  STEP_MS,
  TEAM_FALL_MS,
  WALL_W,
  WIND_ACCEL,
  WIND_DRAIN_MULT,
  WIND_MS,
  WIND_WARN_MS,
  sanitizeOptions,
  type Cell,
  type GameOptions,
} from "./data";

/**
 * 한 줄 등반대 시뮬레이션 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * `MatchState`는 그대로 JSON 스냅샷이 되도록 순수 데이터만 담는다. 벽은 씨앗으로 다시 만들 수
 * 있어 상태엔 "부서져 없어진 칸"만 들어 있다 → 방장이 나가면 손님 하나가 마지막 스냅샷으로
 * `createHost`를 불러 판을 이어간다. 난수는 상태 안의 `rng`만 쓴다(테스트 재현용).
 *
 * 한 스텝(1/60초): 봇 생각 → 몸(잡고 이동·도약·낙하) → 끌어올리기 → 줄 제약(매달림·받아냄) →
 * 체력 → 부서지는 바위·낙석·돌풍·별·캠프 → 팀 추락·완등·시간 종료 판정.
 */

export type Phase = "countdown" | "climb" | "gameOver";
export type Mode = "grip" | "air";

export interface PlayerStats {
  /** 팀 최고 높이를 새로 올린 거리 (선등) */
  leadM: number;
  /** 동료를 끌어올린 거리 */
  haulM: number;
  /** 떨어지는 동료를 줄로 받아낸 횟수 */
  catches: number;
  /** 줄 덕에 살아난 횟수 */
  saved: number;
  stars: number;
  /** 체력이 바닥나 손을 놓친 횟수 */
  slips: number;
  rockHits: number;
  leaps: number;
  /** 줄에 매달려 있던 시간 */
  hangMs: number;
}

const zeroStats = (): PlayerStats => ({ leadM: 0, haulM: 0, catches: 0, saved: 0, stars: 0, slips: 0, rockHits: 0, leaps: 0, hangMs: 0 });

export interface PlayerState {
  seat: number;
  bot: boolean;
  lv: number;
  /** 사람이 나가서 봇이 대신 하는 중 */
  away: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 보는 쪽 −1 왼쪽 / 1 오른쪽 */
  face: number;
  mode: Mode;
  /** 줄에 매달려 있나 (공중이고 줄이 팽팽하고 그 끝을 누가 잡고 있음) */
  hang: boolean;
  stam: number;
  /** 체력이 바닥나 손을 놓침 — GRAB_MIN까지 차야 다시 잡는다 */
  tired: boolean;
  stunUntil: number;
  regrabAt: number;
  /** 지금 줄을 당기고 있나 (실제로 끌어올리는 중) */
  hauling: boolean;
  /** 매달린 동료 몇 명분을 버티나 (0.5 단위) */
  load: number;
  /** 정상에 올라섰나 */
  summit: boolean;
  lastCatchAt: number;
  haulAcc: number;
  /** 개인 기여 점수 */
  pts: number;
  stats: PlayerStats;
}

export interface Rock {
  id: number;
  x: number;
  y: number;
  y0: number;
  endY: number;
  fallAt: number;
  hit: number[];
}

export interface Wind {
  dir: number;
  /** 불기 시작 / 끝 */
  from: number;
  until: number;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "go" }
  | { k: "leap"; s: number }
  | { k: "grab"; s: number }
  | { k: "slip"; s: number }
  | { k: "land"; s: number; hard: boolean }
  | { k: "catch"; a: number; b: number; v: number }
  | { k: "crack"; i: number }
  | { k: "crumble"; i: number }
  | { k: "rockWarn"; x: number }
  | { k: "rockHit"; s: number; x: number; y: number }
  | { k: "windWarn"; dir: number }
  | { k: "wind"; dir: number }
  | { k: "windEnd" }
  | { k: "star"; s: number; x: number; y: number }
  | { k: "camp"; n: number; s: number }
  | { k: "fall"; lives: number }
  | { k: "summit"; s: number }
  | { k: "over"; cleared: boolean }
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
  climbStart: number;
  /** 남은 ⛑ (팀 추락 허용 횟수). 0에서 또 떨어지면 실패 */
  lives: number;
  falls: number;
  /** 도달한 캠프 번호 (0 = 출발 바닥) */
  camp: number;
  /** 팀 최고 높이 (m, 정수) */
  alt: number;
  /** 옆 사람과의 줄 길이 (자리 i ↔ i+1) */
  ropes: number[];
  /** 그 줄이 지금 팽팽한가 (0/1) */
  taut: number[];
  /** 아무도 벽을 못 잡기 시작한 시각 (0 = 누군가 잡고 있음) */
  noAnchorSince: number;
  /** 부서져 없어진 칸 */
  gone: number[];
  /** 부서지는 중인 칸과 떨어져 나갈 시각 */
  crumb: { i: number; at: number }[];
  rocks: Rock[];
  nextRockAt: number;
  rockSeq: number;
  wind: Wind | null;
  nextWindAt: number;
  /** 별을 먹었나 */
  stars: boolean[];
  players: PlayerState[];
  events: GameEvent[];
  eventSeq: number;
  cleared: boolean;
  /** 걸린 시간 (끝났을 때) */
  endMs: number;
  /** ⭐ 0~3 */
  grade: number;
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

function emit(s: MatchState, ev: Record<string, unknown> & { k: GameEvent["k"] }) {
  s.events.push({ id: ++s.eventSeq, at: s.t, ...ev } as GameEvent);
  if (s.events.length > 80) s.events = s.events.filter((e) => e.at >= s.t - 4000);
}

/* ── 조회 ───────────────────────────────────────────────────────────── */

export function courseOf(s: MatchState): Course {
  return buildCourse(s.seed, s.options.course);
}

/** 부서진 칸을 반영한 지금 벽 */
export function cellsOf(s: MatchState): Cell[] {
  const base = courseOf(s).cells;
  if (s.gone.length === 0) return base;
  const out = base.slice();
  for (const i of s.gone) out[i] = SMOOTH;
  return out;
}

export function windBlowing(s: MatchState): number {
  return s.wind && s.t >= s.wind.from && s.t < s.wind.until ? s.wind.dir : 0;
}

/** 캠프 n의 자리별 출발 위치 */
export function campSpot(course: Course, n: number, seat: number, seatCount: number): { x: number; y: number } {
  const cp = course.camps[Math.max(0, Math.min(course.camps.length - 1, n))];
  const w = cp.c1 - cp.c0 + 1;
  const inner = Math.min(w, n === 0 ? 8 : w);
  const c0 = cp.c0 + (w - inner) / 2;
  return { x: c0 + ((seat + 0.5) * inner) / seatCount - WALL_W / 2, y: cp.row + 0.1 };
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const seatCount = seats.length;
  const opts = sanitizeOptions(options);
  const course = buildCourse(seed, opts.course);
  const spec = COURSES[opts.course];
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
    climbStart: 0,
    lives: opts.lives,
    falls: 0,
    camp: 0,
    alt: 0,
    ropes: Array(Math.max(0, seatCount - 1)).fill(ROPE_LEN),
    taut: Array(Math.max(0, seatCount - 1)).fill(0),
    noAnchorSince: 0,
    gone: [],
    crumb: [],
    rocks: [],
    nextRockAt: spec.rockEvery ? COUNTDOWN_MS + spec.rockEvery * 0.8 : 0,
    rockSeq: 0,
    wind: null,
    nextWindAt: spec.windEvery ? COUNTDOWN_MS + spec.windEvery * 0.7 : 0,
    stars: course.stars.map(() => false),
    players: seats.map((spec2, seat) => {
      const at = campSpot(course, 0, seat, seatCount);
      return {
        seat,
        bot: spec2.bot,
        lv: Math.max(1, Math.min(10, Math.round(spec2.level) || 5)),
        away: false,
        x: at.x,
        y: at.y,
        vx: 0,
        vy: 0,
        face: seat % 2 === 0 ? 1 : -1,
        mode: "grip" as Mode,
        hang: false,
        stam: STAM_MAX,
        tired: false,
        stunUntil: 0,
        regrabAt: 0,
        hauling: false,
        load: 0,
        summit: false,
        lastCatchAt: -9999,
        haulAcc: 0,
        pts: 0,
        stats: zeroStats(),
      };
    }),
    events: [],
    eventSeq: 0,
    cleared: false,
    endMs: 0,
    grade: 0,
    ranks: null,
  };
  return s;
}

/* ── 입력 ───────────────────────────────────────────────────────────── */

export interface PlayerInput {
  /** 이동 방향 (mx 오른쪽 +, my 위 +), 길이 ≤ 1 */
  mx: number;
  my: number;
  /** 잡기/도약 누른 횟수 카운터 — 늘어나면 한 번 누른 것 */
  grab: number;
  /** 줄 당기기를 누르고 있나 */
  haul: boolean;
}

export interface BotMemory {
  nextThinkAt: number;
  /** 끌려 올라가길 기다리는 중 — 이 높이를 넘으면 잡는다 */
  waitAbove: number;
  dodgeUntil: number;
  dodgeDir: number;
}

export interface HostRuntime {
  state: MatchState;
  inputs: PlayerInput[];
  seenGrab: number[];
  /** 잡기 버튼을 누른 시각 (-1 = 없음) — 잠깐 기억해 두었다가 가능해지면 처리 */
  grabReq: number[];
  acc: number;
  course: Course;
  cells: Cell[];
  /** 정상까지 거리장 (봇용, 벽이 부서지면 다시 계산) */
  dist: number[] | null;
  bots: BotMemory[];
  think: ((rt: HostRuntime, seat: number) => void) | null;
  botRng: { rng: number };
}

const idleInput = (): PlayerInput => ({ mx: 0, my: 0, grab: 0, haul: false });
const GRAB_BUFFER_MS = 220;

export function createHost(state: MatchState, think: HostRuntime["think"] = null): HostRuntime {
  const n = state.seatCount;
  return {
    state,
    inputs: Array.from({ length: n }, idleInput),
    seenGrab: Array(n).fill(0),
    grabReq: Array(n).fill(-1),
    acc: 0,
    course: courseOf(state),
    cells: cellsOf(state).slice(),
    dist: null,
    bots: Array.from({ length: n }, () => ({ nextThinkAt: 0, waitAbove: -1, dodgeUntil: 0, dodgeDir: 0 })),
    think,
    botRng: { rng: (state.seed ^ 0x2c1b3c6d) | 0 },
  };
}

export function distOf(rt: HostRuntime): number[] {
  return (rt.dist ??= distanceField(rt.course, rt.cells));
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
  let my = Number(inp.my) || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  cur.mx = mx;
  cur.my = my;
  cur.haul = inp.haul === true;
  const g = Number(inp.grab) || 0;
  if (g > rt.seenGrab[seat]) {
    rt.seenGrab[seat] = g;
    rt.grabReq[seat] = rt.state.t;
  }
  cur.grab = g;
}

/** 봇용: 잡기/도약 한 번 누르기 */
export function pressGrab(rt: HostRuntime, seat: number) {
  rt.grabReq[seat] = rt.state.t;
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
    rt.seenGrab[seat] = 0;
    rt.grabReq[seat] = -1;
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
  if (s.phase === "gameOver") return;
  s.t += STEP_MS;
  if (s.phase === "countdown") {
    if (s.t >= s.phaseEnd) {
      s.phase = "climb";
      s.phaseStart = s.t;
      s.climbStart = s.t;
      emit(s, { k: "go" });
    }
    return;
  }
  if (rt.think) for (const p of s.players) if (p.bot) rt.think(rt, p.seat);
  climb(rt);
}

function cellAt(rt: HostRuntime, x: number, y: number): Cell | undefined {
  const i = cellIndex(rt.course, x, y);
  return i < 0 ? undefined : rt.cells[i];
}

function letGo(s: MatchState, p: PlayerState) {
  p.mode = "air";
  p.regrabAt = s.t + REGRAB_MS;
  p.hauling = false;
}

function climb(rt: HostRuntime) {
  const s = rt.state;
  const dt = STEP_MS / 1000;
  const H = rt.course.height;
  const wind = windBlowing(s);
  const xMax = WALL_W / 2 - BODY_R;

  /* 1) 몸 */
  for (const p of s.players) {
    const inp = rt.inputs[p.seat];
    const stunned = s.t < p.stunUntil;
    const mx = stunned ? 0 : inp.mx;
    const my = stunned ? 0 : inp.my;
    const req = rt.grabReq[p.seat];
    const wantGrab = req >= 0 && s.t - req <= GRAB_BUFFER_MS;
    if (req >= 0 && !wantGrab) rt.grabReq[p.seat] = -1;
    if (Math.abs(mx) > 0.2) p.face = mx > 0 ? 1 : -1;

    if (p.mode === "grip") {
      const here = cellAt(rt, p.x, p.y);
      if (!grippable(here)) {
        // 발밑이 부서져 없어짐
        letGo(s, p);
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      if (wantGrab && !stunned) {
        // 도약 (방향이 없으면 그냥 손 놓기)
        rt.grabReq[p.seat] = -1;
        const l = Math.hypot(mx, my);
        letGo(s, p);
        if (l > 0.3) {
          p.vx = (mx / l) * LEAP_SPEED;
          p.vy = (my / l) * LEAP_SPEED;
          p.stam = Math.max(0, p.stam - LEAP_COST);
        } else {
          p.vx = 0;
          p.vy = 0;
        }
        p.stats.leaps++;
        emit(s, { k: "leap", s: p.seat });
        continue;
      }
      const speed = here === LEDGE ? LEDGE_SPEED : here === OVERHANG ? OVERHANG_SPEED : CLIMB_SPEED;
      const ox = p.x;
      const oy = p.y;
      const tx = Math.max(-xMax, Math.min(xMax, p.x + mx * speed * dt));
      const ty = Math.max(0.05, Math.min(H + 0.9, p.y + my * speed * dt));
      const ok = (x: number, y: number) => {
        if (!grippable(cellAt(rt, x, y))) return false;
        for (const d of [-1, 1]) {
          const n = s.players[p.seat + d];
          if (!n || n.mode !== "grip") continue;
          const len = s.ropes[Math.min(p.seat, n.seat)];
          const after = Math.hypot(x - n.x, y - n.y);
          if (after > len && after > Math.hypot(p.x - n.x, p.y - n.y)) return false;
        }
        return true;
      };
      if (ok(tx, ty)) {
        p.x = tx;
        p.y = ty;
      } else if (tx !== p.x && ok(tx, p.y)) p.x = tx;
      else if (ty !== p.y && ok(p.x, ty)) p.y = ty;
      p.vx = (p.x - ox) / dt;
      p.vy = (p.y - oy) / dt;
    } else {
      // 공중: 중력 + 좌우 흔들기 + 돌풍
      p.vy = Math.max(-MAX_FALL, p.vy - GRAVITY * dt);
      p.vx += mx * AIR_ACCEL * dt + wind * WIND_ACCEL * dt;
      p.vx *= 1 - 0.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x > xMax) {
        p.x = xMax;
        p.vx = -Math.abs(p.vx) * 0.3;
      } else if (p.x < -xMax) {
        p.x = -xMax;
        p.vx = Math.abs(p.vx) * 0.3;
      }
      if (p.y > H + 0.9) {
        p.y = H + 0.9;
        p.vy = Math.min(0, p.vy);
      }
      if (p.y < 0.05) p.y = 0.05;
      const here = cellAt(rt, p.x, p.y);
      if (here === LEDGE && p.vy <= 0.5 && s.t >= p.regrabAt) {
        // 턱에는 저절로 내려선다
        const hard = -p.vy > HARD_LAND;
        if (hard) {
          p.stunUntil = s.t + HARD_LAND_STUN_MS;
          p.stam = Math.max(0, p.stam - 12);
        }
        p.mode = "grip";
        p.tired = false;
        p.vx = 0;
        p.vy = 0;
        rt.grabReq[p.seat] = -1;
        emit(s, { k: "land", s: p.seat, hard });
      } else if (wantGrab && !stunned && s.t >= p.regrabAt && grippable(here) && (!p.tired || p.stam >= GRAB_MIN)) {
        const v = Math.hypot(p.vx, p.vy);
        if (v > 6) p.stam = Math.max(1, p.stam - (v - 6) * 2.5);
        p.mode = "grip";
        p.tired = false;
        p.vx = 0;
        p.vy = 0;
        rt.grabReq[p.seat] = -1;
        emit(s, { k: "grab", s: p.seat });
      }
    }
  }

  /* 2) 끌어올리기: 잡고 있는 사람이 당기면 공중에 있는 옆 사람 쪽 줄이 짧아진다 */
  for (const p of s.players) p.hauling = false;
  for (let i = 0; i < s.ropes.length; i++) {
    const a = s.players[i];
    const b = s.players[i + 1];
    const ag = a.mode === "grip";
    const bg = b.mode === "grip";
    if (ag && bg) s.ropes[i] = ROPE_LEN;
    else if (!ag && !bg) s.ropes[i] = Math.min(ROPE_LEN, s.ropes[i] + 3 * dt);
    else {
      const holder = ag ? a : b;
      if (rt.inputs[holder.seat].haul && s.t >= holder.stunUntil && s.ropes[i] > ROPE_MIN) {
        s.ropes[i] = Math.max(ROPE_MIN, s.ropes[i] - HAUL_SPEED * dt);
        holder.hauling = true;
        if (s.taut[i]) {
          holder.stats.haulM += HAUL_SPEED * dt;
          holder.haulAcc += HAUL_SPEED * dt;
          while (holder.haulAcc >= 1) {
            holder.haulAcc -= 1;
            holder.pts += PTS_HAUL;
          }
        }
      }
    }
  }

  /* 3) 줄 제약 */
  for (let it = 0; it < 5; it++) {
    for (let i = 0; i < s.ropes.length; i++) {
      const a = s.players[i];
      const b = s.players[i + 1];
      const L = s.ropes[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d <= L || d < 1e-6) continue;
      const ag = a.mode === "grip";
      const bg = b.mode === "grip";
      if (ag && bg) continue;
      const nx = dx / d;
      const ny = dy / d;
      const over = d - L;
      if (ag) {
        b.x -= nx * over;
        b.y -= ny * over;
        const vOut = b.vx * nx + b.vy * ny;
        if (vOut > 0) {
          b.vx -= nx * vOut;
          b.vy -= ny * vOut;
          if (it === 0) jerk(s, a, b, vOut);
        }
      } else if (bg) {
        a.x += nx * over;
        a.y += ny * over;
        const vOut = -(a.vx * nx + a.vy * ny);
        if (vOut > 0) {
          a.vx += nx * vOut;
          a.vy += ny * vOut;
          if (it === 0) jerk(s, b, a, vOut);
        }
      } else {
        a.x += (nx * over) / 2;
        a.y += (ny * over) / 2;
        b.x -= (nx * over) / 2;
        b.y -= (ny * over) / 2;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) {
          a.vx += (nx * rel) / 2;
          a.vy += (ny * rel) / 2;
          b.vx -= (nx * rel) / 2;
          b.vy -= (ny * rel) / 2;
        }
      }
    }
  }
  // 팽팽한 줄 · 매달림 · 버티는 무게
  const n = s.players.length;
  for (let i = 0; i < s.ropes.length; i++) {
    const a = s.players[i];
    const b = s.players[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    s.taut[i] = d >= s.ropes[i] - 0.04 && (a.mode === "air" || b.mode === "air") ? 1 : 0;
  }
  const anchorL: number[] = Array(n).fill(-1);
  const anchorR: number[] = Array(n).fill(-1);
  for (let i = 1; i < n; i++) if (s.players[i].mode === "air" && s.taut[i - 1]) anchorL[i] = s.players[i - 1].mode === "grip" ? i - 1 : anchorL[i - 1];
  for (let i = n - 2; i >= 0; i--) if (s.players[i].mode === "air" && s.taut[i]) anchorR[i] = s.players[i + 1].mode === "grip" ? i + 1 : anchorR[i + 1];
  for (const p of s.players) p.load = 0;
  for (const p of s.players) {
    const l = anchorL[p.seat];
    const r = anchorR[p.seat];
    p.hang = p.mode === "air" && (l >= 0 || r >= 0);
    if (!p.hang) continue;
    const share = l >= 0 && r >= 0 ? 0.5 : 1;
    if (l >= 0) s.players[l].load += share;
    if (r >= 0) s.players[r].load += share;
  }

  /* 4) 체력 */
  for (const p of s.players) {
    if (p.mode === "air") {
      if (p.hang) {
        p.stam = Math.min(STAM_MAX, p.stam + HANG_REGEN * dt);
        p.stats.hangMs += STEP_MS;
      }
      continue;
    }
    const here = cellAt(rt, p.x, p.y);
    const moving = Math.hypot(p.vx, p.vy) > 0.2;
    const extra = p.load * LOAD_DRAIN + (p.hauling ? HAUL_DRAIN : 0);
    if (here === LEDGE) {
      p.stam = Math.max(0, Math.min(STAM_MAX, p.stam + (LEDGE_REGEN - extra * 0.5) * dt));
      continue;
    }
    let drain = moving ? MOVE_DRAIN : HOLD_DRAIN;
    if (here === OVERHANG) drain *= OVERHANG_MULT;
    if (wind) drain *= WIND_DRAIN_MULT;
    p.stam -= (drain + extra) * dt;
    if (p.stam <= 0) {
      p.stam = 0;
      p.tired = true;
      p.stats.slips++;
      letGo(s, p);
      emit(s, { k: "slip", s: p.seat });
    }
  }

  /* 5) 부서지는 바위 */
  for (const p of s.players) {
    if (p.mode !== "grip") continue;
    const i = cellIndex(rt.course, p.x, p.y);
    if (i >= 0 && rt.cells[i] === CRUMBLY && !s.crumb.some((c) => c.i === i)) {
      s.crumb.push({ i, at: s.t + CRUMBLE_MS });
      emit(s, { k: "crack", i });
    }
  }
  if (s.crumb.length && s.crumb.some((c) => s.t >= c.at)) {
    for (const c of s.crumb) {
      if (s.t < c.at) continue;
      rt.cells[c.i] = SMOOTH;
      s.gone.push(c.i);
      emit(s, { k: "crumble", i: c.i });
    }
    s.crumb = s.crumb.filter((c) => s.t < c.at);
    rt.dist = null;
  }

  /* 6) 낙석 */
  const spec = COURSES[s.options.course];
  if (spec.rockEvery && s.t >= s.nextRockAt) {
    const targets = s.players.filter((p) => !p.summit);
    if (targets.length) {
      const tg = targets[Math.floor(rnd(s) * targets.length)];
      let top = 0;
      let low = Infinity;
      for (const p of s.players) {
        top = Math.max(top, p.y);
        low = Math.min(low, p.y);
      }
      const x = Math.max(-xMax, Math.min(xMax, tg.x + (rnd(s) - 0.5) * 2.2));
      const y0 = Math.min(H + 5, top + 10);
      s.rocks.push({ id: ++s.rockSeq, x, y: y0, y0, endY: Math.max(-2, low - 7), fallAt: s.t + ROCK_WARN_MS, hit: [] });
      emit(s, { k: "rockWarn", x });
    }
    s.nextRockAt = s.t + spec.rockEvery * (0.7 + rnd(s) * 0.6);
  }
  if (s.rocks.length) {
    for (const r of s.rocks) {
      if (s.t < r.fallAt) continue;
      r.y = r.y0 - (ROCK_SPEED * (s.t - r.fallAt)) / 1000;
      for (const p of s.players) {
        if (p.summit || r.hit.includes(p.seat)) continue;
        if (Math.hypot(p.x - r.x, p.y + 0.3 - r.y) > ROCK_R + BODY_R) continue;
        r.hit.push(p.seat);
        p.stunUntil = s.t + ROCK_STUN_MS;
        p.stam = Math.max(0, p.stam - ROCK_HIT_COST);
        p.stats.rockHits++;
        if (p.mode === "grip" && cellAt(rt, p.x, p.y) !== LEDGE) {
          letGo(s, p);
          p.vx = 0;
          p.vy = -2;
        }
        emit(s, { k: "rockHit", s: p.seat, x: r.x, y: r.y });
      }
    }
    s.rocks = s.rocks.filter((r) => r.y > r.endY);
  }

  /* 7) 돌풍 */
  if (spec.windEvery) {
    if (!s.wind && s.t >= s.nextWindAt) {
      const dir = rnd(s) < 0.5 ? -1 : 1;
      s.wind = { dir, from: s.t + WIND_WARN_MS, until: s.t + WIND_WARN_MS + WIND_MS };
      emit(s, { k: "windWarn", dir });
    } else if (s.wind) {
      if (s.t >= s.wind.from && s.t - STEP_MS < s.wind.from) emit(s, { k: "wind", dir: s.wind.dir });
      if (s.t >= s.wind.until) {
        s.wind = null;
        s.nextWindAt = s.t + spec.windEvery * (0.75 + rnd(s) * 0.5);
        emit(s, { k: "windEnd" });
      }
    }
  }

  /* 8) 별 · 캠프 · 선등 · 정상 */
  rt.course.stars.forEach((st, i) => {
    if (s.stars[i]) return;
    for (const p of s.players) {
      if (Math.hypot(p.x - st.x, p.y + 0.2 - st.y) > 0.8) continue;
      s.stars[i] = true;
      p.stats.stars++;
      p.pts += PTS_STAR;
      emit(s, { k: "star", s: p.seat, x: st.x, y: st.y });
      break;
    }
  });
  let anyGrip = false;
  let allSummit = true;
  for (const p of s.players) {
    if (p.mode !== "grip") {
      allSummit = false;
      continue;
    }
    anyGrip = true;
    const row = Math.floor(p.y);
    if (row > s.alt) {
      const gain = row - s.alt;
      s.alt = row;
      p.stats.leadM += gain;
      p.pts += gain * PTS_LEAD;
    }
    if (cellAt(rt, p.x, p.y) === LEDGE) {
      for (let k = s.camp + 1; k < rt.course.camps.length; k++) {
        if (rt.course.camps[k].row === row) {
          s.camp = k;
          emit(s, { k: "camp", n: k, s: p.seat });
        }
      }
    }
    if (row >= H) {
      if (!p.summit) {
        p.summit = true;
        emit(s, { k: "summit", s: p.seat });
      }
    } else allSummit = false;
  }

  /* 9) 끝 판정 */
  if (allSummit) {
    finish(s, true);
    return;
  }
  if (anyGrip) s.noAnchorSince = 0;
  else if (s.noAnchorSince === 0) s.noAnchorSince = s.t;
  else if (s.t - s.noAnchorSince >= TEAM_FALL_MS) teamFall(rt);
  if (s.phase === "climb" && s.t - s.climbStart >= spec.limitMs) finish(s, false);
}

/** 줄이 채여 떨어지던 사람을 받아냄 */
function jerk(s: MatchState, holder: PlayerState, faller: PlayerState, v: number) {
  if (v < 2) return;
  holder.stam = Math.max(1, holder.stam - v * CATCH_COST);
  if (v >= CATCH_SPEED && s.t - faller.lastCatchAt > 1500) {
    faller.lastCatchAt = s.t;
    holder.stats.catches++;
    holder.pts += PTS_CATCH;
    faller.stats.saved++;
    emit(s, { k: "catch", a: holder.seat, b: faller.seat, v: Math.round(v * 10) / 10 });
  }
}

function teamFall(rt: HostRuntime) {
  const s = rt.state;
  s.falls++;
  s.lives--;
  emit(s, { k: "fall", lives: Math.max(0, s.lives) });
  if (s.lives < 0) {
    s.lives = 0;
    finish(s, false);
    return;
  }
  s.noAnchorSince = 0;
  s.rocks = [];
  s.ropes = s.ropes.map(() => ROPE_LEN);
  s.taut = s.taut.map(() => 0);
  for (const p of s.players) {
    const at = campSpot(rt.course, s.camp, p.seat, s.seatCount);
    p.x = at.x;
    p.y = at.y;
    p.vx = 0;
    p.vy = 0;
    p.mode = "grip";
    p.hang = false;
    p.tired = false;
    p.stam = STAM_MAX;
    p.summit = false;
    p.stunUntil = s.t + RESPAWN_STUN_MS;
    rt.grabReq[p.seat] = -1;
    rt.bots[p.seat].waitAbove = -1;
  }
}

function finish(s: MatchState, cleared: boolean) {
  const spec = COURSES[s.options.course];
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.phaseEnd = s.t;
  s.cleared = cleared;
  s.endMs = Math.round(s.t - s.climbStart);
  s.grade = cleared ? 1 + (s.falls <= 1 ? 1 : 0) + (s.endMs <= spec.parMs ? 1 : 0) : 0;
  if (cleared) for (const p of s.players) p.pts += PTS_SUMMIT;
  // 협동: 완등하면 전원 1등, 실패하면 전원 꼴찌 (개인 기여도는 MVP 표시에만)
  s.ranks = s.players.map(() => (cleared ? 1 : s.seatCount));
  emit(s, { k: "over", cleared });
}

/** 기여도 1등 자리들 (MVP) */
export function mvpSeats(s: MatchState): number[] {
  const max = Math.max(...s.players.map((p) => p.pts));
  return max > 0 ? s.players.filter((p) => p.pts === max).map((p) => p.seat) : [];
}
