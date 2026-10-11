import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 운명전쟁39 "Neon Fate" BGM — a cyberpunk synthwave drive at 108 BPM in
 * C♯ minor (C♯m–A–E–B): pulsing 8th saw bass, a pad on every beat, a
 * soaring lead, a backbeat snare and 16th hats. Replaces the never-shipped
 * `destiny-war-39.mp3` (bgmManager.ts) — procedural, no audio files. Card
 * and prediction SFX stay in the shared soundEngine.
 */
export const DESTINY_WAR_39_BGM: SuiteConfig = {
  bpm: 108,
  tracks: [
    { voice: "synthBass", div: 2, pattern: "C#2 C#2 C#2 C#2 C#2 C#2 C#2 C#2 | A1 A1 A1 A1 A1 A1 A1 A1 | E2 E2 E2 E2 E2 E2 E2 E2 | B1 B1 B1 B1 B1 B1 B1 B1", gain: 0.6 },
    {
      voice: "pad",
      div: 4,
      pattern:
        "C#4+E4+G#4 C#4+E4+G#4 C#4+E4+G#4 C#4+E4+G#4 | A3+C#4+E4 A3+C#4+E4 A3+C#4+E4 A3+C#4+E4 | E4+G#4+B4 E4+G#4+B4 E4+G#4+B4 E4+G#4+B4 | B3+D#4+F#4 B3+D#4+F#4 B3+D#4+F#4 B3+D#4+F#4",
      gain: 0.5,
    },
    { voice: "lead", div: 2, pattern: "G#4 - - - B4 - C#5 - | E5 - - - D#5 C#5 B4 - | G#4 - - - E5 - F#5 - | D#5 - - - - - . .", gain: 0.45 },
    { voice: "kick", div: 4, pattern: "X . x .", gain: 0.6 },
    { voice: "snare", div: 4, pattern: ". X . X", gain: 0.6 },
    { voice: "hat", pattern: "x x X x x x X x x x X x x x X x", gain: 0.6 },
  ],
  sfx: { preview: fx.arp("lead", ["C#5", "G#5"], 0.1, 0.3) },
};
export const getDestinyWar39Bgm = defineSuite(DESTINY_WAR_39_BGM);
