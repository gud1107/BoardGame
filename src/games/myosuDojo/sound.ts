/**
 * Synthesized SFX for 묘수 도장 (no audio files): ball/stone clack, cushion
 * thud, pocket/fall drop, domino tick, bell, bomb, chess piece set-down and
 * clear/fail stingers. One shared context; 🔇 flips the master gain.
 */

class DojoAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock() {
    if (typeof window === "undefined") return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.03);
  }

  private burst(dur: number, freq: number, q: number, vol: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
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

  clack(power = 0.6) {
    this.burst(0.05, 2600, 3, 0.25 + power * 0.5);
    this.tone("triangle", 1800, 900, 0.04, 0.12 + power * 0.2);
  }
  rail(power = 0.5) {
    this.burst(0.09, 380, 1.2, 0.2 + power * 0.4);
  }
  drop() {
    this.tone("sine", 320, 90, 0.22, 0.35);
    this.burst(0.12, 600, 1, 0.2, 0.05);
  }
  cue() {
    this.burst(0.04, 3200, 4, 0.5);
  }
  tick() {
    this.burst(0.035, 1700, 6, 0.35);
  }
  bell(v = 1) {
    const f = 880 + v * 220;
    this.tone("sine", f, f, 0.6, 0.25);
    this.tone("sine", f * 2.01, f * 2.01, 0.35, 0.08);
  }
  boom() {
    this.burst(0.5, 160, 0.8, 0.9);
    this.tone("sine", 120, 40, 0.45, 0.5);
  }
  place() {
    this.tone("triangle", 520, 420, 0.06, 0.2);
  }
  piece() {
    this.burst(0.06, 900, 2, 0.45);
    this.tone("sine", 240, 160, 0.08, 0.25);
  }
  clear(stars: number) {
    const notes = [523, 659, 784, 1047].slice(0, 1 + stars);
    notes.forEach((f, i) => this.tone("triangle", f, f, 0.28, 0.22, i * 0.11));
  }
  fail() {
    this.tone("sawtooth", 300, 140, 0.35, 0.12);
  }
}

export const dojoAudio = new DojoAudio();
