import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 러브 윈즈 올 "Heartbreak Showdown" BGM — a sultry late-night R&B/synth-pop
 * groove at 96 BPM in D♭ major: electric-piano 9th chords, a gliding 808,
 * finger-snap claps and a breathy lead. In the second betting street and the
 * showdown (intensity 1) 16th hats and a string pad raise the stakes. The
 * game's own soundEngine SFX (card snap, clash, KO…) are untouched.
 */
export const LOVE_WINS_ALL_BGM: SuiteConfig = {
  bpm: 96,
  tracks: [
    { voice: "epiano", div: 8, pattern: "Db4+F4+Ab4+C5 . Bb3+Db4+F4+Ab4 . Gb3+Bb3+Db4+F4 . Ab3+C4+Eb4+Gb4 .", gain: 0.5 },
    { voice: "sub808", div: 2, pattern: "Db2 - - - . . Db2 . | Bb1 - - - . . Bb1 . | Gb1 - - - . . Gb1 . | Ab1 - - - . Ab1 Ab1 .", gain: 0.8 },
    { voice: "softKick", div: 2, pattern: "X . . x . . X .", gain: 1 },
    { voice: "clap", div: 4, pattern: ". x . x", gain: 0.6 },
    { voice: "lead", div: 2, pattern: "F5 - Eb5 Db5 - - Ab4 - | . . . . Bb4 Db5 Eb5 - | F5 - Ab5 - Gb5 F5 Eb5 - | Db5 - - - . . . .", gain: 0.45 },
    { voice: "hat", pattern: "x x X x x x X x x x X x x x X x", gain: 0.7, level: 1 },
    { voice: "strings", div: 16, pattern: "Ab4+C5 F4+Ab4 Db4+F4 Eb4+Gb4", gain: 0.4, level: 1 },
  ],
  sfx: { preview: fx.chord("epiano", ["Db5", "F5", "Ab5"], 0.8) },
};
export const getLoveWinsAllBgm = defineSuite(LOVE_WINS_ALL_BGM);
