import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { StarRummyState } from "./engine";

/**
 * 별빛 러미 "Constellation Table" suite — a calm night-sky D major (4/4,
 * 84 BPM): glockenspiel starlight arpeggios over a soft pad and a slow
 * upright bass. Intensity 1 (someone is down to 3 tiles or fewer) adds a
 * shaker and a vibes counter-line so the race to empty a hand is audible.
 * SFX: tiles clicking down (one per tile, capped), a twinkle sweep when the
 * table is rearranged, a short fanfare for the opening meld, a tile slide for
 * draws, a muted tap for a pass, and a star-shower for emptying a hand.
 */

const SFX = {
  meld: (count: number) => Array.from({ length: Math.min(6, Math.max(1, count)) }, (_, i) => fx.click(1500 + (i % 3) * 180, 0.16, i * 0.06)),
  rearrange: [fx.whoosh(900, 4200, 0.35, 0.1), ...fx.arp("glock", ["A5", "D6", "F#6", "A6"], 0.05, 0.5, 0.7).map((p) => ({ ...p, at: (p.at ?? 0) + 0.12 }))],
  opened: [...fx.chord("vibes", ["D4", "F#4", "A4"], 0.9, 0.8), ...fx.arp("glock", ["D5", "F#5", "A5", "D6"], 0.08, 0.6, 0.8).map((p) => ({ ...p, at: (p.at ?? 0) + 0.1 }))],
  draw: [fx.cardSlide(0, 0.1), fx.click(2200, 0.08, 0.09)],
  pass: [fx.click(700, 0.1), fx.click(560, 0.08, 0.08)],
  out: [...fx.arp("glock", ["D6", "A5", "F#6", "D6", "A6", "F#6", "D7"], 0.045, 0.6, 0.8), ...fx.chord("bell", ["D5", "A5"], 1.4, 0.6, 0.3)],
  roundEnd: fx.chord("bell", ["D5", "F#5", "A5"], 1.6, 0.6),
  victory: [...fx.arp("vibes", ["D4", "F#4", "A4", "D5", "F#5", "A5"], 0.07, 0.8), ...fx.chord("bell", ["D5", "F#5", "A5", "D6"], 2, 0.7, 0.45)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const STAR_RUMMY_SUITE: SuiteConfig = {
  bpm: 84,
  tracks: [
    {
      voice: "glock",
      div: 4,
      pattern: "F#5 A5 D6 A5 | E5 A5 C#6 A5 | D5 F#5 B5 F#5 | D5 G5 B5 G5 | F#5 A5 D6 A5 | E5 G5 B5 G5 | A5 - G5 F#5 | E5 - - .",
      gain: 0.45,
    },
    { voice: "pad", div: 16, pattern: "D3+F#3+A3 A2+E3+C#4 B2+F#3+D4 G2+D3+B3 D3+F#3+A3 E3+G3+B3 A2+E3+G3 A2+E3+C#4", gain: 0.5 },
    { voice: "upright", div: 8, pattern: "D2 A2 | A1 E2 | B1 F#2 | G1 D2 | D2 A2 | E2 B2 | A1 E2 | A1 .", gain: 0.8 },
    { voice: "shaker", div: 2, pattern: "x x X x x x X x", gain: 0.6, level: 1 },
    { voice: "vibes", div: 8, pattern: "A4 - | C#5 - | B4 - | D5 - | A4 - | B4 - | C#5 - | E5 -", gain: 0.4, level: 1 },
  ],
  sfx: SFX,
};

export const getStarRummySound = defineSuite(STAR_RUMMY_SUITE);

/** BGM intensity: 1 once any seat is close to going out. */
export function starRummyIntensity(state: StarRummyState): number {
  return state.phase === "playing" && state.hands.some((h) => h.length <= 3) ? 1 : 0;
}

export function starRummySoundCues(prev: StarRummyState, next: StarRummyState): Cue[] {
  if (prev === next) return [];
  const cues: Cue[] = [];
  const ev = next.lastEvent;
  if (ev && ev.seq !== prev.lastEvent?.seq) {
    if (ev.kind === "meld") {
      if (ev.opened) cues.push("opened");
      else if (ev.rearranged) cues.push("rearrange");
      cues.push({ name: "meld", arg: ev.played.length });
    } else if (ev.kind === "draw") cues.push("draw");
    else if (ev.kind === "pass") cues.push("pass");
    else if (ev.kind === "out") cues.push("out");
  }
  if (prev.phase === "playing" && next.phase === "gameOver") cues.push("victory");
  else if (prev.phase === "playing" && next.phase === "roundEnd") cues.push("roundEnd");
  return cues;
}
