/**
 * 반지의 제왕: 가운데땅에서의 대결 — chapter-reactive BGM + cinematic SFX,
 * synthesized entirely with Web Audio (no audio files: this project has never
 * shipped a real audio asset — see `src/lib/audio/bgmManager.ts` and
 * `src/games/mafia/mafiaBgm.ts`, whose structure this file follows).
 *
 * Mute/volume are NOT stored here: BGM follows `audioSettings.ts`'s shared
 * `bgmMuted`/`bgmVolume` (+ `masterMuted`), SFX follows `sfxMuted`/`sfxVolume`,
 * so the header toggle and the settings modal always match what you hear.
 *
 * Notes are scheduled on the audio clock with a small lookahead (not
 * `setInterval` note-by-note), so tempo stays steady even when the main
 * thread is busy with a bot move. A shared generated-impulse reverb gives the
 * "hall" feel to both music and effects.
 *
 * Themes:
 *  - Chapter 1 — 샤이어의 출발: D major pentatonic harp arpeggio, tin whistle
 *    phrase, soft pad, forest-wind ambience (84 BPM).
 *  - Chapter 2 — 전란과 나즈굴의 추격: G minor horn fanfare, tuba bass,
 *    timpani rhythm (100 BPM).
 *  - Chapter 3 — 운명의 산 결전: D minor string ostinato + war drums (128 BPM).
 */

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import type { AllianceRace, Faction } from "./types";

export type LotrTheme = 1 | 2 | 3 | "silence";

export type LotrSfx =
  | "CARD_PICK"
  | "CARD_DISCARD"
  | "CARD_FLIP"
  | "RING_FELLOWSHIP"
  | "RING_NAZGUL"
  | "COMBAT"
  | "LANDMARK"
  | "ALLIANCE"
  | "UNIT_PLACE"
  | "MOVE"
  | "SELECT"
  | "COIN"
  | "MY_TURN"
  | "CHAPTER";

const CROSSFADE_SECONDS = 1.6;
const LOOKAHEAD_SECONDS = 0.25;
const SCHEDULER_MS = 60;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** Note names → MIDI numbers, just enough for the three themes. */
const N: Record<string, number> = {
  G1: 31, A1: 33, Bb1: 34, B1: 35, C2: 36, D2: 38, E2: 40, F2: 41, G2: 43, A2: 45, Bb2: 46, C3: 48, D3: 50, E3: 52, F3: 53, Fs3: 54, G3: 55, A3: 57,
  Bb3: 58, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, Fs4: 66, G4: 67, A4: 69, Bb4: 70, B4: 71, C5: 72, D5: 74, E5: 76, Fs5: 78, A5: 81,
};
const f = (name: string) => hz(N[name]);

interface Voice {
  type: OscillatorType;
  attack?: number;
  release?: number;
  cutoff?: number;
  q?: number;
  detune?: number;
  vibrato?: number;
}

interface ThemeTrack {
  gain: GainNode;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  extras: AudioScheduledSourceNode[];
}

class LotrAudioEngine {
  private ctx: AudioContext | null = null;
  private bgmBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private track: ThemeTrack | null = null;
  private currentTheme: LotrTheme | null = null;
  /** What the board asked for — started as soon as a gesture unlocks audio. */
  private wantedTheme: LotrTheme = "silence";
  private subscribed = false;
  private noise: AudioBuffer | null = null;

  // ------------------------------------------------------------------ setup

  private bgmTarget(): number {
    const s = useAudioSettingsStore.getState();
    return isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * 0.8;
  }
  private sfxTarget(): number {
    const s = useAudioSettingsStore.getState();
    return isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume;
  }

  /** Creates the context only after a user gesture (avoids autoplay warnings). */
  private ensure(create: boolean): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      if (!create) return null;
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(ctx, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.32;
      this.reverbSend.connect(this.reverb).connect(master);

      this.bgmBus = ctx.createGain();
      this.bgmBus.gain.value = this.bgmTarget();
      this.bgmBus.connect(master);
      this.bgmBus.connect(this.reverbSend);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxTarget();
      this.sfxBus.connect(master);
      this.sfxBus.connect(this.reverbSend);
      this.subscribe();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private subscribe() {
    if (this.subscribed) return;
    this.subscribed = true;
    useAudioSettingsStore.subscribe(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.bgmBus?.gain.setTargetAtTime(this.bgmTarget(), t, 0.08);
      this.sfxBus?.gain.setTargetAtTime(this.sfxTarget(), t, 0.05);
    });
  }

  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    return buf;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** Call from a pointer/key handler at least once — unlocks audio and starts the wanted theme. */
  unlock() {
    if (!this.ensure(true)) return;
    if (this.currentTheme !== this.wantedTheme) this.setTheme(this.wantedTheme);
  }

  // ------------------------------------------------------------ primitives

  private tone(out: AudioNode, t: number, freq: number, dur: number, gain: number, v: Voice) {
    const ctx = this.ctx!;
    const attack = v.attack ?? 0.01;
    const release = v.release ?? dur;
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.setValueAtTime(freq, t);
    if (v.detune) osc.detune.value = v.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    let node: AudioNode = osc;
    if (v.cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = v.cutoff;
      lp.Q.value = v.q ?? 0.7;
      node.connect(lp);
      node = lp;
    }
    if (v.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const lg = ctx.createGain();
      lg.gain.value = v.vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + attack + release + 0.05);
    }
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + attack + release + 0.05);
  }

  private noiseHit(out: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 0.8) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** Pitch-dropping sine thump — timpani / war drum body. */
  private drum(out: AudioNode, t: number, from: number, to: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------- BGM

  /** Crossfades to the chapter's theme ("silence" fades out). Safe to call every render-effect. */
  setTheme(theme: LotrTheme) {
    this.wantedTheme = theme;
    const ctx = this.ensure(false);
    if (!ctx || !this.bgmBus) return;
    if (theme === this.currentTheme) return;
    this.fadeOutTrack();
    this.currentTheme = theme;
    if (theme === "silence") return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + CROSSFADE_SECONDS);
    gain.connect(this.bgmBus);
    const track: ThemeTrack = { gain, running: true, timer: null, extras: [] };
    this.track = track;

    const bpm = theme === 1 ? 84 : theme === 2 ? 100 : 128;
    // Chapter 3's ostinato runs in 16ths, the others in 8ths.
    const stepDur = 60 / bpm / (theme === 3 ? 4 : 2);
    const stepsPerBar = theme === 3 ? 16 : 8;
    let step = 0;
    let next = ctx.currentTime + 0.08;

    if (theme === 1) this.startWind(track);

    const tick = () => {
      if (!track.running || !this.ctx) return;
      const now = this.ctx.currentTime;
      // Tab was throttled in the background — skip the backlog instead of bursting it.
      if (next < now - 0.1) next = now + 0.05;
      while (next < now + LOOKAHEAD_SECONDS) {
        if (this.bgmTarget() > 0) {
          const bar = Math.floor(step / stepsPerBar);
          const i = step % stepsPerBar;
          if (theme === 1) this.shireStep(track.gain, next, bar, i, stepDur);
          else if (theme === 2) this.warStep(track.gain, next, bar, i, stepDur);
          else this.doomStep(track.gain, next, bar, i, stepDur);
        }
        step++;
        next += stepDur;
      }
      track.timer = setTimeout(tick, SCHEDULER_MS);
    };
    tick();
  }

  private fadeOutTrack() {
    const tr = this.track;
    if (!tr || !this.ctx) return;
    this.track = null;
    tr.running = false;
    if (tr.timer) clearTimeout(tr.timer);
    const t = this.ctx.currentTime;
    tr.gain.gain.cancelScheduledValues(t);
    tr.gain.gain.setValueAtTime(tr.gain.gain.value, t);
    tr.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_SECONDS);
    setTimeout(
      () => {
        for (const n of tr.extras) {
          try {
            n.stop();
          } catch {
            // already stopped — harmless
          }
        }
        try {
          tr.gain.disconnect();
        } catch {
          // already disconnected — harmless
        }
      },
      CROSSFADE_SECONDS * 1000 + 200,
    );
  }

  /** Chapter 1 forest wind — looping band-passed noise with a slow LFO sweep. */
  private startWind(track: ThemeTrack) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 380;
    lfo.connect(lg).connect(bp.frequency);
    src.connect(bp).connect(g).connect(track.gain);
    src.start();
    lfo.start();
    track.extras.push(src, lfo);
  }

  private shireStep(out: GainNode, t: number, bar: number, i: number, sd: number) {
    const harp: Voice = { type: "triangle", attack: 0.005, release: 1.1, cutoff: 2600 };
    const arps = [
      ["D4", "Fs4", "A4", "D5", "A4", "Fs4", "A4", "B4"],
      ["B3", "D4", "Fs4", "B4", "Fs4", "D4", "E4", "Fs4"],
      ["G3", "B3", "D4", "G4", "D4", "B3", "D4", "E4"],
      ["A3", "D4", "E4", "A4", "E4", "D4", "E4", "Fs4"],
    ];
    const b = bar % 4;
    this.tone(out, t, f(arps[b][i]), sd, 0.07, harp);
    if (i === 0) {
      const roots = ["D2", "B1", "G2", "A2"];
      this.tone(out, t, f(roots[b]), sd * 8, 0.1, { type: "sine", attack: 0.3, release: sd * 7.5 });
      this.tone(out, t, f(roots[b]) * 3, sd * 8, 0.025, { type: "triangle", attack: 0.6, release: sd * 7, cutoff: 900 });
    }
    // Tin-whistle phrase on the second half of the 8-bar cycle.
    const phrase: (string | null)[][] = [
      ["A5", null, "Fs5", null, "E5", "D5", null, null],
      ["E5", null, "Fs5", null, "A5", null, null, null],
      ["B4", null, "D5", "E5", "Fs5", null, "E5", null],
      ["D5", null, null, null, null, null, null, null],
    ];
    if (bar % 8 >= 4) {
      const n = phrase[b][i];
      if (n) this.tone(out, t, f(n), sd * 2, 0.045, { type: "sine", attack: 0.04, release: sd * 2.2, vibrato: 4 });
    }
  }

  private warStep(out: GainNode, t: number, bar: number, i: number, sd: number) {
    const b = bar % 4;
    const roots = ["G1", "Bb1", "C2", "D2"];
    // Tuba — beats 1 and 3, then an octave pickup.
    if (i === 0 || i === 4) this.tone(out, t, f(roots[b]), sd * 2, 0.16, { type: "sawtooth", attack: 0.03, release: sd * 2.4, cutoff: 320 });
    if (i === 7) this.tone(out, t, f(roots[b]) * 2, sd, 0.08, { type: "sawtooth", attack: 0.02, release: sd, cutoff: 380 });
    // Timpani rhythm.
    const timp = [1, 0, 0, 1, 1, 0, 1, 0];
    if (timp[i]) {
      this.drum(out, t, 150, 72, 0.5, i === 0 ? 0.36 : 0.2);
      this.noiseHit(out, t, 0.12, 0.05, "lowpass", 400);
    }
    // Low string pad each bar.
    if (i === 0) {
      const pad = [
        ["G2", "D3", "Bb3"],
        ["Bb2", "F3", "D4"],
        ["C3", "G3", "E4"],
        ["D3", "A3", "Fs3"],
      ];
      for (const n of pad[b]) this.tone(out, t, f(n), sd * 8, 0.03, { type: "sawtooth", attack: sd * 3, release: sd * 5, cutoff: 700, detune: 6 });
    }
    // Horn fanfare every other bar: rising fifths call.
    if (bar % 2 === 1) {
      const call: Record<number, string> = { 0: "G3", 2: "D4", 3: "G4", 6: "F4" };
      const alt: Record<number, string> = { 0: "Bb3", 2: "F4", 3: "Bb4", 6: "A4" };
      const n = (bar % 4 === 1 ? call : alt)[i];
      if (n) {
        const horn: Voice = { type: "sawtooth", attack: 0.07, release: sd * (i === 3 ? 3 : 1.6), cutoff: 1100, q: 1.2 };
        this.tone(out, t, f(n), sd * 2, 0.07, horn);
        this.tone(out, t, f(n) * 0.5, sd * 2, 0.04, { ...horn, detune: -8 });
      }
    }
  }

  private doomStep(out: GainNode, t: number, bar: number, i: number, sd: number) {
    const b = bar % 4;
    const chords = [
      ["D3", "D3", "F3", "D3", "A3", "D3", "F3", "E3"],
      ["Bb2", "Bb2", "D3", "Bb2", "F3", "Bb2", "D3", "C3"],
      ["C3", "C3", "E3", "C3", "G3", "C3", "E3", "D3"],
      ["A2", "A2", "E3", "A2", "C4", "A2", "E3", "Fs3"],
    ];
    // String ostinato on every 16th, accented on the beat.
    const n = chords[b][i % 8];
    this.tone(out, t, f(n), sd, i % 4 === 0 ? 0.065 : 0.04, { type: "sawtooth", attack: 0.004, release: sd * 0.9, cutoff: 1500 });
    // War drums.
    const boom = [0, 3, 8, 10, 11];
    if (boom.includes(i)) {
      this.drum(out, t, i === 0 || i === 8 ? 110 : 160, 40, 0.42, i === 0 || i === 8 ? 0.45 : 0.24);
      this.noiseHit(out, t, 0.18, 0.07, "lowpass", 500);
    }
    if (i === 4 || i === 12) this.noiseHit(out, t, 0.14, 0.06, "bandpass", 1800, 1.2);
    // Low brass swell per bar.
    if (i === 0) {
      const roots = ["D2", "Bb1", "C2", "A1"];
      this.tone(out, t, f(roots[b]), sd * 16, 0.12, { type: "sawtooth", attack: sd * 4, release: sd * 12, cutoff: 420 });
      this.tone(out, t, f(roots[b]) * 1.5, sd * 16, 0.05, { type: "sawtooth", attack: sd * 6, release: sd * 10, cutoff: 600, detune: 7 });
    }
  }

  // ------------------------------------------------------------------- SFX

  play(kind: LotrSfx) {
    const ctx = this.ensure(false);
    if (!ctx || !this.sfxBus || this.sfxTarget() === 0) return;
    const t = ctx.currentTime + 0.01;
    const out = this.sfxBus;
    switch (kind) {
      case "COIN":
        // Coin landing in the treasury: two bright metallic pings.
        [2637, 3520].forEach((fr, k) => this.tone(out, t + k * 0.05, fr, 0.25, 0.06, { type: "triangle", release: 0.28 }));
        this.noiseHit(out, t, 0.05, 0.05, "highpass", 5000);
        break;
      case "SELECT":
        this.tone(out, t, 1320, 0.06, 0.08, { type: "sine", release: 0.07 });
        break;
      case "MY_TURN":
        [f("D5"), f("A5")].forEach((fr, k) => this.tone(out, t + k * 0.12, fr, 0.5, 0.12, { type: "sine", release: 0.6 }));
        break;
      case "CARD_PICK":
        // Card "shoop" + high rune chime.
        this.noiseHit(out, t, 0.18, 0.12, "bandpass", 2400, 0.9);
        [1760, 2217, 2637].forEach((fr, k) => this.tone(out, t + 0.05 + k * 0.05, fr, 0.6, 0.07, { type: "sine", release: 0.7 }));
        break;
      case "CARD_DISCARD":
        this.noiseHit(out, t, 0.22, 0.12, "bandpass", 1200, 0.7);
        this.tone(out, t + 0.05, 988, 0.3, 0.06, { type: "triangle", release: 0.3 });
        this.tone(out, t + 0.12, 1319, 0.3, 0.05, { type: "sine", release: 0.4 });
        break;
      case "CARD_FLIP":
        [2349, 2960, 3520].forEach((fr, k) => this.tone(out, t + k * 0.04, fr, 0.4, 0.04, { type: "sine", release: 0.45 }));
        break;
      case "RING_FELLOWSHIP":
      case "RING_NAZGUL": {
        // The One Ring's hum: a low beating dyad with a whispered noise swell.
        const dark = kind === "RING_NAZGUL";
        const base = dark ? 73.4 : 110;
        this.tone(out, t, base, 1.6, 0.14, { type: "sine", attack: 0.25, release: 1.4 });
        this.tone(out, t, base * 1.01, 1.6, 0.12, { type: "sine", attack: 0.25, release: 1.4 });
        this.tone(out, t, base * (dark ? 1.414 : 2), 1.4, 0.05, { type: "triangle", attack: 0.3, release: 1.1, cutoff: 900 });
        this.noiseHit(out, t + 0.1, 1.1, 0.05, "bandpass", dark ? 900 : 3200, 4);
        const bells = dark ? [293.7, 277.2, 220] : [523.25, 659.25, 783.99];
        bells.forEach((fr, k) => this.tone(out, t + 0.15 + k * 0.09, fr, 0.9, 0.08, { type: "sine", release: 0.9 }));
        break;
      }
      case "COMBAT": {
        // Steel on steel: noise crack + inharmonic metallic partials + low body hit + a distant shout.
        this.noiseHit(out, t, 0.25, 0.4, "highpass", 2500);
        [1873, 2511, 3320, 4187].forEach((fr) => this.tone(out, t, fr, 0.5, 0.05, { type: "square", release: 0.45, cutoff: 6000 }));
        this.drum(out, t, 180, 45, 0.45, 0.45);
        this.noiseHit(out, t + 0.12, 0.5, 0.08, "bandpass", 650, 1.5);
        this.tone(out, t + 0.12, 180, 0.5, 0.05, { type: "sawtooth", attack: 0.05, release: 0.45, cutoff: 800, vibrato: 8 });
        break;
      }
      case "LANDMARK":
        // Rising stone rumble, then the gate slam.
        this.noiseHit(out, t, 0.9, 0.18, "lowpass", 220);
        this.tone(out, t, 55, 0.9, 0.2, { type: "triangle", attack: 0.3, release: 0.6 });
        this.drum(out, t + 0.75, 120, 35, 0.8, 0.6);
        this.noiseHit(out, t + 0.75, 0.35, 0.25, "lowpass", 900);
        [f("D4"), f("A4"), f("D5")].forEach((fr) => this.tone(out, t + 0.8, fr, 1.2, 0.05, { type: "sawtooth", attack: 0.05, release: 1.1, cutoff: 1400 }));
        break;
      case "ALLIANCE":
        // Harp glissando into a brass fanfare chord.
        ["D4", "Fs4", "A4", "D5", "Fs5", "A5"].forEach((n, k) => this.tone(out, t + k * 0.055, f(n), 0.8, 0.07, { type: "triangle", release: 0.9, cutoff: 3200 }));
        ["D4", "A4", "D5", "Fs5"].forEach((n) => this.tone(out, t + 0.4, f(n), 1.3, 0.06, { type: "sawtooth", attack: 0.06, release: 1.2, cutoff: 1800 }));
        break;
      case "UNIT_PLACE":
        this.drum(out, t, 140, 60, 0.25, 0.25);
        this.noiseHit(out, t, 0.08, 0.08, "bandpass", 1600);
        break;
      case "MOVE":
        this.noiseHit(out, t, 0.2, 0.08, "bandpass", 800);
        this.drum(out, t + 0.1, 120, 60, 0.2, 0.18);
        break;
      case "CHAPTER":
        this.drum(out, t, 90, 30, 1.2, 0.5);
        [f("D3"), f("A3"), f("D4")].forEach((fr) => this.tone(out, t, fr, 2, 0.06, { type: "sawtooth", attack: 0.3, release: 1.8, cutoff: 900 }));
        break;
    }
  }

  /** Alliance token — flavour varies a little with the race. */
  playAlliance(race: AllianceRace) {
    this.play("ALLIANCE");
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || this.sfxTarget() === 0) return;
    const accent: Record<AllianceRace, number> = { ELF: 1760, DWARF: 220, HOBBIT: 1175, HUMAN: 587, ENT: 110, WIZARD: 2349 };
    this.tone(this.sfxBus, ctx.currentTime + 0.5, accent[race], 1.2, 0.05, { type: "sine", attack: 0.02, release: 1.2 });
  }

  /** Ending theme — the Fellowship's is bright bells and brass, Sauron's a low gong and minor horns. */
  playEnding(winner: Faction) {
    const ctx = this.ensure(false);
    if (!ctx || !this.sfxBus || this.sfxTarget() === 0) return;
    const out = this.sfxBus;
    const t = ctx.currentTime + 0.05;
    if (winner === "FELLOWSHIP") {
      const line = ["D4", "A4", "D5", "Fs5", "E5", "D5", "A5"];
      line.forEach((n, k) => {
        this.tone(out, t + k * 0.28, f(n), 0.6, 0.09, { type: "sawtooth", attack: 0.05, release: 0.55, cutoff: 2000 });
        this.tone(out, t + k * 0.28, f(n) / 2, 0.6, 0.05, { type: "triangle", attack: 0.05, release: 0.55 });
      });
      ["D3", "A3", "D4", "Fs4", "A4"].forEach((n) => this.tone(out, t + 2, f(n), 3, 0.06, { type: "sawtooth", attack: 0.2, release: 2.8, cutoff: 1600 }));
      [1175, 1480, 1760, 2349].forEach((fr, k) => this.tone(out, t + 2 + k * 0.2, fr, 2.5, 0.07, { type: "sine", release: 2.6 }));
      this.drum(out, t + 2, 100, 40, 1.5, 0.5);
    } else {
      this.tone(out, t, 55, 4, 0.25, { type: "sine", attack: 0.02, release: 4 });
      [110, 163, 227, 311].forEach((fr) => this.tone(out, t, fr, 3.5, 0.05, { type: "sine", release: 3.4 }));
      this.noiseHit(out, t, 2.5, 0.12, "lowpass", 300);
      ["D3", "F3", "A3", "Bb3", "A3"].forEach((n, k) => this.tone(out, t + 0.8 + k * 0.45, f(n), 0.8, 0.08, { type: "sawtooth", attack: 0.08, release: 0.8, cutoff: 800 }));
      this.drum(out, t + 3, 80, 30, 1.8, 0.55);
    }
  }

  /** Unmount — fade the music out and forget the wanted theme. */
  stop() {
    this.wantedTheme = "silence";
    this.fadeOutTrack();
    this.currentTheme = null;
  }
}

let instance: LotrAudioEngine | null = null;

export function getLotrAudio(): LotrAudioEngine {
  if (!instance) instance = new LotrAudioEngine();
  return instance;
}
