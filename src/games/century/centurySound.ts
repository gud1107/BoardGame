import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { detectAcquireEvent } from "./MerchantEffects";
import type { CenturyState, ResourceBundle } from "./engine";

/**
 * 센추리: 향신료의 길 "Silk Road Caravan" suite — a desert caravan in
 * D hijaz (D E♭ F♯ G A B♭ C) at 100 BPM: an oud melody over a maqsum
 * darbuka rhythm (doum/tek), a D–A drone and camel-bell jingles. Once the
 * final round is triggered (intensity 1) a ney flute line and a shaker join.
 * SFX from each seat's diff: a spice pour (more resources → longer pour) for
 * production, a sizzle for trades/upgrades, a sack thud + coin for
 * acquiring a merchant card, the camel bells for resting, a gold-coin
 * fanfare for claiming a point card, a gong when the end is triggered.
 */

const SFX = {
  produce: (n: number) => [fx.cardSlide(0, 0.1), ...Array.from({ length: Math.min(6, Math.max(1, n)) }, (_, i) => ({ wave: "noise" as const, at: 0.05 + i * 0.05, dur: 0.07, peak: 0.07, filter: { type: "bandpass" as const, freq: 1800 + i * 300, q: 1.5 } }))],
  trade: [fx.cardSlide(0, 0.1), fx.whoosh(800, 4000, 0.3, 0.1, 0.05), ...fx.arp("oud", ["D4", "F#4", "A4"], 0.06, 0.4, 0.8).map((p) => ({ ...p, at: (p.at ?? 0) + 0.1 }))],
  acquire: [fx.thud(130, 0.2, 0.35), { wave: "noise", dur: 0.25, peak: 0.08, filter: { type: "bandpass", freq: 1200, q: 0.8 } }, ...fx.coin(0.12, 2300, 0.1)],
  rest: [...[0, 0.12, 0.24, 0.4].flatMap((at, i) => fx.coin(at, 3000 + (i % 2) * 400, 0.07)), { inst: "oud", note: "D3", at: 0.1 }],
  claim: [...fx.arp("oud", ["D4", "F#4", "A4", "D5"], 0.07, 0.5), ...fx.coin(0.3, 2600, 0.12), ...fx.coin(0.38, 3000, 0.1)],
  discard: [fx.whoosh(3000, 900, 0.25, 0.1)],
  endTrigger: [{ inst: "gong", note: 1 }, ...[0, 0.08, 0.16, 0.24, 0.3, 0.36].map((at) => ({ inst: "doum", note: 1, at, gain: 0.7 }))],
  victory: [{ inst: "gong", note: 1 }, ...fx.arp("oud", ["D4", "Eb4", "F#4", "G4", "A4", "Bb4", "C5", "D5"], 0.07, 0.6).map((p) => ({ ...p, at: (p.at ?? 0) + 0.2 })), ...fx.chord("flute", ["D5", "A5"], 1.4, 0.8, 0.8)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const CENTURY_SUITE: SuiteConfig = {
  bpm: 100,
  tracks: [
    { voice: "oud", div: 2, pattern: "D4 Eb4 F#4 G4 A4 - G4 F#4 | Eb4 - D4 - . . . . | G4 A4 Bb4 A4 G4 F#4 Eb4 D4 | F#4 - Eb4 - D4 - - .", gain: 0.75 },
    { voice: "doum", pattern: "X . . . . . x . X . . . . . . .", gain: 0.6 },
    { voice: "tek", pattern: ". . x . x . . . . . x . x . x .", gain: 0.7 },
    { voice: "bass", div: 16, pattern: "D2", gain: 0.5 },
    { voice: "pad", div: 16, pattern: "D3+A3 D3+A3 C3+G3 D3+A3", gain: 0.45 },
    { voice: "triangle", div: 8, pattern: "x . . . . . . .", gain: 0.6 },
    { voice: "flute", div: 4, pattern: "A5 - - Bb5 | A5 - G5 F#5 | G5 - - A5 | F#5 - Eb5 D5", gain: 0.5, level: 1 },
    { voice: "shaker", pattern: "x x X x x x X x x x X x x x X x", gain: 0.7, level: 1 },
  ],
  sfx: SFX,
};

export const getCenturySound = defineSuite(CENTURY_SUITE);

const total = (b: ResourceBundle) => Object.values(b).reduce<number>((s, n) => s + (n ?? 0), 0);

export function centurySoundCues(prev: CenturyState, next: CenturyState): Cue[] {
  if (prev === next) return [];
  if (prev.phase !== "gameOver" && next.phase === "gameOver") return ["victory"];
  const cues: Cue[] = [];
  if (detectAcquireEvent(prev, next)) cues.push("acquire");
  next.players.forEach((p, i) => {
    const b = prev.players[i];
    if (!b) return;
    if (p.pointCards.length > b.pointCards.length) cues.push("claim");
    else if (p.playedCards.length === 0 && b.playedCards.length > 0 && p.hand.length > b.hand.length) cues.push("rest");
    else if (p.playedCards.length > b.playedCards.length) {
      const gained = total(p.resources) - total(b.resources);
      cues.push(gained > 0 ? { name: "produce", arg: gained } : "trade");
    } else if (total(p.resources) < total(b.resources) && prev.phase === "discarding") cues.push("discard");
  });
  if (!prev.endTriggered && next.endTriggered) cues.push("endTrigger");
  return cues;
}
