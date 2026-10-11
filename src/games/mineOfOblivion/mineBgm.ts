import { defineSuite, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 망각의 지뢰 "Forgotten Mine" BGM — a dim, dripping cave at 88 BPM in
 * A minor: an uneasy music-box figure, sparse "water drip" glock notes, a
 * low pad drone and a heartbeat kick. Mine/treasure SFX stay in the shared
 * soundEngine.
 */
export const MINE_BGM: SuiteConfig = {
  bpm: 88,
  tracks: [
    { voice: "musicbox", div: 2, pattern: "A4 . C5 . E5 . D5 . | C5 . B4 . G#4 . . . | A4 . C5 . F5 . E5 . | D5 . C5 . B4 . . .", gain: 0.5 },
    { voice: "glock", pattern: ". . . . . . . . . . . E6 . . . . | . . . . . A6 . . . . . . . . . . | . . . . . . . . . . . . . C7 . . | . . . . . . . . . . . . . . . .", gain: 0.25 },
    { voice: "pad", div: 32, pattern: "A2+E3 F2+C3", gain: 0.6 },
    { voice: "softKick", pattern: "X . . x . . . . . . . . . . . .", gain: 0.6 },
  ],
  sfx: { preview: [{ inst: "glock", note: "E6" }, { inst: "glock", note: "A6", at: 0.3, gain: 0.6 }] },
};
export const getMineBgm = defineSuite(MINE_BGM);
