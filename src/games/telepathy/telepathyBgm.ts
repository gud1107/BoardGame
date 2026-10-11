import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 텔레파시 "Quiet Signal" BGM — a slow, beatless ambient bed in D major
 * (68 BPM): long pad chords, a low upright drone, a sparse kalimba melody and
 * a faint bell shimmer. Deliberately no steady pulse at intensity 0: every
 * client's loop runs on its own clock, so it must never read as a shared
 * count. At intensity 1 (last level, or only a handful of cards left) a soft
 * heartbeat and a high glockenspiel join to lift the tension. Intensity 2
 * is the 💔 mistake moment: the bright layers drop out and a D-minor pad +
 * low choir take over (the board also slows the tempo), then it lifts back.
 *
 * The game's own card/mistake SFX stay in telepathySound.ts; this suite only
 * adds the BGM plus the 효과음-toggle preview and the "last cards are safe" cue.
 */

/**
 * 💔 Mistake mood — tweak these to make the "lights go out" moment stronger
 * or softer. How LONG it lasts is the mistake screen itself: `MISTAKE_MS` in
 * engine.ts (changing that also changes how long the explanation stays up).
 */
export const MISTAKE_MOOD = {
  /** BGM tempo multiplier while the mistake screen is up (1 = unchanged, 0.5 = half speed). */
  tempo: 0.8,
  /** Volume of the D-minor pad that replaces the bright layers (0 = silent). */
  darkPadGain: 0.6,
  /** Volume of the low choir under it. */
  choirGain: 0.35,
};

const SFX = {
  chime: fx.arp("musicbox", ["D5", "F#5", "A5"], 0.08, 0.6),
  /** Everyone else is out of cards — your cards are safe to play now. */
  safeToPlay: [...fx.arp("bell", ["A5", "D6", "F#6"], 0.07, 0.7, 0.9), ...fx.chord("pad", ["D4", "F#4", "A4"], 0.8, 0.5, 0.05)],
  /** Level cleared: music-box run up to D6 resolving on a warm pad + bell. ~2s. */
  levelClear: [
    ...fx.arp("musicbox", ["D5", "F#5", "A5", "D6"], 0.09, 0.7),
    ...fx.chord("pad", ["D4", "F#4", "A4", "D5"], 1.5, 0.9, 0.36),
    { inst: "bell", note: "A5", at: 0.36, dur: 1.3 },
    { inst: "upright", note: "D3", at: 0.36, dur: 1.2, gain: 0.8 },
  ],
  /** Same, plus a glockenspiel sparkle for a mistake-free level. */
  levelClearPerfect: [
    ...fx.arp("musicbox", ["D5", "F#5", "A5", "D6"], 0.09, 0.7),
    ...fx.chord("pad", ["D4", "F#4", "A4", "D5"], 1.5, 0.9, 0.36),
    { inst: "bell", note: "A5", at: 0.36, dur: 1.3 },
    { inst: "upright", note: "D3", at: 0.36, dur: 1.2, gain: 0.8 },
    ...fx.arp("glock", ["F#6", "A6", "D7", "A6", "D7"], 0.07, 0.5, 0.8).map((p) => ({ ...p, at: (p.at ?? 0) + 0.7 })),
  ],
  /** Clearing a ❤️ level: warm harp run into a choir chord. */
  levelClearLife: [
    ...fx.arp("harp", ["D4", "F#4", "A4", "D5", "F#5"], 0.07, 0.8),
    ...fx.chord("choir", ["D4", "F#4", "A4", "D5"], 1.7, 0.9, 0.36),
    { inst: "bell", note: "F#5", at: 0.36, dur: 1.4 },
    { inst: "upright", note: "D3", at: 0.36, dur: 1.4, gain: 0.8 },
  ],
  /** Clearing a ⚡ level: an upward whoosh into bright glock + bell sparkle. */
  levelClearStar: [
    fx.whoosh(700, 4200, 0.3, 0.1),
    ...fx.arp("glock", ["A5", "D6", "F#6", "A6", "D7"], 0.06, 0.6, 0.9).map((p) => ({ ...p, at: (p.at ?? 0) + 0.2 })),
    ...fx.chord("pad", ["D4", "F#4", "A4", "E5"], 1.5, 0.9, 0.5),
    { inst: "bell", note: "D6", at: 0.5, dur: 1.4 },
  ],
  /** Last level cleared: a ~5s cadence D – G – A – D with choir, strings and bells. */
  victory: [
    ...fx.arp("musicbox", ["D5", "F#5", "A5", "D6"], 0.1, 0.8),
    ...fx.chord("pad", ["D4", "F#4", "A4", "D5"], 1.3, 0.9, 0.45),
    ...fx.arp("glock", ["F#6", "A6", "D7"], 0.08, 0.6, 0.8).map((p) => ({ ...p, at: (p.at ?? 0) + 0.8 })),
    ...fx.chord("strings", ["G3", "B3", "D4", "G4"], 0.9, 0.9, 1.6),
    { inst: "upright", note: "G2", at: 1.6, dur: 0.9 },
    ...fx.chord("strings", ["A3", "C#4", "E4", "A4"], 0.9, 0.95, 2.4),
    { inst: "upright", note: "A2", at: 2.4, dur: 0.9 },
    ...fx.chord("choir", ["D4", "F#4", "A4", "D5"], 2.6, 1, 3.2),
    ...fx.chord("pad", ["D3", "A3", "F#4"], 2.6, 0.8, 3.2),
    { inst: "bell", note: "D6", at: 3.2, dur: 2.2 },
    { inst: "bell", note: "A5", at: 3.5, dur: 1.9 },
    { inst: "upright", note: "D2", at: 3.2, dur: 2.2 },
    ...fx.arp("musicbox", ["A5", "D6", "F#6", "A6"], 0.12, 0.8, 0.7).map((p) => ({ ...p, at: (p.at ?? 0) + 3.6 })),
  ],
  /** New personal best: a rising whoosh, a quick glock run, a brass "ta-da" and coin sparkles. ~1.8s. */
  newRecord: [
    fx.whoosh(500, 5000, 0.35, 0.12),
    ...fx.arp("glock", ["D6", "E6", "F#6", "A6", "B6", "D7"], 0.045, 0.4, 0.85).map((p) => ({ ...p, at: (p.at ?? 0) + 0.15 })),
    ...fx.chord("brass", ["D4", "A4"], 0.18, 1, 0.45),
    ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.1, 1.1, 0.68),
    ...fx.chord("pad", ["D4", "F#4", "A4", "D5"], 1.2, 0.8, 0.68),
    { inst: "bell", note: "A6", at: 0.68, dur: 1.1, gain: 0.7 },
    ...fx.coin(0.9, 2600, 0.1),
    ...fx.coin(1.02, 3100, 0.1),
    ...fx.coin(1.14, 3600, 0.09),
  ],
  /** Game over (hearts gone): a slow, falling D-minor line that doesn't resolve. ~3.5s. */
  defeat: [
    ...fx.arp("musicbox", ["A5", "F5", "D5", "A4"], 0.32, 1.1, 0.85),
    ...fx.chord("pad", ["D3", "F3", "A3"], 1.4, 0.8, 0.1),
    ...fx.chord("pad", ["Bb2", "F3", "D4"], 1.3, 0.75, 1.4),
    ...fx.chord("choir", ["G2", "D3", "Bb3"], 1.8, 0.7, 2.2),
    { inst: "upright", note: "D2", at: 0.1, dur: 1.3, gain: 0.8 },
    { inst: "upright", note: "Bb1", at: 1.4, dur: 1.2, gain: 0.75 },
    { inst: "upright", note: "G1", at: 2.2, dur: 1.6, gain: 0.7 },
    { inst: "bell", note: "D5", at: 2.6, dur: 1.4, gain: 0.5 },
  ],
} satisfies Record<string, SfxRecipe>;

export const TELEPATHY_SUITE: SuiteConfig = {
  bpm: 68,
  bgmLevel: 0.24,
  tracks: [
    // One token per bar, each chord held two bars: D – G – Bm – A.
    { voice: "pad", div: 16, gain: 0.55, maxLevel: 2, pattern: "D3+A3+E4 - G3+D4+F#4 - B2+F#3+D4 - A2+E3+C#4 -" },
    { voice: "upright", div: 16, gain: 0.45, pattern: "D2 - G2 - B1 - A1 -" },
    {
      voice: "kalimba",
      div: 4,
      gain: 0.5,
      maxLevel: 2,
      pattern: "F#4 . A4 . | E5 . D5 . | D4 . G4 B4 | A4 . . . | D4 F#4 . A4 | C#5 . . . | E4 . A4 . | C#5 . B4 .",
    },
    { voice: "bell", div: 8, gain: 0.18, maxLevel: 2, pattern: "A5 . . . . . . . F#5 . . . . . . ." },
    // Intensity 1: heartbeat + glock sparkle.
    { voice: "softKick", div: 4, gain: 0.55, level: 1, pattern: "x . x . | . . . . | x . x . | . . . ." },
    { voice: "glock", div: 4, gain: 0.3, level: 1, maxLevel: 2, pattern: "D6 . . . | . . A5 . | . . . . | F#5 . . . | B5 . . . | . . A5 . | . . . . | E6 . . ." },
    // Intensity 2 (💔 mistake): the light goes out — minor pad + low choir.
    { voice: "pad", div: 16, gain: MISTAKE_MOOD.darkPadGain, level: 2, pattern: "D3+F3+A3 - Bb2+F3+D4 -" },
    { voice: "choir", div: 16, gain: MISTAKE_MOOD.choirGain, level: 2, pattern: "D3+A3 - F3+D4 -" },
  ],
  sfx: SFX,
};

export const getTelepathyBgm = defineSuite(TELEPATHY_SUITE);
