import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { HanamikojiState } from "./engine";

/**
 * 하나미코지 "Gion Teahouse" suite — a slow Kyoto evening in the D miyako-bushi
 * (in) scale (D E♭ G A B♭) at 72 BPM: a koto arpeggio, a breathy shakuhachi
 * line, a low koto drone and sparse taiko with hyoshigi clappers. From round
 * 3 on (intensity 1) the taiko doubles up. SFX: a paper card slide per draw,
 * a hushed wood tap for the secret action, a rustle for the trade-off, a
 * rising koto glissando for every gift/compete offer and a falling one when
 * it's answered, a temple bell + koto flourish when the round's geisha
 * favour is settled.
 */

const IN_UP = ["D5", "Eb5", "G5", "A5", "Bb5", "D6"];

const SFX = {
  draw: [fx.cardSlide(0, 0.1), fx.click(1100, 0.05, 0.06)],
  secret: [{ inst: "woodblock", note: 0.7 }, { wave: "noise", at: 0.05, dur: 0.4, peak: 0.05, attack: 0.1, filter: { type: "bandpass", freq: 1200, q: 0.8 } }],
  tradeoff: [fx.cardSlide(0, 0.12), fx.cardSlide(0.12, 0.12), { inst: "koto", note: "A3", at: 0.2, gain: 0.8 }],
  offer: fx.arp("koto", IN_UP, 0.05, 0.9),
  answered: fx.arp("koto", [...IN_UP].reverse(), 0.05, 0.9, 0.9),
  roundEnd: [{ inst: "bell", note: "D4" }, ...fx.arp("koto", ["D4", "G4", "A4", "D5"], 0.15, 1.2, 1).map((p) => ({ ...p, at: (p.at ?? 0) + 0.4 }))],
  victory: [{ inst: "bell", note: "D4" }, { inst: "taiko", note: 1, at: 0.1 }, ...fx.arp("koto", ["D4", "Eb4", "G4", "A4", "Bb4", "D5", "Eb5", "G5", "A5", "D6"], 0.06, 1.2).map((p) => ({ ...p, at: (p.at ?? 0) + 0.3 })), { inst: "shakuhachi", note: "D5", at: 1.0, dur: 1.4 }],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX;

export const HANAMIKOJI_SUITE: SuiteConfig = {
  bpm: 72,
  tracks: [
    {
      voice: "koto",
      div: 2,
      pattern: "D4 A4 Bb4 A4 D5 A4 G4 A4 | Eb4 G4 A4 G4 D5 A4 G4 Eb4 | D4 G4 A4 D5 Eb5 D5 A4 G4 | A3 D4 Eb4 G4 A4 - . .",
      gain: 0.65,
    },
    { voice: "shakuhachi", div: 4, pattern: "A4 - - G4 | Bb4 - A4 - | D5 - Eb5 D5 | A4 - - - | . . . . | G4 - A4 Bb4 | A4 - G4 Eb4 | D4 - - -", gain: 0.7 },
    { voice: "koto", div: 8, pattern: "D3 . G2 . Bb2 . A2 .", gain: 0.5 },
    { voice: "taiko", div: 4, pattern: "X . . . | . . x . | X . . . | . . x x", gain: 0.45 },
    { voice: "woodblock", div: 2, pattern: ". . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . . . X x", gain: 0.6 },
    { voice: "taiko", div: 2, pattern: ". . x . . . x x", gain: 0.3, level: 1 },
  ],
  sfx: SFX,
};

export const getHanamikojiSound = defineSuite(HANAMIKOJI_SUITE);

export function hanamikojiSoundCues(prev: HanamikojiState, next: HanamikojiState): Cue[] {
  if (prev === next) return [];
  if (prev.phase !== "match-end" && next.phase === "match-end") return ["victory"];
  if (prev.phase !== "round-end" && next.phase === "round-end") return ["roundEnd"];
  const cues: Cue[] = [];
  if (next.deck.length < prev.deck.length && prev.roundNumber === next.roundNumber) cues.push("draw");
  for (const owner of ["p1", "p2"] as const) {
    const before = prev.players[owner].actionsUsed;
    const after = next.players[owner].actionsUsed;
    if (after.length > before.length) {
      const used = after[after.length - 1];
      if (used === "secret") cues.push("secret");
      else if (used === "tradeoff") cues.push("tradeoff");
      else cues.push("offer");
    }
  }
  if (prev.pendingOffer && !next.pendingOffer) cues.push("answered");
  return cues;
}
