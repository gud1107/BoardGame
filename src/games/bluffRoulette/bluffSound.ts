import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";

/**
 * 블러프 룰렛 procedural audio (rulebook §U) — an underground-lounge jazz
 * loop (walking upright bass + brushed snare + soft Rhodes stabs) and the
 * table SFX: card slides, the "거짓말!" table slam, per-card reveal
 * chime/buzzer, the cylinder spin, the dry click, the gunshot and the skull
 * organ. All Web Audio, no files; mute/volume follow the site-wide audio
 * settings store, same as coyoteSound.ts.
 */

type Bus = "sfx" | "bgm";
const BGM_LEVEL = 0.1 / 0.4;
const SFX_LEVEL = 0.4 / 0.7;
const BPM = 92;
const EIGHTH_S = 60 / BPM / 2;
const LOOKAHEAD_S = 0.15;

// Am7 – D7 – Gmaj7 – E7, one bar each, 8 eighths per bar.
const BARS: { root: number; chord: number[]; walk: number[] }[] = [
  { root: 45, chord: [57, 60, 64, 67], walk: [45, 48, 52, 55] },
  { root: 50, chord: [57, 60, 62, 66], walk: [50, 54, 57, 56] },
  { root: 43, chord: [55, 59, 62, 66], walk: [43, 47, 50, 52] },
  { root: 40, chord: [56, 59, 62, 64], walk: [40, 44, 47, 46] },
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class BluffSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private tension = 0;

  private settings(): AudioSettings {
    return useAudioSettingsStore.getState();
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(comp);
    this.bgmBus = ctx.createGain();
    this.bgmBus.connect(comp);
    const len = Math.floor(ctx.sampleRate * 1.2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.apply(this.settings());
    useAudioSettingsStore.subscribe((s) => this.apply(s));
    return ctx;
  }

  private apply(s: AudioSettings) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.bgmBus) return;
    this.sfxBus.gain.setTargetAtTime(isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume * SFX_LEVEL, ctx.currentTime, 0.02);
    this.bgmBus.gain.setTargetAtTime(isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * BGM_LEVEL, ctx.currentTime, 0.1);
    this.syncBgm();
  }

  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  private ready(bus: Bus): AudioContext | null {
    const s = this.settings();
    if (bus === "sfx" ? isSfxEffectivelyMuted(s) : isBgmEffectivelyMuted(s)) return null;
    const ctx = this.ensure();
    return ctx && ctx.state === "running" ? ctx : null;
  }

  private tone(
    ctx: AudioContext,
    dest: AudioNode,
    o: { type: OscillatorType; freq: number; to?: number; t: number; dur: number; peak: number; attack?: number; lp?: number },
  ) {
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.linearRampToValueAtTime(o.peak, o.t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    let head: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(o.lp, o.t);
      osc.connect(f);
      head = f;
    }
    head.connect(g).connect(dest);
    osc.start(o.t);
    osc.stop(o.t + o.dur + 0.02);
  }

  private hiss(ctx: AudioContext, dest: AudioNode, o: { t: number; dur: number; peak: number; type: BiquadFilterType; freq: number; to?: number; q?: number; attack?: number }) {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, o.t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
    if (o.q !== undefined) f.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.linearRampToValueAtTime(o.peak, o.t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(o.t, Math.random() * 0.5, o.dur + 0.02);
  }

  /* ── SFX ── */

  /** Cards sliding onto the felt, one swish per card. */
  cardSlide(count: number) {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * 0.09;
      this.hiss(ctx, this.sfxBus, { t, dur: 0.12, peak: 0.35, type: "bandpass", freq: 2600, to: 900, q: 0.8 });
      this.tone(ctx, this.sfxBus, { type: "sine", freq: 180, t: t + 0.08, dur: 0.06, peak: 0.12 });
    }
  }

  /** "거짓말!" — palm slam on the table + a short tense diminished stab. */
  liar() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 120, to: 45, t, dur: 0.35, peak: 0.9 });
    this.hiss(ctx, this.sfxBus, { t, dur: 0.18, peak: 0.5, type: "lowpass", freq: 900 });
    for (const n of [58, 61, 64, 67]) this.tone(ctx, this.sfxBus, { type: "sawtooth", freq: midi(n), t: t + 0.12, dur: 0.6, peak: 0.06, lp: 1800 });
  }

  /** One card turned face up: bright chime if true, low buzzer if fake. */
  flip(truthful: boolean) {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.07, peak: 0.25, type: "highpass", freq: 3000 });
    if (truthful) {
      this.tone(ctx, this.sfxBus, { type: "triangle", freq: midi(84), t: t + 0.03, dur: 0.5, peak: 0.18 });
      this.tone(ctx, this.sfxBus, { type: "sine", freq: midi(91), t: t + 0.05, dur: 0.4, peak: 0.08 });
    } else {
      this.tone(ctx, this.sfxBus, { type: "square", freq: 110, t: t + 0.03, dur: 0.35, peak: 0.12, lp: 700 });
    }
  }

  /** Cylinder spin — a decelerating ratchet. */
  spin() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    let t = ctx.currentTime;
    for (let i = 0; i < 14; i++) {
      this.hiss(ctx, this.sfxBus, { t, dur: 0.025, peak: 0.3, type: "bandpass", freq: 4200, q: 6 });
      t += 0.035 + i * 0.008;
    }
  }

  /** Cylinder swung out — a light metallic unlatch. */
  cylinderOpen() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.05, peak: 0.4, type: "bandpass", freq: 3600, q: 5 });
    this.tone(ctx, this.sfxBus, { type: "triangle", freq: 1900, to: 1400, t: t + 0.02, dur: 0.12, peak: 0.06 });
  }

  /** Exactly one notch of the cylinder (no free spin — the rulebook never reloads). */
  notch() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.03, peak: 0.55, type: "bandpass", freq: 4400, q: 7 });
    this.hiss(ctx, this.sfxBus, { t: t + 0.06, dur: 0.025, peak: 0.35, type: "bandpass", freq: 3000, q: 6 });
  }

  /** Cylinder flicked shut. */
  cylinderClose() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.06, peak: 0.6, type: "bandpass", freq: 2200, q: 3 });
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 420, to: 260, t, dur: 0.08, peak: 0.12 });
  }

  /** A double heartbeat thump while the trigger is held. */
  heartbeat() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 62, to: 44, t, dur: 0.18, peak: 0.85 });
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 58, to: 42, t: t + 0.22, dur: 0.16, peak: 0.6 });
  }

  /** Soft pop for an emote bubble. */
  emotePop() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 620, to: 980, t, dur: 0.12, peak: 0.12 });
  }

  /** Hammer cock before the pull. */
  cock() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.04, peak: 0.45, type: "bandpass", freq: 3200, q: 4 });
    this.hiss(ctx, this.sfxBus, { t: t + 0.09, dur: 0.05, peak: 0.55, type: "bandpass", freq: 2400, q: 5 });
  }

  /** Empty chamber — dry click + a relieved exhale. */
  click() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.035, peak: 0.7, type: "bandpass", freq: 5200, q: 3 });
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 900, to: 500, t, dur: 0.05, peak: 0.15 });
    this.hiss(ctx, this.sfxBus, { t: t + 0.35, dur: 0.7, peak: 0.08, type: "bandpass", freq: 700, q: 0.5, attack: 0.15 });
  }

  /** Live round — the bang and a room-sized tail. */
  bang() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.hiss(ctx, this.sfxBus, { t, dur: 0.08, peak: 1, type: "highpass", freq: 600 });
    this.hiss(ctx, this.sfxBus, { t, dur: 1.1, peak: 0.6, type: "lowpass", freq: 2400, to: 200 });
    this.tone(ctx, this.sfxBus, { type: "sine", freq: 95, to: 30, t, dur: 0.6, peak: 0.9 });
  }

  /** 💀 Skull — a low minor organ chord. */
  skull() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    for (const n of [36, 43, 48, 51, 55]) this.tone(ctx, this.sfxBus, { type: "sawtooth", freq: midi(n), t, dur: 2.2, peak: 0.07, attack: 0.15, lp: 1200 });
  }

  /** Short sting when a player is out / the game ends. */
  victory() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [67, 71, 74, 79].forEach((n, i) => this.tone(ctx, this.sfxBus!, { type: "triangle", freq: midi(n), t: t + i * 0.12, dur: 0.8, peak: 0.16 }));
  }

  /* ── BGM ── */

  /** 0..1 — raises hi-hat density and filters open as danger rises. */
  setTension(v: number) {
    this.tension = Math.max(0, Math.min(1, v));
  }

  startBgm() {
    this.bgmWanted = true;
    this.syncBgm();
  }

  stopBgm() {
    this.bgmWanted = false;
    this.syncBgm();
  }

  private syncBgm() {
    const ctx = this.ready("bgm");
    const shouldRun = this.bgmWanted && !!ctx;
    if (shouldRun && !this.bgmTimer && ctx) {
      this.nextTime = ctx.currentTime + 0.1;
      this.step = 0;
      this.bgmTimer = setInterval(() => this.schedule(), 40);
    } else if (!shouldRun && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.bgmBus) return;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // tab was throttled: rejoin the beat
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(ctx, this.bgmBus, this.step, this.nextTime);
      this.nextTime += EIGHTH_S * (this.step % 2 === 0 ? 1.18 : 0.82); // swing
      this.step = (this.step + 1) % (BARS.length * 8);
    }
  }

  private playStep(ctx: AudioContext, bus: AudioNode, step: number, t: number) {
    const bar = BARS[Math.floor(step / 8)];
    const e = step % 8;
    if (e % 2 === 0) {
      const note = bar.walk[e / 2];
      this.tone(ctx, bus, { type: "triangle", freq: midi(note), t, dur: EIGHTH_S * 1.8, peak: 0.5, lp: 600 });
    }
    // brushed snare on 2 and 4, swish on every eighth when tense
    if (e === 2 || e === 6) this.hiss(ctx, bus, { t, dur: 0.22, peak: 0.16, type: "bandpass", freq: 2500, q: 0.6, attack: 0.02 });
    if (this.tension > 0.4 || e % 2 === 0) this.hiss(ctx, bus, { t, dur: 0.05, peak: 0.05 + this.tension * 0.05, type: "highpass", freq: 7000 });
    // Rhodes comp on the "and" of 1 and on 4
    if (e === 1 || e === 6) {
      for (const n of bar.chord) this.tone(ctx, bus, { type: "sine", freq: midi(n), t, dur: 0.5, peak: 0.07, lp: 1400 + this.tension * 1600 });
    }
  }
}

let instance: BluffSound | null = null;
export function getBluffSound(): BluffSound {
  if (!instance) instance = new BluffSound();
  return instance;
}
