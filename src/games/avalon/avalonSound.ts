import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { AvalonState } from "./engine";

/**
 * 아발론 "Round Table" suite — an Arthurian court ballad in D dorian at
 * 84 BPM: a lute arpeggiating Dm–C–B♭–A under a recorder melody, a string
 * drone and a frame drum. When either side is one quest from winning
 * (intensity 1) taiko war drums join; the assassination (intensity 2) adds a
 * low choir. SFX follow the table: a herald horn for each proposal, a wood
 * tap per vote, a bright/dull verdict, fanfare or gong per quest, and the
 * assassin's blade.
 */

const SFX = {
  propose: [...fx.arp("brass", ["D4", "A4", "D5"], 0.12, 0.35, 0.9)],
  vote: [fx.click(900, 0.12), { wave: "sine", freq: 520, to: 380, glide: 0.05, dur: 0.08, peak: 0.1 }],
  approved: [...fx.chord("harp", ["D4", "F#4", "A4", "D5"], 1.2, 0.9), ...fx.arp("glock", ["A5", "D6"], 0.08, 0.6, 0.6)],
  rejected: [fx.thud(110, 0.35, 0.4), ...fx.chord("strings", ["D3", "F3", "Ab3"], 0.7, 0.8)],
  questCard: [fx.cardSlide(0, 0.14)],
  questSuccess: [...fx.arp("brass", ["D4", "F#4", "A4"], 0.13, 0.3), ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.1, 1, 0.39), { inst: "timpani", note: "D2", at: 0.39 }],
  questFail: [{ inst: "gong", note: "A1" }, ...fx.chord("choir", ["D3", "F3", "Ab3"], 1.4, 1, 0.05)],
  assassinPhase: [{ inst: "timpani", note: "A1" }, { inst: "timpani", note: "A1", at: 0.25 }, ...fx.chord("strings", ["A2", "Eb3", "A3"], 2, 1, 0.3)],
  assassinHit: [fx.whoosh(800, 5000, 0.18, 0.2), ...fx.crack(0.18, 0.4), { inst: "gong", note: "A1", at: 0.3 }, ...fx.chord("choir", ["D3", "F3", "A3"], 2, 1, 0.4)],
  assassinMiss: [fx.whoosh(800, 5000, 0.18, 0.2), fx.click(3200, 0.16, 0.18), ...fx.arp("brass", ["D4", "F#4", "A4", "D5"], 0.12, 0.9, 1)],
  goodWins: [...fx.arp("brass", ["D4", "F#4", "A4", "D5"], 0.15, 0.4), ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.8, 1.1, 0.6), ...fx.arp("bell", ["D6", "A5", "D6"], 0.2, 1, 0.5)],
  evilWins: [{ inst: "gong", note: "A1" }, ...fx.chord("choir", ["D3", "F3", "Bb3"], 2.4, 1.1, 0.1), fx.thud(70, 0.8, 0.5)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX;

export const AVALON_SUITE: SuiteConfig = {
  bpm: 84,
  tracks: [
    {
      voice: "lute",
      div: 2,
      pattern:
        "D3 A3 D4 F4 A4 F4 D4 A3 | C3 G3 C4 E4 G4 E4 C4 G3 | Bb2 F3 Bb3 D4 F4 D4 Bb3 F3 | A2 E3 A3 C#4 E4 C#4 A3 E3",
      gain: 0.8,
    },
    {
      voice: "recorder",
      div: 2,
      pattern:
        "A4 - - - D5 - C5 A4 | G4 - - - E4 - G4 - | F4 - G4 A4 Bb4 - A4 G4 | A4 - - - - - . . | D5 - - - F5 - E5 D5 | C5 - - - G4 - C5 - | Bb4 - A4 G4 F4 - E4 F4 | E4 - - - - - . .",
      gain: 0.8,
    },
    { voice: "strings", div: 16, pattern: "D3+A3 C3+G3 Bb2+F3 A2+E3", gain: 0.55 },
    { voice: "doum", pattern: "X . . . . . . . x . . x . . . .", gain: 0.6 },
    { voice: "tek", pattern: ". . x . . . x . . . x . . . x .", gain: 0.6 },
    { voice: "taiko", div: 4, pattern: "X . x x", gain: 0.6, level: 1 },
    { voice: "choir", div: 16, pattern: "D3+F3 C3+E3 Bb2+D3 A2+C#3", gain: 0.7, level: 2 },
  ],
  sfx: SFX,
};

export const getAvalonSound = defineSuite(AVALON_SUITE);

const count = (o: object) => Object.keys(o).length;

export function avalonSoundCues(prev: AvalonState, next: AvalonState): Cue[] {
  if (prev.phase === "assassination" && next.phase === "gameOver") return [next.winReason === "assassin-correct" ? "assassinHit" : "assassinMiss"];
  if (prev.phase !== "gameOver" && next.phase === "gameOver") return [next.winner === "good" ? "goodWins" : "evilWins"];
  const cues: Cue[] = [];
  if (prev.phase === "team-proposal" && next.phase === "voting") cues.push("propose");
  if (prev.phase === "voting" && next.phase !== "voting") cues.push(next.phase === "quest" ? "approved" : "rejected");
  else if (next.phase === "voting" && count(next.votes) > count(prev.votes)) cues.push("vote");
  if (prev.phase === "quest" && next.phase !== "quest") cues.push(next.questResults.at(-1)?.success ? "questSuccess" : "questFail");
  else if (next.phase === "quest" && count(next.questCards) > count(prev.questCards)) cues.push("questCard");
  if (prev.phase !== "assassination" && next.phase === "assassination") cues.push("assassinPhase");
  return cues;
}

export function avalonIntensity(s: AvalonState): number {
  if (s.phase === "assassination") return 2;
  return s.questSuccesses === 2 || s.questFails === 2 ? 1 : 0;
}
