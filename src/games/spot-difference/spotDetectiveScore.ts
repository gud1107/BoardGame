/**
 * 틀린 그림 찾기 "Detective Observation Waltz" BGM score as pure data — no
 * Web Audio here (the synth is spotSound.ts), so it is testable.
 *
 * 104 BPM 3/4, one step per quarter-note beat, 8 bars / 24 steps over
 * Am → Dm → E7 → Am → F → C → E7 → Am:
 *  - 🎻 pizzicato bass on every downbeat (the waltz "쿵");
 *  - ⏱️ clock tick on beat 2, softer lower tock on beat 3 ("짝-짝");
 *  - 🪵 marimba arpeggio, one note per beat, a touch louder on the downbeat.
 * Bar 8 walks down to A3 so the loop wraps home onto bar 1's A4.
 */

export const WALTZ_BPM = 104;
export const BEATS_PER_BAR = 3;
export const LOOP_STEPS = BEATS_PER_BAR * 8;

export type WaltzVoice = "bass" | "tick" | "tock" | "marimba";

export interface WaltzEvent {
  voice: WaltzVoice;
  /** Hz. */
  freq: number;
  accent?: boolean;
}

/** Chord roots, one per bar: A2 D2 E2 A2 F2 C3 E2 A2. */
const BASS = [110.0, 73.42, 82.41, 110.0, 87.31, 130.81, 82.41, 110.0];

const MARIMBA = [
  440.0, 523.25, 659.25, // Am — A4 C5 E5
  587.33, 698.46, 880.0, // Dm — D5 F5 A5
  659.25, 830.61, 987.77, // E7 — E5 G#5 B5
  523.25, 493.88, 440.0, // Am — C5 B4 A4
  349.23, 440.0, 523.25, // F  — F4 A4 C5
  659.25, 587.33, 523.25, // C  — E5 D5 C5
  493.88, 587.33, 830.61, // E7 — B4 D5 G#5
  440.0, 329.63, 220.0, // Am — A4 E4 A3
];

export const TICK_HZ = 880;
export const TOCK_HZ = 620;

export function waltzEventsAt(step: number): WaltzEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const beat = s % BEATS_PER_BAR;
  const events: WaltzEvent[] = [];
  if (beat === 0) events.push({ voice: "bass", freq: BASS[Math.floor(s / BEATS_PER_BAR)] });
  if (beat === 1) events.push({ voice: "tick", freq: TICK_HZ });
  if (beat === 2) events.push({ voice: "tock", freq: TOCK_HZ });
  events.push({ voice: "marimba", freq: MARIMBA[s], accent: beat === 0 });
  return events;
}
