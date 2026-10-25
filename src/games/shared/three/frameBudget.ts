/**
 * Wall-clock frame-rate sampling for the 3D quality steppers (AdaptiveResolution, PostFx) —
 * pure math, no three.js, so it is unit-tested directly.
 *
 * Windows are measured in seconds, not frames: a frame-count window (the first version used
 * 60 warm-up + 90 sampled frames) takes ~50 s to decide on a 3 fps phone, so exactly the
 * devices that needed the step-down never got it during the opening seconds.
 */

/** A single frame this long is a stall (shader compile, env-map bake, tab switch), not steady load. */
const STALL = 0.5;

export class FpsWindow {
  private start = -1;
  private winStart = -1;
  private frames = 0;

  /** `warm` s ignored after the first frame (and after `reset`), then `span` s per reading. */
  constructor(
    private warm = 1,
    private span = 1.2,
  ) {}

  /** Feed once per frame (`now` and `delta` in seconds); returns the window's fps when one completes. */
  tick(now: number, delta: number): number | null {
    if (this.start < 0) this.start = now;
    if (now - this.start < this.warm) return null;
    if (this.winStart < 0 || delta > STALL) {
      // a stall says nothing about how expensive a frame is — start the window over
      this.winStart = now;
      this.frames = 0;
      return null;
    }
    this.frames++;
    const elapsed = now - this.winStart;
    if (elapsed < this.span || this.frames < 3) return null;
    const fps = this.frames / elapsed;
    this.winStart = now;
    this.frames = 0;
    return fps;
  }

  /** After a quality change the next frames are atypical (realloc, recompile): warm up again. */
  reset(now: number, warm = 0.5) {
    this.start = now;
    this.warm = warm;
    this.winStart = -1;
    this.frames = 0;
  }
}

/**
 * Pixel ratio to switch to after a window at `fps`. Fill cost goes with dpr², so jump straight
 * to the ratio that should reach `target` (rounded down to 0.25) instead of creeping 0.25 per
 * window. Never raises; returns `cur` when the frame rate is already fine.
 */
export function nextDpr(cur: number, fps: number, target = 50, min = 1): number {
  if (fps >= target * 0.9 || cur <= min) return cur;
  const fit = Math.floor(cur * Math.sqrt(fps / target) * 4) / 4;
  return Math.max(min, Math.min(cur - 0.25, fit));
}
