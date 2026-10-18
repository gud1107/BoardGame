/**
 * Deterministic disc physics for 알까기 대전 (rulebook §5).
 *
 * Every client re-runs this from the same input and must land on the same
 * result, so the step uses only + − × ÷ and Math.sqrt (correctly rounded on
 * every JS engine) — no trig, no Math.random, fixed dt, fixed iteration
 * order. The only thing that crosses the network is the shot velocity.
 *
 * Coordinates: board units where the grid spacing is 1; (0, 0) is tengen,
 * the playing surface spans ±EDGE on both axes.
 */

export const EDGE = 9.6;
export const STONE_R = 0.46;
export const KING_R = 0.62;
export const STONE_MASS = 1;
export const KING_MASS = 3;
/** Kings grip the board: their sliding friction is multiplied by this (§9). */
export const KING_GRIP = 2.2;

export const V_MIN = 1.2;
export const V_MAX = 16;

export const DT = 1 / 120;
const MAX_STEPS = 120 * 12;
/** Constant sliding deceleration (units/s²). */
const FRICTION = 4.2;
/** Extra speed-proportional drag (1/s). */
const DRAG = 0.35;
const STOP_SPEED = 0.04;
const RESTITUTION = 0.9;
/** Recorded frames keep every Nth step (120 Hz / 2 = 60 Hz). */
export const FRAME_EVERY = 2;

export interface SimStone {
  id: number;
  x: number;
  y: number;
  r: number;
  m: number;
  /** Friction multiplier (1 = normal stone). */
  mu?: number;
}

export interface SimCollision {
  step: number;
  a: number;
  b: number;
  /** Normal impulse — loudness of the clack. */
  impulse: number;
  x: number;
  y: number;
}

export interface SimFall {
  id: number;
  step: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimResult {
  /** Final resting positions of stones still on the board. */
  rest: { id: number; x: number; y: number }[];
  falls: SimFall[];
  steps: number;
  /** Only with `record`: positions per kept frame, `frames[f][i]` = [x, y] of input stone i (NaN once fallen). */
  frames?: Float32Array[];
  collisions?: SimCollision[];
}

/**
 * Runs one shot to rest. `stones` are the stones on the board; `shooter` gets
 * velocity (vx, vy). The input array is not mutated.
 */
export function simulate(stones: readonly SimStone[], shooter: number, vx: number, vy: number, record = false): SimResult {
  const n = stones.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const on = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = stones[i].x;
    y[i] = stones[i].y;
    on[i] = 1;
    if (stones[i].id === shooter) {
      u[i] = vx;
      v[i] = vy;
    }
  }
  const falls: SimFall[] = [];
  const frames: Float32Array[] | undefined = record ? [] : undefined;
  const collisions: SimCollision[] | undefined = record ? [] : undefined;

  const snap = () => {
    const f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      f[i * 2] = on[i] ? x[i] : NaN;
      f[i * 2 + 1] = on[i] ? y[i] : NaN;
    }
    frames!.push(f);
  };
  if (frames) snap();

  let step = 0;
  for (; step < MAX_STEPS; step++) {
    let moving = false;
    for (let i = 0; i < n; i++) {
      if (!on[i] || (u[i] === 0 && v[i] === 0)) continue;
      moving = true;
      x[i] += u[i] * DT;
      y[i] += v[i] * DT;
    }
    if (!moving) break;

    // collisions (pairwise, fixed order)
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!on[j]) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const rr = stones[i].r + stones[j].r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2);
        let nx: number;
        let ny: number;
        if (d < 1e-9) {
          nx = 1;
          ny = 0;
          d = 0;
        } else {
          nx = dx / d;
          ny = dy / d;
        }
        const mi = stones[i].m;
        const mj = stones[j].m;
        const inv = 1 / mi + 1 / mj;
        // push apart along the normal by inverse mass
        const overlap = rr - d;
        x[i] -= (nx * overlap * (1 / mi)) / inv;
        y[i] -= (ny * overlap * (1 / mi)) / inv;
        x[j] += (nx * overlap * (1 / mj)) / inv;
        y[j] += (ny * overlap * (1 / mj)) / inv;
        const vn = (u[i] - u[j]) * nx + (v[i] - v[j]) * ny;
        if (vn <= 0) continue;
        const jn = ((1 + RESTITUTION) * vn) / inv;
        u[i] -= (jn / mi) * nx;
        v[i] -= (jn / mi) * ny;
        u[j] += (jn / mj) * nx;
        v[j] += (jn / mj) * ny;
        if (collisions && jn > 0.05) collisions.push({ step, a: stones[i].id, b: stones[j].id, impulse: jn, x: x[i] + nx * stones[i].r, y: y[i] + ny * stones[i].r });
      }
    }

    // friction + falling off the edge
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      const s2 = u[i] * u[i] + v[i] * v[i];
      if (s2 > 0) {
        const s = Math.sqrt(s2);
        const ns = s - FRICTION * (stones[i].mu ?? 1) * DT - s * DRAG * DT;
        if (ns <= STOP_SPEED) {
          u[i] = 0;
          v[i] = 0;
        } else {
          const k = ns / s;
          u[i] *= k;
          v[i] *= k;
        }
      }
      if (x[i] > EDGE || x[i] < -EDGE || y[i] > EDGE || y[i] < -EDGE) {
        on[i] = 0;
        falls.push({ id: stones[i].id, step, x: x[i], y: y[i], vx: u[i], vy: v[i] });
      }
    }
    if (frames && (step + 1) % FRAME_EVERY === 0) snap();
  }
  if (frames) snap();

  const rest: SimResult["rest"] = [];
  for (let i = 0; i < n; i++) if (on[i]) rest.push({ id: stones[i].id, x: x[i], y: y[i] });
  return { rest, falls, steps: step, frames, collisions };
}

/** Rulebook §4 — power (0..1 drag) to launch speed: 1.3 power curve so soft shots are fine-grained. */
export function speedForPower(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return V_MIN + (V_MAX - V_MIN) * Math.pow(p, 1.3);
}

/** Inverse of `speedForPower` (for showing a received shot's power). */
export function powerForSpeed(speed: number): number {
  const k = (Math.max(V_MIN, Math.min(V_MAX, speed)) - V_MIN) / (V_MAX - V_MIN);
  return Math.pow(k, 1 / 1.3);
}

/** Distance a lone stone slides from speed `s` before stopping (approx., for aim guides and bots). */
export function slideDistance(s: number): number {
  let d = 0;
  let sp = s;
  while (sp > STOP_SPEED) {
    d += sp * DT;
    sp = sp - FRICTION * DT - sp * DRAG * DT;
  }
  return d;
}

/**
 * First stone a disc of radius `r` moving from (x, y) along unit (dx, dy)
 * would touch, or null. Used for the aim guide (§4) — no bounce prediction.
 */
export function firstContact(
  stones: readonly SimStone[],
  shooter: number,
  dx: number,
  dy: number,
): { id: number; t: number; cx: number; cy: number } | null {
  const me = stones.find((s) => s.id === shooter);
  if (!me) return null;
  let best: { id: number; t: number; cx: number; cy: number } | null = null;
  for (const s of stones) {
    if (s.id === shooter) continue;
    const ox = s.x - me.x;
    const oy = s.y - me.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp2 = ox * ox + oy * oy - along * along;
    const rr = me.r + s.r;
    if (perp2 >= rr * rr) continue;
    const t = along - Math.sqrt(rr * rr - perp2);
    if (t < 0) continue;
    if (!best || t < best.t) best = { id: s.id, t, cx: me.x + dx * t, cy: me.y + dy * t };
  }
  return best;
}
