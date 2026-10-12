import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { GameState } from "./engine";

/**
 * 단어 마천루 "Sky Builders" suite — a bright construction-site groove in F major at
 * 120 BPM: bouncing marimba riff, plucky synth bass, woodblock "hammer" taps and a
 * kick/clap backbeat. During the last 10 seconds of building (intensity 1) a ticking
 * hat and a rising arp join. SFX: every placed word thunks down with a pitch that
 * climbs with the tower, pending words shimmer, approvals chime, rejections crumble.
 */

const PLACE_NOTES = ["F4", "G4", "A4", "C5", "D5", "F5", "G5", "A5", "C6"];

const SFX = {
  /** arg = 내 탑의 높이(층) — 높을수록 음이 올라간다. */
  place: (h: number) => [fx.thud(150, 0.18, 0.4), fx.click(1400, 0.1), { inst: "marimba", note: PLACE_NOTES[Math.min(PLACE_NOTES.length - 1, Math.floor(h / 6))], at: 0.02, dur: 0.3 }],
  pending: [{ inst: "vibes", note: "A5", dur: 0.5, gain: 0.7 }, { inst: "vibes", note: "E6", at: 0.08, dur: 0.5, gain: 0.5 }],
  invalid: [fx.buzz(200, 150, 0.16, 0.08)],
  other: [fx.thud(110, 0.12, 0.16)],
  tick: [fx.click(2200, 0.16), { inst: "woodblock", note: "G5", gain: 0.6 }],
  topic: [...fx.arp("marimba", ["F4", "A4", "C5", "F5"], 0.07, 0.4), ...fx.chord("brass", ["F4", "A4", "C5"], 0.6, 0.8, 0.3)],
  go: [{ inst: "woodblock", note: "C5" }, ...fx.chord("stab", ["F4", "A4", "C5", "F5"], 0.3, 1.1, 0.05)],
  review: [...fx.arp("vibes", ["C5", "E5", "G5"], 0.09, 0.5, 0.8)],
  approve: [...fx.arp("glock", ["C6", "E6", "G6"], 0.05, 0.5, 0.9)],
  reject: [fx.whoosh(1800, 300, 0.4, 0.14), fx.thud(90, 0.4, 0.5, 0.3), { wave: "noise", at: 0.32, dur: 0.35, peak: 0.18, filter: { type: "lowpass", freq: 1200, to: 200 } }],
  roundWin: [...fx.arp("marimba", ["F4", "A4", "C5", "F5", "A5", "C6"], 0.06, 0.5), ...fx.chord("brass", ["F4", "A4", "C5", "F5"], 1.2, 1, 0.38), { inst: "timpani", note: "F2", at: 0.38 }],
  roundLose: [...fx.arp("marimba", ["C5", "A4", "F4"], 0.1, 0.4, 0.8)],
  victory: [...fx.arp("marimba", ["F4", "A4", "C5", "F5", "A5", "C6", "F6"], 0.06, 0.6), ...fx.chord("brass", ["F3", "C4", "F4", "A4", "C5"], 2, 1.1, 0.45), { inst: "timpani", note: "F2", at: 0.45 }],
} satisfies Record<string, SfxRecipe>;

export const WORD_TOWER_SUITE: SuiteConfig = {
  bpm: 120,
  tracks: [
    {
      voice: "marimba",
      pattern: "F4 . A4 C5 . A4 F5 . | G4 . Bb4 D5 . Bb4 G5 . | A4 . C5 F5 . C5 A5 . | C5 . E5 G5 . E5 C6 .",
      gain: 0.65,
    },
    { voice: "synthBass", div: 2, pattern: "F2 F2 . F3 F2 . C3 . | Bb1 Bb1 . Bb2 Bb1 . D2 . | F2 F2 . F3 F2 . A2 . | C2 C2 . C3 C2 . E2 .", gain: 0.75 },
    { voice: "kick", div: 4, pattern: "x x x x", gain: 0.5 },
    { voice: "clap", div: 4, pattern: ". x . x", gain: 0.35 },
    { voice: "woodblock", pattern: "x . . x . . x . . . x . x . . .", gain: 0.25 },
    { voice: "hat", pattern: "x x x x x x x x x x x x x x x x", gain: 0.22, level: 1 },
    { voice: "arp", pattern: "F5 A5 C6 A5 F5 A5 C6 F6 G5 Bb5 D6 Bb5 G5 Bb5 D6 G6", gain: 0.4, level: 1 },
  ],
  sfx: SFX,
};

export const getWordTowerSound = defineSuite(WORD_TOWER_SUITE);

/** 내 탑에 새로 얹힌 단어의 높이를 알기 위한 좌석 — 클라이언트마다 다르므로 바인딩해서 쓴다. */
export function wordTowerCues(viewer: number) {
  return (prev: GameState, next: GameState) => {
    const cues: (string | { name: string; arg?: number })[] = [];
    if (prev.phase !== next.phase) {
      if (next.phase === "intro") cues.push("topic");
      if (next.phase === "build") cues.push("go");
      if (next.phase === "review") cues.push("review");
      if (next.phase === "result") {
        const record = next.history[next.history.length - 1];
        const rejectedMine = record?.entries.some((e) => e.seat === viewer && e.status === "rejected");
        const approvedAny = record?.entries.some((e) => e.status === "approved");
        if (prev.phase === "review") cues.push(rejectedMine ? "reject" : approvedAny ? "approve" : "review");
        cues.push(record?.winners.includes(viewer) ? "roundWin" : "roundLose");
      }
      if (next.phase === "ended") cues.push("victory");
      return cues;
    }
    if (next.phase === "build" && next.entries.length > prev.entries.length) {
      for (const e of next.entries.slice(prev.entries.length)) {
        if (e.seat !== viewer) {
          cues.push("other");
          continue;
        }
        if (e.status === "late") cues.push("invalid");
        else if (e.status === "pending") cues.push("pending");
        else if (e.status === "rejected") cues.push("reject");
        else {
          const h = next.entries.filter((x) => x.seat === viewer && x.status === "ok").reduce((a, x) => a + x.blocks, 0);
          cues.push({ name: "place", arg: h });
        }
      }
    }
    return cues;
  };
}
