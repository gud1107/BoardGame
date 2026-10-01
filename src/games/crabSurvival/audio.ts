/**
 * Synthesized SFX + beach ambience for 꽃게 서바이벌 (no audio files — the
 * project synthesizes all sound in code). One master gain; a soft wave-noise
 * bed plus a light marimba-ish loop that picks up tempo while you're king.
 */

import type { SpeciesId } from "./data";

export class CrabAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private waves: AudioBufferSourceNode | null = null;
  private musicTimer: number | null = null;
  private beat = 0;
  private nextNote = 0;
  king = false;
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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startWaves();
    this.nextNote = ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 60);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  dispose() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    try {
      this.waves?.stop();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
  }

  private startWaves() {
    if (!this.ctx || !this.noiseBuf || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    // Slow swell like surf rolling in.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.waves = src;
  }

  // Pentatonic island loop; two bars of bass + a marimba arpeggio.
  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const bpm = this.king ? 132 : 112;
    const stepDur = 60 / bpm / 2;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const chords = [0, -3, 5, 2];
    const pattern = [0, 2, 4, 2, 5, 4, 2, 1];
    while (this.nextNote < ctx.currentTime + 0.25) {
      const b = this.beat;
      const chord = chords[Math.floor(b / 16) % 4];
      const root = 57 + chord; // A3-based
      if (b % 4 === 0) this.tone(midi(root - 12), this.nextNote, 0.32, "triangle", 0.5, this.musicGain);
      const deg = pattern[b % 8] + (Math.floor(b / 8) % 2 ? 1 : 0);
      if (b % 2 === 0 || this.king) this.marimba(midi(root + 12 + scale[deg % scale.length]), this.nextNote, 0.28);
      if (b % 8 === 4) this.shaker(this.nextNote);
      this.nextNote += stepDur;
      this.beat++;
    }
  }

  private marimba(freq: number, at: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o2.type = "sine";
    o.frequency.value = freq;
    o2.frequency.value = freq * 4;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicGain!);
    o.start(at);
    o2.start(at);
    o.stop(at + 0.4);
    o2.stop(at + 0.4);
  }

  private shaker(at: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.08);
    src.connect(f).connect(g).connect(this.musicGain!);
    src.start(at, Math.random());
    src.stop(at + 0.1);
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number, dest?: AudioNode, sweepTo?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest ?? this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass", sweepTo?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.master) return;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 1.5);
    src.stop(at + dur + 0.05);
  }

  private get now() {
    return this.ctx?.currentTime ?? 0;
  }

  /** Claw "snip" / weapon whoosh. */
  swing(heavy: boolean) {
    if (!this.ctx) return;
    if (heavy) this.noise(0.22, 400, 1.2, 0.35, "bandpass", 1600);
    else {
      this.noise(0.09, 2400, 2, 0.22, "bandpass", 5200);
      this.tone(1800, this.now, 0.04, "square", 0.05);
    }
  }
  hit(crit: boolean) {
    if (!this.ctx) return;
    this.tone(crit ? 180 : 140, this.now, 0.12, "sine", 0.55, undefined, 60);
    this.noise(0.08, 1200, 1, 0.35, "lowpass");
    if (crit) this.tone(1320, this.now + 0.01, 0.12, "triangle", 0.12, undefined, 1760);
  }
  hurt() {
    if (!this.ctx) return;
    this.tone(220, this.now, 0.18, "sawtooth", 0.18, undefined, 90);
    this.noise(0.1, 800, 1, 0.3, "lowpass");
  }
  guard() {
    if (!this.ctx) return;
    this.tone(1250, this.now, 0.18, "triangle", 0.2, undefined, 1150);
    this.tone(1870, this.now, 0.12, "sine", 0.1);
  }
  breakItem() {
    if (!this.ctx) return;
    this.noise(0.3, 3000, 0.8, 0.3, "highpass");
    this.tone(600, this.now, 0.2, "square", 0.08, undefined, 150);
  }
  boxBreak(gold: boolean) {
    if (!this.ctx) return;
    this.noise(0.22, 700, 1.4, 0.4, "bandpass", 300);
    if (gold) [880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, this.now + i * 0.06, 0.25, "triangle", 0.15));
  }
  locked() {
    if (!this.ctx) return;
    this.tone(300, this.now, 0.08, "square", 0.08);
    this.tone(260, this.now + 0.09, 0.1, "square", 0.08);
  }
  eat() {
    if (!this.ctx) return;
    this.tone(520 + Math.random() * 120, this.now, 0.07, "sine", 0.18, undefined, 900);
  }
  coin() {
    if (!this.ctx) return;
    this.tone(1318, this.now, 0.06, "square", 0.06);
    this.tone(1976, this.now + 0.05, 0.12, "square", 0.06);
  }
  equip() {
    if (!this.ctx) return;
    this.tone(440, this.now, 0.08, "triangle", 0.2);
    this.tone(660, this.now + 0.07, 0.12, "triangle", 0.2);
  }
  key() {
    if (!this.ctx) return;
    [1568, 2093].forEach((f, i) => this.tone(f, this.now + i * 0.07, 0.15, "sine", 0.18));
  }
  levelUp(species?: SpeciesId) {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, this.now + i * 0.08, 0.3, "triangle", 0.22));
    const at = this.now + 0.34;
    switch (species) {
      case "flower": // soft chime sparkle
        [1568, 2093, 2637].forEach((f, i) => this.tone(f, at + i * 0.06, 0.35, "sine", 0.1));
        break;
      case "fiddler": // heavy claw slam
        this.tone(110, at, 0.35, "sine", 0.6, undefined, 45);
        this.noise(0.25, 300, 0.8, 0.45, "lowpass", 80);
        break;
      case "ghost": // whoosh up
        this.noise(0.35, 600, 1.2, 0.3, "bandpass", 5000);
        break;
      case "snow": // icy ring
        this.tone(2637, at, 0.5, "triangle", 0.1, undefined, 2349);
        this.tone(3520, at + 0.05, 0.4, "sine", 0.06);
        break;
      case "hermit": // hollow shell knock
        this.tone(420, at, 0.18, "triangle", 0.3, undefined, 380);
        this.tone(630, at + 0.1, 0.22, "triangle", 0.2, undefined, 560);
        break;
      case "mitten": // warm pulse
        [392, 523].forEach((f, i) => this.tone(f, at + i * 0.12, 0.35, "sine", 0.22));
        break;
      case "hairy": // electric zap
        this.tone(1800, at, 0.2, "sawtooth", 0.08, undefined, 300);
        this.noise(0.12, 4000, 1.5, 0.2, "highpass");
        break;
      case "redsnow": // coin shower
        [1318, 1568, 1976, 2349, 2637].forEach((f, i) => this.tone(f, at + i * 0.045, 0.1, "square", 0.05));
        break;
    }
  }
  counter() {
    if (!this.ctx) return;
    this.tone(1760, this.now, 0.15, "sawtooth", 0.08, undefined, 880);
  }
  fanfare() {
    if (!this.ctx) return;
    const seq = [523, 523, 784, 1047];
    seq.forEach((f, i) => {
      this.tone(f, this.now + i * 0.13, 0.3, "square", 0.08);
      this.tone(f / 2, this.now + i * 0.13, 0.3, "triangle", 0.12);
    });
  }
  kingDown() {
    if (!this.ctx) return;
    [784, 659, 523, 392].forEach((f, i) => this.tone(f, this.now + i * 0.12, 0.3, "triangle", 0.15));
  }
  death() {
    if (!this.ctx) return;
    this.tone(330, this.now, 0.9, "sawtooth", 0.18, undefined, 55);
    this.noise(0.6, 500, 0.8, 0.3, "lowpass", 100);
  }
  heal() {
    if (!this.ctx) return;
    this.tone(880, this.now, 0.25, "sine", 0.08, undefined, 1320);
  }
  /** Field weapon picked up: a bright mechanical "ka-chunk". */
  gear() {
    if (!this.ctx) return;
    this.noise(0.06, 3000, 2, 0.25, "bandpass");
    [660, 990, 1320].forEach((f, i) => this.tone(f, this.now + 0.05 + i * 0.05, 0.12, "square", 0.07));
  }
  mutation(risk: boolean) {
    if (!this.ctx) return;
    if (risk) {
      this.tone(330, this.now, 0.35, "sawtooth", 0.1, undefined, 165);
      this.tone(311, this.now + 0.04, 0.35, "sawtooth", 0.08, undefined, 155);
    } else [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, this.now + i * 0.05, 0.22, "sine", 0.14));
  }
  /** Tier skills: 1 roll whoosh, 2 bubble pops, 3 sand rumble, 4 hydro laser. */
  skill(tier: number) {
    if (!this.ctx) return;
    switch (tier) {
      case 1:
        this.noise(0.25, 500, 1, 0.35, "bandpass", 3500);
        break;
      case 2:
        for (let i = 0; i < 6; i++) this.tone(500 + Math.random() * 700, this.now + i * 0.035, 0.06, "sine", 0.18, undefined, 1400);
        break;
      case 3:
        this.noise(0.5, 220, 0.7, 0.45, "lowpass", 90);
        break;
      case 4:
        this.tone(140, this.now, 0.6, "sawtooth", 0.2, undefined, 70);
        this.noise(0.6, 1800, 0.6, 0.4, "bandpass", 600);
        this.tone(2400, this.now, 0.4, "sine", 0.06, undefined, 1200);
        break;
    }
  }
  blast() {
    if (!this.ctx) return;
    this.tone(90, this.now, 0.4, "sine", 0.5, undefined, 40);
    this.noise(0.35, 600, 0.8, 0.4, "lowpass", 120);
  }
}

function midi(n: number) {
  return 440 * Math.pow(2, (n - 69) / 12);
}
