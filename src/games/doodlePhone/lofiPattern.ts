/**
 * The lo-fi BGM score for 그림 전화기, as pure data: `lofiEventsAt(step)` says
 * what to play on each eighth-note step. No Web Audio here, so the music can
 * be unit-tested and tweaked without touching the synth (doodlePhoneSound.ts).
 *
 * Imaj7 – vi7 – IVmaj7 – V7 in C, one chord per bar, 8 eighths per bar,
 * 4-bar loop. Variation between loop passes comes from a deterministic hash,
 * never Math.random, so a given pass always sounds the same.
 */

export const LOFI_BPM = 78;
export const STEPS_PER_BAR = 8;
export const LOOP_STEPS = STEPS_PER_BAR * 4;
/** Offbeat eighths land this fraction of a beat late — the lazy lo-fi swing. */
export const SWING = 0.14;

/** Warm voicings (MIDI): Cmaj7, Am7, Fmaj7, G7 — same pitches as the brief's Hz table. */
export const CHORDS: readonly (readonly number[])[] = [
  [60, 64, 67, 71],
  [57, 60, 64, 67],
  [53, 57, 60, 64],
  [55, 59, 62, 65],
];
const BASS_ROOTS = [48, 45, 41, 43];

export type LofiVoice = "chord" | "bass" | "arp" | "hat";

export interface LofiEvent {
  voice: LofiVoice;
  /** MIDI notes (empty for the unpitched hat). */
  notes: readonly number[];
  /** Length in beats. */
  beats: number;
  /** 0..1 loudness relative to the voice's own level. */
  velocity: number;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Deterministic 0..1 per (pass, step). */
export function variation(pass: number, step: number): number {
  let h = Math.imul(pass + 1, 0x9e3779b1) ^ Math.imul(step + 11, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Eighth positions within a bar that may carry an arpeggio note. */
const ARP_SLOTS = [2, 3, 5, 6, 7];

export function lofiEventsAt(step: number): LofiEvent[] {
  const pos = step % LOOP_STEPS;
  const pass = Math.floor(step / LOOP_STEPS);
  const bar = Math.floor(pos / STEPS_PER_BAR);
  const inBar = pos % STEPS_PER_BAR;
  const chord = CHORDS[bar];
  const events: LofiEvent[] = [];

  if (inBar === 0) events.push({ voice: "chord", notes: chord, beats: 3.8, velocity: 1 });
  if (inBar === 0 || inBar === 5) events.push({ voice: "bass", notes: [BASS_ROOTS[bar]], beats: inBar === 0 ? 2.2 : 1.2, velocity: inBar === 0 ? 1 : 0.7 });

  // Sparse arpeggio an octave up: about half the slots sound, different each pass.
  if (ARP_SLOTS.includes(inBar) && variation(pass, pos) < 0.5) {
    const note = chord[Math.floor(variation(pass + 97, pos) * chord.length)] + 12;
    events.push({ voice: "arp", notes: [note], beats: 0.9, velocity: 0.55 + variation(pass + 5, pos) * 0.35 });
  }

  // Brushed hat on the offbeats, a touch louder on the "and" of 2 and 4.
  if (inBar % 2 === 1) events.push({ voice: "hat", notes: [], beats: 0.1, velocity: inBar === 3 || inBar === 7 ? 1 : 0.6 });

  return events;
}
