import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore, type AudioSettings } from "@/lib/audio/audioSettings";
import { colorPoints, crownsOf, prestigeOf, SEATS, WIN_CROWNS, WIN_PRESTIGE, WIN_SINGLE_COLOR, type DuelEvent, type SplendorDuelState } from "./engine";

/**
 * 스플렌더 대결 전용 procedural sound suite — "Chamber Noir" trio BGM + gem /
 * card / royal / scroll SFX, all synthesized in code (no audio files, same
 * rule as src/lib/audio/soundEngine.ts).
 *
 * Kept separate from the shared soundEngine on purpose: the shared engine's
 * ambient loop is hard-wired to Spot the Difference's tension motifs, and this
 * suite needs its own instruments (plucked strings, bells, reverb). It still
 * obeys the site-wide audio settings store — header 🔇/🔊, the settings
 * modal's BGM/SFX sliders and this game's own HUD all flip the same flags.
 *
 * Instruments:
 *  - harp / harpsichord / pizzicato: Karplus-Strong plucked string rendered into an
 *    AudioBuffer (cached per pitch), so it sounds like a real string rather
 *    than a bare oscillator.
 *  - bell: inharmonic sine partials (church-bell ratios), each decaying on
 *    its own.
 *  - brass: two detuned saws through a lowpass whose cutoff swells open.
 *  - parchment / pebbles: shaped noise bursts.
 *  - cello: detuned saw pair through a resonant lowpass.
 * Everything runs into a shared generated-impulse "cathedral" reverb send and
 * a master glue compressor; the BGM bus is ducked whenever an SFX fires.
 */

const SEMITONE = Math.pow(2, 1 / 12);
/** MIDI note → Hz. */
const hz = (midi: number) => 440 * Math.pow(SEMITONE, midi - 69);

type Bus = "sfx" | "bgm";

class SplendorDuelSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private duck: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private strings = new Map<string, AudioBuffer>();

  /** True while the board is mounted and wants music; playback additionally needs BGM unmuted. */
  private bgmWanted = false;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private beat = 0;
  /** Tension tier actually playing, and the one requested (applied on the next bar line). */
  private tier: TensionTier = 0;
  private pendingTier: TensionTier = 0;

  private settings(): AudioSettings {
    return useAudioSettingsStore.getState();
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      this.ctx = ctx;

      // Master glue compressor: keeps SFX + BGM tight and un-clipped when they stack.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 12;
      limiter.ratio.value = 5;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      limiter.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.bgmBus = ctx.createGain();
      // BGM runs through a duck stage so every SFX cuts through the music.
      this.duck = ctx.createGain();
      this.sfxBus.connect(limiter);
      this.bgmBus.connect(this.duck).connect(limiter);

      // Cathedral: 2.4s stereo decaying-noise impulse, generated once.
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.4);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      conv.buffer = ir;
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 0.32;
      this.reverbIn.connect(conv);
      conv.connect(limiter);

      const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      this.noise = nb;

      this.applySettings(this.settings());
      useAudioSettingsStore.subscribe((s) => this.applySettings(s));
    }
    return this.ctx;
  }

  private applySettings(s: AudioSettings) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.bgmBus) return;
    const t = ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(isSfxEffectivelyMuted(s) ? 0 : s.sfxVolume * 0.9, t, 0.02);
    this.bgmBus.gain.setTargetAtTime(isBgmEffectivelyMuted(s) ? 0 : s.bgmVolume * 0.6, t, 0.05);
    this.syncBgm();
  }

  /** Call from inside a click/tap handler — resumes the context (autoplay policy). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  private out(bus: Bus) {
    return bus === "sfx" ? this.sfxBus! : this.bgmBus!;
  }

  /** Returns the context only when this bus is audible — skips all synthesis while muted. */
  private ready(bus: Bus): AudioContext | null {
    const s = this.settings();
    if (bus === "sfx" ? isSfxEffectivelyMuted(s) : isBgmEffectivelyMuted(s)) return null;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== "running") return null;
    if (bus === "sfx" && this.duck) {
      // Duck the music ~9dB for the length of a typical cue, then ease back.
      const t = ctx.currentTime;
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setTargetAtTime(0.35, t, 0.015);
      this.duck.gain.setTargetAtTime(1, t + 0.4, 0.3);
    }
    return ctx;
  }

  /* ── Instruments ─────────────────────────────────────────────────────── */

  /** Karplus-Strong string. `damp` < 1 darkens (lute ≈ 0.45, harp ≈ 0.6). */
  private stringBuffer(ctx: AudioContext, freq: number, dur: number, damp: number, decay: number) {
    const key = `${freq.toFixed(2)}|${dur}|${damp}|${decay}`;
    const hit = this.strings.get(key);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const n = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    // Excitation: noise pre-smoothed so the pluck isn't harsh.
    let prev = 0;
    for (let i = 0; i < n && i < len; i++) {
      const r = Math.random() * 2 - 1;
      prev = prev + (r - prev) * (0.35 + damp * 0.5);
      y[i] = prev;
    }
    for (let i = n; i < len; i++) {
      const a = y[i - n];
      const b = i - n - 1 >= 0 ? y[i - n - 1] : a;
      y[i] = decay * (damp * a + (1 - damp) * 0.5 * (a + b));
    }
    if (this.strings.size > 160) this.strings.clear();
    this.strings.set(key, buf);
    return buf;
  }

  private pluck(bus: Bus, t: number, freq: number, opts: { gain?: number; dur?: number; damp?: number; decay?: number; wet?: number; pan?: number; hp?: number } = {}) {
    const ctx = this.ctx!;
    const { gain = 0.5, dur = 1.6, damp = 0.5, decay = 0.996, wet = 0.5, pan = 0, hp } = opts;
    const src = ctx.createBufferSource();
    src.buffer = this.stringBuffer(ctx, freq, dur, damp, decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.1);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      src.connect(f).connect(g).connect(p);
    } else src.connect(g).connect(p);
    p.connect(this.out(bus));
    if (wet > 0 && this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = wet;
      p.connect(send).connect(this.reverbIn);
    }
    src.start(t);
    src.stop(t + dur);
  }

  private bell(t: number, freq: number, gain = 0.25, len = 1.8) {
    const ctx = this.ctx!;
    const partials: [number, number, number][] = [
      [0.5, 0.35, 1],
      [1, 1, 1],
      [1.19, 0.45, 0.8],
      [1.56, 0.3, 0.6],
      [2.0, 0.5, 0.5],
      [2.74, 0.25, 0.35],
      [3.76, 0.12, 0.2],
    ];
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(this.sfxBus!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.9;
      g.connect(send).connect(this.reverbIn);
    }
    for (const [ratio, amp, life] of partials) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * ratio;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(amp, t + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, t + len * life);
      o.connect(e).connect(g);
      o.start(t);
      o.stop(t + len * life + 0.05);
    }
  }

  /** Bright glassy ping — gem struck against gem. */
  private crystal(t: number, freq: number, gain = 0.22, pan = 0) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfxBus!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.6;
      p.connect(send).connect(this.reverbIn);
    }
    for (const [ratio, amp, life] of [
      [1, 1, 0.5],
      [2.01, 0.35, 0.3],
      [3.98, 0.18, 0.16],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * ratio * 0.985, t);
      o.frequency.exponentialRampToValueAtTime(freq * ratio, t + 0.03);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(gain * amp, t + 0.002);
      e.gain.exponentialRampToValueAtTime(0.0001, t + life);
      o.connect(e).connect(p);
      o.start(t);
      o.stop(t + life + 0.02);
    }
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4));
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(e).connect(this.sfxBus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private brass(t: number, freq: number, dur: number, gain = 0.12) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(freq * 1.2, t);
    f.frequency.exponentialRampToValueAtTime(freq * 6, t + 0.08);
    f.frequency.exponentialRampToValueAtTime(freq * 3, t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    e.gain.setValueAtTime(gain * 0.85, t + dur * 0.7);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(e).connect(this.sfxBus!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.5;
      e.connect(send).connect(this.reverbIn);
    }
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Low sine thump — a wax seal / heavy piece landing. */
  private thud(t: number, gain = 0.5) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const e = ctx.createGain();
    e.gain.setValueAtTime(gain, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(e).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.3);
    this.noiseBurst(t, 0.06, "lowpass", 900, 0.7, 0.25);
  }

  /* ── SFX ─────────────────────────────────────────────────────────────── */

  /** 💎 A gem picked off the board (local selection click). */
  gemPick() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    this.crystal(t, hz(93 + Math.floor(Math.random() * 3) * 2), 0.2, (Math.random() - 0.5) * 0.6);
  }

  /** 🪙 Heavy 18K coin: two beating metal partials + a short ring. */
  goldPick() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, a] of [
      [1180, 0.16],
      [1187, 0.16],
      [2950, 0.07],
      [4410, 0.04],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(a, t + 0.003);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(e).connect(this.sfxBus!);
      o.start(t);
      o.stop(t + 0.95);
    }
    this.noiseBurst(t, 0.03, "highpass", 5000, 0.7, 0.12);
  }

  /** Several gems gathered: a quick descending crystal cascade, one ping per token. */
  private gemsTaken(count: number) {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [98, 95, 93, 90];
    for (let i = 0; i < Math.max(1, count); i++) this.crystal(t + i * 0.075, hz(notes[i % notes.length]), 0.18, i % 2 ? 0.25 : -0.25);
    this.noiseBurst(t + count * 0.075, 0.08, "bandpass", 3200, 2, 0.05);
  }

  /** 🃏 Card bought: rising harp arpeggio (D major) + gold shimmer. */
  private cardBuy(goldSpent: number) {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    [62, 66, 69, 74, 78, 81].forEach((m, i) => this.pluck("sfx", t + i * 0.055, hz(m), { gain: 0.42, dur: 1.8, damp: 0.62, decay: 0.998, wet: 0.7, pan: -0.4 + i * 0.16 }));
    for (let i = 0; i < 5 + goldSpent * 2; i++) this.crystal(t + 0.3 + i * 0.045 + Math.random() * 0.02, hz(100 + ((i * 5) % 9)), 0.06, (Math.random() - 0.5) * 0.8);
  }

  /** 📜 Parchment unrolled + a small cathedral bell. */
  private scroll(t0 = 0) {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime + t0;
    for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.05 + Math.random() * 0.02, 0.07, "bandpass", 1800 + Math.random() * 1600, 1.4, 0.16);
    this.noiseBurst(t, 0.32, "bandpass", 900, 0.8, 0.07, 2600);
    this.bell(t + 0.22, hz(79), 0.14, 2.2);
  }

  /** 👑 Royal card: brass fanfare (D–D–A–D major) + a pressed seal thud. */
  private royal() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    const chord = [62, 66, 69];
    chord.forEach((m) => this.brass(t, hz(m), 0.16));
    chord.forEach((m) => this.brass(t + 0.2, hz(m), 0.14));
    [57, 61, 64].forEach((m) => this.brass(t + 0.38, hz(m), 0.2));
    [62, 66, 69, 74].forEach((m) => this.brass(t + 0.62, hz(m), 1.1, 0.11));
    this.thud(t + 0.62, 0.55);
    this.bell(t + 0.64, hz(86), 0.08, 2);
  }

  /** 🔄 Pouch emptied onto the board: tumbling pebbles/gems. */
  private refill() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.5, "bandpass", 700, 0.8, 0.08, 1800);
    for (let i = 0; i < 16; i++) {
      const at = t + i * 0.03 + Math.random() * 0.03;
      this.noiseBurst(at, 0.035, "bandpass", 1500 + Math.random() * 2500, 4, 0.12 + Math.random() * 0.08);
      if (i % 3 === 0) this.crystal(at, hz(88 + Math.floor(Math.random() * 10)), 0.06, (Math.random() - 0.5) * 0.8);
    }
  }

  /** ⏩ Extra turn: clockwork ratchet winding up into a bright gliss. */
  private extraTurn() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 10; i++) this.noiseBurst(t + i * 0.035 * (1 - i * 0.04), 0.018, "bandpass", 2600 + i * 180, 6, 0.14);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(hz(62), t + 0.2);
    o.frequency.exponentialRampToValueAtTime(hz(86), t + 0.5);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t + 0.2);
    e.gain.exponentialRampToValueAtTime(0.14, t + 0.26);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    o.connect(e).connect(this.sfxBus!);
    o.start(t + 0.2);
    o.stop(t + 0.65);
    this.crystal(t + 0.5, hz(98), 0.14);
  }

  /** 🖐️ Steal: tense low string pizzicato, minor second. */
  private steal() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    this.pluck("sfx", t, hz(38), { gain: 0.7, dur: 0.7, damp: 0.3, decay: 0.99, wet: 0.3 });
    this.pluck("sfx", t + 0.14, hz(39), { gain: 0.6, dur: 0.6, damp: 0.3, decay: 0.99, wet: 0.3 });
    this.pluck("sfx", t + 0.28, hz(38), { gain: 0.75, dur: 0.9, damp: 0.3, decay: 0.992, wet: 0.35 });
  }

  /** ✨ Copy-bonus / matching-token ability: a soft shimmer. */
  private shimmer() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    [81, 86, 90, 93].forEach((m, i) => this.crystal(t + i * 0.06, hz(m), 0.1, -0.3 + i * 0.2));
  }

  private reserve(gainedGold: boolean) {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.09, "highpass", 2200, 0.8, 0.16, 5000);
    this.pluck("sfx", t + 0.02, hz(57), { gain: 0.35, dur: 0.8, damp: 0.5 });
    if (gainedGold) this.goldPick();
  }

  private tick() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    this.pluck("sfx", ctx.currentTime, hz(69), { gain: 0.2, dur: 0.4, damp: 0.4, wet: 0.2 });
  }

  victory() {
    const ctx = this.ready("sfx");
    if (!ctx) return;
    this.royal();
    const t = ctx.currentTime + 1.4;
    [62, 69, 74, 78, 81, 86].forEach((m, i) => this.pluck("sfx", t + i * 0.09, hz(m), { gain: 0.4, dur: 2.2, damp: 0.62, decay: 0.998, wet: 0.8 }));
    this.bell(t + 0.5, hz(74), 0.12, 3);
  }

  /** Engine event → cue. `scrollFrom` table/opponent adds the scroll cue on top. */
  event(e: DuelEvent) {
    switch (e.kind) {
      case "take":
        this.gemsTaken(e.count);
        break;
      case "takeMatching":
        this.shimmer();
        this.gemsTaken(1);
        break;
      case "discard":
        this.gemsTaken(1);
        break;
      case "scrollUse":
        this.scroll();
        break;
      case "refill":
        this.refill();
        break;
      case "reserve":
        this.reserve(e.gainedGold);
        break;
      case "buy":
        this.cardBuy(e.goldSpent);
        break;
      case "royal":
        this.royal();
        break;
      case "steal":
        this.steal();
        break;
      case "copy":
        this.shimmer();
        break;
      case "extraTurn":
        this.extraTurn();
        break;
      case "pass":
        this.tick();
        break;
    }
    // A scroll changed hands as a side effect (taking 3 same / 2 pearls, refilling, crowns…).
    if ("scrollFrom" in e && (e.scrollFrom === "table" || e.scrollFrom === "opponent")) this.scroll(0.35);
  }

  /* ── BGM: "Chamber Noir" trio — cello ostinato, pizzicato clock, harpsichord ── */

  /**
   * 112 bpm, D minor, 16 sixteenths per bar. Three voices lock together:
   *  - cello: eighth-note heartbeat ostinato D2 D2 D2 D2 | Bb1 Bb1 | A1 A1
   *    (bowed saw pair through a 380Hz lowpass), accents on 1 and 3;
   *  - pizzicato: off-beat "tick-tock" D3 . D3 . F3 . E3;
   *  - harpsichord: fast sixteenth runs over the same harmony (Dm -> Bb -> A),
   *    one of 4 figures per bar so the 4-bar phrase keeps moving; every 8th bar
   *    drops out for a breath and climbs back in over the A (leading tone C#).
   * 0 in a figure = rest.
   *
   * Late-game tension (`setTension`, fed by `matchTension`) raises the tempo
   * and stacks layers, switching only on a bar line:
   *  - tier 1: 120 bpm, harpsichord's 4' octave string comes forward;
   *  - tier 2: 128 bpm, pizzicato clock doubles to every off-sixteenth of the
   *    last beat, cello drives sixteenths into the downbeat, no breath bars,
   *    timpani on beat 1;
   *  - tier 3: 138 bpm, plus a high violin tremolo grinding a minor second
   *    (A5 / Bb5) over every bar.
   * Each step up is announced once with a timpani crescendo roll.
   */
  private static readonly TEMPOS: Record<TensionTier, number> = { 0: 112, 1: 120, 2: 128, 3: 138 };
  private static readonly CELLO = [38, 38, 38, 38, 34, 34, 33, 33];
  private static readonly CELLO_ACCENT = [1, 0.62, 0.85, 0.6, 0.95, 0.65, 0.95, 0.7];
  private static readonly PIZZ: Record<number, number> = { 2: 50, 6: 50, 10: 53, 14: 52 };
  private static readonly HARPSI: number[][] = [
    [74, 69, 65, 69, 74, 77, 76, 74, 70, 74, 77, 74, 73, 76, 79, 76],
    [62, 65, 69, 74, 72, 69, 65, 67, 65, 70, 74, 70, 64, 69, 73, 76],
    [74, 0, 72, 69, 65, 67, 69, 0, 74, 77, 76, 74, 73, 69, 64, 61],
    [77, 76, 74, 72, 70, 69, 67, 65, 70, 65, 62, 65, 73, 76, 79, 81],
  ];
  /** The breath bar: silence, then a rising run into the next phrase. */
  private static readonly HARPSI_BREATH = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 69, 73, 76, 79];

  /** Board mount/unmount. Actual playback also waits for BGM to be unmuted. */
  setBgmWanted(wanted: boolean) {
    this.bgmWanted = wanted;
    if (!wanted) this.tier = this.pendingTier = 0;
    if (wanted) this.ensure();
    this.syncBgm();
  }

  private syncBgm() {
    const on = this.bgmWanted && !isBgmEffectivelyMuted(this.settings()) && !!this.ctx;
    if (on && !this.bgmTimer) {
      // (Re)start on a bar line so un-muting comes back in tempo, from the top of the phrase.
      this.nextBeatTime = this.ctx!.currentTime + 0.12;
      this.beat = 0;
      this.bgmTimer = setInterval(() => this.schedule(), 50);
    } else if (!on && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  /** Look-ahead clock: queue every sixteenth that falls in the next 0.2s, timed on ctx.currentTime. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (this.nextBeatTime < ctx.currentTime) this.nextBeatTime = ctx.currentTime + 0.05; // tab was throttled
    while (this.nextBeatTime < ctx.currentTime + 0.2) {
      if (this.beat % 16 === 0 && this.pendingTier !== this.tier) {
        if (this.pendingTier > this.tier) this.timpaniRoll(this.nextBeatTime);
        this.tier = this.pendingTier;
      }
      const sixteenth = 60 / SplendorDuelSound.TEMPOS[this.tier] / 4;
      this.playSixteenth(this.beat, this.nextBeatTime, sixteenth);
      this.nextBeatTime += sixteenth;
      this.beat++;
    }
  }

  private playSixteenth(step: number, t: number, sixteenth: number) {
    const S = SplendorDuelSound;
    const tier = this.tier;
    const pos = step % 16;
    const bar = Math.floor(step / 16);

    // Cello: eighth heartbeat; from tier 2 the last beat drives in sixteenths (A1 A1 A1 A1 → downbeat).
    if (pos % 2 === 0) {
      const i = pos / 2;
      this.cello(t, hz(S.CELLO[i]), sixteenth * 1.9, 0.3 * S.CELLO_ACCENT[i] * (1 + tier * 0.08));
    } else if (tier >= 2 && pos >= 13) {
      this.cello(t, hz(33), sixteenth * 0.95, 0.2);
    }
    // Pizzicato clock; from tier 2 it ticks every off-sixteenth of the last beat too.
    const pz = S.PIZZ[pos];
    if (pz) this.pluck("bgm", t, hz(pz), { gain: 0.42 + tier * 0.04, dur: 0.32, damp: 0.35, decay: 0.985, wet: 0.25, pan: -0.35 });
    else if (tier >= 2 && (pos === 13 || pos === 15)) this.pluck("bgm", t, hz(pos === 13 ? 52 : 50), { gain: 0.3, dur: 0.25, damp: 0.35, decay: 0.98, wet: 0.2, pan: -0.35 });

    // Harpsichord runs; breath bars vanish once the race is on.
    const figure = bar % 8 === 7 && tier < 2 ? S.HARPSI_BREATH : S.HARPSI[bar % 4];
    const m = figure[pos];
    if (m) this.harpsichord(t, hz(m), pos % 4 === 0 ? 0.3 : 0.22, tier >= 1 ? 0.6 : 0.35);

    if (tier >= 2 && pos === 0) this.timpani(t, hz(26), 0.5);
    if (tier >= 3 && pos === 0) this.tremolo(t, hz(bar % 2 ? 82 : 81), sixteenth * 16);
  }

  /** Request a tension tier (0–3); takes effect at the next bar line. */
  setTension(tier: TensionTier) {
    this.pendingTier = tier;
  }

  /** Timpani: tuned sine with a pitch drop + felt-mallet noise. */
  private timpani(t: number, freq: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(e).connect(this.bgmBus!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.35;
      e.connect(send).connect(this.reverbIn);
    }
    o.start(t);
    o.stop(t + 0.95);
  }

  /** Tension step-up cue: a half-bar timpani roll swelling into the downbeat `t`. */
  private timpaniRoll(t: number) {
    for (let i = 0; i < 10; i++) this.timpani(t - 0.6 + i * 0.06, hz(26), 0.08 + i * 0.045);
  }

  /** High violin tremolo: saw through a bandpass, amplitude chopped at ~13Hz. */
  private tremolo(t: number, freq: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq * 1.5;
    f.Q.value = 1.4;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 13;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(trem.gain);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    e.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(trem).connect(e).connect(this.bgmBus!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.6;
      e.connect(send).connect(this.reverbIn);
    }
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Bowed cello: detuned saw pair -> resonant 380Hz lowpass, bow-scrape attack. */
  private cello(t: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(240, t);
    f.frequency.linearRampToValueAtTime(380, t + 0.06);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(gain, t + 0.05);
    e.gain.setTargetAtTime(gain * 0.7, t + 0.05, dur * 0.3);
    e.gain.setTargetAtTime(0.0001, t + dur * 0.85, 0.04);
    f.connect(e).connect(this.bgmBus!);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.2;
      e.connect(send).connect(this.reverbIn);
    }
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
  }

  /** Harpsichord: bright plucked 8' string + quieter 4' (octave) string, thinned by a highpass. */
  private harpsichord(t: number, freq: number, gain: number, fourFoot = 0.35) {
    this.pluck("bgm", t, freq, { gain, dur: 0.55, damp: 0.92, decay: 0.994, wet: 0.35, pan: 0.3, hp: 420 });
    this.pluck("bgm", t + 0.004, freq * 2, { gain: gain * fourFoot, dur: 0.35, damp: 0.95, decay: 0.99, wet: 0.3, pan: 0.4, hp: 900 });
  }
}

export type TensionTier = 0 | 1 | 2 | 3;

/**
 * How close the match is to ending, as a BGM tension tier: the nearest either
 * player is to ANY win condition (20 prestige / 10 crowns / 10 in one color).
 * <50% → 0, ≥50% → 1, ≥70% → 2, ≥85% (e.g. 17 pts, 9 crowns, 9 in a color) → 3.
 * Pure (safe for tests); calm again once the game is over.
 */
export function matchTension(state: SplendorDuelState): TensionTier {
  if (state.phase === "gameOver") return 0;
  let p = 0;
  for (const seat of SEATS) {
    const pl = state.players[seat];
    const color = Math.max(...Object.values(colorPoints(pl)));
    p = Math.max(p, prestigeOf(pl) / WIN_PRESTIGE, crownsOf(pl) / WIN_CROWNS, color / WIN_SINGLE_COLOR);
  }
  return p >= 0.85 ? 3 : p >= 0.7 ? 2 : p >= 0.5 ? 1 : 0;
}

let instance: SplendorDuelSound | null = null;

export function getSplendorDuelSound(): SplendorDuelSound {
  if (!instance) instance = new SplendorDuelSound();
  return instance;
}
