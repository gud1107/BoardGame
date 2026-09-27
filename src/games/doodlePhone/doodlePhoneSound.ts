import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { LOFI_BPM, SWING, lofiEventsAt, midiToHz, type LofiEvent } from "./lofiPattern";

/**
 * 그림 전화기 전용 procedural audio — a non-obtrusive lo-fi chill BGM plus
 * drawing/submit/turn micro-SFX, all synthesized with Web Audio (no audio
 * files, project-wide rule).
 *
 * Mute and volume are NOT owned here: they come from the site-wide audio
 * settings store, so the header 🔇/🔊, the settings modal's sliders and this
 * game's HUD (DoodleSoundHud) always agree. (The brief's standalone
 * `isMuted`/`toggleMute` would have drifted out of sync with the header.)
 *
 * The BGM runs on a look-ahead clock against `AudioContext.currentTime`
 * instead of a chained 2s `setTimeout`, so a throttled tab or a busy main
 * thread can't push the chords off the beat. The score itself is pure data
 * in lofiPattern.ts.
 *
 * Signal flow: voices → bgmBus → lo-fi lowpass → master; sfxBus → master;
 * master → soft limiter → speakers. A faint vinyl crackle loop rides the BGM.
 */

type Bus = "sfx" | "bgm";

/** Bus levels at slider = 1. Defaults (bgm 0.4, sfx 0.7) land near the brief's 0.08 / 0.2. */
const BGM_LEVEL = 0.2;
const SFX_LEVEL = 0.3;
/** Minimum gap between pencil ticks while a stroke is being drawn (the brief's 120ms throttle). */
const DRAW_TICK_GAP_S = 0.12;
const LOOKAHEAD_S = 0.25;
const SCHEDULER_INTERVAL_MS = 60;

class DoodlePhoneSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackle: AudioBuffer | null = null;
  private crackleSource: AudioBufferSourceNode | null = null;
  private wow: OscillatorNode | null = null;

  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private lastDrawTick = 0;

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

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.ratio.value = 4;
    limiter.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(limiter);

    // Lo-fi character: roll off the top end of the whole music bus.
    const warmth = ctx.createBiquadFilter();
    warmth.type = "lowpass";
    warmth.frequency.value = 2_600;
    warmth.Q.value = 0.4;
    this.bgmBus = ctx.createGain();
    this.bgmBus.connect(warmth).connect(limiter);

    // Tape "wow": one slow LFO wobbles the pitch of every music voice a few cents.
    this.wow = ctx.createOscillator();
    this.wow.frequency.value = 0.35;
    this.wow.start();

    this.noise = this.makeNoise(ctx, 1);
    this.crackle = this.makeCrackle(ctx, 4);

    this.applySettings(this.settings());
    useAudioSettingsStore.subscribe((s) => this.applySettings(s));
    return ctx;
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Mostly silence with sparse decaying clicks and a whisper of hiss — loops seamlessly. */
  private makeCrackle(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
    const clicks = Math.floor(seconds * 9);
    for (let c = 0; c < clicks; c++) {
      const at = Math.floor(Math.random() * (d.length - 200));
      const amp = 0.25 + Math.random() * 0.6;
      for (let k = 0; k < 120; k++) d[at + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / 18);
    }
    return buf;
  }

  private applySettings(s: AudioSettings) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.bgmBus) return;
    const t = ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume * SFX_LEVEL, t, 0.02);
    this.bgmBus.gain.setTargetAtTime(isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * BGM_LEVEL, t, 0.08);
    this.syncBgm();
  }

  /** Call from a click/tap/pointerdown — resumes the context (browser autoplay policy). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** The context, only when `bus` is audible — so nothing is synthesized while muted. */
  private ready(bus: Bus): AudioContext | null {
    const s = this.settings();
    if (bus === "sfx" ? isSfxEffectivelyMuted(s) : isBgmEffectivelyMuted(s)) return null;
    const ctx = this.ensure();
    return ctx && ctx.state === "running" ? ctx : null;
  }

  private tone(ctx: AudioContext, dest: AudioNode, type: OscillatorType, from: number, to: number, t: number, dur: number, peak: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /**
   * ✏️ Soft pencil tick. Safe to call on every pointer move: it throttles
   * itself on the audio clock, so a fast stroke is a gentle patter, not a buzz.
   */
  drawTick() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    if (t - this.lastDrawTick < DRAW_TICK_GAP_S) return;
    this.lastDrawTick = t;
    const start = 470 + Math.random() * 80; // tiny pitch spread so repeats don't sound mechanical
    this.tone(ctx, this.sfxBus, "sine", start, start * 0.6, t, 0.025, 0.04);
  }

  /** 🚀 "톡!" bubble pop on submit: a quick upward triangle sweep. */
  submitPop() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    this.tone(ctx, this.sfxBus, "triangle", 280, 820, ctx.currentTime, 0.09, 0.3);
  }

  /** 🔔 Clear two-note chime (C5 → E5) when a new prompt or blank canvas arrives. */
  turnStartChime() {
    const ctx = this.ready("sfx");
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    [523.25, 659.25].forEach((freq, i) => this.tone(ctx, this.sfxBus!, "sine", freq, freq, t + i * 0.06, 0.15, 0.2));
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
      this.startCrackle();
    } else if (!on && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
      this.stopCrackle();
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (this.nextStepTime < ctx.currentTime) this.nextStepTime = ctx.currentTime + 0.05; // tab was throttled — rejoin, don't burst
    const beat = 60 / LOFI_BPM;
    const eighth = beat / 2;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      const swung = this.step % 2 === 1 ? this.nextStepTime + SWING * beat : this.nextStepTime;
      for (const event of lofiEventsAt(this.step)) this.playEvent(ctx, event, swung, beat);
      this.nextStepTime += eighth;
      this.step++;
    }
  }

  private playEvent(ctx: AudioContext, event: LofiEvent, t: number, beat: number) {
    const dur = event.beats * beat;
    switch (event.voice) {
      case "chord":
        // Electric-piano strum: notes 30ms apart, like the brief's voicing.
        event.notes.forEach((note, i) => this.electricPiano(ctx, midiToHz(note), t + i * 0.03, dur, 0.022 * event.velocity));
        break;
      case "arp":
        this.electricPiano(ctx, midiToHz(event.notes[0]), t, dur, 0.018 * event.velocity);
        break;
      case "bass":
        this.bass(ctx, midiToHz(event.notes[0]), t, dur, 0.06 * event.velocity);
        break;
      case "hat":
        this.hat(ctx, t, 0.012 * event.velocity);
        break;
    }
  }

  /** Triangle + quiet octave sine through a soft lowpass, pitch riding the shared "wow" LFO. */
  private electricPiano(ctx: AudioContext, freq: number, t: number, dur: number, peak: number) {
    if (!this.bgmBus || !this.wow) return;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1_400, t);
    filter.frequency.exponentialRampToValueAtTime(650, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filter.connect(gain).connect(this.bgmBus);
    const wowDepth = ctx.createGain();
    wowDepth.gain.value = 5; // cents
    this.wow.connect(wowDepth);
    for (const [type, mult, level] of [
      ["triangle", 1, 1],
      ["sine", 2, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      wowDepth.connect(osc.detune);
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      osc.onended = () => wowDepth.disconnect();
    }
  }

  private bass(ctx: AudioContext, freq: number, t: number, dur: number, peak: number) {
    if (!this.bgmBus) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain).connect(this.bgmBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Brushed hat: a 60ms burst of high-passed noise. */
  private hat(ctx: AudioContext, t: number, peak: number) {
    if (!this.bgmBus || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6_500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp).connect(gain).connect(this.bgmBus);
    src.start(t, Math.random() * 0.5, 0.08);
  }

  private startCrackle() {
    const ctx = this.ctx;
    if (!ctx || !this.bgmBus || !this.crackle || this.crackleSource) return;
    const src = ctx.createBufferSource();
    src.buffer = this.crackle;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(gain).connect(this.bgmBus);
    src.start();
    this.crackleSource = src;
  }

  private stopCrackle() {
    this.crackleSource?.stop();
    this.crackleSource = null;
  }
}

let instance: DoodlePhoneSound | null = null;

export function getDoodlePhoneSound(): DoodlePhoneSound {
  if (!instance) instance = new DoodlePhoneSound();
  return instance;
}
