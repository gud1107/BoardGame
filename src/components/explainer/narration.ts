"use client";

import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { speakable } from "./timeline";

/**
 * Explainer narration through the browser's own speech synthesis — no audio
 * files. Like a video the viewer pressed ▶ on, it is controlled by the
 * player's own 🔊 toggle, NOT the site-wide mute (which defaults to muted for
 * every new visitor — following it meant first-timers never heard a word).
 * Volume still follows the site's SFX volume. Devices without a Korean voice
 * stay silent (subtitles still play at normal pace).
 */

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Rank the device's Korean voices — neural/"Natural" cloud voices (Edge's
 * SunHi/InJoon Online), Apple's Enhanced/Premium Yuna, Google's Korean voice,
 * then anything named, with the old robotic SAPI voices (Heami) last.
 */
export function voiceScore(name: string): number {
  const n = name.toLowerCase();
  if (/natural|neural/.test(n)) return 100;
  if (/premium|enhanced|고품질/.test(n)) return 90;
  if (/online/.test(n)) return 85;
  if (/google/.test(n)) return 80;
  if (/yuna|sora|minsu|jian|suhyun|sunhi|injoon|hyunsu|seoyeon/.test(n)) return 60;
  if (/heami/.test(n)) return 10;
  return 30;
}

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
  if (voices.length === 0) return null;
  return [...voices].sort((a, b) => voiceScore(b.name) - voiceScore(a.name) || Number(b.localService) - Number(a.localService))[0];
}

/** The best Korean voice's name on this device (shown in the player's info). */
export function narratorName(): string | null {
  if (!speechSupported()) return null;
  return koreanVoice()?.name ?? null;
}

/**
 * Breath groups: one utterance per clause so the voice pauses where a person
 * would (sentence ends, commas) instead of reading a long line in one breath.
 * Tiny fragments are glued to a neighbour so it doesn't sound choppy.
 */
export function phrases(line: string): string[] {
  const raw = line.split(/(?<=[.!?])\s+|(?<=,)\s+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of raw) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (part.replace(/\s/g, "").length < 6 || prev.replace(/\s/g, "").length < 6)) out[out.length - 1] = `${prev} ${part}`;
    else out.push(part);
  }
  return out;
}

let speaking = false;

/** True while an utterance started by `speak` is still being read. */
export function isSpeaking(): boolean {
  return speaking;
}

/** Slightly under 1× reads clearer; scaled by the player's playback speed. */
export const NARRATION_RATE = 0.97;

/** Read `text` aloud, phrase by phrase. Returns a cancel function. */
export function speak(text: string, speed: number): () => void {
  if (!speechSupported()) return () => {};
  const line = speakable(text);
  if (!line) return () => {};
  const synth = window.speechSynthesis;
  const v = koreanVoice();
  if (!v && synth.getVoices().length > 0) return () => {};
  const rate = Math.min(2, Math.max(0.5, NARRATION_RATE * speed));
  const volume = Math.min(1, useAudioSettingsStore.getState().sfxVolume ?? 0.8);
  const parts = phrases(line);
  let live = true;
  const done = () => {
    if (live) speaking = false;
    live = false;
  };
  const utterances = parts.map((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = "ko-KR";
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = 1;
    u.volume = volume;
    if (i === parts.length - 1) {
      u.onend = done;
      u.onerror = done;
    } else u.onerror = done;
    return u;
  });
  // Some browsers drop onend — never let `speaking` stick forever.
  const safety = window.setTimeout(done, 2000 + (line.length * 170) / rate);
  try {
    synth.cancel();
    speaking = true;
    for (const u of utterances) synth.speak(u);
  } catch {
    done();
  }
  return () => {
    window.clearTimeout(safety);
    for (const u of utterances) {
      u.onend = null;
      u.onerror = null;
    }
    if (live) speaking = false;
    live = false;
    try {
      synth.cancel();
    } catch {
      // ignore
    }
  };
}

/** iOS Safari only speaks after one utterance inside a user gesture. */
export function unlockSpeech() {
  if (!speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}

export function stopSpeech() {
  speaking = false;
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
