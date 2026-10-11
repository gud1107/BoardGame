import { defineSuite, fx, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 말달리자 "Grand Derby Gallop" BGM — a racetrack orchestral gallop at
 * 160 BPM in G major: strings hammering the "da-da-DUM" gallop rhythm, a
 * bugle-call brass melody, timpani on the downbeats, a snare drive and a
 * pizzicato bass. Replaces the never-shipped `mal-dalli-ja.mp3`
 * (bgmManager.ts) — procedural, no audio files. Hoof/boost/finish SFX stay
 * in the shared soundEngine.
 */
const GALLOP = (a: string, b: string) => `${a} ${a} ${b} - ${a} ${a} ${b} - ${a} ${a} ${b} - ${a} ${a} ${b} -`;

export const MAL_DALLI_JA_BGM: SuiteConfig = {
  bpm: 160,
  tracks: [
    { voice: "strings", pattern: [GALLOP("G3", "D4"), GALLOP("C4", "E4"), GALLOP("D4", "F#4"), GALLOP("G3", "B3")].join(" | "), gain: 0.4 },
    { voice: "brass", div: 2, pattern: "G4 - B4 - D5 - - B4 | C5 - E5 - G5 - - E5 | D5 - F#5 - A5 - F#5 D5 | G5 - - - D5 - B4 -", gain: 0.5 },
    { voice: "timpani", div: 8, pattern: "G2 D2 | C2 G2 | D2 A1 | G2 D2", gain: 0.5 },
    { voice: "snare", pattern: "X . x x . . x . X . x x . x x x", gain: 0.3 },
    { voice: "pizz", div: 4, pattern: "G2 D2 G2 D2 | C3 G2 C3 G2 | D3 A2 D3 A2 | G2 D2 G2 B2", gain: 0.7 },
  ],
  sfx: { preview: fx.arp("brass", ["G4", "B4", "D5", "G5"], 0.08, 0.3) },
};
export const getMalDalliJaBgm = defineSuite(MAL_DALLI_JA_BGM);
