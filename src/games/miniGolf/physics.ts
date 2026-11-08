/**
 * Deterministic mini-golf physics for 미니골프 파티 (rulebook §6).
 *
 * Every client re-runs the same shot from the same integers and must land on
 * the same result, so the step uses only + − × ÷ and Math.sqrt (correctly
 * rounded everywhere) plus comparisons / Math.floor — no trig, no
 * Math.random, fixed dt, fixed loop order. Only the shot (velocity + the
 * windmill clock) crosses the network.
 *
 * Top-down 2D, metres and seconds. x = across (− left), y = "up the course"
 * (the tee is usually near y = 0). Balls roll on the island's grass; leaving
 * every ground polygon (or entering a void) drops the ball off the floating
 * island. Rails are capsules, bumpers and magnet posts are circles, zones
 * change friction (sand, ice) or push the ball (slopes, ramps). A ball
 * leaving a ramp's far edge flies (z) and lands further on — or in the sky.
 */

export type Pt = { x: number; y: number };
export type Poly = readonly (readonly [number, number])[];

export const BALL_R = 0.03;
export const CUP_R = 0.07;
export const WALL_R = 0.018;
/** Rail height — an airborne ball above this clears rails. */
export const WALL_H = 0.06;
export const DT = 1 / 240;
export const V_MAX = 4.2;
export const V_MIN = 0.2;
const MAX_STEPS = 240 * 22;
/** Rolling resistance (m/s²) and speed-proportional drag (1/s) on each surface. */
const ROLL = 0.5;
const DRAG = 0.22;
const SAND_ROLL = 3.2;
const SAND_DRAG = 0.9;
const ICE_ROLL = 0.08;
const ICE_DRAG = 0.04;
const STOP_V = 0.03;
/** A slope weaker than this can't start a resting ball. */
export const STATIC_A = 0.35;
const E_WALL = 0.72;
const E_BUMPER = 0.95;
const E_POST = 0.3;
const E_BALL = 0.9;
/** Faster than this the ball skims over the cup dead centre (less near the rim); the lip still pulls on it. */
export const CAPTURE_V = 1.15;
const CUP_PULL = 3.2;
const G = 9.8;
/** Vertical share of the speed a ramp launches with. */
export const LIFT = 0.6;
/** Uphill deceleration on a ramp (m/s²). */
export const RAMP_A = 1.6;
const AIR_KEEP = 0.92;
const LAND_KEEP = 0.62;
/** Windmill: one full turn of the four blades (s); a blade blocks the tunnel this share of each quarter. */
export const WINDMILL_PERIOD = 2.4;
export const WINDMILL_BLOCK = 0.3;
/** Recorded frames keep every Nth step (240 Hz / 4 = 60 Hz). */
export const FRAME_EVERY = 4;

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ZoneKind = "sand" | "ice" | "slope";
export interface Zone {
  kind: ZoneKind;
  poly: Poly;
  /** slope push (m/s²) */
  ax: number;
  ay: number;
}

export interface Bumper {
  x: number;
  y: number;
  r: number;
}

export interface Windmill {
  /** The tunnel mouth the blades sweep across. */
  gate: Seg;
  /** Hub (for drawing) and the way the tunnel runs. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** House width (across the corridor). */
  w: number;
}

export interface Ramp {
  poly: Poly;
  /** Launch direction (unit). */
  dx: number;
  dy: number;
  /** For drawing: centre and size (across × along). */
  cx: number;
  cy: number;
  w: number;
  len: number;
}

export interface Magnet {
  x: number;
  y: number;
  /** The post's radius (a ball clacks against it). */
  r: number;
  /** Pull reaches this far (m). */
  field: number;
  /** Pull at the post (m/s²), fading to 0 at `field`. */
  k: number;
}

export interface Layout {
  ground: Poly[];
  voids: Poly[];
  walls: Seg[];
  zones: Zone[];
  bumpers: Bumper[];
  windmill: Windmill | null;
  ramps: Ramp[];
  magnets: Magnet[];
  tee: Pt;
  cup: Pt;
}

export function pointInPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The ball's centre is over the island (not off an edge, not over a chasm). */
export function onGround(L: Layout, x: number, y: number): boolean {
  for (const v of L.voids) if (pointInPoly(x, y, v)) return false;
  for (const g of L.ground) if (pointInPoly(x, y, g)) return true;
  return false;
}

/** Windmill clock → is a blade across the tunnel mouth right now? */
export function windmillBlocked(t: number): boolean {
  const p = t / WINDMILL_PERIOD;
  const q4 = (p - Math.floor(p)) * 4;
  const q = q4 - Math.floor(q4);
  const half = WINDMILL_BLOCK / 2;
  return q < half || q > 1 - half;
}

/* ── broad phase for rails ─────────────────────────────────────────────── */

interface Prepared {
  segs: { x1: number; y1: number; dx: number; dy: number; len2: number }[];
  cell: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  grid: number[][];
}

const PREP = new WeakMap<Layout, Prepared>();

function prepare(L: Layout): Prepared {
  const hit = PREP.get(L);
  if (hit) return hit;
  const segs = L.walls.map((s) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    return { x1: s.x1, y1: s.y1, dx, dy, len2: dx * dx + dy * dy };
  });
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
  for (const s of L.walls) {
    x0 = Math.min(x0, s.x1, s.x2);
    y0 = Math.min(y0, s.y1, s.y2);
    x1 = Math.max(x1, s.x1, s.x2);
    y1 = Math.max(y1, s.y1, s.y2);
  }
  const cell = 0.25;
  x0 -= 0.5;
  y0 -= 0.5;
  const nx = Math.max(1, Math.ceil((x1 + 0.5 - x0) / cell));
  const ny = Math.max(1, Math.ceil((y1 + 0.5 - y0) / cell));
  const grid: number[][] = Array.from({ length: nx * ny }, () => []);
  const pad = BALL_R + WALL_R + 0.02;
  segs.forEach((s, i) => {
    const sx0 = Math.min(s.x1, s.x1 + s.dx) - pad;
    const sx1 = Math.max(s.x1, s.x1 + s.dx) + pad;
    const sy0 = Math.min(s.y1, s.y1 + s.dy) - pad;
    const sy1 = Math.max(s.y1, s.y1 + s.dy) + pad;
    const cx0 = Math.max(0, Math.floor((sx0 - x0) / cell));
    const cx1 = Math.min(nx - 1, Math.floor((sx1 - x0) / cell));
    const cy0 = Math.max(0, Math.floor((sy0 - y0) / cell));
    const cy1 = Math.min(ny - 1, Math.floor((sy1 - y0) / cell));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) grid[cy * nx + cx].push(i);
  });
  const p = { segs, cell, x0, y0, nx, ny, grid };
  PREP.set(L, p);
  return p;
}

/* ── simulation ────────────────────────────────────────────────────────── */

export interface SimBall {
  /** Seat that owns the ball. */
  id: number;
  x: number;
  y: number;
}

export interface ShotInput {
  /** Index into `balls` of the ball being hit. */
  shooter: number;
  vx: number;
  vy: number;
  /** Windmill clock (s) when the ball starts rolling. */
  wm: number;
}

export type BallEnd = "rest" | "holed" | "out";

export type SimEventKind = "wall" | "bumper" | "post" | "ball" | "cup" | "lip" | "out" | "launch" | "land" | "windmill" | "sand";

export interface SimEvent {
  step: number;
  kind: SimEventKind;
  /** Ball index (into the input `balls`). */
  a: number;
  /** Other ball index for "ball", else −1. */
  b: number;
  impulse: number;
  x: number;
  y: number;
}

export interface SimResult {
  balls: { id: number; x: number; y: number; end: BallEnd; step: number }[];
  /** The shooter flew off a ramp. */
  jumped: boolean;
  /** The shooter went through the windmill tunnel. */
  windmillPass: boolean;
  /** The shooter bounced off a windmill blade. */
  windmillHit: boolean;
  steps: number;
  /** Only with `record`: per kept frame, [x, y, z, state] per ball (state 0 rolling/rest, 1 holed, 2 out). */
  frames?: Float32Array[];
  events?: SimEvent[];
}

const enum St {
  Live = 0,
  Holed = 1,
  Out = 2,
}

/** Surface at a point: friction + push (ramps first, then the first matching zone). */
function surface(L: Layout, x: number, y: number, out: { roll: number; drag: number; ax: number; ay: number; ramp: number; sand: boolean }) {
  out.roll = ROLL;
  out.drag = DRAG;
  out.ax = 0;
  out.ay = 0;
  out.ramp = -1;
  out.sand = false;
  for (let i = 0; i < L.ramps.length; i++) {
    const r = L.ramps[i];
    if (pointInPoly(x, y, r.poly)) {
      out.ramp = i;
      out.ax = -r.dx * RAMP_A;
      out.ay = -r.dy * RAMP_A;
      return;
    }
  }
  for (const z of L.zones) {
    if (!pointInPoly(x, y, z.poly)) continue;
    if (z.kind === "sand") {
      out.roll = SAND_ROLL;
      out.drag = SAND_DRAG;
      out.sand = true;
    } else if (z.kind === "ice") {
      out.roll = ICE_ROLL;
      out.drag = ICE_DRAG;
    } else {
      out.ax = z.ax;
      out.ay = z.ay;
    }
    return;
  }
}

/**
 * Runs one shot until every ball rests, drops in or falls off. `balls` are
 * the balls on the course (the shooter's included, at its spot); the input
 * is not mutated.
 */
export function simulate(L: Layout, balls: readonly SimBall[], shot: ShotInput, record = false): SimResult {
  const n = balls.length;
  const P = prepare(L);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const w = new Float64Array(n);
  const st = new Uint8Array(n);
  const air = new Uint8Array(n);
  const sleep = new Uint8Array(n);
  const contact = new Uint8Array(n);
  const onRamp = new Int8Array(n).fill(-1);
  const endStep = new Int32Array(n).fill(-1);
  const inSand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = balls[i].x;
    y[i] = balls[i].y;
    sleep[i] = 1;
  }
  const s0 = shot.shooter;
  let svx = Number.isFinite(shot.vx) ? shot.vx : 0;
  let svy = Number.isFinite(shot.vy) ? shot.vy : 0;
  const sp = Math.sqrt(svx * svx + svy * svy);
  if (sp > V_MAX) {
    svx = (svx * V_MAX) / sp;
    svy = (svy * V_MAX) / sp;
  }
  u[s0] = svx;
  v[s0] = svy;
  sleep[s0] = 0;
  let jumped = false;
  let windmillPass = false;
  let windmillHit = false;
  const wm = L.windmill;
  // which side of the tunnel mouth the shooter is on (to spot a pass)
  const gateSide = (i: number) => (wm ? (x[i] - (wm.gate.x1 + wm.gate.x2) / 2) * wm.dx + (y[i] - (wm.gate.y1 + wm.gate.y2) / 2) * wm.dy : 0);
  let lastSide = gateSide(s0);

  const frames: Float32Array[] | undefined = record ? [] : undefined;
  const events: SimEvent[] | undefined = record ? [] : undefined;
  const snap = () => {
    const f = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      f[i * 4] = x[i];
      f[i * 4 + 1] = y[i];
      f[i * 4 + 2] = z[i];
      f[i * 4 + 3] = st[i];
    }
    frames!.push(f);
  };
  if (frames) snap();
  const surf = { roll: ROLL, drag: DRAG, ax: 0, ay: 0, ramp: -1, sand: false };
  const rr = BALL_R + WALL_R;

  let step = 0;
  for (; step < MAX_STEPS; step++) {
    const t = shot.wm + step * DT;
    const blocked = wm ? windmillBlocked(t) : false;

    // ---- integrate
    for (let i = 0; i < n; i++) {
      if (st[i] !== St.Live || sleep[i]) continue;
      contact[i] = 0;
      if (air[i]) {
        x[i] += u[i] * DT;
        y[i] += v[i] * DT;
        z[i] += w[i] * DT;
        w[i] -= G * DT;
        if (z[i] <= 0) {
          z[i] = 0;
          w[i] = 0;
          air[i] = 0;
          events?.push({ step, kind: "land", a: i, b: -1, impulse: Math.sqrt(u[i] * u[i] + v[i] * v[i]), x: x[i], y: y[i] });
          if (!onGround(L, x[i], y[i])) {
            st[i] = St.Out;
            endStep[i] = step;
            events?.push({ step, kind: "out", a: i, b: -1, impulse: 0, x: x[i], y: y[i] });
            continue;
          }
          u[i] *= LAND_KEEP;
          v[i] *= LAND_KEEP;
        }
        continue;
      }
      surface(L, x[i], y[i], surf);
      if (surf.sand && !inSand[i]) {
        inSand[i] = 1;
        events?.push({ step, kind: "sand", a: i, b: -1, impulse: Math.sqrt(u[i] * u[i] + v[i] * v[i]), x: x[i], y: y[i] });
      } else if (!surf.sand) inSand[i] = 0;
      let ax = surf.ax;
      let ay = surf.ay;
      // magnets pull toward their post (fading out with distance, off once touching)
      for (const m of L.magnets) {
        const dx = m.x - x[i];
        const dy = m.y - y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= m.field * m.field) continue;
        const d = Math.sqrt(d2);
        if (d < m.r + BALL_R + 0.012 || d < 1e-9) continue;
        const k = (m.k * (1 - d / m.field)) / d;
        ax += dx * k;
        ay += dy * k;
      }
      // the cup's lip draws a passing ball in
      const cdx = L.cup.x - x[i];
      const cdy = L.cup.y - y[i];
      const cd2 = cdx * cdx + cdy * cdy;
      if (cd2 < CUP_R * CUP_R && cd2 > 1e-12) {
        const cd = Math.sqrt(cd2);
        ax += (cdx / cd) * CUP_PULL;
        ay += (cdy / cd) * CUP_PULL;
      }
      let s = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
      if (s < STOP_V) {
        if (ax * ax + ay * ay < STATIC_A * STATIC_A) {
          u[i] = 0;
          v[i] = 0;
          continue;
        }
      }
      u[i] += ax * DT;
      v[i] += ay * DT;
      s = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
      if (s > 0) {
        const ns = s - (surf.roll + surf.drag * s) * DT;
        if (ns <= 0) {
          u[i] = 0;
          v[i] = 0;
        } else {
          u[i] *= ns / s;
          v[i] *= ns / s;
        }
      }
      x[i] += u[i] * DT;
      y[i] += v[i] * DT;
      // off a ramp's far edge → airborne
      const was = onRamp[i];
      surface(L, x[i], y[i], surf);
      onRamp[i] = surf.ramp;
      if (was >= 0 && surf.ramp !== was) {
        const r = L.ramps[was];
        const along = u[i] * r.dx + v[i] * r.dy;
        if (along > 0) {
          const sp2 = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
          air[i] = 1;
          w[i] = sp2 * LIFT;
          u[i] *= AIR_KEEP;
          v[i] *= AIR_KEEP;
          z[i] = 0.001;
          if (i === s0) jumped = true;
          events?.push({ step, kind: "launch", a: i, b: -1, impulse: sp2, x: x[i], y: y[i] });
          continue;
        }
      }
      if (!onGround(L, x[i], y[i])) {
        st[i] = St.Out;
        endStep[i] = step;
        events?.push({ step, kind: "out", a: i, b: -1, impulse: 0, x: x[i], y: y[i] });
        continue;
      }
      // into the cup
      const ex = L.cup.x - x[i];
      const ey = L.cup.y - y[i];
      const sNow = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
      const e2 = ex * ex + ey * ey;
      if (e2 < (CUP_R - BALL_R * 0.3) * (CUP_R - BALL_R * 0.3)) {
        // dead centre takes the most pace; near the rim only a dying ball drops
        if (sNow < CAPTURE_V * (1 - (0.75 * e2) / (CUP_R * CUP_R))) {
          st[i] = St.Holed;
          endStep[i] = step;
          u[i] = 0;
          v[i] = 0;
          x[i] = L.cup.x;
          y[i] = L.cup.y;
          events?.push({ step, kind: "cup", a: i, b: -1, impulse: sNow, x: L.cup.x, y: L.cup.y });
          continue;
        }
      }
    }

    // ---- collisions with the course (ground balls, or airborne ones below rail height)
    for (let i = 0; i < n; i++) {
      if (st[i] !== St.Live || sleep[i]) continue;
      if (air[i] && z[i] > WALL_H) continue;
      // rails
      const cx = Math.floor((x[i] - P.x0) / P.cell);
      const cy = Math.floor((y[i] - P.y0) / P.cell);
      if (cx >= 0 && cy >= 0 && cx < P.nx && cy < P.ny) {
        for (const si of P.grid[cy * P.nx + cx]) {
          const sg = P.segs[si];
          let tt = ((x[i] - sg.x1) * sg.dx + (y[i] - sg.y1) * sg.dy) / sg.len2;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          const px = sg.x1 + tt * sg.dx;
          const py = sg.y1 + tt * sg.dy;
          collideStatic(i, px, py, rr, E_WALL, "wall", 0.985);
        }
      }
      // windmill blade across the tunnel mouth
      if (wm && blocked && !air[i]) {
        const g = wm.gate;
        const gdx = g.x2 - g.x1;
        const gdy = g.y2 - g.y1;
        let tt = ((x[i] - g.x1) * gdx + (y[i] - g.y1) * gdy) / (gdx * gdx + gdy * gdy);
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        if (collideStatic(i, g.x1 + tt * gdx, g.y1 + tt * gdy, BALL_R + 0.02, 0.55, "windmill", 1) && i === s0) windmillHit = true;
      }
      for (const b of L.bumpers) collideStatic(i, b.x, b.y, BALL_R + b.r, E_BUMPER, "bumper", 1);
      for (const m of L.magnets) collideStatic(i, m.x, m.y, BALL_R + m.r, E_POST, "post", 0.8);
    }

    // ---- ball vs ball
    for (let i = 0; i < n; i++) {
      if (st[i] !== St.Live) continue;
      for (let j = i + 1; j < n; j++) {
        if (st[j] !== St.Live) continue;
        if (sleep[i] && sleep[j]) continue;
        if (air[i] !== air[j] && (z[i] > BALL_R || z[j] > BALL_R)) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const r2 = 2 * BALL_R;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 * r2) continue;
        const d = Math.sqrt(d2);
        const nx = d < 1e-9 ? 1 : dx / d;
        const ny = d < 1e-9 ? 0 : dy / d;
        const overlap = r2 - d;
        x[i] -= (nx * overlap) / 2;
        y[i] -= (ny * overlap) / 2;
        x[j] += (nx * overlap) / 2;
        y[j] += (ny * overlap) / 2;
        const vn = (u[i] - u[j]) * nx + (v[i] - v[j]) * ny;
        if (vn > 0) {
          const jn = ((1 + E_BALL) * vn) / 2;
          u[i] -= jn * nx;
          v[i] -= jn * ny;
          u[j] += jn * nx;
          v[j] += jn * ny;
          sleep[i] = 0;
          sleep[j] = 0;
          events?.push({ step, kind: "ball", a: i, b: j, impulse: vn, x: x[i] + nx * BALL_R, y: y[i] + ny * BALL_R });
        }
      }
    }

    // ---- the shooter through the windmill tunnel
    if (wm && st[s0] === St.Live) {
      const side = gateSide(s0);
      if (lastSide < 0 && side >= 0.15) {
        const g = wm.gate;
        const mx = (g.x1 + g.x2) / 2;
        const my = (g.y1 + g.y2) / 2;
        const across = Math.abs((x[s0] - mx) * wm.dy - (y[s0] - my) * wm.dx);
        if (across < 0.2) windmillPass = true;
      }
      if (side < 0 || side >= 0.15) lastSide = side;
    }

    // ---- a ball at rest (or pinned against a rail by a slope) goes to sleep
    let moving = false;
    for (let i = 0; i < n; i++) {
      if (st[i] !== St.Live || sleep[i]) continue;
      if (air[i]) {
        moving = true;
        continue;
      }
      const s = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
      if (s < STOP_V) {
        surface(L, x[i], y[i], surf);
        const pull = surf.ax * surf.ax + surf.ay * surf.ay;
        if (contact[i] || pull < STATIC_A * STATIC_A) {
          u[i] = 0;
          v[i] = 0;
          sleep[i] = 1;
          continue;
        }
      }
      moving = true;
    }

    if (frames && (step + 1) % FRAME_EVERY === 0) snap();
    if (!moving) break;
  }
  if (frames) snap();

  return {
    balls: balls.map((b, i) => ({ id: b.id, x: x[i], y: y[i], end: st[i] === St.Holed ? "holed" : st[i] === St.Out ? "out" : "rest", step: endStep[i] })),
    jumped,
    windmillPass,
    windmillHit,
    steps: step,
    frames,
    events,
  };

  /** Circle-vs-point contact (rails use their closest point): push out, bounce. */
  function collideStatic(i: number, px: number, py: number, reach: number, e: number, kind: SimEventKind, keepT: number): boolean {
    const dx = x[i] - px;
    const dy = y[i] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) return false;
    let nx: number;
    let ny: number;
    const d = Math.sqrt(d2);
    if (d < 1e-9) {
      const s = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
      nx = s > 1e-9 ? -u[i] / s : 0;
      ny = s > 1e-9 ? -v[i] / s : 1;
    } else {
      nx = dx / d;
      ny = dy / d;
    }
    x[i] = px + nx * reach;
    y[i] = py + ny * reach;
    contact[i] = 1;
    const vn = u[i] * nx + v[i] * ny;
    if (vn < 0) {
      // tangential part keeps most of its speed, normal part bounces back
      const tu = u[i] - vn * nx;
      const tv = v[i] - vn * ny;
      u[i] = tu * keepT - e * vn * nx;
      v[i] = tv * keepT - e * vn * ny;
      if (-vn > 0.05) events?.push({ step, kind, a: i, b: -1, impulse: -vn, x: px, y: py });
      return true;
    }
    return false;
  }
}

/** Power (0..1) → ball speed (m/s): finer control for short putts. */
export function speedForPower(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return V_MIN + (V_MAX - V_MIN) * p * Math.sqrt(p);
}

export function powerForSpeed(speed: number): number {
  const k = Math.max(0, Math.min(1, (speed - V_MIN) / (V_MAX - V_MIN)));
  return Math.cbrt(k * k);
}
