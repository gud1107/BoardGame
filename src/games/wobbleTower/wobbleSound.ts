import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { WobbleTowerState } from "./engine";

/**
 * 와르르 타워 "Timber Hush" suite — a hushed late-night lounge in D minor at
 * 76 BPM: upright bass, brushed snare, soft kalimba and a pad, so every
 * wooden click stays audible. When the tower gets fragile (intensity 1) a
 * muffled heartbeat and a ticking clock creep in.
 *
 * Wood SFX: tap on select, rattle for the looseness wiggle, a scrape loop
 * while pulling (played by the board every ~90 ms of hand movement), a
 * creak when a block catches or the tower sways hard, a "tock" when it pops
 * free, a thunk on placement, and a long tumbling cascade on collapse.
 */

const SFX = {
  select: [{ inst: "woodblock", note: "A5", gain: 0.55 }, fx.click(2600, 0.06, 0.01)],
  wiggle: [{ inst: "woodblock", note: "D6", gain: 0.25 }, { inst: "woodblock", note: "C6", at: 0.07, gain: 0.2 }, { inst: "woodblock", note: "D6", at: 0.14, gain: 0.15 }],
  /** arg = strain 0..1 — rougher and louder as strain climbs. */
  scrape: (strain: number) => [
    { wave: "noise", dur: 0.09, peak: 0.05 + strain * 0.07, attack: 0.02, filter: { type: "bandpass", freq: 700 + strain * 900, q: 2.2 } },
    ...(strain > 0.5 ? [fx.click(900 + strain * 600, 0.03 * strain, 0.03)] : []),
  ],
  /** Wood creak — arg 0..1. */
  creak: (k: number) => [
    { wave: "sawtooth", freq: 120 + k * 40, to: 95 + k * 30, glide: 0.4, dur: 0.45, peak: 0.035 + k * 0.05, attack: 0.08, tremolo: 34, filter: { type: "bandpass", freq: 650, q: 4 } },
    { wave: "noise", dur: 0.3, peak: 0.02 + k * 0.03, attack: 0.1, filter: { type: "bandpass", freq: 1400, q: 6 } },
  ],
  stuck: [
    { wave: "sawtooth", freq: 160, to: 130, glide: 0.25, dur: 0.3, peak: 0.07, attack: 0.02, tremolo: 42, filter: { type: "bandpass", freq: 800, q: 5 } },
    fx.click(700, 0.08),
  ],
  jerk: [...fx.crack(0, 0.25), fx.thud(110, 0.3, 0.45, 0.02), { inst: "woodblock", note: "F4", at: 0.05, gain: 0.6 }],
  free: [{ inst: "woodblock", note: "E5", gain: 0.7 }, fx.pop(500, 900, 0.12, 0.02)],
  lift: [fx.whoosh(500, 1400, 0.3, 0.05)],
  place: [fx.thud(150, 0.22, 0.4), { inst: "woodblock", note: "C5", gain: 0.6 }, fx.click(1800, 0.06, 0.02)],
  /** One clack from the physics collapse — arg = impact strength 0..1. */
  clack: (k: number) => [{ inst: "woodblock", note: k > 0.6 ? "G4" : k > 0.3 ? "C5" : "F5", gain: 0.25 + k * 0.6 }, fx.thud(90 + k * 60, 0.18, 0.15 + k * 0.35)],
  collapse: [
    fx.whoosh(2400, 200, 0.9, 0.18),
    fx.thud(70, 0.8, 0.6, 0.1),
    { wave: "noise", at: 0.05, dur: 1.4, peak: 0.12, attack: 0.05, filter: { type: "lowpass", freq: 2200, to: 300 } },
    ...[0, 0.12, 0.2, 0.33, 0.41, 0.55, 0.62, 0.8, 0.95, 1.15].map((at, i) => ({ inst: "woodblock", note: ["C5", "G4", "E5", "D5", "A4", "F5", "C5", "G5", "E4", "D5"][i], at, gain: 0.6 - i * 0.04 })),
  ],
  turn: [{ inst: "kalimba", note: "D5", dur: 0.4 }, { inst: "kalimba", note: "A5", at: 0.1, dur: 0.6 }],
  lose: [...fx.arp("vibes", ["A4", "F4", "D4"], 0.14, 0.7, 0.8), { inst: "upright", note: "D2", at: 0.4, dur: 1 }],
  builder: [...fx.arp("kalimba", ["D5", "F5", "A5", "D6"], 0.08, 0.6), ...fx.chord("vibes", ["D5", "F5", "A5"], 1.2, 0.7, 0.32)],
  victory: [...fx.arp("kalimba", ["D5", "F5", "A5", "C6", "D6", "F6"], 0.07, 0.6), ...fx.chord("pad", ["D4", "F4", "A4", "D5"], 2, 0.9, 0.4), { inst: "upright", note: "D2", at: 0.4, dur: 1.5 }],
} satisfies Record<string, SfxRecipe>;

export const WOBBLE_TOWER_SUITE: SuiteConfig = {
  bpm: 76,
  swing: 0.22,
  tracks: [
    { voice: "upright", div: 2, pattern: "D2 . A2 . F2 . A2 . | G2 . D3 . Bb2 . G2 . | A2 . E3 . C3 . E3 . | D2 . A2 . D3 . C3 .", gain: 0.8 },
    { voice: "brush", pattern: ". . x . . . x . . . x . . . x x", gain: 0.3 },
    { voice: "kalimba", pattern: "D5 . . F5 . . A5 . | . . G5 . . Bb5 . . | . A5 . . E5 . C6 . | . . D5 . . . . .", gain: 0.42 },
    { voice: "pad", div: 8, pattern: "D4+F4+A4 | G3+Bb3+D4 | A3+C4+E4 | D4+F4+A4", gain: 0.28 },
    { voice: "softKick", div: 4, pattern: "x . x . | x . x . | x . x . | x . x .", gain: 0.4, level: 1 },
    { voice: "tick", pattern: "x . x . x . x . x . x . x . x .", gain: 0.18, level: 1 },
  ],
  sfx: SFX,
};

export const getWobbleSound = defineSuite(WOBBLE_TOWER_SUITE);

/** State-diff cues (everything except the live drag sounds, which the board plays directly). */
export function wobbleCues(viewer: number) {
  return (prev: WobbleTowerState, next: WobbleTowerState) => {
    const cues: (string | { name: string; arg?: number })[] = [];
    const e = next.lastEvent;
    if (e && e !== prev.lastEvent && e.turn !== prev.lastEvent?.turn) {
      if (e.kind === "pull") cues.push(e.collapsed ? "jerk" : "free", ...(e.collapsed ? [] : ["lift"]));
      else if (!e.collapsed) cues.push("place");
    }
    if (prev.phase !== "collapsed" && next.phase === "collapsed") {
      cues.push("collapse");
      const rec = next.history[next.history.length - 1];
      if (rec?.loser === viewer) cues.push("lose");
      else if (rec?.lastBuilder === viewer) cues.push("builder");
    }
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    if (next.phase === "pull" && next.activeSeat === viewer && (prev.activeSeat !== viewer || prev.phase !== "pull")) cues.push("turn");
    return cues;
  };
}
