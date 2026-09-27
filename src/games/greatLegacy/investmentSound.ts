import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { SYMPHONY_BPM, symphonyEventsAt, type SymphonyEvent } from "./symphonyPattern";

/**
 * 위대한 투자 전용 procedural audio ("Investment Sound Suite") — a restrained
 * royal-chamber-symphony BGM (low strings, French-horn pad, grand-piano line,
 * soft timpani; score in symphonyPattern.ts) plus auction SFX (oak gavel,
 * bid chip, winning fanfare, pass pizzicato). All Web Audio, no audio files.
 *
 * Same structure as doodlePhoneSound.ts, deliberately differing from the
 * brief in the same ways:
 *  - mute/volume come from the site-wide audio settings store (header
 *    🔇/🔊, settings-modal sliders, and this game's HUD always agree)
 *    instead of a private `isMuted`/`toggleMute`;
 *  - the BGM rides a look-ahead scheduler on `AudioContext.currentTime` via
 *    `setInterval`, rejoining the beat after a throttled tab instead of
 *    bursting to catch up.
 *
 * Signal flow: voices → bgmBus / sfxBus → master compressor (the brief's
 * -22dB / 4.5:1 "묵직하게 정돈" settings) → speakers.
 */

type Bus = "sfx" | "bgm";

/** Bus levels at slider = 1. Default sliders (bgm 0.4, sfx 0.7) land on the brief's 0.11 / 0.38. */
const BGM_LEVEL = 0.11 / 0.4;
const SFX_LEVEL = 0.38 / 0.7;
const LOOKAHEAD_S = 0.25;
const SCHEDULER_INTERVAL_MS = 60;

class InvestmentSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;

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
    compressor.threshold.value = -22;
    compressor.knee.value = 24;
    compressor.ratio.value = 4.5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(compressor);
    this.bgmBus = ctx.createGain();
    this.bgmBus.connect(compressor);

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

  /** One enveloped oscillator: optional pitch glide, optional filter, linear attack → exponential release. */
  private voice(
    ctx: AudioContext,
    dest: AudioNode,
    opts: { type: OscillatorType; freq: number; glideTo?: number; t: number; attack: number; dur: number; peak: number; filter?: { type: BiquadFilterType; freq: number; q?: number } },
  ) {
    const { t, dur } = opts;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + Math.min(dur, 0.3));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.peak, t + opts.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter.type;
      f.frequency.setValueAtTime(opts.filter.freq, t);
      if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, t);
      osc.connect(f);
      head = f;
    }
    head.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /** 🔨 "탁!" — oak gavel: a fast-falling triangle knock through a wooden bandpass, plus a short low hall thump. */
  gavelStrike() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.voice(ctx, this.sfxBus, { type: "triangle", freq: 320, glideTo: 80, t, attack: 0.002, dur: 0.18, peak: 0.5, filter: { type: "bandpass", freq: 550, q: 3 } });
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 110, glideTo: 60, t, attack: 0.004, dur: 0.32, peak: 0.22 });
  }

  /** 🪙 Bid raised: two clear chip pings with a tiny upward bend. */
  bidRaise() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    for (const freq of [1400, 2100]) this.voice(ctx, this.sfxBus, { type: "sine", freq, glideTo: freq * 1.1, t, attack: 0.003, dur: 0.15, peak: 0.16 });
  }

  /** 👑 Winning-bid fanfare: C–E–G–C major triad rolled 80ms apart. */
  wonAuction() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      this.voice(ctx, this.sfxBus!, { type: "triangle", freq, t: t + i * 0.08, attack: 0.01, dur: 0.5, peak: 0.24 }),
    );
  }

  /** ✋ Pass: a low falling pizzicato. */
  pass() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 260, glideTo: 140, t: ctx.currentTime, attack: 0.004, dur: 0.18, peak: 0.25 });
  }

  /* ── BGM ─────────────────────────────────────────────────────────────── */

  /** Board mount/unmount. Playback additionally needs BGM unmuted in the site settings. */
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
    const beat = 60 / SYMPHONY_BPM;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      for (const event of symphonyEventsAt(this.step)) this.playEvent(ctx, event, this.nextStepTime, beat);
      this.nextStepTime += beat / 2;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, e: SymphonyEvent, t: number, beat: number) {
    const bus = this.bgmBus;
    if (!bus) return;
    const dur = e.beats * beat;
    switch (e.voice) {
      case "horn":
        // 📯 Rounded brass: sawtooth + a slightly detuned twin through a 420Hz lowpass, 0.6s swell.
        for (const detune of [1, 1.004]) {
          this.voice(ctx, bus, { type: "sawtooth", freq: e.freq * detune, t, attack: 0.6, dur, peak: 0.035 * e.velocity, filter: { type: "lowpass", freq: 420, q: 2.5 } });
        }
        break;
      case "bass":
        // 🎻 Cello/contrabass legato: triangle under a 220Hz lowpass.
        this.voice(ctx, bus, { type: "triangle", freq: e.freq, t, attack: 0.3, dur, peak: 0.12 * e.velocity, filter: { type: "lowpass", freq: 220 } });
        break;
      case "piano":
        // 🎹 Grand piano: sine + a quiet octave partial, fast attack, 1.1kHz lowpass.
        this.voice(ctx, bus, { type: "sine", freq: e.freq, t, attack: 0.03, dur, peak: 0.08 * e.velocity, filter: { type: "lowpass", freq: 1100 } });
        this.voice(ctx, bus, { type: "sine", freq: e.freq * 2, t, attack: 0.02, dur: dur * 0.6, peak: 0.015 * e.velocity });
        break;
      case "timpani":
        // 🥁 Soft timpani: 68→40Hz sine thump.
        this.voice(ctx, bus, { type: "sine", freq: 68, glideTo: 40, t, attack: 0.005, dur: 0.35, peak: 0.15 * e.velocity });
        break;
    }
  }
}

let instance: InvestmentSound | null = null;

export function getInvestmentSound(): InvestmentSound {
  if (!instance) instance = new InvestmentSound();
  return instance;
}
