import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { CRISIS_DAY, TOKENS, type ResolveState } from "./engine";

/**
 * 작심삼일 "Morning Routine" suite — a light C-major lo-fi groove at 96 BPM:
 * kalimba melody over electric-piano chords, upright bass, soft kick, rim and
 * shaker. Intensity 1 (day 3, the crisis) adds tense strings and a timpani
 * heartbeat.
 *
 * SFX: a safe 💧 draw, a temptation draw (lower for heavier tokens), 📘
 * lesson block, 💥 bust, 🔥 crisis sting, 🤝 compromise, 🍰 cheat day,
 * ✅ success fanfare, plan reveal, season result, decide chime, last-5-s
 * tick, final fanfare.
 */

const SFX = {
  ui: [fx.click(1500, 0.08)],
  invalid: [fx.buzz(240, 150, 0.18, 0.09)],
  safe: [fx.pop(500, 1200, 0.14), { inst: "kalimba", note: "G5", at: 0.03, dur: 0.3, gain: 0.6 }],
  tempt: (v: number) => [fx.thud(200 - v * 30, 0.22, 0.3), { inst: "pizz", note: v >= 3 ? "C3" : v >= 2 ? "E3" : "G3", at: 0.02, dur: 0.35, gain: 0.7 }],
  block: [...fx.arp("glock", ["E6", "G6", "C7"], 0.05, 0.3, 0.5), fx.whoosh(2500, 5000, 0.25, 0.05)],
  bust: [fx.crack(0, 0.4)[0], fx.buzz(300, 80, 0.6, 0.12, 0.05), ...fx.chord("strings", ["C3", "F#3"], 0.8, 0.4, 0.1)],
  crisis: [...fx.chord("strings", ["A3", "C4", "D#4"], 1.0, 0.5), { inst: "timpani", note: "A1", dur: 0.6, gain: 0.8 }, { inst: "timpani", note: "A1", at: 0.35, dur: 0.6, gain: 0.8 }],
  stop: [fx.thud(160, 0.2, 0.2), ...fx.arp("epiano", ["E4", "G4"], 0.08, 0.4, 0.6)],
  cheat: [...fx.arp("marimba", ["C5", "E5", "G5", "E5"], 0.06, 0.25, 0.6)],
  success: [...fx.arp("kalimba", ["C5", "E5", "G5", "C6", "E6"], 0.07, 0.5, 0.8), ...fx.chord("bell", ["C5", "G5"], 1.2, 0.4, 0.3)],
  reveal: [fx.whoosh(800, 2400, 0.3, 0.08), fx.click(1800, 0.08, 0.2)],
  result: [...fx.coin(0, 2200, 0.1), ...fx.coin(0.08, 2600, 0.1)],
  decide: fx.arp("epiano", ["C5", "E5", "G5"], 0.07, 0.4, 0.6),
  tick: [fx.click(2100, 0.1)],
  timeout: [fx.buzz(330, 200, 0.3, 0.1)],
  victory: [...fx.arp("kalimba", ["C5", "E5", "G5", "C6", "E6", "G6"], 0.08, 0.6, 0.9), ...fx.chord("bell", ["C5", "E5", "G5", "C6"], 2.2, 0.6, 0.5)],
} satisfies Record<string, SfxRecipe>;

export type ResolveCue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const THREE_DAY_RESOLVE_SUITE: SuiteConfig = {
  bpm: 96,
  swing: 0.12,
  tracks: [
    { voice: "kalimba", div: 2, pattern: "E5 . G5 . C6 . G5 . | A5 . G5 . E5 . . . | F5 . A5 . C6 . A5 . | G5 . E5 . D5 . . . | E5 . G5 . C6 . D6 . | E6 . D6 . C6 . A5 . | F5 . E5 . D5 . G5 . | C5 . . . - . . .", gain: 0.4 },
    { voice: "epiano", div: 8, pattern: "C4+E4+G4+B4 A3+C4+E4+G4 F3+A3+C4+E4 G3+B3+D4+F4 C4+E4+G4+B4 A3+C4+E4+G4 D4+F4+A4+C5 G3+B3+D4+F4", gain: 0.22 },
    { voice: "upright", div: 4, pattern: "C2 . G2 . | A1 . E2 . | F1 . C2 . | G1 . D2 . | C2 . G2 . | A1 . E2 . | D2 . A2 . | G1 . B1 .", gain: 0.55 },
    { voice: "softKick", div: 4, pattern: "x . . . x . . .", gain: 0.5 },
    { voice: "rim", div: 4, pattern: ". . x . . . x .", gain: 0.28 },
    { voice: "shaker", div: 2, pattern: "x x x x x x x x", gain: 0.14 },
    { voice: "strings", div: 8, pattern: "A3+C4+E4 A3+C4+E4 F3+A3+C4 G3+B3+D4", gain: 0.2, level: 1 },
    { voice: "timpani", div: 4, pattern: "A1 . A1 . . . . .", gain: 0.35, level: 1 },
  ],
  sfx: SFX,
};

export const getThreeDayResolveSound = defineSuite(THREE_DAY_RESOLVE_SUITE);

/** BGM intensity: 1 on the crisis day while someone is still holding on. */
export function resolveIntensity(state: ResolveState): number {
  return state.phase === "day" && state.day === CRISIS_DAY ? 1 : 0;
}

/** Sounds for one engine step (all clients hear the same thing). */
export function resolveSoundCues(prev: ResolveState, next: ResolveState): ResolveCue[] {
  if (prev === next) return [];
  const cues: ResolveCue[] = [];
  const fresh = next.log.filter((e) => e.seq > prev.seq);
  let draws = 0;
  for (const e of fresh) {
    switch (e.kind) {
      case "draw":
        if (draws++ < 3) cues.push(TOKENS[e.token!].value === 0 ? "safe" : { name: "tempt", arg: TOKENS[e.token!].value });
        break;
      case "block":
        cues.push("block");
        break;
      case "bust":
        cues.push("bust");
        break;
      case "crisis":
        cues.push("crisis");
        break;
      case "stop":
        cues.push("stop");
        break;
      case "cheat":
        cues.push("cheat");
        break;
      case "success":
        cues.push("success");
        break;
      case "timeout":
        cues.push("timeout");
        break;
    }
  }
  if (prev.phase === "plan" && next.phase === "day") cues.push("reveal");
  if (prev.phase === "day" && next.phase === "review") cues.push("result");
  if (prev.phase !== "gameOver" && next.phase === "gameOver") cues.push("victory");
  // collapse duplicates within one step (6 players drawing at once)
  const seen = new Set<string>();
  return cues.filter((c) => {
    const k = typeof c === "string" ? c : `${c.name}:${c.arg}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
