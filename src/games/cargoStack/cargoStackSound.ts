import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import { currentActor, heelDeg, type CargoState } from "./engine";

/**
 * 화물선 쌓기 "Harbor Shanty" suite (rulebook §12) — an original sea shanty
 * in D dorian at 116 BPM: mandolin strums, upright bass on the downbeats, a
 * stomping tom + claps and a tin-whistle tune. On the last voyage or under a
 * storm forecast (intensity 1) a brass foghorn line and a snare roll join.
 *
 * Board-local input sounds (pick a crate, move the ghost, invalid column,
 * timer ticks) are played by CargoStackBoard; everything that changes the
 * game state comes from `cargoStackCues` so every client hears every seat.
 */

const SFX = {
  /** Picking a crate from the crane queue. */
  select: [fx.pop(420, 980, 0.18), { inst: "woodblock", note: "E5", at: 0.03, gain: 0.5 }],
  /** Ghost moved one column. */
  move: [{ inst: "tock", note: "C5", gain: 0.7 }],
  /** Can't place there. */
  invalid: [fx.buzz(240, 150, 0.22, 0.1)],
  /** arg = tonnes — the crane lowers and the crate lands (heavier = deeper). */
  land: (w: number) => {
    const k = Math.min(1, w / 6);
    return [
      { wave: "sawtooth", freq: 90, to: 70, glide: 0.3, dur: 0.32, peak: 0.035, attack: 0.03, filter: { type: "lowpass", freq: 700 } },
      fx.whoosh(1400, 500, 0.3, 0.06),
      fx.thud(170 - k * 80, 0.22 + k * 0.15, 0.3 + k * 0.25, 0.32),
      { wave: "square", freq: 330 - k * 120, to: 250 - k * 90, glide: 0.08, dur: 0.12, peak: 0.04 + k * 0.03, at: 0.32, attack: 0.001, filter: { type: "bandpass", freq: 1200, q: 2 } },
      { wave: "noise", dur: 0.08, peak: 0.05 + k * 0.04, at: 0.32, filter: { type: "lowpass", freq: 1800 } },
    ];
  },
  /** ⚙️ steel crate — an extra metallic clang. */
  steel: [
    { wave: "sine", freq: 523, dur: 0.6, peak: 0.08, at: 0.33, attack: 0.001 },
    { wave: "sine", freq: 1234, dur: 0.4, peak: 0.05, at: 0.33, attack: 0.001 },
    { wave: "sine", freq: 1870, dur: 0.25, peak: 0.03, at: 0.33, attack: 0.001 },
  ],
  /** 💎 gold crate — sparkle. */
  gold: [...fx.coin(0.35, 2600, 0.1), ...fx.arp("glock", ["A5", "D6", "F6", "A6"], 0.05, 0.35, 0.55).map((p) => ({ ...p, at: (p.at ?? 0) + 0.38 }))],
  /** 🥚 glass breaks. */
  crush: [
    { wave: "noise", dur: 0.25, peak: 0.12, at: 0.34, attack: 0.001, filter: { type: "highpass", freq: 3500 } },
    { wave: "sine", freq: 3100, dur: 0.18, peak: 0.05, at: 0.35, attack: 0.001 },
    { wave: "sine", freq: 4400, dur: 0.14, peak: 0.04, at: 0.4, attack: 0.001 },
    { wave: "sine", freq: 2700, dur: 0.2, peak: 0.04, at: 0.46, attack: 0.001 },
    fx.buzz(200, 120, 0.3, 0.06, 0.5),
  ],
  /** The hull groans — heel past 60 % of the limit. */
  creak: [
    { wave: "sawtooth", freq: 95, to: 130, glide: 0.5, dur: 0.6, peak: 0.05, at: 0.45, attack: 0.08, filter: { type: "bandpass", freq: 420, q: 4 } },
    { wave: "sawtooth", freq: 140, to: 105, glide: 0.4, dur: 0.45, peak: 0.035, at: 0.95, attack: 0.06, filter: { type: "bandpass", freq: 520, q: 4 } },
  ],
  /** arg = crates — they slide off and hit the water. */
  splash: (count: number) => {
    const out = [];
    const n = Math.max(1, Math.min(4, Math.round(count)));
    for (let i = 0; i < n; i++) {
      const at = 0.55 + i * 0.32;
      out.push(fx.whoosh(2200, 600, 0.25, 0.07, at - 0.2));
      out.push({ wave: "noise" as const, dur: 0.5, peak: 0.16, at, attack: 0.005, filter: { type: "lowpass" as const, freq: 2400, to: 300 } });
      out.push({ wave: "sine" as const, freq: 220, to: 70, glide: 0.25, dur: 0.3, peak: 0.16, at, attack: 0.002 });
    }
    return out;
  },
  /** The ship goes over. */
  capsize: [
    ...fx.crack(0.4, 0.4),
    { wave: "noise", dur: 1.6, peak: 0.16, at: 0.5, attack: 0.2, filter: { type: "lowpass", freq: 900, to: 200 } },
    { wave: "sawtooth", freq: 82, to: 55, glide: 1.6, dur: 1.8, peak: 0.07, at: 0.6, attack: 0.1, filter: { type: "lowpass", freq: 500 } },
    fx.buzz(180, 70, 1, 0.1, 1.2),
  ],
  /** ⚓ ballast pump — gurgles. */
  ballast: [
    { wave: "sawtooth", freq: 60, to: 75, glide: 0.6, dur: 0.7, peak: 0.05, attack: 0.05, filter: { type: "lowpass", freq: 400 } },
    ...[0.05, 0.2, 0.33, 0.48, 0.6].map((at, i) => ({ wave: "sine" as const, freq: 180 + i * 40, to: 320 + i * 50, glide: 0.06, dur: 0.08, peak: 0.12, at, attack: 0.004 })),
  ],
  /** ⏭️ pass. */
  pass: [{ inst: "marimba", note: "A4", dur: 0.25, gain: 0.5 }, { inst: "marimba", note: "E4", at: 0.15, dur: 0.4, gain: 0.5 }],
  /** It's my turn. */
  turn: [{ inst: "bell", note: "A5", dur: 0.6, gain: 0.45 }, { inst: "marimba", note: "D5", at: 0.12, dur: 0.4, gain: 0.5 }],
  /** Timer running out (board, last 5 s). */
  tick: [{ inst: "tick", note: "C6", gain: 0.8 }],
  /** Ship's horn — departure. */
  horn: [
    { wave: "sawtooth", freq: 110, dur: 1.4, peak: 0.07, attack: 0.08, filter: { type: "lowpass", freq: 600 } },
    { wave: "sawtooth", freq: 138.6, dur: 1.4, peak: 0.05, attack: 0.08, filter: { type: "lowpass", freq: 600 } },
    { wave: "sine", freq: 55, dur: 1.4, peak: 0.12, attack: 0.08 },
  ],
  /** arg = wave height — the sea gets up. */
  waves: (h: number) => [
    { wave: "noise", dur: 1.8, peak: 0.05 + h * 0.015, at: 0.6, attack: 0.7, filter: { type: "bandpass", freq: 500, to: 900, q: 0.7 } },
    { wave: "noise", dur: 1.6, peak: 0.04 + h * 0.012, at: 1.6, attack: 0.6, filter: { type: "bandpass", freq: 700, to: 400, q: 0.7 } },
    ...(h >= 5 ? fx.crack(2, 0.18) : []),
  ],
  /** 🥚 fragile delivered intact. */
  fragileSave: [...fx.arp("glock", ["D6", "F6", "A6", "D7"], 0.07, 0.4, 0.6).map((p) => ({ ...p, at: (p.at ?? 0) + 1.4 }))],
  /** A new voyage — anchor chain. */
  anchor: [...[0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36].map((at) => fx.click(2400 - at * 1500, 0.08, at)), fx.thud(90, 0.3, 0.3, 0.42)],
  /** Voyage result tally. */
  tally: [...fx.arp("mandolin", ["D4", "F4", "A4", "D5"], 0.07, 0.5, 0.7)],
  victory: [
    ...fx.arp("brass", ["D4", "F4", "A4", "D5"], 0.12, 0.5),
    ...fx.chord("strings", ["D4", "F4", "A4", "D5"], 2.2, 0.7, 0.5),
    { inst: "clap", note: "C4", at: 0.5, gain: 0.7 },
    { inst: "clap", note: "C4", at: 0.75, gain: 0.7 },
    { inst: "bell", note: "D6", at: 0.5, gain: 0.5 },
  ],
} satisfies Record<string, SfxRecipe>;

export const CARGO_STACK_SUITE: SuiteConfig = {
  bpm: 116,
  swing: 0.1,
  tracks: [
    { voice: "tom", pattern: "x . . . . . . . x . . . . . . .", gain: 0.36 },
    { voice: "clap", pattern: ". . . . x . . . . . . . x . . .", gain: 0.22 },
    { voice: "shaker", pattern: "x . x . x . x . x . x . x . x x", gain: 0.12 },
    { voice: "upright", div: 2, pattern: "D2 . A2 . D2 . A2 . | C2 . G2 . C2 . G2 . | D2 . A2 . D2 . F2 . | A2 . E2 . A2 . C3 .", gain: 0.42 },
    {
      voice: "mandolin",
      div: 2,
      pattern: ". D3+F3+A3 . D3+F3+A3 . D3+F3+A3 . D3+G3+B3 | . C3+E3+G3 . C3+E3+G3 . C3+E3+G3 . C3+E3+G3 | . D3+F3+A3 . D3+F3+A3 . F3+A3+C4 . F3+A3+C4 | . A2+C3+E3 . A2+C3+E3 . A2+C3+E3 . A2+C#3+E3",
      gain: 0.2,
    },
    { voice: "whistle", div: 2, pattern: "A4 . D5 . D5 - E5 F5 | E5 . C5 . G4 - - . | A4 . D5 . F5 - E5 D5 | C5 . A4 . A4 - - . | F5 - E5 D5 C5 . D5 . | E5 . C5 . G4 . A4 . | B4 . D5 . F5 - E5 D5 | E5 . C#5 . D5 - - .", gain: 0.11 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . x x", gain: 0.2, level: 1 },
    { voice: "brass", div: 4, pattern: "D4 - F4 E4 | C4 - E4 G4 | D4 - A4 F4 | E4 - - . ", gain: 0.12, level: 1 },
  ],
  sfx: SFX,
};

export const getCargoStackSound = defineSuite(CARGO_STACK_SUITE);

/** BGM intensity: last voyage or a storm forecast. */
export function cargoIntensity(state: CargoState): number {
  return state.voyage === state.options.voyages - 1 || state.forecasts[state.voyage] === "storm" ? 1 : 0;
}

/** State-diff cues — every seat's moves are heard by everyone. */
export function cargoStackCues(viewer: number) {
  return (prev: CargoState, next: CargoState): SoundCue[] => {
    const cues: SoundCue[] = [];
    const ev = next.lastEvent;
    if (ev && ev !== prev.lastEvent) {
      if (ev.act === "place" && ev.placed) {
        cues.push({ name: "land", arg: ev.placed.w });
        if (ev.placed.kind === "steel") cues.push("steel");
        if (ev.placed.kind === "gold") cues.push("gold");
      } else if (ev.act === "ballast") cues.push("ballast");
      else if (ev.act === "pass") cues.push("pass");
      if (ev.crushed.length > 0) cues.push("crush");
      if (ev.spilled.length > 0) cues.push({ name: "splash", arg: ev.spilled.length });
      if (ev.capsized) cues.push("capsize");
      else if (Math.abs(heelDeg(ev.T, ev.lim)) >= 7.2) cues.push("creak");
    }
    const dep = next.departure;
    if (dep && dep !== prev.departure) {
      if (!dep.capsized) {
        cues.push("horn");
        if (dep.wave > 0) cues.push({ name: "waves", arg: dep.wave });
        if (dep.spilled.length > 0) cues.push({ name: "splash", arg: dep.spilled.length });
        if (dep.fragile.length > 0) cues.push("fragileSave");
      }
      cues.push("tally");
    }
    if (next.voyage !== prev.voyage && next.phase === "load") cues.push("anchor");
    const mine = (s: CargoState) => s.phase === "load" && currentActor(s) === viewer;
    if (mine(next) && (!mine(prev) || prev.turn !== next.turn)) cues.push("turn");
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    return cues;
  };
}
