import { speedForPower } from "./physics";

/**
 * The shooter's current aim (rulebook §5): a direction and — while it's
 * being set — a power. Shared between the room (remote aims arrive over
 * broadcast at ~10 Hz, purely cosmetic), the HUD controls and the 3D scene,
 * which reads it every frame.
 */
export interface LiveAim {
  turn: number;
  /** Direction on the course (rad; 0 = +x, π/2 = up the course). */
  ang: number;
  /** 0..1 */
  power: number;
  /** The player is dragging the slingshot right now. */
  dragging: boolean;
  /** performance.now() of the last update. */
  at: number;
  remote?: boolean;
}

/** Shot velocity (m/s) for an aim. */
export function velocityFor(ang: number, power: number): { vx: number; vy: number } {
  const s = speedForPower(power);
  return { vx: Math.cos(ang) * s, vy: Math.sin(ang) * s };
}

/** Compass-ish label for the HUD: degrees left/right of "straight up the course". */
export function aimLabel(ang: number): string {
  let d = ((ang - Math.PI / 2) * 180) / Math.PI;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(d) < 0.5) return "정면";
  return d > 0 ? `왼쪽 ${d.toFixed(0)}°` : `오른쪽 ${(-d).toFixed(0)}°`;
}

/** Power meter: ping-pongs 0→1→0 every `period` ms while held. */
export function meterAt(heldMs: number, period = 2200): number {
  const u = (heldMs % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

export function normAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
