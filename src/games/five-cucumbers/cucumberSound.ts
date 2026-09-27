import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { STEPS_PER_BAR, waltzEventsAt, waltzTempo, type CardPlaySound, type CucumberEater, type WaltzEvent } from "./cucumberWaltz";

/**
 * 오이 다섯 개 전용 procedural audio ("Cucumber Sound Suite") — a comic-
 * suspense G-minor cabaret waltz BGM (pizzicato bass + accordion; score in
 * cucumberWaltz.ts, speeding up and thickening toward the 7th trick) plus
 * trick-taking SFX: card slide, 15 orchestra hit, 1 glockenspiel chime,
 * forced-low-shed toon slide, and the cucumber-eating crunch + sad trombone.
 * All Web Audio, no audio files.
 *
 * Same structure as investmentSound.ts / doodlePhoneSound.ts, deliberately
 * differing from the brief in the same ways:
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

/** Bus levels at slider = 1. Default sliders (bgm 0.4, sfx 0.7) land on the brief's 0.12 / 0.4. */
const BGM_LEVEL = 0.12 / 0.4;
const SFX_LEVEL = 0.4 / 0.7;
const LOOKAHEAD_S = 0.2;
const SCHEDULER_INTERVAL_MS = 50;

class CucumberSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  /** Live tension (0..1); a rise lands from the next bar line so a bar never changes feel half-way through. */
  private tension = 0;
  private wantedTension = 0;

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

    // 0.3s of white noise, reused by the card slide and the crunch.
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
    opts: { type: OscillatorType; freq: number; glideTo?: number; glideTime?: number; t: number; attack: number; dur: number; peak: number; filter?: { type: BiquadFilterType; freq: number; q?: number }; vibrato?: { rate: number; depth: number } },
  ) {
    const { t, dur } = opts;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + (opts.glideTime ?? Math.min(dur, 0.3)));
    let lfo: OscillatorNode | null = null;
    if (opts.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = opts.vibrato.rate;
      const depth = ctx.createGain();
      depth.gain.value = opts.vibrato.depth;
      lfo.connect(depth).connect(osc.frequency);
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
    if (lfo) {
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
  }

  /** A filtered burst from the shared noise buffer. */
  private noiseBurst(ctx: AudioContext, dest: AudioNode, opts: { t: number; dur: number; peak: number; filter: { type: BiquadFilterType; freq: number; q?: number; sweepTo?: number }; offset?: number }) {
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
    src.start(opts.t, opts.offset ?? 0, opts.dur + 0.02);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /** Routes a card play to its sting (choice made by `cardPlaySound` in cucumberWaltz.ts). */
  cardPlayed(kind: CardPlaySound) {
    if (kind === "dominance15") this.card15Dominance();
    else if (kind === "safeEscape1") this.card1SafeEscape();
    else if (kind === "discardLow") this.discardLow();
    else this.normalCard();
  }

  /** 🃏 Card slide + snap: a short high-passed noise swish and the brief's 420→160Hz triangle tap. */
  normalCard() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, this.sfxBus, { t, dur: 0.07, peak: 0.12, filter: { type: "bandpass", freq: 3200, q: 0.8, sweepTo: 1600 } });
    this.voice(ctx, this.sfxBus, { type: "triangle", freq: 420, glideTo: 160, glideTime: 0.06, t: t + 0.05, attack: 0.002, dur: 0.07, peak: 0.28 });
  }

  /** 💥 15: low-brass C-major stab (C2 G2 C3 E3) through a closing lowpass + a sub-kick shockwave. */
  card15Dominance() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    for (const freq of [65.41, 98.0, 130.81, 164.81]) {
      for (const detune of [1, 1.006]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq * detune, t);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(1200, t);
        lp.frequency.exponentialRampToValueAtTime(300, t + 0.45);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(lp).connect(g).connect(this.sfxBus);
        osc.start(t);
        osc.stop(t + 0.62);
      }
    }
    this.voice(ctx, this.sfxBus, { type: "sine", freq: 140, glideTo: 35, glideTime: 0.2, t, attack: 0.003, dur: 0.28, peak: 0.6 });
    this.noiseBurst(ctx, this.sfxBus, { t, dur: 0.18, peak: 0.1, filter: { type: "lowpass", freq: 2500, sweepTo: 400 } });
  }

  /** ✨ 1: glockenspiel C6–G6–C7 rising arpeggio with a faint inharmonic partial for the metal-bar shimmer. */
  card1SafeEscape() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [1046.5, 1567.98, 2093.0].forEach((freq, i) => {
      const nt = t + i * 0.06;
      this.voice(ctx, this.sfxBus!, { type: "sine", freq, t: nt, attack: 0.002, dur: 0.5, peak: 0.26 });
      this.voice(ctx, this.sfxBus!, { type: "sine", freq: freq * 2.76, t: nt, attack: 0.002, dur: 0.18, peak: 0.05 });
    });
  }

  /** 📉 Forced low shed: slapstick slide-whistle/trombone falling 520→180Hz with a wobble — "어쩔 수 없지~". */
  discardLow() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.voice(ctx, this.sfxBus, { type: "triangle", freq: 520, glideTo: 180, glideTime: 0.3, t, attack: 0.01, dur: 0.34, peak: 0.3, vibrato: { rate: 11, depth: 14 } });
  }

  /** Routes the 7th trick's penalty to the eater-specific cue (see `cucumberEater`). */
  cucumberEaten(eater: CucumberEater, delay = 0.3) {
    if (eater === "me") this.eatCucumber(delay);
    else this.rivalAteCucumber(delay);
  }

  /**
   * 🥒 I ate the cucumbers: "아작!" crunch (4 bandpassed noise snaps + pitch pops)
   * then the sad trombone F#3 → F3 → E3, the last note held with a droopy
   * vibrato. Starts `delay` seconds out so it lands after the 7th trick's
   * final card sting instead of on top of it.
   */
  eatCucumber(delay = 0.3) {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + delay;
    for (let i = 0; i < 4; i++) {
      const pt = t + i * 0.045;
      this.noiseBurst(ctx, this.sfxBus, { t: pt, dur: 0.05, peak: 0.35, offset: i * 0.05, filter: { type: "bandpass", freq: 2600 - i * 350, q: 1.4 } });
      this.voice(ctx, this.sfxBus, { type: "square", freq: 700 - i * 90, glideTo: 120, glideTime: 0.04, t: pt, attack: 0.001, dur: 0.045, peak: 0.08 });
    }
    [185.0, 174.61, 164.81].forEach((freq, i) => {
      const last = i === 2;
      this.voice(ctx, this.sfxBus!, {
        type: "sawtooth",
        freq,
        glideTo: last ? freq * 0.94 : undefined,
        glideTime: last ? 0.7 : undefined,
        t: t + 0.25 + i * 0.26,
        attack: 0.03,
        dur: last ? 0.85 : 0.24,
        peak: 0.2,
        filter: { type: "lowpass", freq: 900, q: 3 },
        vibrato: last ? { rate: 5, depth: 6 } : undefined,
      });
    });
  }

  /**
   * 😮‍💨 Someone else ate them: a quieter, higher two-snap nibble (heard from
   * across the table) then a relieved rising "휴~ 다행" — G5 → B5 → D6 bell
   * notes over a soft falling breath of noise. Deliberately major and light so
   * it never reads as the viewer's own loss.
   */
  rivalAteCucumber(delay = 0.3) {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + delay;
    for (let i = 0; i < 2; i++) {
      const pt = t + i * 0.06;
      this.noiseBurst(ctx, this.sfxBus, { t: pt, dur: 0.04, peak: 0.14, offset: 0.1 + i * 0.05, filter: { type: "bandpass", freq: 3400 - i * 400, q: 1.6 } });
    }
    this.noiseBurst(ctx, this.sfxBus, { t: t + 0.18, dur: 0.35, peak: 0.06, filter: { type: "bandpass", freq: 1800, q: 0.7, sweepTo: 600 } });
    [783.99, 987.77, 1174.66].forEach((freq, i) =>
      this.voice(ctx, this.sfxBus!, { type: "triangle", freq, t: t + 0.2 + i * 0.09, attack: 0.005, dur: 0.35, peak: 0.16 }),
    );
  }

  /* ── BGM ─────────────────────────────────────────────────────────────── */

  /** 0 (trick 1) .. 1 (the 7th, cucumber-deciding trick) — see `trickTension`. */
  setTension(tension: number) {
    this.wantedTension = Math.min(1, Math.max(0, tension));
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
      // Tension can drop instantly (new round), but rises only at a bar line.
      if (this.step % STEPS_PER_BAR === 0 || this.wantedTension < this.tension) this.tension = this.wantedTension;
      const beat = 60 / waltzTempo(this.tension);
      for (const event of waltzEventsAt(this.step, this.tension)) this.playEvent(ctx, event, this.nextStepTime, beat);
      this.nextStepTime += beat;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, e: WaltzEvent, t: number, beat: number) {
    const bus = this.bgmBus;
    if (!bus) return;
    const dur = e.beats * beat;
    switch (e.voice) {
      case "bass":
        // 🎻 Pizzicato bass: plucked triangle, fast attack, quick decay.
        this.voice(ctx, bus, { type: "triangle", freq: e.freqs[0], t, attack: 0.005, dur, peak: 0.55, filter: { type: "lowpass", freq: 600 } });
        break;
      case "accordion":
        // 🪗 Accordion "짝": nasal sawtooth reeds (a detuned pair each, the musette beating) through a 700Hz bandpass.
        for (const f of e.freqs) {
          for (const detune of [1, 1.007]) {
            this.voice(ctx, bus, { type: "sawtooth", freq: f * detune, t, attack: 0.02, dur, peak: 0.07, filter: { type: "bandpass", freq: 700, q: 2.5 } });
          }
        }
        break;
      case "melody":
        // 🎷 Clarinet-ish lead: square through a lowpass, light vibrato.
        this.voice(ctx, bus, { type: "square", freq: e.freqs[0], t, attack: 0.03, dur, peak: 0.09, filter: { type: "lowpass", freq: 1600, q: 1 }, vibrato: { rate: 5.5, depth: 4 } });
        break;
      case "tick":
        // ⏱️ Nervous woodblock tick on the 7th trick.
        this.voice(ctx, bus, { type: "sine", freq: e.freqs[0], glideTo: e.freqs[0] * 0.7, glideTime: 0.03, t, attack: 0.001, dur: 0.05, peak: 0.25 });
        break;
    }
  }
}

let instance: CucumberSound | null = null;

export function getCucumberSound(): CucumberSound {
  if (!instance) instance = new CucumberSound();
  return instance;
}
