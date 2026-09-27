/**
 * 코요테 "Western Coyote" BGM score + state-diff → SFX cue classifier as pure
 * data — no Web Audio here (the synth is coyoteSound.ts), so both are
 * testable.
 *
 * Spaghetti-western standoff in A dorian, 4/4 at 116 BPM, one step per
 * sixteenth (16 steps per bar), 4-bar / 64-step loop:
 *  - 🪕 banjo strum: the brief's A3–E4–A3–A4 | G3–D4–G3–G4 bar on bars 1–3,
 *    turning to Em (E3–B3–E3–E4) on the back half of bar 4 so the loop
 *    cadences instead of repeating one bar forever;
 *  - 🪈 whistle: the brief's A4 C5 B4 A4 E5 D5 phrase on bar 1, a long held
 *    Morricone-style E5 on bar 2, a falling B4–A4–G4–A4 answer on bar 3 and
 *    a silent bar 4 (the brief looped its single bar, with every note ringing
 *    3.5 sixteenths so neighbours overlapped — here each note has its own
 *    length);
 *  - 🪵 woodblock hoofbeat on beats 2 and 4, 🐍 shaker on every eighth
 *    (accent on the beat) — the brief's single "rattle tap" split into the
 *    two sounds its description names;
 *  - 🐍 one rattlesnake tail-shake on the last beat of the loop.
 */

import type { CoyoteState } from "./engine";

export const WESTERN_BPM = 116;
export const STEPS_PER_BAR = 16;
export const LOOP_STEPS = STEPS_PER_BAR * 4;

export type WesternVoice = "banjo" | "whistle" | "woodblock" | "shaker" | "rattlesnake";

export interface WesternEvent {
  voice: WesternVoice;
  /** Hz; 0 for unpitched voices (shaker, rattlesnake). */
  freq: number;
  /** Length in sixteenth steps (whistle, rattlesnake). */
  steps?: number;
  accent?: boolean;
}

const AM = [220.0, 0, 329.63, 0, 220.0, 0, 440.0, 0];
const G = [196.0, 0, 293.66, 0, 196.0, 0, 392.0, 0];
const EM = [164.81, 0, 246.94, 0, 164.81, 0, 329.63, 0];
const BANJO = [...AM, ...G, ...AM, ...G, ...AM, ...G, ...AM, ...EM];

const G4 = 392.0;
const A4 = 440.0;
const B4 = 493.88;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
/** step → [freq, length in steps]. */
const WHISTLE: Record<number, [number, number]> = {
  // Bar 1 — the brief's phrase.
  3: [A4, 2],
  5: [C5, 2],
  7: [B4, 1],
  8: [A4, 4],
  12: [E5, 2],
  14: [D5, 2],
  // Bar 2 — the long lonely note, then a pickup.
  16: [E5, 10],
  28: [D5, 2],
  30: [C5, 2],
  // Bar 3 — falling answer, settling home.
  32: [B4, 4],
  36: [A4, 2],
  38: [G4, 2],
  40: [A4, 8],
  // Bar 4 — rest; the rattlesnake has the last word.
};

const WOODBLOCK_ACCENT_HZ = 850;
const WOODBLOCK_HZ = 600;
const RATTLESNAKE_STEP = LOOP_STEPS - 4;

export function westernEventsAt(step: number): WesternEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const inBar = s % STEPS_PER_BAR;
  const events: WesternEvent[] = [];
  if (BANJO[s] > 0) events.push({ voice: "banjo", freq: BANJO[s], accent: inBar % 4 === 0 });
  const w = WHISTLE[s];
  if (w) events.push({ voice: "whistle", freq: w[0], steps: w[1] });
  if (inBar === 4 || inBar === 12) events.push({ voice: "woodblock", freq: inBar === 4 ? WOODBLOCK_ACCENT_HZ : WOODBLOCK_HZ });
  if (inBar % 2 === 0) events.push({ voice: "shaker", freq: 0, accent: inBar % 4 === 0 });
  if (s === RATTLESNAKE_STEP) events.push({ voice: "rattlesnake", freq: 0, steps: 4 });
  return events;
}

/* ── SFX cues ─────────────────────────────────────────────────────────── */

export type CoyoteSoundCue = { kind: "declare"; number: number } | { kind: "call" };

/**
 * Which SFX a consecutive pair of lockstep snapshots calls for, heard by
 * every client (bots and remote players included). Only the two table
 * actions live here — the special-card chimes and the heart-loss trombone
 * belong to the showdown timeline instead (CoyoteBoard.tsx), so they land on
 * the "?" popup / MAX→0 slash / verdict rather than all at once at the call.
 */
export function coyoteSoundCues(prev: CoyoteState, next: CoyoteState): CoyoteSoundCue[] {
  if (prev === next) return [];
  if (prev.phase === "playing" && next.phase !== "playing") return [{ kind: "call" }];
  if (
    prev.phase === "playing" &&
    next.phase === "playing" &&
    prev.roundNumber === next.roundNumber &&
    next.currentBid !== null &&
    next.currentBid !== prev.currentBid
  ) {
    return [{ kind: "declare", number: next.currentBid.number }];
  }
  return [];
}

