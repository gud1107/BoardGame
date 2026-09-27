import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { westernEventsAt, WESTERN_BPM, type CoyoteSoundCue, type WesternEvent } from "./coyoteWesternScore";

/**
 * 코요테 전용 procedural audio ("Coyote Sound Suite") — a spaghetti-western
 * banjo / whistle / woodblock BGM (score in coyoteWesternScore.ts) plus the
 * table SFX: a rising "call" pop per declaration (pitch climbs with the bid),
 * the "코요테!" revolver cock + gunshot + coyote howl, a sparkle chime for the
 * special cards (?, MAX→0, x2, 밤) and a wah-wah trombone for a lost heart.
 * All Web Audio, no audio files.
 *
 * Same structure as ratSound.ts / cucumberSound.ts, deliberately differing
 * from the brief in the same ways:
 *  - mute/volume come from the site-wide audio settings store (header
 *    🔇/🔊, settings-modal sliders, and this game's HUD always agree)
 *    instead of a private `isMuted`/`toggleMute`;
 *  - the BGM rides a look-ahead scheduler on `AudioContext.currentTime` via
 *    `setInterval`, rejoining the beat after a throttled tab instead of
 *    bursting to catch up.
 *
 * Signal flow: voices → bgmBus / sfxBus → master compressor → speakers.
 */

type Bus = "sfx" | "bgm";

/** Bus levels at slider = 1. Default sliders (bgm 0.4, sfx 0.7) land on the brief's 0.11 / 0.38. */
const BGM_LEVEL = 0.11 / 0.4;
const SFX_LEVEL = 0.38 / 0.7;
const LOOKAHEAD_S = 0.15;
const SCHEDULER_INTERVAL_MS = 40;
const SIXTEENTH_S = 60 / WESTERN_BPM / 4;

class CoyoteSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;

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

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(compressor);
    this.bgmBus = ctx.createGain();
    this.bgmBus.connect(compressor);

    // 0.6s of white noise, reused by the shaker, the rattlesnake, the whistle breath and the gunshot.
    const len = Math.floor(ctx.sampleRate * 0.6);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.applySettings(this.settings());
    useAudioSettingsStore.subscribe((s) => this.applySettings(s));
    return ctx;
  }

  private applySettings(s: AudioSettings) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.bgmBus) return;
    const t = ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume * SFX_LEVEL, t, 0.02);
    this.bgmBus.gain.setTargetAtTime(isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * BGM_LEVEL, t, 0.1);
    this.syncBgm();
  }

  /** Call from a click/tap — resumes the context (browser autoplay policy). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** The context, only when `bus` is audible — nothing is synthesized while muted. */
  private ready(bus: Bus): AudioContext | null {
    const s = this.settings();
    if (bus === "sfx" ? isSfxEffectivelyMuted(s) : isBgmEffectivelyMuted(s)) return null;
    const ctx = this.ensure();
    return ctx && ctx.state === "running" ? ctx : null;
  }

  /** One enveloped oscillator: optional pitch glide, optional vibrato, optional filter, linear attack → exponential release. */
  private voice(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      type: OscillatorType;
      freq: number;
      glideTo?: number;
      glideTime?: number;
      t: number;
      attack: number;
      dur: number;
      peak: number;
      vibrato?: { rate: number; depth: number };
      filter?: { type: BiquadFilterType; freq: number; q?: number; sweepTo?: number };
    },
  ) {
    const { t, dur } = opts;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + (opts.glideTime ?? Math.min(dur, 0.3)));
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(opts.vibrato.rate, t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(opts.freq * opts.vibrato.depth, t + Math.min(0.25, dur * 0.5)); // vibrato blooms in, like a real whistler
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.peak, t + opts.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter.type;
      f.frequency.setValueAtTime(opts.filter.freq, t);
      if (opts.filter.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.filter.sweepTo, t + dur);
      if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, t);
      osc.connect(f);
      head = f;
    }
    head.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A filtered burst from the shared noise buffer; `tremolo` chops it into a rattle. */
  private noiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    opts: { t: number; dur: number; peak: number; attack?: number; tremolo?: number; filter: { type: BiquadFilterType; freq: number; q?: number; sweepTo?: number } },
  ) {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter.type;
    f.frequency.setValueAtTime(opts.filter.freq, opts.t);
    if (opts.filter.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.filter.sweepTo, opts.t + opts.dur);
    if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, opts.t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, opts.t);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.t + (opts.attack ?? 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.dur);
    let tail: AudioNode = gain;
    if (opts.tremolo) {
      const chop = ctx.createGain();
      chop.gain.setValueAtTime(0.5, opts.t);
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.setValueAtTime(opts.tremolo, opts.t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0.5, opts.t);
      lfo.connect(depth).connect(chop.gain);
      lfo.start(opts.t);
      lfo.stop(opts.t + opts.dur + 0.02);
      gain.connect(chop);
      tail = chop;
    }
    src.connect(f).connect(gain);
    tail.connect(dest);
    src.start(opts.t, 0, opts.dur + 0.02);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /** Routes a `coyoteSoundCues` cue to its sting. */
  playCue(cue: CoyoteSoundCue) {
    if (cue.kind === "declare") this.declareNumber(cue.number);
    else this.callCoyote();
  }

  /** 🗣️ "15!" — the brief's 320→540Hz triangle pop, pitched up as the bid climbs (up to +½ octave at 40), with a woodblock knock under it. */
  declareNumber(number: number) {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const lift = 2 ** (Math.min(Math.max(number, 0), 40) / 80);
    this.voice(ctx, this.sfxBus, { type: "triangle", freq: 320 * lift, glideTo: 540 * lift, glideTime: 0.07, t, attack: 0.004, dur: 0.1, peak: 0.3 });
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 900, glideTo: 620, glideTime: 0.03, t, attack: 0.001, dur: 0.05, peak: 0.12 });
  }

  /** 🐺 "코요테!": revolver cock click-clack, a gunshot (noise crack + 260→50Hz body), then a distant coyote howl. */
  callCoyote() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const bus = this.sfxBus;
    const t = ctx.currentTime;
    // Click-clack — the brief's 1800→800Hz square, twice.
    [0, 0.07].forEach((dt, i) => {
      this.voice(ctx, bus, { type: "square", freq: i ? 1400 : 1800, glideTo: 800, glideTime: 0.03, t: t + dt, attack: 0.001, dur: 0.035, peak: 0.18, filter: { type: "highpass", freq: 900 } });
    });
    // Bang.
    const shot = t + 0.16;
    this.noiseBurst(ctx, bus, { t: shot, dur: 0.45, peak: 0.55, attack: 0.002, filter: { type: "lowpass", freq: 5000, sweepTo: 300 } });
    this.voice(ctx, bus, { type: "triangle", freq: 260, glideTo: 50, glideTime: 0.32, t: shot, attack: 0.002, dur: 0.38, peak: 0.6 });
    // Awooo — a breathy sine that swells up, holds with vibrato and falls away.
    const howl = shot + 0.35;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, howl);
    osc.frequency.exponentialRampToValueAtTime(820, howl + 0.35);
    osc.frequency.setValueAtTime(820, howl + 0.75);
    osc.frequency.exponentialRampToValueAtTime(560, howl + 1.25);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(6, howl);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, howl);
    depth.gain.linearRampToValueAtTime(18, howl + 0.5);
    lfo.connect(depth).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, howl);
    g.gain.linearRampToValueAtTime(0.14, howl + 0.25);
    g.gain.setValueAtTime(0.14, howl + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, howl + 1.3);
    osc.connect(g).connect(bus);
    osc.start(howl);
    lfo.start(howl);
    osc.stop(howl + 1.35);
    lfo.stop(howl + 1.35);
    this.noiseBurst(ctx, bus, { t: howl, dur: 1.2, peak: 0.03, attack: 0.25, filter: { type: "bandpass", freq: 1600, q: 1.5 } });
  }

  /** ✨ Special card (?, MAX→0, x2, 밤) — the brief's D5–A5–D6 sine chime with a glassy partial. */
  specialCard() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [587.33, 880.0, 1174.66].forEach((freq, i) => {
      this.voice(ctx, this.sfxBus!, { type: "sine", freq, t: t + i * 0.06, attack: 0.003, dur: 0.4, peak: 0.26 });
      this.voice(ctx, this.sfxBus!, { type: "sine", freq: freq * 2.76, t: t + i * 0.06, attack: 0.002, dur: 0.12, peak: 0.03 });
    });
  }

  /** 🪶 A heart lost — the brief's Eb4–D4–C#4–C4 sad trombone, each note opening a "wah" filter, the last one sagging flat. */
  loseHeart() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [311.13, 293.66, 277.18, 261.63].forEach((freq, i) => {
      const last = i === 3;
      this.voice(ctx, this.sfxBus!, {
        type: "sawtooth",
        freq,
        glideTo: last ? freq * 0.94 : undefined,
        glideTime: last ? 0.5 : undefined,
        vibrato: last ? { rate: 5, depth: 0.012 } : undefined,
        t: t + i * 0.22,
        attack: 0.03,
        dur: last ? 0.65 : 0.24,
        peak: 0.22,
        filter: { type: "lowpass", freq: 500, q: 6, sweepTo: last ? 350 : 1600 },
      });
    });
  }

  /* ── BGM ─────────────────────────────────────────────────────────────── */

  /** Board mount/unmount (and round phase). Playback additionally needs BGM unmuted in the site settings. */
  setBgmWanted(wanted: boolean) {
    this.bgmWanted = wanted;
    if (wanted) this.ensure();
    this.syncBgm();
  }

  private syncBgm() {
    const on = this.bgmWanted && !!this.ctx && !isBgmEffectivelyMuted(this.settings());
    if (on && !this.bgmTimer) {
      this.nextStepTime = this.ctx!.currentTime + 0.1;
      this.step = 0;
      this.bgmTimer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    } else if (!on && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (this.nextStepTime < ctx.currentTime) this.nextStepTime = ctx.currentTime + 0.05; // tab was throttled — rejoin, don't burst
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      for (const event of westernEventsAt(this.step)) this.playEvent(ctx, event, this.nextStepTime);
      this.nextStepTime += SIXTEENTH_S;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, e: WesternEvent, t: number) {
    const bus = this.bgmBus;
    if (!bus) return;
    switch (e.voice) {
      case "banjo":
        // 🪕 Banjo pluck: the brief's bandpassed sawtooth plus a bright octave "twang" that dies even faster.
        this.voice(ctx, bus, { type: "sawtooth", freq: e.freq, t, attack: 0.004, dur: 0.18, peak: e.accent ? 0.3 : 0.2, filter: { type: "bandpass", freq: 1400, q: 3 } });
        this.voice(ctx, bus, { type: "triangle", freq: e.freq * 2, t, attack: 0.002, dur: 0.07, peak: e.accent ? 0.1 : 0.06 });
        break;
      case "whistle": {
        // 🪈 Whistle: a sine scooping up into pitch with blooming vibrato, over a wisp of breath.
        const dur = (e.steps ?? 2) * SIXTEENTH_S;
        this.voice(ctx, bus, { type: "sine", freq: e.freq * 0.97, glideTo: e.freq, glideTime: 0.05, vibrato: { rate: 5.5, depth: 0.01 }, t, attack: 0.05, dur, peak: 0.24 });
        this.noiseBurst(ctx, bus, { t, dur, peak: 0.012, attack: 0.05, filter: { type: "bandpass", freq: e.freq * 2, q: 4 } });
        break;
      }
      case "woodblock":
        // 🪵 Hoofbeat: the brief's 850/600Hz tap as a hollow, fast-dropping sine knock.
        this.voice(ctx, bus, { type: "sine", freq: e.freq, glideTo: e.freq * 0.75, glideTime: 0.03, t, attack: 0.001, dur: 0.05, peak: 0.2 });
        break;
      case "shaker":
        // 🐍 Shaker: a short high-passed noise "chk".
        this.noiseBurst(ctx, bus, { t, dur: 0.04, peak: e.accent ? 0.08 : 0.045, filter: { type: "highpass", freq: 6000 } });
        break;
      case "rattlesnake":
        // 🐍 Tail-shake: highpassed noise chopped at ~28Hz, swelling then fading.
        this.noiseBurst(ctx, bus, { t, dur: (e.steps ?? 4) * SIXTEENTH_S, peak: 0.07, attack: 0.15, tremolo: 28, filter: { type: "highpass", freq: 4500 } });
        break;
    }
  }
}

let instance: CoyoteSound | null = null;

export function getCoyoteSound(): CoyoteSound {
  if (!instance) instance = new CoyoteSound();
  return instance;
}
