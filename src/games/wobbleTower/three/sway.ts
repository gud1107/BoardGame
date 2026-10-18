/**
 * Tower wobble model for the 3D scene (§13) — a 2-axis damped spring for the
 * tower's bend angle, driven by kicks (pulls, jerks, placements) and a slow
 * random "breathing" force that grows with how damaged the tower is.
 * Display only: the engine has already decided whether the tower falls.
 */

export interface SwayParams {
  /** 0..~1.5 from engine `instability()` — idle wobble amplitude. */
  fragility: number;
  /** Static lean target (rad) from the tower's center of mass. */
  leanX: number;
  leanZ: number;
}

const OMEGA = 2 * Math.PI * 1.35;
const ZETA = 0.065;

export class TowerSway {
  /** Bend angle (rad) at the top, around the z axis (x-lean) and x axis (z-lean). */
  ax = 0;
  az = 0;
  vx = 0;
  vz = 0;
  /** Smoothed random force (Ornstein–Uhlenbeck). */
  private fx = 0;
  private fz = 0;
  /** Short-lived high-frequency rattle amplitude (stuck block / jerk). */
  rattle = 0;

  constructor(private readonly rand: () => number = Math.random) {}

  kick(x: number, z: number): void {
    this.vx += x;
    this.vz += z;
  }

  addRattle(a: number): void {
    this.rattle = Math.min(1, this.rattle + a);
  }

  step(dt: number, p: SwayParams): void {
    const h = Math.min(dt, 0.05);
    const slices = Math.max(1, Math.ceil(h / 0.008));
    const s = h / slices;
    const noise = 0.0009 + 0.006 * Math.min(1.5, p.fragility) ** 1.5;
    for (let i = 0; i < slices; i++) {
      // unit-variance OU noise, independent of the slice length
      const kick = Math.sqrt(43.2 * s);
      this.fx += -this.fx * 1.8 * s + (this.rand() - 0.5) * kick;
      this.fz += -this.fz * 1.8 * s + (this.rand() - 0.5) * kick;
      const k = OMEGA * OMEGA;
      const c = 2 * ZETA * OMEGA;
      const axT = p.leanX;
      const azT = p.leanZ;
      this.vx += (-k * (this.ax - axT) - c * this.vx + this.fx * noise * k * 0.25) * s;
      this.vz += (-k * (this.az - azT) - c * this.vz + this.fz * noise * k * 0.25) * s;
      this.ax += this.vx * s;
      this.az += this.vz * s;
    }
    this.rattle = Math.max(0, this.rattle - h * 1.6);
  }

  /** Total visible motion (rad) — used for creak sounds / camera. */
  get energy(): number {
    return Math.hypot(this.ax, this.az) + Math.hypot(this.vx, this.vz) / OMEGA;
  }
}

/**
 * Bending profile: how far level `y` (world height) moves for top angle θ.
 * The base barely moves, the top swings most — a flexible column, not a hinge.
 */
export function bendOffset(theta: number, y: number, top: number): number {
  const r = top > 0 ? Math.max(0, y) / top : 0;
  return theta * y * (0.45 + 0.55 * r);
}

export function bendTilt(theta: number, y: number, top: number): number {
  const r = top > 0 ? Math.max(0, y) / top : 0;
  return theta * (0.45 + 1.1 * r);
}
