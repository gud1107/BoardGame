import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { detectAuctionWinEvent, detectBidEvent, detectPassEvent, detectSaleRevealEvent } from "./ForSaleEffects";
import type { ForSaleState } from "./engine";

/**
 * 포세일 "Open House Bossa" suite — a sunny real-estate-agency bossa nova
 * at 110 BPM (Fmaj7–Em7–Dm7–G7): nylon-guitar comping on the bossa rhythm,
 * upright bass, rim-click clave and an electric-piano tune. Phase 2 (check
 * selling, intensity 1) swaps the tune to flute and adds a shaker. SFX reuse
 * the board's own state-diff detectors (ForSaleEffects.tsx): coins per bid
 * (more coins for bigger raises), a card slide on pass, a gavel when a
 * property is won, a face-down slide per submission and a cash register on
 * the reveal.
 */

const SFX = {
  bid: (amount: number) => Array.from({ length: Math.min(5, Math.max(1, Math.round(amount / 1000))) }, (_, i) => fx.coin(i * 0.06, 2500 + i * 180, 0.12)).flat(),
  pass: [fx.cardSlide(0, 0.14), { wave: "triangle", freq: 520, to: 330, glide: 0.18, dur: 0.22, peak: 0.12, at: 0.05 }, ...fx.coin(0.2, 2200, 0.08)],
  sold: [{ inst: "woodblock", note: 0.5 }, { inst: "woodblock", note: 0.5, at: 0.16 }, fx.thud(180, 0.15, 0.35, 0.16), ...fx.arp("vibes", ["C5", "E5", "G5"], 0.08, 0.8, 0.9).map((p) => ({ ...p, at: (p.at ?? 0) + 0.3 }))],
  submit: [fx.cardSlide(0, 0.12), fx.click(900, 0.08, 0.08)],
  reveal: [fx.cardSlide(0, 0.12), fx.cardSlide(0.05, 0.1), ...fx.chord("bell", ["C6", "E6"], 0.9, 0.7, 0.18), ...[0.25, 0.3, 0.36, 0.42].flatMap((at, i) => fx.coin(at, 2700 + i * 200, 0.09))],
  phase2: [...fx.arp("vibes", ["F4", "A4", "C5", "E5", "G5"], 0.09, 1, 0.9)],
  gameOver: [...fx.arp("epiano", ["C4", "E4", "G4", "B4", "D5"], 0.1, 1.2), ...fx.chord("vibes", ["C5", "E5", "G5", "B5"], 1.8, 0.9, 0.5), ...fx.coin(0.5, 3000, 0.1)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

const COMP = (c: string) => `${c} . . ${c} . . ${c} . . . ${c} . . ${c} . .`;

export const FOR_SALE_SUITE: SuiteConfig = {
  bpm: 110,
  tracks: [
    {
      voice: "guitar",
      pattern: [COMP("F3+A3+C4+E4"), COMP("E3+G3+B3+D4"), COMP("D3+F3+A3+C4"), COMP("G3+B3+D4+F4")].join(" | "),
      gain: 0.5,
    },
    { voice: "upright", div: 2, pattern: "F2 - - C3 F2 - - C3 | E2 - - B2 E2 - - B2 | D2 - - A2 D2 - - A2 | G2 - - D3 G2 - - D2", gain: 0.9 },
    { voice: "rim", pattern: "x . . x . . x . . . x . . x . .", gain: 0.6 },
    { voice: "brush", div: 2, pattern: "x x x x x x x x", gain: 0.5 },
    { voice: "epiano", div: 2, pattern: "A4 - G4 E4 - - C4 D4 | E4 - - - D4 - B3 . | C4 - A3 F4 - - E4 D4 | B3 - - - G3 - . .", gain: 0.8, maxLevel: 1 },
    { voice: "flute", div: 2, pattern: "A5 - G5 E5 - - C5 D5 | E5 - - - D5 - B4 . | C5 - A4 F5 - - E5 D5 | B4 - - - G4 - . .", gain: 0.6, level: 1 },
    { voice: "shaker", pattern: "x x X x x x X x x x X x x x X x", gain: 0.7, level: 1 },
  ],
  sfx: SFX,
};

export const getForSaleSound = defineSuite(FOR_SALE_SUITE);

export function forSaleSoundCues(prev: ForSaleState, next: ForSaleState): Cue[] {
  if (prev === next) return [];
  if (prev.phase !== "gameOver" && next.phase === "gameOver") return ["gameOver"];
  const cues: Cue[] = [];
  const bid = detectBidEvent(prev, next);
  if (bid) cues.push({ name: "bid", arg: bid.amount });
  if (detectPassEvent(prev, next)) cues.push("pass");
  if (detectAuctionWinEvent(prev, next)) cues.push("sold");
  if (prev.phase === "buying" && next.phase === "selling") cues.push("phase2");
  if (detectSaleRevealEvent(prev, next)) cues.push("reveal");
  else if (prev.sale && next.sale && Object.keys(next.sale.submissions).length > Object.keys(prev.sale.submissions).length) cues.push("submit");
  return cues;
}
