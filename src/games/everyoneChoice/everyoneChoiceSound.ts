import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import type { ChoiceState } from "./engine";

/**
 * 모두의 선택 "Show of Hands" (rulebook §9) — an original bouncy game-show
 * loop at 112 BPM: marimba hook, plucky bass, claps on 2 and 4, a light
 * shaker. In the last 5 seconds of choosing (intensity 1) a ticking
 * woodblock and a held brass pad join.
 */

const SFX = {
  /** Tapped an option. */
  pick: [fx.pop(500, 900, 0.16)],
  /** Changed the bet. */
  chip: [...fx.coin(0, 2600, 0.09)],
  /** My answer is locked in. */
  commit: [{ inst: "woodblock", note: 1, gain: 0.7 }, ...fx.arp("marimba", ["C5", "G5"], 0.06, 0.3, 0.6)],
  /** Someone else locked in. */
  locked: [{ inst: "rim", note: 1, gain: 0.35 }],
  /** Drumroll + reveal hit. */
  reveal: [...Array.from({ length: 10 }, (_, i) => ({ inst: "snare", note: 1, at: i * 0.06, gain: 0.25 + i * 0.04 })), { inst: "clap", note: 1, at: 0.62, gain: 0.9 }, ...fx.chord("brass", ["C4", "E4", "G4"], 0.5, 0.45, 0.62)],
  /** My side won (arg = points). */
  win: (pts: number) => [...fx.arp("vibes", pts >= 3 ? ["C5", "E5", "G5", "C6", "E6"] : ["C5", "E5", "G5"], 0.07, 0.5, 0.8), ...fx.coin(0.25, 2800, 0.1)],
  /** My side lost. */
  lose: [fx.buzz(260, 140, 0.4, 0.1), { inst: "marimba", note: "C4", at: 0.1, gain: 0.5 }, { inst: "marimba", note: "B3", at: 0.25, gain: 0.5 }],
  /** Nobody scored / no change for me. */
  even: [{ inst: "marimba", note: "G4", gain: 0.5 }, { inst: "marimba", note: "G4", at: 0.15, gain: 0.4 }],
  /** A lone wolf howl. */
  howl: [{ wave: "sine", freq: 420, to: 760, glide: 0.5, dur: 1.2, peak: 0.08, attack: 0.08, vibrato: { rate: 6, depth: 0.02 } }, { wave: "sine", freq: 760, to: 520, glide: 0.6, at: 0.7, dur: 0.8, peak: 0.05, attack: 0.05 }],
  /** New round card. */
  card: [fx.whoosh(500, 1600, 0.25, 0.08), { inst: "glock", note: "E6", at: 0.18, gain: 0.5 }],
  tick: [{ inst: "woodblock", note: 1, gain: 0.6 }],
  victory: [...fx.arp("brass", ["C4", "E4", "G4", "C5"], 0.12, 0.8, 0.8), ...fx.chord("strings", ["C3", "G3", "E4"], 2, 0.5, 0.5), { inst: "clap", note: 1, at: 0.5, gain: 0.8 }, { inst: "clap", note: 1, at: 0.7, gain: 0.8 }],
} satisfies Record<string, SfxRecipe>;

export const EVERYONE_CHOICE_SUITE: SuiteConfig = {
  bpm: 112,
  swing: 0.12,
  tracks: [
    { voice: "marimba", div: 4, pattern: "C5 E5 G5 E5 A5 G5 E5 . | F5 A5 G5 E5 D5 . . . | C5 E5 G5 E5 A5 G5 C6 . | B5 G5 A5 F5 G5 . . . ", gain: 0.12 },
    { voice: "pluck", div: 4, pattern: "C3 . C3 G2 | F2 . F2 C3 | A2 . A2 E2 | G2 . G2 D3 ", gain: 0.2 },
    { voice: "kick", div: 4, pattern: "x . . . x . . . ", gain: 0.3 },
    { voice: "clap", div: 4, pattern: ". . x . . . x . ", gain: 0.18 },
    { voice: "shaker", div: 4, pattern: ". x . x . x . x ", gain: 0.08 },
    { voice: "woodblock", div: 2, pattern: "x . x . x . x . ", gain: 0.12, level: 1 },
    { voice: "brass", div: 16, pattern: "C4+G4 - ", gain: 0.05, level: 1 },
  ],
  sfx: SFX,
};

export const getEveryoneChoiceSound = defineSuite(EVERYONE_CHOICE_SUITE);

export function everyoneChoiceCues(viewer: number) {
  return (prev: ChoiceState, next: ChoiceState): SoundCue[] => {
    const cues: SoundCue[] = [];
    if (next.last && next.last !== prev.last) {
      cues.push("reveal");
      const r = next.last;
      if (r.loners.length) cues.push("howl");
      const d = r.deltas[viewer];
      if (viewer >= 0 && viewer < next.playerCount && r.picks[viewer] !== null && r.picks[viewer] !== undefined) cues.push(d > 0 ? { name: "win", arg: d } : d < 0 ? "lose" : "even");
    } else if (next.phase === "choose" && prev.phase !== "choose") {
      cues.push("card");
    } else if (next.step === prev.step) {
      const was = prev.commits.filter((c) => c !== null).length;
      const now = next.commits.filter((c) => c !== null).length;
      if (now > was) cues.push("locked");
    }
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
