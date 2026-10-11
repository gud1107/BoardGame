import { isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";

/**
 * 텔레파시 SFX — synthesized with Web Audio (no files), honoring the
 * site-wide SFX mute/volume. No BGM on purpose: silence is the game.
 *
 * Card pitch rises with the card number (§5-3) so you can follow the pile by
 * ear without looking.
 */

const SFX_LEVEL = 0.32 / 0.7;

class TelepathySound {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.ratio.value = 8;
      limiter.connect(ctx.destination);
      this.bus = ctx.createGain();
      this.bus.connect(limiter);
      this.ctx = ctx;
      this.apply(useAudioSettingsStore.getState());
      useAudioSettingsStore.subscribe((s) => this.apply(s));
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private apply(s: AudioSettings) {
    if (this.bus) this.bus.gain.value = isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume * SFX_LEVEL;
  }

  /** Call from a tap/click so later sounds (fired from network updates) can play. */
  unlock() {
    this.ensure();
  }

  private tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    const peak = opts.gain ?? 0.5;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.bus);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** Soft glass "ting" whose pitch follows the card (1 → ~220Hz, 100 → ~1760Hz). */
  card(card: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const freq = 220 * Math.pow(2, ((Math.max(1, Math.min(100, card)) - 1) / 99) * 3);
    this.tone(freq, t, 0.55, { type: "sine", gain: 0.45 });
    this.tone(freq * 2.01, t, 0.25, { type: "triangle", gain: 0.12 });
    // Sparkle tail for the landing burst.
    [1.5, 2, 3].forEach((m, i) => this.tone(freq * m, t + 0.06 + i * 0.05, 0.22, { type: "triangle", gain: 0.07 }));
  }

  /** Countdown pip; `last` is the higher "go" note. */
  countdown(last: boolean) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(last ? 880 : 587, ctx.currentTime, last ? 0.35 : 0.14, { type: "triangle", gain: last ? 0.4 : 0.25 });
  }

  /** Someone else's hand just went up / a sync hold landed. */
  hold() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(392, ctx.currentTime, 0.12, { type: "sine", gain: 0.18 });
  }

  /** Low thud + falling tone + a cracking heart. */
  mistake() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(160, t, 0.5, { type: "sine", gain: 0.7, slideTo: 60 });
    this.tone(330, t + 0.05, 0.6, { type: "sawtooth", gain: 0.08, slideTo: 150 });
    this.tone(1200, t + 0.42, 0.08, { type: "square", gain: 0.06 });
    this.tone(900, t + 0.5, 0.08, { type: "square", gain: 0.05 });
  }

  /** ⚡ shimmer. */
  star() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [1318.5, 1568, 2093, 2637].forEach((f, i) => this.tone(f, t + i * 0.05, 0.4, { type: "triangle", gain: 0.18 }));
  }

  /** Vote opened. */
  vote() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(660, t, 0.15, { type: "triangle", gain: 0.25 });
    this.tone(990, t + 0.12, 0.2, { type: "triangle", gain: 0.25 });
  }

  won() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => this.tone(f, t + i * 0.11, 0.9, { type: "triangle", gain: 0.28 }));
    [261.63, 329.63, 392].forEach((f) => this.tone(f, t + 0.66, 1.4, { type: "sine", gain: 0.2 }));
  }

  lost() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 349.23, 311.13, 261.63].forEach((f, i) => this.tone(f, t + i * 0.22, 0.6, { type: "sine", gain: 0.3 }));
  }
}

let instance: TelepathySound | null = null;
export function telepathySound(): TelepathySound {
  if (!instance) instance = new TelepathySound();
  return instance;
}
