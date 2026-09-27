/**
 * 오이 다섯 개 "Cucumber Waltz" BGM score + card-sound classifier as pure
 * data — no Web Audio here (the synth is cucumberSound.ts), so both are
 * testable.
 *
 * G minor 3/4 gypsy-jazz waltz, one step per quarter-note beat, 3 steps per
 * bar, 4-bar loop Gm → Cm → D7 → Gm: 쿵(pizzicato bass) – 짝 – 짝(accordion).
 * Chord voicings fix two slips in the brief's sketch: its "Cm" was F–A–C
 * (that's F major) → real C minor G3–C4–E♭4; its "D7" was a plain D triad →
 * the C4 seventh is added.
 *
 * `tension` 0..1 (trick 1 → trick 7 of the round, see `trickTension`) is the
 * "마지막 트릭으로 갈수록 고조" part of the brief, which its sketch never
 * actually implemented:
 *  - tempo climbs 126 → 156 BPM,
 *  - from ~0.5 (trick 4+) a clarinet-ish gypsy melody joins on every beat,
 *  - at 1 (the 7th, cucumber-deciding trick) a nervous woodblock tick lands
 *    on every beat and the bass doubles on beat 3 (a chromatic pickup).
 */

export const WALTZ_BPM = 126;
export const WALTZ_MAX_BPM = 156;
export const STEPS_PER_BAR = 3;
export const LOOP_STEPS = STEPS_PER_BAR * 4;

export type WaltzVoice = "bass" | "accordion" | "melody" | "tick";

export interface WaltzEvent {
  voice: WaltzVoice;
  /** One frequency per voice note — the accordion plays several at once. */
  freqs: number[];
  /** Length in beats. */
  beats: number;
}

// G2, C2, D2, G2 — root on beat 1.
const BASS = [98.0, 65.41, 73.42, 98.0];
// Chromatic pickup into the next bar's root on beat 3 (final trick only): F#2→G, B1→C, C#2→D, F#2→G.
const PICKUP = [92.5, 61.74, 69.3, 92.5];
const CHORDS = [
  [196.0, 233.08, 293.66], // Gm  G3 B♭3 D4
  [196.0, 261.63, 311.13], // Cm  G3 C4 E♭4
  [185.0, 220.0, 261.63, 293.66], // D7  F#3 A3 C4 D4
  [196.0, 233.08, 293.66], // Gm
];
// One melody note per beat — a small harmonic-minor gypsy line.
const MELODY = [
  [587.33, 466.16, 392.0], // D5 B♭4 G4
  [622.25, 523.25, 392.0], // E♭5 C5 G4
  [369.99, 440.0, 523.25], // F#4 A4 C5
  [466.16, 440.0, 392.0], // B♭4 A4 G4
];

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

/** Trick 1 → 0 … trick 7 (the one that hands out cucumbers) → 1. */
export function trickTension(trickNumber: number, tricksPerRound = 7): number {
  return clamp01((trickNumber - 1) / (tricksPerRound - 1));
}

export function waltzTempo(tension: number): number {
  return WALTZ_BPM + (WALTZ_MAX_BPM - WALTZ_BPM) * clamp01(tension);
}

export function waltzEventsAt(step: number, tension: number): WaltzEvent[] {
  const t = clamp01(tension);
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const beat = s % STEPS_PER_BAR;
  const events: WaltzEvent[] = [];

  if (beat === 0) events.push({ voice: "bass", freqs: [BASS[bar]], beats: 0.6 });
  else events.push({ voice: "accordion", freqs: CHORDS[bar], beats: 0.7 });

  if (t >= 0.5) events.push({ voice: "melody", freqs: [MELODY[bar][beat]], beats: 0.9 });
  if (t >= 1) {
    events.push({ voice: "tick", freqs: [beat === 0 ? 1800 : 1400], beats: 0.1 });
    if (beat === 2) events.push({ voice: "bass", freqs: [PICKUP[bar]], beats: 0.4 });
  }
  return events;
}

/* ── Card-play sound choice ─────────────────────────────────────────────── */

export type CardPlaySound = "dominance15" | "safeEscape1" | "discardLow" | "normal";

/**
 * Which sting a just-played card gets. `trickMaxBefore` is the trick's top
 * value *before* this card (null when it led the trick). Priority matches the
 * brief: 15 → orchestra hit, 1 → bell chime, below the trick's top (a forced
 * lowest-card shed, rulebook §2-3) → toon trombone slide, else card slide.
 */
export function cardPlaySound(value: number, trickMaxBefore: number | null): CardPlaySound {
  if (value === 15) return "dominance15";
  if (value === 1) return "safeEscape1";
  if (trickMaxBefore !== null && value < trickMaxBefore) return "discardLow";
  return "normal";
}
