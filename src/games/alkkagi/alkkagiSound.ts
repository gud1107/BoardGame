import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { AlkkagiState } from "./engine";

/**
 * 알까기 대전 "Pebble Dojo" suite (rulebook §14) — a calm courtyard groove in
 * A minor pentatonic at 92 BPM: plucked koto lines (가야금 느낌), a breathy
 * shakuhachi (대금 느낌) answer, low doum drum and a pad. When somebody is down
 * to their last stone or two (intensity 1) a taiko pulse doubles up.
 *
 * Stone SFX are played by the replay as it happens (flick, clack scaled by
 * impulse, fall off the edge, thock on the floor); round/turn cues come
 * from state diffs.
 */

const SFX = {
  pick: [fx.click(3400, 0.08), { inst: "woodblock", note: "E6", gain: 0.25 }],
  /** arg = power 0..1 while pulling back. */
  stretch: (p: number) => [{ wave: "triangle", freq: 300 + p * 500, to: 340 + p * 520, glide: 0.08, dur: 0.08, peak: 0.025 + p * 0.03, attack: 0.02, filter: { type: "lowpass", freq: 1600 } }],
  cancel: [fx.pop(700, 420, 0.1)],
  /** arg = power 0..1 — the fingernail snap. */
  flick: (p: number) => [fx.click(2600 + p * 1400, 0.12 + p * 0.1), fx.thud(260, 0.06, 0.12 + p * 0.12, 0.005)],
  /** arg = impulse (≈0..15) — glassy "탁" of two stones. */
  clack: (imp: number) => {
    const k = Math.min(1, imp / 9);
    return [
      { wave: "sine", freq: 2900 + k * 900, to: 2100, glide: 0.025, dur: 0.07, peak: 0.08 + k * 0.22, attack: 0.001 },
      { wave: "noise", dur: 0.03, peak: 0.03 + k * 0.08, filter: { type: "highpass", freq: 3500 } },
      { wave: "sine", freq: 1250, dur: 0.05, peak: 0.04 + k * 0.08, attack: 0.001 },
    ];
  },
  /** The hit that sends a stone off the board — a heavy crack under the clack. */
  smash: [fx.thud(95, 0.35, 0.55), ...fx.crack(0.01, 0.3), { inst: "taiko", note: "A1", at: 0.02, gain: 0.55 }],
  fall: [fx.whoosh(1400, 380, 0.28, 0.06)],
  /** arg = strength 0..1 — stone hits the wooden floor and bounces once. */
  floor: (k: number) => [fx.thud(200, 0.12, 0.25 + k * 0.25), fx.click(1500, 0.08 + k * 0.06), fx.click(1700, 0.04 + k * 0.03, 0.11)],
  combo: [...fx.arp("koto", ["A4", "C5", "D5", "E5", "G5"], 0.06, 0.4, 0.7), fx.click(3600, 0.1, 0.3)],
  out: [{ inst: "taiko", note: "A1", gain: 0.8 }, ...fx.arp("shakuhachi", ["E5", "D5", "A4"], 0.16, 0.5, 0.5)],
  lose: [...fx.arp("shakuhachi", ["A4", "G4", "E4"], 0.22, 0.8, 0.6), { inst: "doum", note: "A1", at: 0.5, gain: 0.7 }],
  turn: [{ inst: "koto", note: "E5", dur: 0.4 }, { inst: "koto", note: "A5", at: 0.09, dur: 0.6 }],
  pass: [{ inst: "koto", note: "C5", dur: 0.3, gain: 0.5 }, { inst: "koto", note: "A4", at: 0.12, dur: 0.4, gain: 0.4 }],
  round: [...fx.arp("koto", ["A4", "C5", "E5", "A5"], 0.08, 0.6), ...fx.chord("pad", ["A3", "C4", "E4"], 1.2, 0.6, 0.3)],
  victory: [
    ...fx.arp("koto", ["A4", "C5", "D5", "E5", "G5", "A5"], 0.07, 0.6),
    ...fx.chord("pad", ["A3", "C4", "E4", "A4"], 2, 0.9, 0.4),
    { inst: "taiko", note: "A1", at: 0.42, gain: 0.8 },
    { inst: "shakuhachi", note: "E5", at: 0.5, dur: 1.2, gain: 0.5 },
  ],
} satisfies Record<string, SfxRecipe>;

export const ALKKAGI_SUITE: SuiteConfig = {
  bpm: 92,
  swing: 0.12,
  tracks: [
    { voice: "koto", pattern: "A4 . C5 . E5 . D5 C5 | A4 . . G4 A4 . . . | E5 . D5 . C5 . A4 . | G4 . A4 . . . . .", gain: 0.42 },
    { voice: "shakuhachi", div: 2, pattern: ". . . . E5 - - . | . . . . D5 - C5 . | . . . . A4 - - . | . . . . . . . .", gain: 0.3 },
    { voice: "doum", div: 2, pattern: "x . . x . . x . | x . . x . . x .", gain: 0.45 },
    { voice: "tek", pattern: ". . x . . . x . . . x . . x x .", gain: 0.22 },
    { voice: "pad", div: 8, pattern: "A3+C4+E4 | G3+C4+D4 | F3+A3+C4 | E3+G3+B3", gain: 0.24 },
    { voice: "taiko", div: 2, pattern: "x . x . x . x . | x . x . x x x .", gain: 0.5, level: 1 },
  ],
  sfx: SFX,
};

export const getAlkkagiSound = defineSuite(ALKKAGI_SUITE);

/** State-diff cues (stone sounds come from the replay, see replay.ts). */
export function alkkagiCues(viewer: number) {
  return (prev: AlkkagiState, next: AlkkagiState) => {
    const cues: string[] = [];
    if (next.phase === "aim" && next.activeSeat === viewer && (prev.activeSeat !== viewer || prev.phase !== "aim" || prev.turn !== next.turn) && !(next.lastShot?.bonus && next.lastShot.turn === prev.turn)) cues.push("turn");
    if (next.lastPass && next.lastPass !== prev.lastPass) cues.push("pass");
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
