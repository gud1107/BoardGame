import { getSoundEngine } from "@/lib/audio/soundEngine";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import type { UnitKind } from "./engine";

/**
 * Maps 랜덤 합성 디펜스 moments onto the project's shared, code-synthesized
 * SFX (src/lib/audio/soundEngine.ts — no mp3 assets). Reuses existing cues only.
 */

export function playSummon(lucky: boolean) {
  const sfx = getSoundEngine();
  if (lucky) sfx.playLuxuryChime();
  else sfx.playCardFlick();
}

export function playMerge(grade: number) {
  const sfx = getSoundEngine();
  if (grade >= 4) sfx.playHandFanfare();
  else sfx.playGridSnap();
}

export function playGamble(success: boolean) {
  const sfx = getSoundEngine();
  if (success) sfx.playLuxuryChime();
  else sfx.playWrongBuzz();
}

export function playUpgrade() {
  getSoundEngine().playCoinDropSound();
}

export function playBossWave() {
  getSoundEngine().playRevolutionBell();
}

export function playBossKill() {
  getSoundEngine().playTreasureGrab();
}

export function playEliteIncoming() {
  getSoundEngine().playDeathCardSting();
}

export function playOut() {
  getSoundEngine().playEliminationSlam();
}

export function playVictory() {
  getSoundEngine().playFinishFanfare();
}

export function playSendUnit() {
  getSoundEngine().playCardDrawWhoosh();
}

// ---------------------------------------------------------------------------
// Per-tower hit sounds. Attacks fire many times a second, so these get their
// own tiny synth: very low level, each kind rate-limited, and a global cap so
// a full board stays a soft patter under the louder event cues above.
// Mute/volume follow the site-wide SFX settings.
// ---------------------------------------------------------------------------

/** Peak gain at SFX slider = 1 — deliberately far below the shared cues. */
const HIT_LEVEL = 0.07;
const HIT_KIND_GAP_MS: Record<UnitKind, number> = { archer: 110, mage: 160, frost: 150, thunder: 150, poison: 190 };
const HIT_GLOBAL_GAP_MS = 45;

let hitCtx: AudioContext | null = null;
let hitBus: GainNode | null = null;
let hitNoise: AudioBuffer | null = null;
let lastHitAt = 0;
const lastHitKindAt: Partial<Record<UnitKind, number>> = {};

function hitAudio(): { ctx: AudioContext; bus: GainNode; noise: AudioBuffer } | null {
  if (typeof window === "undefined") return null;
  if (!hitCtx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    hitCtx = new AC();
    hitBus = hitCtx.createGain();
    hitBus.connect(hitCtx.destination);
    const len = Math.floor(hitCtx.sampleRate * 0.3);
    hitNoise = hitCtx.createBuffer(1, len, hitCtx.sampleRate);
    const d = hitNoise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (hitCtx.state === "suspended") hitCtx.resume().catch(() => {});
  return hitCtx.state === "running" && hitBus && hitNoise ? { ctx: hitCtx, bus: hitBus, noise: hitNoise } : null;
}

/** Call from a user gesture so the hit-sound context may start (autoplay policy). */
export function unlockHitSounds() {
  hitAudio();
}

function env(ctx: AudioContext, bus: GainNode, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(bus);
  return g;
}

function tone(ctx: AudioContext, out: GainNode, type: OscillatorType, f0: number, f1: number, dur: number) {
  const o = ctx.createOscillator();
  const t = ctx.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(ctx: AudioContext, buf: AudioBuffer, out: GainNode, type: BiquadFilterType, freq: number, q: number, dur: number) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(out);
  const t = ctx.currentTime;
  src.start(t, Math.random() * 0.15);
  src.stop(t + dur);
}

/** One soft hit for a tower attack; silently skipped when rate-limited or muted. */
export function playTowerHit(kind: UnitKind, grade: number) {
  const settings = useAudioSettingsStore.getState();
  if (isSfxEffectivelyMuted(settings) || settings.sfxVolume <= 0) return;
  const nowMs = performance.now();
  if (nowMs - lastHitAt < HIT_GLOBAL_GAP_MS) return;
  if (nowMs - (lastHitKindAt[kind] ?? -1e9) < HIT_KIND_GAP_MS[kind]) return;
  const a = hitAudio();
  if (!a) return;
  lastHitAt = nowMs;
  lastHitKindAt[kind] = nowMs;
  const { ctx, bus, noise: buf } = a;
  bus.gain.value = HIT_LEVEL * settings.sfxVolume;
  // Higher grades ring a little brighter; slight random detune keeps repeats from droning.
  const p = (1 + (grade - 1) * 0.06) * (0.96 + Math.random() * 0.08);
  switch (kind) {
    case "archer": {
      // Bowstring "thwip": a short high noise flick plus a tiny pluck.
      noise(ctx, buf, env(ctx, bus, 0.7, 0.003, 0.05), "bandpass", 3200 * p, 2.5, 0.07);
      tone(ctx, env(ctx, bus, 0.35, 0.002, 0.06), "triangle", 700 * p, 380 * p, 0.07);
      break;
    }
    case "mage": {
      // Soft arcane "poof": low sine drop under a muffled burst.
      tone(ctx, env(ctx, bus, 0.6, 0.006, 0.16), "sine", 330 * p, 120 * p, 0.17);
      noise(ctx, buf, env(ctx, bus, 0.4, 0.008, 0.14), "lowpass", 900 * p, 0.8, 0.16);
      break;
    }
    case "frost": {
      // Glassy "tink": two bright partials.
      tone(ctx, env(ctx, bus, 0.35, 0.002, 0.12), "sine", 1900 * p, 1750 * p, 0.13);
      tone(ctx, env(ctx, bus, 0.18, 0.002, 0.08), "sine", 2850 * p, 2700 * p, 0.09);
      break;
    }
    case "thunder": {
      // Electric "zzt": a fast falling square through a bandpass.
      const out = env(ctx, bus, 0.22, 0.002, 0.08);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1400 * p;
      f.Q.value = 1.5;
      f.connect(out);
      const o = ctx.createOscillator();
      const t = ctx.currentTime;
      o.type = "square";
      o.frequency.setValueAtTime(900 * p, t);
      o.frequency.exponentialRampToValueAtTime(160 * p, t + 0.08);
      o.connect(f);
      o.start(t);
      o.stop(t + 0.1);
      noise(ctx, buf, env(ctx, bus, 0.3, 0.001, 0.05), "highpass", 2500, 0.7, 0.06);
      break;
    }
    case "poison": {
      // Bubbly "blup": a rising sine blip.
      tone(ctx, env(ctx, bus, 0.45, 0.004, 0.09), "sine", 260 * p, 620 * p, 0.1);
      break;
    }
  }
}
