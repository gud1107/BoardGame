"use client";

import { useAudioSettingsStore } from "@/lib/audio/audioSettings";

/**
 * Soft music bed + transition whoosh for explainer videos (pure Web Audio,
 * no files). Like the narration it follows the player's own toggle, not the
 * site-wide mute; volume follows the site's BGM slider and ducks under the
 * narrator's voice so the words stay clear.
 */

/** I–vi–IV–V-ish warm pad, one chord per 4 s of video time. Hz. */
const CHORDS: number[][] = [
  [261.63, 329.63, 392.0],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [196.0, 246.94, 293.66],
];
const CHORD_SECONDS = 4;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let voices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
let chordIdx = -1;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  master.connect(lp).connect(ctx.destination);
  // Three chord tones, each a pair of slightly detuned oscillators.
  voices = [0, 1, 2].map(() => {
    const gain = ctx!.createGain();
    gain.gain.value = 0.33;
    gain.connect(master!);
    const osc = [-6, 6].map((detune, k) => {
      const o = ctx!.createOscillator();
      o.type = k === 0 ? "sine" : "triangle";
      o.detune.value = detune;
      o.frequency.value = 261.63;
      o.connect(gain);
      o.start();
      return o;
    });
    return { osc, gain };
  });
  return ctx;
}

function level(): number {
  const v = useAudioSettingsStore.getState().bgmVolume ?? 0.4;
  return 0.05 * Math.min(1, Math.max(0, v) / 0.4);
}

/** Call from the ▶ gesture so iOS lets the context run. */
export function unlockMusic() {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

/**
 * Drive the bed from the player's clock every frame. `on` = playing with
 * music enabled; `speaking` ducks it under the narration.
 */
export function updateMusic(videoTime: number, on: boolean, speaking: boolean) {
  if (!on && !ctx) return;
  const c = ensure();
  if (!c || !master) return;
  const target = on ? level() * (speaking ? 0.45 : 1) : 0;
  master.gain.setTargetAtTime(target, c.currentTime, on ? 0.25 : 0.12);
  if (!on) return;
  const idx = Math.floor(Math.max(0, videoTime) / CHORD_SECONDS) % CHORDS.length;
  if (idx === chordIdx) return;
  chordIdx = idx;
  CHORDS[idx].forEach((f, i) => {
    for (const o of voices[i]?.osc ?? []) o.frequency.setTargetAtTime(f / 2 ** (i === 0 ? 1 : 0), c.currentTime, 0.35);
  });
}

/** Soft filtered-noise whoosh for a scene change (`big` for chapter wipes). */
export function whoosh(big = false) {
  const c = ctx;
  if (!c || c.state !== "running") return;
  const len = big ? 0.7 : 0.4;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  const now = c.currentTime;
  bp.frequency.setValueAtTime(big ? 300 : 600, now);
  bp.frequency.exponentialRampToValueAtTime(big ? 2400 : 1800, now + len);
  const g = c.createGain();
  const peak = level() * (big ? 2.2 : 1.4);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + len * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, now + len);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(now);
  src.stop(now + len + 0.05);
}

/** Silence the bed right away (player unmount). */
export function stopMusic() {
  if (!ctx || !master) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(0, ctx.currentTime);
  chordIdx = -1;
  // Idle oscillators still cost CPU — park the context until the next ▶.
  void ctx.suspend().catch(() => {});
}
