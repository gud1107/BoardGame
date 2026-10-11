import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 소환사의 협곡 "Rift Battle Hymn" BGM — an epic fantasy-battle cue at
 * 110 BPM in D minor: a driving 16th string ostinato, taiko hits, a heroic
 * horn line and a timpani pulse (Dm–B♭–C–A). While the rift resolves
 * (intensity 1) a choir and a snare roll take over the climax. The game's
 * own death/seal/survive SFX stay in the shared soundEngine.
 */
export const SUMMONERS_RIFT_BGM: SuiteConfig = {
  bpm: 110,
  tracks: [
    {
      voice: "strings",
      pattern:
        "D4 D4 A3 D4 F4 D4 A3 D4 D4 D4 A3 D4 F4 D4 A3 D4 | Bb3 Bb3 F3 Bb3 D4 Bb3 F3 Bb3 C4 C4 G3 C4 E4 C4 G3 C4 | D4 D4 A3 D4 F4 D4 A3 D4 D4 D4 A3 D4 F4 D4 A3 D4 | A3 A3 E3 A3 C#4 A3 E3 A3 A3 A3 E3 A3 C#4 E4 A4 C#5",
      gain: 0.45,
    },
    { voice: "taiko", pattern: "X . . x . . x . X . x . . . x .", gain: 0.6 },
    { voice: "brass", div: 4, pattern: "D4 - F4 A4 | Bb4 - A4 G4 | A4 - D5 - | C#5 - - - | D5 - C5 Bb4 | A4 - G4 F4 | E4 - F4 G4 | A4 - - -", gain: 0.5 },
    { voice: "timpani", div: 8, pattern: "D2 . A1 . | Bb1 . C2 . | D2 . A1 . | A1 . A1 .", gain: 0.5 },
    { voice: "choir", div: 16, pattern: "D4+F4+A4 Bb3+D4+F4 C4+E4+G4 A3+C#4+E4", gain: 0.6, level: 1 },
    { voice: "snare", pattern: "x x x x x x x x x x x x X x X X", gain: 0.3, level: 1 },
  ],
  sfx: { preview: [{ inst: "taiko", note: 1 }, ...fx.chord("brass", ["D4", "A4", "D5"], 0.8, 1, 0.05)] },
};
export const getSummonersRiftBgm = defineSuite(SUMMONERS_RIFT_BGM);
