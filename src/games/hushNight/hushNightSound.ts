import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import { manhattan, type NightState } from "./engine";

/**
 * 숨죽인 밤 "Held Breath" (rulebook §11) — an original near-silent loop at
 * 56 BPM: a low organ drone, a slow two-note bass, a detuned music box that
 * plays only every other bar. When the monster is two steps from me or
 * closer (intensity 1) a heartbeat and a breathy choir cluster join.
 */

const SFX = {
  /** My choice is locked in (board). */
  commit: [{ inst: "tock", note: "C5", gain: 0.5 }, { wave: "noise", dur: 0.18, peak: 0.03, at: 0.02, attack: 0.03, filter: { type: "bandpass", freq: 900, q: 0.8 } }],
  /** Someone else locked in. */
  locked: [{ inst: "tick", note: "C6", gain: 0.35 }],
  /** Footsteps: arg 1 = walk, 3 = run. */
  steps: (level: number) => {
    const n = level >= 3 ? 4 : 2;
    return Array.from({ length: n }, (_, i) => fx.thud(level >= 3 ? 150 : 110, level >= 3 ? 0.08 : 0.1, level >= 3 ? 0.32 : 0.16, i * (level >= 3 ? 0.13 : 0.32)));
  },
  /** A pebble flies and clatters. */
  pebble: [fx.whoosh(2200, 700, 0.3, 0.06), fx.click(2600, 0.2, 0.35), fx.click(1900, 0.14, 0.45), fx.click(2300, 0.08, 0.53)],
  /** Holding breath. */
  hush: [{ wave: "noise", dur: 0.8, peak: 0.035, attack: 0.25, filter: { type: "lowpass", freq: 700 } }],
  /** A key jingles. */
  key: [...fx.coin(0.05, 3200, 0.08), ...fx.coin(0.13, 2700, 0.06)],
  /** The cellar hatch creaks — keys banked. */
  bank: [{ wave: "sawtooth", freq: 140, to: 210, glide: 0.6, dur: 0.7, peak: 0.04, attack: 0.1, filter: { type: "bandpass", freq: 600, q: 4 } }, ...fx.arp("musicbox", ["A5", "C6", "E6"], 0.1, 0.6, 0.6).map((p) => ({ ...p, at: (p.at ?? 0) + 0.5 }))],
  /** The monster lumbers (arg = steps). */
  lumber: (n: number) => [
    ...Array.from({ length: Math.max(1, Math.min(3, n)) }, (_, i) => fx.thud(55, 0.35, 0.5, 0.15 + i * 0.4)),
    { wave: "sawtooth", freq: 62, to: 48, glide: 0.8, dur: 1, peak: 0.05, attack: 0.15, filter: { type: "lowpass", freq: 300 } },
  ],
  /** Somebody got caught. */
  caught: [
    { wave: "sawtooth", freq: 820, to: 1300, glide: 0.2, dur: 0.5, peak: 0.05, attack: 0.005, vibrato: { rate: 15, depth: 0.05 }, filter: { type: "bandpass", freq: 1900, q: 2 } },
    fx.thud(48, 0.8, 0.6, 0.05),
    { inst: "gong", note: "D2", at: 0.05, gain: 0.55 },
  ],
  /** I got caught. */
  meCaught: [fx.thud(40, 1.2, 0.8), ...fx.chord("strings", ["D3", "D#3", "A3"], 1.6, 0.6, 0.1)],
  /** The monster heard nothing. */
  silence: [{ inst: "bell", note: "D5", dur: 1.2, gain: 0.2 }],
  /** Rage: the last third of the night. */
  rage: [{ wave: "sawtooth", freq: 45, to: 70, glide: 1.2, dur: 1.6, peak: 0.08, attack: 0.3, filter: { type: "lowpass", freq: 350 } }],
  tick: [{ inst: "tick", note: "C6", gain: 0.6 }],
  victory: [...fx.arp("musicbox", ["D5", "F5", "A5", "D6"], 0.14, 0.9), ...fx.chord("pad", ["D3", "A3", "D4"], 2.2, 0.6, 0.5)],
} satisfies Record<string, SfxRecipe>;

export const HUSH_NIGHT_SUITE: SuiteConfig = {
  bpm: 56,
  swing: 0,
  tracks: [
    { voice: "organ", div: 16, pattern: "D2+A2 - ", gain: 0.08 },
    { voice: "bass", div: 8, pattern: "D1 - C1 - ", gain: 0.22 },
    { voice: "musicbox", div: 2, pattern: "A5 . F5 . D5 . E5 . | . . . . . . . . | A5 . G5 . F5 . C#5 . | . . . . . . . . ", gain: 0.08 },
    { voice: "kick", div: 2, pattern: "x x . . . . . . x x . . . . . .", gain: 0.28, level: 1 },
    { voice: "choir", div: 8, pattern: "D4+D#4 - . . ", gain: 0.07, level: 1 },
  ],
  sfx: SFX,
};

export const getHushNightSound = defineSuite(HUSH_NIGHT_SUITE);

/** BGM intensity: the monster is two steps from me or closer. */
export function hushIntensity(s: NightState, viewer: number): number {
  const me = s.seats[viewer];
  return me && manhattan(me.at, s.monster) <= 2 ? 1 : 0;
}

export function hushNightCues(viewer: number) {
  return (prev: NightState, next: NightState): SoundCue[] => {
    const cues: SoundCue[] = [];
    if (next.last && next.last !== prev.last) {
      const r = next.last;
      const loudest = Math.max(0, ...r.moves.map((m) => (m.kind === "run" ? 3 : m.kind === "walk" ? 1 : 0)));
      if (loudest > 0) cues.push({ name: "steps", arg: loudest });
      if (r.moves.some((m) => m.kind === "throw")) cues.push("pebble");
      if (r.moves[viewer]?.kind === "hush") cues.push("hush");
      if (r.picked.length) cues.push("key");
      if (r.bankedNow.length) cues.push("bank");
      if (r.monsterPath.length) cues.push({ name: "lumber", arg: r.monsterPath.length });
      else if (!r.target) cues.push("silence");
      if (r.caught.includes(viewer)) cues.push("meCaught");
      else if (r.caught.length) cues.push("caught");
    } else if (next.step === prev.step) {
      const was = prev.commits.filter((c) => c !== null).length;
      const now = next.commits.filter((c) => c !== null).length;
      if (now > was) cues.push("locked");
    }
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
