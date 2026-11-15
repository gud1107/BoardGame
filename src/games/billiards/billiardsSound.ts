import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { BilliardsState } from "./engine";

/**
 * 당구 파티 "Green Felt Lounge" suite (rulebook §10) — a late-night lounge
 * swing in F major at 96 BPM: walking upright bass, brushed snare, ride,
 * a mellow electric piano comping and a muted lead. When the game is close
 * to the end (intensity 1) a little organ pad and busier ride join in.
 *
 * Ball sounds are played by the replay as they happen (strike scaled by
 * power, clack by impulse, cushion thump, pocket drop rattle); turn cues
 * come from state diffs.
 */

const SFX = {
  chalk: [{ wave: "noise", dur: 0.12, peak: 0.05, attack: 0.01, filter: { type: "bandpass", freq: 3200, q: 1.5 } }, { wave: "noise", at: 0.14, dur: 0.1, peak: 0.04, filter: { type: "bandpass", freq: 2800, q: 1.5 } }],
  /** arg = power 0..1 while pulling back the cue. */
  pull: (p: number) => [{ wave: "triangle", freq: 220 + p * 380, to: 240 + p * 400, glide: 0.08, dur: 0.07, peak: 0.02 + p * 0.025, attack: 0.02, filter: { type: "lowpass", freq: 1400 } }],
  /** arg = power 0..1 — the tip meets the cue ball. */
  strike: (p: number) => [fx.click(2100 + p * 900, 0.14 + p * 0.14), fx.thud(320, 0.05, 0.08 + p * 0.14, 0.003), { wave: "noise", dur: 0.03, peak: 0.03 + p * 0.05, filter: { type: "highpass", freq: 4000 } }],
  /** arg = impulse (≈0..22) — phenolic balls: bright, short "딱". */
  clack: (imp: number) => {
    const k = Math.min(1, imp / 14);
    return [
      { wave: "sine", freq: 3600 + k * 700, to: 2600, glide: 0.02, dur: 0.05, peak: 0.07 + k * 0.24, attack: 0.001 },
      { wave: "triangle", freq: 1900, dur: 0.04, peak: 0.03 + k * 0.08, attack: 0.001 },
      { wave: "noise", dur: 0.02, peak: 0.03 + k * 0.07, filter: { type: "highpass", freq: 5000 } },
    ];
  },
  /** arg = impulse — rubber cushion thump. */
  rail: (imp: number) => {
    const k = Math.min(1, imp / 14);
    return [fx.thud(150 + k * 60, 0.12, 0.08 + k * 0.22), { wave: "noise", dur: 0.05, peak: 0.02 + k * 0.04, filter: { type: "lowpass", freq: 900 } }];
  },
  /** Ball dropping into a pocket and rattling down the return. */
  pot: [fx.thud(110, 0.2, 0.4), fx.click(900, 0.08, 0.05), fx.click(760, 0.07, 0.12), fx.click(680, 0.06, 0.2), fx.click(600, 0.05, 0.3)],
  lucky: [...fx.arp("glock", ["C6", "E6", "G6", "C7"], 0.05, 0.4, 0.6), ...fx.coin(0.05)],
  gold: [...fx.arp("vibes", ["F5", "A5", "C6", "F6"], 0.07, 0.6, 0.8), ...fx.chord("pad", ["F3", "A3", "C4"], 1, 0.4, 0.1), ...fx.coin(0.2, 3000)],
  carom: [...fx.arp("vibes", ["C5", "E5", "G5"], 0.06, 0.5, 0.7)],
  three: [...fx.arp("vibes", ["C5", "E5", "G5", "C6", "E6"], 0.06, 0.6, 0.8), { inst: "brass", note: "G4", at: 0.3, dur: 0.5, gain: 0.5 }],
  foul: [fx.buzz(240, 140, 0.32, 0.12), { inst: "upright", note: "C2", at: 0.05, dur: 0.4, gain: 0.6 }],
  scratch: [fx.whoosh(1200, 300, 0.3, 0.08), fx.buzz(200, 110, 0.4, 0.12, 0.15)],
  turn: [{ inst: "epiano", note: "A4", dur: 0.3 }, { inst: "epiano", note: "C5", at: 0.08, dur: 0.5 }],
  hand: [fx.pop(500, 900, 0.14), fx.click(1500, 0.06, 0.08)],
  pass: [{ inst: "epiano", note: "F4", dur: 0.3, gain: 0.5 }, { inst: "epiano", note: "D4", at: 0.12, dur: 0.4, gain: 0.4 }],
  rack: [...fx.arp("epiano", ["F4", "A4", "C5", "F5"], 0.08, 0.6), ...fx.chord("pad", ["F3", "A3", "C4"], 1.2, 0.5, 0.3)],
  victory: [
    ...fx.arp("vibes", ["F4", "A4", "C5", "F5", "A5", "C6"], 0.07, 0.6),
    ...fx.chord("pad", ["F3", "A3", "C4", "F4"], 2, 0.9, 0.4),
    { inst: "brass", note: "C5", at: 0.45, dur: 0.6, gain: 0.5 },
    { inst: "brass", note: "F5", at: 0.75, dur: 1.0, gain: 0.6 },
  ],
  ui: [fx.click(2400, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const BILLIARDS_SUITE: SuiteConfig = {
  bpm: 96,
  swing: 0.28,
  tracks: [
    { voice: "upright", div: 2, pattern: "F2 . A2 . C3 . A2 . | Bb2 . D3 . F3 . D3 . | G2 . Bb2 . D3 . Bb2 . | C3 . E3 . G3 . E3 .", gain: 0.5 },
    { voice: "brush", div: 2, pattern: ". x . x . x . x | . x . x . x . x", gain: 0.25 },
    { voice: "ride", pattern: "x . x x x . x x x . x x x . x x", gain: 0.12 },
    { voice: "epiano", div: 4, pattern: ". A3+C4+E4 . . | . Bb3+D4+F4 . . | . Bb3+D4+G4 . . | . Bb3+C4+E4 . .", gain: 0.24 },
    { voice: "lead", div: 2, pattern: ". . C5 - A4 . F4 . | . . D5 - C5 . Bb4 . | . . D5 . C5 . Bb4 G4 | A4 - - . . . . .", gain: 0.14 },
    { voice: "organ", div: 8, pattern: "F3+A3+C4 | Bb3+D4+F4 | G3+Bb3+D4 | C4+E4+G4", gain: 0.12, level: 1 },
    { voice: "openHat", div: 4, pattern: ". x . x | . x . x", gain: 0.08, level: 1 },
  ],
  sfx: SFX,
};

export const getBilliardsSound = defineSuite(BILLIARDS_SUITE);

/** State-diff cues (ball sounds come from the replay, see replay.ts). */
export function billiardsCues(viewer: number) {
  return (prev: BilliardsState, next: BilliardsState) => {
    const cues: string[] = [];
    if (next.phase === "aim" && next.activeSeat === viewer && (prev.activeSeat !== viewer || prev.phase !== "aim") ) cues.push("turn");
    if (next.lastPass && next.lastPass !== prev.lastPass) cues.push("pass");
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
