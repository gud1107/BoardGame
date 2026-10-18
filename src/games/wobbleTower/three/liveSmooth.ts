/**
 * Smooths someone else's live drag (rulebook §11) for display. Remote
 * samples arrive ~11 times a second with network jitter, so drawing them
 * raw makes the block step and stall. Between packets this eases toward the
 * newest sample and, when the next one is late, keeps the block moving at
 * the last measured speed for a short while (never past where it can be,
 * never backwards — a pulled block doesn't go back in).
 */

export interface LiveSample {
  turn: number;
  level: number;
  slot: number;
  progress: number;
  hand: number;
  strain: number;
  stuck: boolean;
  /** Local receipt time (performance.now ms). */
  at: number;
}

export interface Shown {
  progress: number;
  hand: number;
  strain: number;
}

/** How far ahead of the last sample we dare to guess (s). */
export const MAX_EXTRAPOLATE_S = 0.15;
/** Easing rate toward the target (1/s). */
export const FOLLOW_RATE = 14;

export class LiveSmoother {
  private key = "";
  private lastAt = -1;
  private lastP = 0;
  private vel = 0;
  p = 0;
  h = 0;
  s = 0;

  matches(l: Pick<LiveSample, "turn" | "level" | "slot">): boolean {
    return this.key === `${l.turn}:${l.level}:${l.slot}`;
  }

  /** `now` in ms (same clock as `at`), `dt` in seconds since the last frame. */
  update(l: LiveSample, now: number, dt: number): Shown {
    const key = `${l.turn}:${l.level}:${l.slot}`;
    if (key !== this.key) {
      this.key = key;
      this.lastAt = l.at;
      this.lastP = l.progress;
      this.vel = 0;
      this.p = l.progress;
      this.h = l.hand;
      this.s = l.strain;
      return { progress: this.p, hand: this.h, strain: this.s };
    }
    if (l.at !== this.lastAt) {
      const gap = (l.at - this.lastAt) / 1000;
      if (gap > 0.005) {
        const inst = l.stuck ? 0 : Math.max(0, Math.min(3, (l.progress - this.lastP) / gap));
        this.vel = this.vel * 0.4 + inst * 0.6;
      }
      this.lastAt = l.at;
      this.lastP = l.progress;
    }
    const ahead = l.stuck ? 0 : this.vel * Math.max(0, Math.min(MAX_EXTRAPOLATE_S, (now - l.at) / 1000));
    const target = Math.min(1, l.progress + ahead);
    const k = 1 - Math.exp(-Math.max(0, dt) * FOLLOW_RATE);
    this.p = Math.max(this.p, this.p + (target - this.p) * k);
    this.h = Math.max(this.h, this.h + (Math.min(1, Math.max(l.hand, target)) - this.h) * k);
    this.s += (l.strain - this.s) * k;
    return { progress: this.p, hand: this.h, strain: this.s };
  }
}
