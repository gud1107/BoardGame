"use client";

import { useSyncExternalStore } from "react";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";

/**
 * 하루 재생 브이로그 내레이션 — 브라우저 음성 합성(Web Speech, 음성 파일 없음)으로 자막을 읽는다.
 * 사이트 효과음 음소거·볼륨을 따르고, 재생기의 🎙️ 버튼으로 따로 끌 수 있다(이 기기에만 저장).
 * 한국어 음성이 없는 기기에선 조용히 아무것도 안 한다 — 그래도 재생은 평소 속도로 흘러간다.
 */

const KEY = "god-life-planner:vlog-voice";
const listeners = new Set<() => void>();

function readPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
let pref = typeof window === "undefined" ? true : readPref();

export function setVoicePref(on: boolean) {
  pref = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // 저장이 막혀 있으면 이번 접속 동안만 기억
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useVoicePref(): boolean {
  return useSyncExternalStore(subscribe, () => pref, () => true);
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 실제로 목소리가 나는 상태인가(내 설정 + 사이트 음소거 + 지원 여부). */
export function voiceAudible(): boolean {
  return pref && speechSupported() && !isSfxEffectivelyMuted(useAudioSettingsStore.getState());
}

// 자연스러운 음성 우선(신경망 → Google → 기기 기본 한국어)
const PREFERRED = [/natural|neural|online/i, /google/i, /yuna|sunhi|heami|injoon|seoyeon/i];

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

/** 이모지·기호를 빼고 읽기 좋은 문장만 남긴다. */
function speakable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    // TTS reads "~" aloud as "물결표"
    .replace(/[·…~]/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `text`를 읽고 끝나면 `onEnd`. 반환값은 취소 함수. 목소리가 안 나는 상태면 바로 `onEnd`를
 * 다음 틱에 부른다. 일부 브라우저가 onend를 빼먹어서 글자 수로 계산한 안전 타이머도 건다.
 */
export function narrate(text: string, rate: number, onEnd: () => void): () => void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd();
  };
  const line = speakable(text);
  if (!line || !voiceAudible()) {
    const t = window.setTimeout(finish, 0);
    return () => window.clearTimeout(t);
  }
  const synth = window.speechSynthesis;
  const v = koreanVoice();
  // 음성 목록은 받았는데 한국어가 없으면 외국어 음성으로 읽지 않는다
  if (!v && synth.getVoices().length > 0) {
    const t = window.setTimeout(finish, 0);
    return () => window.clearTimeout(t);
  }
  const u = new SpeechSynthesisUtterance(line);
  u.lang = "ko-KR";
  if (v) u.voice = v;
  u.rate = rate;
  u.pitch = 1.08;
  u.volume = Math.min(1, useAudioSettingsStore.getState().sfxVolume ?? 0.7);
  u.onend = finish;
  u.onerror = finish;
  const safety = window.setTimeout(finish, 1200 + (line.length * 120) / rate);
  try {
    synth.cancel();
    synth.speak(u);
  } catch {
    finish();
  }
  return () => {
    done = true;
    window.clearTimeout(safety);
    u.onend = null;
    u.onerror = null;
    try {
      synth.cancel();
    } catch {
      // 무시
    }
  };
}

/**
 * iOS 사파리 등은 사용자 제스처 안에서 한 번 말해야 그 뒤 자동 발화가 된다 — 🎙️·재생 버튼을
 * 누를 때 거의 무음으로 한 번 말해 둔다.
 */
export function unlockVoice() {
  if (!speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // 무시
  }
}
