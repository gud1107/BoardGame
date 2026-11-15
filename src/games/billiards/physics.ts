/**
 * Deterministic pool-table physics for 당구 파티 (rulebook §5).
 *
 * Every client re-runs a shot from the same input and must land on the same
 * result, so the step uses only + − × ÷ and Math.sqrt (correctly rounded on
 * every JS engine) — no trig, no Math.random, fixed dt, fixed iteration
 * order. The only thing that crosses the network is the shot itself
 * (velocity + cue-ball spin as integers).
 *
 * Coordinates: table units, (0, 0) is the centre spot; the cloth spans
 * x ∈ [−HALF_W, HALF_W], y ∈ [−HALF_H, HALF_H] (cushion noses). Ball radius
 * R. +x is the foot end (where the rack sits), −x the head end.
 */

export const HALF_W = 12;
export const HALF_H = 6;
export const R = 0.5;

export const V_MIN = 1.2;
export const V_MAX = 24;

export const DT = 1 / 120;
const MAX_STEPS = 120 * 16;
/** Constant rolling deceleration (units/s²). */
const FRICTION = 2.6;
/** Extra speed-proportional drag (1/s). */
const DRAG = 0.22;
const STOP_SPEED = 0.035;
const BALL_E = 0.95;
const CUSHION_E = 0.78;
/** Cushion keeps this much of the along-rail speed. */
const CUSHION_T = 0.93;
/** Side spin (english) bends the rebound by this fraction of the hit speed. */
const SIDE_KICK = 0.32;
/** Follow / draw: extra cue speed along the shot line at the first contact. */
const FOLLOW_KICK = 0.62;
/** Recorded frames keep every Nth step (120 Hz / 2 = 60 Hz). */
export const FRAME_EVERY = 2;

export interface Pocket {
  x: number;
  y: number;
  /** Capture radius (ball centre inside = pocketed). */
  r: number;
  /** Mouth half-width along the rail (no cushion there). */
  mouth: number;
  corner: boolean;
}

/** Six pockets: four corners + middle of each long rail (index order is fixed — the "lucky pocket" uses it). */
export const POCKETS: readonly Pocket[] = [
  { x: -HALF_W - 0.18, y: -HALF_H - 0.18, r: 0.98, mouth: 1.05, corner: true },
  { x: 0, y: -HALF_H - 0.42, r: 0.88, mouth: 0.82, corner: false },
  { x: HALF_W + 0.18, y: -HALF_H - 0.18, r: 0.98, mouth: 1.05, corner: true },
  { x: HALF_W + 0.18, y: HALF_H + 0.18, r: 0.98, mouth: 1.05, corner: true },
  { x: 0, y: HALF_H + 0.42, r: 0.88, mouth: 0.82, corner: false },
  { x: -HALF_W - 0.18, y: HALF_H + 0.18, r: 0.98, mouth: 1.05, corner: true },
];

export interface SimBall {
  id: number;
  x: number;
  y: number;
}

export interface SimShot {
  /** Id of the ball the cue strikes. */
  cue: number;
  vx: number;
  vy: number;
  /** −1 (draw) … +1 (follow). */
  spin: number;
  /** −1 (left english) … +1 (right english). */
  side: number;
}

export interface SimContact {
  step: number;
  a: number;
  b: number;
  impulse: number;
  x: number;
  y: number;
}

export interface SimRail {
  step: number;
  id: number;
  impulse: number;
  x: number;
  y: number;
}

export interface SimPot {
  id: number;
  step: number;
  pocket: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimResult {
  rest: { id: number; x: number; y: number }[];
  pots: SimPot[];
  /** Every ball–ball contact (also without `record`, in order — the rules need them). */
  contacts: SimContact[];
  /** Cushion hits (in order). */
  rails: SimRail[];
  steps: number;
  /** Only with `record`: `frames[f][i*2..]` = x, y of input ball i (NaN once pocketed). */
  frames?: Float32Array[];
}

/**
 * Runs one shot to rest. `pockets: false` = carom table (no holes). The input
 * array is not mutated.
 */
export function simulate(balls: readonly SimBall[], shot: SimShot, pockets = true, record = false): SimResult {
  const n = balls.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const on = new Uint8Array(n);
  let cueI = -1;
  for (let i = 0; i < n; i++) {
    x[i] = balls[i].x;
    y[i] = balls[i].y;
    on[i] = 1;
    if (balls[i].id === shot.cue) {
      cueI = i;
      u[i] = shot.vx;
      v[i] = shot.vy;
    }
  }
  const s0 = Math.sqrt(shot.vx * shot.vx + shot.vy * shot.vy);
  const dirX = s0 > 1e-9 ? shot.vx / s0 : 1;
  const dirY = s0 > 1e-9 ? shot.vy / s0 : 0;
  let side = Math.max(-1, Math.min(1, shot.side));
  const spin = Math.max(-1, Math.min(1, shot.spin));
  let firstHit = false;

  const pots: SimPot[] = [];
  const contacts: SimContact[] = [];
  const rails: SimRail[] = [];
  const frames: Float32Array[] | undefined = record ? [] : undefined;
  const snap = () => {
    const f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      f[i * 2] = on[i] ? x[i] : NaN;
      f[i * 2 + 1] = on[i] ? y[i] : NaN;
    }
    frames!.push(f);
  };
  if (frames) snap();

  const minX = -HALF_W + R;
  const maxX = HALF_W - R;
  const minY = -HALF_H + R;
  const maxY = HALF_H - R;

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

    // ball–ball (pairwise, fixed order)
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!on[j]) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R) continue;
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
        const overlap = 2 * R - d;
        x[i] -= nx * overlap * 0.5;
        y[i] -= ny * overlap * 0.5;
        x[j] += nx * overlap * 0.5;
        y[j] += ny * overlap * 0.5;
        const vn = (u[i] - u[j]) * nx + (v[i] - v[j]) * ny;
        if (vn <= 0) continue;
        const jn = ((1 + BALL_E) * vn) / 2;
        u[i] -= jn * nx;
        v[i] -= jn * ny;
        u[j] += jn * nx;
        v[j] += jn * ny;
        contacts.push({ step, a: balls[i].id, b: balls[j].id, impulse: jn, x: x[i] + nx * R, y: y[i] + ny * R });
        // follow / draw takes on the cue ball's first contact only
        if (!firstHit && (i === cueI || j === cueI)) {
          firstHit = true;
          const k = spin * FOLLOW_KICK * jn;
          u[cueI] += dirX * k;
          v[cueI] += dirY * k;
        }
      }
    }

    // cushions, pockets, friction
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      // pockets first: a ball in a pocket mouth never meets the cushion there
      let inMouth = false;
      if (pockets) {
        for (let p = 0; p < POCKETS.length; p++) {
          const pk = POCKETS[p];
          const ex = x[i] - pk.x;
          const ey = y[i] - pk.y;
          if (ex * ex + ey * ey < pk.r * pk.r) {
            on[i] = 0;
            pots.push({ id: balls[i].id, step, pocket: p, x: x[i], y: y[i], vx: u[i], vy: v[i] });
            break;
          }
          const jaw = pk.r + pk.mouth * 0.42;
          if (ex * ex + ey * ey < jaw * jaw) inMouth = true;
        }
        if (!on[i]) continue;
        // drifted past the rail line inside a mouth without being captured: it drops anyway
        if (inMouth && (x[i] > HALF_W + 0.2 || x[i] < -HALF_W - 0.2 || y[i] > HALF_H + 0.2 || y[i] < -HALF_H - 0.2)) {
          let best = 0;
          let bd = 1e9;
          for (let p = 0; p < POCKETS.length; p++) {
            const ex = x[i] - POCKETS[p].x;
            const ey = y[i] - POCKETS[p].y;
            const dd = ex * ex + ey * ey;
            if (dd < bd) {
              bd = dd;
              best = p;
            }
          }
          on[i] = 0;
          pots.push({ id: balls[i].id, step, pocket: best, x: x[i], y: y[i], vx: u[i], vy: v[i] });
          continue;
        }
      }
      if (!inMouth) {
        let hit = false;
        let nx = 0;
        let ny = 0;
        if (x[i] > maxX && u[i] > 0) {
          x[i] = maxX - (x[i] - maxX);
          nx = -1;
          hit = true;
        } else if (x[i] < minX && u[i] < 0) {
          x[i] = minX + (minX - x[i]);
          nx = 1;
          hit = true;
        }
        if (y[i] > maxY && v[i] > 0) {
          y[i] = maxY - (y[i] - maxY);
          ny = -1;
          hit = true;
        } else if (y[i] < minY && v[i] < 0) {
          y[i] = minY + (minY - y[i]);
          ny = 1;
          hit = true;
        }
        if (hit) {
          const sp = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
          const ddx = sp > 1e-9 ? u[i] / sp : 0;
          const ddy = sp > 1e-9 ? v[i] / sp : 0;
          let imp = 0;
          if (nx !== 0) {
            imp += u[i] < 0 ? -u[i] : u[i];
            u[i] = -u[i] * CUSHION_E;
            v[i] *= CUSHION_T;
          }
          if (ny !== 0) {
            imp += v[i] < 0 ? -v[i] : v[i];
            v[i] = -v[i] * CUSHION_E;
            u[i] *= CUSHION_T;
          }
          if (i === cueI && side !== 0) {
            // english: bend the rebound toward the shooter's right (side > 0) of the incoming line
            const k = side * SIDE_KICK * imp;
            u[i] += ddy * k;
            v[i] += -ddx * k;
            side *= 0.45;
          }
          rails.push({ step, id: balls[i].id, impulse: imp, x: x[i] - nx * R, y: y[i] - ny * R });
        }
        // safety clamp (a corner double-bounce can leave a ball a hair outside)
        if (x[i] > maxX) x[i] = maxX;
        if (x[i] < minX) x[i] = minX;
        if (y[i] > maxY) y[i] = maxY;
        if (y[i] < minY) y[i] = minY;
      }
      const s2 = u[i] * u[i] + v[i] * v[i];
      if (s2 > 0) {
        const s = Math.sqrt(s2);
        const ns = s - FRICTION * DT - s * DRAG * DT;
        if (ns <= STOP_SPEED) {
          u[i] = 0;
          v[i] = 0;
        } else {
          const k = ns / s;
          u[i] *= k;
          v[i] *= k;
        }
      }
    }
    if (frames && (step + 1) % FRAME_EVERY === 0) snap();
  }
  if (frames) snap();

  const rest: SimResult["rest"] = [];
  for (let i = 0; i < n; i++) if (on[i]) rest.push({ id: balls[i].id, x: x[i], y: y[i] });
  return { rest, pots, contacts, rails, steps: step, frames };
}

/** Rulebook §4 — power (0..1) to cue speed: 1.5 power curve so soft shots are fine-grained. */
export function speedForPower(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return V_MIN + (V_MAX - V_MIN) * Math.pow(p, 1.5);
}

export function powerForSpeed(speed: number): number {
  const k = (Math.max(V_MIN, Math.min(V_MAX, speed)) - V_MIN) / (V_MAX - V_MIN);
  return Math.pow(k, 1 / 1.5);
}

/** Distance a lone ball rolls from speed `s` (no cushions) — aim guide and bots. */
export function rollDistance(s: number): number {
  let d = 0;
  let sp = s;
  while (sp > STOP_SPEED) {
    d += sp * DT;
    sp = sp - FRICTION * DT - sp * DRAG * DT;
  }
  return d;
}

/**
 * First ball the cue ball would touch moving from its spot along unit
 * (dx, dy), or null. With the contact normal, for the ghost-ball guide.
 */
export function firstContact(balls: readonly SimBall[], cue: number, dx: number, dy: number): { id: number; t: number; cx: number; cy: number; nx: number; ny: number } | null {
  const me = balls.find((b) => b.id === cue);
  if (!me) return null;
  let best: { id: number; t: number; cx: number; cy: number; nx: number; ny: number } | null = null;
  for (const b of balls) {
    if (b.id === cue) continue;
    const ox = b.x - me.x;
    const oy = b.y - me.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp2 = ox * ox + oy * oy - along * along;
    if (perp2 >= 4 * R * R) continue;
    const t = along - Math.sqrt(4 * R * R - perp2);
    if (t < 0) continue;
    if (!best || t < best.t) {
      const cx = me.x + dx * t;
      const cy = me.y + dy * t;
      const nl = Math.sqrt((b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy)) || 1;
      best = { id: b.id, t, cx, cy, nx: (b.x - cx) / nl, ny: (b.y - cy) / nl };
    }
  }
  return best;
}

/** Distance along (dx, dy) from (x, y) to the cushion line the ball centre bounces on. */
export function railDistance(x: number, y: number, dx: number, dy: number): number {
  let t = 1e9;
  if (dx > 1e-9) t = Math.min(t, (HALF_W - R - x) / dx);
  if (dx < -1e-9) t = Math.min(t, (-HALF_W + R - x) / dx);
  if (dy > 1e-9) t = Math.min(t, (HALF_H - R - y) / dy);
  if (dy < -1e-9) t = Math.min(t, (-HALF_H + R - y) / dy);
  return Math.max(0, t);
}

/** True when a ball centred at (x, y) fits on the cloth without touching any of `balls`. */
export function spotFree(balls: readonly SimBall[], x: number, y: number, ignore = -1): boolean {
  if (x < -HALF_W + R || x > HALF_W - R || y < -HALF_H + R || y > HALF_H - R) return false;
  for (const b of balls) {
    if (b.id === ignore) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy < 4 * R * R * 1.0201) return false;
  }
  return true;
}
