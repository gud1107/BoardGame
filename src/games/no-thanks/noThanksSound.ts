import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { detectAuctionEvent } from "./AuctionEffects";
import type { NoThanksState } from "./engine";

/**
 * 노땡스 "Polite Refusal Swing" suite — a sly cocktail-jazz combo at 112 BPM
 * (swung): walking upright bass, brushes, a vibraphone comp on ii–V–I in
 * B♭ and a muted-trumpet hook. Once the deck is nearly empty (intensity 1)
 * the ride cymbal comes in. SFX reuse AuctionEffects.tsx's detector: a single
 * chip toss + "nope" boop for every "No thanks!", a chip-pile sweep (bigger
 * pile → more clinks) when someone gives in and takes the card, a happy
 * chime when the taken card extends their run, and a fresh card flip.
 */

const SFX = {
  pass: [...fx.coin(0, 2400, 0.13), { wave: "triangle", freq: 440, to: 300, glide: 0.12, dur: 0.15, peak: 0.12, at: 0.06 }],
  take: (chips: number) => [fx.cardSlide(0, 0.14), ...Array.from({ length: Math.min(8, Math.max(1, chips)) }, (_, i) => fx.coin(0.05 + i * 0.045, 2000 + i * 140, 0.09)).flat()],
  run: fx.arp("vibes", ["Bb4", "D5", "F5", "Bb5"], 0.06, 0.8),
  ouch: [{ inst: "brass", note: "F3", dur: 0.25 }, { inst: "brass", note: "E3", at: 0.25, dur: 0.25 }, { inst: "brass", note: "Eb3", at: 0.5, dur: 0.6 }],
  flip: [fx.cardSlide(0, 0.1), fx.click(1600, 0.06, 0.07)],
  finale: [...fx.arp("vibes", ["Bb3", "D4", "F4", "A4", "C5", "D5"], 0.07, 1.2), ...fx.chord("brass", ["Bb3", "D4", "F4", "A4"], 1.4, 0.7, 0.5)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const NO_THANKS_SUITE: SuiteConfig = {
  bpm: 112,
  swing: 0.3,
  tracks: [
    { voice: "upright", div: 4, pattern: "C3 Eb3 G3 A3 | F2 A2 C3 Eb3 | Bb2 D3 F3 G3 | Bb2 A2 G2 F2", gain: 1 },
    { voice: "vibes", div: 4, pattern: ". C4+Eb4+G4+Bb4 . . | . F3+A3+Eb4 . . | . Bb3+D4+F4+A4 . . | . G3+Bb3+D4+F4 . .", gain: 0.45 },
    { voice: "brass", div: 2, pattern: ". . G4 Bb4 C5 - Bb4 G4 | A4 - - - . . . . | . . F4 G4 Bb4 - A4 F4 | G4 - - - . . . .", gain: 0.5 },
    { voice: "brush", div: 2, pattern: "x x X x x x X x", gain: 0.8 },
    { voice: "ride", div: 2, pattern: "x . x x x . x x", gain: 0.9, level: 1 },
  ],
  sfx: SFX,
};

export const getNoThanksSound = defineSuite(NO_THANKS_SUITE);

export function noThanksSoundCues(prev: NoThanksState, next: NoThanksState): Cue[] {
  if (prev === next) return [];
  if (prev.phase === "playing" && next.phase !== "playing") return ["finale"];
  const e = detectAuctionEvent(prev, next);
  if (!e) return [];
  if (e.kind === "pass") return ["pass"];
  const cues: Cue[] = [{ name: "take", arg: e.coinCount }];
  const taker = prev.players.find((p) => p.seat === e.seat);
  if (e.cardValue !== null && taker?.cards.some((c) => Math.abs(c - e.cardValue!) === 1)) cues.push("run");
  else if (e.cardValue !== null && e.cardValue >= 28 && e.coinCount < 5) cues.push("ouch");
  if (next.currentCard !== null) cues.push("flip");
  return cues;
}
