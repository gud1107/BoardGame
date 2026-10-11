import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "./audioSettings";
import { compileScore, eventsAt, noteToFreq, type CompiledTrack, type ScoreTrack } from "./proceduralScore";

/**
 * Shared procedural BGM + SFX engine for the games that had no sound suite
 * of their own (2026-10-11). Same rules as the hand-built suites
 * (coyoteSound.ts, ratSound.ts, …): pure Web Audio synthesis, no audio files;
 * mute/volume follow the site-wide audio settings store; the BGM rides a
 * look-ahead scheduler on `AudioContext.currentTime` so a throttled tab
 * rejoins the beat instead of bursting.
 *
 * What's different: each game only supplies data — a score (proceduralScore.ts
 * DSL), its instrument picks from the `INSTRUMENTS` library below (or its own
 * layers), and SFX recipes — and every suite shares one AudioContext, so
 * moving between games never piles up contexts.
 *
 * Signal flow: voices → suite bgmBus / sfxBus → shared compressor → speakers.
 */

/** One synthesized layer. In an instrument, `freq`/`to` are ratios of the note's pitch (drums: absolute Hz, since a hit's pitch is 1). In an SFX, absolute Hz. */
export interface Layer {
  wave: OscillatorType | "noise";
  freq?: number;
  /** Glide target (same unit as `freq`). */
  to?: number;
  glide?: number;
  /** Start offset in seconds. */
  at?: number;
  attack?: number;
  /** Seconds. With `hold`, a multiplier of the note's length instead. */
  dur: number;
  hold?: boolean;
  peak: number;
  detune?: number;
  /** `track`: the filter frequency is a ratio of the note's pitch too. */
  filter?: { type: BiquadFilterType; freq: number; q?: number; to?: number; track?: boolean };
  vibrato?: { rate: number; depth: number };
  /** Square-wave amplitude chop rate in Hz (rattles, mandolin tremolo). */
  tremolo?: number;
}

export type Instrument = Layer[];

/** An SFX step: a raw layer, or an instrument note played at `at` seconds for `dur` seconds. */
export type SfxPart = Layer | { inst: string; note: string | number; at?: number; dur?: number; gain?: number };
export type SfxRecipe = SfxPart[] | ((arg: number) => SfxPart[]);

export interface SuiteConfig {
  bpm: number;
  tracks: ScoreTrack[];
  sfx: Record<string, SfxRecipe>;
  /** Extra / overriding instruments for this game. */
  instruments?: Record<string, Instrument>;
  /** 0–0.4: delays every off-beat sixteenth by this fraction of a sixteenth. */
  swing?: number;
  /** Bus gain at slider = 1. Defaults land the default sliders (0.4 / 0.7) on 0.1 / 0.38. */
  bgmLevel?: number;
  sfxLevel?: number;
}

/* ── Instrument library ─────────────────────────────────────────────────── */

const lp = (freq: number, to?: number, q?: number) => ({ type: "lowpass" as const, freq, to, q, track: true });

export const INSTRUMENTS: Record<string, Instrument> = {
  // Keys
  piano: [
    { wave: "triangle", dur: 1.1, peak: 0.22, attack: 0.003 },
    { wave: "sine", freq: 2, dur: 0.35, peak: 0.06, attack: 0.002 },
    { wave: "sawtooth", dur: 0.25, peak: 0.03, filter: lp(3, 1) },
  ],
  epiano: [
    { wave: "sine", dur: 1.3, peak: 0.24, attack: 0.004 },
    { wave: "sine", freq: 4, dur: 0.18, peak: 0.05, attack: 0.002 },
    { wave: "triangle", freq: 1.003, dur: 1.0, peak: 0.06 },
  ],
  harpsichord: [
    { wave: "sawtooth", dur: 0.55, peak: 0.1, attack: 0.002, filter: { type: "highpass", freq: 0.8, track: true } },
    { wave: "square", freq: 2, dur: 0.22, peak: 0.035, attack: 0.001 },
  ],
  organ: [
    { wave: "sine", hold: true, dur: 0.95, peak: 0.12, attack: 0.02 },
    { wave: "sine", freq: 2, hold: true, dur: 0.95, peak: 0.06, attack: 0.02 },
    { wave: "sine", freq: 3, hold: true, dur: 0.9, peak: 0.03, attack: 0.02 },
  ],
  // Plucked
  pluck: [
    { wave: "triangle", dur: 0.4, peak: 0.24, attack: 0.002 },
    { wave: "sawtooth", dur: 0.18, peak: 0.06, filter: lp(4, 1) },
  ],
  guitar: [
    { wave: "sawtooth", dur: 0.6, peak: 0.12, attack: 0.003, filter: lp(5, 1.2, 1) },
    { wave: "triangle", dur: 0.5, peak: 0.12, attack: 0.002 },
  ],
  harp: [
    { wave: "triangle", dur: 1.5, peak: 0.22, attack: 0.003 },
    { wave: "sine", freq: 2, dur: 0.45, peak: 0.06 },
  ],
  koto: [
    { wave: "sawtooth", freq: 1.01, to: 1, glide: 0.04, dur: 0.8, peak: 0.12, attack: 0.002, filter: lp(7, 1.4, 2) },
    { wave: "triangle", dur: 0.6, peak: 0.12 },
  ],
  lute: [
    { wave: "sawtooth", dur: 0.5, peak: 0.12, attack: 0.002, filter: { type: "bandpass", freq: 2.5, q: 1.5, track: true } },
    { wave: "triangle", freq: 2, dur: 0.12, peak: 0.07 },
    { wave: "triangle", dur: 0.45, peak: 0.1 },
  ],
  oud: [
    { wave: "sawtooth", freq: 1.015, to: 1, glide: 0.03, dur: 0.55, peak: 0.13, attack: 0.002, filter: lp(4, 1, 3) },
    { wave: "triangle", dur: 0.4, peak: 0.12 },
  ],
  mandolin: [
    { wave: "triangle", hold: true, dur: 1, peak: 0.16, attack: 0.002, tremolo: 13 },
    { wave: "sawtooth", hold: true, dur: 1, peak: 0.05, tremolo: 13, filter: lp(4) },
  ],
  kalimba: [
    { wave: "sine", dur: 0.7, peak: 0.24, attack: 0.002 },
    { wave: "sine", freq: 5.4, dur: 0.06, peak: 0.06, attack: 0.001 },
  ],
  pizz: [
    { wave: "triangle", dur: 0.22, peak: 0.24, attack: 0.002 },
    { wave: "sine", dur: 0.3, peak: 0.12 },
  ],
  // Mallets & bells
  marimba: [
    { wave: "sine", dur: 0.4, peak: 0.28, attack: 0.002 },
    { wave: "sine", freq: 4, dur: 0.05, peak: 0.08, attack: 0.001 },
  ],
  vibes: [
    { wave: "sine", dur: 1.4, peak: 0.2, attack: 0.003, tremolo: 5 },
    { wave: "sine", freq: 4, dur: 0.12, peak: 0.04 },
  ],
  glock: [
    { wave: "sine", dur: 0.9, peak: 0.16, attack: 0.001 },
    { wave: "sine", freq: 2.76, dur: 0.3, peak: 0.06 },
  ],
  musicbox: [
    { wave: "sine", dur: 1.1, peak: 0.18, attack: 0.001 },
    { wave: "sine", freq: 3, dur: 0.3, peak: 0.05 },
    { wave: "sine", freq: 5.4, dur: 0.1, peak: 0.03 },
  ],
  bell: [
    { wave: "sine", dur: 2.2, peak: 0.16, attack: 0.002 },
    { wave: "sine", freq: 2.4, dur: 1.1, peak: 0.07 },
    { wave: "sine", freq: 5.95, dur: 0.4, peak: 0.03 },
  ],
  // Bass
  bass: [
    { wave: "sine", hold: true, dur: 0.95, peak: 0.32, attack: 0.006 },
    { wave: "triangle", hold: true, dur: 0.8, peak: 0.1, filter: lp(3) },
  ],
  upright: [
    { wave: "triangle", dur: 0.55, peak: 0.3, attack: 0.004, filter: lp(4, 1.5) },
    { wave: "sine", dur: 0.5, peak: 0.2 },
  ],
  synthBass: [
    { wave: "sawtooth", hold: true, dur: 0.9, peak: 0.14, attack: 0.004, filter: lp(6, 1.5, 4) },
    { wave: "sine", hold: true, dur: 0.9, peak: 0.22 },
  ],
  sub808: [{ wave: "sine", freq: 1.5, to: 1, glide: 0.05, hold: true, dur: 1, peak: 0.42, attack: 0.003 }],
  // Sustained
  pad: [
    { wave: "sawtooth", detune: -9, hold: true, dur: 1, peak: 0.05, attack: 0.35, filter: lp(3) },
    { wave: "sawtooth", detune: 9, hold: true, dur: 1, peak: 0.05, attack: 0.35, filter: lp(3) },
    { wave: "triangle", freq: 0.5, hold: true, dur: 1, peak: 0.06, attack: 0.4 },
  ],
  strings: [
    { wave: "sawtooth", detune: -6, hold: true, dur: 1, peak: 0.06, attack: 0.15, vibrato: { rate: 5, depth: 0.004 }, filter: lp(4) },
    { wave: "sawtooth", detune: 6, hold: true, dur: 1, peak: 0.06, attack: 0.18, filter: lp(4) },
  ],
  choir: [
    { wave: "triangle", hold: true, dur: 1, peak: 0.1, attack: 0.3, vibrato: { rate: 4.5, depth: 0.005 } },
    { wave: "sawtooth", hold: true, dur: 1, peak: 0.03, attack: 0.3, filter: { type: "bandpass", freq: 800, q: 4 } },
  ],
  brass: [
    { wave: "sawtooth", hold: true, dur: 0.95, peak: 0.12, attack: 0.04, filter: lp(2, 6, 1) },
    { wave: "square", freq: 0.5, hold: true, dur: 0.9, peak: 0.03, attack: 0.05, filter: lp(3) },
  ],
  stab: [{ wave: "sawtooth", dur: 0.22, peak: 0.1, attack: 0.003, filter: lp(6, 1.2, 2) }],
  // Winds & leads
  flute: [
    { wave: "sine", hold: true, dur: 1, peak: 0.2, attack: 0.06, vibrato: { rate: 5, depth: 0.008 } },
    { wave: "noise", hold: true, dur: 1, peak: 0.012, attack: 0.05, filter: { type: "bandpass", freq: 2, q: 5, track: true } },
  ],
  recorder: [{ wave: "triangle", hold: true, dur: 1, peak: 0.2, attack: 0.04, vibrato: { rate: 5.5, depth: 0.006 } }],
  shakuhachi: [
    { wave: "sine", freq: 0.96, to: 1, glide: 0.12, hold: true, dur: 1, peak: 0.2, attack: 0.1, vibrato: { rate: 4.5, depth: 0.012 } },
    { wave: "noise", hold: true, dur: 1, peak: 0.03, attack: 0.08, filter: { type: "bandpass", freq: 2, q: 3, track: true } },
  ],
  whistle: [{ wave: "sine", freq: 0.97, to: 1, glide: 0.05, hold: true, dur: 1, peak: 0.2, attack: 0.05, vibrato: { rate: 5.5, depth: 0.01 } }],
  lead: [{ wave: "sawtooth", hold: true, dur: 1, peak: 0.08, attack: 0.01, vibrato: { rate: 5.5, depth: 0.006 }, filter: lp(5, 2, 2) }],
  chip: [{ wave: "square", hold: true, dur: 0.9, peak: 0.07, attack: 0.002 }],
  chipBass: [{ wave: "triangle", hold: true, dur: 0.9, peak: 0.3, attack: 0.002 }],
  arp: [{ wave: "square", dur: 0.16, peak: 0.07, attack: 0.002, filter: lp(5, 1.5) }],
  // Drums (absolute Hz: a hit's pitch ratio is 1)
  kick: [
    { wave: "sine", freq: 150, to: 45, glide: 0.12, dur: 0.32, peak: 0.6, attack: 0.002 },
    { wave: "noise", dur: 0.02, peak: 0.08, filter: { type: "lowpass", freq: 2000 } },
  ],
  softKick: [{ wave: "sine", freq: 110, to: 50, glide: 0.1, dur: 0.25, peak: 0.35, attack: 0.003 }],
  snare: [
    { wave: "noise", dur: 0.18, peak: 0.24, filter: { type: "bandpass", freq: 1800, q: 0.8 } },
    { wave: "triangle", freq: 200, to: 160, glide: 0.05, dur: 0.1, peak: 0.18 },
  ],
  clap: [
    { wave: "noise", dur: 0.03, peak: 0.18, filter: { type: "bandpass", freq: 1200, q: 1 } },
    { wave: "noise", at: 0.012, dur: 0.03, peak: 0.18, filter: { type: "bandpass", freq: 1200, q: 1 } },
    { wave: "noise", at: 0.024, dur: 0.16, peak: 0.2, filter: { type: "bandpass", freq: 1200, q: 1 } },
  ],
  rim: [
    { wave: "sine", freq: 1700, dur: 0.03, peak: 0.14, attack: 0.001 },
    { wave: "triangle", freq: 480, dur: 0.04, peak: 0.12, attack: 0.001 },
  ],
  hat: [{ wave: "noise", dur: 0.04, peak: 0.08, filter: { type: "highpass", freq: 7000 } }],
  openHat: [{ wave: "noise", dur: 0.25, peak: 0.06, filter: { type: "highpass", freq: 6500 } }],
  ride: [
    { wave: "noise", dur: 0.45, peak: 0.04, filter: { type: "highpass", freq: 5000 } },
    { wave: "square", freq: 5200, dur: 0.3, peak: 0.008 },
  ],
  brush: [{ wave: "noise", dur: 0.14, peak: 0.05, attack: 0.03, filter: { type: "bandpass", freq: 3000, q: 0.7 } }],
  shaker: [{ wave: "noise", dur: 0.05, peak: 0.05, attack: 0.01, filter: { type: "highpass", freq: 6000 } }],
  tom: [{ wave: "sine", freq: 180, to: 110, glide: 0.15, dur: 0.3, peak: 0.35, attack: 0.002 }],
  taiko: [
    { wave: "sine", freq: 95, to: 55, glide: 0.2, dur: 0.6, peak: 0.55, attack: 0.003 },
    { wave: "noise", dur: 0.08, peak: 0.12, filter: { type: "lowpass", freq: 500 } },
  ],
  timpani: [
    { wave: "sine", dur: 1.2, peak: 0.4, attack: 0.004 },
    { wave: "noise", dur: 0.1, peak: 0.08, filter: { type: "lowpass", freq: 400 } },
  ],
  doum: [{ wave: "sine", freq: 120, to: 75, glide: 0.1, dur: 0.28, peak: 0.4, attack: 0.002 }],
  tek: [
    { wave: "noise", dur: 0.04, peak: 0.1, filter: { type: "highpass", freq: 3000 } },
    { wave: "sine", freq: 820, dur: 0.03, peak: 0.08 },
  ],
  woodblock: [{ wave: "sine", freq: 820, to: 600, glide: 0.03, dur: 0.05, peak: 0.2, attack: 0.001 }],
  tick: [
    { wave: "sine", freq: 2600, dur: 0.018, peak: 0.1, attack: 0.001 },
    { wave: "noise", dur: 0.01, peak: 0.04, filter: { type: "highpass", freq: 5000 } },
  ],
  tock: [{ wave: "sine", freq: 1500, dur: 0.025, peak: 0.1, attack: 0.001 }],
  triangle: [{ wave: "sine", freq: 4200, dur: 0.7, peak: 0.04, attack: 0.001 }],
  gong: [
    { wave: "sine", freq: 82, dur: 3, peak: 0.2, attack: 0.01 },
    { wave: "sine", freq: 197, dur: 2, peak: 0.08, attack: 0.02 },
    { wave: "sine", freq: 311, dur: 1.4, peak: 0.05, attack: 0.03 },
  ],
  chipNoise: [{ wave: "noise", dur: 0.05, peak: 0.08, filter: { type: "highpass", freq: 2500 } }],
  crackle: [{ wave: "noise", dur: 0.01, peak: 0.03, filter: { type: "highpass", freq: 3000 } }],
};

/* ── Shared context ─────────────────────────────────────────────────────── */

let sharedCtx: AudioContext | null = null;
let sharedOut: AudioNode | null = null;
let sharedNoise: AudioBuffer | null = null;

function sharedContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 20;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 1.5);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  sharedCtx = ctx;
  sharedOut = comp;
  sharedNoise = noise;
  // Any tap/key anywhere resumes the context (browser autoplay policy), so a
  // board never has to remember to unlock it before its BGM can start.
  const resume = () => {
    if (ctx.state === "suspended") void ctx.resume();
  };
  window.addEventListener("pointerdown", resume, { capture: true });
  window.addEventListener("keydown", resume, { capture: true });
  return ctx;
}

const LOOKAHEAD_S = 0.15;
const SCHEDULER_INTERVAL_MS = 40;

export class ProceduralSuite {
  private readonly score: CompiledTrack[];
  private readonly instruments: Record<string, Instrument>;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private intensity = 0;
  private tempo = 1;

  constructor(private readonly cfg: SuiteConfig) {
    this.score = compileScore(cfg.tracks);
    this.instruments = { ...INSTRUMENTS, ...cfg.instruments };
  }

  private settings(): AudioSettings {
    return useAudioSettingsStore.getState();
  }

  private ensure(): AudioContext | null {
    const ctx = sharedContext();
    if (!ctx || !sharedOut) return null;
    if (!this.sfxBus) {
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0;
      this.sfxBus.connect(sharedOut);
      this.bgmBus = ctx.createGain();
      this.bgmBus.gain.value = 0;
      this.bgmBus.connect(sharedOut);
      this.applySettings(this.settings());
      useAudioSettingsStore.subscribe((s) => this.applySettings(s));
    }
    return ctx;
  }

  private applySettings(s: AudioSettings) {
    const ctx = sharedCtx;
    if (!ctx || !this.sfxBus || !this.bgmBus) return;
    const t = ctx.currentTime;
    const sfxLevel = this.cfg.sfxLevel ?? 0.38 / 0.7;
    const bgmLevel = this.cfg.bgmLevel ?? 0.1 / 0.4;
    this.sfxBus.gain.setTargetAtTime(isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume * sfxLevel, t, 0.02);
    this.bgmBus.gain.setTargetAtTime(isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * bgmLevel, t, 0.1);
    this.syncBgm();
  }

  /** Call from a click/tap — resumes the context (browser autoplay policy). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    this.syncBgm();
  }

  /** The context, only when `bus` is audible — nothing is synthesized while muted. */
  private ready(bus: "sfx" | "bgm"): AudioContext | null {
    const s = this.settings();
    if (bus === "sfx" ? isSfxEffectivelyMuted(s) : isBgmEffectivelyMuted(s)) return null;
    const ctx = this.ensure();
    return ctx && ctx.state === "running" ? ctx : null;
  }

  private layer(ctx: AudioContext, dest: AudioNode, l: Layer, t0: number, pitch: number, holdS: number, gain: number) {
    const t = t0 + (l.at ?? 0);
    const dur = Math.max(0.02, l.hold ? holdS * l.dur : l.dur);
    const attack = Math.min(l.attack ?? 0.005, dur * 0.6);
    const peak = l.peak * gain;
    if (peak <= 0) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src: AudioScheduledSourceNode;
    let head: AudioNode;
    if (l.wave === "noise") {
      if (!sharedNoise) return;
      const n = ctx.createBufferSource();
      n.buffer = sharedNoise;
      n.loop = true;
      src = n;
      head = n;
    } else {
      const osc = ctx.createOscillator();
      osc.type = l.wave;
      const f = Math.min(20000, Math.max(10, (l.freq ?? 1) * pitch));
      osc.frequency.setValueAtTime(f, t);
      if (l.to) osc.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(10, l.to * pitch)), t + (l.glide ?? Math.min(dur, 0.3)));
      if (l.detune) osc.detune.setValueAtTime(l.detune, t);
      if (l.vibrato) {
        const lfo = ctx.createOscillator();
        lfo.frequency.setValueAtTime(l.vibrato.rate, t);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(f * l.vibrato.depth, t + Math.min(0.25, dur * 0.5));
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.02);
      }
      src = osc;
      head = osc;
    }
    if (l.filter) {
      const fl = ctx.createBiquadFilter();
      fl.type = l.filter.type;
      const scale = l.filter.track ? pitch : 1;
      fl.frequency.setValueAtTime(Math.min(20000, l.filter.freq * scale), t);
      if (l.filter.to) fl.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(20, l.filter.to * scale)), t + dur);
      if (l.filter.q !== undefined) fl.Q.setValueAtTime(l.filter.q, t);
      head.connect(fl);
      head = fl;
    }
    head.connect(g);
    if (l.tremolo) {
      const chop = ctx.createGain();
      chop.gain.setValueAtTime(0.5, t);
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.setValueAtTime(l.tremolo, t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0.5, t);
      lfo.connect(depth).connect(chop.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
      g.connect(chop).connect(dest);
    } else {
      g.connect(dest);
    }
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  private note(ctx: AudioContext, dest: AudioNode, inst: string, freq: number, t: number, holdS: number, gain: number) {
    const layers = this.instruments[inst];
    if (!layers) return;
    for (const l of layers) this.layer(ctx, dest, l, t, freq || 1, holdS, gain);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /** Plays the named SFX recipe now. `arg` is passed to function recipes (e.g. a bid size). Unknown names are a silent no-op. */
  play(name: string, arg = 0) {
    const recipe = this.cfg.sfx[name];
    if (!recipe) return;
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const parts = typeof recipe === "function" ? recipe(arg) : recipe;
    const t = ctx.currentTime + 0.01;
    for (const p of parts) {
      if ("inst" in p) {
        const freq = typeof p.note === "number" ? p.note : noteToFreq(p.note);
        this.note(ctx, this.sfxBus, p.inst, freq, t + (p.at ?? 0), p.dur ?? 0.3, p.gain ?? 1);
      } else {
        this.layer(ctx, this.sfxBus, p, t, 1, p.dur, 1);
      }
    }
  }

  /* ── BGM ─────────────────────────────────────────────────────────────── */

  /** Board mount/unmount or phase. Playback additionally needs BGM unmuted in the site settings. */
  setBgmWanted(wanted: boolean) {
    this.bgmWanted = wanted;
    if (wanted) this.ensure();
    this.syncBgm();
  }

  /** Tracks with `level` ≤ this join the mix (e.g. 1 = final round, 2 = sudden death). */
  setIntensity(level: number) {
    this.intensity = level;
  }

  /** Tempo multiplier (1 = the score's BPM). */
  setTempo(mult: number) {
    this.tempo = Math.min(2, Math.max(0.5, mult));
  }

  private syncBgm() {
    const ctx = sharedCtx;
    const on = this.bgmWanted && !!ctx && !!this.bgmBus && !isBgmEffectivelyMuted(this.settings());
    if (on && !this.bgmTimer) {
      this.nextStepTime = ctx!.currentTime + 0.1;
      this.step = 0;
      this.bgmTimer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    } else if (!on && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private schedule() {
    const ctx = sharedCtx;
    if (!ctx || ctx.state !== "running" || !this.bgmBus) return;
    const sixteenth = 60 / (this.cfg.bpm * this.tempo) / 4;
    if (this.nextStepTime < ctx.currentTime) this.nextStepTime = ctx.currentTime + 0.05; // tab was throttled — rejoin, don't burst
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      const swing = this.step % 2 === 1 ? (this.cfg.swing ?? 0) * sixteenth : 0;
      for (const e of eventsAt(this.score, this.step, this.intensity)) {
        this.note(ctx, this.bgmBus, e.voice, e.freq, this.nextStepTime + swing, e.steps * sixteenth, e.gain * (e.accent ? 1.35 : 1));
      }
      this.nextStepTime += sixteenth;
      this.step++;
    }
  }
}

/** Lazily-built singleton per game module. */
export function defineSuite(cfg: SuiteConfig): () => ProceduralSuite {
  let instance: ProceduralSuite | null = null;
  return () => (instance ??= new ProceduralSuite(cfg));
}

/* ── SFX helpers (absolute-Hz layers) ───────────────────────────────────── */

export const fx = {
  /** Rising/falling arpeggio of instrument notes, `gap` seconds apart. */
  arp(inst: string, notes: string[], gap = 0.07, dur = 0.5, gain = 1): SfxPart[] {
    return notes.map((note, i) => ({ inst, note, at: i * gap, dur, gain }));
  },
  /** All notes together. */
  chord(inst: string, notes: string[], dur = 0.8, gain = 1, at = 0): SfxPart[] {
    return notes.map((note) => ({ inst, note, at, dur, gain }));
  },
  /** Filtered noise sweep (whoosh / swish / sweep). */
  whoosh(from: number, to: number, dur = 0.25, peak = 0.14, at = 0): Layer {
    return { wave: "noise", at, dur, peak, attack: dur * 0.4, filter: { type: "bandpass", freq: from, to, q: 1.2 } };
  },
  /** Low body thump. */
  thud(freq = 140, dur = 0.25, peak = 0.45, at = 0): Layer {
    return { wave: "sine", freq, to: freq * 0.4, glide: dur * 0.6, dur, peak, at, attack: 0.002 };
  },
  /** Short click/tap. */
  click(freq = 1800, peak = 0.14, at = 0): Layer {
    return { wave: "sine", freq, to: freq * 0.6, glide: 0.02, dur: 0.035, peak, at, attack: 0.001 };
  },
  /** Card slide off a deck. */
  cardSlide(at = 0, peak = 0.12): Layer {
    return { wave: "noise", at, dur: 0.11, peak, attack: 0.02, filter: { type: "bandpass", freq: 2600, to: 4800, q: 0.9 } };
  },
  /** Metallic coin clink. */
  coin(at = 0, freq = 2400, peak = 0.12): Layer[] {
    return [
      { wave: "sine", freq, dur: 0.25, peak, at, attack: 0.001 },
      { wave: "sine", freq: freq * 1.47, dur: 0.16, peak: peak * 0.6, at, attack: 0.001 },
      { wave: "noise", dur: 0.02, peak: peak * 0.5, at, filter: { type: "highpass", freq: 6000 } },
    ];
  },
  /** Descending "wrong / lose" buzz. */
  buzz(from = 220, to = 110, dur = 0.35, peak = 0.14, at = 0): Layer {
    return { wave: "sawtooth", freq: from, to, glide: dur, dur, peak, at, attack: 0.01, filter: { type: "lowpass", freq: 1400 } };
  },
  /** Bright glide up (pop / select). */
  pop(from = 400, to = 900, peak = 0.22, at = 0): Layer {
    return { wave: "triangle", freq: from, to, glide: 0.06, dur: 0.1, peak, at, attack: 0.003 };
  },
  /** Gunshot / impact crack. */
  crack(at = 0, peak = 0.45): Layer[] {
    return [
      { wave: "noise", at, dur: 0.4, peak, attack: 0.002, filter: { type: "lowpass", freq: 5000, to: 300 } },
      { wave: "triangle", freq: 240, to: 50, glide: 0.3, dur: 0.35, peak: peak * 1.1, at, attack: 0.002 },
    ];
  },
};
