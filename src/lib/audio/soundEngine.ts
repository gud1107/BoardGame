/**
 * Sound effects via the Web Audio API — no external SFX files. There is no
 * legal/reliable way for this project to embed real royalty-free SFX (see
 * `저작권, 상표권.md`, which flags "배경음악" as copyright-protected
 * expression like any other), and generating tones/noise in code has zero
 * asset weight and no licensing question. This file owns every *effect*
 * sound in the project plus one legacy ambient-loop pathway (`startBgm`/
 * `stopBgm`, still used by Spot the Difference); the six hub games' new
 * *themed background music* is real royalty-free `<audio>` playback instead
 * (see `bgmManager.ts`) — SFX and BGM are deliberately different pipelines
 * with independent mute/volume, both reading from the single shared
 * `audioSettings.ts` store.
 *
 * Mute/volume model (2026-08-26 세션, site-wide audio rollout):
 *  - `isMuted()`/`setMuted()` are now thin proxies onto `audioSettings.ts`'s
 *    shared `masterMuted` flag (previously this file owned its own
 *    `bg_sound_muted` localStorage key directly) — every existing call site
 *    (Perudo/Dalmuti/Grid Poker's mute buttons) keeps working unchanged,
 *    but now toggles the same flag the header's global 🔇/🔊 button and the
 *    settings modal use, so every mute control in the app stays in sync.
 *  - One-shot SFX run through `sfxGain`, gated by `sfxMuted`+`sfxVolume`.
 *    The legacy ambient `startBgm`/`stopBgm` loop runs through a *separate*
 *    `bgmGain`, gated by `bgmMuted`+`bgmVolume` — so a user can duck one
 *    without the other via the settings modal's two sliders.
 *  - Polyphony control: `gate()` applies a per-SFX-type cooldown (so e.g.
 *    two nearly-simultaneous `CARD_PLAY` events don't both fire and smear
 *    together) plus a global concurrent-channel cap (so a burst of *different*
 *    SFX firing at once — dice + chips + a spark, say — can't pile up
 *    indefinitely). The rapid internal clicks inside `playDiceRattle`/
 *    `startFuseCrackle` are deliberately exempt: those are one logical
 *    effect built from many small grains, not independent overlapping SFX.
 *
 * Browsers refuse to start audio before a user gesture, so `unlock()` (or
 * any of the play/start methods, which call it internally) must be invoked
 * from inside a click/tap handler at least once. Because the default state
 * is now fully muted (see `audioSettings.ts`), the very first real gesture
 * is normally the header/board mute-toggle click itself, which conveniently
 * both flips the flag and calls `unlock()`.
 */

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "./audioSettings";

type MotifFn = (ctx: AudioContext, out: GainNode) => number; // returns loop length in seconds

/** Concurrent one-shot SFX channel cap — see file header "Polyphony control". */
const MAX_CONCURRENT_SFX_CHANNELS = 8;
/** How long a channel counts as "occupied" after a gated one-shot starts — a generous upper bound on this file's longest one-shots, not exact per-sound tracking. */
const SFX_CHANNEL_RELEASE_MS = 450;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

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

/** Base pitch per 달무티 exchange tier for `playExchangeLaunch`/`playExchangeArrival` — brightest (king) down to warmest (commoner). */
const EXCHANGE_TIER_BASE_FREQ: Record<"king" | "noble" | "commoner", number> = {
  king: 1046.5, // C6
  noble: 783.99, // G5
  commoner: 587.33, // D5
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer: ReturnType<typeof setTimeout> | null = null;
  private bgmToken = 0;
  private fuseTimer: ReturnType<typeof setInterval> | null = null;
  private storeSubscribed = false;
  private lastPlayedAt = new Map<string, number>();
  private activeChannels = 0;

  isMuted(): boolean {
    return useAudioSettingsStore.getState().masterMuted;
  }

  setMuted(muted: boolean) {
    useAudioSettingsStore.getState().setMasterMuted(muted);
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
      const settings = useAudioSettingsStore.getState();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = isSfxEffectivelyMuted(settings) ? 0 : settings.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
      this.subscribeToSettings();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Keeps `sfxGain`/`bgmGain` live as the shared settings change (slider drags, other tabs' mute toggle, etc.) — set up once per engine instance. */
  private subscribeToSettings() {
    if (this.storeSubscribed) return;
    this.storeSubscribed = true;
    useAudioSettingsStore.subscribe((settings) => {
      if (this.sfxGain) this.sfxGain.gain.value = isSfxEffectivelyMuted(settings) ? 0 : settings.sfxVolume;
      if (this.bgmGain) this.bgmGain.gain.value = isBgmEffectivelyMuted(settings) ? 0 : settings.bgmVolume;
    });
  }

  /** Call from any click/tap handler to unlock audio ahead of time. */
  unlock() {
    this.ensureContext();
  }

  /**
   * Polyphony gate for discrete one-shot SFX (see file header) — returns
   * false (and plays nothing) if this SFX type is on cooldown or every
   * channel is already busy. Not used by the internal rattle/crackle click
   * generators, which are one continuous effect rather than independent
   * overlapping sounds.
   */
  private gate(key: string, cooldownMs: number): boolean {
    if (isSfxEffectivelyMuted(useAudioSettingsStore.getState())) return false;
    const now = nowMs();
    const last = this.lastPlayedAt.get(key);
    if (last !== undefined && now - last < cooldownMs) return false;
    if (this.activeChannels >= MAX_CONCURRENT_SFX_CHANNELS) return false;
    this.lastPlayedAt.set(key, now);
    this.activeChannels++;
    setTimeout(() => {
      this.activeChannels = Math.max(0, this.activeChannels - 1);
    }, SFX_CHANNEL_RELEASE_MS);
    return true;
  }

  private crackleBurst() {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
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
    src.connect(filter).connect(gain).connect(this.sfxGain);
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

  /** Legacy ambient tension loop (Spot the Difference) — routes through `bgmGain`, independent of SFX mute/volume. */
  startBgm() {
    const ctx = this.ensureContext();
    if (!ctx || this.bgmTimer) return;
    if (!this.bgmGain) {
      this.bgmGain = ctx.createGain();
      const settings = useAudioSettingsStore.getState();
      this.bgmGain.gain.value = isBgmEffectivelyMuted(settings) ? 0 : settings.bgmVolume;
      this.bgmGain.connect(ctx.destination);
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

  private diceClick() {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
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
    src.connect(filter).connect(gain).connect(this.sfxGain);
    src.start();
    src.stop(now + 0.1);
  }

  /** A burst of dice-in-cup "click" noises that thin out toward the end of `durationMs`, self-scheduling via setTimeout (no AudioContext-relative scheduling needed since each click is independent). */
  playDiceRattle(durationMs = 800) {
    if (!this.gate("diceRattle", 300)) return;
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
    if (!this.gate("cupThud", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(this.sfxGain);
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
    src.connect(filter).connect(noiseGain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.1);
  }

  /** Bright ascending two-note chime — a spot-the-difference correct click / Grid Poker's "족보 완성" ding. */
  playCorrectDing() {
    if (!this.gate("correctDing", 80)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
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
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  }

  /** Short flat buzz — a spot-the-difference wrong click (paired with the penalty lock). */
  playWrongBuzz() {
    if (!this.gate("wrongBuzz", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** Tier-tinted whoosh (filtered noise sweep) + a short ascending chord — a card-exchange flight taking off. */
  playExchangeLaunch(tier: "king" | "noble" | "commoner") {
    if (!this.gate("exchangeLaunch", 100)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(2200, now + 0.35);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.05);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    src.connect(filter).connect(noiseGain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.4);

    const base = EXCHANGE_TIER_BASE_FREQ[tier];
    const chordSemitones = tier === "king" ? [0, 4, 7, 12] : tier === "noble" ? [0, 3, 7] : [0, 5];
    chordSemitones.forEach((semi, i) => {
      const freq = base * Math.pow(2, semi / 12);
      const at = now + i * 0.03;
      const osc = ctx.createOscillator();
      osc.type = tier === "commoner" ? "triangle" : "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(tier === "king" ? 0.22 : 0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.4);
    });
  }

  /** Bright tier-tinted two-note ding — a card-exchange flight landing (glow-burst impact). */
  playExchangeArrival(tier: "king" | "noble" | "commoner") {
    if (!this.gate("exchangeArrival", 100)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const base = EXCHANGE_TIER_BASE_FREQ[tier] * 1.5; // an octave-and-a-half above the launch chord, for the "impact sparkle" register
    [base, base * 1.25].forEach((freq, i) => {
      const at = now + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.26, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.32);
    });
  }

  // ---------------------------------------------------------------------
  // 2026-08-26 세션 — 6개 허브 게임 테마 BGM/SFX 연동에서 새로 추가된 SFX.
  // 각 게임의 브리프에 나온 효과음 문구를 그대로 시노그래피 삼아 합성했다.
  // ---------------------------------------------------------------------

  /** 로비/허브 — "보드게임 나무 말/버튼 탭 소리": short woody knock (filtered noise + a soft low thump). */
  playWoodTap() {
    if (!this.gate("woodTap", 60)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 3;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.18, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    src.connect(filter).connect(noiseGain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.06);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /** 운명전쟁39 — "카드 드로우 휙 소리": rising filtered-noise swipe + a short digital blip. */
  playCardDrawWhoosh() {
    if (!this.gate("cardDrawWhoosh", 120)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(4500, now + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(filter).connect(gain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.2);

    const blip = ctx.createOscillator();
    blip.type = "square";
    blip.frequency.setValueAtTime(1800, now + 0.05);
    blip.frequency.exponentialRampToValueAtTime(2600, now + 0.1);
    const blipGain = ctx.createGain();
    blipGain.gain.setValueAtTime(0.05, now + 0.05);
    blipGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    blip.connect(blipGain).connect(this.sfxGain);
    blip.start(now + 0.05);
    blip.stop(now + 0.13);
  }

  /** 운명전쟁39 — "카드 제출 플라즈마 임팩트": bright descending square hit + a noise crack, like an energy bolt landing. */
  playCardSubmitImpact() {
    if (!this.gate("cardSubmitImpact", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.16);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(filter).connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.2);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 3000;
    crackFilter.Q.value = 5;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.22, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.08);
  }

  /** 운명전쟁39 — "리버스 역재생 스파크": a spark that fades *in* before cutting off, mimicking reversed playback. */
  playReverseSpark() {
    if (!this.gate("reverseSpark", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const duration = 0.35;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(900, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + duration * 0.9);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 3500;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.15, now + duration * 0.85);
    noiseGain.gain.linearRampToValueAtTime(0, now + duration);
    src.connect(filter).connect(noiseGain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + duration);
  }

  /** 라스베가스 — "주사위 컵 흔들림/테이블 굴림음": a brighter, woodier click burst than Perudo's muffled cup rattle, ending in a rolling clatter. */
  playCasinoDiceRoll(durationMs = 650) {
    if (!this.gate("casinoDiceRoll", 300)) return;
    const start = performance.now();
    const clickOnce = () => {
      const ctx = this.ensureContext();
      if (!ctx || !this.sfxGain) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2800 + Math.random() * 1800;
      filter.Q.value = 10 + Math.random() * 6;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04 + Math.random() * 0.02);
      src.connect(filter).connect(gain).connect(this.sfxGain);
      src.start();
      src.stop(now + 0.08);
    };
    const schedule = () => {
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs) return;
      clickOnce();
      const progress = elapsed / durationMs;
      setTimeout(schedule, 28 + progress * 70 + Math.random() * 30);
    };
    schedule();
  }

  /** 라스베가스 — "칩/지폐 안착음": a muted wooden clack (chip) layered with a faint paper rustle (bill). */
  playChipSettle() {
    if (!this.gate("chipSettle", 90)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.07);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);

    const rustle = ctx.createBufferSource();
    rustle.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2500;
    const rustleGain = ctx.createGain();
    rustleGain.gain.setValueAtTime(0.06, now);
    rustleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    rustle.connect(filter).connect(rustleGain).connect(this.sfxGain);
    rustle.start(now);
    rustle.stop(now + 0.12);
  }

  /** 라스베가스 — "동수 상쇄 스파크음": two clashing high notes that fizzle out, for a tie cancelling itself. */
  playTieSpark() {
    if (!this.gate("tieSpark", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [990, 1047].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 0.3);
    });
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 4000;
    filter.Q.value = 8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(filter).connect(noiseGain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.16);
  }

  /**
   * 그리드포커 — "부드러운 카드 플릭음": a soft airy tick, lighter/higher than the generic wood tap.
   * Gate lowered 60ms→40ms (2026-08-27 세션, 연속 배치 SFX 튜닝 요청) so a user
   * placing cards in quick succession never has a flick silently dropped —
   * still well above the ~30ms floor needed to avoid two clicks smearing
   * into one attack.
   */
  playCardFlick() {
    if (!this.gate("cardFlick", 40)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 3200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    src.connect(filter).connect(gain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.05);
  }

  /**
   * 그리드포커 — "그리드 안착 스냅음": a crisp snap (short high click + tiny thump) for a card locking into a grid cell.
   * Gate lowered 80ms→50ms (2026-08-27 세션, 연속 배치 SFX 튜닝 요청) to match
   * `playCardFlick`'s tighter cooldown — this fires 90ms after each flick
   * (see `GridPokerBoard.tsx`'s `placeAt`), so back-to-back placements under
   * a second apart no longer risk having the settle-snap swallowed.
   */
  playGridSnap() {
    if (!this.gate("gridSnap", 50)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(1800, now);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.12, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    click.connect(clickGain).connect(this.sfxGain);
    click.start(now);
    click.stop(now + 0.04);

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(300, now);
    thump.frequency.exponentialRampToValueAtTime(120, now + 0.05);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.16, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    thump.connect(thumpGain).connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.07);
  }

  /** 말달리자 — "발굽 도약 쿵쿵/먼지 파티클음": a low double-thump hoofbeat plus a soft dust puff. */
  playHoofBeat() {
    if (!this.gate("hoofBeat", 90)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.09].forEach((offset) => {
      const at = now + offset;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, at);
      osc.frequency.exponentialRampToValueAtTime(55, at + 0.08);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.24, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.11);
    });
    const dust = ctx.createBufferSource();
    dust.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const dustGain = ctx.createGain();
    dustGain.gain.setValueAtTime(0.08, now);
    dustGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    dust.connect(filter).connect(dustGain).connect(this.sfxGain);
    dust.start(now);
    dust.stop(now + 0.22);
  }

  /** 말달리자 — "추월/부스트 바람 가르는 소리": a fast upward-sweeping filtered-noise whoosh. */
  playBoostWind() {
    if (!this.gate("boostWind", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    src.connect(filter).connect(gain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.32);
  }

  /** 말달리자 — "결승선 환호/징소리": an ascending fanfare arpeggio over a slow-decaying low gong tone. */
  playFinishFanfare() {
    if (!this.gate("finishFanfare", 500)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const gong = ctx.createOscillator();
    gong.type = "sine";
    gong.frequency.value = 98;
    const gongGain = ctx.createGain();
    gongGain.gain.setValueAtTime(0.3, now);
    gongGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    gong.connect(gongGain).connect(this.sfxGain);
    gong.start(now);
    gong.stop(now + 1.8);

    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const at = now + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.5);
    });

    const crowd = ctx.createBufferSource();
    crowd.buffer = noiseBuffer(ctx);
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 1500;
    crowdFilter.Q.value = 0.7;
    const crowdGain = ctx.createGain();
    crowdGain.gain.setValueAtTime(0, now);
    crowdGain.gain.linearRampToValueAtTime(0.1, now + 0.15);
    crowdGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    crowd.connect(crowdFilter).connect(crowdGain).connect(this.sfxGain);
    crowd.start(now);
    crowd.stop(now + 1.2);
  }

  /** 달무티 — "신분 배정 팡파르": a bright ascending brass-like triad, for the deal/rank-assignment moment. */
  playRankFanfare() {
    if (!this.gate("rankFanfare", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [392, 493.88, 587.33].forEach((freq, i) => {
      const at = now + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2600;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.18, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      osc.connect(filter).connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.6);
    });
  }

  /** 달무티 — "쇠사슬음": a few quick metallic clinks, for the lower-ranks/"노예" side of the deal. */
  playChainRattle() {
    if (!this.gate("chainRattle", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.08, 0.15, 0.26].forEach((offset) => {
      const at = now + offset;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2200 + Math.random() * 800;
      filter.Q.value = 14;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
      src.connect(filter).connect(gain).connect(this.sfxGain!);
      src.start(at);
      src.stop(at + 0.12);
    });
  }

  /** 달무티 — "조공/세금 금화·동전 소리": a few overlapping bright metallic pings. */
  playCoinTribute() {
    if (!this.gate("coinTribute", 120)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [1760, 2093, 2637].forEach((freq, i) => {
      const at = now + i * 0.03;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.24);
    });
  }

  /** 달무티 — "양피지 카드 제출음": a soft papery brush (highpass noise), quieter than the exchange/coin SFX. */
  playParchmentSubmit() {
    if (!this.gate("parchmentSubmit", 80)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(filter).connect(gain).connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.14);
  }

  // ---------------------------------------------------------------------
  // 2026-08-27 세션(오후) — 6개 허브 게임의 남은 세부 액션 SFX 갭을 메우기
  // 위해 추가된 신규 SFX. AskUserQuestion으로 확인된 대상 이벤트에만 연결
  // (HANDOFF.md "게임별 세부 액션 SFX 완전 바인딩" 절 참고).
  // ---------------------------------------------------------------------

  /** 운명전쟁39 — "데스 카드 페널티음": a dark descending detuned buzz + a sharp glitchy noise stab, for a Death card landing (STATUS_EFFECT 매핑 대상, 화면 흔들림과 같은 타이밍). */
  playDeathCardSting() {
    if (!this.gate("deathCardSting", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [110, 116].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.3);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 0.35);
    });

    const stab = ctx.createBufferSource();
    stab.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 3;
    const stabGain = ctx.createGain();
    stabGain.gain.setValueAtTime(0.24, now);
    stabGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    stab.connect(filter).connect(stabGain).connect(this.sfxGain);
    stab.start(now);
    stab.stop(now + 0.12);
  }

  /** 운명전쟁39 — "라운드 승리 챠임": a bright ascending three-note major chime, for `roundEnd`'s per-player score sign check. */
  playPredictionWin() {
    if (!this.gate("predictionWin", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [659.25, 830.61, 987.77].forEach((freq, i) => {
      const at = now + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.24, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.42);
    });
  }

  /** 운명전쟁39 — "라운드 패배 톤": a short flat minor-second dip, muted counterpart to `playPredictionWin`. */
  playPredictionLose() {
    if (!this.gate("predictionLose", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(311.13, now);
    osc.frequency.linearRampToValueAtTime(233.08, now + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** 라스베가스 — "지폐 세는 소리": several quick paper-flick noise bursts, for the game-over payout flight starting (MONEY_COLLECT). */
  playBillCount() {
    if (!this.gate("billCount", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.07, 0.14, 0.21, 0.28].forEach((offset) => {
      const at = now + offset;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2600 + Math.random() * 900;
      filter.Q.value = 5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      src.connect(filter).connect(gain).connect(this.sfxGain!);
      src.start(at);
      src.stop(at + 0.06);
    });
  }

  /** 그리드포커 — "족보 완성 팡파르": a quick bright major-triad brass-like stab, for round-result entering (POKER_HAND_FANFARE). */
  playHandFanfare() {
    if (!this.gate("handFanfare", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const at = now + i * 0.05;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 3000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      osc.connect(filter).connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.36);
    });
  }

  /** 그리드포커 — "승리 스탬프 임팩트": a low thud + a bright noise crack, timed with `VictoryStamp`'s appearance (IMPACT_VICTORY). */
  playVictoryStamp() {
    if (!this.gate("victoryStamp", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(180, now);
    thud.frequency.exponentialRampToValueAtTime(50, now + 0.15);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.32, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.25);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2500;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.22, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    crack.connect(filter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.08);
  }

  /** 말달리자 — "카드 사용 확정음": a quick woody double-tap + a light rising blip, distinct from 라스베가스의 playCasinoDiceRoll (RACE_DICE_ROLL — this game's "roll" is a movement card, not a physical die). */
  playRaceDiceClatter() {
    if (!this.gate("raceDiceClatter", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.06].forEach((offset) => {
      const at = now + offset;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1600;
      filter.Q.value = 5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      src.connect(filter).connect(gain).connect(this.sfxGain!);
      src.start(at);
      src.stop(at + 0.06);
    });
    const blip = ctx.createOscillator();
    blip.type = "square";
    blip.frequency.setValueAtTime(900, now + 0.1);
    blip.frequency.exponentialRampToValueAtTime(1400, now + 0.16);
    const blipGain = ctx.createGain();
    blipGain.gain.setValueAtTime(0.08, now + 0.1);
    blipGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    blip.connect(blipGain).connect(this.sfxGain);
    blip.start(now + 0.1);
    blip.stop(now + 0.19);
  }

  /** 달무티 — "패스 선언 톤": a short low downward whiff, deliberately understated next to `playParchmentSubmit`/`playCoinTribute` (ACTION_PASS). */
  playPassWhiff() {
    if (!this.gate("passWhiff", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** 달무티 — "반란 종소리": a struck bell (fundamental + inharmonic partials, long decay) for `declareRevolution` (REVOLUTION_BELL) — distinct from the deal-time `playRankFanfare`. */
  playRevolutionBell() {
    if (!this.gate("revolutionBell", 500)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    // Inharmonic partials approximate a struck bell/gong better than a pure harmonic stack.
    [
      { freq: 220, gain: 0.28 },
      { freq: 369, gain: 0.16 },
      { freq: 587, gain: 0.1 },
      { freq: 818, gain: 0.06 },
    ].forEach(({ freq, gain: g }) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(g, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 1.6);
    });
  }
}

let instance: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
  if (!instance) instance = new SoundEngine();
  return instance;
}
