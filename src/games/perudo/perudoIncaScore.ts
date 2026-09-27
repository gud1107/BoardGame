/**
 * 페루도 "Inca Dice" BGM score as pure data — no Web Audio here (the synth
 * is perudoSound.ts), so it is testable.
 *
 * Andean / Caribbean bluffing ambience in D minor, 96 BPM, one step per
 * eighth note (8 steps per bar), 4-bar / 32-step loop over Dm → Bb → C → Am:
 *  - 🪘 tribal tom on the brief's drum pattern (accent on each downbeat,
 *    the bar-2 "70 75" double hit kept as a pickup fill);
 *  - 🎲 dice-cup shaker on every eighth, accent on the beat;
 *  - 🎸 nylon guitar: the brief struck only the chord root every half bar —
 *    here each half bar is a root → fifth arpeggio so the four chords are
 *    actually audible, still in the brief's low register;
 *  - 🪈 pan flute: the brief's 16-note melody on the even steps, each note
 *    exactly 2 steps long (the brief let every note ring 2.2 steps,
 *    overlapping the next one); bar 4 lands on D4 so Am resolves to Dm as
 *    the loop wraps.
 */

export const INCA_BPM = 96;
export const STEPS_PER_BAR = 8;
export const LOOP_STEPS = STEPS_PER_BAR * 4;

export type IncaVoice = "tom" | "shaker" | "guitar" | "flute";

export interface IncaEvent {
  voice: IncaVoice;
  /** Hz; 0 for the unpitched shaker. */
  freq: number;
  /** Length in eighth steps (guitar, flute). */
  steps?: number;
  accent?: boolean;
}

const TOM = [80, 0, 60, 0, 75, 0, 60, 0, 80, 0, 60, 0, 70, 75, 60, 0, 80, 0, 60, 0, 75, 0, 60, 0, 85, 0, 60, 0, 70, 0, 60, 0];

const FLUTE = [
  293.66, 0, 349.23, 0, 440.0, 0, 392.0, 0,   // Dm — D4 F4 A4 G4
  466.16, 0, 440.0, 0, 349.23, 0, 293.66, 0,  // Bb — Bb4 A4 F4 D4
  261.63, 0, 329.63, 0, 392.0, 0, 349.23, 0,  // C  — C4 E4 G4 F4
  220.0, 0, 261.63, 0, 329.63, 0, 293.66, 0,  // Am — A3 C4 E4, home on D4
];

/** Per bar: [root, fifth] of Dm, Bb, C, Am in the brief's octave (D3 / Bb2 / C3 / A2). */
const GUITAR_CHORDS: [number, number][] = [
  [146.83, 220.0],
  [116.54, 174.61],
  [130.81, 196.0],
  [110.0, 164.81],
];

export function incaEventsAt(step: number): IncaEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const inBar = s % STEPS_PER_BAR;
  const events: IncaEvent[] = [];
  if (TOM[s] > 0) events.push({ voice: "tom", freq: TOM[s], accent: inBar === 0 });
  events.push({ voice: "shaker", freq: 0, accent: inBar % 2 === 0 });
  const [root, fifth] = GUITAR_CHORDS[Math.floor(s / STEPS_PER_BAR)];
  if (inBar % 4 === 0) events.push({ voice: "guitar", freq: root, steps: 3, accent: inBar === 0 });
  if (inBar % 4 === 2) events.push({ voice: "guitar", freq: fifth, steps: 2 });
  if (FLUTE[s] > 0) events.push({ voice: "flute", freq: FLUTE[s], steps: 2 });
  return events;
}
