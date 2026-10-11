import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 로스트 시티 "Expedition" BGM — a jungle-ruins adventure march at 104 BPM
 * in E minor: a marimba ostinato, tom-tom expedition drums, a heroic horn
 * melody and a low string bed. When the draw pile runs low (≤ 8 cards,
 * intensity 1) a shaker and timpani push toward the finish. Card SFX stay in
 * the shared soundEngine.
 */
export const LOST_CITIES_BGM: SuiteConfig = {
  bpm: 104,
  tracks: [
    { voice: "marimba", pattern: "E4 . B4 . G4 . B4 . E4 . B4 . G4 . B4 . | C4 . G4 . E4 . G4 . D4 . A4 . F#4 . A4 .", gain: 0.6 },
    { voice: "tom", pattern: "X . . x . . x . X . x . x . . .", gain: 0.5 },
    { voice: "brass", div: 4, pattern: "E4 - G4 B4 | A4 - G4 F#4 | E4 - G4 B4 | D5 - - - | C5 - B4 A4 | B4 - G4 E4 | F#4 - A4 F#4 | E4 - - -", gain: 0.55 },
    { voice: "strings", div: 16, pattern: "E3+B3 C3+G3 D3+A3 B2+F#3", gain: 0.5 },
    { voice: "shaker", pattern: "x x X x x x X x x x X x x x X x", gain: 0.7, level: 1 },
    { voice: "timpani", div: 8, pattern: "E2 . B1 .", gain: 0.5, level: 1 },
  ],
  sfx: { preview: fx.arp("marimba", ["E5", "G5", "B5"], 0.07, 0.4) },
};
export const getLostCitiesBgm = defineSuite(LOST_CITIES_BGM);
