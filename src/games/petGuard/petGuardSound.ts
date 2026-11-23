import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { PetState } from "./engine";
import type { SimEvent } from "./sim";

/**
 * 멍냥 방어선 "Rescue Patrol" suite — a bouncy C-major 116 BPM march:
 * marimba hook + pluck chords over upright bass, kick/clap/shaker groove.
 * Intensity 1 (tier-3 rounds / the replay) adds a brass stab line and a
 * timpani pulse so the disaster feels bigger.
 *
 * SFX: build (place / remove / invalid), submit, reveal, and per-tick replay
 * events — splash (drained), bolt warning + strike, boom, crush, chew, quake,
 * the pet getting hit, surviving the round, final fanfare.
 */

const SFX = {
  ui: [fx.click(1500, 0.08)],
  place: [fx.thud(260, 0.12, 0.3), fx.click(1900, 0.06, 0.02)],
  remove: [fx.whoosh(1400, 500, 0.15, 0.08)],
  invalid: [fx.buzz(240, 150, 0.18, 0.09)],
  submit: [...fx.arp("marimba", ["C5", "E5", "G5"], 0.06, 0.3, 0.8)],
  reveal: [fx.whoosh(300, 2400, 0.5, 0.1), ...fx.chord("brass", ["C4", "G4", "C5"], 0.6, 0.45, 0.25)],
  warn: [fx.buzz(900, 1100, 0.2, 0.05), fx.buzz(900, 1100, 0.2, 0.05, 0.25)],
  bolt: [...fx.crack(0, 0.5), fx.thud(70, 0.6, 0.5, 0.05)],
  boom: [fx.thud(55, 0.7, 0.6), fx.whoosh(2000, 200, 0.5, 0.14)],
  crush: [fx.thud(90, 0.3, 0.45), fx.click(500, 0.1, 0.03)],
  chew: [fx.click(2600, 0.05), fx.click(2300, 0.05, 0.06), fx.click(2500, 0.05, 0.12)],
  drown: [fx.pop(900, 300, 0.12)],
  quake: [fx.thud(45, 0.9, 0.6), fx.whoosh(150, 60, 0.8, 0.12)],
  walk: [fx.pop(700, 1100, 0.12), fx.pop(800, 1300, 0.1, 0.15)],
  breach: [fx.whoosh(200, 900, 0.9, 0.18), fx.thud(60, 0.8, 0.5)],
  hit: [fx.buzz(500, 120, 0.5, 0.16), ...fx.arp("pluck", ["E4", "C4", "A3"], 0.1, 0.3, 0.8)],
  survive: [...fx.arp("marimba", ["C5", "E5", "G5", "C6"], 0.07, 0.45, 0.9), ...fx.chord("bell", ["C5", "G5"], 1, 0.4, 0.3)],
  fail: [fx.thud(60, 0.7, 0.55), ...fx.arp("brass", ["G3", "F#3", "F3", "E3"], 0.24, 0.5, 0.6)],
  alarm: [fx.buzz(700, 1000, 0.25, 0.08), fx.buzz(700, 1000, 0.25, 0.08, 0.32), fx.buzz(700, 1000, 0.25, 0.08, 0.64)],
  vote: [fx.pop(600, 1200, 0.1)],
  tick: [fx.click(2100, 0.1)],
  victory: [...fx.arp("marimba", ["C4", "E4", "G4", "C5", "E5", "G5", "C6"], 0.08, 0.6, 0.9), ...fx.chord("brass", ["C4", "E4", "G4", "C5"], 1.8, 0.5, 0.6)],
} satisfies Record<string, SfxRecipe>;

export type PetCue = keyof typeof SFX;

export const PET_GUARD_SUITE: SuiteConfig = {
  bpm: 116,
  swing: 0.04,
  tracks: [
    { voice: "marimba", div: 2, pattern: "C5 . E5 G5 . E5 C5 . | D5 . F5 A5 . F5 D5 . | E5 . G5 C6 . G5 E5 . | D5 . B4 G4 . A4 B4 .", gain: 0.42 },
    { voice: "pluck", div: 4, pattern: "C4+E4+G4 . C4+E4+G4 . | D4+F4+A4 . D4+F4+A4 . | C4+E4+G4 . C4+E4+G4 . | B3+D4+G4 . B3+D4+G4 .", gain: 0.3 },
    { voice: "upright", div: 4, pattern: "C3 G2 C3 G2 | D3 A2 D3 A2 | C3 G2 E3 G2 | G2 D3 G2 B2", gain: 0.55 },
    { voice: "kick", div: 4, pattern: "x . x .", gain: 0.5 },
    { voice: "clap", div: 4, pattern: ". x . x", gain: 0.25 },
    { voice: "shaker", div: 2, pattern: "x x x x", gain: 0.2 },
    { voice: "brass", div: 4, pattern: "C5 . . G4 | A4 . . F4 | G4 . . E4 | D4 . G4 .", gain: 0.22, level: 1 },
    { voice: "timpani", div: 8, pattern: "C2 G1", gain: 0.35, level: 1 },
  ],
  sfx: SFX,
};

export const getPetGuardSound = defineSuite(PET_GUARD_SUITE);

/** Sounds for one engine step (all clients hear the same thing). */
export function petSoundCues(prev: PetState, next: PetState): PetCue[] {
  if (prev === next) return [];
  const cues: PetCue[] = [];
  if (next.phase === "design" && prev.phase === "design" && next.subs.filter(Boolean).length > prev.subs.filter(Boolean).length) cues.push("submit");
  if (prev.phase === "design" && next.phase === "result") cues.push("reveal");
  if (prev.phase !== "gameOver" && next.phase === "gameOver") cues.push("victory");
  return cues;
}

/** Replay SFX for one sim tick of MY board. */
export function eventCues(events: readonly SimEvent[]): PetCue[] {
  const out: PetCue[] = [];
  for (const e of events) {
    switch (e.k) {
      case "warn":
        out.push("warn");
        break;
      case "bolt":
        out.push("bolt");
        break;
      case "boom":
        out.push("boom");
        break;
      case "crush":
        out.push("crush");
        break;
      case "chew":
        out.push("chew");
        break;
      case "drown":
        out.push("drown");
        break;
      case "quake":
        out.push("quake");
        break;
      case "walk":
        out.push("walk");
        break;
      case "breach":
        out.push("breach");
        break;
      case "hit":
        out.push("hit");
        break;
    }
  }
  return [...new Set(out)];
}
