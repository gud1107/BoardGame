import { defineSuite, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 배고픈 상어 "Abyssal Hunt" BGM — a deep-sea predator groove at 96 BPM in
 * A minor: a slow glassy arpeggio, a swelling pad, a rubbery sub bass, a
 * soft kick heartbeat and a sonar "ping" bell. It sits on top of the game's
 * own underwater noise bed and synth SFX (audio.ts), and follows the game's
 * own 🔊/🔇 toggle as well as the site BGM setting.
 */
export const HUNGRY_SHARK_BGM: SuiteConfig = {
  bpm: 96,
  tracks: [
    { voice: "glock", div: 2, pattern: "A4 E5 C5 E5 B4 E5 C5 E5 | G4 D5 B4 D5 A4 D5 B4 D5 | F4 C5 A4 C5 G4 C5 A4 C5 | E4 B4 G#4 B4 E5 B4 G#4 B4", gain: 0.25 },
    { voice: "pad", div: 16, pattern: "A2+E3+C4 G2+D3+B3 F2+C3+A3 E2+B2+G#3", gain: 0.6 },
    { voice: "sub808", div: 4, pattern: "A1 . . A1 | G1 . . G1 | F1 . . F1 | E1 . E1 .", gain: 0.6 },
    { voice: "softKick", div: 4, pattern: "X . . x", gain: 0.7 },
    { voice: "bell", div: 32, pattern: "E6 .", gain: 0.12 },
  ],
  sfx: { preview: [{ inst: "bell", note: "E6", gain: 0.5 }] },
};
export const getHungrySharkBgm = defineSuite(HUNGRY_SHARK_BGM);
