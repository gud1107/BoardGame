import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { currentThrower, type CurlingState } from "./engine";

/**
 * 컬링 파티 "Ice Party" suite (rulebook §18) — a bright disco-house loop in
 * C major at 124 BPM: four-on-the-floor kick, off-beat hats, octave synth
 * bass, plucky stabs and a glockenspiel hook (ice = sparkle). Intensity 1
 * (last end / extra end / the hammer stone) adds open hats, a 16th arp and
 * claps on every beat.
 *
 * Stone SFX: release whoosh, a granite rumble the board re-triggers while a
 * stone slides (arg = speed 0..1), a clack per collision (arg = impact),
 * a bristly swish per sweep tap, and one-shots for every party stone.
 */

const SFX = {
  release: [fx.whoosh(300, 1300, 0.45, 0.12), fx.thud(90, 0.3, 0.25)],
  /** Granite on pebbled ice — arg = speed 0..1. */
  slide: (k: number) => [{ wave: "noise", dur: 0.55, peak: 0.025 + k * 0.06, attack: 0.08, filter: { type: "lowpass", freq: 260 + k * 380, q: 0.7 } }, { wave: "sine", freq: 46 + k * 18, dur: 0.5, peak: 0.03 + k * 0.05, attack: 0.08 }],
  /** Stone on stone — arg = impact 0..1. */
  hit: (k: number) => [
    { wave: "sine", freq: 1900 - k * 500, to: 900, glide: 0.04, dur: 0.09, peak: 0.12 + k * 0.25, attack: 0.001 },
    { wave: "triangle", freq: 420, to: 160, glide: 0.08, dur: 0.16, peak: 0.12 + k * 0.3, attack: 0.001 },
    { wave: "noise", dur: 0.06, peak: 0.08 + k * 0.18, attack: 0.001, filter: { type: "bandpass", freq: 3200, q: 1.5 } },
  ],
  sweep: [{ wave: "noise", dur: 0.12, peak: 0.07, attack: 0.015, filter: { type: "bandpass", freq: 2600, to: 1500, q: 1.1 } }],
  stop: [fx.thud(120, 0.18, 0.18)],
  out: [fx.whoosh(1400, 300, 0.35, 0.08)],
  bomb: [...fx.crack(0, 0.55), fx.thud(55, 0.9, 0.7, 0.02), { wave: "noise", at: 0.05, dur: 1.2, peak: 0.12, attack: 0.02, filter: { type: "lowpass", freq: 1800, to: 120 } }],
  stick: [{ wave: "sine", freq: 220, to: 90, glide: 0.18, dur: 0.25, peak: 0.25, attack: 0.005 }, { wave: "noise", dur: 0.18, peak: 0.08, attack: 0.01, filter: { type: "lowpass", freq: 700 } }],
  ghost: [{ wave: "sine", freq: 620, to: 880, glide: 0.5, dur: 0.7, peak: 0.08, attack: 0.15, vibrato: { rate: 7, depth: 18 } }],
  solid: [fx.pop(300, 700, 0.15)],
  magnet: [{ wave: "sawtooth", freq: 110, dur: 0.6, peak: 0.04, attack: 0.1, tremolo: 22, filter: { type: "lowpass", freq: 600 } }],
  heavy: [fx.thud(70, 0.5, 0.6)],
  card: [...fx.arp("glock", ["C6", "E6", "G6"], 0.05, 0.4)],
  aim: [fx.click(2200, 0.06)],
  spin: [fx.pop(500, 800, 0.1)],
  charge: (k: number) => [{ wave: "triangle", freq: 300 + k * 600, dur: 0.06, peak: 0.05, attack: 0.005 }],
  turn: [{ inst: "glock", note: "G5", dur: 0.3 }, { inst: "glock", note: "C6", at: 0.1, dur: 0.5 }],
  call: [fx.pop(600, 1100, 0.14)],
  great: [...fx.arp("glock", ["C6", "E6", "G6", "C7"], 0.06, 0.5), ...fx.coin(0.24, 2600, 0.08)],
  oops: [fx.buzz(300, 150, 0.35, 0.1)],
  react: [fx.pop(520, 980, 0.1)],
  score: [...fx.arp("brass", ["C4", "E4", "G4", "C5"], 0.09, 0.5, 0.7), ...fx.chord("strings", ["C4", "E4", "G4", "C5"], 1.3, 0.6, 0.38)],
  blank: [{ inst: "vibes", note: "E4", dur: 0.5 }, { inst: "vibes", note: "C4", at: 0.18, dur: 0.7 }],
  steal: [...fx.arp("brass", ["G4", "C5", "E5", "G5", "C6"], 0.07, 0.5, 0.8), ...fx.crack(0.4, 0.15)],
  victory: [...fx.arp("glock", ["C5", "E5", "G5", "C6", "E6", "G6"], 0.07, 0.6), ...fx.chord("brass", ["C4", "E4", "G4", "C5"], 2, 0.8, 0.45), { inst: "synthBass", note: "C2", at: 0.45, dur: 1.4 }],
} satisfies Record<string, SfxRecipe>;

export const CURLING_SUITE: SuiteConfig = {
  bpm: 124,
  tracks: [
    { voice: "kick", pattern: "x . . . x . . . x . . . x . . .", gain: 0.6 },
    { voice: "clap", pattern: ". . . . x . . . . . . . x . . .", gain: 0.38 },
    { voice: "hat", pattern: ". . x . . . x . . . x . . . x x", gain: 0.22 },
    { voice: "synthBass", div: 2, pattern: "C2 C3 . C3 C2 C3 . C3 | A1 A2 . A2 A1 A2 . A2 | F1 F2 . F2 F1 F2 . F2 | G1 G2 . G2 G1 G2 B1 B2", gain: 0.55 },
    { voice: "stab", div: 2, pattern: ". C4+E4+G4 . C4+E4+G4 . . C4+E4+G4 . | . A3+C4+E4 . A3+C4+E4 . . A3+C4+E4 . | . F3+A3+C4 . F3+A3+C4 . . F3+A3+C4 . | . G3+B3+D4 . G3+B3+D4 . . G3+B3+D4 .", gain: 0.22 },
    { voice: "glock", div: 2, pattern: "E6 . G6 . C7 . G6 . | E6 . C6 . . . A5 . | F6 . A6 . C7 . A6 . | G6 . F6 . E6 . D6 .", gain: 0.2 },
    { voice: "pad", div: 8, pattern: "C4+E4+G4 - | A3+C4+E4 - | F3+A3+C4 - | G3+B3+D4 -", gain: 0.12, maxLevel: 1 },
    { voice: "openHat", pattern: ". . x . . . x . . . x . . . x .", gain: 0.18, level: 1 },
    { voice: "arp", pattern: "C5 E5 G5 C6 C5 E5 G5 C6 C5 E5 G5 C6 C5 E5 G5 C6 | A4 C5 E5 A5 A4 C5 E5 A5 A4 C5 E5 A5 A4 C5 E5 A5 | F4 A4 C5 F5 F4 A4 C5 F5 F4 A4 C5 F5 F4 A4 C5 F5 | G4 B4 D5 G5 G4 B4 D5 G5 G4 B4 D5 G5 G4 B4 D5 G5", gain: 0.12, level: 1 },
    { voice: "clap", pattern: "x . . . x . . . x . . . x . . .", gain: 0.2, level: 1 },
  ],
  sfx: SFX,
};

export const getCurlingSound = defineSuite(CURLING_SUITE);

/** Shot calls that deserve the bright "great" sting vs the "oops" buzz. */
const GREAT = new Set(["button", "freeze", "double", "triple", "hitStay", "raise"]);
const OOPS = new Set(["hog", "side", "through", "ownGoal", "fgz"]);

/** State-diff cues (live stone sounds are played by the board from the running sim). */
export function curlingCues(viewerSide: number | null, viewerSeat: number) {
  return (prev: CurlingState, next: CurlingState) => {
    const cues: (string | { name: string; arg?: number })[] = [];
    const t = next.lastThrow;
    if (t && t !== prev.lastThrow && t.turn !== prev.lastThrow?.turn) {
      cues.push("call");
      if (GREAT.has(t.call.key)) cues.push("great");
      else if (OOPS.has(t.call.key)) cues.push("oops");
    }
    if (prev.phase !== "scored" && next.phase === "scored") {
      const e = next.history[next.history.length - 1];
      if (!e || e.scorer === null) cues.push("blank");
      else if (next.options.mode === "team" && e.scorer !== e.hammer) cues.push("steal");
      else cues.push("score");
    }
    if (prev.phase !== "ended" && next.phase === "ended") cues.push("victory");
    if (next.phase === "aim" && prev.end !== next.end && next.cards[viewerSide ?? -1]) cues.push("card");
    const seatNow = currentThrower(next);
    const seatBefore = currentThrower(prev);
    if (seatNow === viewerSeat && (seatBefore !== viewerSeat || prev.turn !== next.turn)) cues.push("turn");
    return cues;
  };
}

/* ── 외침 (§17) — browser speech, follows the SFX mute ─────────────────── */

let lastShout = 0;
export const SWEEP_SHOUTS = ["헐! 헐!", "쓸어!", "더 세게!", "헐 하드!", "가자 가자!"];

export function shout(text: string, minGapMs = 1400): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (isSfxEffectivelyMuted(useAudioSettingsStore.getState())) return;
  const now = Date.now();
  if (now - lastShout < minGapMs) return;
  lastShout = now;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 1.35;
    u.pitch = 1.15;
    u.volume = Math.min(1, useAudioSettingsStore.getState().sfxVolume ?? 0.7);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is decoration only */
  }
}
