/**
 * Small involuntary motions that make a VRM read as a person rather than a posed doll
 * — pure math (no three.js), unit-tested in vrmLife.test.ts.
 *
 * - {@link blinkAmount}: a real eyelid curve (fast close, brief hold, slower open) at
 *   irregular 2–6 s intervals with the odd double blink, instead of an on/off flag.
 * - {@link saccade}: the eyes hop between nearby fixation points every 0.4–2.2 s and
 *   hold still in between, like eyes do — never a smooth drift.
 * - {@link breath}: a slow breathing cycle per seat (≈ 13–17 breaths a minute),
 *   quicker and deeper when the character is worked up.
 * - {@link mouthShape}: talking as syllables — a vowel shape per beat with short
 *   pauses between phrases — instead of one jaw flapping on a sine.
 * - {@link GazeSpring}: the head chases its gaze target on a slightly under-damped
 *   spring (a hint of overshoot and settle), while the eyes jump ahead to the target.
 */

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** How closed the eyes are at `t` (0 open … 1 shut). Deterministic per seat. */
export function blinkAmount(t: number, seed: number): number {
  const T = t + seed * 1.37;
  // irregular slots: each 4 s window holds one blink at a hashed moment (≈ 2–6 s apart)
  const slot = Math.floor(T / 4);
  let best = 0;
  // the previous slot's blink can still be finishing as this one starts
  for (const k of [slot - 1, slot]) {
    const at = k * 4 + 0.3 + hash(seed, k + 31) * 3.2;
    best = Math.max(best, lid(T - at));
    if (hash(seed, k + 57) < 0.18) best = Math.max(best, lid(T - at - 0.32));
  }
  return best;
}

/** One blink's lid curve over time since it began: 70 ms close, 30 ms hold, 150 ms open. */
function lid(u: number): number {
  if (u < 0 || u > 0.25) return 0;
  if (u < 0.07) return smooth(u / 0.07);
  if (u < 0.1) return 1;
  return 1 - smooth((u - 0.1) / 0.15);
}

/**
 * Small fixation jumps of the eyes, in degrees [yaw, pitch]: each fixation holds for
 * 0.4–2.2 s, then the eyes move to the next one within ~40 ms. `spread` scales it
 * (bigger when the character is idle and looking around, smaller when focused).
 */
export function saccade(t: number, seed: number, spread = 1): [number, number] {
  const T = t + seed * 2.9;
  // variable-length fixations: walk a hashed sequence of durations
  const block = Math.floor(T / 8);
  let start = block * 8;
  let i = 0;
  let dur = 0.4 + hash(seed, block * 16) * 1.8;
  while (start + dur < T && i < 30) {
    start += dur;
    i++;
    dur = 0.4 + hash(seed, block * 16 + i) * 1.8;
  }
  const fix = (n: number): [number, number] => [(hash(seed + 3, block * 40 + n) - 0.5) * 7 * spread, (hash(seed + 7, block * 40 + n) - 0.5) * 3.6 * spread];
  const cur = fix(i);
  if (i === 0) return cur;
  // the jump into this fixation
  const k = smooth((T - start) / 0.04);
  if (k >= 1) return cur;
  const prev = fix(i - 1);
  return [prev[0] + (cur[0] - prev[0]) * k, prev[1] + (cur[1] - prev[1]) * k];
}

/** Breathing at `t`: −1…1 (inhale positive), and how deep it is (0.6 calm … 1.6 worked up). */
export function breath(t: number, seed: number, excited: boolean): number {
  const rate = (0.22 + hash(seed, 5) * 0.07) * (excited ? 1.7 : 1);
  const ph = t * rate * Math.PI * 2 + seed * 1.3;
  // inhale a little quicker than the exhale
  return (Math.sin(ph) + Math.sin(ph * 2 - 0.5) * 0.18) * (excited ? 1.6 : 0.6 + hash(seed, 9) * 0.2);
}

export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh";
const VOWELS: readonly Viseme[] = ["aa", "ih", "ou", "ee", "oh", "aa", "oh"];

/**
 * The mouth while talking: one vowel per syllable (0.09–0.16 s), opening and closing
 * through it, with a breath pause after every few syllables. Returns the vowel and
 * how open it is (0…1).
 */
export function mouthShape(t: number, seed: number): { v: Viseme; open: number } {
  const syl = 0.09 + hash(seed, 2) * 0.07;
  const T = t + seed * 0.71;
  const n = Math.floor(T / syl);
  // every 11 syllables: a phrase of 6–9, then the rest is a pause for breath
  const phrase = 6 + Math.floor(hash(seed, Math.floor(n / 11)) * 4);
  if (n % 11 >= phrase) return { v: "aa", open: 0 };
  const u = T / syl - n;
  return { v: VOWELS[Math.floor(hash(seed, n) * VOWELS.length)], open: (0.35 + hash(seed + 1, n) * 0.55) * Math.sin(Math.PI * u) };
}

/** A two-axis damped spring for the head's gaze (yaw, pitch). Slightly under-damped → a small, natural settle. */
export class GazeSpring {
  x: [number, number] = [0, 0];
  v: [number, number] = [0, 0];
  step(target: [number, number], dt: number, omega: number, zeta = 0.78): [number, number] {
    let left = Math.min(dt, 0.25);
    while (left > 0) {
      const h = Math.min(left, 1 / 60);
      left -= h;
      for (let i = 0; i < 2; i++) {
        const a = omega * omega * (target[i] - this.x[i]) - 2 * zeta * omega * this.v[i];
        this.v[i] += a * h;
        this.x[i] += this.v[i] * h;
      }
    }
    return this.x;
  }
}
