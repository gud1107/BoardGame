/** Tiny pure tween helpers for explainer scenes — every value is a function of time. */

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/** Eased 0→1 progress of `t` across [a, a+d]. */
export function prog(t: number, a: number, d = 0.6, ease: (x: number) => number = easeInOut): number {
  return ease(clamp01((t - a) / d));
}

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Point between two [x, y] positions. */
export function mix(a: readonly [number, number], b: readonly [number, number], p: number): [number, number] {
  return [lerp(a[0], b[0], p), lerp(a[1], b[1], p)];
}

/** A pop-in scale (0 → overshoot → 1) starting at `a`. */
export function pop(t: number, a: number, d = 0.45): number {
  const x = clamp01((t - a) / d);
  if (x <= 0) return 0;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Fade in at `a`, optionally fade out at `b`. */
export function fade(t: number, a: number, b = Infinity, d = 0.4): number {
  return Math.min(prog(t, a, d), 1 - prog(t, b, d));
}

/** 0..1 soft pulse, period in seconds. */
export const pulse = (t: number, period = 1.2) => 0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2);

/** Deterministic pseudo-random in [0,1) from an integer seed — for stable "random" layouts. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
