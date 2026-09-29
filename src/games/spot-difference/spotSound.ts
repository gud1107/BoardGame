import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { waltzEventsAt, WALTZ_BPM, type WaltzEvent } from "./spotDetectiveScore";

/**
 * 틀린 그림 찾기 전용 procedural audio — "Detective Observation Waltz" BGM
 * (score in spotDetectiveScore.ts) plus three SFX: find sparkle, wooden
 * miss "통", stage-clear fanfare. All Web Audio, no audio files.
 *
 * Replaces this game's use of the shared soundEngine's hard-coded tension
 * loop (`startBgm`) and its generic `playCorrectDing`/`playWrongBuzz` — the
 * board calls these instead, so nothing sounds twice.
 *
 * Same structure as coyoteSound.ts/perudoSound.ts, differing from the brief
 * the same way: mute/volume come from the site-wide audio settings store
 * instead of a private `isMuted`/`toggleMute`, and the look-ahead scheduler
 * runs on `setInterval` against `AudioContext.currentTime`, rejoining the
 * beat after a throttled tab instead of bursting to catch up.
 *
 * Signal flow: voices → bgmBus / sfxBus → limiter → speakers.
 */

/** Bus levels at slider = 1. Default sliders (bgm 0.4, sfx 0.7) land on the brief's 0.09 / 0.32. */
const BGM_LEVEL = 0.09 / 0.4;
const SFX_LEVEL = 0.32 / 0.7;
const LOOKAHEAD_S = 0.12;
const SCHEDULER_INTERVAL_MS = 40;
/** Final-seconds tempo: 104 → 132 BPM (≈1.27×), still a waltz, just hurried. */
export const URGENT_BPM = 132;

class SpotSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;

  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private beatS = 60 / WALTZ_BPM;

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

    // The brief's limiter settings.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -20;
    limiter.knee.value = 30;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(limiter);
    this.bgmBus = ctx.createGain();
    this.bgmBus.connect(limiter);

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
      filter?: { type: BiquadFilterType; freq: number; q?: number };
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
      if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, t);
      osc.connect(f);
      head = f;
    }
    head.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // -------------------------------------------------------------------------
  // BGM
  // -------------------------------------------------------------------------

  /** Board mount/unmount and match phase. Playback additionally needs BGM unmuted in the site settings. */
  setBgmWanted(wanted: boolean) {
    this.bgmWanted = wanted;
    if (wanted) this.ensure();
    else this.setUrgent(false); // next match starts at the normal tempo
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

  /** Last-10-seconds hurry: the next scheduled beat onward runs at URGENT_BPM (the score and step position carry on). */
  setUrgent(urgent: boolean) {
    this.beatS = 60 / (urgent ? URGENT_BPM : WALTZ_BPM);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (this.nextStepTime < ctx.currentTime) this.nextStepTime = ctx.currentTime + 0.05; // tab was throttled — rejoin, don't burst
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      for (const event of waltzEventsAt(this.step)) this.playEvent(ctx, event, this.nextStepTime);
      this.nextStepTime += this.beatS;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, e: WaltzEvent, t: number) {
    const bus = this.bgmBus;
    if (!bus) return;
    switch (e.voice) {
      case "bass":
        // 🎻 Pizzicato: lowpassed triangle, fast pluck, short ring.
        this.voice(ctx, bus, { type: "triangle", freq: e.freq, t, attack: 0.02, dur: 0.32, peak: 0.14, filter: { type: "lowpass", freq: 240 } });
        break;
      case "tick":
      case "tock":
        // ⏱️ Clock: narrow bandpassed sine blip, tock lower and softer.
        this.voice(ctx, bus, {
          type: "sine",
          freq: e.freq,
          t,
          attack: 0.005,
          dur: 0.08,
          peak: e.voice === "tick" ? 0.04 : 0.025,
          filter: { type: "bandpass", freq: e.freq, q: 8 },
        });
        break;
      case "marimba":
        // 🪵 Marimba: lowpassed triangle with a soft resonance, rings ~0.9 beat.
        this.voice(ctx, bus, { type: "triangle", freq: e.freq, t, attack: 0.015, dur: this.beatS * 0.9, peak: e.accent ? 0.08 : 0.055, filter: { type: "lowpass", freq: 1400, q: 2.5 } });
        break;
    }
  }

  // -------------------------------------------------------------------------
  // SFX
  // -------------------------------------------------------------------------

  private sfxStart(): { ctx: AudioContext; bus: GainNode; t: number } | null {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || isSfxEffectivelyMuted(this.settings())) return null;
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, bus: this.sfxBus, t: ctx.currentTime + 0.01 };
  }

  /** ✨ A spot was found (by anyone): quick bright C-E-G sparkle. */
  playFindSuccess() {
    const s = this.sfxStart();
    if (!s) return;
    [1046.5, 1318.51, 1567.98].forEach((freq, i) => {
      this.voice(s.ctx, s.bus, { type: "sine", freq, t: s.t + i * 0.05, attack: 0.015, dur: 0.38, peak: 0.24 });
    });
  }

  /**
   * ❌ A wrong click: a wooden "통" dropping in pitch. `soft` is someone
   * else's (bot included) miss — quieter and a little higher, so it reads as
   * background information rather than your own mistake.
   */
  playMissClick(soft = false) {
    const s = this.sfxStart();
    if (!s) return;
    const lift = soft ? 1.25 : 1;
    this.voice(s.ctx, s.bus, { type: "triangle", freq: 280 * lift, glideTo: 110 * lift, glideTime: 0.08, t: s.t, attack: 0.003, dur: soft ? 0.1 : 0.14, peak: soft ? 0.09 : 0.26 });
  }

  /** 🏆 A stage's last spot was found: rising C-major five-note fanfare. */
  playStageClear() {
    const s = this.sfxStart();
    if (!s) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) => {
      this.voice(s.ctx, s.bus, { type: "triangle", freq, t: s.t + i * 0.07, attack: 0.02, dur: 0.75, peak: 0.2 });
    });
  }
}

let instance: SpotSound | null = null;

export function getSpotSound(): SpotSound {
  if (!instance) instance = new SpotSound();
  return instance;
}
