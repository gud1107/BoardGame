/**
 * Synthesized sound for 섬광전대 프리즘파이브 (no audio files). A driving
 * sentai-march loop (stage), a minor-key variant (boss) and a slower brass
 * anthem (giant robot), plus punchy combat SFX.
 */

import type { GameEvent } from "./engine";

type Track = "stage" | "boss" | "giant" | "none";

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class PrismAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextNote = 0;
  private beat = 0;
  track: Track = "none";
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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.14;
    this.music.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextNote = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  setTrack(t: Track) {
    if (t === this.track) return;
    this.track = t;
    this.beat = 0;
  }

  dispose() {
    if (this.timer !== null) clearInterval(this.timer);
    try {
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
  }

  // ------------------------------------------------------------ music

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.music || this.track === "none") {
      if (ctx) this.nextNote = ctx.currentTime + 0.1;
      return;
    }
    const bpm = this.track === "giant" ? 120 : this.track === "boss" ? 160 : 150;
    const step = 60 / bpm / 2;
    // Stage: I–V–vi–IV march in D major. Boss: i–VI–VII–i in D minor. Giant: slow anthem.
    const prog = this.track === "boss" ? [0, -4, -2, 0] : this.track === "giant" ? [0, 5, 7, 0] : [0, 7, 9, 5];
    const lead =
      this.track === "boss"
        ? [12, 15, 17, 15, 12, 10, 12, 7, 12, 15, 19, 17, 15, 14, 12, 10]
        : this.track === "giant"
          ? [12, -99, 16, -99, 19, -99, 24, -99, 23, -99, 19, -99, 16, -99, 19, -99]
          : [12, 14, 16, 19, 16, 14, 12, 7, 9, 12, 14, 16, 14, 12, 9, 7];
    while (this.nextNote < ctx.currentTime + 0.25) {
      const b = this.beat;
      const root = 50 + prog[Math.floor(b / 16) % 4];
      const at = this.nextNote;
      // Bass: driving eighths.
      this.tone(midi(root - 12 + (b % 2 ? 12 : 0)), at, step * 0.9, "sawtooth", 0.28, 900);
      // Drums.
      if (b % 4 === 0) this.kick(at);
      if (b % 4 === 2) this.snare(at, 0.5);
      if (this.track !== "giant") this.hat(at, b % 2 ? 0.12 : 0.2);
      // Brass-ish lead.
      const n = lead[b % 16];
      if (n > -99 && (this.track === "giant" || b % 32 >= 16 || this.track === "boss")) this.tone(midi(root + n), at, step * (this.track === "giant" ? 1.8 : 0.85), "square", 0.12, 2200);
      // Power-chord stabs on the downbeat of each bar.
      if (b % 16 === 0) for (const iv of [0, 7, 12]) this.tone(midi(root + iv), at, step * 3, "sawtooth", 0.08, 1600);
      this.nextNote += step;
      this.beat++;
    }
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number, cutoff = 4000, dest?: AudioNode, sweepTo?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(f).connect(g).connect(dest ?? this.music!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private noise(at: number, dur: number, freq: number, gain: number, type: BiquadFilterType = "bandpass", dest?: AudioNode, sweepTo?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(dest ?? this.master!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  private kick(at: number) {
    this.tone(120, at, 0.16, "sine", 0.9, 4000, this.music!, 40);
  }
  private snare(at: number, gain: number) {
    this.noise(at, 0.12, 1800, gain, "bandpass", this.music!);
  }
  private hat(at: number, gain: number) {
    this.noise(at, 0.04, 8000, gain, "highpass", this.music!);
  }

  // ------------------------------------------------------------ sfx

  private get now() {
    return this.ctx?.currentTime ?? 0;
  }

  play(e: GameEvent) {
    if (!this.ctx || !this.master) return;
    const t = this.now;
    const M = this.master;
    switch (e.type) {
      case "swing":
        this.noise(t, e.heavy ? 0.18 : 0.08, e.heavy ? 700 : 2600, e.heavy ? 0.3 : 0.18, "bandpass", M, e.heavy ? 2200 : 5200);
        break;
      case "hit":
        if (e.blocked) {
          this.tone(1800, t, 0.12, "square", 0.12, 6000, M, 1400);
          break;
        }
        this.tone(e.heavy ? 150 : 220, t, e.heavy ? 0.18 : 0.08, "sine", e.onHero ? 0.7 : 0.55, 4000, M, 50);
        this.noise(t, e.heavy ? 0.14 : 0.06, e.heavy ? 900 : 2200, e.heavy ? 0.5 : 0.35, "lowpass", M);
        break;
      case "shoot":
        if (e.kind === "beam") this.tone(900, t, 0.5, "sawtooth", 0.12, 3000, M, 300);
        else if (e.kind === "arrow") this.noise(t, 0.1, 3000, 0.2, "bandpass", M, 6000);
        else if (e.kind === "fist") this.noise(t, 0.6, 400, 0.4, "lowpass", M, 1800);
        else this.tone(1300, t, 0.08, "square", 0.1, 5000, M, 400);
        break;
      case "explode":
        this.noise(t, e.big ? 1.1 : 0.45, e.big ? 300 : 600, e.big ? 0.9 : 0.6, "lowpass", M, 60);
        this.tone(e.big ? 70 : 100, t, e.big ? 0.8 : 0.3, "sine", 0.7, 4000, M, 30);
        break;
      case "ko":
        if (e.boss) {
          for (let i = 0; i < 4; i++) this.noise(t + i * 0.18, 0.6, 400, 0.6, "lowpass", M, 50);
        } else this.tone(500, t, 0.2, "triangle", 0.2, 4000, M, 150);
        break;
      case "skill":
        this.tone(660, t, 0.08, "square", 0.12, 5000, M);
        this.tone(990, t + 0.06, 0.12, "square", 0.12, 5000, M);
        break;
      case "ult":
        [62, 66, 69, 74, 78].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.6, "sawtooth", 0.12, 3000, M));
        this.noise(t, 0.9, 500, 0.3, "bandpass", M, 6000);
        break;
      case "assist":
        this.tone(880, t, 0.1, "triangle", 0.2, 6000, M);
        this.tone(1320, t + 0.08, 0.16, "triangle", 0.2, 6000, M);
        break;
      case "perfect":
        [84, 88, 91, 96].forEach((n, i) => this.tone(midi(n), t + i * 0.04, 0.5, "sine", 0.18, 9000, M));
        break;
      case "break":
        this.noise(t, 0.5, 4000, 0.6, "highpass", M);
        this.tone(1600, t, 0.3, "square", 0.15, 8000, M, 400);
        break;
      case "parry":
        this.tone(2200, t, 0.35, "triangle", 0.3, 9000, M, 1800);
        this.tone(3300, t, 0.25, "sine", 0.2, 9000, M);
        break;
      case "phase":
        this.tone(80, t, 0.9, "sawtooth", 0.4, 600, M, 50);
        break;
      case "bossIntro":
      case "giant":
        [50, 53, 57, 62].forEach((n, i) => this.tone(midi(n), t + i * 0.2, 0.5, "sawtooth", 0.18, 1800, M));
        break;
      case "finishReady":
        [74, 79, 83, 86].forEach((n, i) => this.tone(midi(n), t + i * 0.08, 0.3, "square", 0.12, 5000, M));
        break;
      case "henshin":
        this.tone(220, t, 1.0, "sawtooth", 0.15, 5000, M, 1760);
        [62, 66, 69, 74].forEach((n) => this.tone(midi(n), t + 1.0, 0.8, "square", 0.1, 4000, M));
        break;
      case "go":
        this.tone(988, t, 0.1, "square", 0.15, 5000, M);
        this.tone(988, t + 0.14, 0.1, "square", 0.15, 5000, M);
        break;
      case "pickup":
        this.tone(1047, t, 0.08, "triangle", 0.25, 8000, M);
        this.tone(1568, t + 0.07, 0.14, "triangle", 0.25, 8000, M);
        break;
      case "lifeLost":
        this.tone(440, t, 0.6, "triangle", 0.25, 4000, M, 110);
        break;
      case "comboEnd":
        if (e.combo >= 10) this.tone(1200, t, 0.2, "sine", 0.15, 8000, M, 2400);
        break;
      case "tech":
        this.noise(t, 0.08, 3000, 0.2, "highpass", M);
        break;
      case "clear":
        [62, 66, 69, 74, 78, 81, 86].forEach((n, i) => this.tone(midi(n), t + i * 0.11, 0.5, "square", 0.12, 5000, M));
        break;
      case "over":
        [62, 61, 60, 57].forEach((n, i) => this.tone(midi(n), t + i * 0.25, 0.5, "triangle", 0.2, 3000, M));
        break;
    }
  }
}
