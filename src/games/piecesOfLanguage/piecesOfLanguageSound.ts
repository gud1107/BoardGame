import { defineSuite, fx, type SfxPart, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { FeedbackColor, PiecesOfLanguageState } from "./engine";

/**
 * 언어의 조각 "Ancient Glyphs" suite — a hushed decoding chamber in
 * F lydian at 80 BPM: kalimba patterns, a glassy pad, a soft bass pulse and
 * a distant bell. When the shared attempt cap runs low (intensity 1) a
 * ticking clock creeps in. SFX: each guess lights up one syllable at a time,
 * each with its own tone (🟢 bright bell, 🟡 mid kalimba, 🔴 dull thud), then
 * a full glyph-unlock flourish for the exact match.
 */

const CODE: Record<FeedbackColor, number> = { green: 1, yellow: 2, red: 3 };

/** feedback → base-4 digits behind a leading 1, so the recipe can decode it from one number. */
export function encodeFeedback(feedback: FeedbackColor[]): number {
  return parseInt(`1${feedback.map((f) => CODE[f]).join("")}`, 4);
}

function syllableLights(code: number): SfxPart[] {
  const digits = code.toString(4).slice(1).split("").map(Number);
  return digits.flatMap((d, i): SfxPart[] => {
    const at = i * 0.16;
    if (d === 1) return [{ inst: "bell", note: "C6", at, gain: 0.7 }, { inst: "kalimba", note: "G5", at }];
    if (d === 2) return [{ inst: "kalimba", note: "D5", at }];
    return [fx.thud(160, 0.18, 0.3, at), { inst: "pizz", note: "F3", at, gain: 0.6 }];
  });
}

const SFX = {
  guess: (code: number) => [fx.click(1300, 0.08), ...syllableLights(code)],
  solve: [...fx.arp("kalimba", ["F4", "A4", "C5", "E5", "G5", "B5", "C6"], 0.06, 1), ...fx.chord("bell", ["F5", "A5", "C6"], 1.8, 0.7, 0.45), { wave: "noise", at: 0.4, dur: 1.2, peak: 0.04, attack: 0.3, filter: { type: "bandpass", freq: 6000, q: 2 } }],
  draw: [...fx.chord("pad", ["F3", "B3", "E4"], 1.6, 1.2), { inst: "bell", note: "F4", at: 0.1 }],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const PIECES_OF_LANGUAGE_SUITE: SuiteConfig = {
  bpm: 80,
  tracks: [
    { voice: "kalimba", pattern: "F4 . C5 . A4 . E5 . G4 . C5 . B4 . A4 . | D4 . A4 . F4 . C5 . E4 . B4 . G4 . A4 .", gain: 0.55 },
    { voice: "pad", div: 16, pattern: "F3+A3+C4+E4 D3+F3+A3+C4 G3+B3+D4 C3+E3+G3+B3", gain: 0.6 },
    { voice: "bass", div: 8, pattern: "F2 . D2 . G2 . C2 .", gain: 0.6 },
    { voice: "bell", div: 32, pattern: "B5 E6", gain: 0.25 },
    { voice: "tick", div: 4, pattern: "X x x x", gain: 0.7, level: 1 },
  ],
  sfx: SFX,
};

export const getPiecesOfLanguageSound = defineSuite(PIECES_OF_LANGUAGE_SUITE);

export function piecesOfLanguageSoundCues(prev: PiecesOfLanguageState, next: PiecesOfLanguageState): Cue[] {
  if (prev === next || next.history.length <= prev.history.length) return [];
  const g = next.history[next.history.length - 1];
  if (g.isMatch) return ["solve"];
  const cues: Cue[] = [{ name: "guess", arg: encodeFeedback(g.feedback) }];
  if (next.phase === "gameOver") cues.push("draw");
  return cues;
}
