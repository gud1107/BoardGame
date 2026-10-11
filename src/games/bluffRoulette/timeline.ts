import type { Resolution } from "./engine";

/**
 * One shared clock for the "거짓말!" showdown (rulebook §T/§J) so the 3D
 * scene, the 2D HUD/fallback and the sound cues all hit the same beats.
 * Purely presentational — the engine already resolved everything the instant
 * the `liar` action was applied; this only paces how it is shown. Times are
 * seconds since the client first saw the resolution.
 *
 * Each trigger pull is acted out step by step so it reads at a glance:
 * grab the revolver → swing the cylinder out → check the spent chambers and
 * advance exactly ONE notch (no re-spin: the rulebook never reloads) →
 * close it → raise it to the temple → cock the hammer → hold the breath →
 * fire → relief (click) or collapse (bang).
 */

export type CueKind =
  | "liar"
  | "flip"
  | "verdict"
  | "skull"
  | "lift"
  | "open"
  | "spin"
  | "close"
  | "raise"
  | "cock"
  | "heartbeat"
  | "fire";

export interface Cue {
  at: number;
  kind: CueKind;
  /** flip: card index; pull cues: pull index. */
  index: number;
}

/** Offsets (seconds, at speed 1) of each step inside one pull. */
export const PULL_STEPS = {
  grab: 0,
  open: 0.55,
  notch: 1.45,
  close: 1.95,
  raise: 2.25,
  cock: 2.85,
  hold: 3.15,
  fire: 4.05,
  lower: 4.75,
  end: 5.45,
} as const;

export type PullStep = "grab" | "open" | "notch" | "close" | "raise" | "cock" | "hold" | "fire" | "after";

export interface PullTimes {
  liftAt: number;
  openAt: number;
  spinAt: number;
  closeAt: number;
  raiseAt: number;
  cockAt: number;
  holdAt: number;
  fireAt: number;
  lowerAt: number;
  endAt: number;
  /** Time scale of this pull (later pulls of a skull chain run faster). */
  k: number;
}

export interface ShowdownTimeline {
  cues: Cue[];
  flipAt: (i: number) => number;
  verdictAt: number;
  pulls: PullTimes[];
  total: number;
}

const FLIP_START = 0.8;
const FLIP_GAP = 0.55;

export function buildTimeline(res: Resolution, speed = 1): ShowdownTimeline {
  const k0 = 1 / speed;
  const flipAt = (i: number) => (FLIP_START + i * FLIP_GAP) * k0;
  const verdictAt = flipAt(res.revealed.length - 1) + 0.6 * k0;
  let cursor = verdictAt + (res.skull ? 1.6 : 0.9) * k0;
  const pulls: PullTimes[] = res.pulls.map((_, j) => {
    // A skull chain can mean 5 pulls in a row — keep the first one full length, speed up the rest.
    const k = k0 * (j === 0 ? 1 : 0.62);
    const at = (s: number) => cursor + s * k;
    const p: PullTimes = {
      liftAt: at(PULL_STEPS.grab),
      openAt: at(PULL_STEPS.open),
      spinAt: at(PULL_STEPS.notch),
      closeAt: at(PULL_STEPS.close),
      raiseAt: at(PULL_STEPS.raise),
      cockAt: at(PULL_STEPS.cock),
      holdAt: at(PULL_STEPS.hold),
      fireAt: at(PULL_STEPS.fire),
      lowerAt: at(PULL_STEPS.lower),
      endAt: at(PULL_STEPS.end),
      k,
    };
    cursor = p.endAt;
    return p;
  });
  const cues: Cue[] = [{ at: 0, kind: "liar", index: 0 }];
  res.revealed.forEach((_, i) => cues.push({ at: flipAt(i), kind: "flip", index: i }));
  cues.push({ at: verdictAt, kind: res.skull ? "skull" : "verdict", index: 0 });
  pulls.forEach((p, j) => {
    cues.push(
      { at: p.liftAt, kind: "lift", index: j },
      { at: p.openAt, kind: "open", index: j },
      { at: p.spinAt, kind: "spin", index: j },
      { at: p.closeAt, kind: "close", index: j },
      { at: p.raiseAt, kind: "raise", index: j },
      { at: p.cockAt, kind: "cock", index: j },
      { at: p.holdAt, kind: "heartbeat", index: j },
      { at: p.holdAt + (p.fireAt - p.holdAt) * 0.5, kind: "heartbeat", index: j },
      { at: p.fireAt, kind: "fire", index: j },
    );
  });
  const total = (pulls.length ? pulls[pulls.length - 1].endAt : cursor) + 0.4 * k0;
  return { cues, flipAt, verdictAt, pulls, total };
}

/** Which pull (if any) is on stage at `t`, and how far into it (seconds, real time). */
export function activePull(tl: ShowdownTimeline, t: number): { index: number; local: number } | null {
  for (let j = 0; j < tl.pulls.length; j++) {
    const p = tl.pulls[j];
    if (t >= p.liftAt && t < p.endAt) return { index: j, local: t - p.liftAt };
  }
  return null;
}

/** The named step of pull `p` at time `t`. */
export function pullStep(p: PullTimes, t: number): PullStep {
  if (t < p.openAt) return "grab";
  if (t < p.spinAt) return "open";
  if (t < p.closeAt) return "notch";
  if (t < p.raiseAt) return "close";
  if (t < p.cockAt) return "raise";
  if (t < p.holdAt) return "cock";
  if (t < p.fireAt) return "hold";
  if (t < p.lowerAt) return "fire";
  return "after";
}

/** Normalised 0..1 progress between two absolute times. */
export function span(t: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (t - from) / Math.max(1e-6, to - from)));
}
