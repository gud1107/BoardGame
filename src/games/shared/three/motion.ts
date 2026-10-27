/**
 * Procedural body language for the seated table characters (VrmPerson)
 * — pure math, no three.js, so it is unit-tested directly.
 *
 * Three layers, summed into one target per joint channel and then chased by a
 * damped spring (so every change of mood eases in with a little follow-through
 * instead of snapping or sliding linearly):
 *   1. the mood's key pose (POSES / the rig's overrides) + its hand pose (HANDS)
 *   2. a gesture layer: talking beat gestures, fist pumps, waving, finger taps …
 *      timed per seat so a table never moves in unison
 *   3. idle life: weight shifts, slow head drift and glances, breathing sway
 *
 * Channel layout (CH = 20):
 *   0-2 spine xyz · 3-5 head xyz · 6-8 left shoulder xyz · 9 left elbow
 *   10-12 right shoulder xyz · 13 right elbow
 *   14 left wrist flex (x) · 15 left wrist roll (z) · 16 right wrist flex · 17 right wrist roll
 *   18 left finger curl (0 open … 1 fist) · 19 right finger curl
 */

import type { PersonMood, Pose } from "./SeatedPerson";

export const CH = 20;
export const BODY = 14;

/** [lWristX, lWristZ, rWristX, rWristZ, lCurl, rCurl] */
export type HandPose = [number, number, number, number, number, number];

/** Resting hand per mood: relaxed half-curl by default; fists for cheering, flat open palms for shock/shrug/clap. */
export const HANDS: Record<PersonMood, HandPose> = {
  rest: [0.15, 0, 0.15, 0, 0.35, 0.35],
  think: [0.15, 0, 0.5, 0.2, 0.35, 0.75],
  talk: [0.15, 0, -0.15, -0.5, 0.35, 0.15],
  point: [0.15, 0, -0.1, 0, 0.4, 0.85],
  nervous: [0.3, 0.2, 0.3, -0.2, 0.6, 0.6],
  cheer: [0, 0, 0, 0, 1, 1],
  sad: [0.25, 0, 0.25, 0, 0.5, 0.5],
  shock: [-0.35, 0, -0.35, 0, 0.05, 0.05],
  laugh: [0.1, 0, 0.1, 0, 0.3, 0.3],
  smug: [0.1, 0, 0.1, 0, 0.55, 0.55],
  clap: [-0.1, 0.4, -0.1, -0.4, 0.05, 0.05],
  raise: [0.15, 0, -0.2, 0, 0.35, 0.05],
  write: [0.15, 0, 0.35, 0, 0.35, 0.8],
  shrug: [-0.3, 0.6, -0.3, -0.6, 0.05, 0.05],
  slump: [0.4, 0, 0.4, 0, 0.6, 0.6],
};

/** Hard joint limits the summed target is clamped to (also asserted in tests). */
export const LIMITS: [number, number][] = [
  [-0.6, 0.8], [-0.5, 0.5], [-0.4, 0.4], // spine
  [-0.7, 0.9], [-1.2, 1.2], [-0.6, 0.6], // head
  [-3.2, 0.6], [-1.2, 1.2], [-1.0, 1.0], [-2.6, 0.1], // left arm
  [-3.2, 0.6], [-1.2, 1.2], [-1.0, 1.0], [-2.6, 0.1], // right arm
  [-0.9, 0.9], [-1.0, 1.0], [-0.9, 0.9], [-1.0, 1.0], // wrists
  [0, 1], [0, 1], // fingers
];

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth 0→1→0 bump over u ∈ [0,1] (zero slope at both ends). */
const bump = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);
/** Cheap band-limited noise in −1…1: three incommensurate sines. */
const noise = (t: number, s: number) => (Math.sin(t * 0.73 + s * 1.7) + Math.sin(t * 1.37 + s * 4.1) * 0.6 + Math.sin(t * 2.11 + s * 2.3) * 0.3) / 1.9;

/**
 * Gesture + idle offsets for `mood` at time `t`, added into `out` (length CH).
 * `seed` desynchronises seats; deterministic for a given (mood, t, seed).
 */
export function gestureInto(out: number[], mood: PersonMood, t: number, seed: number): void {
  const s = seed * 0.913;
  // ── idle life, always on (smaller while acting) ──
  const calm = mood === "rest" || mood === "think" || mood === "write" ? 1 : 0.45;
  out[1] += noise(t * 0.5, s) * 0.06 * calm; // slow torso turn
  out[2] += noise(t * 0.35, s + 9) * 0.035 * calm; // weight shift side to side
  out[3] += noise(t * 0.6, s + 3) * 0.04 * calm;
  out[4] += noise(t * 0.45, s + 5) * 0.1 * calm;
  out[5] += noise(t * 0.4, s + 7) * 0.05 * calm;
  out[18] += noise(t * 0.9, s + 11) * 0.08;
  out[19] += noise(t * 0.9, s + 13) * 0.08;
  // an occasional glance away and back (a "saccade" of the whole head)
  const gSlot = Math.floor((t + s * 3) / 5.5);
  const gU = ((t + s * 3) % 5.5) / 1.1;
  if (hash(seed, gSlot + 101) < 0.45) out[4] += bump(gU) * (hash(seed, gSlot + 202) - 0.5) * 0.7 * calm;

  switch (mood) {
    case "rest": {
      // finger drumming on the table now and then
      const slot = Math.floor((t + s) / 6);
      if (hash(seed, slot + 7) < 0.5) {
        const u = ((t + s) % 6) / 2.2;
        if (u < 1) out[19] += Math.max(0, Math.sin(t * 16)) * 0.35 * bump(u);
      }
      break;
    }
    case "talk": {
      // beat gestures: each beat picks one move, eased in and out
      const period = 0.75 + hash(seed, 1) * 0.35;
      const k = Math.floor((t + s) / period);
      const u = ((t + s) % period) / period;
      const e = bump(u);
      const pick = hash(seed, k);
      if (pick < 0.35) {
        // right palm opens up toward the listeners
        out[10] -= 0.25 * e;
        out[13] += 0.35 * e;
        out[17] -= 0.5 * e;
        out[19] -= 0.15 * e;
      } else if (pick < 0.6) {
        // both hands open out, "you know?"
        out[7] -= 0.35 * e;
        out[11] += 0.35 * e;
        out[6] -= 0.2 * e;
        out[10] -= 0.2 * e;
        out[15] += 0.5 * e;
        out[17] -= 0.5 * e;
        out[18] -= 0.3 * e;
      } else if (pick < 0.8) {
        // a downward beat with the right hand + nod
        out[13] -= 0.25 * Math.sin(Math.PI * u * 2) * e;
        out[3] += 0.08 * e;
      } else {
        // left hand chimes in
        out[6] -= 0.45 * e;
        out[9] -= 0.6 * e;
        out[15] += 0.4 * e;
        out[18] -= 0.3 * e;
      }
      out[3] += Math.sin(t * 3.4 + s) * 0.035;
      break;
    }
    case "think": {
      out[5] += Math.sin(t * 0.8 + s) * 0.06;
      // tapping a finger against the chin
      out[19] += Math.max(0, Math.sin(t * 5 + s)) * 0.2;
      break;
    }
    case "nervous": {
      // hand wringing + quick glances
      const w = Math.sin(t * 6.5 + s);
      out[7] += w * 0.12;
      out[11] += w * 0.12;
      out[15] += w * 0.35;
      out[17] += w * 0.35;
      out[4] += Math.sin(t * 2.3 + s) * 0.18;
      break;
    }
    case "cheer": {
      // fist pumps, alternating arms
      out[9] += Math.abs(Math.sin(t * 6 + s)) * 0.5 - 0.25;
      out[13] += Math.abs(Math.sin(t * 6 + s + 1.4)) * 0.5 - 0.25;
      out[0] -= Math.abs(Math.sin(t * 6 + s)) * 0.05;
      break;
    }
    case "clap": {
      const c = Math.max(0, Math.sin(t * 12 + s));
      out[7] -= c * 0.16;
      out[11] += c * 0.16;
      break;
    }
    case "raise": {
      // waving the raised hand
      out[17] += Math.sin(t * 7 + s) * 0.55;
      out[12] += Math.sin(t * 7 + s) * 0.12;
      break;
    }
    case "laugh": {
      out[0] += Math.sin(t * 14 + s) * 0.035;
      out[3] += Math.sin(t * 14 + s) * 0.05;
      out[6] += Math.sin(t * 14 + s + 0.5) * 0.06;
      out[10] += Math.sin(t * 14 + s + 0.5) * 0.06;
      break;
    }
    case "write":
      out[17] += Math.sin(t * 12 + s) * 0.18;
      out[13] += Math.sin(t * 3 + s) * 0.06;
      break;
    case "shock":
      out[14] += Math.sin(t * 31 + s) * 0.04;
      out[16] += Math.sin(t * 29 + s) * 0.04;
      break;
    case "point":
      out[12] += Math.sin(t * 2.5 + s) * 0.03;
      break;
    case "shrug":
      out[5] += Math.sin(t * 1.2 + s) * 0.05;
      break;
    case "smug":
      out[4] += Math.sin(t * 0.7 + s) * 0.08;
      break;
    case "sad":
    case "slump":
      break;
  }
}

/** Damped spring state per channel. */
export interface MotionState {
  x: number[];
  v: number[];
  target: number[];
}

export function createMotion(pose: Pose, hands: HandPose): MotionState {
  const x = [...pose, ...hands];
  return { x, v: new Array(CH).fill(0), target: [...x] };
}

/** Stiffness per channel: head/hands a little quicker than the torso, which carries more weight. */
const OMEGA = [8, 8, 8, 11, 11, 11, 10.5, 10.5, 10.5, 11.5, 10.5, 10.5, 10.5, 11.5, 15, 15, 15, 15, 16, 16];
/** Slightly under-damped (ζ < 1) → a small, natural follow-through after a move. */
const ZETA = 0.72;

/**
 * Advances the rig one frame: builds the layered target for `mood` and lets every
 * channel spring toward it. `base` is the mood's key pose (14 body channels).
 * Returns `m.x` (length CH) for the rig to apply.
 */
export function stepMotion(m: MotionState, mood: PersonMood, base: Pose, t: number, dt: number, seed: number): number[] {
  const tg = m.target;
  for (let i = 0; i < BODY; i++) tg[i] = base[i];
  const h = HANDS[mood];
  for (let i = 0; i < 6; i++) tg[BODY + i] = h[i];
  gestureInto(tg, mood, t, seed);
  for (let i = 0; i < CH; i++) tg[i] = Math.min(LIMITS[i][1], Math.max(LIMITS[i][0], tg[i]));
  // sub-step so a long frame (tab refocus) can't blow the spring up
  let left = Math.min(dt, 0.25);
  while (left > 0) {
    const h2 = Math.min(left, 1 / 60);
    left -= h2;
    for (let i = 0; i < CH; i++) {
      const w = OMEGA[i];
      const a = w * w * (tg[i] - m.x[i]) - 2 * ZETA * w * m.v[i];
      m.v[i] += a * h2;
      m.x[i] += m.v[i] * h2;
    }
  }
  return m.x;
}
