/**
 * Fully synthesized audio via the Web Audio API — no external sound/music
 * files. There is no legal/reliable way for this project to embed real
 * royalty-free tracks, and generating tones/noise in code has zero asset
 * weight and no licensing question. Two things live here:
 *
 *  - `startFuseCrackle`/`stopFuseCrackle`: a repeating "burning rope" SFX
 *    (filtered noise bursts) for the last few seconds of a countdown.
 *  - `startBgm`/`stopBgm`: a tiny "playlist" of tense ambient motifs, one
 *    picked at random each time a loop finishes, so the background music
 *    plays some mix of random + cycling for as long as a game is active.
 *  - `playDiceRattle`/`playCupThud`: Perudo's dice-cup shake/reveal SFX — a
 *    burst of short filtered noise "clicks" that thin out as the shake
 *    settles, then a low pitch-dropping thump for the cup landing.
 *  - `playCorrectDing`/`playWrongBuzz`: Spot the Difference's found/missed
 *    click feedback — a bright ascending two-note chime vs. a short flat
 *    buzz timed to the wrong-click penalty lock.
 *
 * Browsers refuse to start audio before a user gesture, so `unlock()` (or
 * any of the play/start methods, which call it internally) must be invoked
 * from inside a click/tap handler at least once.
 */

const MUTE_KEY = "bg_sound_muted";

type MotifFn = (ctx: AudioContext, out: GainNode) => number; // returns loop length in seconds

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Slow detuned drone (beating dissonance) with a distant dissonant "sting" near the end. */
function tenseDroneMotif(ctx: AudioContext, out: GainNode): number {
  const duration = 16;
  const now = ctx.currentTime;
  for (const freq of [55, 58.5]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 1.5);
    gain.gain.setValueAtTime(0.16, now + duration - 1.5);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + duration);
  }
  const stingAt = now + duration - 3;
  const sting = ctx.createOscillator();
  sting.type = "triangle";
  sting.frequency.value = 233; // dissonant interval above the drone
  const stingGain = ctx.createGain();
  stingGain.gain.setValueAtTime(0, stingAt);
  stingGain.gain.linearRampToValueAtTime(0.1, stingAt + 0.4);
  stingGain.gain.exponentialRampToValueAtTime(0.001, stingAt + 2.5);
  sting.connect(stingGain).connect(out);
  sting.start(stingAt);
  sting.stop(stingAt + 2.5);
  return duration;
}

/** Rhythmic low "heartbeat" thumps under a thin sustained pad — faster tension. */
function heartbeatPulseMotif(ctx: AudioContext, out: GainNode): number {
  const duration = 8;
  const now = ctx.currentTime;
  const beat = 60 / 100; // 100bpm
  for (let t = 0; t < duration; t += beat) {
    const at = now + t;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.2);
  }
  const pad = ctx.createOscillator();
  pad.type = "sawtooth";
  pad.frequency.value = 110;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 300;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.05;
  pad.connect(padFilter).connect(padGain).connect(out);
  pad.start(now);
  pad.stop(now + duration);
  return duration;
}

/** Fast dissonant square-wave arpeggio (root/minor-3rd/tritone) — the most "urgent" motif. */
function dissonantArpMotif(ctx: AudioContext, out: GainNode): number {
  const duration = 12;
  const now = ctx.currentTime;
  const root = 220;
  const intervalsInSemitones = [0, 3, 6, 3];
  const noteLen = 0.22;
  let t = 0;
  let i = 0;
  while (t < duration) {
    const semis = intervalsInSemitones[i % intervalsInSemitones.length];
    const freq = root * Math.pow(2, semis / 12);
    const at = now + t;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + noteLen * 0.9);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + noteLen);
    t += noteLen;
    i++;
  }
  return duration;
}

const MOTIFS: MotifFn[] = [tenseDroneMotif, heartbeatPulseMotif, dissonantArpMotif];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer: ReturnType<typeof setTimeout> | null = null;
  private bgmToken = 0;
  private fuseTimer: ReturnType<typeof setInterval> | null = null;

  isMuted(): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(MUTE_KEY) === "1";
  }

  setMuted(muted: boolean) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /** Lazily creates (and resumes) the shared AudioContext. Must be reached from a user-gesture handler at least once. */
  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.isMuted() ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Call from any click/tap handler to unlock audio ahead of time. */
  unlock() {
    this.ensureContext();
  }

  private crackleBurst() {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800 + Math.random() * 2500;
    filter.Q.value = 6 + Math.random() * 6;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12 + Math.random() * 0.1);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    src.stop(now + 0.3);
  }

  /** Repeating "burning fuse/rope" crackle — idempotent, safe to call every tick while urgent. */
  startFuseCrackle() {
    if (this.fuseTimer) return;
    this.crackleBurst();
    this.fuseTimer = setInterval(() => this.crackleBurst(), 220 + Math.random() * 160);
  }

  stopFuseCrackle() {
    if (this.fuseTimer) {
      clearInterval(this.fuseTimer);
      this.fuseTimer = null;
    }
  }

  startBgm() {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this.bgmTimer) return;
    if (!this.bgmGain) {
      this.bgmGain = ctx.createGain();
      this.bgmGain.gain.value = 0.5;
      this.bgmGain.connect(this.master);
    }
    this.bgmToken++;
    this.scheduleNextMotif(this.bgmToken);
  }

  private scheduleNextMotif(token: number) {
    if (!this.ctx || !this.bgmGain || token !== this.bgmToken) return;
    const motif = MOTIFS[Math.floor(Math.random() * MOTIFS.length)];
    const durationSeconds = motif(this.ctx, this.bgmGain);
    this.bgmTimer = setTimeout(() => this.scheduleNextMotif(token), durationSeconds * 1000);
  }

  private diceClick() {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000 + Math.random() * 2000;
    filter.Q.value = 8 + Math.random() * 8;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05 + Math.random() * 0.03);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    src.stop(now + 0.1);
  }

  /** A burst of dice-in-cup "click" noises that thin out toward the end of `durationMs`, self-scheduling via setTimeout (no AudioContext-relative scheduling needed since each click is independent). */
  playDiceRattle(durationMs = 800) {
    if (!this.ensureContext()) return;
    const start = performance.now();
    const scheduleClick = () => {
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs) return;
      this.diceClick();
      const progress = elapsed / durationMs;
      const nextDelay = 35 + progress * 90 + Math.random() * 40; // clicks get sparser as the shake settles
      setTimeout(scheduleClick, nextDelay);
    };
    scheduleClick();
  }

  /** Low pitch-dropping thump + a short noise "knock" transient — the cup landing/flipping down after a shake. */
  playCupThud() {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(filter).connect(noiseGain).connect(this.master);
    src.start(now);
    src.stop(now + 0.1);
  }

  /** Bright ascending two-note chime — a spot-the-difference correct click. */
  playCorrectDing() {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const at = now + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.28);
      osc.connect(gain).connect(this.master!);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  }

  /** Short flat buzz — a spot-the-difference wrong click (paired with the penalty lock). */
  playWrongBuzz() {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  stopBgm() {
    this.bgmToken++; // invalidates any in-flight scheduled continuation
    if (this.bgmTimer) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.bgmGain) {
      this.bgmGain.disconnect();
      this.bgmGain = null;
    }
  }
}

let instance: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
  if (!instance) instance = new SoundEngine();
  return instance;
}
