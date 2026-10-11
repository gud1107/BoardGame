import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 텔레파시 "Quiet Signal" BGM — a slow, beatless ambient bed in D major
 * (68 BPM): long pad chords, a low upright drone, a sparse kalimba melody and
 * a faint bell shimmer. Deliberately no steady pulse at intensity 0: every
 * client's loop runs on its own clock, so it must never read as a shared
 * count. At intensity 1 (last level, or only a handful of cards left) a soft
 * heartbeat and a high glockenspiel join to lift the tension.
 *
 * The game's own card/mistake SFX stay in telepathySound.ts; this suite only
 * adds the BGM plus the 효과음-toggle preview and the "last cards are safe" cue.
 */

const SFX = {
  chime: fx.arp("musicbox", ["D5", "F#5", "A5"], 0.08, 0.6),
  /** Everyone else is out of cards — your cards are safe to play now. */
  safeToPlay: [...fx.arp("bell", ["A5", "D6", "F#6"], 0.07, 0.7, 0.9), ...fx.chord("pad", ["D4", "F#4", "A4"], 0.8, 0.5, 0.05)],
} satisfies Record<string, SfxRecipe>;

export const TELEPATHY_SUITE: SuiteConfig = {
  bpm: 68,
  bgmLevel: 0.24,
  tracks: [
    // One token per bar, each chord held two bars: D – G – Bm – A.
    { voice: "pad", div: 16, gain: 0.55, pattern: "D3+A3+E4 - G3+D4+F#4 - B2+F#3+D4 - A2+E3+C#4 -" },
    { voice: "upright", div: 16, gain: 0.45, pattern: "D2 - G2 - B1 - A1 -" },
    {
      voice: "kalimba",
      div: 4,
      gain: 0.5,
      pattern: "F#4 . A4 . | E5 . D5 . | D4 . G4 B4 | A4 . . . | D4 F#4 . A4 | C#5 . . . | E4 . A4 . | C#5 . B4 .",
    },
    { voice: "bell", div: 8, gain: 0.18, pattern: "A5 . . . . . . . F#5 . . . . . . ." },
    // Intensity 1: heartbeat + glock sparkle.
    { voice: "softKick", div: 4, gain: 0.55, level: 1, pattern: "x . x . | . . . . | x . x . | . . . ." },
    { voice: "glock", div: 4, gain: 0.3, level: 1, pattern: "D6 . . . | . . A5 . | . . . . | F#5 . . . | B5 . . . | . . A5 . | . . . . | E6 . . ." },
  ],
  sfx: SFX,
};

export const getTelepathyBgm = defineSuite(TELEPATHY_SUITE);
