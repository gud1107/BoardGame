import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 라스베가스 "Midnight Strip Swing" BGM — a glittering big-band swing at
 * 150 BPM in F major (F6–D7–Gm7–C7): a walking upright, swung ride, piano
 * comping on 2 and 4, brass shout stabs and a sax-ish lead. Replaces the
 * never-shipped `las-vegas.mp3` (bgmManager.ts) — procedural, no audio
 * files. Dice/chip/bill SFX stay in the shared soundEngine.
 */
export const LAS_VEGAS_BGM: SuiteConfig = {
  bpm: 150,
  swing: 0.33,
  tracks: [
    { voice: "upright", div: 4, pattern: "F2 A2 C3 D3 | D2 F#2 A2 C3 | G2 Bb2 D3 F3 | C3 E3 G3 Bb2", gain: 1 },
    { voice: "ride", div: 2, pattern: "x . x x x . x x", gain: 1 },
    { voice: "piano", div: 4, pattern: ". F3+A3+D4 . F3+A3+D4 | . F#3+C4+D4 . F#3+C4+D4 | . F3+Bb3+D4 . F3+Bb3+D4 | . E3+Bb3+C4 . E3+Bb3+C4", gain: 0.45 },
    { voice: "brass", div: 2, pattern: ". . . . . . A4+C5 - | . . . . . . F#4+C5 - | . . . . . . Bb4+D5 - | . . G4+Bb4 . . . E4+G4 -", gain: 0.5 },
    { voice: "lead", div: 2, pattern: "C5 - A4 C5 D5 - F5 - | E5 - D5 - C5 - A4 - | Bb4 - D5 F5 G5 - F5 D5 | E5 - - - C5 - . .", gain: 0.4 },
    { voice: "snare", div: 4, pattern: ". . . x", gain: 0.25 },
  ],
  sfx: { preview: [...fx.coin(0, 2600, 0.12), ...fx.chord("brass", ["F4", "A4", "C5"], 0.5, 0.8, 0.08)] },
};
export const getLasVegasBgm = defineSuite(LAS_VEGAS_BGM);
