import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { CoupState } from "./engine";

/**
 * 레지스탕스 쿠 "Palace Intrigue" suite — a Renaissance conspiracy in
 * C minor at 100 BPM: a restless harpsichord ostinato over pizzicato bass,
 * a low string line and soft timpani. Once only two players hold influence
 * (intensity 1) a military snare joins. SFX come from the engine's own
 * `lastEvent` narration: wax-seal declarations, coins per income/aid/tax,
 * a dagger for the assassin, a shield clang for blocks, a stab-then-verdict
 * for challenges, a card flip for every lost influence.
 */

const SFX = {
  declare: [fx.click(700, 0.16), { inst: "pizz", note: "G3", at: 0.02 }, { inst: "harpsichord", note: "C5", at: 0.06 }],
  coin1: fx.coin(0, 2600, 0.14),
  coin2: [...fx.coin(0, 2600, 0.13), ...fx.coin(0.09, 2900, 0.12)],
  coin3: [...fx.coin(0, 2600, 0.13), ...fx.coin(0.08, 2900, 0.12), ...fx.coin(0.16, 3200, 0.12), ...fx.arp("brass", ["C4", "G4"], 0.1, 0.35, 0.7)],
  steal: [fx.whoosh(500, 3000, 0.25, 0.16), ...fx.coin(0.2, 2200, 0.1)],
  assassinate: [fx.whoosh(1500, 7000, 0.15, 0.18), { wave: "sine", freq: 3100, dur: 0.6, peak: 0.07, at: 0.12 }, { wave: "sine", freq: 4650, dur: 0.4, peak: 0.04, at: 0.12 }],
  coup: [{ inst: "timpani", note: "C2" }, ...fx.chord("brass", ["C3", "G3", "C4", "Eb4"], 0.9, 1.1, 0.02), fx.thud(70, 0.6, 0.6)],
  shuffle: [0, 0.06, 0.12, 0.18, 0.26].map((at) => fx.cardSlide(at, 0.1)),
  block: [{ wave: "square", freq: 330, to: 300, glide: 0.3, dur: 0.5, peak: 0.08, filter: { type: "bandpass", freq: 1800, q: 3 } }, { wave: "sine", freq: 1240, dur: 0.6, peak: 0.08 }, fx.thud(140, 0.2, 0.3)],
  blocked: [fx.click(500, 0.18), ...fx.chord("strings", ["C4", "Eb4", "Gb4"], 0.6, 0.8)],
  challengeTruth: [...fx.chord("stab", ["C4", "Eb4", "G4"], 0.2, 1.2), ...fx.arp("glock", ["G5", "C6", "Eb6"], 0.07, 0.6, 0.9).map((p) => ({ ...p, at: (p.at ?? 0) + 0.35 }))],
  challengeBluff: [...fx.chord("stab", ["C4", "Eb4", "G4"], 0.2, 1.2), { wave: "noise", at: 0.35, dur: 0.5, peak: 0.3, filter: { type: "lowpass", freq: 3000, to: 200 } }, fx.buzz(180, 90, 0.5, 0.14, 0.35)],
  influenceLost: [fx.cardSlide(0, 0.14), ...fx.chord("strings", ["C3", "Gb3"], 0.9, 0.9, 0.05)],
  eliminated: [fx.cardSlide(0, 0.14), { inst: "timpani", note: "C2", at: 0.05 }, ...fx.chord("choir", ["C3", "Eb3", "Gb3"], 1.4, 1, 0.1)],
  victory: [...fx.arp("harpsichord", ["C4", "Eb4", "G4", "C5", "Eb5", "G5"], 0.06, 0.6), ...fx.chord("brass", ["C4", "E4", "G4", "C5"], 1.8, 1.1, 0.45), { inst: "timpani", note: "C2", at: 0.45 }],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX;

export const COUP_SUITE: SuiteConfig = {
  bpm: 100,
  tracks: [
    {
      voice: "harpsichord",
      pattern:
        "C4 Eb4 G4 Eb4 C5 G4 Eb4 G4 C4 Eb4 G4 Eb4 C5 G4 Eb4 G4 | C4 Eb4 G4 Eb4 C5 G4 Eb4 G4 Bb3 D4 G4 D4 Bb4 G4 D4 G4 | Ab3 C4 Eb4 C4 Ab4 Eb4 C4 Eb4 Ab3 C4 F4 C4 Ab4 F4 C4 F4 | G3 B3 D4 B3 G4 D4 B3 D4 G3 B3 D4 F4 G4 F4 D4 B3",
      gain: 0.7,
    },
    { voice: "pizz", div: 4, pattern: "C3 C3 G2 G2 | C3 C3 Bb2 G2 | Ab2 Ab2 F2 Ab2 | G2 G2 D3 G2", gain: 0.9 },
    { voice: "strings", div: 8, pattern: "G4 - Ab4 G4 | Eb4 F4 D4 -", gain: 0.6 },
    { voice: "timpani", div: 16, pattern: "C2 C2 Ab1 G1", gain: 0.5 },
    { voice: "snare", pattern: "x . x x . . x . x . x x . . x x", gain: 0.35, level: 1 },
  ],
  sfx: SFX,
};

export const getCoupSound = defineSuite(COUP_SUITE);

export function coupSoundCues(prev: CoupState, next: CoupState): Cue[] {
  if (prev.phase !== "gameOver" && next.phase === "gameOver") return ["victory"];
  const e = next.lastEvent;
  if (!e || e === prev.lastEvent) return [];
  switch (e.type) {
    case "declare":
      return ["declare"];
    case "challengeAction":
      return [e.actorHadCard ? "challengeTruth" : "challengeBluff"];
    case "challengeBlock":
      return [e.blockerHadCard ? "challengeTruth" : "challengeBluff"];
    case "block":
      return ["block"];
    case "actionResolved":
      if (e.blocked) return ["blocked"];
      switch (e.action) {
        case "income":
          return ["coin1"];
        case "foreignAid":
          return ["coin2"];
        case "tax":
          return ["coin3"];
        case "steal":
          return ["steal"];
        case "coup":
          return ["coup"];
        case "assassinate":
          return ["assassinate"];
        case "exchange":
          return ["shuffle"];
      }
      return [];
    case "influenceLost":
      return [next.eliminationOrder.length > prev.eliminationOrder.length ? "eliminated" : "influenceLost"];
    case "cardReplaced":
    case "exchangeStarted":
      return ["shuffle"];
    case "exchangeResolved":
      return [];
  }
}

export function coupIntensity(s: CoupState): number {
  return s.players.filter((p) => p.influence.length > 0).length <= 2 ? 1 : 0;
}
