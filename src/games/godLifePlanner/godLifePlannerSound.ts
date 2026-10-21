import { defineSuite, fx, type SfxPart, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { ACTIVITIES, type Activity } from "./data";
import { winnerSeats, type Cell, type GameState, type Seat } from "./engine";

/**
 * 갓생 플래너 "Morning Routine" suite — a lo-fi study-beat at 82 BPM in F major:
 * an electric-piano Fmaj7–Em7–Dm7–Cmaj7 loop, an upright bass, a swung soft
 * kick / brush / shaker kit and a kalimba line like a desk-lamp playlist. On
 * the last day (intensity 1) a glockenspiel arpeggio and a flute counter-line
 * join — the weekly deadline closing in.
 *
 * SFX: every brush has its own paint sound (pillow for 수면, pencil scratch
 * for 공부, bounce for 운동, typing for 일, door chime for 약속, cup clink for
 * 휴식, eraser for 빈칸, a little devil sting for 유혹), plus temptation
 * resist/yield, opportunity on/off, lock-in, reveal, morning alarm, day
 * result (good / habit formed / weekly challenge / collapse), the day-replay
 * beats (fail, nap, match, lucky break) and the end-of-week stings.
 */

/** Cue arg for a painted cell: its index in `ACTIVITIES`, 7 = 유혹. */
export function cellArg(c: Cell): number {
  return c === "temptation" ? 7 : ACTIVITIES.indexOf(c as Activity);
}

const PAINT: SfxPart[][] = [
  // sleep — pillow puff + lullaby
  [fx.whoosh(900, 300, 0.25, 0.08), { inst: "musicbox", note: "C6", gain: 0.45, at: 0.02 }, { inst: "musicbox", note: "A5", gain: 0.4, at: 0.16 }],
  // study — pencil scratch + page tick
  [
    { wave: "noise", dur: 0.06, peak: 0.07, attack: 0.005, filter: { type: "bandpass", freq: 4200, q: 3 } },
    { wave: "noise", dur: 0.08, peak: 0.07, at: 0.08, attack: 0.005, filter: { type: "bandpass", freq: 3600, q: 3 } },
    { inst: "kalimba", note: "E5", gain: 0.5, at: 0.04 },
  ],
  // exercise — bounce
  [fx.thud(150, 0.16, 0.35), fx.pop(380, 1000, 0.18, 0.05), { inst: "rim", note: 1, gain: 0.5, at: 0.12 }],
  // work — three keystrokes + register blip
  [fx.click(2100, 0.12), fx.click(1800, 0.12, 0.06), fx.click(2300, 0.12, 0.12), { inst: "vibes", note: "G5", gain: 0.3, at: 0.18 }],
  // meet — door chime
  [{ inst: "vibes", note: "E5", gain: 0.55 }, { inst: "vibes", note: "C5", gain: 0.5, at: 0.14 }],
  // rest — cup clink + steam
  [...fx.coin(0, 2800, 0.09), fx.whoosh(1200, 2400, 0.35, 0.05, 0.08)],
  // empty — eraser rub
  [fx.whoosh(3000, 1500, 0.12, 0.08), fx.whoosh(2600, 1300, 0.12, 0.07, 0.1)],
  // temptation — little devil
  [{ inst: "pizz", note: "F#4", gain: 0.5 }, { inst: "pizz", note: "C4", gain: 0.5, at: 0.09 }, fx.whoosh(500, 1800, 0.2, 0.06, 0.05)],
];

const BRUSH_NOTES = ["F4", "A4", "C5", "D5", "E5", "G5", "C4", "F#4"];

const SFX = {
  /** arg = cellArg — a cell painted (also each replayed block). */
  paint: (a: number) => PAINT[a] ?? PAINT[6],
  /** arg = cellArg — brush picked from the palette. */
  brush: (a: number) => [{ inst: "kalimba", note: BRUSH_NOTES[a] ?? "C5", gain: 0.45 }, fx.click(2400, 0.05)],
  nope: [fx.thud(170, 0.12, 0.22), fx.click(520, 0.06, 0.03)],
  rewind: [fx.whoosh(2600, 500, 0.3, 0.09), ...fx.arp("kalimba", ["C5", "A4", "F4"], 0.05, 0.3, 0.4).map((p) => ({ ...p, at: (p.at ?? 0) + 0.12 }))],
  resist: [{ inst: "bell", note: "C6", gain: 0.45 }, ...fx.chord("brass", ["F4", "A4", "C5"], 0.6, 0.35, 0.06), fx.pop(500, 1200, 0.12, 0.02)],
  yield: [fx.whoosh(1800, 300, 0.4, 0.08), { inst: "organ", note: "D4", gain: 0.35, dur: 0.5 }, { inst: "organ", note: "Ab3", gain: 0.35, dur: 0.6, at: 0.18 }],
  oppOn: [...fx.arp("glock", ["C6", "E6", "G6", "C7"], 0.04, 0.3, 0.5), ...fx.coin(0.18, 3000, 0.07)],
  oppOff: [fx.pop(900, 450, 0.14)],
  commit: [fx.click(1300, 0.18), fx.thud(200, 0.12, 0.3, 0.04), ...fx.chord("epiano", ["F4", "A4", "C5", "E5"], 0.7, 0.45, 0.1)],
  otherCommit: [{ inst: "woodblock", note: 1, gain: 0.35 }],
  goalPick: [...fx.arp("vibes", ["F4", "A4", "C5", "F5"], 0.06, 0.5, 0.55), { inst: "bell", note: "F6", gain: 0.3, at: 0.26 }],
  otherGoal: [{ inst: "woodblock", note: 1, gain: 0.3 }],
  ready: [fx.pop(500, 1100, 0.2), { inst: "kalimba", note: "C5", gain: 0.4, at: 0.05 }],
  otherReady: [{ inst: "tock", note: 1, gain: 0.35 }],
  reveal: [fx.cardSlide(0, 0.12), fx.cardSlide(0.09, 0.11), fx.cardSlide(0.18, 0.1), { inst: "vibes", note: "C6", gain: 0.3, at: 0.26 }],
  /** New day starts — alarm clock + birds. */
  alarm: [
    { inst: "bell", note: "A5", gain: 0.4 },
    { inst: "bell", note: "A5", gain: 0.35, at: 0.14 },
    { inst: "bell", note: "A5", gain: 0.3, at: 0.28 },
    { wave: "sine", freq: 2600, to: 3400, glide: 0.06, dur: 0.08, peak: 0.06, at: 0.5 },
    { wave: "sine", freq: 2900, to: 3800, glide: 0.05, dur: 0.07, peak: 0.05, at: 0.62 },
  ],
  /** arg = seconds left (≤ 10). */
  tick: (s: number) => [{ inst: s <= 3 ? "tock" : "tick", note: 1, gain: s <= 3 ? 1 : 0.7 }],
  dayGood: [...fx.chord("epiano", ["C4", "F4", "A4", "E5"], 1.2, 0.45), { inst: "kalimba", note: "F5", gain: 0.4, at: 0.15 }],
  habit: [...fx.arp("glock", ["F5", "A5", "C6", "F6"], 0.07, 0.6, 0.6), { inst: "bell", note: "C6", gain: 0.4, at: 0.3 }, ...fx.chord("strings", ["F3", "C4", "A4"], 1.2, 0.3, 0.2)],
  challenge: [...fx.arp("brass", ["C4", "F4", "A4", "C5"], 0.08, 0.4, 0.5), ...fx.chord("brass", ["F4", "A4", "C5"], 0.9, 0.4, 0.34), ...fx.coin(0.34, 2600, 0.08)],
  collapse: [fx.buzz(240, 90, 0.5, 0.14), { inst: "timpani", note: "F2", gain: 0.6, at: 0.02 }, ...fx.crack(0.04, 0.2)],
  /** Day replay beats. */
  wake: [fx.whoosh(400, 1400, 0.4, 0.05), { inst: "flute", note: "C5", gain: 0.3, dur: 0.3, at: 0.1 }],
  fail: [fx.buzz(200, 120, 0.3, 0.1), fx.thud(120, 0.2, 0.3)],
  nap: [{ wave: "noise", dur: 0.5, peak: 0.05, attack: 0.25, filter: { type: "lowpass", freq: 600 } }, { inst: "musicbox", note: "F4", gain: 0.35, at: 0.3 }],
  match: [{ inst: "vibes", note: "C5", gain: 0.5 }, { inst: "vibes", note: "E5", gain: 0.5, at: 0.08 }, { inst: "vibes", note: "G5", gain: 0.5, at: 0.16 }, fx.pop(600, 1300, 0.14, 0.2)],
  lucky: [...fx.coin(0, 2400, 0.1), ...fx.coin(0.08, 3000, 0.08), ...fx.arp("glock", ["G5", "C6", "E6"], 0.05, 0.3, 0.45)],
  dayEnd: [...fx.chord("epiano", ["F3", "A3", "C4", "E4"], 1.3, 0.4), { inst: "musicbox", note: "C6", gain: 0.3, at: 0.2 }],
  victory: [...fx.arp("epiano", ["F4", "A4", "C5", "F5", "A5", "C6"], 0.07, 0.8, 0.6), ...fx.chord("brass", ["F4", "A4", "C5"], 1.6, 0.45, 0.45), { inst: "bell", note: "F6", gain: 0.4, at: 0.45 }],
  defeat: [...fx.arp("epiano", ["C5", "A4", "F4", "D4"], 0.16, 0.9, 0.55), ...fx.chord("strings", ["D3", "F3", "A3"], 1.6, 0.35, 0.5)],
  weekDone: [...fx.arp("kalimba", ["F4", "A4", "C5", "E5", "G5", "F5"], 0.08, 0.6, 0.6), ...fx.chord("epiano", ["F4", "A4", "C5", "E5"], 1.4, 0.45, 0.5)],
  ui: [fx.click(2000, 0.08)],
  page: [fx.cardSlide(0, 0.1), fx.whoosh(1800, 3200, 0.15, 0.05, 0.03)],
} satisfies Record<string, SfxRecipe>;

export const GOD_LIFE_PLANNER_SUITE: SuiteConfig = {
  bpm: 82,
  swing: 0.18,
  tracks: [
    { voice: "epiano", div: 16, pattern: "F3+A3+C4+E4 E3+G3+B3+D4 D3+F3+A3+C4 C3+E3+G3+B3", gain: 0.24 },
    { voice: "upright", div: 4, pattern: "F2 . . F2 | E2 . . E2 | D2 . A2 D2 | C2 . G2 E2", gain: 0.4 },
    { voice: "softKick", div: 4, pattern: "x . x .", gain: 0.45 },
    { voice: "brush", div: 4, pattern: ". x . x", gain: 0.5 },
    { voice: "shaker", div: 2, pattern: "x x x x x x x x", gain: 0.35 },
    { voice: "kalimba", div: 2, pattern: "A4 . C5 . E5 - D5 . | . . B4 . G4 - . . | A4 . F4 . C5 - A4 . | G4 . E4 - - . . . | C5 . A4 . F4 - G4 A4 | B4 - G4 . D5 - . . | A4 - F4 . D4 . F4 . | E4 - - - . . . .", gain: 0.3 },
    { voice: "glock", div: 2, pattern: "C6 A5 F5 A5 C6 A5 F5 A5 | B5 G5 E5 G5 B5 G5 E5 G5 | A5 F5 D5 F5 A5 F5 D5 F5 | G5 E5 C5 E5 G5 E5 C5 E5", gain: 0.12, level: 1 },
    { voice: "flute", div: 8, pattern: "E5 - F5 - | D5 - - . | C5 - D5 - | E5 - - .", gain: 0.18, level: 1 },
  ],
  sfx: SFX,
};

export const getGodLifePlannerSound = defineSuite(GOD_LIFE_PLANNER_SUITE);

/**
 * State-diff cues for `viewer`: other seats' goal picks / lock-ins / ready
 * taps (soft), my own (full), phase changes, the day result and the week's
 * end. UI-only clicks (brush, paint, temptation, opportunity) play directly
 * from the board instead.
 */
export function godLifePlannerCues(viewer: Seat) {
  return (prev: GameState, next: GameState) => {
    const cues: (string | { name: string; arg?: number })[] = [];
    for (let s = 0; s < next.seatCount; s++) {
      const mine = s === viewer;
      if (prev.seats[s].goalPick === null && next.seats[s].goalPick !== null) cues.push(mine ? "goalPick" : "otherGoal");
      if (prev.phase === "planning" && prev.commits[s] === null && next.commits[s] !== null) cues.push(mine ? "commit" : "otherCommit");
      if (prev.phase === next.phase && !prev.ready[s] && next.ready[s]) cues.push(mine ? "ready" : "otherReady");
    }
    if (prev.stage === next.stage) return cues;
    if (next.phase === "revealing") cues.push("reveal");
    else if (next.phase === "planning") cues.push("alarm");
    else if (next.phase === "dayResult") {
      const rec = next.seats[viewer]?.days[next.day];
      if (rec && (rec.exhausted || rec.burnout)) cues.push("collapse");
      else if (rec?.notes.some((n) => n.includes("주간 도전"))) cues.push("challenge");
      else if (rec?.notes.some((n) => n.includes("습관 형성"))) cues.push("habit");
      else cues.push("dayGood");
    } else if (next.phase === "ended") {
      if (next.seatCount === 1) cues.push("weekDone");
      else cues.push(winnerSeats(next).includes(viewer) ? "victory" : "defeat");
    }
    return cues;
  };
}
