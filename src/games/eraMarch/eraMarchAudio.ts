import { defineSuite, fx, type Layer, type SfxPart, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { ProceduralSuite } from "@/lib/audio/proceduralSuite";
import { UNITS, type Era, type Fx } from "./data";
import type { FxEvent, Side } from "./engine";

/**
 * 시대의 진격 sound: one BGM per era (the board switches suites as the
 * leading side evolves) and a code-synthesized cue for every action — no
 * audio files. Mute/volume follow the site-wide audio settings through the
 * shared procedural engine.
 *
 * Every SFX recipe takes a gain argument (0–1): `EraMarchSound` lowers it
 * for things far from the camera and for the opponent's routine actions, and
 * rate-limits the busy cues (hits, shots) so a full lane stays a patter
 * under the event cues instead of a wall of noise.
 */

/* ── BGM ─────────────────────────────────────────────────────────────── */

const bar = (s: string, n = 4) => Array.from({ length: n }, () => s).join(" | ");

/** 🪨 "Drums of the Hearth" — 100 BPM, D minor pentatonic, frame drums + wooden flute. */
const ERA0: SuiteConfig["tracks"] = [
  { voice: "shakuhachi", div: 2, pattern: "D5 - F5 G5 A5 - G5 F5 | D5 - - C5 D5 - . . | F5 - G5 A5 C6 - A5 G5 | A5 - - - . . . .", gain: 0.5 },
  { voice: "marimba", div: 2, pattern: bar("D3 A3 D4 A3 C4 A3 D4 A3"), gain: 0.45 },
  { voice: "upright", div: 4, pattern: "D2 . D2 A1 | D2 . F2 C2 | D2 . D2 A1 | C2 . A1 .", gain: 0.6 },
  { voice: "taiko", div: 4, pattern: bar("X . x ."), gain: 0.45 },
  { voice: "doum", div: 2, pattern: bar(". . x . . x x ."), gain: 0.5 },
  { voice: "shaker", div: 2, pattern: bar("x x x x x x x x"), gain: 0.5 },
  { voice: "taiko", div: 2, pattern: bar("x . x x x . x x"), gain: 0.45, level: 1 },
];

/** 🏛️ "Legion of Bronze" — 108 BPM, C minor march: brass fanfare over snare and timpani. */
const ERA1: SuiteConfig["tracks"] = [
  { voice: "brass", div: 2, pattern: "C4 - Eb4 G4 C5 - - . | Bb4 - Ab4 G4 F4 - - . | Ab4 - G4 F4 Eb4 - F4 G4 | C4 - - - . . . .", gain: 0.42 },
  { voice: "strings", div: 8, pattern: "C3+Eb3+G3 - Bb2+D3+F3 - Ab2+C3+Eb3 - G2+B2+D3 -", gain: 0.4 },
  { voice: "timpani", div: 4, pattern: "C2 . G1 . | Bb1 . F1 . | Ab1 . Eb2 . | G1 . G1 G1", gain: 0.55 },
  { voice: "snare", div: 1, pattern: bar("X . . x X . x . X . . x X x x x"), gain: 0.35 },
  { voice: "bass", div: 4, pattern: "C2 C2 G1 G1 | Bb1 Bb1 F1 F1 | Ab1 Ab1 Eb2 Eb2 | G1 G1 G1 B1", gain: 0.5 },
  { voice: "taiko", div: 4, pattern: bar("X x X x"), gain: 0.4, level: 1 },
];

/** ⚓ "Broadside" — 126 BPM swung jig in G: mandolin + fiddle-ish flute, upright bass. */
const ERA2: SuiteConfig["tracks"] = [
  { voice: "flute", div: 2, pattern: "G5 F#5 G5 A5 B5 A5 G5 D5 | E5 F#5 G5 E5 D5 - B4 . | C5 D5 E5 C5 B4 C5 D5 B4 | A4 B4 C5 A4 G4 - - .", gain: 0.42 },
  { voice: "mandolin", div: 2, pattern: "G3+D4 . G3+D4 . G3+D4 . G3+D4 . | C4+E4 . C4+E4 . C4+E4 . C4+E4 . | C4+E4 . C4+E4 . G3+D4 . G3+D4 . | D4+F#4 . D4+F#4 . D4+F#4 . D4+F#4 .", gain: 0.35 },
  { voice: "upright", div: 4, pattern: "G2 D2 G2 D2 | C2 G2 G2 D2 | C2 G2 G2 B1 | D2 A1 G2 .", gain: 0.6 },
  { voice: "tom", div: 4, pattern: bar("x . x x"), gain: 0.35 },
  { voice: "shaker", div: 2, pattern: bar(". x . x . x . x"), gain: 0.55 },
  { voice: "snare", div: 2, pattern: bar("x x . x x x . x"), gain: 0.3, level: 1 },
];

/** ⚙️ "Iron Works" — 116 BPM, E minor machine groove: ticking gears, anvil, low strings. */
const ERA3: SuiteConfig["tracks"] = [
  { voice: "strings", div: 2, pattern: bar("E2 E2 G2 E2 B2 E2 A2 G2"), gain: 0.42 },
  { voice: "brass", div: 4, pattern: "E4 . . G4 | F#4 . . . | E4 . . B3 | D4 . C4 B3", gain: 0.35 },
  { voice: "organ", div: 16, pattern: "E3+G3+B3 C3+E3+G3 A2+C3+E3 B2+D#3+F#3", gain: 0.35 },
  { voice: "tick", div: 1, pattern: bar("x . x . x . x . x . x . x . x x"), gain: 0.3 },
  { voice: "woodblock", div: 4, pattern: bar(". x . x"), gain: 0.4 },
  { voice: "kick", div: 4, pattern: bar("X . X ."), gain: 0.5 },
  { voice: "snare", div: 4, pattern: bar(". x . x"), gain: 0.35 },
  { voice: "timpani", div: 2, pattern: bar("E2 . E2 E2 . . E2 ."), gain: 0.4, level: 1 },
];

/** ⚡ "Coil Storm" — 138 BPM, F minor synth anthem. */
const ERA4: SuiteConfig["tracks"] = [
  { voice: "arp", div: 1, pattern: ["F4 Ab4 C5 F5", "Db4 F4 Ab4 Db5", "Ab3 C4 Eb4 Ab4", "Eb4 G4 Bb4 Eb5"].map((a) => Array(4).fill(a).join(" ")).join(" | "), gain: 0.38 },
  { voice: "synthBass", div: 2, pattern: "F1 F2 F1 F2 F1 F2 F1 F2 | Db2 Db3 Db2 Db3 Db2 Db3 Db2 Db3 | Ab1 Ab2 Ab1 Ab2 Ab1 Ab2 Ab1 Ab2 | Eb2 Eb3 Eb2 Eb3 Eb2 Eb3 Eb2 Eb3", gain: 0.55 },
  { voice: "lead", div: 4, pattern: "C5 - Ab4 F4 | Db5 - C5 Ab4 | C5 - Eb5 - | Bb4 - G4 -", gain: 0.3 },
  { voice: "pad", div: 16, pattern: "F3+Ab3+C4 Db3+F3+Ab3 Ab2+C3+Eb3 Eb3+G3+Bb3", gain: 0.4 },
  { voice: "kick", div: 4, pattern: bar("X x x x"), gain: 0.55 },
  { voice: "clap", div: 4, pattern: bar(". x . x"), gain: 0.45 },
  { voice: "hat", div: 2, pattern: bar(". x . x . x . x"), gain: 0.6 },
  { voice: "brass", div: 4, pattern: "F3+C4 . . F3+C4 | Db3+Ab3 . . Db3+Ab3 | Ab3+Eb4 . . Ab3+Eb4 | Eb3+Bb3 . Eb3+Bb3 Eb3+Bb3", gain: 0.4, level: 1 },
];

/* ── SFX ─────────────────────────────────────────────────────────────── */

/** Scales a recipe's loudness by `g`. */
function sc(parts: SfxPart[], g: number): SfxPart[] {
  return parts.map((p) => ("inst" in p ? { ...p, gain: (p.gain ?? 1) * g } : { ...p, peak: p.peak * g }));
}
const r = (fn: () => SfxPart[]): SfxRecipe => (g: number) => sc(fn(), g || 1);
const noise = (dur: number, peak: number, filter: Layer["filter"], at = 0, attack = 0.002): Layer => ({ wave: "noise", dur, peak, filter, at, attack });

const SFX: Record<string, SfxRecipe> = {
  // UI / economy
  click: r(() => [fx.click(1600, 0.12)]),
  buy: r(() => [...fx.coin(0, 2200, 0.1), fx.pop(500, 1000, 0.14, 0.03)]),
  cancel: r(() => [fx.whoosh(2400, 600, 0.15, 0.1), ...fx.coin(0.04, 1500, 0.07)]),
  reject: r(() => [fx.buzz(240, 150, 0.22, 0.12)]),
  gold: r(() => fx.coin(0, 2600, 0.07)),
  steal: r(() => [...fx.coin(0, 1800, 0.08), ...fx.coin(0.06, 1400, 0.06), fx.whoosh(800, 2200, 0.12, 0.06)]),
  ready: r(() => fx.arp("glock", ["C6", "E6", "G6"], 0.06, 0.4, 0.8)),
  specialReady: r(() => [...fx.arp("vibes", ["G5", "C6", "E6", "G6"], 0.05, 0.5, 0.9), fx.whoosh(1200, 5000, 0.3, 0.06)]),
  slot: r(() => [fx.thud(220, 0.15, 0.3), ...fx.arp("bell", ["E5", "B5"], 0.08, 0.6, 0.7)]),
  turret: r(() => [fx.thud(160, 0.12, 0.45), { wave: "square", freq: 900, to: 500, glide: 0.05, dur: 0.07, peak: 0.08, at: 0.02 }, fx.thud(180, 0.12, 0.4, 0.16), { wave: "square", freq: 1000, to: 560, glide: 0.05, dur: 0.07, peak: 0.07, at: 0.18 }, ...fx.coin(0.3, 2000, 0.06)]),
  sell: r(() => [fx.whoosh(3000, 600, 0.25, 0.09), ...fx.coin(0.05, 2000, 0.08), ...fx.coin(0.14, 1600, 0.07)]),

  // spawns, one horn per era
  spawn0: r(() => [{ inst: "shakuhachi", note: "D4", dur: 0.22, gain: 0.7 }, fx.thud(120, 0.12, 0.25)]),
  spawn1: r(() => fx.arp("brass", ["G3", "C4"], 0.08, 0.2, 0.7)),
  spawn2: r(() => [{ inst: "whistle", note: "A5", dur: 0.18, gain: 0.6 }, { inst: "whistle", note: "D6", dur: 0.14, at: 0.12, gain: 0.5 }]),
  spawn3: r(() => [noise(0.3, 0.06, { type: "bandpass", freq: 2200, q: 3 }), { wave: "sine", freq: 880, to: 990, glide: 0.1, dur: 0.3, peak: 0.08, attack: 0.03 }]),
  spawn4: r(() => [{ wave: "sawtooth", freq: 300, to: 1200, glide: 0.15, dur: 0.18, peak: 0.06, filter: { type: "lowpass", freq: 3000 } }, ...fx.arp("vibes", ["A5", "E6"], 0.05, 0.25, 0.6)]),

  // melee impacts
  hit_blunt: r(() => [fx.thud(110, 0.14, 0.35), noise(0.06, 0.09, { type: "lowpass", freq: 1500 })]),
  hit_blade: r(() => [noise(0.05, 0.08, { type: "highpass", freq: 3500 }), { wave: "triangle", freq: 2600, to: 1800, glide: 0.08, dur: 0.12, peak: 0.06 }, fx.thud(180, 0.08, 0.15)]),
  hit_metal: r(() => [{ wave: "square", freq: 1400, to: 900, glide: 0.04, dur: 0.06, peak: 0.05 }, noise(0.05, 0.08, { type: "bandpass", freq: 3000, q: 1 }), fx.thud(150, 0.08, 0.2)]),
  hit_zap: r(() => [{ wave: "sawtooth", freq: 1800, to: 300, glide: 0.1, dur: 0.12, peak: 0.07, tremolo: 60 }, noise(0.08, 0.06, { type: "highpass", freq: 4000 })]),
  hit_trample: r(() => [fx.thud(80, 0.22, 0.5), noise(0.12, 0.12, { type: "lowpass", freq: 900 }), fx.thud(100, 0.12, 0.25, 0.06)]),

  // ranged fire
  fire_sling: r(() => [fx.whoosh(600, 2400, 0.16, 0.08)]),
  fire_bow: r(() => [{ wave: "triangle", freq: 220, to: 160, glide: 0.08, dur: 0.12, peak: 0.12 }, fx.whoosh(3000, 6000, 0.14, 0.05, 0.02)]),
  fire_musket: r(() => [...fx.crack(0, 0.22), noise(0.4, 0.05, { type: "lowpass", freq: 900 }, 0.05, 0.05)]),
  fire_rifle: r(() => [noise(0.12, 0.2, { type: "lowpass", freq: 6000, to: 800 }), { wave: "triangle", freq: 300, to: 80, glide: 0.1, dur: 0.12, peak: 0.16 }]),
  fire_cannon: r(() => [fx.thud(70, 0.5, 0.6), noise(0.6, 0.18, { type: "lowpass", freq: 1200, to: 120 })]),
  fire_throw: r(() => [fx.whoosh(500, 1600, 0.22, 0.08), { wave: "noise", dur: 0.25, peak: 0.03, at: 0.05, filter: { type: "highpass", freq: 6000 }, tremolo: 30 }]),
  fire_plasma: r(() => [{ wave: "sawtooth", freq: 600, to: 2400, glide: 0.08, dur: 0.12, peak: 0.06, filter: { type: "lowpass", freq: 4000 } }, { wave: "sine", freq: 1800, to: 900, glide: 0.1, dur: 0.15, peak: 0.07 }]),
  fire_rail: r(() => [{ wave: "sawtooth", freq: 120, to: 2400, glide: 0.06, dur: 0.1, peak: 0.07 }, noise(0.18, 0.12, { type: "highpass", freq: 2500, to: 800 }, 0.06), fx.thud(90, 0.2, 0.3, 0.06)]),
  fire_tesla: r(() => [{ wave: "sawtooth", freq: 90, dur: 0.3, peak: 0.08, tremolo: 45, filter: { type: "bandpass", freq: 1800, q: 2 } }, noise(0.2, 0.08, { type: "highpass", freq: 5000 })]),
  heal: r(() => fx.arp("glock", ["E6", "G#6"], 0.05, 0.3, 0.5)),

  // ranged impacts
  imp_arrow: r(() => [{ wave: "triangle", freq: 400, to: 200, glide: 0.04, dur: 0.06, peak: 0.12 }, noise(0.04, 0.05, { type: "bandpass", freq: 1800 })]),
  imp_stone: r(() => [fx.thud(200, 0.08, 0.25), noise(0.05, 0.08, { type: "bandpass", freq: 1200 })]),
  imp_bullet: r(() => [{ wave: "sine", freq: 3200, to: 2200, glide: 0.05, dur: 0.08, peak: 0.05 }, noise(0.03, 0.06, { type: "highpass", freq: 3000 })]),
  boom: r(() => [fx.thud(60, 0.6, 0.65), noise(0.7, 0.22, { type: "lowpass", freq: 2400, to: 90 }), noise(0.12, 0.1, { type: "highpass", freq: 3000 })]),
  counter: r(() => [{ wave: "square", freq: 1320, dur: 0.06, peak: 0.05 }, { wave: "square", freq: 1760, dur: 0.08, peak: 0.05, at: 0.05 }]),

  // deaths / base
  death: r(() => [{ wave: "square", freq: 260, to: 110, glide: 0.18, dur: 0.2, peak: 0.05, filter: { type: "lowpass", freq: 900 } }, noise(0.18, 0.08, { type: "lowpass", freq: 700 }), fx.thud(90, 0.2, 0.3, 0.08)]),
  death_big: r(() => [fx.thud(50, 0.8, 0.7), noise(0.9, 0.25, { type: "lowpass", freq: 3000, to: 80 }), ...fx.coin(0.15, 900, 0.05), ...fx.coin(0.3, 700, 0.04)]),
  base_hit: r(() => [fx.thud(55, 0.35, 0.55), noise(0.25, 0.12, { type: "lowpass", freq: 600 }), { wave: "triangle", freq: 140, to: 90, glide: 0.2, dur: 0.3, peak: 0.12 }]),
  alarm: r(() => [{ wave: "square", freq: 880, dur: 0.14, peak: 0.06 }, { wave: "square", freq: 660, dur: 0.14, peak: 0.06, at: 0.16 }, { wave: "square", freq: 880, dur: 0.14, peak: 0.06, at: 0.32 }]),

  // evolve fanfares (era 1–4) + doctrine
  evolve1: r(() => [...fx.arp("brass", ["C4", "G4", "C5", "E5"], 0.12, 0.5, 0.9), { inst: "timpani", note: "C2", at: 0, dur: 0.6 }, { inst: "gong", note: "C3", at: 0.48, dur: 2 }]),
  evolve2: r(() => [...fx.arp("brass", ["D4", "A4", "D5", "F#5"], 0.11, 0.5, 0.9), fx.thud(60, 0.6, 0.5, 0.45), ...fx.arp("bell", ["D6", "A6"], 0.1, 1, 0.5)]),
  evolve3: r(() => [...fx.arp("organ", ["E3", "B3", "E4", "G4"], 0.12, 0.6, 0.7), noise(0.8, 0.08, { type: "bandpass", freq: 2000, q: 3 }, 0.1), { inst: "gong", note: "E2", at: 0.5, dur: 2 }]),
  evolve4: r(() => [{ wave: "sawtooth", freq: 110, to: 880, glide: 0.6, dur: 0.7, peak: 0.08, filter: { type: "lowpass", freq: 600, to: 6000 } }, ...fx.arp("vibes", ["F5", "C6", "F6", "A6"], 0.08, 0.8, 0.9), fx.thud(50, 0.8, 0.6, 0.6)]),
  doctrine: r(() => fx.chord("bell", ["C5", "G5", "E6"], 1.2, 0.6)),

  // specials
  sp0: r(() => [{ inst: "brass", note: "F2", dur: 0.9, gain: 1.2 }, { wave: "sawtooth", freq: 180, to: 520, glide: 0.5, dur: 0.8, peak: 0.07, vibrato: { rate: 9, depth: 0.04 }, filter: { type: "lowpass", freq: 1600 } }, ...[0, 0.18, 0.36, 0.54, 0.72].map((t) => fx.thud(70, 0.2, 0.4, 0.4 + t))]),
  sp1: r(() => [{ wave: "noise", dur: 0.4, peak: 0.05, filter: { type: "bandpass", freq: 600, q: 4 }, tremolo: 18 }, fx.thud(110, 0.25, 0.5, 0.35), fx.whoosh(400, 1500, 0.5, 0.12, 0.4)]),
  sp2: r(() => [...[0, 0.12, 0.26].map((t) => fx.thud(55, 0.5, 0.55, t)), noise(0.8, 0.12, { type: "lowpass", freq: 900, to: 100 }), { inst: "whistle", note: "C6", dur: 0.3, at: 0.5, gain: 0.5 }]),
  sp3: r(() => [{ wave: "sawtooth", freq: 60, dur: 1.4, peak: 0.07, tremolo: 22, filter: { type: "lowpass", freq: 500 } }, { wave: "sine", freq: 1800, to: 500, glide: 1.0, dur: 1.1, peak: 0.06, at: 0.3 }]),
  sp4: r(() => [{ wave: "sawtooth", freq: 80, to: 2400, glide: 0.5, dur: 0.55, peak: 0.08, filter: { type: "lowpass", freq: 800, to: 8000 } }, noise(0.6, 0.18, { type: "highpass", freq: 1500, to: 300 }, 0.45), fx.thud(45, 0.9, 0.7, 0.45), { wave: "square", freq: 60, dur: 0.6, peak: 0.05, at: 0.5, tremolo: 50 }]),
  thunder: r(() => [noise(0.5, 0.18, { type: "lowpass", freq: 5000, to: 200 }), fx.thud(60, 0.4, 0.4)]),

  // match
  start: r(() => [...fx.arp("brass", ["G3", "C4", "E4", "G4"], 0.14, 0.4, 0.8), { inst: "taiko", note: "C2", at: 0.56, dur: 0.6 }]),
  suddenDeath: r(() => [{ inst: "gong", note: "C2", dur: 3 }, { inst: "gong", note: "G1", at: 0.5, dur: 3 }]),
  victory: r(() => [...fx.arp("brass", ["C4", "E4", "G4", "C5"], 0.13, 0.6, 1), ...fx.chord("brass", ["C4", "E4", "G4", "C5"], 1.6, 0.9, 0.6), ...fx.arp("bell", ["C6", "E6", "G6", "C7"], 0.09, 1, 0.5)]),
  defeat: r(() => [...fx.arp("brass", ["G3", "Eb3", "C3"], 0.32, 0.7, 0.9), { inst: "gong", note: "C2", at: 0.9, dur: 3 }]),
  pause: r(() => [fx.click(900, 0.1), fx.click(600, 0.08, 0.06)]),
};

const SUITES: SuiteConfig[] = [
  { bpm: 100, tracks: ERA0, sfx: SFX, sfxLevel: 0.62 },
  { bpm: 108, tracks: ERA1, sfx: {} },
  { bpm: 126, tracks: ERA2, sfx: {}, swing: 0.28 },
  { bpm: 116, tracks: ERA3, sfx: {} },
  { bpm: 138, tracks: ERA4, sfx: {} },
];

export const ERA_MARCH_BGM_TRACKS = SUITES.map((s) => s.tracks);
export const ERA_MARCH_SFX_NAMES = Object.keys(SFX);
const getters = SUITES.map((cfg) => defineSuite(cfg));
export const eraSuite = (era: Era): ProceduralSuite => getters[era]();
const sfxSuite = () => getters[0]();

export function playCue(name: string, gain = 1) {
  sfxSuite().play(name, gain);
}

export function unlockAudio() {
  for (const g of getters) g().unlock();
}

/* ── event → cue mapping ─────────────────────────────────────────────── */

const MELEE: Partial<Record<Fx, string>> = { club: "hit_blunt", gore: "hit_trample", trample: "hit_trample", ram: "hit_trample", sword: "hit_blade", blade: "hit_blade", bayonet: "hit_metal", zap: "hit_zap" };
const FIRE: Partial<Record<Fx, string>> = { stone: "fire_sling", arrow: "fire_bow", musket: "fire_musket", rifle: "fire_rifle", shell: "fire_cannon", bomb: "fire_throw", plasma: "fire_plasma", rail: "fire_rail", heal: "heal", zap: "fire_tesla", boulder: "fire_throw" };
const IMPACT: Partial<Record<Fx, string>> = { arrow: "imp_arrow", stone: "imp_stone", musket: "imp_bullet", rifle: "imp_bullet", bomb: "boom", shell: "boom", plasma: "hit_zap", rail: "hit_zap", zap: "hit_zap", boulder: "boom" };

/** Min ms between two plays of a cue. */
const GAP: Record<string, number> = { hit: 55, fire: 60, impact: 70, death: 90, gold: 80, base_hit: 140, boom: 110, counter: 160, alarm: 6000, heal: 300 };

export class EraMarchSound {
  private last = new Map<string, number>();
  private budget = 0;
  private budgetAt = 0;

  /** `view` = camera centre/half-width in lane units; `viewer` = this device's side. */
  handle(events: readonly FxEvent[], view: { center: number; half: number }, viewer: Side, nowMs: number) {
    if (nowMs - this.budgetAt > 100) {
      this.budget = 0;
      this.budgetAt = nowMs;
    }
    const near = (x: number) => {
      const d = Math.abs(x - view.center) - view.half;
      return d <= 0 ? 1 : Math.max(0.15, 1 - d / (view.half * 1.4));
    };
    const play = (name: string, gain: number, group = name, busy = false) => {
      if (gain < 0.05) return;
      const gap = GAP[group] ?? 0;
      const t = this.last.get(group) ?? -1e9;
      if (nowMs - t < gap) return;
      if (busy) {
        if (this.budget >= 5) return;
        this.budget++;
      }
      this.last.set(group, nowMs);
      sfxSuite().play(name, Math.min(1, gain));
    };
    for (const e of events) {
      switch (e.t) {
        case "train":
          if (e.side === viewer) play("buy", 1);
          break;
        case "cancel":
          if (e.side === viewer) play("cancel", 1);
          break;
        case "reject":
          if (e.side === viewer) play("reject", 1);
          break;
        case "spawn":
          play(`spawn${UNITS[e.kind].era}`, e.side === viewer ? 0.8 : 0.35, `spawn${e.side}`);
          break;
        case "swing":
          break;
        case "shot": {
          const n = FIRE[e.fx];
          if (n) play(n, near(e.from) * (e.side === viewer ? 0.75 : 0.55), `fire-${n}`, true);
          break;
        }
        case "hit": {
          if (e.base) {
            play("base_hit", e.side === viewer ? 1 : 0.6, "base_hit");
            if (e.side === viewer) play("alarm", 0.8, "alarm");
            break;
          }
          if (e.dmg <= 0) break;
          const n = MELEE[e.fx] ?? IMPACT[e.fx];
          if (n) play(n, near(e.x) * 0.7, n === "boom" ? "boom" : `hit-${n}`, true);
          if (e.mul > 1) play("counter", near(e.x) * 0.6, "counter");
          break;
        }
        case "death":
          play(UNITS[e.kind].size >= 1.35 ? "death_big" : "death", near(e.x) * 0.8, "death", true);
          break;
        case "bounty":
          if (e.side === viewer) play("gold", near(e.x) * 0.7, "gold");
          break;
        case "steal":
          play("steal", 0.7, "steal");
          break;
        case "heal":
          play("heal", near(e.x) * 0.5, "heal");
          break;
        case "evolve":
          play(`evolve${e.era}`, e.side === viewer ? 1 : 0.7, `evolve${e.side}`);
          if (e.doctrine && e.side === viewer) play("doctrine", 0.6, "doctrine");
          break;
        case "special":
          play(`sp${e.era}`, 1, `sp${e.side}`);
          break;
        case "strike":
          play(e.era === 4 ? "thunder" : "boom", near(e.x), e.era === 4 ? "thunder" : "boom");
          break;
        case "turret":
          play("turret", e.side === viewer ? 1 : 0.4, `turret${e.side}`);
          break;
        case "sell":
          if (e.side === viewer) play("sell", 1);
          break;
        case "slot":
          if (e.side === viewer) play("slot", 1);
          break;
        case "augOffer":
          if (e.side === viewer) play("specialReady", 1, "augOffer");
          break;
        case "augment":
          if (e.side === viewer) play("doctrine", 0.9, "augment");
          break;
        case "revive":
          play("heal", near(e.x) * 0.8, "revive");
          break;
        case "specialReady":
          if (e.side === viewer) play("specialReady", 0.8);
          break;
        case "suddenDeath":
          play("suddenDeath", 1);
          break;
        case "end":
          play(e.winner === viewer ? "victory" : "defeat", 1, "end");
          break;
      }
    }
  }
}
