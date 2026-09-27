import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { STEPS_PER_BAR, symphonyEventsAt, symphonyTempo, type SymphonyContext, type SymphonyEvent, type SymphonyMood } from "./symphonyPattern";

/**
 * 위대한 투자 전용 procedural audio ("Investment Sound Suite") — a restrained
 * royal-chamber-symphony BGM (low strings, French-horn pad, grand-piano line,
 * soft timpani; score in symphonyPattern.ts — with a darker penalty-card
 * mood and a "heat" level that speeds/thickens it as bids climb) plus
 * auction SFX (oak gavel, bid chip, winning fanfare, pass pizzicato) and
 * orchestral synergy complete/break cues. All Web Audio, no audio files.
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
  /** What the score is playing now; `wantedMood` switches in at the next bar line so a mood change never cuts a bar in half. */
  private music: SymphonyContext = { mood: "normal", heat: 0 };
  private wantedMood: SymphonyMood = "normal";

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

  /* ── Synergy moments (orchestral, replacing the generic chiptune-ish SFX) ── */

  /** ✨ Viewer completed a +3 collection: timpani roll → rising string run → full brass B♭-major swell. */
  synergyComplete() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) this.voice(ctx, this.sfxBus, { type: "sine", freq: 72, glideTo: 48, t: t + i * 0.05, attack: 0.004, dur: 0.22, peak: 0.12 + i * 0.03 });
    [392.0, 466.16, 587.33, 698.46].forEach((freq, i) =>
      this.voice(ctx, this.sfxBus!, { type: "sawtooth", freq, t: t + 0.12 + i * 0.06, attack: 0.02, dur: 0.22, peak: 0.07, filter: { type: "lowpass", freq: 1800 } }),
    );
    for (const freq of [233.08, 293.66, 349.23, 466.16]) {
      for (const detune of [1, 1.005]) {
        this.voice(ctx, this.sfxBus, { type: "sawtooth", freq: freq * detune, t: t + 0.38, attack: 0.12, dur: 1.4, peak: 0.055, filter: { type: "lowpass", freq: 1200, q: 1.5 } });
      }
    }
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 64, glideTo: 42, t: t + 0.38, attack: 0.004, dur: 0.5, peak: 0.3 });
  }

  /** 💔 Viewer lost a collection: low-string sforzando cluster (G–A♭) + timpani hit + a horn falling a tritone. */
  synergyBreak() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    for (const freq of [49.0, 51.91, 98.0, 103.83]) {
      this.voice(ctx, this.sfxBus, { type: "sawtooth", freq, t, attack: 0.01, dur: 0.9, peak: 0.09, filter: { type: "lowpass", freq: 700, q: 2 } });
    }
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 70, glideTo: 38, t, attack: 0.003, dur: 0.6, peak: 0.34 });
    this.voice(ctx, this.sfxBus, { type: "sawtooth", freq: 293.66, glideTo: 207.65, t: t + 0.18, attack: 0.08, dur: 0.9, peak: 0.07, filter: { type: "lowpass", freq: 600, q: 2.5 } });
  }

  /** 📯 A rival completed (or broke) a collection: two soft muted-horn notes, well under the viewer's own cues. */
  synergyRival() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [293.66, 233.08].forEach((freq, i) =>
      this.voice(ctx, this.sfxBus!, { type: "sawtooth", freq, t: t + i * 0.16, attack: 0.05, dur: 0.45, peak: 0.05, filter: { type: "lowpass", freq: 520, q: 2 } }),
    );
  }

  /* ── BGM ─────────────────────────────────────────────────────────────── */

  /**
   * Called by the board on every auction change: `reverse` switches to the
   * darker penalty-card variant (at the next bar line), `heat` 0..1 speeds
   * up / thickens the score as the bidding climbs (applied from the next step).
   */
  setAuctionMood(mood: SymphonyMood, heat: number) {
    this.wantedMood = mood;
    this.music = { ...this.music, heat: Math.min(1, Math.max(0, heat)) };
  }

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
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      if (this.step % STEPS_PER_BAR === 0 && this.music.mood !== this.wantedMood) this.music = { ...this.music, mood: this.wantedMood };
      const beat = 60 / symphonyTempo(this.music);
      for (const event of symphonyEventsAt(this.step, this.music)) this.playEvent(ctx, event, this.nextStepTime, beat);
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
        // The filter opens up as the bidding heats (420Hz calm → ~920Hz in a bidding war).
        for (const detune of [1, 1.004]) {
          this.voice(ctx, bus, { type: "sawtooth", freq: e.freq * detune, t, attack: 0.6, dur, peak: 0.035 * e.velocity, filter: { type: "lowpass", freq: 420 + 500 * this.music.heat, q: 2.5 } });
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
      case "ostinato":
        // 🎻 Staccato string eighths (bidding war): short filtered sawtooth plucks.
        this.voice(ctx, bus, { type: "sawtooth", freq: e.freq, t, attack: 0.008, dur, peak: 0.03 * e.velocity, filter: { type: "lowpass", freq: 900, q: 1.2 } });
        break;
      case "tremolo": {
        // 🎻 Low tremolo strings (penalty card): a sawtooth whose level is chopped by a 7Hz LFO.
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(e.freq, t);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(600, t);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.045 * e.velocity, t + 0.4);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const trem = ctx.createGain();
        trem.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 7;
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 0.5;
        lfo.connect(lfoDepth).connect(trem.gain);
        osc.connect(lp).connect(trem).connect(env).connect(bus);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + dur + 0.05);
        lfo.stop(t + dur + 0.05);
        break;
      }
      case "drone":
        // Low G pedal under the penalty-card variant.
        this.voice(ctx, bus, { type: "triangle", freq: e.freq, t, attack: 0.8, dur, peak: 0.06 * e.velocity, filter: { type: "lowpass", freq: 160 } });
        break;
      case "timpani":
        // 🥁 Soft timpani: 68→40Hz sine thump.
        this.voice(ctx, bus, { type: "sine", freq: this.music.mood === "reverse" ? 58 : 68, glideTo: 40, t, attack: 0.005, dur: 0.35, peak: 0.15 * e.velocity });
        break;
    }
  }
}

let instance: InvestmentSound | null = null;

export function getInvestmentSound(): InvestmentSound {
  if (!instance) instance = new InvestmentSound();
  return instance;
}
