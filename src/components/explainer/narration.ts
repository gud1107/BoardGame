"use client";

import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { speakable } from "./timeline";

/**
 * Explainer narration through the browser's own speech synthesis — no audio
 * files. Follows the site's sound mute/volume. Devices without a Korean voice
 * stay silent (subtitles still play at normal pace).
 */

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const PREFERRED = [/natural|neural|online/i, /google/i, /yuna|sunhi|heami|injoon|seoyeon/i];

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

export function siteMuted(): boolean {
  return isSfxEffectivelyMuted(useAudioSettingsStore.getState());
}

let speaking = false;

/** True while an utterance started by `speak` is still being read. */
export function isSpeaking(): boolean {
  return speaking;
}

/** Read `text` aloud. Returns a cancel function. */
export function speak(text: string, rate: number): () => void {
  if (!speechSupported() || siteMuted()) return () => {};
  const line = speakable(text);
  if (!line) return () => {};
  const synth = window.speechSynthesis;
  const v = koreanVoice();
  if (!v && synth.getVoices().length > 0) return () => {};
  const u = new SpeechSynthesisUtterance(line);
  u.lang = "ko-KR";
  if (v) u.voice = v;
  u.rate = Math.min(2, Math.max(0.5, rate));
  u.pitch = 1.02;
  u.volume = Math.min(1, useAudioSettingsStore.getState().sfxVolume ?? 0.8);
  let live = true;
  const done = () => {
    if (live) speaking = false;
    live = false;
  };
  u.onend = done;
  u.onerror = done;
  // Some browsers drop onend — never let `speaking` stick forever.
  const safety = window.setTimeout(done, 1500 + (line.length * 140) / u.rate);
  try {
    synth.cancel();
    speaking = true;
    synth.speak(u);
  } catch {
    done();
  }
  return () => {
    window.clearTimeout(safety);
    u.onend = null;
    u.onerror = null;
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
