import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { PlayerState, SplendorState, TokenBundle } from "./engine";

/**
 * 스플렌더 "Venetian Jewel Market" suite — a Renaissance gem merchants'
 * barcarolle in B♭ major, 6/8 at 92 BPM (12 sixteenths per bar): a
 * tremolo mandolin tune over a harp arpeggio, a string pad and glockenspiel
 * glints. When the final round is triggered (intensity 1) timpani and a
 * horn line join. SFX come from each seat's own diff: one glassy gem clink
 * per token taken, a gold coin + card slide for a reservation, a velvet card
 * thud (with a sparkle if it carries prestige) for a purchase, a court
 * fanfare when a noble visits, and a bell toll when someone hits 15.
 */

const SFX = {
  gems: (n: number) => Array.from({ length: Math.min(5, Math.max(1, n)) }, (_, i) => [{ wave: "sine" as const, freq: 2800 + i * 320, dur: 0.3, peak: 0.1, at: i * 0.08 }, { wave: "sine" as const, freq: (2800 + i * 320) * 2.4, dur: 0.12, peak: 0.04, at: i * 0.08 }]).flat(),
  discard: [fx.whoosh(3000, 900, 0.2, 0.1), ...fx.coin(0.1, 1800, 0.06)],
  reserve: [fx.cardSlide(0, 0.13), ...fx.coin(0.12, 2000, 0.13), { inst: "harp", note: "F4", at: 0.15 }],
  buy: [fx.cardSlide(0, 0.12), fx.thud(200, 0.15, 0.3, 0.06), { inst: "harp", note: "Bb4", at: 0.06 }],
  buyPrestige: [fx.cardSlide(0, 0.12), fx.thud(200, 0.15, 0.3, 0.06), ...fx.arp("glock", ["Bb5", "D6", "F6"], 0.06, 0.6, 0.9).map((p) => ({ ...p, at: (p.at ?? 0) + 0.08 }))],
  noble: [...fx.arp("brass", ["Bb3", "D4", "F4"], 0.12, 0.3), ...fx.chord("brass", ["Bb3", "D4", "F4", "Bb4"], 1.2, 1, 0.36), ...fx.arp("glock", ["F6", "Bb6"], 0.1, 0.6, 0.6).map((p) => ({ ...p, at: (p.at ?? 0) + 0.4 }))],
  endTrigger: [{ inst: "bell", note: "Bb3" }, { inst: "bell", note: "Bb3", at: 0.7, gain: 0.7 }, { inst: "timpani", note: "Bb1" }],
  victory: [...fx.arp("harp", ["Bb3", "D4", "F4", "Bb4", "D5", "F5", "Bb5"], 0.06, 1.2), ...fx.chord("brass", ["Bb3", "D4", "F4", "Bb4"], 1.8, 1.1, 0.5), { inst: "timpani", note: "Bb1", at: 0.5 }],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const SPLENDOR_SUITE: SuiteConfig = {
  bpm: 92,
  tracks: [
    {
      voice: "mandolin",
      div: 2,
      pattern:
        "D5 - C5 D5 F5 - | D5 - - Bb4 - - | G4 - Bb4 Eb5 - D5 | C5 - - - - - | D5 - Eb5 F5 - G5 | F5 - D5 Bb4 - - | C5 - Bb4 A4 - C5 | Bb4 - - - - -",
      gain: 0.7,
    },
    { voice: "harp", div: 2, pattern: "Bb2 F3 Bb3 D4 Bb3 F3 | G2 D3 G3 Bb3 G3 D3 | Eb3 Bb3 Eb4 G4 Eb4 Bb3 | F2 C3 F3 A3 C4 A3", gain: 0.55 },
    { voice: "strings", div: 12, pattern: "Bb3+D4 G3+Bb3 Eb3+G3 F3+A3", gain: 0.4 },
    { voice: "glock", div: 6, pattern: ". F6 . . . D6 . . . Bb5 . . . C6 . A5", gain: 0.35 },
    { voice: "timpani", div: 6, pattern: "Bb1 . G1 . Eb2 . F1 F1", gain: 0.5, level: 1 },
    { voice: "brass", div: 12, pattern: "F4 D4 Eb4 C4", gain: 0.4, level: 1 },
  ],
  sfx: SFX,
};

export const getSplendorSound = defineSuite(SPLENDOR_SUITE);

const total = (b: TokenBundle) => Object.values(b).reduce<number>((s, n) => s + (n ?? 0), 0);

export function splendorSoundCues(prev: SplendorState, next: SplendorState): Cue[] {
  if (prev === next) return [];
  if (prev.phase !== "gameOver" && next.phase === "gameOver") return ["victory"];
  const cues: Cue[] = [];
  next.players.forEach((p: PlayerState, i) => {
    const b = prev.players[i];
    if (!b) return;
    const bought = p.purchasedCards.length > b.purchasedCards.length;
    if (bought) cues.push((p.purchasedCards[p.purchasedCards.length - 1]?.points ?? 0) > 0 ? "buyPrestige" : "buy");
    else if (p.reservedCards.length > b.reservedCards.length) cues.push("reserve");
    else if (total(p.tokens) > total(b.tokens)) cues.push({ name: "gems", arg: total(p.tokens) - total(b.tokens) });
    else if (total(p.tokens) < total(b.tokens)) cues.push("discard");
    if (p.nobles.length > b.nobles.length) cues.push("noble");
  });
  if (!prev.endTriggered && next.endTriggered) cues.push("endTrigger");
  return cues;
}
