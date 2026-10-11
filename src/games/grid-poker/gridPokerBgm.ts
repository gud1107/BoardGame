import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 그리드 포커 "Deep House Table" BGM — a smooth deep-house groove at
 * 122 BPM in A minor (Am9–Fmaj9–Am7–E7): four-on-the-floor kick, off-beat
 * open hats, a clap backbeat, electric-piano chord stabs and a sub bass.
 * Replaces the never-shipped `grid-poker.mp3` (bgmManager.ts) — procedural,
 * no audio files. Scoring SFX stay in the shared soundEngine.
 */
const STAB = (chord: string) => `. . . ${chord} . . ${chord} . . . . . . . . .`;

export const GRID_POKER_BGM: SuiteConfig = {
  bpm: 122,
  tracks: [
    { voice: "kick", div: 4, pattern: "X x x x", gain: 0.6 },
    { voice: "openHat", div: 2, pattern: ". x . x . x . x", gain: 0.8 },
    { voice: "hat", pattern: "x . x x x . x x x . x x x . x x", gain: 0.5 },
    { voice: "clap", div: 4, pattern: ". x . x", gain: 0.5 },
    { voice: "epiano", pattern: [STAB("C4+E4+G4+B4"), STAB("C4+F4+A4+E5"), STAB("A3+C4+E4+G4"), STAB("G#3+B3+D4+F4")].join(" | "), gain: 0.45 },
    { voice: "sub808", div: 2, pattern: "A1 . . A1 . . A1 . | F1 . . F1 . . F1 . | A1 . . A1 . . A1 . | E1 . . E1 . E1 . .", gain: 0.7 },
  ],
  sfx: { preview: fx.chord("epiano", ["A4", "C5", "E5", "G5"], 0.6) },
};
export const getGridPokerBgm = defineSuite(GRID_POKER_BGM);
