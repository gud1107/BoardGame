import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { ChessState, Color } from "./engine";

/**
 * 체스 "Grandmaster's Study" suite (rulebook §17) — a quiet late-night study
 * in D minor at 72 BPM: a harpsichord ground bass, a sparse piano line that
 * answers itself, an upright bass and a low string pad. In the endgame or
 * time trouble (intensity 1) a pocket-watch tick and a heartbeat timpani
 * creep in.
 *
 * SFX per move kind: wooden "톡" (pitched a little by the destination
 * square), a hoof-like double tock for knights, crack + thud for captures
 * (bigger for rooks/queens), a warning bell on check, a two-step + brass
 * flourish for castling, a whoosh-and-snap for en passant, a rising
 * arpeggio for promotion, timpani + brass for mate and a soft chord for draws.
 */

const SFX = {
  /** arg = destination rank 0..7 — slightly brighter towards the far side. */
  move: (r: number) => [fx.click(900 + r * 40, 0.16), fx.thud(210 + r * 6, 0.09, 0.22, 0.004), { wave: "noise", dur: 0.03, peak: 0.04, filter: { type: "bandpass", freq: 2400, q: 1.4 } }],
  hop: [fx.click(1150, 0.12), fx.thud(260, 0.07, 0.16), fx.click(980, 0.15, 0.11), fx.thud(200, 0.09, 0.22, 0.11)],
  capture: [...fx.crack(0, 0.22), fx.click(1500, 0.18), fx.thud(120, 0.25, 0.4, 0.01)],
  bigCapture: [...fx.crack(0, 0.34), fx.thud(90, 0.4, 0.55, 0.01), { inst: "timpani", note: "D2", at: 0.04, gain: 0.7 }, fx.whoosh(3000, 600, 0.35, 0.06, 0.02)],
  check: [{ inst: "bell", note: "A5", gain: 0.55 }, { inst: "bell", note: "D6", at: 0.12, gain: 0.4 }, fx.pop(700, 1200, 0.08, 0.02)],
  castle: [fx.click(950, 0.15), fx.thud(220, 0.09, 0.2), fx.click(820, 0.14, 0.12), fx.thud(190, 0.09, 0.2, 0.12), ...fx.arp("brass", ["D4", "F4", "A4"], 0.08, 0.35, 0.45).map((p) => ({ ...p, at: (p.at ?? 0) + 0.24 }))],
  enPassant: [fx.whoosh(600, 2600, 0.28, 0.1), fx.click(1700, 0.16, 0.24), fx.thud(150, 0.18, 0.3, 0.25)],
  promote: [...fx.arp("harp", ["D5", "F5", "A5", "D6", "F6", "A6"], 0.05, 0.6, 0.8), { inst: "bell", note: "D6", at: 0.32, gain: 0.5 }, ...fx.chord("strings", ["D4", "A4", "F5"], 1.1, 0.4, 0.3)],
  mate: [{ inst: "timpani", note: "D2", gain: 1 }, { inst: "timpani", note: "A1", at: 0.22, gain: 0.9 }, ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.6, 0.55, 0.45), { inst: "gong", note: "D3", at: 0.45, gain: 0.5 }],
  draw: [...fx.chord("strings", ["D4", "G4", "Bb4"], 1.4, 0.45), ...fx.chord("piano", ["G3", "D4", "G4"], 1.2, 0.5, 0.25)],
  victory: [...fx.arp("piano", ["D4", "F#4", "A4", "D5", "F#5", "A5"], 0.07, 0.8), ...fx.chord("strings", ["D4", "F#4", "A4"], 2, 0.5, 0.4)],
  defeat: [...fx.arp("piano", ["A4", "F4", "D4", "A3"], 0.18, 0.9, 0.7), ...fx.chord("strings", ["D3", "F3", "A3"], 1.8, 0.4, 0.5)],
  offer: [{ inst: "vibes", note: "F5", gain: 0.6 }, { inst: "vibes", note: "A5", at: 0.1, gain: 0.5 }],
  answer: [{ inst: "vibes", note: "A5", gain: 0.5 }, { inst: "vibes", note: "D5", at: 0.1, gain: 0.5 }],
  takeback: [fx.whoosh(2400, 500, 0.3, 0.09), fx.click(800, 0.12, 0.26)],
  select: [fx.click(2300, 0.07)],
  nope: [fx.thud(160, 0.12, 0.22), fx.click(500, 0.06, 0.02)],
  tick: [{ inst: "tick", note: 1, gain: 0.9 }],
  start: [...fx.arp("harpsichord", ["D4", "A4", "D5", "F5", "A5"], 0.06, 0.4, 0.8)],
} satisfies Record<string, SfxRecipe>;

export const CHESS_SUITE: SuiteConfig = {
  bpm: 72,
  tracks: [
    { voice: "harpsichord", div: 2, pattern: "D3 A3 F3 A3 D3 A3 F3 A3 | C3 G3 E3 G3 C3 G3 E3 G3 | Bb2 F3 D3 F3 Bb2 F3 D3 F3 | A2 E3 C#3 E3 A2 E3 C#3 E3", gain: 0.34 },
    { voice: "piano", div: 4, pattern: "F4 - E4 D4 | E4 - - . | D4 - C4 Bb3 | C#4 - - . | A4 - G4 F4 | G4 - E4 . | F4 E4 D4 C#4 | D4 - - .", gain: 0.42 },
    { voice: "upright", div: 8, pattern: "D2 C2 Bb1 A1", gain: 0.45 },
    { voice: "strings", div: 16, pattern: "D3+F3+A3 C3+E3+G3 Bb2+D3+F3 A2+C#3+E3", gain: 0.16 },
    { voice: "tick", div: 4, pattern: "x x x x", gain: 0.25, level: 1 },
    { voice: "timpani", div: 8, pattern: "D2 . A1 .", gain: 0.3, level: 1 },
  ],
  sfx: SFX,
};

export const getChessSound = defineSuite(CHESS_SUITE);

/** State-diff cues for a viewer playing `viewer` (null = spectator). */
export function chessCues(viewer: Color | null) {
  return (prev: ChessState, next: ChessState) => {
    const cues: (string | { name: string; arg?: number })[] = [];
    if (next.moves.length < prev.moves.length) cues.push("takeback");
    else if (next.moves.length === prev.moves.length + 1) {
      const m = next.moves[next.moves.length - 1];
      if (m.mate) cues.push("mate");
      else {
        if (m.kind === "castleK" || m.kind === "castleQ") cues.push("castle");
        else if (m.kind === "ep") cues.push("enPassant");
        else if (m.captured) cues.push(/[qr]/i.test(m.captured) ? "bigCapture" : "capture");
        else if (m.piece.toLowerCase() === "n") cues.push("hop");
        else cues.push({ name: "move", arg: m.to >> 3 });
        if (m.promo) cues.push("promote");
        if (m.check) cues.push("check");
      }
    }
    if (!prev.offer && next.offer) cues.push("offer");
    else if (prev.offer && !next.offer && next.moves.length === prev.moves.length && next.phase === "playing") cues.push("answer");
    if (prev.phase === "playing" && next.phase === "gameOver" && next.result) {
      if (next.result.winner === null) cues.push("draw");
      else if (viewer !== null) cues.push(next.result.winner === viewer ? "victory" : "defeat");
    }
    return cues;
  };
}
