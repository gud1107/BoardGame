import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { LOOP_STEPS, sneakEventsAt, sneakTempo, type RatSoundCue, type SneakEvent } from "./ratSneakScore";

/**
 * 랫어탯캣 전용 procedural audio ("Rat-a-Tat Cat Audio Suite") — a Tom-and-
 * Jerry sneaking pizzicato BGM (score in ratSneakScore.ts, tenser once
 * someone calls) plus card-action SFX: card flutter on draw, Peek piccolo
 * slide, Swap snatch whoosh, Draw 2 two-tone pop, cat-bell / rat-thud on the
 * viewer's own replace, and the "Rat-a-Tat Cat!" rimshot + alarm triad. All
 * Web Audio, no audio files.
 *
 * Same structure as cucumberSound.ts, deliberately differing from the brief
 * in the same ways:
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

/** Bus levels at slider = 1. Default sliders (bgm 0.4, sfx 0.7) land on the brief's 0.1 / 0.35. */
const BGM_LEVEL = 0.1 / 0.4;
const SFX_LEVEL = 0.35 / 0.7;
const LOOKAHEAD_S = 0.15;
const SCHEDULER_INTERVAL_MS = 40;

class RatSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  /** Wanted final-lap mode; `liveFinalLap` (what's actually playing) switches on only at a loop start, off immediately. */
  private finalLap = false;
  private liveFinalLap = false;

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

    // 0.3s of white noise, reused by the card flutter, the swap swish and the rimshot.
    const len = Math.floor(ctx.sampleRate * 0.3);
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

  /** One enveloped oscillator: optional pitch glide, optional filter, linear attack → exponential release. */
  private voice(
    ctx: AudioContext,
    dest: AudioNode,
    opts: { type: OscillatorType; freq: number; glideTo?: number; glideTime?: number; glideLinear?: boolean; t: number; attack: number; dur: number; peak: number; filter?: { type: BiquadFilterType; freq: number; q?: number } },
  ) {
    const { t, dur } = opts;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.glideTo) {
      const end = t + (opts.glideTime ?? Math.min(dur, 0.3));
      if (opts.glideLinear) osc.frequency.linearRampToValueAtTime(opts.glideTo, end);
      else osc.frequency.exponentialRampToValueAtTime(opts.glideTo, end);
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
      if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, t);
      osc.connect(f);
      head = f;
    }
    head.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A filtered burst from the shared noise buffer. */
  private noiseBurst(ctx: AudioContext, dest: AudioNode, opts: { t: number; dur: number; peak: number; filter: { type: BiquadFilterType; freq: number; q?: number; sweepTo?: number } }) {
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
    gain.gain.linearRampToValueAtTime(opts.peak, opts.t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.dur);
    src.connect(f).connect(gain).connect(dest);
    src.start(opts.t, 0, opts.dur + 0.02);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /** Routes a `ratSoundCues` cue to its sting. */
  playCue(cue: RatSoundCue) {
    if (cue.kind === "draw") this.drawCard();
    else if (cue.kind === "swap") this.swapAction();
    else if (cue.kind === "drawTwo") this.draw2Action();
    else if (cue.kind === "quality") this.cardQuality(cue.lowCat);
    else this.ratATatCatCall();
  }

  /** 🃏 Card flutter: a quick high-passed paper swish + the brief's 350→180Hz triangle tap. */
  drawCard() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, this.sfxBus, { t, dur: 0.06, peak: 0.1, filter: { type: "bandpass", freq: 3500, q: 0.9, sweepTo: 1800 } });
    this.voice(ctx, this.sfxBus, { type: "triangle", freq: 350, glideTo: 180, glideTime: 0.07, t: t + 0.03, attack: 0.002, dur: 0.07, peak: 0.3 });
  }

  /** 👁️ Peek: a piccolo slide 700→1400Hz with a faint octave shimmer on top. */
  peekAction() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 700, glideTo: 1400, glideTime: 0.16, t, attack: 0.01, dur: 0.22, peak: 0.25 });
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 1400, glideTo: 2800, glideTime: 0.16, t, attack: 0.01, dur: 0.18, peak: 0.05 });
  }

  /** 🔄 Swap: a triangle 200→800→250Hz "휘릭" over a sweeping noise swish. */
  swapAction() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(800, t + 0.08);
    osc.frequency.linearRampToValueAtTime(250, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.2);
    this.noiseBurst(ctx, this.sfxBus, { t, dur: 0.16, peak: 0.12, filter: { type: "bandpass", freq: 800, q: 1.2, sweepTo: 4000 } });
  }

  /** ✌️ Draw 2: a two-tone pop A4 → E5. */
  draw2Action() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [440, 659.25].forEach((freq, i) => {
      this.voice(ctx, this.sfxBus!, { type: "sine", freq, glideTo: freq * 1.04, glideTime: 0.02, t: t + i * 0.08, attack: 0.003, dur: 0.12, peak: 0.3 });
    });
  }

  /** 🧀 The viewer's own replace: a C6 cat bell (0–2) or a dull sawtooth "쿵" (8–9). */
  cardQuality(lowCat: boolean) {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + 0.05; // after the replace's own card flutter
    if (lowCat) {
      this.voice(ctx, this.sfxBus, { type: "sine", freq: 1046.5, t, attack: 0.002, dur: 0.35, peak: 0.25 });
      this.voice(ctx, this.sfxBus, { type: "sine", freq: 1046.5 * 2.76, t, attack: 0.002, dur: 0.12, peak: 0.04 });
    } else {
      this.voice(ctx, this.sfxBus, { type: "sawtooth", freq: 130, glideTo: 60, glideTime: 0.18, t, attack: 0.005, dur: 0.22, peak: 0.28, filter: { type: "lowpass", freq: 700 } });
    }
  }

  /** 🚨 "Rat-a-Tat Cat!": rimshot crack + a 220→45Hz heart thump, then the F#4–A4–C5 diminished alarm triad. */
  ratATatCatCall() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, this.sfxBus, { t, dur: 0.08, peak: 0.35, filter: { type: "bandpass", freq: 1800, q: 2 } });
    this.voice(ctx, this.sfxBus, { type: "triangle", freq: 220, glideTo: 45, glideTime: 0.3, t, attack: 0.003, dur: 0.35, peak: 0.6 });
    [369.99, 440.0, 523.25].forEach((freq, i) => {
      this.voice(ctx, this.sfxBus!, { type: "sawtooth", freq, t: t + 0.08 + i * 0.07, attack: 0.005, dur: 0.4, peak: 0.16, filter: { type: "lowpass", freq: 2200 } });
    });
  }

  /* ── BGM ─────────────────────────────────────────────────────────────── */

  /** Someone called — tempo up, cat chime on every bar (applied from the next loop start). */
  setFinalLap(finalLap: boolean) {
    this.finalLap = finalLap;
  }

  /** Board mount/unmount (and game over). Playback additionally needs BGM unmuted in the site settings. */
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
      if (this.step % LOOP_STEPS === 0 || !this.finalLap) this.liveFinalLap = this.finalLap;
      const sixteenth = 60 / sneakTempo(this.liveFinalLap) / 4;
      for (const event of sneakEventsAt(this.step, this.liveFinalLap)) this.playEvent(ctx, event, this.nextStepTime);
      this.nextStepTime += sixteenth;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, e: SneakEvent, t: number) {
    const bus = this.bgmBus;
    if (!bus) return;
    switch (e.voice) {
      case "bass":
        // 🎻 Pizzicato bass: plucked triangle, fast attack, very short decay.
        this.voice(ctx, bus, { type: "triangle", freq: e.freq, t, attack: 0.004, dur: 0.16, peak: 0.6, filter: { type: "lowpass", freq: 700 } });
        break;
      case "xylo":
        // 🪵 Xylophone: a sine through a narrow bandpass plus a quick 4th-harmonic "tock".
        this.voice(ctx, bus, { type: "sine", freq: e.freq, t, attack: 0.002, dur: 0.12, peak: 0.3, filter: { type: "bandpass", freq: e.freq, q: 5 } });
        this.voice(ctx, bus, { type: "sine", freq: e.freq * 4, t, attack: 0.001, dur: 0.03, peak: 0.05 });
        break;
      case "woodblock":
        // 🪵 Mouse tiptoe: a very short sine blip that drops in pitch.
        this.voice(ctx, bus, { type: "sine", freq: e.freq, glideTo: e.freq * 0.7, glideTime: 0.03, t, attack: 0.001, dur: 0.045, peak: 0.18 });
        break;
      case "chime":
        // 🐱 Cat's eye glint: a lone bell with an inharmonic partial, ringing out over the bar.
        this.voice(ctx, bus, { type: "sine", freq: e.freq, t, attack: 0.003, dur: 1.2, peak: 0.16 });
        this.voice(ctx, bus, { type: "sine", freq: e.freq * 2.76, t, attack: 0.003, dur: 0.4, peak: 0.04 });
        break;
    }
  }
}

let instance: RatSound | null = null;

export function getRatSound(): RatSound {
  if (!instance) instance = new RatSound();
  return instance;
}
