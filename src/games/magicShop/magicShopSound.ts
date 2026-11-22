import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { cardDef } from "./cards";
import type { MagicState } from "./engine";

/**
 * 마법 상점 "Moonlit Apothecary" suite — a lilting D-minor shop waltz
 * (3/4 feel at 92 BPM): music box + harp arpeggios over pizzicato bass and a
 * soft pad, a ticking shop clock (woodblock). Intensity 1 (the final round)
 * adds a flute line and a low timpani pulse.
 *
 * SFX: card play by what it gives (🪙 coin, element sparkle, draw flutter,
 * 🧹 trash sweep, 🪞 mirror shimmer, 🪧 명성 bell), buying (pitch by price),
 * a fulfilled order (bigger for 7+ 명성), 🔄 send-away, 🐈‍⬛ curse hiss,
 * reshuffle riffle, a customer leaving, my-turn chime, last-10-s tick,
 * time-out, end of turn, final fanfare.
 */

const SFX = {
  ui: [fx.click(1500, 0.08)],
  invalid: [fx.buzz(240, 150, 0.18, 0.09)],
  coin: [...fx.coin(0, 2500, 0.11)],
  element: [fx.pop(600, 1300, 0.14), { inst: "glock", note: "A6", at: 0.03, dur: 0.25, gain: 0.45 }],
  draw: [fx.whoosh(1800, 3800, 0.12, 0.06), fx.whoosh(2200, 4200, 0.1, 0.05, 0.07)],
  trash: [fx.whoosh(900, 300, 0.35, 0.12), fx.click(600, 0.08, 0.2)],
  mirror: [...fx.arp("glock", ["D6", "F6", "A6", "D7"], 0.04, 0.35, 0.5), fx.whoosh(3000, 6000, 0.3, 0.04)],
  fame: fx.chord("bell", ["D5", "A5"], 0.9, 0.5),
  buy: (cost: number) => [
    ...fx.coin(0, 2000 + cost * 120, 0.12),
    { inst: "musicbox", note: cost >= 6 ? "A5" : cost >= 4 ? "F5" : "D5", at: 0.06, dur: 0.4, gain: 0.7 },
  ],
  fulfil: (big: number) =>
    big
      ? [...fx.arp("harp", ["D4", "F4", "A4", "D5", "F5", "A5", "D6"], 0.05, 0.6, 0.8), ...fx.chord("bell", ["D5", "A5", "D6"], 1.4, 0.5, 0.35)]
      : [...fx.arp("musicbox", ["A5", "D6", "F6"], 0.07, 0.4, 0.8), fx.pop(500, 1000, 0.12, 0.1)],
  reroll: [fx.whoosh(600, 1800, 0.25, 0.08), fx.click(1200, 0.08, 0.18)],
  curse: [fx.whoosh(5000, 1500, 0.35, 0.06), fx.buzz(180, 90, 0.3, 0.06, 0.1)],
  reshuffle: [0, 0.04, 0.08, 0.12, 0.16].map((at) => fx.click(2600 - at * 4000, 0.05, at)),
  leave: [{ inst: "pizz", note: "A3", dur: 0.3, gain: 0.6 }, { inst: "pizz", note: "D3", at: 0.18, dur: 0.4, gain: 0.6 }],
  endTurn: [fx.thud(160, 0.18, 0.25), fx.click(1100, 0.06, 0.05)],
  myTurn: fx.arp("harp", ["D5", "F5", "A5"], 0.08, 0.4, 0.7),
  tick: [fx.click(2100, 0.1)],
  timeout: [fx.buzz(330, 200, 0.3, 0.1), fx.click(900, 0.08, 0.25)],
  victory: [...fx.arp("harp", ["D4", "A4", "D5", "F5", "A5", "D6", "F6"], 0.08, 0.7, 0.9), ...fx.chord("bell", ["D5", "F#5", "A5", "D6"], 2.2, 0.6, 0.6)],
} satisfies Record<string, SfxRecipe>;

export type MagicCue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const MAGIC_SHOP_SUITE: SuiteConfig = {
  bpm: 92,
  swing: 0.08,
  tracks: [
    // 3/4 feel inside 4/4 steps: 6 eighths per bar → patterns of 12 sixteenth-pairs
    { voice: "musicbox", div: 2, pattern: "D6 . A5 . F5 . | E6 . A5 . C#6 . | F6 . D6 . A5 . | E6 . D6 . C#6 . | D6 . A5 . F5 . | G5 . A5 . A#5 . | A5 . F5 . D5 . | E5 . - . . .", gain: 0.42 },
    { voice: "harp", div: 2, pattern: "D4 A4 D5 A4 F4 A4 | A3 E4 A4 E4 C#4 E4 | D4 A4 D5 A4 F4 A4 | A3 E4 A4 E4 C#4 E4 | A#3 F4 A#4 F4 D4 F4 | G3 D4 G4 D4 A#3 D4 | A3 E4 A4 E4 C#4 E4 | A3 E4 G4 E4 C#4 A3", gain: 0.32 },
    { voice: "pizz", div: 4, pattern: "D3 . . | A2 . . | D3 . . | A2 . . | A#2 . . | G2 . . | A2 . . | A2 . .", gain: 0.6 },
    { voice: "pad", div: 12, pattern: "D3+F3+A3 A2+C#3+E3 D3+F3+A3 A2+C#3+E3 A#2+D3+F3 G2+A#2+D3 A2+C#3+E3 A2+C#3+E3", gain: 0.2 },
    { voice: "woodblock", div: 4, pattern: "x . x", gain: 0.25 },
    { voice: "flute", div: 4, pattern: "A5 - F5 | E5 - - | F5 G5 A5 | E5 - - | F5 - D5 | D5 - A#4 | C#5 - E5 | A5 - -", gain: 0.3, level: 1 },
    { voice: "timpani", div: 12, pattern: "D2 A1", gain: 0.35, level: 1 },
  ],
  sfx: SFX,
};

export const getMagicShopSound = defineSuite(MAGIC_SHOP_SUITE);

/** BGM intensity: 1 in the final round. */
export function magicIntensity(state: MagicState): number {
  return state.phase === "playing" && state.finalRound ? 1 : 0;
}

function playCue(id: number): MagicCue {
  const d = cardDef(id);
  if (d.mirror) return "mirror";
  if (d.trash) return "trash";
  if (d.fame) return "fame";
  if (d.draw) return "draw";
  if (d.els.some((v) => v > 0)) return "element";
  return "coin";
}

/** Sounds for one engine step (all clients hear the same thing). */
export function magicSoundCues(prev: MagicState, next: MagicState): MagicCue[] {
  if (prev === next) return [];
  const cues: MagicCue[] = [];
  const fresh = next.log.filter((e) => e.seq > prev.seq);
  let plays = 0;
  for (const e of fresh) {
    switch (e.kind) {
      case "play":
        // "모두 내기" can play many cards at once — cap the clatter
        if (plays++ < 3) cues.push(playCue(e.card!));
        break;
      case "buy":
        cues.push({ name: "buy", arg: cardDef(e.card!).cost });
        break;
      case "fulfil":
        cues.push({ name: "fulfil", arg: (e.n ?? 0) >= 7 ? 1 : 0 });
        break;
      case "reroll":
        cues.push("reroll");
        break;
      case "curse":
        cues.push("curse");
        break;
      case "reshuffle":
        cues.push("reshuffle");
        break;
      case "leave":
        cues.push("leave");
        break;
      case "end":
        cues.push("endTurn");
        break;
      case "timeout":
        cues.push("timeout");
        break;
      case "trash":
        break;
    }
  }
  if (prev.phase === "playing" && next.phase === "gameOver") cues.push("victory");
  return cues;
}
