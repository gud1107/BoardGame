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
 *
 * Two live modifiers, both driven by the board from auction state:
 *  - `mood: "reverse"` (a penalty card is on the block): a darker variant —
 *    G minor → A♭ (Neapolitan) → E♭ → D7 in a lower register, the horn pad
 *    swapped for low tremolo strings, a G pedal drone, and a sparse G–A♭
 *    half-step piano motif.
 *  - `heat` 0..1 (how high the bidding has climbed): above ~0.3 a staccato
 *    string ostinato joins, above ~0.6 the timpani doubles to every half-bar
 *    and the piano gains an octave; the synth also speeds up (symphonyTempo)
 *    and opens the horn filter.
 */

export const SYMPHONY_BPM = 80;
export const STEPS_PER_BAR = 8;
export const LOOP_STEPS = STEPS_PER_BAR * 4;

export type SymphonyVoice = "bass" | "horn" | "piano" | "timpani" | "ostinato" | "tremolo" | "drone";
export type SymphonyMood = "normal" | "reverse";

export interface SymphonyContext {
  mood: SymphonyMood;
  /** 0 (calm) .. 1 (bidding war). */
  heat: number;
}

const CALM: SymphonyContext = { mood: "normal", heat: 0 };

/** BPM for the current mood/heat: 80→100 normally, 72→86 for the darker reverse-auction variant. */
export function symphonyTempo(ctx: SymphonyContext = CALM): number {
  const h = clamp01(ctx.heat);
  return ctx.mood === "reverse" ? 72 + 14 * h : SYMPHONY_BPM + 20 * h;
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

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

// ── Reverse-auction (penalty card) variant ──────────────────────────────
// G1 D2 | A♭1 E♭2 | E♭1 B♭1 | D1 A1 — an octave-ish lower and heavier, bass on every beat.
const REV_BASS = [
  49.0, 49.0, 73.42, 73.42, 49.0, 49.0, 73.42, 73.42,
  51.91, 51.91, 77.78, 77.78, 51.91, 51.91, 77.78, 77.78,
  38.89, 38.89, 58.27, 58.27, 38.89, 38.89, 58.27, 58.27,
  36.71, 36.71, 55.0, 55.0, 36.71, 36.71, 55.0, 55.0,
];
// Low tremolo-string chord tone per bar (one sustained note per bar): B♭2 · C3 · G2 · F♯2.
const REV_TREMOLO = [116.54, 130.81, 98.0, 92.5];
// Sparse G–A♭ half-step "warning" motif, answered a tritone lower in the D7 bar.
const REV_PIANO = [
  392.0, 0, 0, 415.3, 0, 0, 0, 0,
  415.3, 0, 0, 392.0, 0, 0, 0, 0,
  311.13, 0, 0, 293.66, 0, 0, 0, 0,
  277.18, 0, 0, 293.66, 0, 0, 0, 0,
];

export function symphonyEventsAt(step: number, ctx: SymphonyContext = CALM): SymphonyEvent[] {
  const pos = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(pos / STEPS_PER_BAR);
  const inBar = pos % STEPS_PER_BAR;
  const heat = clamp01(ctx.heat);
  const reverse = ctx.mood === "reverse";
  const bass = reverse ? REV_BASS : BASS;
  const events: SymphonyEvent[] = [];

  const timpaniHere = inBar === 0 || (heat > 0.6 && inBar === 4);
  if (timpaniHere) events.push({ voice: "timpani", freq: 0, beats: 0.5, velocity: inBar === 0 ? 1 : 0.7 });
  if (pos % 2 === 0) events.push({ voice: "bass", freq: bass[pos], beats: 1.9, velocity: reverse ? 1.1 : 1 });

  if (reverse) {
    if (inBar === 0) {
      events.push({ voice: "drone", freq: 49.0, beats: 4, velocity: 1 });
      events.push({ voice: "tremolo", freq: REV_TREMOLO[bar], beats: 3.9, velocity: 1 });
    }
    if (REV_PIANO[pos] > 0) events.push({ voice: "piano", freq: REV_PIANO[pos], beats: 1.2, velocity: 0.8 });
  } else {
    if (HORN[pos] > 0) events.push({ voice: "horn", freq: HORN[pos], beats: 3.8, velocity: 1 });
    if (PIANO[pos] > 0) {
      const velocity = inBar === 0 ? 1 : 0.72;
      events.push({ voice: "piano", freq: PIANO[pos], beats: 1.5, velocity });
      if (heat > 0.6) events.push({ voice: "piano", freq: PIANO[pos] * 2, beats: 1, velocity: velocity * 0.45 });
    }
  }

  // Bidding-war ostinato: staccato eighths on the bar's root an octave above the bass line.
  if (heat > 0.3) events.push({ voice: "ostinato", freq: bass[bar * STEPS_PER_BAR] * 4, beats: 0.35, velocity: 0.4 + 0.6 * ((heat - 0.3) / 0.7) });
  return events;
}
