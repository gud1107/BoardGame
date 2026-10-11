import { defineSuite, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 시티 체이스 "Night Pursuit" BGM — a 70s cop-show spy-funk groove at
 * 118 BPM in E minor: a syncopated synth-bass riff, clav-style stabs on the
 * off-beats, 16th hats and a backbeat. From round 9 on (intensity 1) a
 * two-tone siren pad and an extra tom fill crank the chase up. Gameplay SFX
 * stay in the shared soundEngine (`playCityEventSound`), so this suite is
 * BGM-only plus a HUD confirmation blip.
 */
export const CITY_CHASE_BGM: SuiteConfig = {
  bpm: 118,
  tracks: [
    { voice: "synthBass", pattern: "E2 . . E2 . . G2 . A2 . . A2 . B2 . D3 | E2 . . E2 . . G2 . A2 . G2 . E2 . D2 .", gain: 0.8 },
    { voice: "stab", pattern: ". . E4+G4+B4 . . . E4+G4+B4 . . . E4+G4+B4 . . . . . | . . A3+C4+E4 . . . A3+C4+E4 . . . B3+D#4+F#4 . . . . .", gain: 0.6 },
    { voice: "kick", div: 2, pattern: "X . . x X . . .", gain: 0.6 },
    { voice: "snare", div: 4, pattern: ". x . x", gain: 0.8 },
    { voice: "hat", pattern: "x x X x x x X x x x X x x x X x", gain: 0.8 },
    { voice: "lead", div: 2, pattern: "B4 - - - D5 - E5 - | G5 - F#5 - E5 - D5 - | B4 - - - A4 - G4 - | F#4 - - - - - . .", gain: 0.5 },
    { voice: "pad", div: 8, pattern: "B4 G4 B4 G4", gain: 0.5, level: 1 },
    { voice: "tom", pattern: ". . . . . . . . . . . . x x x x", gain: 0.5, level: 1 },
  ],
  sfx: { preview: [{ wave: "square", freq: 960, to: 760, glide: 0.25, dur: 0.3, peak: 0.08 }, { wave: "square", freq: 760, to: 960, glide: 0.25, dur: 0.3, peak: 0.08, at: 0.3 }] },
};
export const getCityChaseBgm = defineSuite(CITY_CHASE_BGM);
