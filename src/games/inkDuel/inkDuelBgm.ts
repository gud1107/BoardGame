import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 낙서 결투 "Sketchbook Scuffle" BGM — a cheeky cartoon-brawl romp at
 * 128 BPM in G major: bouncy pizzicato bass, a whistled hook, glockenspiel
 * doodles, woodblock "pencil taps" and a kick/snare. The game's own
 * soundEngine SFX (launch, impact, walls, victory) are untouched.
 */
export const INK_DUEL_BGM: SuiteConfig = {
  bpm: 128,
  tracks: [
    { voice: "pizz", div: 2, pattern: "G2 D3 G2 D3 C3 G3 C3 G3 | D3 A3 D3 A3 G2 D3 B2 D3", gain: 1 },
    { voice: "whistle", div: 2, pattern: "D5 - B4 G4 C5 - E5 - | D5 - B4 G4 A4 - - . | D5 - B4 G4 C5 - E5 G5 | F#5 - A5 - G5 - - .", gain: 0.6 },
    { voice: "glock", pattern: "G5 . . B5 . . D6 . . . . . . . . . | . . . . . . . . E6 . D6 . B5 . . .", gain: 0.4 },
    { voice: "woodblock", pattern: ". . x . . . x . . . x . . x x .", gain: 0.5 },
    { voice: "softKick", div: 4, pattern: "X . X .", gain: 1 },
    { voice: "snare", div: 4, pattern: ". x . x", gain: 0.5 },
  ],
  sfx: { preview: [{ wave: "noise", dur: 0.18, peak: 0.1, attack: 0.02, filter: { type: "bandpass", freq: 3200, to: 5200, q: 2 } }, ...fx.arp("glock", ["G5", "D6"], 0.08, 0.4)] },
};
export const getInkDuelBgm = defineSuite(INK_DUEL_BGM);
