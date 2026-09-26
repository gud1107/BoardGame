/**
 * Synthesized SFX for 배고픈 상어 (no audio files — project-wide rule, see
 * memory note on Dalmuti voice). Everything routes through one master gain
 * and an underwater low-pass filter that opens up while the shark is airborne
 * (spec §8 stage 4: "수중 사운드(로우패스 필터링)").
 */

export class SharkAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private ambient: AudioBufferSourceNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastHeartbeat = 0;
  muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
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
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = 1400;
    this.lowpass.connect(this.master);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise: smoother, reads as "water".
      last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985;
      d[i] = last * 3;
    }
    this.startAmbient();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  setAirborne(air: boolean) {
    if (this.lowpass && this.ctx) this.lowpass.frequency.setTargetAtTime(air ? 9000 : 1400, this.ctx.currentTime, 0.08);
  }

  dispose() {
    try {
      this.ambient?.stop();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
  }

  private startAmbient() {
    if (!this.ctx || !this.noiseBuf || !this.lowpass) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    src.connect(f).connect(g).connect(this.lowpass);
    src.start();
    this.ambient = src;
  }

  private noise(dur: number, freq: number, q: number, gain: number, sweepTo?: number, type: BiquadFilterType = "bandpass") {
    if (!this.ctx || !this.noiseBuf || !this.lowpass) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.lowpass);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0, bypassFilter = false) {
    if (!this.ctx || !this.lowpass || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bypassFilter ? this.master : this.lowpass);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  crunch(big = false) {
    this.noise(big ? 0.22 : 0.1, big ? 700 : 1400, 1.2, big ? 0.9 : 0.5);
    this.tone(big ? 110 : 180, 0.12, "square", 0.12, 60);
  }
  gulp() {
    this.tone(320, 0.14, "sine", 0.25, 120);
  }
  hurt() {
    this.tone(140, 0.25, "sawtooth", 0.2, 70);
    this.noise(0.15, 500, 0.8, 0.4);
  }
  explosion(big: boolean) {
    this.noise(big ? 1.4 : 0.9, 900, 0.5, 1.2, 60, "lowpass");
    this.tone(70, big ? 0.9 : 0.6, "sine", 0.6, 30);
  }
  splash(strength: number) {
    this.noise(0.5 + strength * 0.4, 3000, 0.6, 0.35 + strength * 0.5, 400);
  }
  jump() {
    this.noise(0.3, 2500, 0.7, 0.3, 5000);
  }
  bounce() {
    this.tone(220, 0.08, "triangle", 0.15, 180);
  }
  coin() {
    this.tone(1320, 0.08, "square", 0.05, undefined, 0, true);
    this.tone(1760, 0.12, "square", 0.05, undefined, 0.06, true);
  }
  poison() {
    this.tone(600, 0.3, "sine", 0.15, 300);
    this.tone(640, 0.3, "sine", 0.1, 330, 0.05);
  }
  torpedo() {
    this.tone(900, 0.4, "sawtooth", 0.06, 400);
  }
  goldRush(mega: boolean) {
    const notes = mega ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
    notes.forEach((n, i) => this.tone(n, 0.25, "triangle", 0.18, undefined, i * 0.08, true));
  }
  goldEnd() {
    [784, 659, 523].forEach((n, i) => this.tone(n, 0.2, "triangle", 0.1, undefined, i * 0.08, true));
  }
  mission() {
    [659, 880, 1175].forEach((n, i) => this.tone(n, 0.18, "square", 0.07, undefined, i * 0.09, true));
  }
  death() {
    this.tone(220, 1.2, "sawtooth", 0.2, 40);
  }
  /** Rate-limited heartbeat thump pair for the low-HP warning. */
  heartbeat(nowMs: number, urgency: number) {
    const interval = 900 - urgency * 400;
    if (nowMs - this.lastHeartbeat < interval) return;
    this.lastHeartbeat = nowMs;
    this.tone(70, 0.12, "sine", 0.5, 50, 0, true);
    this.tone(62, 0.12, "sine", 0.4, 45, 0.16, true);
  }
}
