import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 쇼미더코인 "Cypher Vault" BGM — a head-nodding boom-bap beat at 90 BPM
 * (swung) in C minor: a dusty minor piano loop, an 808 sub, kick/snare,
 * swung hats and vinyl crackle. During the betting street and the showdown
 * (intensity 1) brass stabs drop in. The game's own coin-blast SFX stays in
 * the shared soundEngine.
 */
export const SHOW_ME_THE_COIN_BGM: SuiteConfig = {
  bpm: 90,
  swing: 0.28,
  tracks: [
    { voice: "piano", div: 2, pattern: "C4+Eb4+G4 . . Eb4 G4 . Bb4 . | Ab3+C4+Eb4 . . C4 Eb4 . G4 . | F3+Ab3+C4 . . Ab3 C4 . F4 . | G3+B3+D4 . . D4 F4 . G4 .", gain: 0.5 },
    { voice: "sub808", div: 4, pattern: "C2 . . C2 | Ab1 . . Ab1 | F1 . . F1 | G1 . G1 .", gain: 0.8 },
    { voice: "kick", pattern: "X . . . . . . x . . X . . . . .", gain: 0.7 },
    { voice: "snare", div: 4, pattern: ". X . X", gain: 0.7 },
    { voice: "hat", div: 2, pattern: "x x x x x x x x", gain: 0.8 },
    { voice: "crackle", pattern: "x . . x . x . . . . x . . . x .", gain: 1 },
    { voice: "brass", div: 4, pattern: ". . C5+Eb5 . | . . Ab4+C5 . | . . F4+Ab4 . | . . G4+B4 G4+B4", gain: 0.45, level: 1 },
  ],
  sfx: { preview: [...fx.coin(0, 2600, 0.12), ...fx.coin(0.08, 3000, 0.1)] },
};
export const getShowMeTheCoinBgm = defineSuite(SHOW_ME_THE_COIN_BGM);
