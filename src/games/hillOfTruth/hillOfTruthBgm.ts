import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 진실의 고개 "Truth Seeker" BGM — a noir interrogation-room lounge at
 * 84 BPM (swung) in C minor: a brooding piano figure, a walking upright,
 * brushes, a vibraphone answering each phrase and a slow string drone. The
 * correct/wrong/failed-declaration SFX stay in the shared soundEngine.
 */
export const HILL_OF_TRUTH_BGM: SuiteConfig = {
  bpm: 84,
  swing: 0.3,
  tracks: [
    { voice: "piano", div: 2, pattern: "C4+Eb4+G4 . . Bb3 . . G4 . | Ab3+C4+Eb4 . . G3 . . Eb4 . | F3+Ab3+C4 . . Eb4 . D4 . C4 | G3+B3+D4 . . . F4 . D4 .", gain: 0.5 },
    { voice: "upright", div: 4, pattern: "C3 Eb3 G3 Bb2 | Ab2 C3 Eb3 G2 | F2 Ab2 C3 Eb3 | G2 B2 D3 G2", gain: 0.9 },
    { voice: "brush", div: 2, pattern: "x x X x x x X x", gain: 0.7 },
    { voice: "vibes", div: 2, pattern: ". . . . . . . . | . . . . G5 - Eb5 - | . . . . . . . . | . . . . B4 - D5 -", gain: 0.45 },
    { voice: "strings", div: 32, pattern: "C3+G3 F3+C4", gain: 0.35 },
  ],
  sfx: { preview: fx.arp("vibes", ["C5", "Eb5", "G5"], 0.09, 0.8) },
};
export const getHillOfTruthBgm = defineSuite(HILL_OF_TRUTH_BGM);
