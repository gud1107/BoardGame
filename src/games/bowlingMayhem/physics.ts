/**
 * Deterministic bowling physics for 볼링 난장판 (rulebook §6).
 *
 * Every client re-runs the same roll from the same integers and must land on
 * the same pinfall, so the step uses only + − × ÷ and Math.sqrt (correctly
 * rounded everywhere) — no trig, no Math.random, fixed dt, fixed loop order.
 * Only the release (position, velocity, spin) crosses the network.
 *
 * Top-down 2D model, metres and seconds. x = across the lane (− left, + right,
 * seen from the bowler), y = down the lane (0 = foul line, the head pin at
 * HEAD_Y). The ball skids, then hooks by its spin in the back end; a pin
 * stands still until a hit pushes it faster than its topple speed, then it
 * tumbles across the deck, off the kickback walls and into the pit, taking
 * other pins with it.
 */

export const LANE_W = 1.054;
export const HALF_W = LANE_W / 2;
export const GUTTER_W = 0.235;
/** Kickback walls either side of the pin deck (outer gutter edge). */
export const WALL_X = HALF_W + GUTTER_W;
export const HEAD_Y = 18.29;
export const PIN_SPACING = 0.3048;
export const ROW_DY = 0.264;
/** Past this the ball / a pin drops into the pit. */
export const PIT_Y = HEAD_Y + 3 * ROW_DY + 0.62;
/** Kickback walls start a little before the head pin. */
export const DECK_Y = HEAD_Y - 0.9;
export const LANE_END = PIT_Y;

export const BALL_R = 0.109;
export const BALL_M = 7;
export const PIN_R = 0.06;
export const PIN_M = 1.5;
/** A pin pushed faster than this (m/s) goes down. */
export const TOPPLE = 0.42;

/** Release speeds (m/s) the power meter spans. */
export const V_MIN = 5;
export const V_MAX = 9.5;
/** Largest release angle either way, as the lateral share of the velocity (≈ ±5.7°). */
export const MAX_SLOPE = 0.1;

export const DT = 1 / 240;
const MAX_STEPS = 240 * 10;
/** Ball rolling resistance (m/s²). */
const BALL_FRICTION = 0.22;
/** Lateral hook acceleration at full spin, once fully in the back end (m/s²). */
export const HOOK = 1.15;
/** The ball skids straight until here, then the hook ramps in over HOOK_RAMP metres. */
export const SKID_Y = 7;
export const HOOK_RAMP = 5;
const PIN_FRICTION = 5.5;
const PIN_DRAG = 1.4;
const E_BALL_PIN = 0.6;
const E_PIN_PIN = 0.55;
const E_WALL = 0.5;
const E_BUMPER = 0.55;
const E_CONE = 0.45;
const STOP_SPEED = 0.05;
/** Recorded frames keep every Nth step (240 Hz / 4 = 60 Hz). */
export const FRAME_EVERY = 4;

/** Everything the lane modifiers / hazards can change for one roll (§7, §8). */
export interface LaneSetup {
  /** Standing pins, in id order. */
  pins: { id: number; x: number; y: number }[];
  ballR: number;
  ballM: number;
  pinR: number;
  pinM: number;
  topple: number;
  ballFriction: number;
  pinFriction: number;
  hookMul: number;
  /** Constant sideways push on the ball (m/s², + = right). */
  wind: number;
  bumpers: boolean;
  cones: { x: number; y: number; r: number }[];
  /** Hook runs the wrong way inside this stretch. */
  oil: { y0: number; y1: number } | null;
}

export function defaultSetup(pins: LaneSetup["pins"]): LaneSetup {
  return {
    pins,
    ballR: BALL_R,
    ballM: BALL_M,
    pinR: PIN_R,
    pinM: PIN_M,
    topple: TOPPLE,
    ballFriction: BALL_FRICTION,
    pinFriction: PIN_FRICTION,
    hookMul: 1,
    wind: 0,
    bumpers: false,
    cones: [],
    oil: null,
  };
}

export interface RollInput {
  /** Release position across the lane (m). */
  x: number;
  vx: number;
  vy: number;
  /** −1..1 — + hooks right, − hooks left. */
  spin: number;
}

export type SimEventKind = "pin" | "pinPin" | "wall" | "gutter" | "bumper" | "cone" | "pit";

export interface SimEvent {
  step: number;
  kind: SimEventKind;
  /** Pin id (pin / pinPin / wall), −1 for the ball. */
  a: number;
  b: number;
  impulse: number;
  x: number;
  y: number;
}

export interface SimResult {
  /** Ids of pins that went down, in the order they fell. */
  down: number[];
  /** Step each pin went down (same order as `down`). */
  downStep: number[];
  /** The ball dropped into a gutter (and where). */
  gutterStep: number | null;
  /** The ball's lateral position where it reached the pins (null = never got there). */
  entryX: number | null;
  steps: number;
  /**
   * Only with `record`: per kept frame, [ballX, ballY, ballGutter(0/1), then x, y, state per pin]
   * (pin state: 0 standing, 1 down on the deck, 2 in the pit / gutter).
   */
  frames?: Float32Array[];
  events?: SimEvent[];
}

/**
 * Runs one roll to rest. `setup.pins` are the standing pins; the ball starts on
 * the foul line at `input.x`. The input is not mutated.
 */
export function simulate(setup: LaneSetup, input: RollInput, record = false): SimResult {
  const n = setup.pins.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pu = new Float64Array(n);
  const pv = new Float64Array(n);
  /** 0 standing, 1 down + moving on the deck, 2 gone (pit / gutter), 3 down + resting. */
  const st = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = setup.pins[i].x;
    py[i] = setup.pins[i].y;
  }
  const rb = setup.ballR;
  const mb = setup.ballM;
  const rp = setup.pinR;
  const mp = setup.pinM;
  let bx = Math.max(-(HALF_W - rb), Math.min(HALF_W - rb, input.x));
  let by = 0;
  let bu = input.vx;
  let bv = input.vy;
  let gutter = false;
  let ballGone = false;
  let entryX: number | null = null;
  let gutterStep: number | null = null;
  const spin = Math.max(-1, Math.min(1, input.spin));
  const down: number[] = [];
  const downStep: number[] = [];
  const frames: Float32Array[] | undefined = record ? [] : undefined;
  const events: SimEvent[] | undefined = record ? [] : undefined;

  const snap = () => {
    const f = new Float32Array(3 + n * 3);
    f[0] = bx;
    f[1] = by;
    f[2] = ballGone ? 2 : gutter ? 1 : 0;
    for (let i = 0; i < n; i++) {
      f[3 + i * 3] = px[i];
      f[4 + i * 3] = py[i];
      f[5 + i * 3] = st[i] === 0 ? 0 : st[i] === 2 ? 2 : 1;
    }
    frames!.push(f);
  };
  if (frames) snap();

  const knock = (i: number, step: number) => {
    if (st[i] !== 0) return;
    st[i] = 1;
    down.push(setup.pins[i].id);
    downStep.push(step);
  };

  let step = 0;
  for (; step < MAX_STEPS; step++) {
    // ---- ball
    if (!ballGone) {
      const s2 = bu * bu + bv * bv;
      if (s2 > 0) {
        const s = Math.sqrt(s2);
        const ns = s - setup.ballFriction * DT;
        if (ns <= STOP_SPEED) {
          bu = 0;
          bv = 0;
        } else {
          bu *= ns / s;
          bv *= ns / s;
        }
      }
      if (!gutter) {
        // hook: ramps in after the skid, the wrong way across an oil slick
        let ramp = (by - SKID_Y) / HOOK_RAMP;
        ramp = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp;
        let hook = spin * HOOK * setup.hookMul * ramp;
        if (setup.oil && by >= setup.oil.y0 && by <= setup.oil.y1) hook = -spin * HOOK * 1.4;
        bu += (hook + setup.wind) * DT;
      }
      bx += bu * DT;
      by += bv * DT;
      if (!gutter) {
        if (setup.bumpers) {
          const lim = HALF_W - rb;
          if (bx > lim && bu > 0) {
            bx = lim;
            bu = -bu * E_BUMPER;
            events?.push({ step, kind: "bumper", a: -1, b: 1, impulse: Math.abs(bu), x: bx + rb, y: by });
          } else if (bx < -lim && bu < 0) {
            bx = -lim;
            bu = -bu * E_BUMPER;
            events?.push({ step, kind: "bumper", a: -1, b: -1, impulse: Math.abs(bu), x: bx - rb, y: by });
          }
        } else if (bx > HALF_W || bx < -HALF_W) {
          // centre over the edge: into the gutter, rolls straight down it to the pit
          gutter = true;
          gutterStep = step;
          bx = bx > 0 ? HALF_W + GUTTER_W / 2 : -(HALF_W + GUTTER_W / 2);
          bu = 0;
          events?.push({ step, kind: "gutter", a: -1, b: bx > 0 ? 1 : -1, impulse: 0, x: bx, y: by });
        }
      }
      if (entryX === null && !gutter && by >= HEAD_Y - 0.4) entryX = bx;
      if (by > PIT_Y) {
        ballGone = true;
        events?.push({ step, kind: "pit", a: -1, b: 0, impulse: 0, x: bx, y: by });
      }
      if (!gutter && !ballGone) {
        // cones (static) on the lane
        for (const c of setup.cones) {
          const dx = bx - c.x;
          const dy = by - c.y;
          const rr = rb + c.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          bx = c.x + nx * rr;
          by = c.y + ny * rr;
          const vn = bu * nx + bv * ny;
          if (vn < 0) {
            bu -= (1 + E_CONE) * vn * nx;
            bv -= (1 + E_CONE) * vn * ny;
            events?.push({ step, kind: "cone", a: -1, b: 0, impulse: -vn, x: c.x, y: c.y });
          }
        }
      }
    }

    // ---- pins in motion
    for (let i = 0; i < n; i++) {
      if (st[i] !== 1) continue;
      const s2 = pu[i] * pu[i] + pv[i] * pv[i];
      if (s2 > 0) {
        const s = Math.sqrt(s2);
        const ns = s - setup.pinFriction * DT - s * PIN_DRAG * DT;
        if (ns <= STOP_SPEED) {
          pu[i] = 0;
          pv[i] = 0;
          st[i] = 3;
          continue;
        }
        pu[i] *= ns / s;
        pv[i] *= ns / s;
      }
      px[i] += pu[i] * DT;
      py[i] += pv[i] * DT;
      if (py[i] > PIT_Y) {
        st[i] = 2;
        events?.push({ step, kind: "pit", a: setup.pins[i].id, b: 0, impulse: 0, x: px[i], y: py[i] });
        continue;
      }
      // kickback walls on the deck; before the deck a pin just slides into the gutter
      if (py[i] >= DECK_Y) {
        const lim = WALL_X - rp;
        if (px[i] > lim && pu[i] > 0) {
          px[i] = lim;
          pu[i] = -pu[i] * E_WALL;
          events?.push({ step, kind: "wall", a: setup.pins[i].id, b: 1, impulse: Math.abs(pu[i]), x: WALL_X, y: py[i] });
        } else if (px[i] < -lim && pu[i] < 0) {
          px[i] = -lim;
          pu[i] = -pu[i] * E_WALL;
          events?.push({ step, kind: "wall", a: setup.pins[i].id, b: -1, impulse: Math.abs(pu[i]), x: -WALL_X, y: py[i] });
        }
      } else if (px[i] > HALF_W || px[i] < -HALF_W) {
        st[i] = 2;
      }
    }

    // ---- ball vs pins (only on the lane, never from the gutter)
    if (!gutter && !ballGone) {
      for (let i = 0; i < n; i++) {
        if (st[i] === 2) continue;
        const dx = px[i] - bx;
        const dy = py[i] - by;
        const rr = rb + rp;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        const nx = d < 1e-9 ? 0 : dx / d;
        const ny = d < 1e-9 ? 1 : dy / d;
        const vn = (bu - pu[i]) * nx + (bv - pv[i]) * ny;
        const overlap = rr - d;
        if (vn > 0) {
          const jn = ((1 + E_BALL_PIN) * vn) / (1 / mb + 1 / mp);
          const nu = pu[i] + (jn / mp) * nx;
          const nv = pv[i] + (jn / mp) * ny;
          if (st[i] === 0 && nu * nu + nv * nv < setup.topple * setup.topple) {
            // a nudge the pin shrugs off: it stays put, the ball glances off it
            bu -= ((1 + E_BALL_PIN) * vn * nx) / 2;
            bv -= ((1 + E_BALL_PIN) * vn * ny) / 2;
          } else {
            bu -= (jn / mb) * nx;
            bv -= (jn / mb) * ny;
            pu[i] = nu;
            pv[i] = nv;
            if (st[i] === 0) knock(i, step);
            else st[i] = 1;
          }
          events?.push({ step, kind: "pin", a: setup.pins[i].id, b: -1, impulse: jn, x: bx + nx * rb, y: by + ny * rb });
        }
        if (st[i] === 0) {
          bx -= nx * overlap;
          by -= ny * overlap;
        } else {
          const inv = 1 / mb + 1 / mp;
          bx -= (nx * overlap) / mb / inv;
          by -= (ny * overlap) / mb / inv;
          px[i] += (nx * overlap) / mp / inv;
          py[i] += (ny * overlap) / mp / inv;
        }
      }
    }

    // ---- pin vs pin (a moving pin can take a standing one down)
    for (let i = 0; i < n; i++) {
      if (st[i] === 2) continue;
      for (let j = i + 1; j < n; j++) {
        if (st[j] === 2) continue;
        const si = st[i];
        const sj = st[j];
        if (si !== 1 && sj !== 1) continue;
        const dx = px[j] - px[i];
        const dy = py[j] - py[i];
        const rr = 2 * rp;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        const nx = d < 1e-9 ? 1 : dx / d;
        const ny = d < 1e-9 ? 0 : dy / d;
        const overlap = rr - d;
        const vn = (pu[i] - pu[j]) * nx + (pv[i] - pv[j]) * ny;
        if (vn > 0) {
          const jn = ((1 + E_PIN_PIN) * vn) / (2 / mp);
          const iu = pu[i] - (jn / mp) * nx;
          const iv = pv[i] - (jn / mp) * ny;
          const ju = pu[j] + (jn / mp) * nx;
          const jv = pv[j] + (jn / mp) * ny;
          const tt = setup.topple * setup.topple;
          if (si === 0 && iu * iu + iv * iv < tt) {
            // i holds: j bounces straight back off it
            pu[j] += (1 + E_PIN_PIN) * vn * nx;
            pv[j] += (1 + E_PIN_PIN) * vn * ny;
          } else if (sj === 0 && ju * ju + jv * jv < tt) {
            pu[i] -= (1 + E_PIN_PIN) * vn * nx;
            pv[i] -= (1 + E_PIN_PIN) * vn * ny;
          } else {
            pu[i] = iu;
            pv[i] = iv;
            pu[j] = ju;
            pv[j] = jv;
            if (si === 0) knock(i, step);
            if (sj === 0) knock(j, step);
            if (st[i] === 3) st[i] = 1;
            if (st[j] === 3) st[j] = 1;
          }
          events?.push({ step, kind: "pinPin", a: setup.pins[i].id, b: setup.pins[j].id, impulse: jn, x: px[i] + nx * rp, y: py[i] + ny * rp });
        }
        // the standing one never moves; otherwise split the overlap
        if (st[i] === 0) {
          px[j] += nx * overlap;
          py[j] += ny * overlap;
        } else if (st[j] === 0) {
          px[i] -= nx * overlap;
          py[i] -= ny * overlap;
        } else {
          px[i] -= (nx * overlap) / 2;
          py[i] -= (ny * overlap) / 2;
          px[j] += (nx * overlap) / 2;
          py[j] += (ny * overlap) / 2;
        }
      }
    }

    // pins vs cones (cones only sit mid-lane, but a pin can skid back that far)
    for (const c of setup.cones) {
      for (let i = 0; i < n; i++) {
        if (st[i] !== 1) continue;
        const dx = px[i] - c.x;
        const dy = py[i] - c.y;
        const rr = rp + c.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        px[i] = c.x + nx * rr;
        py[i] = c.y + ny * rr;
        const vn = pu[i] * nx + pv[i] * ny;
        if (vn < 0) {
          pu[i] -= (1 + E_CONE) * vn * nx;
          pv[i] -= (1 + E_CONE) * vn * ny;
        }
      }
    }

    if (frames && (step + 1) % FRAME_EVERY === 0) snap();

    // done once the ball is gone (or stopped) and nothing on the deck still moves
    const ballDone = ballGone || (bu === 0 && bv === 0);
    if (ballDone) {
      let moving = false;
      for (let i = 0; i < n; i++) if (st[i] === 1) moving = true;
      if (!moving) break;
    }
  }
  if (frames) snap();
  return { down, downStep, gutterStep, entryX, steps: step, frames, events };
}

/**
 * Where a ball rolling alone ends up across the lane by `yTarget` (no pins) —
 * for aim guides and the bot's aiming. Returns the x and whether it guttered.
 */
export function ballPathX(setup: Pick<LaneSetup, "ballR" | "ballFriction" | "hookMul" | "wind" | "bumpers" | "oil">, input: RollInput, yTarget: number): { x: number; gutter: boolean } {
  const rb = setup.ballR;
  let bx = Math.max(-(HALF_W - rb), Math.min(HALF_W - rb, input.x));
  let by = 0;
  let bu = input.vx;
  let bv = input.vy;
  const spin = Math.max(-1, Math.min(1, input.spin));
  for (let step = 0; step < MAX_STEPS && by < yTarget; step++) {
    const s = Math.sqrt(bu * bu + bv * bv);
    const ns = s - setup.ballFriction * DT;
    if (ns <= STOP_SPEED) return { x: bx, gutter: false };
    bu *= ns / s;
    bv *= ns / s;
    let ramp = (by - SKID_Y) / HOOK_RAMP;
    ramp = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp;
    let hook = spin * HOOK * setup.hookMul * ramp;
    if (setup.oil && by >= setup.oil.y0 && by <= setup.oil.y1) hook = -spin * HOOK * 1.4;
    bu += (hook + setup.wind) * DT;
    bx += bu * DT;
    by += bv * DT;
    if (setup.bumpers) {
      const lim = HALF_W - rb;
      if (bx > lim && bu > 0) {
        bx = lim;
        bu = -bu * E_BUMPER;
      } else if (bx < -lim && bu < 0) {
        bx = -lim;
        bu = -bu * E_BUMPER;
      }
    } else if (bx > HALF_W || bx < -HALF_W) return { x: bx, gutter: true };
  }
  return { x: bx, gutter: false };
}

/** Sampled ball path (no pins) for drawing the aim guide: [x, y] pairs every `every` metres up to `yMax`. */
export function ballPathPoints(setup: Pick<LaneSetup, "ballR" | "ballFriction" | "hookMul" | "wind" | "bumpers" | "oil">, input: RollInput, yMax: number, every = 0.5): [number, number][] {
  const out: [number, number][] = [];
  const rb = setup.ballR;
  let bx = Math.max(-(HALF_W - rb), Math.min(HALF_W - rb, input.x));
  let by = 0;
  let bu = input.vx;
  let bv = input.vy;
  let next = 0;
  const spin = Math.max(-1, Math.min(1, input.spin));
  for (let step = 0; step < MAX_STEPS && by < yMax; step++) {
    if (by >= next) {
      out.push([bx, by]);
      next += every;
    }
    const s = Math.sqrt(bu * bu + bv * bv);
    const ns = s - setup.ballFriction * DT;
    if (ns <= STOP_SPEED) break;
    bu *= ns / s;
    bv *= ns / s;
    let ramp = (by - SKID_Y) / HOOK_RAMP;
    ramp = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp;
    let hook = spin * HOOK * setup.hookMul * ramp;
    if (setup.oil && by >= setup.oil.y0 && by <= setup.oil.y1) hook = -spin * HOOK * 1.4;
    bu += (hook + setup.wind) * DT;
    bx += bu * DT;
    by += bv * DT;
    if (setup.bumpers) {
      const lim = HALF_W - rb;
      if (bx > lim && bu > 0) {
        bx = lim;
        bu = -bu * E_BUMPER;
      } else if (bx < -lim && bu < 0) {
        bx = -lim;
        bu = -bu * E_BUMPER;
      }
    } else if (bx > HALF_W || bx < -HALF_W) {
      out.push([bx, by]);
      break;
    }
  }
  out.push([bx, by]);
  return out;
}

/** Power meter (0..1) → release speed (m/s). */
export function speedForPower(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return V_MIN + (V_MAX - V_MIN) * p;
}

export function powerForSpeed(speed: number): number {
  return Math.max(0, Math.min(1, (speed - V_MIN) / (V_MAX - V_MIN)));
}

/** Standard rack (§3): pin id 0..9 = pins 1..10, left = −x as the bowler sees it. */
export const RACK: readonly { id: number; x: number; y: number }[] = (() => {
  const rows = [[0], [1, 2], [3, 4, 5], [6, 7, 8, 9]];
  const out: { id: number; x: number; y: number }[] = [];
  rows.forEach((row, r) => {
    row.forEach((id, k) => {
      out.push({ id, x: (k - (row.length - 1) / 2) * PIN_SPACING, y: HEAD_Y + r * ROW_DY });
    });
  });
  return out.sort((a, b) => a.id - b.id);
})();

/** Pins next to each other in the rack (for split detection, §5). */
export function rackNeighbours(a: number, b: number): boolean {
  const pa = RACK[a];
  const pb = RACK[b];
  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
  return d < PIN_SPACING * 1.05;
}
