import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { DominoState } from "./engine";

/**
 * 도미노 연쇄 "Clockwork Workshop" suite (rulebook §11) — a tick-tock
 * workshop tune in D major at 108 BPM: marimba melody, music-box sparkles,
 * pizzicato bass and a woodblock clock. During the topple (intensity 1) a
 * snare roll and brass hits lift it into a drum-roll finale.
 *
 * Topple SFX are fired by the board as each event's tick comes up (clack
 * pitch climbs with the chain, bells by value, booms); build cues come from
 * state diffs.
 */

const SFX = {
  pick: [fx.click(2600, 0.08), { inst: "woodblock", note: 1, gain: 0.25 }],
  /** Standing a piece on the board. */
  place: [fx.thud(420, 0.08, 0.18, 0.002), fx.click(1800, 0.09, 0.01)],
  wall: [fx.thud(160, 0.18, 0.35), fx.click(900, 0.08, 0.03)],
  split: [fx.thud(420, 0.08, 0.18), fx.pop(500, 1100, 0.12, 0.04)],
  /** arg = how far into the chain (0..1) — clacks climb as the run goes on. */
  clack: (k: number) => [
    { wave: "triangle", freq: 1200 + k * 1400, to: 900 + k * 1000, glide: 0.02, dur: 0.05, peak: 0.1, attack: 0.001 },
    { wave: "noise", dur: 0.02, peak: 0.04, filter: { type: "bandpass", freq: 3000 + k * 2000, q: 2 } },
  ],
  steal: [...fx.arp("pizz", ["A4", "D5"], 0.05, 0.3, 0.7), fx.pop(700, 1400, 0.14)],
  /** arg = bell value 1..3. */
  bell: (v: number) => (v >= 3 ? [...fx.arp("bell", ["D6", "A6", "D7"], 0.07, 1.4, 0.9)] : v === 2 ? [...fx.arp("bell", ["A5", "E6"], 0.07, 1.2, 0.8)] : [{ inst: "bell", note: "D6", dur: 1, gain: 0.7 }]),
  boom: [fx.thud(70, 0.5, 0.7), ...fx.crack(0.01, 0.35), fx.whoosh(2000, 200, 0.5, 0.08)],
  push: [fx.thud(240, 0.2, 0.4), fx.whoosh(600, 1600, 0.2, 0.06)],
  turn: [{ inst: "marimba", note: "A4", dur: 0.25 }, { inst: "marimba", note: "D5", at: 0.08, dur: 0.4 }],
  pass: [{ inst: "marimba", note: "F#4", dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "D4", at: 0.12, dur: 0.4, gain: 0.4 }],
  topple: [{ inst: "snare", note: 1, gain: 0.5 }, { inst: "snare", note: 1, at: 0.08, gain: 0.5 }, { inst: "snare", note: 1, at: 0.16, gain: 0.6 }, ...fx.chord("brass", ["D4", "F#4", "A4"], 0.5, 0.5, 0.25)],
  roundEnd: [...fx.arp("musicbox", ["D5", "F#5", "A5", "D6"], 0.08, 0.6), ...fx.chord("pad", ["D3", "F#3", "A3"], 1.2, 0.5, 0.3)],
  victory: [
    ...fx.arp("marimba", ["D4", "F#4", "A4", "D5", "F#5", "A5"], 0.07, 0.6),
    ...fx.chord("pad", ["D3", "F#3", "A3", "D4"], 2, 0.9, 0.4),
    { inst: "brass", note: "A4", at: 0.45, dur: 0.6, gain: 0.5 },
    { inst: "brass", note: "D5", at: 0.75, dur: 1.0, gain: 0.6 },
  ],
  denied: [fx.buzz(220, 150, 0.18, 0.08)],
  ui: [fx.click(2400, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const DOMINO_SUITE: SuiteConfig = {
  bpm: 108,
  swing: 0.08,
  tracks: [
    { voice: "marimba", pattern: "D5 . F#5 . A5 . F#5 . | G5 . E5 . C#5 . A4 . | B4 . D5 . F#5 . D5 . | E5 . C#5 . A4 - - .", gain: 0.36 },
    { voice: "musicbox", div: 2, pattern: ". . . . A6 . . . | . . . . G6 . E6 . | . . . . F#6 . . . | . . . . E6 . . .", gain: 0.16 },
    { voice: "pizz", div: 2, pattern: "D3 . A2 . D3 . A2 . | A2 . E3 . A2 . E3 . | B2 . F#3 . B2 . F#3 . | A2 . E3 . A2 . C#3 .", gain: 0.42 },
    { voice: "woodblock", pattern: "x . . . x . . . x . . . x . x .", gain: 0.18 },
    { voice: "tick", div: 2, pattern: "x . x . x . x .", gain: 0.1 },
    { voice: "snare", pattern: "x x x x x x x x x x x x x x x x", gain: 0.12, level: 1 },
    { voice: "brass", div: 8, pattern: "D4+F#4+A4 | E4+A4+C#5 | D4+F#4+B4 | E4+A4+C#5", gain: 0.12, level: 1 },
  ],
  sfx: SFX,
};

export const getDominoSound = defineSuite(DOMINO_SUITE);

export function dominoCues(viewer: number) {
  return (prev: DominoState, next: DominoState) => {
    const cues: string[] = [];
    if (next.phase === "build" && next.activeSeat === viewer && (prev.activeSeat !== viewer || prev.phase !== "build")) cues.push("turn");
    if (next.lastPlace && next.lastPlace !== prev.lastPlace) cues.push(next.lastPlace.kind === "wall" ? "wall" : next.lastPlace.kind === "split" ? "split" : "place");
    if (next.lastPass && next.lastPass !== prev.lastPass) cues.push("pass");
    if (prev.phase === "build" && next.phase === "topple") cues.push("topple");
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
