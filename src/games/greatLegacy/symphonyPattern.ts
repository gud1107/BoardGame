/**
 * The 위대한 투자 "로열 체임버 심포니" BGM score as pure data:
 * `symphonyEventsAt(step)` says what plays on each eighth-note step. No Web
 * Audio here (the synth is investmentSound.ts), so the score is testable.
 *
 * G minor → E♭ major → B♭ major → D7, one chord per bar, 8 eighths per bar,
 * 4-bar / 32-step loop at 80 BPM — values taken from the brief:
 *  - low strings (cello/contrabass) legato on every beat,
 *  - a slow-attack French-horn pad twice per bar,
 *  - a sparse grand-piano line,
 *  - a soft timpani on each bar's downbeat.
 */

export const SYMPHONY_BPM = 80;
export const STEPS_PER_BAR = 8;
export const LOOP_STEPS = STEPS_PER_BAR * 4;

export type SymphonyVoice = "bass" | "horn" | "piano" | "timpani";

export interface SymphonyEvent {
  voice: SymphonyVoice;
  /** Hz (0 for the unpitched-ish timpani, which sweeps its own pitch). */
  freq: number;
  /** Length in beats. */
  beats: number;
  /** 0..1 loudness relative to the voice's own level. */
  velocity: number;
}

// G1 D2 G2 | Eb1 Bb1 Eb2 | Bb1 F2 Bb2 | D1 A1 D2 — one entry per eighth, bass plays on even steps.
const BASS = [
  49.0, 49.0, 73.42, 73.42, 98.0, 98.0, 49.0, 49.0,
  38.89, 38.89, 58.27, 58.27, 77.78, 77.78, 38.89, 38.89,
  58.27, 58.27, 87.31, 87.31, 116.54, 116.54, 58.27, 58.27,
  36.71, 36.71, 55.0, 55.0, 73.42, 73.42, 36.71, 36.71,
];

// Horn pad on beats 1 and 3: G3/B♭3 · E♭3/G3 · B♭3/D4 · A3/C4 (the D7 bar's tension).
// Two corrections to the brief's table: bar 1's B3 would make it G *major* (B♭3 keeps the G minor
// the brief names), and bar 4's C♯4 isn't in D7 and rubs a semitone against the piano's C4 there.
const HORN = [
  196.0, 0, 0, 0, 233.08, 0, 0, 0,
  155.56, 0, 0, 0, 196.0, 0, 0, 0,
  233.08, 0, 0, 0, 293.66, 0, 0, 0,
  220.0, 0, 0, 0, 261.63, 0, 0, 0,
];

const PIANO = [
  196.0, 0, 293.66, 0, 392.0, 0, 440.0, 0,
  0, 392.0, 0, 349.23, 293.66, 0, 0, 0,
  155.56, 0, 233.08, 0, 311.13, 0, 392.0, 0,
  0, 349.23, 0, 311.13, 293.66, 0, 261.63, 0,
];

export function symphonyEventsAt(step: number): SymphonyEvent[] {
  const pos = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const events: SymphonyEvent[] = [];
  if (pos % STEPS_PER_BAR === 0) events.push({ voice: "timpani", freq: 0, beats: 0.5, velocity: 1 });
  if (pos % 2 === 0) events.push({ voice: "bass", freq: BASS[pos], beats: 1.9, velocity: 1 });
  if (HORN[pos] > 0) events.push({ voice: "horn", freq: HORN[pos], beats: 3.8, velocity: 1 });
  if (PIANO[pos] > 0) events.push({ voice: "piano", freq: PIANO[pos], beats: 1.5, velocity: pos % STEPS_PER_BAR === 0 ? 1 : 0.72 });
  return events;
}
