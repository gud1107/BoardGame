import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { MiniGolfState } from "./engine";

/**
 * 미니골프 파티 "Cloud Hopper" suite (rulebook §12) — a breezy island
 * shuffle in F major at 104 BPM: plucked chords, marimba answers, an upright
 * bass walking under brushes and a shaker. On the last hole (intensity 1) a
 * whistled tune and claps come in.
 *
 * Ball sounds are played by the replay as they happen (putter tick, rail
 * knock, bumper boing, ball clack, cup rattle, fall whoosh, ramp launch,
 * landing thump, blade bonk, sand hush); result / turn / pick cues come from
 * the replay's "settled" event and state diffs.
 */

const SFX = {
  /** arg = power 0..1 — the putter meets the ball. */
  putt: (p: number) => [fx.click(1400 + p * 900, 0.16 + p * 0.1), fx.thud(260, 0.08, 0.12 + p * 0.12), { wave: "noise", dur: 0.03, peak: 0.04 + p * 0.04, filter: { type: "highpass", freq: 3500 } }],
  /** arg = impulse — the ball knocks a wooden rail. */
  wall: (imp: number) => {
    const k = Math.min(1, imp / 2.5);
    return [{ inst: "woodblock", note: "C5", gain: 0.25 + k * 0.6 }, fx.thud(180, 0.07, 0.08 + k * 0.15)];
  },
  bumper: [{ wave: "sine", freq: 300, to: 760, glide: 0.1, dur: 0.2, peak: 0.24, attack: 0.002 }, { wave: "sine", freq: 760, to: 380, glide: 0.14, at: 0.1, dur: 0.2, peak: 0.12 }],
  /** arg = impulse — two balls clack. */
  clack: (imp: number) => [fx.click(2600, 0.12 + Math.min(1, imp / 2) * 0.2), fx.click(1900, 0.08, 0.012)],
  cup: [fx.click(1700, 0.16), fx.click(1300, 0.14, 0.07), fx.click(1500, 0.12, 0.13), fx.thud(120, 0.18, 0.3, 0.16)],
  fall: [fx.whoosh(1600, 300, 0.7, 0.14), { wave: "sine", freq: 700, to: 180, glide: 0.8, dur: 0.85, peak: 0.12, attack: 0.02 }],
  launch: [fx.whoosh(400, 2200, 0.35, 0.14), { wave: "triangle", freq: 330, to: 880, glide: 0.3, dur: 0.32, peak: 0.12, attack: 0.01 }],
  land: [fx.thud(110, 0.2, 0.35), { wave: "noise", dur: 0.12, peak: 0.06, filter: { type: "lowpass", freq: 700 } }],
  blade: [fx.thud(200, 0.1, 0.25), { inst: "woodblock", note: "G4", gain: 0.6 }],
  magnet: [{ wave: "sawtooth", freq: 110, to: 140, glide: 0.25, dur: 0.3, peak: 0.05, attack: 0.02, filter: { type: "lowpass", freq: 900 } }],
  sand: [{ wave: "noise", dur: 0.35, peak: 0.07, attack: 0.04, filter: { type: "bandpass", freq: 900, q: 0.6 } }],
  holeInOne: [
    ...fx.arp("brass", ["F4", "A4", "C5", "F5", "A5"], 0.08, 0.5, 0.9),
    ...fx.chord("brass", ["F5", "A5", "C6"], 1.1, 0.8, 0.45),
    { inst: "clap", note: "C4", at: 0.45, gain: 0.8 },
    { inst: "clap", note: "C4", at: 0.6, gain: 0.8 },
    ...fx.arp("glock", ["C6", "F6", "A6", "C7"], 0.06, 0.4, 0.7),
  ],
  birdie: [...fx.arp("whistle", ["C6", "A5", "C6", "F6"], 0.09, 0.25, 0.7), ...fx.arp("marimba", ["F5", "A5", "C6"], 0.07, 0.4, 0.6)],
  par: [...fx.arp("marimba", ["C5", "F5", "A5"], 0.08, 0.4, 0.7)],
  bogey: [{ inst: "marimba", note: "A4", dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "F4", at: 0.18, dur: 0.5, gain: 0.5 }],
  splash: [fx.buzz(260, 130, 0.4, 0.1)],
  whiff: [fx.whoosh(800, 400, 0.3, 0.1), fx.buzz(200, 120, 0.35, 0.1, 0.15)],
  knock: [...fx.crack(0, 0.18), { inst: "brass", note: "C5", at: 0.05, dur: 0.2, gain: 0.4 }],
  pick: [fx.pop(500, 1100, 0.2), ...fx.arp("glock", ["F5", "C6"], 0.08, 0.3, 0.5)],
  obstacle: [fx.whoosh(500, 1800, 0.3, 0.1), { inst: "brass", note: "F4", at: 0.1, dur: 0.35, gain: 0.5 }, { inst: "brass", note: "C5", at: 0.25, dur: 0.4, gain: 0.5 }],
  turn: [{ inst: "marimba", note: "C5", dur: 0.3 }, { inst: "marimba", note: "F5", at: 0.1, dur: 0.45 }],
  /** arg = power 0..1 — the meter / slingshot stretching. */
  meter: (p: number) => [{ wave: "triangle", freq: 380 + p * 640, dur: 0.035, peak: 0.03, attack: 0.002 }],
  hole: [...fx.arp("pluck", ["F4", "A4", "C5", "F5"], 0.06, 0.5, 0.6)],
  victory: [
    ...fx.arp("brass", ["F4", "A4", "C5", "F5"], 0.1, 0.5),
    ...fx.chord("strings", ["F4", "A4", "C5", "F5"], 2, 0.7, 0.4),
    { inst: "clap", note: "C4", at: 0.4, gain: 0.7 },
    { inst: "clap", note: "C4", at: 0.6, gain: 0.7 },
    { inst: "triangle", note: "C6", at: 0.4, gain: 0.6 },
  ],
} satisfies Record<string, SfxRecipe>;

export const MINI_GOLF_SUITE: SuiteConfig = {
  bpm: 104,
  swing: 0.16,
  tracks: [
    { voice: "softKick", pattern: "x . . . . . x . x . . . . . . .", gain: 0.42 },
    { voice: "brush", pattern: ". . . . x . . . . . . . x . . .", gain: 0.3 },
    { voice: "shaker", pattern: "x . x x x . x x x . x x x . x x", gain: 0.16 },
    { voice: "upright", pattern: "F2 . . . A2 . . . | C3 . . . A2 . . . | Bb2 . . . D3 . . . | C3 . . . E2 . . .", gain: 0.42 },
    { voice: "pluck", div: 2, pattern: ". F3+A3+C4 . F3+A3+C4 | . F3+A3+C4 . F3+A3+C4 | . Bb3+D4+F4 . Bb3+D4+F4 | . C4+E4+G4 . C4+E4+Bb4", gain: 0.22 },
    { voice: "marimba", div: 2, pattern: "C5 . A4 . . . F4 . | . . G4 A4 . . . . | D5 . Bb4 . . . F4 . | E4 . G4 . C5 . . .", gain: 0.2 },
    { voice: "clap", pattern: ". . . . x . . . . . . . x . . x", gain: 0.25, level: 1 },
    { voice: "whistle", div: 2, pattern: "A5 - C6 - A5 . F5 . | G5 - A5 G5 F5 . . . | F5 - Bb5 - D6 . Bb5 . | C6 - - - . . . .", gain: 0.13, level: 1 },
  ],
  sfx: SFX,
};

export const getMiniGolfSound = defineSuite(MINI_GOLF_SUITE);

/** State-diff cues (ball sounds come from the replay, see replay.ts). */
export function miniGolfCues(viewer: number) {
  return (prev: MiniGolfState, next: MiniGolfState) => {
    const cues: string[] = [];
    const myTurn = (s: MiniGolfState) => (s.phase === "play" && s.activeSeat === viewer) || (s.phase === "pick" && s.picker === viewer);
    if (myTurn(next) && (!myTurn(prev) || prev.holeIdx !== next.holeIdx || prev.phase !== next.phase)) cues.push("turn");
    if (next.lastPick && next.lastPick !== prev.lastPick) cues.push("obstacle");
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
