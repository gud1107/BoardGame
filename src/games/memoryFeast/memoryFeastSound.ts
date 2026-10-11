import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { MemoryFeastState } from "./engine";

/**
 * 기억의 만찬 "Masquerade Banquet" suite — a death-game dinner party: an
 * elegant-but-uneasy A minor waltz (3/4, 104 BPM, 12 sixteenths per bar) on
 * music box over pizzicato strings and a harpsichord off-beat. The open
 * (guessing) phase, intensity 1, adds a ticking clock and a low string
 * drone. SFX: tokens clinking onto a plate (one clink per token, capped),
 * a cloche lift on every plate peek, a bright bell pair for a match and a
 * dissonant thud for a penalty.
 */

const SFX = {
  place: (amount: number) => Array.from({ length: Math.min(6, Math.max(1, amount)) }, (_, i) => fx.coin(i * 0.07, 2100 + (i % 3) * 260, 0.1)).flat(),
  match: [...fx.chord("bell", ["E5", "A5"], 1.2, 0.8), ...fx.arp("musicbox", ["A5", "C6", "E6", "A6"], 0.07, 0.8, 0.9).map((p) => ({ ...p, at: (p.at ?? 0) + 0.15 }))],
  miss: [fx.thud(120, 0.3, 0.4), ...fx.chord("strings", ["A2", "Bb2", "E3"], 0.8, 0.9, 0.02)],
  victory: [...fx.arp("harpsichord", ["A3", "C4", "E4", "A4", "C5", "E5", "A5"], 0.06, 0.7), ...fx.chord("bell", ["A4", "C#5", "E5"], 1.8, 0.8, 0.45)],
  draw: fx.chord("bell", ["A4", "E5"], 1.4, 0.7),
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const MEMORY_FEAST_SUITE: SuiteConfig = {
  bpm: 104,
  tracks: [
    {
      voice: "musicbox",
      div: 2,
      pattern: "E5 - A5 - B5 C6 | B5 - A5 - E5 - | F5 - E5 - D5 C5 | B4 - - - E5 - | C5 - D5 - E5 A5 | G#5 - B5 - E5 - | F5 - D5 - B4 G#4 | A4 - - - . .",
      gain: 0.65,
    },
    { voice: "pizz", div: 4, pattern: "A2 . . | A2 . . | D3 . . | E2 . . | A2 . . | E2 . . | D3 . . | A2 . .", gain: 0.9 },
    { voice: "harpsichord", div: 4, pattern: ". A3+C4+E4 A3+C4+E4 | . A3+C4+E4 A3+C4+E4 | . D4+F4+A4 D4+F4+A4 | . E3+G#3+B3 E3+G#3+B3 | . A3+C4+E4 A3+C4+E4 | . E3+G#3+B3 E3+G#3+B3 | . D4+F4+A4 E3+G#3+B3 | . A3+C4+E4 .", gain: 0.45 },
    { voice: "tick", div: 4, pattern: "X x x", gain: 0.8, level: 1 },
    { voice: "strings", div: 24, pattern: "A2+E3 D3+A3 A2+E3 E2+B2", gain: 0.5, level: 1 },
  ],
  sfx: SFX,
};

export const getMemoryFeastSound = defineSuite(MEMORY_FEAST_SUITE);

export function memoryFeastSoundCues(prev: MemoryFeastState, next: MemoryFeastState): Cue[] {
  if (prev === next) return [];
  if (prev.phase !== "match-end" && next.phase === "match-end") return [next.winner ? "victory" : "draw"];
  const cues: Cue[] = [];
  if (next.flashSeq !== prev.flashSeq && next.lastFlash) cues.push({ name: "place", arg: next.lastFlash.amount });
  if (next.guessSeq !== prev.guessSeq) {
    const claimed = next.plates.some((p, i) => p.claimedBy !== null && prev.plates[i]?.claimedBy === null);
    if (claimed) cues.push("match");
    else if (next.penalties.p1 + next.penalties.p2 > prev.penalties.p1 + prev.penalties.p2) cues.push("miss");
  }
  return cues;
}
