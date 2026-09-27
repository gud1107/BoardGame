/**
 * 달무티 "계급 서사" BGM score as pure data — no Web Audio here (the synth is
 * dalmutiSoundEngine.ts), so the progression is testable.
 *
 * 108 BPM, one step per eighth note, 4 steps per bar, 8-bar / 32-step loop
 * climbing the four social classes:
 *  - Part A (bars 1–2, 농노의 노동요): Am drone + plain lute line;
 *  - Part B (bars 3–4, 선술집·상인): C → F, brighter, tambourine accents;
 *  - Part C (bars 5–6, 귀족·기사단): Dm → G, leaping arpeggio;
 *  - Part D (bars 7–8, 달무티의 왕좌 & 혁명의 전조): E7 chromatic tension
 *    (G#), resolving back to Am on the next loop's downbeat.
 * A court flute long-tone bridges into Part B and Part D.
 *
 * "비반복 변주": the brief's sketch replayed one identical 32-step loop. Here
 * the loop index (`cycle`) picks one of four deterministic variations so the
 * same 9-second phrase never sounds twice in a row:
 *  - cycle 0: the theme as written;
 *  - cycle 1: rests in Parts B–C filled with passing notes, Part C lute an
 *    octave up (귀족의 과시);
 *  - cycle 2: Part A thinned to a sparse lute over drone, no tambourine
 *    (숨 고르기), and a D5 flute instead of C5 into Part B;
 *  - cycle 3: Part D doubled a sixth below and the tambourine on every step
 *    (대혁명의 전조 — the densest pass before the loop starts over).
 */

export const DALMUTI_BPM = 108;
export const STEPS_PER_BAR = 4;
export const LOOP_STEPS = 32;
export const VARIATIONS = 4;
/** Seconds per step (an eighth note). */
export const STEP_SECONDS = 60 / DALMUTI_BPM / 2;

export type DalmutiVoice = "lute" | "drone" | "tambourine" | "flute";

export interface DalmutiEvent {
  voice: DalmutiVoice;
  /** Hz for pitched voices; ignored for the tambourine. */
  freq: number;
  /** Relative loudness 0–1 (lute/tambourine accents). */
  velocity: number;
  /** Length in steps (drone / lute / flute). */
  steps: number;
}

// Drone roots, one per half-bar: Am | C F | Dm G | E G# B E (E7 spelled out).
const BASS = [
  110.0, 110.0, 110.0, 110.0, 110.0, 110.0, 110.0, 110.0,
  130.81, 130.81, 130.81, 130.81, 87.31, 87.31, 87.31, 87.31,
  73.42, 73.42, 73.42, 73.42, 98.0, 98.0, 98.0, 98.0,
  82.41, 82.41, 103.83, 103.83, 123.47, 123.47, 82.41, 82.41,
];

// The brief's 32-step lute theme (0 = rest).
const MELODY = [
  220.0, 0, 261.63, 293.66, 329.63, 0, 293.66, 261.63,
  261.63, 329.63, 392.0, 0, 349.23, 0, 261.63, 220.0,
  293.66, 0, 349.23, 440.0, 392.0, 0, 329.63, 293.66,
  329.63, 0, 415.3, 493.88, 523.25, 493.88, 415.3, 329.63,
];

// Passing notes for cycle 1's filled rests (step → Hz): B-part G→A→F, C-part E / B.
const FILLS: Record<number, number> = { 11: 369.99, 13: 293.66, 17: 329.63, 21: 349.23 };

export function partOf(step: number): "A" | "B" | "C" | "D" {
  return (["A", "B", "C", "D"] as const)[Math.floor(mod(step, LOOP_STEPS) / 8)];
}

export function cycleOf(step: number): number {
  return Math.floor(Math.max(0, step) / LOOP_STEPS) % VARIATIONS;
}

export function dalmutiEventsAt(step: number): DalmutiEvent[] {
  const s = mod(step, LOOP_STEPS);
  const cycle = cycleOf(step);
  const part = partOf(s);
  const downbeat = s % STEPS_PER_BAR === 0;
  const events: DalmutiEvent[] = [];

  // 🎻 Drone: re-struck every bar (twice per chord in the split bars).
  if (downbeat) events.push({ voice: "drone", freq: BASS[s], velocity: 1, steps: 3.8 });

  // 🪕 Lute line with the cycle's variation.
  let freq = MELODY[s];
  if (cycle === 1 && freq === 0 && FILLS[s]) freq = FILLS[s];
  if (cycle === 1 && part === "C" && freq > 0) freq *= 2;
  if (cycle === 2 && part === "A" && s % 2 === 1) freq = 0;
  if (freq > 0) {
    events.push({ voice: "lute", freq, velocity: downbeat ? 1 : 0.7, steps: 1.6 });
    if (cycle === 3 && part === "D") events.push({ voice: "lute", freq: freq * 0.6, velocity: 0.45, steps: 1.6 });
  }

  // 🥁 Tambourine: every step with the bar's downbeat accented — silent in cycle 2's Part A;
  // Part A otherwise only on beats (농노는 조용히), cycle 3 keeps every step everywhere.
  const tambOff = cycle === 2 && part === "A";
  const tambSparse = part === "A" && cycle !== 3 && s % 2 === 1;
  if (!tambOff && !tambSparse) events.push({ voice: "tambourine", freq: 0, velocity: downbeat ? 1 : 0.5, steps: 0 });

  // 🪈 Court flute bridge into Part B and Part D.
  if (s === 8) events.push({ voice: "flute", freq: cycle === 2 ? 587.33 : 523.25, velocity: 1, steps: 5 });
  else if (s === 24) events.push({ voice: "flute", freq: 493.88, velocity: 1, steps: 5 });

  return events;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
