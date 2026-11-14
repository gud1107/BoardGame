import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import { correctPick, type CorridorState } from "./engine";

/**
 * 이상한 복도 "Fluorescent Hum" (rulebook §10) — an original ambient loop at
 * 70 BPM: a buzzing fluorescent drone, a ticking wall clock, a detuned
 * electric piano dropping single notes in E phrygian. From the second half
 * of the game (intensity 1) a slow heartbeat and a high string cluster join.
 */

const SFX = {
  /** Footsteps down the hall — a new round starts. */
  steps: [0, 0.42, 0.84, 1.26].map((at, i) => fx.thud(i % 2 ? 120 : 105, 0.09, 0.22, at)),
  /** Tapping a prop to select it (board). */
  select: [fx.click(1500, 0.12)],
  /** Confirming an answer. */
  confirm: [fx.pop(380, 760, 0.16), { inst: "epiano", note: "B4", at: 0.05, dur: 0.4, gain: 0.35 }],
  /** I got it right. */
  right: [...fx.arp("vibes", ["E5", "G#5", "B5"], 0.07, 0.5, 0.6)],
  /** I got it wrong. */
  wrong: [fx.thud(70, 0.45, 0.5), { wave: "sawtooth", freq: 110, to: 98, glide: 0.4, dur: 0.6, peak: 0.06, attack: 0.01, filter: { type: "lowpass", freq: 600 } }],
  /** The anomaly is shown. */
  reveal: [{ inst: "strings", note: "F4", dur: 1.2, gain: 0.35 }, { inst: "strings", note: "E4", dur: 1.2, gain: 0.35 }, { inst: "bell", note: "F5", at: 0.05, dur: 1, gain: 0.3 }],
  /** It was a normal corridor. */
  clear: [{ inst: "epiano", note: "E4", dur: 0.6, gain: 0.35 }, { inst: "epiano", note: "B4", at: 0.12, dur: 0.6, gain: 0.3 }],
  /** 🧍 the figure at the end of the hall. */
  scare: [fx.thud(45, 1, 0.7), { wave: "sawtooth", freq: 740, to: 1100, glide: 0.2, dur: 0.5, peak: 0.05, attack: 0.005, filter: { type: "bandpass", freq: 1800, q: 2 } }, { inst: "gong", note: "C2", at: 0.05, gain: 0.6 }],
  /** A lamp flickers. */
  flicker: [{ wave: "square", freq: 120, dur: 0.12, peak: 0.03, attack: 0.002 }, { wave: "square", freq: 120, dur: 0.08, peak: 0.03, at: 0.2, attack: 0.002 }],
  /** Somebody answered. */
  answered: [{ inst: "tock", note: "C5", gain: 0.5 }],
  ready: [{ inst: "bell", note: "E5", dur: 0.5, gain: 0.35 }],
  tick: [{ inst: "tick", note: "C6", gain: 0.6 }],
  victory: [...fx.arp("epiano", ["E4", "G#4", "B4", "E5"], 0.12, 0.8), ...fx.chord("pad", ["E3", "B3", "E4"], 2, 0.6, 0.4)],
} satisfies Record<string, SfxRecipe>;

export const STRANGE_CORRIDOR_SUITE: SuiteConfig = {
  bpm: 70,
  swing: 0,
  tracks: [
    { voice: "pad", div: 16, pattern: "E2+B2 - ", gain: 0.12 },
    { voice: "tock", div: 4, pattern: "x x x x", gain: 0.1 },
    { voice: "epiano", div: 2, pattern: "E4 . . . . . F4 . | . . . . B3 . . . | E4 . . . G4 . . F4 | . . . . . . . . ", gain: 0.12 },
    { voice: "bass", div: 8, pattern: "E1 - F1 - ", gain: 0.2 },
    { voice: "kick", div: 2, pattern: "x x . . . . . . x x . . . . . .", gain: 0.25, level: 1 },
    { voice: "strings", div: 8, pattern: "E5+F5 - . . ", gain: 0.05, level: 1 },
  ],
  sfx: SFX,
};

export const getStrangeCorridorSound = defineSuite(STRANGE_CORRIDOR_SUITE);

export function corridorIntensity(s: CorridorState): number {
  return s.round > s.options.rounds / 2 ? 1 : 0;
}

export function strangeCorridorCues(viewer: number) {
  return (prev: CorridorState, next: CorridorState): SoundCue[] => {
    const cues: SoundCue[] = [];
    if (next.step !== prev.step) {
      if (next.phase === "look") cues.push("steps");
      if (next.phase === "reveal") {
        const r = next.results[next.results.length - 1];
        cues.push(r.anomaly ? "reveal" : "clear");
        if (r.anomaly?.extra?.kind === "figure") cues.push("scare");
        const mine = r.answers[viewer];
        if (viewer >= 0 && viewer < next.playerCount) cues.push(mine && mine.pick === correctPick(r.anomaly) ? "right" : "wrong");
      }
      if (next.phase === "ended") cues.push("victory");
    } else {
      const was = prev.answers.filter(Boolean).length + prev.ready.filter(Boolean).length;
      const now = next.answers.filter(Boolean).length + next.ready.filter(Boolean).length;
      if (now > was) cues.push(next.phase === "study" ? "ready" : "answered");
    }
    return cues;
  };
}
