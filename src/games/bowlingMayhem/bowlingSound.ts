import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { BowlingState } from "./engine";

/**
 * 볼링 난장판 "Disco Lanes" suite (rulebook §12) — a late-night bowling alley
 * groove in E minor at 112 BPM: four-on-the-floor kick, offbeat open hats,
 * a slap-bass line, electric-piano chords and brass stabs. In the last frame
 * (intensity 1) claps and a synth lead come in.
 *
 * Ball/pin sounds are played by the replay as they happen (release, rolling
 * rumble, pin crash scaled by impulse, gutter clunk, bumper boing, cone
 * bonk); strike/spare/turn cues come from the replay's "settled" event and
 * state diffs.
 */

const SFX = {
  /** arg = power 0..1 — the ball leaves the hand and thumps onto the lane. */
  release: (p: number) => [fx.thud(90, 0.3, 0.35 + p * 0.25), fx.click(900, 0.06), { wave: "noise", dur: 0.18, peak: 0.05, filter: { type: "lowpass", freq: 600 } }],
  /** arg = seconds the ball rolls — a low rumble that fades down the lane. */
  rumble: (sec: number) => [
    { wave: "noise", dur: Math.max(0.8, Math.min(4, sec)), peak: 0.07, attack: 0.15, filter: { type: "lowpass", freq: 260 } },
    { wave: "sine", freq: 58, to: 46, glide: Math.max(0.8, Math.min(4, sec)), dur: Math.max(0.8, Math.min(4, sec)), peak: 0.12, attack: 0.1 },
  ],
  /** arg = impulse (≈0..20) — wooden pin clatter. */
  pin: (imp: number) => {
    const k = Math.min(1, imp / 14);
    return [
      { wave: "noise", dur: 0.06 + k * 0.08, peak: 0.06 + k * 0.16, attack: 0.001, filter: { type: "bandpass", freq: 1800 + k * 900, q: 1.2 } },
      { wave: "triangle", freq: 620 + k * 260, to: 420, glide: 0.06, dur: 0.08, peak: 0.05 + k * 0.1, attack: 0.001 },
      fx.click(2600, 0.04 + k * 0.08),
    ];
  },
  /** The big crash when the ball first plows into a full rack. */
  crash: [
    { wave: "noise", dur: 0.55, peak: 0.32, attack: 0.002, filter: { type: "bandpass", freq: 1500, q: 0.7 } },
    fx.thud(120, 0.3, 0.5),
    ...fx.crack(0.0, 0.25),
    fx.click(2200, 0.12, 0.05),
    fx.click(1700, 0.1, 0.11),
    fx.click(2500, 0.08, 0.18),
  ],
  wall: [fx.thud(160, 0.12, 0.2), fx.click(1200, 0.06)],
  gutter: [fx.thud(70, 0.4, 0.4), { wave: "noise", dur: 0.6, peak: 0.06, attack: 0.05, filter: { type: "lowpass", freq: 420 } }, { inst: "tom", note: "C3", at: 0.05, gain: 0.4 }],
  bumper: [{ wave: "sine", freq: 220, to: 520, glide: 0.12, dur: 0.22, peak: 0.25, attack: 0.002 }, { wave: "sine", freq: 520, to: 260, glide: 0.15, at: 0.12, dur: 0.2, peak: 0.15 }],
  cone: [fx.pop(500, 260, 0.3), fx.thud(220, 0.12, 0.25)],
  strike: [
    ...fx.chord("brass", ["E4", "G#4", "B4"], 0.25, 0.8),
    ...fx.chord("brass", ["A4", "C#5", "E5"], 0.6, 0.9, 0.22),
    { inst: "ride", note: "C6", at: 0.22, gain: 0.6 },
    ...fx.arp("glock", ["E6", "G#6", "B6", "E7"], 0.05, 0.4, 0.5),
  ],
  turkey: [
    ...fx.arp("brass", ["E4", "G4", "B4", "E5", "G5"], 0.09, 0.4, 0.9),
    ...fx.chord("brass", ["E5", "G#5", "B5"], 0.9, 1, 0.5),
    { inst: "clap", note: "C4", at: 0.5, gain: 0.8 },
    { inst: "clap", note: "C4", at: 0.62, gain: 0.8 },
  ],
  spare: [...fx.arp("epiano", ["B4", "E5", "G5", "B5"], 0.07, 0.5, 0.8), { inst: "stab", note: "E5", at: 0.3, gain: 0.5 }],
  split: [{ inst: "brass", note: "D#4", dur: 0.3, gain: 0.5 }, { inst: "brass", note: "D4", at: 0.28, dur: 0.6, gain: 0.5 }],
  /** Missed everything / a gutter ball. */
  miss: [{ inst: "brass", note: "G3", dur: 0.25, gain: 0.5 }, { inst: "brass", note: "F#3", at: 0.25, dur: 0.25, gain: 0.5 }, { inst: "brass", note: "F3", at: 0.5, dur: 0.7, gain: 0.5 }],
  foul: [fx.buzz(220, 110, 0.5, 0.18)],
  item: [fx.whoosh(500, 1800, 0.25, 0.1), fx.pop(500, 1100, 0.22, 0.15)],
  /** A sabotage lands on my lane. */
  hazard: [fx.buzz(330, 300, 0.25, 0.12), fx.buzz(330, 300, 0.25, 0.12, 0.3)],
  gift: [...fx.coin(0), ...fx.coin(0.12, 3000)],
  turn: [{ inst: "epiano", note: "E5", dur: 0.35 }, { inst: "epiano", note: "B5", at: 0.1, dur: 0.5 }],
  /** arg = power 0..1 — the meter ticking up while held. */
  meter: (p: number) => [{ wave: "triangle", freq: 400 + p * 700, dur: 0.04, peak: 0.03, attack: 0.002 }],
  frame: [...fx.arp("epiano", ["E4", "G4", "B4"], 0.06, 0.4, 0.5)],
  victory: [
    ...fx.arp("brass", ["E4", "G#4", "B4", "E5"], 0.1, 0.5),
    ...fx.chord("strings", ["E4", "G#4", "B4", "E5"], 2, 0.7, 0.4),
    { inst: "clap", note: "C4", at: 0.4, gain: 0.7 },
    { inst: "clap", note: "C4", at: 0.6, gain: 0.7 },
    { inst: "ride", note: "C6", at: 0.4, gain: 0.5 },
  ],
} satisfies Record<string, SfxRecipe>;

export const BOWLING_SUITE: SuiteConfig = {
  bpm: 112,
  swing: 0.08,
  tracks: [
    { voice: "kick", pattern: "x . . . x . . . x . . . x . . .", gain: 0.5 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . x", gain: 0.3 },
    { voice: "openHat", pattern: ". . x . . . x . . . x . . . x .", gain: 0.25 },
    { voice: "hat", pattern: "x x . x x x . x x x . x x x . x", gain: 0.14 },
    { voice: "synthBass", pattern: "E2 . E3 . . E2 . D3 | E2 . . G2 . A2 B2 . | C3 . C3 . . C2 . B2 | A2 . . B2 . D3 B2 .", gain: 0.42 },
    { voice: "epiano", div: 4, pattern: "E3+G3+B3+D4 . . . | E3+G3+B3+D4 . A3+C4+E4 . | C3+E3+G3+B3 . . . | A2+C3+E3+G3 . B2+D3+F#3 .", gain: 0.26 },
    { voice: "stab", div: 2, pattern: ". . . E5 . . . . | . . . D5 . . G5 . | . . . E5 . . . . | . . . B4 . . . .", gain: 0.18 },
    { voice: "clap", pattern: ". . . . x . . . . . . . x . x .", gain: 0.3, level: 1 },
    { voice: "lead", div: 2, pattern: "B4 - D5 E5 . G5 E5 . | D5 - B4 - . A4 B4 . | G4 - B4 C5 . E5 D5 . | B4 - - - . . . .", gain: 0.16, level: 1 },
  ],
  sfx: SFX,
};

export const getBowlingSound = defineSuite(BOWLING_SUITE);

/** State-diff cues (ball/pin sounds come from the replay, see replay.ts). */
export function bowlingCues(viewer: number) {
  return (prev: BowlingState, next: BowlingState) => {
    const cues: string[] = [];
    if (next.phase === "aim" && next.activeSeat === viewer && (prev.activeSeat !== viewer || prev.frame !== next.frame || prev.phase !== "aim")) cues.push("turn");
    if (next.lastItem && next.lastItem !== prev.lastItem) cues.push(next.lastItem.target === viewer && next.lastItem.seat !== viewer ? "hazard" : "item");
    if (next.lastGift && next.lastGift !== prev.lastGift && next.lastGift.seats.includes(viewer)) cues.push("gift");
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
