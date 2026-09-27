import { isBgmEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { dalmutiEventsAt, STEP_SECONDS, type DalmutiEvent } from "./dalmutiScore";

/**
 * 달무티 전용 procedural BGM ("계급 서사" — score in dalmutiScore.ts): a
 * 4-layer medieval band synthesized with Web Audio, no audio files —
 * 🪕 triangle lute pluck, 🎻 bagpipe-style sawtooth drone, 🥁 tavern
 * tambourine (the brief's jingle blip plus a short noise shake), 🪈 court
 * flute long-tone on the Part B / Part D bridges.
 *
 * Replaces `useGameBgm("dalmuti")`, whose `dalmuti.mp3` was never added to the
 * repo (see public/assets/sounds/bgm/README.md), so Dalmuti had no BGM at all.
 * Game SFX (card slam, pass whiff, revolution bell …) stay in the shared
 * `soundEngine.ts`; this engine is BGM only.
 *
 * Deliberately differs from the brief the same way ratSound.ts/coyoteSound.ts
 * do: mute/volume come from the site-wide audio settings store (header
 * 🔇/🔊, settings-modal BGM slider, Dalmuti's own 🔊 button) instead of a
 * private `isMuted`/`toggleMute`, and the look-ahead scheduler rejoins the
 * beat after a throttled background tab instead of bursting to catch up.
 *
 * Signal flow: voices → bgmBus → compressor → speakers.
 */

/** Bus level at slider = 1. The default BGM slider (0.4) lands on the brief's 0.09. */
const BGM_LEVEL = 0.09 / 0.4;
const LOOKAHEAD_S = 0.12;
const SCHEDULER_INTERVAL_MS = 45;

class DalmutiSoundEngine {
  private ctx: AudioContext | null = null;
  private bgmBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private bgmWanted = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
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
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 4;
    compressor.connect(ctx.destination);

    this.bgmBus = ctx.createGain();
    this.bgmBus.gain.value = 0;
    this.bgmBus.connect(compressor);

    // 0.1s of white noise for the tambourine's jingle shake.
    const len = Math.floor(ctx.sampleRate * 0.1);
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

  /** Call from a click/tap — resumes the context (browser autoplay policy). Idempotent. */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** Board mount/unmount. Playback additionally needs BGM unmuted in the site settings. */
  setBgmWanted(wanted: boolean) {
    this.bgmWanted = wanted;
    if (wanted) this.ensure();
    this.syncBgm();
  }

  private syncBgm() {
    const on = this.bgmWanted && !!this.ctx && !isBgmEffectivelyMuted(this.settings());
    if (on && !this.timer) {
      this.nextNoteTime = this.ctx!.currentTime + 0.05;
      this.step = 0;
      this.timer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    } else if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (this.nextNoteTime < ctx.currentTime) this.nextNoteTime = ctx.currentTime + 0.05; // tab was throttled — rejoin, don't burst
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD_S) {
      for (const e of dalmutiEventsAt(this.step)) this.play(ctx, e, this.nextNoteTime);
      this.nextNoteTime += STEP_SECONDS;
      this.step++;
    }
  }

  private play(ctx: AudioContext, e: DalmutiEvent, t: number) {
    if (e.voice === "lute") this.lute(ctx, e.freq, t, e.steps * STEP_SECONDS, e.velocity * 0.085);
    else if (e.voice === "drone") this.drone(ctx, e.freq, t, e.steps * STEP_SECONDS);
    else if (e.voice === "tambourine") this.tambourine(ctx, t, e.velocity);
    else this.flute(ctx, e.freq, t, e.steps * STEP_SECONDS);
  }

  /** 🪕 Medieval lute pluck: triangle through a resonant lowpass, fast attack, exponential decay. */
  private lute(ctx: AudioContext, freq: number, t: number, dur: number, peak: number) {
    this.voice(ctx, { type: "triangle", freq, t, attack: 0.02, dur, peak, filter: { type: "lowpass", freq: 950, q: 2 } });
  }

  /** 🎻 Bagpipe-style drone: dark lowpassed sawtooth swelling in over 120ms. */
  private drone(ctx: AudioContext, freq: number, t: number, dur: number) {
    this.voice(ctx, { type: "sawtooth", freq, t, attack: 0.12, dur, peak: 0.11, filter: { type: "lowpass", freq: 260 } });
  }

  /** 🥁 Tavern tambourine: the brief's bandpassed sine jingle plus a short high noise shake. */
  private tambourine(ctx: AudioContext, t: number, velocity: number) {
    const accent = velocity >= 1;
    this.voice(ctx, { type: "sine", freq: accent ? 3200 : 2600, t, attack: 0.001, dur: 0.05, peak: accent ? 0.05 : 0.025, filter: { type: "bandpass", freq: 2900, q: 4 } });
    if (!this.noise || !this.bgmBus) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.setValueAtTime(6000, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.04 : 0.02, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(f).connect(g).connect(this.bgmBus);
    src.start(t, 0, 0.08);
  }

  /** 🪈 Court flute long-tone: triangle through a bandpass at its own pitch, slow 400ms swell. */
  private flute(ctx: AudioContext, freq: number, t: number, dur: number) {
    this.voice(ctx, { type: "triangle", freq, t, attack: 0.4, dur, peak: 0.04, filter: { type: "bandpass", freq, q: 3.5 } });
  }

  /** One enveloped oscillator → optional filter → gain → bgmBus. */
  private voice(ctx: AudioContext, o: { type: OscillatorType; freq: number; t: number; attack: number; dur: number; peak: number; filter?: { type: BiquadFilterType; freq: number; q?: number } }) {
    if (!this.bgmBus) return;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, o.t);
    gain.gain.linearRampToValueAtTime(o.peak, o.t + o.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    let head: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.setValueAtTime(o.filter.freq, o.t);
      if (o.filter.q !== undefined) f.Q.setValueAtTime(o.filter.q, o.t);
      osc.connect(f);
      head = f;
    }
    head.connect(gain).connect(this.bgmBus);
    osc.start(o.t);
    osc.stop(o.t + o.dur + 0.02);
  }
}

let instance: DalmutiSoundEngine | null = null;

export function getDalmutiSound(): DalmutiSoundEngine {
  if (!instance) instance = new DalmutiSoundEngine();
  return instance;
}
