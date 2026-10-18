import { seededRng } from "@/lib/rng";

/**
 * §5 손맛 — the local drag minigame that turns how you pulled into one
 * `quality` number (0..1) for the engine. Pure and frame-rate independent so
 * it can be unit-tested and reused by the 3D scene for live wobble.
 *
 * - The block follows your hand (slider 0..1) but never goes back in.
 * - Moving the hand faster than `safeSpeed` (progress / s) builds strain;
 *   going slowly or pausing lets it settle.
 * - At each catch point the block sticks for `hold` seconds — moving the
 *   hand on while it's stuck builds strain fast. Strain ≥ 1 = 덜컥 (jerk):
 *   done, quality ~0.
 */

export interface PullFeel {
  safeSpeed: number;
  catches: { at: number; hold: number }[];
}

export function pullFeel(difficulty: number, seed: number): PullFeel {
  const d = Math.max(0, Math.min(1, difficulty));
  const rng = seededRng(seed);
  const safeSpeed = 0.95 - 0.72 * d;
  const n = Math.max(0, Math.min(3, Math.floor(d * 3.4 + rng() * 0.9 - 0.25)));
  const catches: PullFeel["catches"] = [];
  for (let i = 0; i < n; i++) {
    // spread across the pull, never at the very start/end
    const lo = 0.14 + (i / n) * 0.72;
    const at = lo + rng() * (0.72 / n) * 0.8;
    catches.push({ at: Math.round(at * 100) / 100, hold: Math.round((0.4 + d * 0.5 + rng() * 0.3) * 100) / 100 });
  }
  return { safeSpeed, catches };
}

export const STRAIN_RATE = 0.7;
export const STRAIN_DECAY = 0.5;
/** Strain per unit of hand travel while the block is stuck. */
export const STUCK_STRAIN = 4;

export class PullTracker {
  progress = 0;
  strain = 0;
  maxStrain = 0;
  elapsed = 0;
  done = false;
  jerked = false;
  /** Seconds left stuck at the current catch (0 = moving). */
  stuckFor = 0;
  private hand = 0;
  private area = 0;
  private nextCatch = 0;

  constructor(readonly feel: PullFeel) {}

  get stuck(): boolean {
    return this.stuckFor > 0;
  }

  /**
   * `hand` = slider position 0..1, `dt` seconds since the last step. Strain
   * comes from how fast the HAND moves (yanking), not from where it is — so
   * stopping while stuck is always safe, and the block catches up once free.
   */
  step(hand: number, dt: number): void {
    if (this.done || dt <= 0) return;
    const h = Math.max(this.hand, Math.min(1, hand));
    // integrate in small slices so a slow frame doesn't skip a catch
    const slices = Math.max(1, Math.ceil(dt / 0.02));
    const sdt = dt / slices;
    const from = this.hand;
    for (let i = 0; i < slices && !this.done; i++) this.slice(from + (h - from) * ((i + 1) / slices), sdt);
  }

  private slice(target: number, dt: number): void {
    this.elapsed += dt;
    const handSpeed = (target - this.hand) / dt;
    this.hand = target;
    if (this.stuckFor > 0) {
      this.stuckFor = Math.max(0, this.stuckFor - dt);
      if (handSpeed > 0.02) this.strain += handSpeed * dt * STUCK_STRAIN;
      else this.strain = Math.max(0, this.strain - dt * STRAIN_DECAY * 0.5);
    } else {
      const over = handSpeed / this.feel.safeSpeed - 1;
      if (over > 0) this.strain += Math.min(over, 30) ** 1.5 * dt * STRAIN_RATE;
      else this.strain = Math.max(0, this.strain - dt * STRAIN_DECAY);
      this.progress = Math.max(this.progress, target);
      const c = this.feel.catches[this.nextCatch];
      if (c && this.progress >= c.at) {
        this.progress = c.at;
        this.stuckFor = c.hold;
        this.nextCatch++;
      }
    }
    this.maxStrain = Math.max(this.maxStrain, this.strain);
    this.area += this.strain * dt;
    if (this.strain >= 1) {
      this.strain = 1;
      this.maxStrain = 1;
      this.jerked = true;
      this.done = true;
    } else if (this.progress >= 1) {
      this.progress = 1;
      this.done = true;
    }
  }

  get avgStrain(): number {
    return this.elapsed > 0 ? this.area / this.elapsed : 0;
  }

  /** 0..1, rounded to 0.01 — what goes into the engine's `pull` action. */
  get quality(): number {
    const q = this.jerked ? 0.08 * this.progress : 1 - 0.55 * this.maxStrain - 0.45 * this.avgStrain;
    return Math.round(Math.max(0, Math.min(1, q)) * 100) / 100;
  }
}
