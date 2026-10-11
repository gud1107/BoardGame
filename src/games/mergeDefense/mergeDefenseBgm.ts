import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 랜덤 합성 디펜스 "Fortress Pulse" BGM — an epic EDM tower-defence loop at
 * 132 BPM in A minor (Am–F–C–G): a 16th synth arpeggio, an 8th-note synth
 * bass, four-on-the-floor kick, clap backbeat, off-beat hats and a wide pad.
 * On boss waves (intensity 1) brass stabs and taiko hits join. Every hit/
 * gold/reel SFX stays in the shared soundEngine.
 */
export const MERGE_DEFENSE_BGM: SuiteConfig = {
  bpm: 132,
  tracks: [
    {
      voice: "arp",
      pattern:
        "A4 C5 E5 A5 E5 C5 A4 C5 A4 C5 E5 A5 E5 C5 A4 C5 | F4 A4 C5 F5 C5 A4 F4 A4 F4 A4 C5 F5 C5 A4 F4 A4 | C5 E5 G5 C6 G5 E5 C5 E5 C5 E5 G5 C6 G5 E5 C5 E5 | G4 B4 D5 G5 D5 B4 G4 B4 G4 B4 D5 G5 D5 B4 G4 B4",
      gain: 0.4,
    },
    { voice: "synthBass", div: 2, pattern: "A1 A2 A1 A2 A1 A2 A1 A2 | F1 F2 F1 F2 F1 F2 F1 F2 | C2 C3 C2 C3 C2 C3 C2 C3 | G1 G2 G1 G2 G1 G2 G1 G2", gain: 0.6 },
    { voice: "kick", div: 4, pattern: "X x x x", gain: 0.6 },
    { voice: "clap", div: 4, pattern: ". x . x", gain: 0.5 },
    { voice: "hat", div: 2, pattern: ". x . x . x . x", gain: 0.7 },
    { voice: "pad", div: 16, pattern: "A3+C4+E4 F3+A3+C4 C4+E4+G4 G3+B3+D4", gain: 0.45 },
    { voice: "brass", div: 4, pattern: "A3+E4 . . A3+E4 | F3+C4 . . F3+C4 | C4+G4 . . C4+G4 | G3+D4 . G3+D4 G3+D4", gain: 0.45, level: 1 },
    { voice: "taiko", div: 4, pattern: "X . . x", gain: 0.5, level: 1 },
  ],
  sfx: { preview: fx.arp("arp", ["A4", "C5", "E5", "A5"], 0.05, 0.2) },
};
export const getMergeDefenseBgm = defineSuite(MERGE_DEFENSE_BGM);
