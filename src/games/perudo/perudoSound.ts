import { isBgmEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { incaEventsAt, INCA_BPM, type IncaEvent } from "./perudoIncaScore";

/**
 * 페루도 전용 procedural BGM ("Inca Dice") — tribal tom, dice-cup shaker,
 * nylon guitar and a breathy low pan flute (score in perudoIncaScore.ts).
 * All Web Audio, no audio files.
 *
 * BGM only, deliberately: the brief's five SFX (cup slam, bid call, dudo,
 * calza, lose die) all land on moments this board already voices through the
 * shared soundEngine — `playDiceRattle`/`playCupThud` on every roll,
 * `playPerudoBetStamp` on every confirmed bid, and the four showdown
 * cinematics (`playPerudoBluffBustedGong` etc. in PerudoActionFX.tsx) on
 * every 페루도!/맞아! verdict. Adding the brief's versions would double each
 * one up.
 *
 * Same structure as coyoteSound.ts, differing from the brief the same way:
 * mute/volume come from the site-wide audio settings store instead of a
 * private `isMuted`/`toggleMute`, and the look-ahead scheduler runs on
 * `setInterval` against `AudioContext.currentTime`, rejoining the beat after
 * a throttled tab instead of bursting to catch up.
 *
 * Signal flow: voices → bgmBus → compressor → speakers.
 */

/** Bus level at slider = 1. The default slider (0.4) lands on the brief's 0.09. */
const BGM_LEVEL = 0.09 / 0.4;
const LOOKAHEAD_S = 0.15;
const SCHEDULER_INTERVAL_MS = 40;
const EIGHTH_S = 60 / INCA_BPM / 2;

class PerudoSound {
  private ctx: AudioContext | null = null;
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

    // The brief's compressor settings.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 25;
    compressor.ratio.value = 4;
    compressor.connect(ctx.destination);

    this.bgmBus = ctx.createGain();
    this.bgmBus.connect(compressor);

    // 0.6s of white noise, reused by the shaker and the pan-flute breath.
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
    if (!ctx || !this.bgmBus) return;
    this.bgmBus.gain.setTargetAtTime(isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * BGM_LEVEL, ctx.currentTime, 0.1);
    this.syncBgm();
  }

  /** Call from a click/tap — resumes the context (browser autoplay policy). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** One enveloped oscillator: optional pitch drop, optional filter, linear attack → exponential release. */
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
      filter?: { type: BiquadFilterType; freq: number; q?: number; sweepTo?: number };
    },
  ) {
    const { t, dur } = opts;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + (opts.glideTime ?? dur));
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

  /** A filtered burst from the shared noise buffer. */
  private noiseBurst(ctx: AudioContext, dest: AudioNode, opts: { t: number; dur: number; peak: number; attack?: number; filter: { type: BiquadFilterType; freq: number; q?: number } }) {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter.type;
    f.frequency.setValueAtTime(opts.filter.freq, opts.t);
    if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, opts.t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, opts.t);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.t + (opts.attack ?? 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.dur);
    src.connect(f).connect(gain).connect(dest);
    src.start(opts.t, 0, opts.dur + 0.02);
  }

  /** Board mount/unmount and round phase. Playback additionally needs BGM unmuted in the site settings. */
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
      for (const event of incaEventsAt(this.step)) this.playEvent(ctx, event, this.nextStepTime);
      this.nextStepTime += EIGHTH_S;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, e: IncaEvent, t: number) {
    const bus = this.bgmBus;
    if (!bus) return;
    switch (e.voice) {
      case "tom":
        // 🪘 Tom: the brief's sine dropping to 35Hz, plus a muffled skin slap on the accents.
        this.voice(ctx, bus, { type: "sine", freq: e.freq, glideTo: 35, glideTime: 0.18, t, attack: 0.002, dur: 0.22, peak: e.accent ? 0.5 : 0.3 });
        if (e.accent) this.noiseBurst(ctx, bus, { t, dur: 0.05, peak: 0.07, filter: { type: "lowpass", freq: 900 } });
        break;
      case "shaker":
        // 🎲 Dice-cup shaker: short high-passed noise "chk" (the brief used a triangle tone, which reads as a beep, not a rattle).
        this.noiseBurst(ctx, bus, { t, dur: 0.05, peak: e.accent ? 0.08 : 0.045, filter: { type: "highpass", freq: 5500 } });
        break;
      case "guitar": {
        // 🎸 Nylon pluck: the brief's lowpassed sawtooth, filter closing as the string dies.
        const dur = (e.steps ?? 2) * EIGHTH_S;
        this.voice(ctx, bus, { type: "sawtooth", freq: e.freq, t, attack: 0.008, dur, peak: e.accent ? 0.22 : 0.16, filter: { type: "lowpass", freq: 1400, q: 1, sweepTo: 500 } });
        break;
      }
      case "flute": {
        // 🪈 Pan flute: the brief's bandpassed triangle with a slow breathy swell, over a wisp of air at the pitch.
        const dur = (e.steps ?? 2) * EIGHTH_S * 1.05;
        this.voice(ctx, bus, { type: "triangle", freq: e.freq, t, attack: 0.12, dur, peak: 0.24, filter: { type: "bandpass", freq: e.freq, q: 3.5 } });
        this.voice(ctx, bus, { type: "sine", freq: e.freq, t, attack: 0.12, dur, peak: 0.1 });
        this.noiseBurst(ctx, bus, { t, dur: Math.min(dur, 0.55), peak: 0.03, attack: 0.08, filter: { type: "bandpass", freq: e.freq * 2, q: 5 } });
        break;
      }
    }
  }
}

let instance: PerudoSound | null = null;

export function getPerudoSound(): PerudoSound {
  if (!instance) instance = new PerudoSound();
  return instance;
}
