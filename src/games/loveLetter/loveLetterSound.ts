import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { LoveLetterState } from "./engine";

/**
 * 러브레터 "Courtly Waltz" suite — a palace romance in F major, 3/4 at
 * 90 BPM: harp arpeggios, a flute melody and pizzicato bass on the downbeat
 * (12 sixteenths per bar). With only two suitors left (intensity 1) a string
 * pad swells underneath. SFX come from the engine's `lastEvent`, one
 * character each: the guard's blade (hit or whiff), the priest's peek
 * sparkle, the baron's duel clash, the handmaid's harp shield, the prince's
 * trumpet, the king's swap, the countess's curtsey chord and the princess's
 * heartbreak.
 */

const later = (parts: ReturnType<typeof fx.arp>, dt: number) => parts.map((p) => ({ ...p, at: (p.at ?? 0) + dt }));

const SFX = {
  draw: [fx.cardSlide(0, 0.11)],
  guardHit: [fx.whoosh(900, 5000, 0.15, 0.16), { wave: "sine", freq: 2900, dur: 0.5, peak: 0.08, at: 0.12 }, ...later(fx.arp("harp", ["A4", "F4", "D4", "A3"], 0.09, 0.8), 0.25)],
  guardMiss: [fx.whoosh(900, 3000, 0.2, 0.12), { inst: "pizz", note: "C4", at: 0.15 }],
  fizzle: [{ inst: "harp", note: "C5" }],
  priest: [...fx.arp("glock", ["C6", "G6", "E6"], 0.08, 0.7, 0.8), { wave: "noise", dur: 0.6, peak: 0.03, attack: 0.2, filter: { type: "bandpass", freq: 5000, q: 2 } }],
  baron: [{ wave: "sine", freq: 2600, dur: 0.4, peak: 0.1 }, { wave: "sine", freq: 3700, dur: 0.3, peak: 0.06 }, fx.thud(150, 0.2, 0.3), { wave: "sine", freq: 2400, dur: 0.35, peak: 0.08, at: 0.14 }],
  baronTie: [{ wave: "sine", freq: 2600, dur: 0.3, peak: 0.08 }, { inst: "harp", note: "F4", at: 0.1 }],
  handmaid: fx.arp("harp", ["F4", "A4", "C5", "F5", "A5", "C6"], 0.045, 1),
  prince: fx.arp("brass", ["C4", "F4", "A4", "C5"], 0.1, 0.45, 0.9),
  king: [fx.whoosh(500, 3500, 0.25, 0.14), fx.whoosh(3500, 500, 0.25, 0.14, 0.22), ...fx.chord("brass", ["F3", "A3", "C4", "F4"], 0.9, 0.9, 0.42)],
  countess: fx.chord("harp", ["Bb3", "D4", "F4", "Bb4"], 1.4, 1),
  princessLost: [...fx.arp("harp", ["F5", "D5", "Bb4", "G4", "E4", "C#4"], 0.1, 1), ...fx.chord("strings", ["D3", "F3", "A3"], 1.6, 0.9, 0.5)],
  eliminated: [fx.cardSlide(0, 0.1), ...fx.chord("strings", ["D3", "F3", "Ab3"], 1, 0.8, 0.05)],
  victory: [...fx.arp("harp", ["F4", "A4", "C5", "F5", "A5", "C6", "F6"], 0.06, 1.4), ...later(fx.arp("flute", ["A5", "C6", "F6"], 0.25, 0.6), 0.45), ...fx.chord("bell", ["F5", "A5"], 1.5, 0.6, 1.2)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX;

export const LOVE_LETTER_SUITE: SuiteConfig = {
  bpm: 90,
  tracks: [
    {
      voice: "harp",
      div: 2,
      pattern:
        "F3 C4 A4 C4 A4 C4 | D3 A3 F4 A3 F4 A3 | Bb2 F3 D4 F3 D4 F3 | C3 G3 E4 G3 E4 G3 | F3 C4 A4 C4 A4 C4 | A2 E3 C4 E3 C4 E3 | Bb2 F3 D4 C3 G3 E4 | F3 C4 A4 F4 . .",
      gain: 0.6,
    },
    { voice: "flute", div: 4, pattern: "A5 - C6 | D6 - F5 | D6 - Bb5 | G5 - - | C6 - A5 | E5 - C5 | D5 - E5 | F5 - -", gain: 0.6 },
    { voice: "pizz", div: 12, pattern: "F2 D2 Bb1 C2 F2 A1 Bb1 F2", gain: 0.9 },
    { voice: "strings", div: 12, pattern: "F3+A3 D3+F3 Bb2+D3 C3+E3 F3+A3 A2+C3 Bb2+D3 F3+A3", gain: 0.5, level: 1 },
  ],
  sfx: SFX,
};

export const getLoveLetterSound = defineSuite(LOVE_LETTER_SUITE);

export function loveLetterSoundCues(prev: LoveLetterState, next: LoveLetterState): Cue[] {
  if (prev === next) return [];
  if (prev.phase !== "gameOver" && next.phase === "gameOver") return ["victory"];
  const cues: Cue[] = [];
  const e = next.lastEvent;
  let ownElimSound = false;
  if (e && e !== prev.lastEvent) {
    switch (e.type) {
      case "guard":
        ownElimSound = !!e.correct;
        cues.push(e.fizzled ? "fizzle" : e.correct ? "guardHit" : "guardMiss");
        break;
      case "priest":
        cues.push(e.fizzled ? "fizzle" : "priest");
        break;
      case "baron":
        cues.push(e.fizzled ? "fizzle" : e.outcome === "tie" ? "baronTie" : "baron");
        break;
      case "handmaid":
        cues.push("handmaid");
        break;
      case "prince":
        ownElimSound = e.eliminatedPrincess;
        cues.push(e.eliminatedPrincess ? "princessLost" : "prince");
        break;
      case "king":
        cues.push(e.fizzled ? "fizzle" : "king");
        break;
      case "countess":
        cues.push("countess");
        break;
      case "princess":
        ownElimSound = true;
        cues.push("princessLost");
        break;
    }
  }
  if (!ownElimSound && next.eliminationOrder.length > prev.eliminationOrder.length) cues.push("eliminated");
  if (next.activeSeat !== prev.activeSeat && next.phase === "playing") cues.push("draw");
  return cues;
}

export function loveLetterIntensity(s: LoveLetterState): number {
  return s.players.filter((p) => p.alive).length <= 2 && s.playerCount > 2 ? 1 : 0;
}
