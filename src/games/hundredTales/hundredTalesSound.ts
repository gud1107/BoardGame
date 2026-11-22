import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import { currentActor, drawOdds, type TalesState } from "./engine";

/**
 * 백 개의 괴담 "Candle Vigil" (rulebook §11) — an original, slow lullaby in
 * A minor at 64 BPM: a detuned music box over a low choir drone, a bowed
 * bass, a temple bell every other bar. Once a third of the candles are left
 * (intensity 1) a heartbeat and a high string tremolo join.
 *
 * Board-local sounds (timer ticks) come from the board; every state change
 * is classified by `hundredTalesCues`, so each client hears every seat.
 */

const SFX = {
  /** Turning a tale card over. */
  flip: [fx.whoosh(2600, 900, 0.18, 0.05), { wave: "noise", dur: 0.06, peak: 0.06, at: 0.12, filter: { type: "bandpass", freq: 2400, q: 1.2 } }],
  /** arg = candles snuffed — a breath blows them out. */
  snuff: (n: number) => {
    const out: ReturnType<typeof fx.whoosh>[] = [];
    const k = Math.max(1, Math.min(4, Math.round(n)));
    for (let i = 0; i < k; i++) out.push({ wave: "noise", dur: 0.22, peak: 0.05, at: 0.2 + i * 0.12, attack: 0.03, filter: { type: "bandpass", freq: 900 + i * 140, q: 0.8 } });
    return out;
  },
  /** arg = fear — the ghost's voice rises behind you. */
  ghost: (fear: number) => [
    { wave: "sine", freq: 330, to: 330 * (1.3 + fear * 0.08), glide: 0.9, dur: 1.1, peak: 0.04 + fear * 0.008, at: 0.25, attack: 0.3, vibrato: { rate: 6, depth: 0.02 } },
    { wave: "sine", freq: 349, to: 349 * (1.25 + fear * 0.08), glide: 0.9, dur: 1.1, peak: 0.03 + fear * 0.006, at: 0.3, attack: 0.3, vibrato: { rate: 5, depth: 0.025 } },
    ...(fear >= 3 ? [{ inst: "choir", note: "D#4", at: 0.4, dur: 1.2, gain: 0.35 }] : []),
  ],
  /** 씌임 — a dissonant shriek and a bell. */
  bust: [
    { wave: "sawtooth", freq: 880, to: 1250, glide: 0.25, dur: 0.6, peak: 0.06, at: 0.3, attack: 0.01, vibrato: { rate: 14, depth: 0.04 }, filter: { type: "bandpass", freq: 1800, q: 2 } },
    { wave: "sawtooth", freq: 932, to: 1180, glide: 0.25, dur: 0.6, peak: 0.05, at: 0.3, attack: 0.01, filter: { type: "bandpass", freq: 2200, q: 2 } },
    fx.thud(70, 0.5, 0.5, 0.3),
    { inst: "gong", note: 1, at: 0.35, gain: 0.6 },
    ...fx.chord("strings", ["C3", "C#3", "G3"], 1.6, 0.5, 0.4),
  ],
  /** 🧂 salt — crystals scatter. */
  salt: [...[0, 0.04, 0.09, 0.13, 0.2, 0.26].map((at, i) => fx.click(5200 - i * 300, 0.05, 0.2 + at))],
  /** 🧂 the charm burns away saving you. */
  saltSave: [{ wave: "noise", dur: 0.4, peak: 0.08, at: 0.25, attack: 0.01, filter: { type: "highpass", freq: 3000 } }, ...fx.arp("bell", ["E5", "B5"], 0.12, 0.6, 0.5).map((p) => ({ ...p, at: (p.at ?? 0) + 0.35 }))],
  /** 🕯️ striking a match. */
  relight: [{ wave: "noise", dur: 0.12, peak: 0.12, at: 0.2, attack: 0.002, filter: { type: "highpass", freq: 2500 } }, { wave: "noise", dur: 0.7, peak: 0.04, at: 0.3, attack: 0.1, filter: { type: "lowpass", freq: 1200 } }],
  /** 🪞 mirror shimmer. */
  mirror: [...fx.arp("glock", ["E6", "G#6", "B6", "D#7"], 0.06, 0.6, 0.45).map((p) => ({ ...p, at: (p.at ?? 0) + 0.2 }))],
  /** Banking the story — a soft temple bell. */
  stop: [{ inst: "bell", note: "A4", at: 0.05, dur: 1.4, gain: 0.5 }, { inst: "bell", note: "E5", at: 0.25, dur: 1.2, gain: 0.3 }],
  /** 다섯 귀신 — a choir chord. */
  perfect: [...fx.chord("choir", ["A3", "C4", "E4", "A4"], 2, 0.6, 0.2), ...fx.arp("musicbox", ["A5", "C6", "E6", "A6"], 0.1, 0.8, 0.6)],
  /** 백 번째 이야기 — the room goes dark. */
  curse: [
    { inst: "gong", note: 0.75, at: 0.2, gain: 0.9 },
    fx.thud(50, 1.2, 0.6, 0.2),
    { wave: "sawtooth", freq: 55, to: 41, glide: 2.4, dur: 3, peak: 0.07, at: 0.3, attack: 0.3, filter: { type: "lowpass", freq: 400 } },
    ...fx.chord("choir", ["A2", "D#3", "A3"], 3, 0.7, 0.6),
    { wave: "noise", dur: 1.4, peak: 0.08, at: 0.4, attack: 0.5, filter: { type: "lowpass", freq: 800, to: 150 } },
  ],
  /** My turn to tell. */
  turn: [{ inst: "musicbox", note: "E5", dur: 0.5, gain: 0.5 }, { inst: "musicbox", note: "A5", at: 0.18, dur: 0.6, gain: 0.45 }],
  /** Timer running out. */
  tick: [{ inst: "tick", note: 1, gain: 0.7 }],
  /** Fewer than 10 candles left. */
  lastCandles: [fx.thud(60, 0.4, 0.45, 0), fx.thud(60, 0.35, 0.35, 0.3)],
  /** UI: my button press, heard at once (before the network round trip). */
  press: [fx.click(1400, 0.08), { wave: "noise", dur: 0.05, peak: 0.03, at: 0.01, filter: { type: "lowpass", freq: 1800 } }],
  /** arg = tales in the story — a music-box note climbing with the chain. */
  chain: (n: number) => {
    const notes = ["A4", "C5", "E5", "G5", "A5"];
    const note = notes[Math.max(0, Math.min(notes.length - 1, Math.round(n) - 1))];
    return [{ inst: "musicbox", note, at: 0.55, dur: 0.5, gain: 0.35 }];
  },
  /** My next tale is risky (≥ 35% possession) — two slow heartbeats. */
  danger: [fx.thud(55, 0.35, 0.5, 0.7), fx.thud(55, 0.3, 0.38, 0.98)],
  /** ⏰ the clock decided for me. */
  autoStop: [fx.buzz(330, 220, 0.3, 0.08, 0.05), fx.buzz(262, 175, 0.4, 0.08, 0.4)],
  /** 🧭 coach: a good call (after the action's own sound). */
  good: [...fx.arp("glock", ["E6", "A6"], 0.08, 0.4, 0.35).map((p) => ({ ...p, at: (p.at ?? 0) + 0.9 }))],
  /** 🧭 coach: greed / too bold. */
  greedy: [{ inst: "musicbox", note: "D#5", at: 1.1, dur: 0.6, gain: 0.35 }, { inst: "musicbox", note: "A4", at: 1.3, dur: 0.8, gain: 0.3 }],
  /** 🧭 coach: unlucky / too early — a soft falling sigh. */
  sigh: [{ wave: "sine", freq: 660, to: 440, glide: 0.5, dur: 0.6, peak: 0.035, at: 1.1, attack: 0.1 }],
  /** I'm alone in first place. */
  lead: [...fx.arp("bell", ["A5", "E6"], 0.1, 0.8, 0.4).map((p) => ({ ...p, at: (p.at ?? 0) + 0.7 }))],
  /** The night begins. */
  start: [{ wave: "noise", dur: 0.12, peak: 0.1, at: 0.05, attack: 0.002, filter: { type: "highpass", freq: 2500 } }, { inst: "bell", note: "A3", at: 0.3, dur: 2, gain: 0.5 }, { inst: "choir", note: "A3", at: 0.4, dur: 2, gain: 0.25 }],
  victory: [...fx.arp("musicbox", ["A4", "C5", "E5", "A5", "C6"], 0.14, 0.9), ...fx.chord("pad", ["A3", "C4", "E4"], 2.4, 0.6, 0.5)],
} satisfies Record<string, SfxRecipe>;

export const HUNDRED_TALES_SUITE: SuiteConfig = {
  bpm: 64,
  swing: 0,
  tracks: [
    { voice: "choir", div: 8, pattern: "A2+E3 - D2+A2 - | F2+C3 - E2+B2 -", gain: 0.14 },
    { voice: "bass", div: 4, pattern: "A1 - - . F1 - - . | D1 - - . E1 - - .", gain: 0.3 },
    { voice: "musicbox", div: 2, pattern: "E5 . C5 . A4 . B4 C5 | D5 . B4 . G#4 . . . | E5 . C5 . A4 . F5 E5 | D5 . C5 . B4 - - . | A5 . G5 . F5 . E5 . | D5 . F5 . E5 . C5 . | B4 . C5 . D5 . G#4 . | A4 - - . . . . .", gain: 0.12 },
    { voice: "bell", div: 16, pattern: "A3 . ", gain: 0.12 },
    { voice: "kick", div: 2, pattern: "x x . . . . . . x x . . . . . .", gain: 0.3, level: 1 },
    { voice: "strings", div: 8, pattern: "E5+F5 - D#5+E5 - ", gain: 0.05, level: 1 },
  ],
  sfx: SFX,
};

export const getHundredTalesSound = defineSuite(HUNDRED_TALES_SUITE);

/** BGM intensity: a third of the candles left. */
export function talesIntensity(s: TalesState): number {
  return s.candles <= s.candlesMax / 3 ? 1 : 0;
}

export function hundredTalesCues(viewer: number) {
  return (prev: TalesState, next: TalesState): SoundCue[] => {
    const cues: SoundCue[] = [];
    const ev = next.lastEvent;
    if (ev && ev !== prev.lastEvent) {
      if ("card" in ev) {
        cues.push("flip");
        const c = ev.card;
        if (c.fear > 0) cues.push({ name: "snuff", arg: c.fear });
        if (c.kind === "salt") cues.push("salt");
        else if (c.kind === "candle") cues.push("relight");
        else if (c.kind === "mirror") cues.push("mirror");
        else if (ev.act === "draw" && ev.salted) cues.push("saltSave");
        else if (ev.act === "draw") {
          cues.push({ name: "ghost", arg: c.fear });
          cues.push({ name: "chain", arg: next.story.length });
        }
      }
      if (ev.act === "bust") cues.push("bust");
      else if (ev.act === "perfect") cues.push("perfect");
      else if (ev.act === "stop") cues.push(ev.auto ? "autoStop" : "stop");
      else if (ev.act === "curse") cues.push("curse");
    }
    if (prev.candles >= 10 && next.candles < 10 && next.phase === "play") cues.push("lastCandles");
    const mine = (s: TalesState) => currentActor(s) === viewer;
    if (mine(next) && !mine(prev)) cues.push("turn");
    // still my turn after a tale and the next one is risky
    else if (mine(next) && next.told > 0 && next.lastEvent !== prev.lastEvent) {
      const o = drawOdds(next, viewer);
      if (o.bust + o.curse >= 0.35) cues.push("danger");
    }
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
