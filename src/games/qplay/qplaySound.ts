import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { CLIMB_TOP, currentMini, type GameState } from "./engine";

/**
 * 큐플레이 "Quiz Show" suite — a bouncy TV game-show groove in G major at 128 BPM:
 * marimba hook, plucky synth bass, four-on-the-floor kick with claps and woodblock
 * ticks. In the last 3 seconds of a question (intensity 1) a ticking hat and a rising
 * arp join. SFX: ding-dong for correct, buzzer for wrong, a heavy thud for OX
 * elimination, missile launch whoosh + boom, step-up/step-down climbing notes and a
 * fanfare for each mini-game winner. Every cue also has an on-screen message.
 */

const STEP_NOTES = ["G4", "A4", "B4", "C5", "D5", "E5", "F#5", "G5", "A5", "B5", "D6"];

const SFX = {
  intro: [...fx.arp("marimba", ["G4", "B4", "D5", "G5"], 0.07, 0.4), ...fx.chord("brass", ["G4", "B4", "D5"], 0.7, 0.8, 0.3), { inst: "timpani", note: "G2", at: 0.3 }],
  go: [{ inst: "woodblock", note: "C5" }, ...fx.chord("stab", ["G4", "B4", "D5", "G5"], 0.3, 1, 0.05)],
  pick: [fx.pop(500, 1100, 0.2), fx.click(1600, 0.1)],
  correct: [{ inst: "bell", note: "E6", dur: 0.4, gain: 0.8 }, { inst: "bell", note: "C6", at: 0.16, dur: 0.6, gain: 0.8 }],
  wrong: [fx.buzz(240, 120, 0.4, 0.14)],
  eliminated: [fx.thud(120, 0.45, 0.55), fx.whoosh(1600, 200, 0.4, 0.1, 0.05), ...fx.arp("marimba", ["D5", "B4", "G4", "D4"], 0.08, 0.35, 0.7)],
  revive: [...fx.arp("glock", ["G5", "B5", "D6", "G6"], 0.06, 0.5, 0.9), fx.whoosh(400, 2400, 0.4, 0.08)],
  other: [fx.click(900, 0.08)],
  aim: [{ inst: "brass", note: "D4", dur: 0.25 }, { inst: "brass", note: "D4", at: 0.28, dur: 0.25 }, { inst: "brass", note: "A4", at: 0.56, dur: 0.5 }],
  /** 발사 슝~ 0.55초 뒤 쾅. */
  fire: [
    fx.whoosh(300, 3200, 0.55, 0.16),
    { wave: "sawtooth", freq: 180, to: 900, glide: 0.5, dur: 0.55, peak: 0.08, attack: 0.02, filter: { type: "lowpass", freq: 2200 } },
    ...fx.crack(0.55, 0.5),
    fx.thud(70, 0.6, 0.6, 0.57),
  ],
  /** arg = 도달한 층 — 높을수록 음이 올라간다. */
  climbUp: (floor: number) => [{ inst: "marimba", note: STEP_NOTES[Math.max(0, Math.min(STEP_NOTES.length - 1, floor))], dur: 0.3 }, fx.click(2000, 0.08)],
  climbDown: [fx.whoosh(1400, 400, 0.25, 0.1), { inst: "marimba", note: "D4", at: 0.05, dur: 0.3, gain: 0.7 }],
  top: [...fx.arp("glock", ["G5", "B5", "D6", "G6"], 0.05, 0.6), ...fx.chord("brass", ["G4", "B4", "D5", "G5"], 1, 0.9, 0.22)],
  tick: [fx.click(2200, 0.16), { inst: "woodblock", note: "G5", gain: 0.6 }],
  miniWin: [...fx.arp("marimba", ["G4", "B4", "D5", "G5", "B5", "D6"], 0.06, 0.5), ...fx.chord("brass", ["G4", "B4", "D5", "G5"], 1.2, 1, 0.38), { inst: "timpani", note: "G2", at: 0.38 }],
  miniLose: [...fx.arp("marimba", ["D5", "B4", "G4"], 0.1, 0.4, 0.8)],
  victory: [...fx.arp("marimba", ["G4", "B4", "D5", "G5", "B5", "D6", "G6"], 0.06, 0.6), ...fx.chord("brass", ["G3", "D4", "G4", "B4", "D5"], 2, 1.1, 0.45), { inst: "timpani", note: "G2", at: 0.45 }],
} satisfies Record<string, SfxRecipe>;

export const QPLAY_SUITE: SuiteConfig = {
  bpm: 128,
  tracks: [
    { voice: "marimba", pattern: "G4 . B4 D5 . B4 G5 . | E4 . G4 C5 . G4 E5 . | C4 . E4 A4 . E4 C5 . | D4 . F#4 A4 . F#4 D5 .", gain: 0.6 },
    { voice: "synthBass", div: 2, pattern: "G2 G2 . G3 G2 . D3 . | C2 C2 . C3 C2 . G2 . | A1 A1 . A2 A1 . E2 . | D2 D2 . D3 D2 . A2 .", gain: 0.7 },
    { voice: "kick", div: 4, pattern: "x x x x", gain: 0.45 },
    { voice: "clap", div: 4, pattern: ". x . x", gain: 0.32 },
    { voice: "woodblock", pattern: "x . x . . x . . x . x . . x . .", gain: 0.22 },
    { voice: "hat", pattern: "x x x x x x x x x x x x x x x x", gain: 0.22, level: 1 },
    { voice: "arp", pattern: "G5 B5 D6 B5 G5 B5 D6 G6 A5 C6 E6 C6 A5 C6 E6 A6", gain: 0.38, level: 1 },
  ],
  sfx: SFX,
};

export const getQPlaySound = defineSuite(QPLAY_SUITE);

type Cue = string | { name: string; arg?: number };

/** 상태 변화 → 효과음. 좌석마다 들리는 소리가 달라서(내 정답/오답) 보는 좌석에 묶어 쓴다. */
export function qplayCues(viewer: number) {
  return (prev: GameState, next: GameState): Cue[] => {
    const cues: Cue[] = [];
    const mini = currentMini(next);
    if (prev.phase !== next.phase || prev.stage !== next.stage) {
      if (next.phase === "intro" && (prev.phase !== "intro" || prev.miniIndex !== next.miniIndex)) cues.push("intro");
      if ((next.phase === "question" && prev.phase === "intro") || next.phase === "climb") cues.push("go");
      if (prev.phase === "question" && next.phase !== "question") {
        const eligible = mini === "ox" || mini === "missile" ? prev.alive[viewer] : true;
        if (eligible) cues.push(next.answers[viewer]?.correct ? "correct" : "wrong");
      }
      if (next.phase === "aim") cues.push("aim");
      if (next.phase === "reveal") {
        if (next.shot) cues.push("fire");
        if (next.revived) cues.push("revive");
        else if (next.eliminated.length > 0 && !next.shot) cues.push("eliminated");
      }
      if (next.phase === "miniEnd") {
        const record = next.history[next.history.length - 1];
        cues.push(record?.winners.includes(viewer) ? "miniWin" : "miniLose");
      }
      if (next.phase === "ended") cues.push("victory");
      return cues;
    }
    if (next.phase === "climb" && prev.climbIdx[viewer] !== next.climbIdx[viewer]) {
      if (next.lastClimb[viewer]) cues.push(next.floor[viewer] >= CLIMB_TOP ? "top" : { name: "climbUp", arg: next.floor[viewer] });
      else cues.push("climbDown");
    }
    if (next.phase === "question" && Object.keys(next.answers).length > Object.keys(prev.answers).length && !next.answers[viewer]) cues.push("other");
    return cues;
  };
}
