import { defineSuite, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 망각의 지뢰 2 "Ticking Fuse" BGM — the first game's cave turned into a
 * bomb-disposal thriller at 112 BPM in D minor: a pulsing synth bass, a
 * clock tick/tock on every beat, a nervous arpeggio and a low pad. While any
 * time bomb is armed on the board (intensity 1) a heartbeat kick and a
 * high string tremolo join. Gameplay SFX stay in the shared soundEngine.
 */
export const MINE2_BGM: SuiteConfig = {
  bpm: 112,
  tracks: [
    { voice: "synthBass", div: 2, pattern: "D2 D2 D2 D2 D2 D2 D2 D2 | Bb1 Bb1 Bb1 Bb1 C2 C2 C2 C2", gain: 0.6 },
    { voice: "tick", div: 4, pattern: "X . x .", gain: 0.9 },
    { voice: "tock", div: 4, pattern: ". x . x", gain: 0.9 },
    { voice: "arp", pattern: "D4 F4 A4 D5 A4 F4 D4 F4 D4 F4 A4 D5 A4 F4 D4 F4 | Bb3 D4 F4 Bb4 F4 D4 Bb3 D4 C4 E4 G4 C5 G4 E4 C4 E4", gain: 0.45 },
    { voice: "pad", div: 32, pattern: "D3+F3+A3 Bb2+D3+F3", gain: 0.5 },
    { voice: "kick", div: 4, pattern: "X x . .", gain: 0.5, level: 1 },
    { voice: "strings", div: 16, pattern: "A5 Bb5 A5 C6", gain: 0.35, level: 1 },
  ],
  sfx: { preview: [{ inst: "tick", note: 1 }, { inst: "tick", note: 1, at: 0.25 }, { inst: "tick", note: 1, at: 0.5 }] },
};
export const getMine2Bgm = defineSuite(MINE2_BGM);
