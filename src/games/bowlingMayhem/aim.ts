import { MAX_SLOPE, speedForPower } from "./physics";

/**
 * The bowler's current aim (rulebook §4): where on the foul line, which way,
 * how much hook, and — while the power meter runs — how hard. Shared between
 * the room (remote aims arrive over broadcast at ~10 Hz, purely cosmetic),
 * the HUD controls and the 3D scene, which reads it every frame.
 */
export interface LiveAim {
  turn: number;
  /** Release spot across the lane (m). */
  x: number;
  /** Sideways share of the release velocity (−MAX_SLOPE..MAX_SLOPE). */
  slope: number;
  /** −1..1 hook (+ right). */
  spin: number;
  /** 0..1 while the meter is held, −1 when not charging. */
  power: number;
  /** performance.now() of the last update. */
  at: number;
  remote?: boolean;
}

/** Release velocity for an aim at a given meter power. */
export function releaseFor(a: Pick<LiveAim, "x" | "slope" | "spin">, power: number): { x: number; vx: number; vy: number; spin: number } {
  const vy = speedForPower(power);
  const slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, a.slope));
  return { x: a.x, vx: slope * vy, vy, spin: a.spin };
}

/** Lane boards are numbered 1..39 from the right edge (as bowlers count them). */
export function boardOf(x: number): number {
  return Math.max(1, Math.min(39, Math.round(20 - x / (1.054 / 39))));
}

/** Release slope as degrees (for the HUD). */
export function slopeDegrees(slope: number): number {
  return (Math.atan(slope) * 180) / Math.PI;
}

/** Power meter: ping-pongs 0→1→0 every `period` ms while held. */
export function meterAt(heldMs: number, period = 1500): number {
  const u = (heldMs % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}
