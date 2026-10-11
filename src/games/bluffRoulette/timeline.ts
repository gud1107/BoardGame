import type { Resolution } from "./engine";

/**
 * One shared clock for the "거짓말!" showdown (rulebook §T) so the 3D scene,
 * the 2D HUD/fallback and the sound cues all hit the same beats. Purely
 * presentational — the engine already resolved everything the instant the
 * `liar` action was applied; this only paces how it is shown. Times are
 * seconds since the client first saw the resolution.
 */

export type CueKind = "liar" | "flip" | "verdict" | "skull" | "lift" | "spin" | "cock" | "fire";

export interface Cue {
  at: number;
  kind: CueKind;
  /** flip: card index; lift/spin/cock/fire: pull index. */
  index: number;
}

export interface ShowdownTimeline {
  cues: Cue[];
  flipAt: (i: number) => number;
  verdictAt: number;
  /** Per pull: when the gun rises, spins, is cocked and fires. */
  pulls: { liftAt: number; spinAt: number; cockAt: number; fireAt: number; endAt: number }[];
  total: number;
}

const FLIP_START = 0.8;
const FLIP_GAP = 0.55;
const PULL_LEN = 2.7;

export function buildTimeline(res: Resolution, speed = 1): ShowdownTimeline {
  const k = 1 / speed;
  const flipAt = (i: number) => (FLIP_START + i * FLIP_GAP) * k;
  const verdictAt = flipAt(res.revealed.length - 1) + 0.6 * k;
  const base = verdictAt + (res.skull ? 1.6 : 0.9) * k;
  const pulls = res.pulls.map((_, j) => {
    const liftAt = base + j * PULL_LEN * k;
    return { liftAt, spinAt: liftAt + 0.35 * k, cockAt: liftAt + 1.45 * k, fireAt: liftAt + 1.95 * k, endAt: liftAt + PULL_LEN * k };
  });
  const cues: Cue[] = [{ at: 0, kind: "liar", index: 0 }];
  res.revealed.forEach((_, i) => cues.push({ at: flipAt(i), kind: "flip", index: i }));
  cues.push({ at: verdictAt, kind: res.skull ? "skull" : "verdict", index: 0 });
  pulls.forEach((p, j) => {
    cues.push({ at: p.liftAt, kind: "lift", index: j }, { at: p.spinAt, kind: "spin", index: j }, { at: p.cockAt, kind: "cock", index: j }, { at: p.fireAt, kind: "fire", index: j });
  });
  const total = (pulls.length ? pulls[pulls.length - 1].endAt : base) + 0.4 * k;
  return { cues, flipAt, verdictAt, pulls, total };
}

/** Which pull (if any) is on stage at `t`, and how far into it. */
export function activePull(tl: ShowdownTimeline, t: number): { index: number; local: number } | null {
  for (let j = 0; j < tl.pulls.length; j++) {
    const p = tl.pulls[j];
    if (t >= p.liftAt && t < p.endAt) return { index: j, local: t - p.liftAt };
  }
  return null;
}
