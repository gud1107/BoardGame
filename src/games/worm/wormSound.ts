import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { WormEvent } from "./WormEffects";
import type { SeatIndex } from "./engine";

/**
 * 지렁이 "Arcade Arena" suite — an 8-bit chiptune at 140 BPM in E minor
 * (Em–C–D–B): square lead, octave-bouncing triangle bass, noise snares and a
 * kick. In the last 30 seconds (intensity 1) a fast arpeggio layer kicks in.
 * SFX are viewer-centric — 8 snakes eating 490 pellets would be a wall of
 * noise otherwise: my own pellet blips (throttled), my growth-stage power-up,
 * my kills / my cuts, my death, a soft pop for other snakes' deaths, and a
 * chip fanfare at the buzzer.
 */

const SFX = {
  eat: (value: number) => [{ wave: "square" as const, freq: 660 + value * 110, to: 1320 + value * 110, glide: 0.04, dur: 0.06, peak: 0.05 }],
  stageUp: fx.arp("chip", ["E5", "G5", "B5", "E6"], 0.06, 0.12),
  cutThem: [{ wave: "square", freq: 1800, to: 300, glide: 0.12, dur: 0.14, peak: 0.07 }, { wave: "noise", dur: 0.08, peak: 0.08, filter: { type: "highpass", freq: 2500 } }],
  cutMe: [{ wave: "noise", dur: 0.2, peak: 0.16, filter: { type: "lowpass", freq: 1800, to: 300 } }, { wave: "square", freq: 300, to: 90, glide: 0.18, dur: 0.2, peak: 0.07 }],
  kill: [...fx.chord("chip", ["E4", "B4", "E5"], 0.25, 1), ...fx.arp("chip", ["B5", "E6"], 0.08, 0.12, 0.9).map((p) => ({ ...p, at: (p.at ?? 0) + 0.2 })), ...fx.coin(0.36, 2600, 0.08)],
  myDeath: [...fx.arp("chip", ["E5", "B4", "G4", "E4", "B3"], 0.07, 0.1), { wave: "noise", at: 0.35, dur: 0.4, peak: 0.16, filter: { type: "lowpass", freq: 3000, to: 200 } }],
  otherDeath: [{ wave: "triangle", freq: 500, to: 200, glide: 0.1, dur: 0.12, peak: 0.1 }, { wave: "noise", dur: 0.06, peak: 0.05, filter: { type: "highpass", freq: 3000 } }],
  buzzer: [...fx.arp("chip", ["E4", "G4", "B4", "E5", "G5", "B5"], 0.07, 0.12), ...fx.chord("chip", ["E5", "G#5", "B5"], 0.8, 1, 0.45)],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const WORM_SUITE: SuiteConfig = {
  bpm: 140,
  tracks: [
    { voice: "chipBass", div: 2, pattern: "E2 E3 E2 E3 E2 E3 E2 E3 | C2 C3 C2 C3 C2 C3 C2 C3 | D2 D3 D2 D3 D2 D3 D2 D3 | B1 B2 B1 B2 B1 B2 D2 D3", gain: 0.7 },
    { voice: "chip", div: 2, pattern: "E4 G4 B4 - A4 G4 F#4 E4 | G4 - E4 - C5 - B4 A4 | F#4 A4 D5 - C5 B4 A4 F#4 | G4 - F#4 - D#4 - B3 .", gain: 0.8 },
    { voice: "kick", div: 4, pattern: "X . X .", gain: 0.6 },
    { voice: "chipNoise", div: 4, pattern: ". x . x", gain: 1 },
    { voice: "chipNoise", div: 2, pattern: "x x x x x x x x", gain: 0.35 },
    { voice: "arp", pattern: "E5 B4 G4 B4 E5 B4 G4 B4 C5 G4 E4 G4 C5 G4 E4 G4 | D5 A4 F#4 A4 D5 A4 F#4 A4 B4 F#4 D#4 F#4 B4 F#4 D#4 F#4", gain: 0.6, level: 1 },
  ],
  sfx: SFX,
};

export const getWormSound = defineSuite(WORM_SUITE);

let lastEatAt = 0;

/** Viewer-centric cues for one snapshot's events (see the module doc). */
export function wormEventCues(events: WormEvent[], viewerSeat: SeatIndex, now: number): Cue[] {
  const cues: Cue[] = [];
  let ate = 0;
  for (const e of events) {
    switch (e.type) {
      case "eat":
        if (e.seat === viewerSeat) ate = Math.max(ate, e.value);
        break;
      case "stageUp":
        if (e.seat === viewerSeat) cues.push("stageUp");
        break;
      case "cut":
        if (e.targetSeat === viewerSeat) cues.push("cutMe");
        else if (e.attackerSeat === viewerSeat) cues.push("cutThem");
        break;
      case "death":
        if (e.seat === viewerSeat) cues.push("myDeath");
        else if (e.attackerSeat === viewerSeat) cues.push("kill");
        else cues.push("otherDeath");
        break;
    }
  }
  if (ate > 0 && now - lastEatAt > 70) {
    lastEatAt = now;
    cues.push({ name: "eat", arg: ate });
  }
  return cues;
}
