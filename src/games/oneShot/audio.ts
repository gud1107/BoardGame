/**
 * Synthesized SFX for 한 발의 묘수 (no audio files): gunshot, ricochet ping,
 * wooden target crack, barrel blast, rope snap, hostage buzzer, clear/fail
 * stingers. Everything goes through one master gain so 🔇 is instant.
 */

import type { FxKind } from "./sim";

export class ShotAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = "bandpass", delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(kind: FxKind) {
    if (!this.ctx || this.muted) return;
    switch (kind) {
      case "shot":
        this.burst(0.18, 1800, 0.7, 0.9, "lowpass");
        this.tone("sine", 140, 45, 0.16, 0.6);
        break;
      case "ricochet":
        this.tone("sine", 2600, 1500, 0.22, 0.18);
        this.tone("triangle", 3900, 2400, 0.12, 0.08);
        break;
      case "hit":
        this.burst(0.09, 900, 3, 0.7);
        this.tone("square", 420, 260, 0.06, 0.08);
        break;
      case "wall":
      case "thud":
        this.burst(0.07, 500, 2, 0.35);
        break;
      case "cut":
        this.burst(0.05, 3200, 4, 0.4);
        this.tone("triangle", 900, 300, 0.08, 0.1);
        break;
      case "boom":
        this.burst(0.9, 260, 0.6, 1, "lowpass");
        this.tone("sine", 90, 30, 0.6, 0.7);
        break;
      case "smash":
        this.burst(0.25, 2400, 1.2, 0.5);
        this.tone("triangle", 1300, 700, 0.3, 0.1);
        break;
      case "land":
        this.burst(0.2, 180, 1, 0.5, "lowpass");
        break;
      case "hostage":
        this.tone("sawtooth", 220, 180, 0.45, 0.16);
        this.tone("sawtooth", 233, 190, 0.45, 0.1);
        break;
    }
  }

  win(diamond: boolean) {
    if (!this.ctx || this.muted) return;
    const notes = diamond ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone("triangle", f, f * 0.995, 0.35, 0.16, i * 0.09));
  }

  fail() {
    if (!this.ctx || this.muted) return;
    [392, 330, 262].forEach((f, i) => this.tone("triangle", f, f * 0.97, 0.3, 0.14, i * 0.14));
  }

  tick() {
    if (!this.ctx || this.muted) return;
    this.tone("square", 1200, 1200, 0.04, 0.05);
  }
}
