/**
 * 미니골프 파티 AI (rulebook §10). Each candidate stroke (a direction × a
 * power, plus a windmill timing when there is one) is played through the
 * real physics with the other balls on the course, and the end spot is
 * scored by the strokes it should still take — from a walking-distance
 * field to the cup that goes around rails and chasms. Higher levels try
 * more lines, refine around the best ones, judge them under their own hand
 * tremor (Lv.4+), and — the main difference — shake less when they hit. Lv.6+ also likes knocking a
 * rival off the island and hates knocking one in.
 *
 * The bot may use Math.random and trig freely — only the resulting integer
 * shot goes into the action, and every client re-simulates it.
 */

import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { OBSTACLE_KINDS, type ObstacleKind } from "./course";
import { ballSpot, currentLayout, holeDone, lastPlace, quantizeShot, shotBalls, shotOf, totalOf, windmillClock, type EngineAction, type MiniGolfState, type Seat } from "./engine";
import { BALL_R, onGround, pointInPoly, simulate, speedForPower, WALL_R, WINDMILL_PERIOD, type Layout } from "./physics";

/* ── walking distance to the cup ───────────────────────────────────────── */

const CELL = 0.05;

interface Field {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  d: Float32Array;
}

const FIELDS = new WeakMap<Layout, Field>();

function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function distToSeg(px: number, py: number, s: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / (dx * dx + dy * dy || 1);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** Dijkstra over a 5 cm grid of the ground (rails and chasms block). */
export function fieldFor(L: Layout): Field {
  const hit = FIELDS.get(L);
  if (hit) return hit;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of L.ground)
    for (const [x, y] of g) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const nx = Math.ceil((x1 - x0) / CELL) + 1;
  const ny = Math.ceil((y1 - y0) / CELL) + 1;
  const ok = new Uint8Array(nx * ny);
  const walls = L.walls;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * CELL;
      const y = y0 + j * CELL;
      if (!onGround(L, x, y)) continue;
      let blocked = false;
      for (const s of walls) if (distToSeg(x, y, s) < WALL_R + BALL_R * 0.6) blocked = true;
      for (const b of L.bumpers) if (Math.hypot(x - b.x, y - b.y) < b.r + BALL_R * 0.6) blocked = true;
      if (!blocked) ok[j * nx + i] = 1;
    }
  const d = new Float32Array(nx * ny).fill(Infinity);
  const ci = Math.round((L.cup.x - x0) / CELL);
  const cj = Math.round((L.cup.y - y0) / CELL);
  const start = Math.max(0, Math.min(ny - 1, cj)) * nx + Math.max(0, Math.min(nx - 1, ci));
  d[start] = 0;
  // simple binary-heap Dijkstra
  const heap: number[] = [start];
  const pri = (k: number) => d[k];
  const push = (k: number) => {
    heap.push(k);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (pri(heap[p]) <= pri(heap[i])) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && pri(heap[l]) < pri(heap[m])) m = l;
        if (r < heap.length && pri(heap[r]) < pri(heap[m])) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const done = new Uint8Array(nx * ny);
  const N8 = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;
  while (heap.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj, c] of N8) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a;
      if (!ok[q] || done[q]) continue;
      // a step may not pass through a rail
      const ax = x0 + i * CELL;
      const ay = y0 + j * CELL;
      const bx = x0 + a * CELL;
      const by = y0 + b * CELL;
      let cut = false;
      for (const s of walls) if (segCross(ax, ay, bx, by, s.x1, s.y1, s.x2, s.y2)) cut = true;
      if (cut) continue;
      // sand counts as longer, slopes are ignored
      let cost = c * CELL;
      for (const z of L.zones) if (z.kind === "sand" && pointInPoly(bx, by, z.poly)) cost *= 2.2;
      const nd = d[k] + cost;
      if (nd < d[q]) {
        d[q] = nd;
        push(q);
      }
    }
  }
  const f = { x0, y0, nx, ny, d };
  FIELDS.set(L, f);
  return f;
}

/** Walking distance from (x, y) to the cup (∞ if it can't be reached on foot). */
export function walkDist(L: Layout, x: number, y: number): number {
  const f = fieldFor(L);
  const i = Math.round((x - f.x0) / CELL);
  const j = Math.round((y - f.y0) / CELL);
  let best = Infinity;
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= f.nx || b >= f.ny) continue;
      const v = f.d[b * f.nx + a];
      if (v < best) best = v + Math.hypot(di, dj) * CELL * 0.5;
    }
  if (!Number.isFinite(best)) best = Math.hypot(x - L.cup.x, y - L.cup.y) * 2 + 2;
  return best;
}

/** Strokes a decent player still needs from a spot `d` metres (walking) from the cup. */
export function strokesFrom(d: number): number {
  if (d < 0.12) return 1;
  if (d < 0.5) return 1 + d * 0.5;
  return 1.25 + Math.min(3, d / 2.6);
}

/* ── levels ───────────────────────────────────────────────────────────── */

interface Params {
  /** Directions tried around the full circle. */
  dirs: number;
  powers: number[];
  /** Refine passes around the best few. */
  refine: number;
  /** Hand tremor (1σ): direction (rad), power (share). */
  angSd: number;
  powSd: number;
  robust: boolean;
  /** Windmill timings tried. */
  timings: number;
  aggressive: boolean;
  /** Every Nth path point is a target; angle offsets tried around each. */
  pathEvery: number;
  pathOffsets: number[];
  /** Weaker bots' "mistakes" stay among this top share of the lines they looked at. */
  sane: number;
}

const ANG_SD = [0.06, 0.055, 0.05, 0.046, 0.042, 0.038, 0.035, 0.032, 0.029, 0.026];
const POW_SD = [0.14, 0.13, 0.12, 0.11, 0.1, 0.093, 0.086, 0.079, 0.072, 0.066];

export function botParams(level: BotLevel): Params {
  const l = clampBotLevel(level);
  return {
    dirs: l <= 3 ? 16 : l <= 6 ? 24 : 32,
    powers: l <= 3 ? [0.15, 0.3, 0.45, 0.6, 0.8] : [0.1, 0.2, 0.3, 0.4, 0.5, 0.62, 0.75, 0.9],
    refine: l <= 2 ? 0 : l <= 5 ? 1 : 2,
    angSd: ANG_SD[l - 1],
    powSd: POW_SD[l - 1],
    robust: l >= 4,
    timings: l <= 3 ? 1 : l <= 6 ? 3 : 6,
    aggressive: l >= 6,
    pathEvery: l <= 3 ? 4 : l <= 6 ? 2 : 1,
    pathOffsets: l <= 3 ? [0] : l <= 6 ? [-0.012, 0, 0.012] : [-0.02, -0.008, 0, 0.008, 0.02],
    sane: l <= 3 ? 0.1 : 0.08,
  };
}

/* ── evaluating a stroke ──────────────────────────────────────────────── */

export interface Cand {
  ang: number;
  power: number;
  /** Windmill clock (s, before the windup). */
  wm: number;
}

/** Expected strokes still to play after this one (lower is better), plus the rival bonus. */
export function evaluate(state: MiniGolfState, seat: Seat, c: Cand, aggressive: boolean): number {
  const L = currentLayout(state);
  const sp = speedForPower(c.power);
  const q = quantizeShot(Math.cos(c.ang) * sp, Math.sin(c.ang) * sp, c.wm);
  const v = shotOf(q);
  const { balls, shooter } = shotBalls(state, seat);
  const res = simulate(L, balls, { shooter, vx: v.vx, vy: v.vy, wm: windmillClock(q.wm) });
  let cost = 0;
  for (const r of res.balls) {
    if (r.id === seat) {
      if (r.end === "holed") cost += 0;
      else if (r.end === "out") cost += 1 + strokesFrom(walkDist(L, balls[shooter].x, balls[shooter].y)) + 0.15;
      else cost += strokesFrom(walkDist(L, r.x, r.y));
    } else if (aggressive) {
      if (r.end === "out") cost -= 0.35;
      else if (r.end === "holed") cost += 0.6;
    }
  }
  return cost;
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function tremble(c: Cand, p: Pick<Params, "angSd" | "powSd">, rng: () => number): Cand {
  return { ang: c.ang + gaussian(rng) * p.angSd, power: Math.max(0.02, Math.min(1, c.power * (1 + gaussian(rng) * p.powSd))), wm: c.wm + gaussian(rng) * 0.04 * (p.angSd / 0.02) };
}

/** Points along the walking path from (x, y) to the cup (steepest descent on the field), every `every` metres. */
export function pathPoints(L: Layout, x: number, y: number, every = 0.25): { x: number; y: number; at: number }[] {
  const f = fieldFor(L);
  let i = Math.max(0, Math.min(f.nx - 1, Math.round((x - f.x0) / CELL)));
  let j = Math.max(0, Math.min(f.ny - 1, Math.round((y - f.y0) / CELL)));
  // start from the best reachable cell next to the ball
  let k = j * f.nx + i;
  if (!Number.isFinite(f.d[k])) {
    let best = Infinity;
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= f.nx || b >= f.ny) continue;
        const q = b * f.nx + a;
        if (f.d[q] < best) {
          best = f.d[q];
          k = q;
        }
      }
    if (!Number.isFinite(best)) return [];
    i = k % f.nx;
    j = (k - i) / f.nx;
  }
  const out: { x: number; y: number; at: number }[] = [];
  let travelled = 0;
  let next = every;
  let px = x;
  let py = y;
  for (let guard = 0; guard < 600 && f.d[k] > 0; guard++) {
    let bk = k;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= f.nx || b >= f.ny) continue;
        const q = b * f.nx + a;
        if (f.d[q] < f.d[bk]) bk = q;
      }
    if (bk === k) break;
    k = bk;
    i = k % f.nx;
    j = (k - i) / f.nx;
    const cx = f.x0 + i * CELL;
    const cy = f.y0 + j * CELL;
    travelled += Math.hypot(cx - px, cy - py);
    px = cx;
    py = cy;
    if (travelled >= next) {
      out.push({ x: cx, y: cy, at: travelled });
      next += every;
    }
  }
  out.push({ x: L.cup.x, y: L.cup.y, at: travelled });
  return out;
}

export function candidates(state: MiniGolfState, seat: Seat, p: Params, rng: () => number): Cand[] {
  const L = currentLayout(state);
  const from = ballSpot(state, seat);
  const toCup = Math.atan2(L.cup.y - from.y, L.cup.x - from.x);
  const wms = L.windmill ? Array.from({ length: p.timings }, (_, i) => (i / p.timings) * (WINDMILL_PERIOD / 4) + rng() * 0.02) : [0];
  const out: Cand[] = [];
  // a coarse ring (banks, odd lines)
  for (let k = 0; k < p.dirs; k++) {
    const ang = toCup + (k / p.dirs) * Math.PI * 2;
    for (const power of p.powers) for (const wm of wms) out.push({ ang, power, wm });
  }
  // aim along the walking path: straight lines to points on it, with weights to stop near / past them
  const pts = pathPoints(L, from.x, from.y, 0.25);
  const picks = pts.filter((_, i) => i % p.pathEvery === 0 || i === pts.length - 1);
  for (const t of picks) {
    const d = Math.hypot(t.x - from.x, t.y - from.y);
    if (d < 0.08) continue;
    const ang = Math.atan2(t.y - from.y, t.x - from.x);
    for (const off of p.pathOffsets) for (const power of p.powers) for (const wm of wms) out.push({ ang: ang + off, power, wm });
  }
  return out;
}

/* ── choosing ─────────────────────────────────────────────────────────── */

export function chooseBotShot(state: MiniGolfState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "play" || state.activeSeat !== seat || holeDone(state, seat)) return null;
  const p = botParams(level);
  const cands = candidates(state, seat, p, rng);
  let scored = cands.map((c) => ({ move: c, score: evaluate(state, seat, c, p.aggressive) }));
  for (let pass = 0; pass < p.refine; pass++) {
    const top = [...scored].sort((a, b) => a.score - b.score).slice(0, 4);
    const da = (Math.PI * 2) / p.dirs / (pass + 2);
    for (const t of top) {
      for (const dA of [-da, -da / 2, da / 2, da])
        for (const dP of [0.92, 1, 1.08]) {
          const c = { ang: t.move.ang + dA, power: Math.min(1, t.move.power * dP), wm: t.move.wm };
          scored.push({ move: c, score: evaluate(state, seat, c, p.aggressive) });
        }
    }
  }
  if (p.robust) {
    const top = [...scored].sort((a, b) => a.score - b.score).slice(0, 6);
    for (const t of top) {
      let sum = t.score;
      for (let i = 0; i < 4; i++) sum += evaluate(state, seat, tremble(t.move, p, rng), p.aggressive);
      t.score = sum / 5;
    }
    scored = top;
  }
  // pickByLevel maximizes — feed it negated costs, and only the sane top share
  scored.sort((a, b) => a.score - b.score);
  const keep = Math.max(1, Math.min(scored.length, p.robust ? scored.length : Math.ceil(scored.length * p.sane)));
  const pick = pickByLevel(
    scored.slice(0, keep).map((s) => ({ move: s.move, score: 10 - s.score })),
    level,
    rng,
  );
  const shot = tremble(pick, p, rng);
  const sp = speedForPower(shot.power);
  const q = quantizeShot(Math.cos(shot.ang) * sp, Math.sin(shot.ang) * sp, Math.max(0, shot.wm));
  return { type: "shot", seat, ...q };
}

/**
 * §8 — the obstacle last place picks. Far behind → the chaos of the ramp
 * (one jump can win a stroke back); close → the windmill (timing evens
 * skill out); weaker bots just pick at random.
 */
export function chooseBotPick(state: MiniGolfState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "pick" || state.picker !== seat) return null;
  const l = clampBotLevel(level);
  let kind: ObstacleKind;
  if (l <= 3 || state.playerCount < 2) kind = OBSTACLE_KINDS[Math.floor(rng() * OBSTACLE_KINDS.length)];
  else {
    const others = Array.from({ length: state.playerCount }, (_, s) => s).filter((s) => s !== seat);
    const best = Math.min(...others.map((s) => totalOf(state, s)));
    const gap = totalOf(state, seat) - best;
    kind = gap >= 3 ? "ramp" : gap >= 1 ? (rng() < 0.6 ? "windmill" : "magnet") : OBSTACLE_KINDS[Math.floor(rng() * 3)];
  }
  return { type: "pick", seat, kind };
}

export function chooseBotAction(state: MiniGolfState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase === "pick") return chooseBotPick(state, seat, level, rng);
  return chooseBotShot(state, seat, level, rng);
}

export { lastPlace };
