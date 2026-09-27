/**
 * 랫어탯캣 "Sneaky Cat" BGM score + state-diff → SFX cue classifier as pure
 * data — no Web Audio here (the synth is ratSound.ts), so both are testable.
 *
 * Tom-and-Jerry-style sneaking pizzicato in D minor blues, 2/4 at 112 BPM,
 * one step per sixteenth (8 steps per bar), 4-bar / 32-step loop:
 *  - 🎻 pizzicato bass: the brief's 16-step walking line D2–F2–G2–G#2–A2 and
 *    back, played twice per loop;
 *  - 🪵 xylophone: the brief's off-beat D5–F5–A5 / G#5–G5–F5 phrase on bars
 *    1–2, answered by a falling phrase on bars 3–4 (the brief looped one
 *    phrase only);
 *  - 🪵 woodblock: a tiptoe tick on beat 2 of every bar — the brief named it
 *    but its sketch never scheduled one;
 *  - 🐱 cat-prowl chime: a lone G#5 (the tritone over D) once every 4 bars —
 *    also named but never scheduled in the brief.
 *
 * `finalLap` (someone called "Rat-a-Tat Cat!") pushes the tempo to 126 BPM,
 * drops the chime on every bar and doubles the woodblock into eighth notes.
 */

import type { RatATatCatState, SeatIndex } from "./engine";

export const SNEAK_BPM = 112;
export const SNEAK_FINAL_BPM = 126;
export const STEPS_PER_BAR = 8;
export const LOOP_STEPS = STEPS_PER_BAR * 4;

export type SneakVoice = "bass" | "xylo" | "woodblock" | "chime";

export interface SneakEvent {
  voice: SneakVoice;
  freq: number;
}

// D2, F2, G2, G#2, A2 up — A2, G2, F2, D2 down (the brief's line, 2 bars).
const BASS = [73.42, 0, 87.31, 0, 98.0, 103.83, 110.0, 0, 110.0, 0, 98.0, 0, 87.31, 0, 73.42, 0];
// Bars 1–2: the brief's D5 F5 A5 | G#5 G5 F5. Bars 3–4: answer E5 D5 C5 | A4 … D5.
const XYLO = [
  0, 587.33, 0, 698.46, 0, 0, 880.0, 0, 0, 830.61, 0, 783.99, 0, 698.46, 0, 0,
  0, 659.25, 0, 587.33, 0, 0, 523.25, 0, 0, 440.0, 0, 0, 0, 587.33, 0, 0,
];
const WOODBLOCK_HZ = 1250;
const CHIME_HZ = 830.61; // G#5

export function sneakTempo(finalLap: boolean): number {
  return finalLap ? SNEAK_FINAL_BPM : SNEAK_BPM;
}

export function sneakEventsAt(step: number, finalLap: boolean): SneakEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const inBar = s % STEPS_PER_BAR;
  const events: SneakEvent[] = [];
  const bass = BASS[s % BASS.length];
  if (bass > 0) events.push({ voice: "bass", freq: bass });
  if (XYLO[s] > 0) events.push({ voice: "xylo", freq: XYLO[s] });
  if (inBar === 4 || (finalLap && inBar % 2 === 0 && inBar !== 0)) events.push({ voice: "woodblock", freq: WOODBLOCK_HZ });
  if (finalLap ? inBar === 0 : s === 0) events.push({ voice: "chime", freq: CHIME_HZ });
  return events;
}

/* ── SFX cues ─────────────────────────────────────────────────────────── */

export type RatSoundCue =
  | { kind: "draw" }
  | { kind: "swap" }
  | { kind: "drawTwo" }
  | { kind: "quality"; lowCat: boolean }
  | { kind: "call" };

/** A cat worth celebrating: 0–2. */
export const GOOD_CAT_MAX = 2;
/** A rat worth grumbling about: 8–9. */
export const BAD_RAT_MIN = 8;

/**
 * Which SFX a consecutive pair of state snapshots calls for, heard by every
 * client (bots included). Peek is NOT detectable here: using a Peek card and
 * simply discarding it produce identical diffs, so the board plays the Peek
 * whistle from the viewer's own click instead. The quality cue is viewer-only
 * — the drawn card's value is private to its drawer, so ringing it for
 * everyone would leak what went into a face-down slot.
 */
export function ratSoundCues(prev: RatATatCatState, next: RatATatCatState, viewerSeat: SeatIndex): RatSoundCue[] {
  if (prev === next) return [];
  const cues: RatSoundCue[] = [];
  const held = prev.drawnCard;

  if (held === null && next.drawnCard !== null) cues.push({ kind: "draw" });

  if (held && next.drawnCard === null && prev.phase === "playing") {
    if (held.kind === "swap" && prev.turnPhase === "EXECUTE_POWER" && next.hands !== prev.hands) cues.push({ kind: "swap" });
    if (held.kind === "drawTwo" && prev.turnPhase === "EXECUTE_POWER" && next.drawTwoStage === 1 && next.turnPhase === "DRAW") cues.push({ kind: "drawTwo" });
    if (held.kind === "number" && prev.turnPhase === "DECIDE_CARD" && prev.currentTurn === viewerSeat && next.hands !== prev.hands) {
      if (held.value <= GOOD_CAT_MAX) cues.push({ kind: "quality", lowCat: true });
      else if (held.value >= BAD_RAT_MIN) cues.push({ kind: "quality", lowCat: false });
    }
  }

  if (prev.callerId === null && next.callerId !== null) cues.push({ kind: "call" });
  return cues;
}
