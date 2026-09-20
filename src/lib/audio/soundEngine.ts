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
  private speechUnlocked = false;

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
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
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
    this.unlockSpeech();
  }

  /**
   * WebKit(iOS Safari, 일부 Android WebView 포함)은 세션 중 `speechSynthesis.
   * speak()`가 실제 사용자 제스처 콜스택 안에서 최소 한 번 성공적으로
   * 호출되기 전까지는 이후의 모든 speak() 호출(제스처 밖에서 호출되는 것
   * 포함)을 조용히 무시한다 — Web Audio `AudioContext`의 "첫 제스처가
   * 필요하다"는 제약과는 별개의 파이프라인이라 `ensureContext()`만으로는
   * 해결되지 않는다. `unlock()`은 이미 이 프로젝트의 모든 게임에서 클릭/탭
   * 핸들러마다 최소 1회 호출되므로(파일 헤더 참고) 그 첫 실제 제스처에
   * 편승해 거의 무음(볼륨 0) 더미 발화 1회로 speechSynthesis 자체도 같은
   * 타이밍에 영구 언락해 둔다 — 이렇게 해두면 실제 발화(`speakPass` 등)는
   * 이후 사용자 제스처 밖(소켓/락스텝 상태 동기화로 다른 좌석의 패스를
   * 감지하는 diff 지점 등)에서 호출돼도 계속 정상 작동한다. (task brief,
   * 2026-09-13 세션 — "일부 모바일 기기 패스 음성 묵음" 결함 조치)
   */
  private unlockSpeech() {
    if (this.speechUnlocked) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    this.speechUnlocked = true;
    try {
      const warmUp = new SpeechSynthesisUtterance(" ");
      warmUp.volume = 0;
      window.speechSynthesis.speak(warmUp);
    } catch {
      // 일부 구형 WebView는 SpeechSynthesisUtterance 생성 자체를 던질 수 있음 — 무음 실패, 다음 세션에서 재시도되지 않아도 실사용 영향 없음(치명적이지 않은 장식용 워밍업)
    }
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

  /**
   * 진실의 고개 — "정답 선언"이 오답으로 판정되는 순간 전용 둔탁한 경고음
   * (2026-09-10 세션 신설). 매 질문(§3 행동 A/B)의 가벼운 `playWrongBuzz`와
   * 구별되도록, 저음 사인파 붐(`playEliminationSlam`과 유사한 기법) + 거친
   * 사각파 2연타로 훨씬 무겁고 충격적인 톤을 낸다 — 화면 흔들림 연출과 동기화.
   */
  playDeclarationFailBuzzer() {
    if (!this.gate("declarationFailBuzzer", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(85, now);
    boom.frequency.exponentialRampToValueAtTime(32, now + 0.35);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.38, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.45);

    [0, 0.16].forEach((delay) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(140, now + delay);
      osc.frequency.linearRampToValueAtTime(90, now + delay + 0.14);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.24, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.16);
      osc.connect(filter).connect(gain).connect(this.sfxGain!);
      osc.start(now + delay);
      osc.stop(now + delay + 0.16);
    });
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

  /**
   * 달무티 — "카드 제출 타격감": `playParchmentSubmit`이 이미 담당하던 조용한
   * 종이음과는 별개로, 카드가 필드에 실제로 "꽂히는" 순간의 묵직한 충격을 담당
   * (task brief "카드가 필드 중앙으로 날아와 꽂힐 때 묵직한 타격... 강화",
   * 2026-09-05 세션). 낮은 서브베이스 쿵 소리 + 짧은 슬랩 트랜지언트는 매번,
   * `isGrand`(조커 포함 또는 3장 이상 대량 출도)일 때만 추가로 상승하는 골드
   * 스파클 3화음이 겹쳐 울려 "거대한 폭죽" 느낌을 더한다. `DalmutiBoard.tsx`의
   * lockstep diff 블록에서 호출되어 모든 접속자에게 동일하게 재생된다(제출한
   * 본인의 로컬 클릭에만 의존하는 기존 `playParchmentSubmit`과 달리, 트릭
   * 리더보드를 보는 모든 좌석이 같은 타격음을 듣도록 함 — `playRevolutionBell`과
   * 같은 트리거 위치).
   */
  playCardSlam(isGrand: boolean) {
    if (!this.gate("cardSlam", 90)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(160, now);
    thud.frequency.exponentialRampToValueAtTime(50, now + 0.14);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.3, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.2);

    const slap = ctx.createBufferSource();
    slap.buffer = noiseBuffer(ctx);
    const slapFilter = ctx.createBiquadFilter();
    slapFilter.type = "bandpass";
    slapFilter.frequency.value = 1800;
    slapFilter.Q.value = 4;
    const slapGain = ctx.createGain();
    slapGain.gain.setValueAtTime(0.22, now);
    slapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    slap.connect(slapFilter).connect(slapGain).connect(this.sfxGain);
    slap.start(now);
    slap.stop(now + 0.08);

    if (!isGrand) return;
    [1046.5, 1318.5, 1568].forEach((freq, i) => {
      const at = now + 0.05 + i * 0.04;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.42);
    });
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

  /**
   * 달무티 — "버튼 클릭 틱": a very short, neutral high-pitched tick that fires
   * the instant *any* interactive game-action button is pressed (BTN_CLICK_TICK,
   * 2026-09-04 세션 "버튼 클릭 반응성/이펙트" 브리프 — AskUserQuestion으로 확정:
   * 기존 결과음과 별도로 클릭 즉시 재생). Deliberately tiny/neutral so it never
   * competes with the *result* SFX that already fire once the dispatched action
   * actually resolves (`playParchmentSubmit`/`playPassWhiff`/`playCoinTribute`/
   * `playRevolutionBell`) — those are unchanged; this one layers underneath them
   * as the immediate "input registered" tactile cue. `DalmutiEffects.tsx`'s
   * `FxButton` is the only caller (fires from `onPointerDown`, gated at 60ms so a
   * synthetic pointer/mouse double-fire on the same press can't double-tick).
   */
  playUiClickTick() {
    if (!this.gate("uiClickTick", 60)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.045);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.05);
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

  /**
   * 달무티 — "패스!" 음성 (task brief §2, 2026-09-05 세션 신설 / 2026-09-06 세션
   * 룸 전체 브로드캐스트 확장): 이 프로젝트는 저작권 문제로 실제 성우 mp3를 넣지
   * 않고 모든 SFX를 코드로 합성하는 정책이라(파일 헤더 참고), 실제 사람 목소리가
   * 필요한 이 기능은 그 정책과 동일한 정신으로 mp3 에셋 없이 브라우저 내장 Web
   * Speech API(`SpeechSynthesisUtterance`)를 사용한다(AskUserQuestion으로 확정) —
   * 에셋 용량 0, 지연 없음. `gate()`를 그대로 재사용해 짧은 쿨다운(0.2초, task
   * brief의 "0.2~0.3초 큐 딜레이" 요구사항 충족)으로 연속 패스 시 발화가 겹치지
   * 않게 한다. 매 호출마다 `speechSynthesis.cancel()`로 직전 발화를 끊고 새로
   * 즉시 발음하므로, 여러 명(또는 봇)이 연달아 패스해도 "패스! 패스! 패스!"가
   * 지저분하게 겹치지 않고 항상 최신 패스만 또렷하게 들린다(자연스러운 컷-후-재생
   * 방식 — task brief의 큐/컷 두 옵션 중 컷 방식 채택, 기존 구현 그대로 재사용).
   *
   * `isSfxEffectivelyMuted` 체크 추가(2026-09-06 세션) — 기존 구현은 `sfxVolume`만
   * `utterance.volume`에 반영하고 `masterMuted`/`sfxMuted` 자체는 전혀 확인하지
   * 않아, 음소거 상태에서도 TTS가 그대로 들리는 실제 버그였음(Web Audio
   * `sfxGain` 그래프를 타는 다른 SFX와 달리 `speechSynthesis`는 별도 파이프라인이라
   * 게인 노드 뮤트가 적용되지 않았다). "음소거 상태는 엄격히 반영"이라는 이번
   * 요청에 맞춰 여기서 직접 게이트한다.
   *
   * `seat` 파라미터(2026-09-06 세션, 방 전체 브로드캐스트 확장에 맞춰 추가) —
   * 실제 성별 데이터가 이 프로젝트에 전혀 없어(AskUserQuestion으로 확인 후 "성별
   * 차등 없음, 좌석 번호 기반 의사-차등"으로 확정) 진짜 성별 구분이 아니라 좌석
   * 홀/짝에 따라 피치를 살짝 다르게 주는 순전히 장식용 변형이다 — "다른 사람이
   * 패스했다"는 청각적 구분감을 주는 목적일 뿐, 특정 좌석이 항상 같은 캐릭터
   * 음색이라는 의미 이상은 없다.
   */
  speakPass(seat?: number) {
    if (!this.gate("passVoice", 200)) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const settings = useAudioSettingsStore.getState();
    if (isSfxEffectivelyMuted(settings)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("패스!");
    utterance.lang = "ko-KR";
    utterance.rate = 1.05;
    // 좌석 번호 기반 의사-차등(실제 성별 데이터 없음, 순수 장식용) — 짝수/홀수
    // 좌석을 살짝 다른 피치로 번갈아 재생해 "누가 말했는지"의 청각적 구분을 준다.
    utterance.pitch = seat !== undefined && seat % 2 === 1 ? 1.22 : 0.9;
    utterance.volume = settings.sfxVolume;
    const koVoice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("ko"));
    if (koVoice) utterance.voice = koVoice;
    window.speechSynthesis.speak(utterance);
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

  /**
   * 달무티 — "쇼다운 공개": 최후까지 손패를 털지 못한 좌석의 카드가 뒤집혀
   * 공개되는 순간 재생되는 사운드(task brief, 2026-09-13 세션 §1
   * SHOWDOWN_REVEAL) — 짧은 커튼-스윕 화이트노이즈(공개의 "휙" 소리)에 이어
   * `playRevolutionBell`보다 한 옥타브 이상 낮고 어두운 공(gong) 울림으로,
   * 반란 종소리와 청각적으로 헷갈리지 않게 구분했다. `DalmutiBoard.tsx`가
   * `gameOver` 진입을 감지하는 diff 지점에서 모든 접속자에게 동일하게
   * 재생한다.
   */
  playShowdownReveal() {
    if (!this.gate("showdownReveal", 800)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const sweep = ctx.createBufferSource();
    sweep.buffer = noiseBuffer(ctx);
    const sweepFilter = ctx.createBiquadFilter();
    sweepFilter.type = "bandpass";
    sweepFilter.Q.value = 1.2;
    sweepFilter.frequency.setValueAtTime(2200, now);
    sweepFilter.frequency.exponentialRampToValueAtTime(300, now + 0.5);
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(0, now);
    sweepGain.gain.linearRampToValueAtTime(0.18, now + 0.05);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    sweep.connect(sweepFilter).connect(sweepGain).connect(this.sfxGain);
    sweep.start(now);
    sweep.stop(now + 0.55);

    const gongAt = now + 0.08;
    [
      { freq: 98, gain: 0.32 },
      { freq: 164, gain: 0.14 },
      { freq: 233, gain: 0.08 },
    ].forEach(({ freq, gain: g }) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(g, gongAt);
      gain.gain.exponentialRampToValueAtTime(0.001, gongAt + 2.2);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(gongAt);
      osc.stop(gongAt + 2.2);
    });
  }

  /**
   * 달무티 — "라스트 피니시 팡파르": 잔여 2인 중 한쪽이 마지막 패를 털어내
   * 게임이 끝나는 순간 재생되는 전용 임팩트음(task brief, 2026-09-20 세션
   * "라스트 피니시 카드 스포트라이트" — 로컬 전용/미배포). `playShowdownReveal`의
   * 커튼-스윕+공(gong) 조합을 대체하는 자리에서 호출된다(`DalmutiBoard.tsx`의
   * `enteredGameOver` diff 트리거). 묵직한 서브베이스 임팩트(팀파니 타격에
   * 가깝게 `playCardSlam`의 thud보다 더 낮고 길게) 위에, 네 음으로 올라가는
   * 골드 벨 아르페지오(도-미-솔-높은 도, 각 음에 옥타브 위 배음을 살짝 얹어
   * "종소리" 질감)를 겹치고, 마지막 음과 함께 짧은 하이 스파클(밴드패스
   * 화이트노이즈)로 마무리한다. `playFinishFanfare`(말달리자 결승선 환호/
   * 징소리)와 이름이 겹쳐 `playDalmutiFinishFanfare`로 명명.
   */
  playDalmutiFinishFanfare() {
    if (!this.gate("dalmutiFinishFanfare", 800)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(92, now);
    boom.frequency.exponentialRampToValueAtTime(34, now + 0.5);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.4, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.6);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 50;
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.22, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    sub.connect(subGain).connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.45);

    const arpeggio = [523.25, 659.25, 783.99, 1046.5];
    arpeggio.forEach((freq, i) => {
      const at = now + 0.14 + i * 0.1;
      [freq, freq * 2].forEach((f, partial) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const gain = ctx.createGain();
        const peak = partial === 0 ? 0.22 : 0.08;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + (i === arpeggio.length - 1 ? 1.2 : 0.5));
        osc.connect(gain).connect(this.sfxGain!);
        osc.start(at);
        osc.stop(at + 1.25);
      });
    });

    const sparkleAt = now + 0.14 + (arpeggio.length - 1) * 0.1;
    const sparkle = ctx.createBufferSource();
    sparkle.buffer = noiseBuffer(ctx);
    const sparkleFilter = ctx.createBiquadFilter();
    sparkleFilter.type = "bandpass";
    sparkleFilter.frequency.value = 5200;
    sparkleFilter.Q.value = 0.8;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(0, sparkleAt);
    sparkleGain.gain.linearRampToValueAtTime(0.14, sparkleAt + 0.03);
    sparkleGain.gain.exponentialRampToValueAtTime(0.001, sparkleAt + 0.65);
    sparkle.connect(sparkleFilter).connect(sparkleGain).connect(this.sfxGain);
    sparkle.start(sparkleAt);
    sparkle.stop(sparkleAt + 0.65);
  }

  /** 소환사의 협곡 — "패스 봉인 스탬프": a heavy dark-metal seal slamming down (deep sine thud sweep + a lowpass thump, like `playCupThud`/`playVictoryStamp` but deeper/louder) followed by a short metallic clang (inharmonic high partials, like a struck steel plate) — deliberately the loud/heavy opposite of Dalmuti's understated `playPassWhiff`, since this pass needs every other seat to notice it happened (PASS_HEAVY). */
  playPassSeal() {
    if (!this.gate("passSeal", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(110, now);
    thud.frequency.exponentialRampToValueAtTime(32, now + 0.22);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.42, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.32);

    const thump = ctx.createBufferSource();
    thump.buffer = noiseBuffer(ctx);
    const thumpFilter = ctx.createBiquadFilter();
    thumpFilter.type = "lowpass";
    thumpFilter.frequency.value = 500;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.3, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    thump.connect(thumpFilter).connect(thumpGain).connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.12);

    // Metallic clang — inharmonic partials struck a beat after the thud lands, like a steel seal ringing against the slot.
    const clangAt = now + 0.03;
    [
      { freq: 1900, gain: 0.12 },
      { freq: 2650, gain: 0.08 },
      { freq: 3400, gain: 0.05 },
    ].forEach(({ freq, gain: g }) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(g, clangAt);
      gain.gain.exponentialRampToValueAtTime(0.001, clangAt + 0.22);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(clangAt);
      osc.stop(clangAt + 0.22);
    });
  }

  // ---------------------------------------------------------------------
  // 2026-08-30 세션 — 소환사의 협곡 "카드 공개 방식 선택 + 생사 이펙트": 라운드가
  // 성공(생존)/실패(사망)으로 확정되는 순간의 화면 전체 이펙트용 SFX. 몬스터
  // 개별 처치의 짧은 `playDeathCardSting`류와 달리, 이 둘은 라운드당 정확히
  // 한 번만 울리는 더 크고 지속감 있는 사운드로 설계했다.
  // ---------------------------------------------------------------------

  /** 소환사의 협곡 — "생존 판정 웅장 팡파르": 밝은 4음 상승 아르페지오 위에 서서히 부풀어 오르는 쉬머 패드를 겹쳐, 몬스터 개별 처치의 짧은 스탬프음과 구분되는 하나의 웅장하고 지속적인 순간으로 들리게 한다(LIFE_DEATH_SURVIVE, `SurvivalEffect`의 "🛡️ SURVIVED" 등장과 동시 재생). */
  playSurviveEpic() {
    if (!this.gate("surviveEpic", 800)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const at = now + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.26, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.62);
    });

    const pad = ctx.createOscillator();
    pad.type = "sawtooth";
    pad.frequency.value = 392; // G4, under the arpeggio
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.setValueAtTime(600, now);
    padFilter.frequency.linearRampToValueAtTime(2200, now + 0.5);
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, now);
    padGain.gain.linearRampToValueAtTime(0.12, now + 0.35);
    padGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    pad.connect(padFilter).connect(padGain).connect(this.sfxGain);
    pad.start(now);
    pad.stop(now + 1.15);
  }

  /** 소환사의 협곡 — "사망 판정 강타 폭발음": 깊은 서브베이스 붐 + 하강하는 디튠 둠 드론 스탭 + 밝은 유리 파편 노이즈 버스트로, 라운드 전체가 실패로 끝난 무게감을 담는다 — 몬스터 한 마리의 데미지음(`playDeathCardSting`)보다 훨씬 무겁고 낮게(LIFE_DEATH_DEATH, `DeathEffect`의 "💀 YOU DIED" 등장과 동시 재생). */
  playDeathExplode() {
    if (!this.gate("deathExplode", 800)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(150, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.5, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.75);

    [98, 103].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.35, now + 0.6);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 0.65);
    });

    const shatter = ctx.createBufferSource();
    shatter.buffer = noiseBuffer(ctx);
    const shatterFilter = ctx.createBiquadFilter();
    shatterFilter.type = "highpass";
    shatterFilter.frequency.value = 3000;
    const shatterGain = ctx.createGain();
    shatterGain.gain.setValueAtTime(0.28, now + 0.02);
    shatterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    shatter.connect(shatterFilter).connect(shatterGain).connect(this.sfxGain);
    shatter.start(now + 0.02);
    shatter.stop(now + 0.32);
  }

  // ---------------------------------------------------------------------
  // 2026-08-31 세션 — 랫어탯캣 "랫어탯캣(콜)" 초대형 연출용 SFX. 실제 사이렌
  // 음원 파일이 아니라(파일 헤더 참고, 저작권 이슈로 이 프로젝트는 오디오
  // 파일을 쓰지 않음) 이 파일의 다른 SFX와 동일하게 순수 합성.
  // ---------------------------------------------------------------------

  /** 랫어탯캣 — "콜 선언 사이렌+카운트다운": 두 음 사이를 오가는 사이렌형 스윕(경보 느낌) 위에, 마지막 1턴을 알리는 3연속 카운트다운 딩을 얹은 합성음. `RatATatCatCallModal.tsx` 등장과 동시 재생(다른 SFX보다 길고 무게감 있게, 게임당 한 번뿐인 이벤트라 쿨다운도 넉넉히). */
  playRatCallSiren() {
    if (!this.gate("ratCallSiren", 1500)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    // Alternating two-tone siren sweep — classic alarm cadence, ~4 back-and-forth sweeps.
    const siren = ctx.createOscillator();
    siren.type = "sawtooth";
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = "lowpass";
    sirenFilter.frequency.value = 2200;
    const sirenGain = ctx.createGain();
    sirenGain.gain.setValueAtTime(0, now);
    sirenGain.gain.linearRampToValueAtTime(0.16, now + 0.05);
    let t = now;
    for (let i = 0; i < 4; i++) {
      siren.frequency.setValueAtTime(520, t);
      siren.frequency.linearRampToValueAtTime(880, t + 0.18);
      siren.frequency.linearRampToValueAtTime(520, t + 0.36);
      t += 0.36;
    }
    sirenGain.gain.setValueAtTime(0.16, t - 0.15);
    sirenGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    siren.connect(sirenFilter).connect(sirenGain).connect(this.sfxGain);
    siren.start(now);
    siren.stop(t + 0.12);

    // Three bright ascending countdown dings, timed right after the siren fades — "마지막 1턴 시작" beat.
    const dingStart = t;
    [1046.5, 1046.5, 1567.98].forEach((freq, i) => {
      const at = dingStart + i * 0.22;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.2);
    });
  }

  // ---------------------------------------------------------------------
  // 2026-08-31 세션 — 러브 윈즈 올 "실시간 족보 표시 + 액션 이펙트 강화": 이
  // 게임엔 이전까지 SFX가 하나도 연결돼 있지 않았다(카드 선택/쇼다운 대결/
  // 승패 판정 전부 무음). 요청의 4개 항목(카드 선택·페어링 대결·상호 성공·
  // 배신 실패)에 뱃지 등급-업 챠임까지 더해 6종 신규 합성.
  // ---------------------------------------------------------------------

  /** 러브 윈즈 올 — "카드 선택 스냅음": 밝은 하이패스 스파클 + 짧은 스냅 클릭. `playGridSnap`보다 가볍고 반짝이는 톤으로, 족보 선언용 카드를 탭할 때마다 울린다(CARD_SELECT_SNAP). */
  playLwaCardSnap() {
    if (!this.gate("lwaCardSnap", 60)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const sparkle = ctx.createOscillator();
    sparkle.type = "sine";
    sparkle.frequency.setValueAtTime(2200, now);
    sparkle.frequency.exponentialRampToValueAtTime(3400, now + 0.05);
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(0.14, now);
    sparkleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    sparkle.connect(sparkleGain).connect(this.sfxGain);
    sparkle.start(now);
    sparkle.stop(now + 0.1);

    const click = ctx.createBufferSource();
    click.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 3500;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.16, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    click.connect(filter).connect(clickGain).connect(this.sfxGain);
    click.start(now);
    click.stop(now + 0.05);
  }

  /** 러브 윈즈 올 — "족보 등급-업 챠임": 실시간 족보 뱃지가 더 높은 등급으로 바뀌는 순간(CombinationBadge.tsx). `tier === "legendary"`(러브 윈즈 올)일수록 더 길고 반짝이는 상승 아르페지오. */
  playLwaBadgeUpgrade(tier: "rare" | "legendary") {
    if (!this.gate("lwaBadgeUpgrade", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const notes = tier === "legendary" ? [987.77, 1318.51, 1567.98, 2093.0] : [880, 1174.66];
    notes.forEach((freq, i) => {
      const at = now + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(tier === "legendary" ? 0.24 : 0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.34);
    });
  }

  /** 러브 윈즈 올 — "페어링/쇼다운 대결 스파크 충돌(Clash Pulse)": 서로 다른 방향에서 부딪히듯 수렴하는 디튠 소투스 두 음 + 고주파 노이즈 크랙. 폴드가 아닌 모든 쇼다운 공개 순간 재생(CLASH_PULSE). */
  playLwaClashSpark() {
    if (!this.gate("lwaClashSpark", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const duration = 0.3;

    [[520, 180], [560, 180]].forEach(([startFreq, endFreq]) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + duration);
    });

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 3200;
    crackFilter.Q.value = 6;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.26, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.1);
  }

  /** 러브 윈즈 올 — "상호 성공(Love/Win) 승리 팡파르": 밝은 3음 상승 화음. `jackpot`(러브 윈즈 올 족보로 승리)이면 한 옥타브 위 반짝이는 4음을 덧붙여 더 화려하게(VICTORY_FANFARE). */
  playLwaVictoryFanfare(jackpot: boolean) {
    if (!this.gate("lwaVictoryFanfare", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [659.25, 830.61, 987.77].forEach((freq, i) => {
      const at = now + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.26, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.45);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.46);
    });
    if (!jackpot) return;
    [1318.51, 1567.98, 2093.0, 2637.02].forEach((freq, i) => {
      const at = now + 0.26 + i * 0.05;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.36);
    });
  }

  /** 러브 윈즈 올 — "라운드 패배 타격 폭발음": 둔탁한 저음 임팩트 + 하강하는 디튠 버즈. 매 라운드 패배(쇼다운에서 짐)마다 패자 클라이언트에서만 재생 — 최종 KO는 별도의 `playLwaFinalKoImpact`가 맡는다(ROUND_LOSS_IMPACT). */
  playLwaRoundLossImpact() {
    if (!this.gate("lwaRoundLossImpact", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(160, now);
    thud.frequency.exponentialRampToValueAtTime(45, now + 0.2);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.34, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.28);

    [140, 148].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.35);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 0.4);
    });
  }

  /** 러브 윈즈 올 — "최종 KO 처치 폭발음": `playLwaRoundLossImpact`보다 훨씬 무겁고 낮은 서브베이스 붐 + 유리 파편 노이즈. 상대 칩을 전부 잃어 탈락이 확정되는 순간(§I) 단 한 번 재생(FINAL_KO_IMPACT). */
  playLwaFinalKoImpact() {
    if (!this.gate("lwaFinalKoImpact", 800)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(140, now);
    boom.frequency.exponentialRampToValueAtTime(30, now + 0.45);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.46, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.7);

    const shatter = ctx.createBufferSource();
    shatter.buffer = noiseBuffer(ctx);
    const shatterFilter = ctx.createBiquadFilter();
    shatterFilter.type = "highpass";
    shatterFilter.frequency.value = 2800;
    const shatterGain = ctx.createGain();
    shatterGain.gain.setValueAtTime(0.26, now + 0.02);
    shatterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    shatter.connect(shatterFilter).connect(shatterGain).connect(this.sfxGain);
    shatter.start(now + 0.02);
    shatter.stop(now + 0.3);
  }

  // 2026-09-01 세션 — 베팅 액션 대형 연출(체크/레이즈) 강화: 이 둘은 이전까지
  // 버튼 클릭 자체에 아무 SFX도 없었다(레이즈/올인은 `playChipBet` 같은 공용
  // 사운드조차 연결돼 있지 않았음).

  /** 러브 윈즈 올 — "체크(패스) 타격음": 테이블을 가볍게 두 번 두드리는 둔탁한 노크음. 상대의 체크가 화면에 뜰 때마다(자신의 체크 포함) 재생(CHECK_KNOCK). */
  playLwaCheckKnock() {
    if (!this.gate("lwaCheckKnock", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [0, 0.09].forEach((delay) => {
      const at = now + delay;
      const knock = ctx.createOscillator();
      knock.type = "triangle";
      knock.frequency.setValueAtTime(220, at);
      knock.frequency.exponentialRampToValueAtTime(90, at + 0.09);
      const knockGain = ctx.createGain();
      knockGain.gain.setValueAtTime(0.22, at);
      knockGain.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      knock.connect(knockGain).connect(this.sfxGain!);
      knock.start(at);
      knock.stop(at + 0.12);

      const tap = ctx.createBufferSource();
      tap.buffer = noiseBuffer(ctx);
      const tapFilter = ctx.createBiquadFilter();
      tapFilter.type = "bandpass";
      tapFilter.frequency.value = 600;
      tapFilter.Q.value = 4;
      const tapGain = ctx.createGain();
      tapGain.gain.setValueAtTime(0.12, at);
      tapGain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      tap.connect(tapFilter).connect(tapGain).connect(this.sfxGain!);
      tap.start(at);
      tap.stop(at + 0.05);
    });
  }

  /** 러브 윈즈 올 — "레이즈 칩 슬램음": 낮게 깔리는 화염 스웰(라이징 사각파) + 묵직한 칩 더미가 테이블에 내려찍히는 임팩트. 레이즈(올인 포함) 배너가 뜰 때마다 재생(RAISE_SLAM). */
  playLwaRaiseSlam() {
    if (!this.gate("lwaRaiseSlam", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const whoosh = ctx.createOscillator();
    whoosh.type = "sawtooth";
    whoosh.frequency.setValueAtTime(90, now);
    whoosh.frequency.exponentialRampToValueAtTime(340, now + 0.18);
    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0.001, now);
    whooshGain.gain.linearRampToValueAtTime(0.2, now + 0.15);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    whoosh.connect(whooshGain).connect(this.sfxGain);
    whoosh.start(now);
    whoosh.stop(now + 0.22);

    const slamAt = now + 0.16;
    const slam = ctx.createOscillator();
    slam.type = "sine";
    slam.frequency.setValueAtTime(180, slamAt);
    slam.frequency.exponentialRampToValueAtTime(55, slamAt + 0.22);
    const slamGain = ctx.createGain();
    slamGain.gain.setValueAtTime(0.4, slamAt);
    slamGain.gain.exponentialRampToValueAtTime(0.001, slamAt + 0.26);
    slam.connect(slamGain).connect(this.sfxGain);
    slam.start(slamAt);
    slam.stop(slamAt + 0.26);

    const clatter = ctx.createBufferSource();
    clatter.buffer = noiseBuffer(ctx);
    const clatterFilter = ctx.createBiquadFilter();
    clatterFilter.type = "highpass";
    clatterFilter.frequency.value = 2200;
    const clatterGain = ctx.createGain();
    clatterGain.gain.setValueAtTime(0.2, slamAt);
    clatterGain.gain.exponentialRampToValueAtTime(0.001, slamAt + 0.15);
    clatter.connect(clatterFilter).connect(clatterGain).connect(this.sfxGain);
    clatter.start(slamAt);
    clatter.stop(slamAt + 0.15);
  }

  // ---------------------------------------------------------------------
  // 망각의 지뢰 — 격자 위 지뢰 폭발/안전 통과/보물 획득/정찰 SFX. 룰북 기반 신규
  // 게임 개발 세션에서 추가. `playDeathExplode`(소환사의 협곡, 라운드 전체 패배)
  // 보다 더 국소적이고 즉각적인 "발밑 폭발" 임팩트로 설계해 서로 다른 게임의
  // 사운드 정체성이 겹치지 않게 했다.
  // ---------------------------------------------------------------------

  /** 지뢰 폭발: 날카로운 저음 붐 + 잔파편 노이즈 크랙 + 강제 후퇴를 암시하는 하강 글리산도. `playDeathExplode`보다 짧고 더 "발밑에서 터지는" 임팩트감. */
  playMineBlast() {
    if (!this.gate("mineBlast", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(180, now);
    boom.frequency.exponentialRampToValueAtTime(35, now + 0.3);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.45, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.45);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 2200;
    crackFilter.Q.value = 4;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.32, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.2);

    // Retreat glissando — a falling pitch right after the blast, cueing the forced walk back to the start tile.
    const retreat = ctx.createOscillator();
    retreat.type = "triangle";
    retreat.frequency.setValueAtTime(500, now + 0.15);
    retreat.frequency.exponentialRampToValueAtTime(140, now + 0.5);
    const retreatGain = ctx.createGain();
    retreatGain.gain.setValueAtTime(0.001, now + 0.15);
    retreatGain.gain.linearRampToValueAtTime(0.14, now + 0.2);
    retreatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    retreat.connect(retreatGain).connect(this.sfxGain);
    retreat.start(now + 0.15);
    retreat.stop(now + 0.56);
  }

  /** 안전한 칸 통과: 에메랄드 네온 펄스와 짝을 이루는 부드러운 상승 두 음 + 옅은 안도의 숨결(필터 노이즈). */
  playSafeStepChime() {
    if (!this.gate("safeStepChime", 120)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const at = now + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.32);
    });
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(0.05, now);
    breathGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    breath.connect(filter).connect(breathGain).connect(this.sfxGain);
    breath.start(now);
    breath.stop(now + 0.26);
  }

  /** 보물 획득: 밝은 3음 상승 아르페지오 + 반짝이는 하이햇풍 노이즈 스파클. */
  playTreasureGrab() {
    if (!this.gate("treasureGrab", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 987.77].forEach((freq, i) => {
      const at = now + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.26, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.42);
    });
    const sparkle = ctx.createBufferSource();
    sparkle.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 5000;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(0.12, now + 0.12);
    sparkleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    sparkle.connect(filter).connect(sparkleGain).connect(this.sfxGain);
    sparkle.start(now + 0.12);
    sparkle.stop(now + 0.36);
  }

  /** 정찰 아이템 사용: 레이더 핑 — 상승 사인 스윕 + 짧은 딜레이 후 되돌아오는 메아리풍 두 번째 핑. */
  playRadarPing() {
    if (!this.gate("radarPing", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.18].forEach((offset, i) => {
      const at = now + offset;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(900, at);
      osc.frequency.exponentialRampToValueAtTime(1500, at + 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(i === 0 ? 0.22 : 0.12, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.22);
    });
  }

  /** 비밀 지뢰 매설 확정: 둔탁한 흙 파는 듯한 저역 노이즈 thump — 매설판에서 4개를 다 배치했을 때 1회. */
  playMineBury() {
    if (!this.gate("mineBury", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const thump = ctx.createBufferSource();
    thump.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thump.connect(filter).connect(gain).connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.2);
  }

  // ---------------------------------------------------------------------
  // 쇼미더코인 — 베팅/레이즈 대형 임팩트 SFX. 베팅 UI/FX 리빌드 세션에서 추가
  // (그 전까지는 이 게임의 이펙트가 전부 시각 전용이었음 — `ShowMeTheCoinEffects.tsx`
  // 모듈 주석의 애덤덤 참고). `playChipSettle`(라스베가스, 잔잔한 안착음)보다
  // 훨씬 묵직하게 설계해 "거대한 코인 다발이 팟에 꽂히는" 임팩트로 차별화했다.
  // ---------------------------------------------------------------------

  /**
   * 베팅/레이즈 대형 슬램: 저역 붐(임팩트) + 여러 코인이 한꺼번에 쏟아지는
   * 금속성 클링크 클러스터 + 짧은 크랙 노이즈. `intensity`(0~1, 베팅액이
   * 자기 남은 칩에서 차지하는 비중)가 클수록 붐이 더 깊고 크게, 클링크
   * 알갱이 수도 더 많아진다 — 올인일수록 가장 크고 묵직하게 들리도록.
   */
  playSmtcCoinBlastSlam(intensity = 1) {
    if (!this.gate("smtcCoinBlastSlam", 140)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const amt = Math.max(0, Math.min(1, intensity));

    // Deep impact boom — scales from a light thud to a heavy slam.
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(150 - amt * 40, now);
    boom.frequency.exponentialRampToValueAtTime(30, now + 0.32);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.22 + amt * 0.3, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4 + amt * 0.15);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.6);

    // Impact crack — a short broadband snap at the moment of landing.
    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 1800;
    crackFilter.Q.value = 3;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.18 + amt * 0.22, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.16);

    // A cluster of metallic coin clinks trailing the impact — more coins (higher intensity) means more grains.
    const clinkCount = 3 + Math.round(amt * 6);
    for (let i = 0; i < clinkCount; i++) {
      const at = now + 0.03 + i * (0.02 + Math.random() * 0.02);
      const freq = 1600 + Math.random() * 1400;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + 0.05);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1 + amt * 0.08, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      osc.connect(gain).connect(this.sfxGain);
      osc.start(at);
      osc.stop(at + 0.1);
    }
  }

  // ---------------------------------------------------------------------
  // 코요테 — 탈락(하트 0) 데스 이펙트 SFX. 1단계(타격/화면 흔들림)는 이미 있는
  // `playDeathCardSting()`(운명전쟁39 데스 카드 페널티음 — "화면 흔들림과 같은
  // 타이밍"이라는 원래 문구가 이 순간과 그대로 들어맞아 재사용)이 맡고, 3단계
  // (해골 각인 스탬프)는 `playVictoryStamp`보다 더 어둡고 무겁게 새로 설계했다
  // — "승리"와 "탈락"은 대조적인 순간이라 밝은 임팩트음을 그대로 쓰면 어색함.
  // 2단계(카드 파쇄)에 대응하는 유리 깨짐류 SFX는 기존에 없어 신규 추가.
  // ---------------------------------------------------------------------

  /** 코요테 — "카드 파쇄음": 4개의 짧고 밝은 유리 균열 노이즈가 하강 피치로 연달아 터진다, 이마 카드가 산산조각 나는 순간(DEATH_CARD_SHATTER). */
  playCardShatter() {
    if (!this.gate("cardShatter", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.05, 0.11, 0.19].forEach((offset, i) => {
      const at = now + offset;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(3800 - i * 500 + Math.random() * 400, at);
      filter.frequency.exponentialRampToValueAtTime(1200, at + 0.1);
      filter.Q.value = 7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      src.connect(filter).connect(gain).connect(this.sfxGain!);
      src.start(at);
      src.stop(at + 0.14);
    });
  }

  /** 코요테 — "탈락 해골 각인 스탬프음": 아주 낮은 붐(임팩트) + 어둡게 하강하는 디튠 드론 + 저역 크랙, 거대한 해골 엠블럼이 쿵 내려앉는 순간(DEATH_SKULL_STAMP) — `playVictoryStamp`보다 훨씬 어둡고 무겁게 설계. */
  playEliminationSlam() {
    if (!this.gate("eliminationSlam", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(90, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 0.4);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.4, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.55);

    [130, 138].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now + 0.05);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.5);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(filter).connect(gain).connect(this.sfxGain!);
      osc.start(now + 0.05);
      osc.stop(now + 0.5);
    });

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "lowpass";
    crackFilter.frequency.value = 700;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.28, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.12);
  }

  /**
   * "내 턴이 되었습니다" 알림음 (2026-09-04, 페루도 최초 도입 — 요청 시 다른
   * 게임에도 재사용 가능). 밝은 2음 벨 딩동(완전5도 상승, `playSafeStepChime`과
   * 같은 sine+엔벨로프 기법이지만 더 여유 있는 벨 톤 서스테인) — 경고음이
   * 아니라 "당신 차례입니다"라는 긍정적 알림으로 읽히도록 짧고 산뜻하게 설계.
   * 게이트를 넉넉히 잡아(600ms) 턴 전환 감지 로직이 같은 틱에 중복 호출해도
   * 한 번만 울림.
   */
  playMyTurnChime() {
    if (!this.gate("myTurnChime", 600)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [587.33, 880].forEach((freq, i) => {
      const at = now + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.45);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.47);
    });
  }

  // ---------------------------------------------------------------------
  // 망각의 지뢰 2 — 시한폭탄(Time Bomb) 3×3 대폭발 SFX. `playMineBlast`보다
  // 한 단계 더 묵직하게 설계(더 낮은 저역, 더 긴 서스테인, 2겹 붐 레이어) —
  // "9칸을 뒤덮는 대폭발"이 1칸짜리 지뢰 폭발보다 확실히 크게 들려야 한다는
  // 요청을 반영.
  // ---------------------------------------------------------------------

  /** 시한폭탄 대폭발: 2겹의 깊은 저역 붐(임팩트 + 롱테일 서브베이스) + 넓은 크랙 노이즈 + 낙하 글리산도. */
  playTimeBombBlast() {
    if (!this.gate("timeBombBlast", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    // Primary impact boom — lower floor and longer decay than playMineBlast.
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(140, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.55, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.75);

    // Sub-bass tail layered underneath for extra weight ("묵직한 폭발음").
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(60, now + 0.02);
    sub.frequency.exponentialRampToValueAtTime(18, now + 0.65);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.4, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    sub.connect(subGain).connect(this.sfxGain);
    sub.start(now + 0.02);
    sub.stop(now + 0.9);

    // Wide crack noise — broader bandpass than the mine's crack, for a bigger blast's initial snap.
    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 1600;
    crackFilter.Q.value = 2.2;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.42, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.3);

    // Falling debris glissando trailing the blast.
    const debris = ctx.createOscillator();
    debris.type = "triangle";
    debris.frequency.setValueAtTime(420, now + 0.2);
    debris.frequency.exponentialRampToValueAtTime(90, now + 0.7);
    const debrisGain = ctx.createGain();
    debrisGain.gain.setValueAtTime(0.001, now + 0.2);
    debrisGain.gain.linearRampToValueAtTime(0.16, now + 0.26);
    debrisGain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);
    debris.connect(debrisGain).connect(this.sfxGain);
    debris.start(now + 0.2);
    debris.stop(now + 0.8);
  }

  /** 시한폭탄 원격 즉시 격발("즉시 격발" 버튼 확정) 전용 — 상승하는 2음 아밍(arming) 삐- 소리로, 곧바로 터지는 `playTimeBombBlast`(2턴 뒤 실제 폭발 시 재생됨)와는 확실히 다른, "기폭 장치를 걸었다"는 확인음. */
  playBombManualArm() {
    if (!this.gate("bombManualArm", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [520, 780].forEach((freq, i) => {
      const at = now + i * 0.09;
      const beep = ctx.createOscillator();
      beep.type = "square";
      beep.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.linearRampToValueAtTime(0.16, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      beep.connect(gain).connect(this.sfxGain!);
      beep.start(at);
      beep.stop(at + 0.14);
    });
  }

  /** 시한폭탄 째깍임(남은 카운트다운이 낮을 때, 본인에게만): 짧고 건조한 클릭 두 번. */
  playBombTick() {
    if (!this.gate("bombTick", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [0, 0.09].forEach((offset) => {
      const at = now + offset;
      const click = ctx.createOscillator();
      click.type = "square";
      click.frequency.value = 1400;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.linearRampToValueAtTime(0.09, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      click.connect(gain).connect(this.sfxGain!);
      click.start(at);
      click.stop(at + 0.06);
    });
  }

  /** 로비 게임 카드 클릭(2026-09-15 세션, GameCard/GameShowcaseCard의 골드 버스트 FX 동기화용) — 묵직한 카지노 칩 드롭 저음 thunk + 곧이어 번지는 크리스탈 차임 3화음(장3화음 상행). */
  playLuxuryChime() {
    if (!this.gate("luxuryChime", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thunk = ctx.createOscillator();
    thunk.type = "sine";
    thunk.frequency.setValueAtTime(180, now);
    thunk.frequency.exponentialRampToValueAtTime(70, now + 0.09);
    const thunkGain = ctx.createGain();
    thunkGain.gain.setValueAtTime(0.001, now);
    thunkGain.gain.linearRampToValueAtTime(0.24, now + 0.008);
    thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    thunk.connect(thunkGain).connect(this.sfxGain);
    thunk.start(now);
    thunk.stop(now + 0.17);

    [1046.5, 1318.5, 1568].forEach((freq, i) => {
      const at = now + 0.03 + i * 0.045;
      const bell = ctx.createOscillator();
      bell.type = "triangle";
      bell.frequency.value = freq;
      const bellGain = ctx.createGain();
      bellGain.gain.setValueAtTime(0.001, at);
      bellGain.gain.linearRampToValueAtTime(0.1, at + 0.012);
      bellGain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
      bell.connect(bellGain).connect(this.sfxGain!);
      bell.start(at);
      bell.stop(at + 0.34);
    });
  }

  /**
   * 페루도 — "베팅 확정" 골드 스탬프 (2026-09-20 액션 버튼 연출 고도화 세션).
   * `playVictoryStamp()`와 같은 저음 thud + 하이패스 crack 골격이지만, 더
   * 묵직한(80→30Hz) 단일 타격감에 `playLuxuryChime()`처럼 짧은 2음 벨 스파클을
   * 얹어 "샴페인 골드"의 화려함을 더함 — 매 라운드 여러 번 눌리는 동작이라
   * `playVictoryStamp`보다 쿨다운을 짧게(120ms) 잡음.
   */
  playPerudoBetStamp() {
    if (!this.gate("perudoBetStamp", 120)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(150, now);
    thud.frequency.exponentialRampToValueAtTime(35, now + 0.16);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.34, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.22);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 2200;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.2, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.07);

    [1568, 2093].forEach((freq, i) => {
      const at = now + 0.05 + i * 0.05;
      const sparkle = ctx.createOscillator();
      sparkle.type = "triangle";
      sparkle.frequency.value = freq;
      const sparkleGain = ctx.createGain();
      sparkleGain.gain.setValueAtTime(0.001, at);
      sparkleGain.gain.linearRampToValueAtTime(0.07, at + 0.01);
      sparkleGain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      sparkle.connect(sparkleGain).connect(this.sfxGain!);
      sparkle.start(at);
      sparkle.stop(at + 0.2);
    });
  }

  /**
   * 페루도 — "맞아(Calza)" 성공 선언 전용 에메랄드 크리스탈 차임 (2026-09-20
   * 세션). `playCorrectDing()`의 2음 상승 구조를 3음 장3화음(도미솔 위 옥타브
   * 느낌)으로 확장하고 각 음의 어택을 더 밝게(트라이앵글파) 잡아 "정확히
   * 맞혔다"는 쾌감을 강조 — 결과의 성패와 무관하게 "맞아!" 선언 자체를 외친
   * 순간 재생(판정 결과 사운드는 기존 로직 그대로 별도).
   */
  playPerudoCalzaChime() {
    if (!this.gate("perudoCalzaChime", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [880, 1108.7, 1318.5].forEach((freq, i) => {
      const at = now + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.26, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.44);
    });

    const shimmer = ctx.createBufferSource();
    shimmer.buffer = noiseBuffer(ctx);
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = "bandpass";
    shimmerFilter.frequency.value = 6000;
    shimmerFilter.Q.value = 1.4;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.001, now);
    shimmerGain.gain.linearRampToValueAtTime(0.09, now + 0.02);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    shimmer.connect(shimmerFilter).connect(shimmerGain).connect(this.sfxGain);
    shimmer.start(now);
    shimmer.stop(now + 0.32);
  }

  /**
   * 페루도 — "페루도(Dudo)" 블러핑 고발 선언 전용 크림슨 번개 스팅 (2026-09-20
   * 세션). `playTimeBombBlast()`와 같은 붐+크랙 골격을 훨씬 빠르고 날카롭게
   * (전체 ~0.35초, 폭발은 ~0.75초) 압축해 "쾅" 하는 폭발감보다 "찌릿" 한 결투
   * 선언/경고 사이렌에 가까운 스팅으로 만듦 — 저음 붐 위에 급격히 떨어지는
   * 톱니파 "번개" 글리산도를 얹어 ⚡ 슬래시 텍스트와 타이밍을 맞춤.
   */
  playPerudoDudoThunder() {
    if (!this.gate("perudoDudoThunder", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(130, now);
    boom.frequency.exponentialRampToValueAtTime(35, now + 0.22);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.42, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.3);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 1800;
    crackFilter.Q.value = 1.8;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.4, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.16);

    const bolt = ctx.createOscillator();
    bolt.type = "sawtooth";
    bolt.frequency.setValueAtTime(1400, now + 0.01);
    bolt.frequency.exponentialRampToValueAtTime(180, now + 0.2);
    const boltGain = ctx.createGain();
    boltGain.gain.setValueAtTime(0.001, now + 0.01);
    boltGain.gain.linearRampToValueAtTime(0.14, now + 0.03);
    boltGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    bolt.connect(boltGain).connect(this.sfxGain);
    bolt.start(now + 0.01);
    bolt.stop(now + 0.26);
  }

  /**
   * 페루도 — "페루도(Dudo)" 판정 결과 4분화 (2026-09-20 후속 세션). 기존
   * `playPerudoDudoThunder()`는 "선언 자체"의 번쩍임이었고, 이 넷은 그 선언이
   * 실제로 어떻게 갈렸는지(고발 성공/실패, 정확 일치/불일치)에 맞춰
   * 쇼다운 팝업과 함께 재생되는 결과음 — 판정 성패에 따라 완전히 다른 감정을
   * 전달하도록 설계.
   *
   * [블러핑 적발 성공] 번개 크랙(`playPerudoDudoThunder`와 같은 밴드패스
   * 크랙 골격) + 낮은 공(gong) 공명(저음 사인 + 배음이 안 맞는 두 개의 배음
   * 부분음으로 "쇳소리 섞인 징" 느낌).
   */
  playPerudoBluffBustedGong() {
    if (!this.gate("perudoBluffBustedGong", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 2000;
    crackFilter.Q.value = 2;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.32, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.12);

    const gongFund = ctx.createOscillator();
    gongFund.type = "sine";
    gongFund.frequency.setValueAtTime(196, now + 0.05);
    const gongFundGain = ctx.createGain();
    gongFundGain.gain.setValueAtTime(0.001, now + 0.05);
    gongFundGain.gain.linearRampToValueAtTime(0.34, now + 0.08);
    gongFundGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    gongFund.connect(gongFundGain).connect(this.sfxGain);
    gongFund.start(now + 0.05);
    gongFund.stop(now + 1.1);

    // 비화성 배음 2개 — 순정 정수배가 아닌 주파수로 "쇠 징" 특유의 탁한
    // 공명을 냄(순수 배음이면 그냥 음정 있는 벨소리처럼 들림).
    [463, 611].forEach((freq, i) => {
      const at = now + 0.06 + i * 0.01;
      const partial = ctx.createOscillator();
      partial.type = "triangle";
      partial.frequency.value = freq;
      const partialGain = ctx.createGain();
      partialGain.gain.setValueAtTime(0.001, at);
      partialGain.gain.linearRampToValueAtTime(0.1, at + 0.03);
      partialGain.gain.exponentialRampToValueAtTime(0.001, at + 0.75);
      partial.connect(partialGain).connect(this.sfxGain!);
      partial.start(at);
      partial.stop(at + 0.78);
    });
  }

  /** [고발 실패/역풍] 무겁고 둔탁한 버저 + 타격음 — `playWrongBuzz`류보다 훨씬
   * 낮고 무거운 톱니파 버저에, 착지하는 둔탁한 사인 붐을 겹침. */
  playPerudoReverseHitBuzzer() {
    if (!this.gate("perudoReverseHitBuzzer", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const buzz = ctx.createOscillator();
    buzz.type = "sawtooth";
    buzz.frequency.setValueAtTime(90, now);
    buzz.frequency.linearRampToValueAtTime(60, now + 0.35);
    const buzzGain = ctx.createGain();
    buzzGain.gain.setValueAtTime(0.001, now);
    buzzGain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    buzzGain.gain.setValueAtTime(0.3, now + 0.2);
    buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    buzz.connect(buzzGain).connect(this.sfxGain);
    buzz.start(now);
    buzz.stop(now + 0.4);

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(130, now + 0.02);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.4, now + 0.02);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now + 0.02);
    thud.stop(now + 0.32);
  }

  /** [정확 일치/신의 한 수] 고음 크리스탈 차임 + 상승 팡파르 — 기존
   * `playPerudoCalzaChime()`의 3화음 위에, 빠르게 상승하는 4음 트라이앵글
   * 팡파르를 이어 붙여 "천상의 하모니" 느낌을 더함. */
  playPerudoMiracleCalzaFanfare() {
    if (!this.gate("perudoMiracleCalzaFanfare", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [880, 1108.7, 1318.5].forEach((freq, i) => {
      const at = now + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.24, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.32);
    });

    // 상승 팡파르 — 3화음이 끝나갈 즈음부터 4음 빠르게 상승.
    [1318.5, 1568, 1760, 2093].forEach((freq, i) => {
      const at = now + 0.22 + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.22, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.42);
    });
  }

  /** [불일치] 김빠지는 금속 마찰음 + 차가운 다운비트 — 위로 스윕하는 게 아니라
   * 아래로 떨어지는 밴드패스 노이즈(금속이 긁히며 잦아드는 느낌) + 저음
   * 다운비트 한 방. */
  playPerudoCalzaMissedScrape() {
    if (!this.gate("perudoCalzaMissedScrape", 250)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const scrape = ctx.createBufferSource();
    scrape.buffer = noiseBuffer(ctx);
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = "bandpass";
    scrapeFilter.Q.value = 6;
    scrapeFilter.frequency.setValueAtTime(2600, now);
    scrapeFilter.frequency.exponentialRampToValueAtTime(400, now + 0.5);
    const scrapeGain = ctx.createGain();
    scrapeGain.gain.setValueAtTime(0.001, now);
    scrapeGain.gain.linearRampToValueAtTime(0.24, now + 0.03);
    scrapeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    scrape.connect(scrapeFilter).connect(scrapeGain).connect(this.sfxGain);
    scrape.start(now);
    scrape.stop(now + 0.56);

    const downbeat = ctx.createOscillator();
    downbeat.type = "sine";
    downbeat.frequency.setValueAtTime(110, now + 0.35);
    downbeat.frequency.exponentialRampToValueAtTime(42, now + 0.6);
    const downbeatGain = ctx.createGain();
    downbeatGain.gain.setValueAtTime(0.001, now + 0.35);
    downbeatGain.gain.linearRampToValueAtTime(0.3, now + 0.38);
    downbeatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    downbeat.connect(downbeatGain).connect(this.sfxGain);
    downbeat.start(now + 0.35);
    downbeat.stop(now + 0.78);
  }

  /** 위대한 투자 — "코인 베팅 투척음": a bright metallic clink cluster (bid submitted), landing in the bet spot. */
  playCoinDropSound() {
    if (!this.gate("coinDrop", 90)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    [2349, 2793, 3135].forEach((freq, i) => {
      const at = now + i * 0.035;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.linearRampToValueAtTime(0.16, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.18);
    });
    const clack = ctx.createBufferSource();
    clack.buffer = noiseBuffer(ctx);
    const clackFilter = ctx.createBiquadFilter();
    clackFilter.type = "bandpass";
    clackFilter.frequency.value = 3200;
    clackFilter.Q.value = 7;
    const clackGain = ctx.createGain();
    clackGain.gain.setValueAtTime(0.18, now);
    clackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    clack.connect(clackFilter).connect(clackGain).connect(this.sfxGain);
    clack.start(now);
    clack.stop(now + 0.07);
  }

  /** 위대한 투자 — "코인 회수 스윕음": a soft descending sweep (filtered noise) as a passed-out seat's stake slides back to hand. */
  playCoinSweepSound() {
    if (!this.gate("coinSweep", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;
    const duration = 0.4;

    const sweep = ctx.createBufferSource();
    sweep.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    sweep.connect(filter).connect(gain).connect(this.sfxGain);
    sweep.start(now);
    sweep.stop(now + duration + 0.02);
  }

  /** 위대한 투자 — "금고 흡수음": a deep whoosh sucking inward, ending in a muffled metallic door-thunk — a spent/forfeited bid vanishing into the vault. */
  playVaultAbsorbSound() {
    if (!this.gate("vaultAbsorb", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const suck = ctx.createBufferSource();
    suck.buffer = noiseBuffer(ctx);
    const suckFilter = ctx.createBiquadFilter();
    suckFilter.type = "lowpass";
    suckFilter.frequency.setValueAtTime(3500, now);
    suckFilter.frequency.exponentialRampToValueAtTime(200, now + 0.3);
    const suckGain = ctx.createGain();
    suckGain.gain.setValueAtTime(0.001, now);
    suckGain.gain.linearRampToValueAtTime(0.26, now + 0.1);
    suckGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    suck.connect(suckFilter).connect(suckGain).connect(this.sfxGain);
    suck.start(now);
    suck.stop(now + 0.34);

    const thunk = ctx.createOscillator();
    thunk.type = "sine";
    thunk.frequency.setValueAtTime(120, now + 0.28);
    thunk.frequency.exponentialRampToValueAtTime(40, now + 0.45);
    const thunkGain = ctx.createGain();
    thunkGain.gain.setValueAtTime(0.001, now + 0.28);
    thunkGain.gain.linearRampToValueAtTime(0.34, now + 0.31);
    thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    thunk.connect(thunkGain).connect(this.sfxGain);
    thunk.start(now + 0.28);
    thunk.stop(now + 0.56);
  }

  /** 마피아 — 낮 지목투표 "쿵!" 도장 임팩트: 묵직한 카지노 칩 탭음(저음 thud + 하이패스 클릭). */
  playMafiaNominationStamp() {
    if (!this.gate("mafiaNominationStamp", 150)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(180, now);
    thud.frequency.exponentialRampToValueAtTime(45, now + 0.14);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.3, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.2);

    const tap = ctx.createBufferSource();
    tap.buffer = noiseBuffer(ctx);
    const tapFilter = ctx.createBiquadFilter();
    tapFilter.type = "highpass";
    tapFilter.frequency.value = 2800;
    const tapGain = ctx.createGain();
    tapGain.gain.setValueAtTime(0.16, now);
    tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    tap.connect(tapFilter).connect(tapGain).connect(this.sfxGain);
    tap.start(now);
    tap.stop(now + 0.06);
  }

  /** 마피아 — 찬반 투표 "처형(GUILTY)" 확정: 철창 닫히는 굉음(저음 붐 + 금속성 클랭). */
  playMafiaGuiltyChainSlam() {
    if (!this.gate("mafiaGuiltyChain", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(90, now);
    boom.frequency.exponentialRampToValueAtTime(30, now + 0.35);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.36, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    boom.connect(boomGain).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 0.5);

    [0, 0.08].forEach((offset) => {
      const at = now + offset;
      const clank = ctx.createOscillator();
      clank.type = "square";
      clank.frequency.value = 220;
      const clankFilter = ctx.createBiquadFilter();
      clankFilter.type = "bandpass";
      clankFilter.frequency.value = 1400;
      clankFilter.Q.value = 5;
      const clankGain = ctx.createGain();
      clankGain.gain.setValueAtTime(0.001, at);
      clankGain.gain.linearRampToValueAtTime(0.2, at + 0.01);
      clankGain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      clank.connect(clankFilter).connect(clankGain).connect(this.sfxGain!);
      clank.start(at);
      clank.stop(at + 0.22);
    });
  }

  /** 마피아 — 찬반 투표 "구원(INNOCENT)" 확정: 성스러운 차임(맑은 3화음 벨). */
  playMafiaInnocentChime() {
    if (!this.gate("mafiaInnocentChime", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [784, 987.8, 1174.7].forEach((freq, i) => {
      const at = now + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.24, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.62);
    });
  }

  /** 마피아 — 처형/밤 피격 사망: 기요틴 낙하 + 참수 임팩트(날카로운 스윕 + 저음 임팩트). */
  playMafiaExecutionImpact() {
    if (!this.gate("mafiaExecutionImpact", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const swoosh = ctx.createBufferSource();
    swoosh.buffer = noiseBuffer(ctx);
    const swooshFilter = ctx.createBiquadFilter();
    swooshFilter.type = "bandpass";
    swooshFilter.Q.value = 2;
    swooshFilter.frequency.setValueAtTime(6000, now);
    swooshFilter.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    const swooshGain = ctx.createGain();
    swooshGain.gain.setValueAtTime(0.3, now);
    swooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    swoosh.connect(swooshFilter).connect(swooshGain).connect(this.sfxGain);
    swoosh.start(now);
    swoosh.stop(now + 0.25);

    const impact = ctx.createOscillator();
    impact.type = "sine";
    impact.frequency.setValueAtTime(160, now + 0.2);
    impact.frequency.exponentialRampToValueAtTime(35, now + 0.5);
    const impactGain = ctx.createGain();
    impactGain.gain.setValueAtTime(0.001, now + 0.2);
    impactGain.gain.linearRampToValueAtTime(0.4, now + 0.22);
    impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    impact.connect(impactGain).connect(this.sfxGain);
    impact.start(now + 0.2);
    impact.stop(now + 0.62);
  }

  /** 마피아 — 평화로운 아침(PEACEFUL DAWN): 성당 종소리(저음 배음) + 상승하는 하프 글리산도. */
  playMafiaMorningPeaceful() {
    if (!this.gate("mafiaMorningPeaceful", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    // 성당 종 — 기본음 + 배음 2개, 긴 감쇠.
    [220, 440, 659.3].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const peak = i === 0 ? 0.22 : 0.09;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 1.85);
    });

    // 상승하는 하프 글리산도.
    [523.3, 587.3, 659.3, 784, 880, 1046.5, 1318.5].forEach((freq, i) => {
      const at = now + 0.3 + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.13, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.52);
    });
  }

  /** 마피아 — 비극의 아침(TRAGIC DAWN): 총성 크랙 + 심장박동 2회 + 낮은 장례 종. */
  playMafiaMorningTragic() {
    if (!this.gate("mafiaMorningTragic", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    // 총성 — 날카로운 노이즈 크랙 + 저음 텅.
    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 800;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.5, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.13);

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(120, now);
    thud.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.35, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    thud.connect(thudGain).connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.36);

    // 심장박동 2회.
    [0.5, 0.95].forEach((offset) => {
      const beat = ctx.createOscillator();
      beat.type = "sine";
      beat.frequency.setValueAtTime(70, now + offset);
      beat.frequency.exponentialRampToValueAtTime(35, now + offset + 0.18);
      const beatGain = ctx.createGain();
      beatGain.gain.setValueAtTime(0.28, now + offset);
      beatGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.2);
      beat.connect(beatGain).connect(this.sfxGain!);
      beat.start(now + offset);
      beat.stop(now + offset + 0.22);
    });

    // 낮은 장례 종 — 불협 배음.
    [110, 146.8].forEach((freq, i) => {
      const at = now + 1.5;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(i === 0 ? 0.2 : 0.1, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 1.6);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 1.65);
    });
  }

  /** 마피아 — 경찰 조사 "마피아 적발": 비상 경보 사이렌(오르내리는 톱니파). */
  playMafiaSirenAlert() {
    if (!this.gate("mafiaSirenAlert", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const siren = ctx.createOscillator();
    siren.type = "sawtooth";
    const sirenGain = ctx.createGain();
    sirenGain.gain.setValueAtTime(0.001, now);
    sirenGain.gain.linearRampToValueAtTime(0.18, now + 0.05);
    for (let i = 0; i < 3; i++) {
      const at = now + i * 0.25;
      siren.frequency.setValueAtTime(500, at);
      siren.frequency.linearRampToValueAtTime(900, at + 0.12);
      siren.frequency.linearRampToValueAtTime(500, at + 0.25);
    }
    sirenGain.gain.setValueAtTime(0.18, now + 0.7);
    sirenGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    siren.connect(sirenGain).connect(this.sfxGain);
    siren.start(now);
    siren.stop(now + 0.86);
  }

  /** 마피아 — 경찰 조사 "결백 확인": 온화한 레이더 스캔 확인음(상승 스윕 + 딩). */
  playMafiaCleanScan() {
    if (!this.gate("mafiaCleanScan", 300)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const sweep = ctx.createOscillator();
    sweep.type = "sine";
    sweep.frequency.setValueAtTime(400, now);
    sweep.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(0.001, now);
    sweepGain.gain.linearRampToValueAtTime(0.14, now + 0.05);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    sweep.connect(sweepGain).connect(this.sfxGain);
    sweep.start(now);
    sweep.stop(now + 0.32);

    const ding = ctx.createOscillator();
    ding.type = "triangle";
    ding.frequency.value = 1568;
    const dingGain = ctx.createGain();
    dingGain.gain.setValueAtTime(0.001, now + 0.28);
    dingGain.gain.linearRampToValueAtTime(0.16, now + 0.3);
    dingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    ding.connect(dingGain).connect(this.sfxGain);
    ding.start(now + 0.28);
    ding.stop(now + 0.56);
  }

  /** 마피아 — 과반수 스킵 골드 배너: 짧고 경쾌한 팡파레 딩. */
  playMafiaSkipBanner() {
    if (!this.gate("mafiaSkipBanner", 200)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [880, 1108.7].forEach((freq, i) => {
      const at = now + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.34);
    });
  }

  /** 마피아 — 밤 액션 차례 알림(2026-09-20 요청): 묵직한 서브베이스 텐션 드롭. */
  playMafiaNightActionCue() {
    if (!this.gate("mafiaNightActionCue", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const drop = ctx.createOscillator();
    drop.type = "sine";
    drop.frequency.setValueAtTime(180, now);
    drop.frequency.exponentialRampToValueAtTime(45, now + 0.5);
    const dropGain = ctx.createGain();
    dropGain.gain.setValueAtTime(0.001, now);
    dropGain.gain.linearRampToValueAtTime(0.32, now + 0.05);
    dropGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    drop.connect(dropGain).connect(this.sfxGain);
    drop.start(now);
    drop.stop(now + 0.72);
  }

  /** 마피아 — 낮 지목투표 개시(2026-09-20 요청): 법정 망치(가벨) 2연타. */
  playMafiaVoteGavelCue() {
    if (!this.gate("mafiaVoteGavelCue", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [0, 0.18].forEach((offset) => {
      const at = now + offset;
      const crack = ctx.createBufferSource();
      crack.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 3;
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
      crack.connect(filter).connect(gain).connect(this.sfxGain!);
      crack.start(at);
      crack.stop(at + 0.16);

      const thud = ctx.createOscillator();
      thud.type = "sine";
      thud.frequency.setValueAtTime(140, at);
      thud.frequency.exponentialRampToValueAtTime(50, at + 0.2);
      const thudGain = ctx.createGain();
      thudGain.gain.setValueAtTime(0.3, at);
      thudGain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      thud.connect(thudGain).connect(this.sfxGain!);
      thud.start(at);
      thud.stop(at + 0.24);
    });
  }

  /** 마피아 — 최종 찬반투표 개시(2026-09-20 요청): 팽팽한 심장 박동 4회(lub-dub ×2). */
  playMafiaFinalVerdictCue() {
    if (!this.gate("mafiaFinalVerdictCue", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [0, 0.42, 0.9, 1.3].forEach((offset, i) => {
      const at = now + offset;
      const beat = ctx.createOscillator();
      beat.type = "sine";
      beat.frequency.setValueAtTime(80, at);
      beat.frequency.exponentialRampToValueAtTime(38, at + 0.16);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(i % 2 === 0 ? 0.32 : 0.22, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      beat.connect(gain).connect(this.sfxGain!);
      beat.start(at);
      beat.stop(at + 0.2);
    });
  }

  /** 마피아 — 경찰 조사 익명 공개 발표: 성공(2026-09-21 요청). 밝게 상승하는 2음 벨(공공 방송 알림음), 좌석을 지목하는 사이렌보다 훨씬 절제된 톤. */
  playMafiaPublicCheckSuccess() {
    if (!this.gate("mafiaPublicCheckSuccess", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    [880, 1174.7].forEach((freq, i) => {
      const at = now + i * 0.14;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.18, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(at);
      osc.stop(at + 0.37);
    });
  }

  /** 마피아 — 경찰 조사 익명 공개 발표: 실패(2026-09-21 요청). 낮은 단음 벨 — 성공음보다 짧고 무덤덤한 톤. */
  playMafiaPublicCheckFail() {
    if (!this.gate("mafiaPublicCheckFail", 400)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 440;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.42);
  }
}

let instance: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
  if (!instance) instance = new SoundEngine();
  return instance;
}
