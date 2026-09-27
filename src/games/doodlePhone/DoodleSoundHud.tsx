"use client";

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { getDoodlePhoneSound } from "./doodlePhoneSound";

/**
 * 🎵 로파이 BGM / 🔔 효과음 toggles next to the rulebook button. Both write the
 * site-wide audio settings store (same as the header 🔇/🔊 and the settings
 * modal, where the volume sliders live). Turning one on from the all-muted
 * default also lifts the master mute. The click doubles as the user gesture
 * that unlocks the AudioContext.
 */
export default function DoodleSoundHud() {
  const s = useAudioSettingsStore();
  const bgmOn = !isBgmEffectivelyMuted(s);
  const sfxOn = !isSfxEffectivelyMuted(s);

  function toggle(kind: "bgm" | "sfx") {
    const sound = getDoodlePhoneSound();
    sound.unlock();
    const setMuted = kind === "bgm" ? s.setBgmMuted : s.setSfxMuted;
    if (kind === "bgm" ? bgmOn : sfxOn) {
      setMuted(true);
      return;
    }
    s.setMasterMuted(false);
    setMuted(false);
    if (kind === "sfx") setTimeout(() => sound.submitPop(), 30); // audible confirmation
  }

  const cls = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
      on
        ? "border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-100 light:bg-fuchsia-50 light:text-fuchsia-800"
        : "border-white/10 text-white/45 hover:border-white/25 light:border-slate-200 light:text-slate-400"
    }`;

  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => toggle("bgm")} aria-pressed={bgmOn} className={cls(bgmOn)} title={bgmOn ? "로파이 BGM 끄기 (볼륨은 상단 설정)" : "로파이 BGM 켜기"}>
        <span className={bgmOn ? "inline-block animate-pulse [animation-duration:2.4s]" : "opacity-60 grayscale"}>🎵</span>
        <span className={`ml-1 ${bgmOn ? "" : "line-through"}`}>Lo-Fi</span>
      </button>
      <button type="button" onClick={() => toggle("sfx")} aria-pressed={sfxOn} className={cls(sfxOn)} title={sfxOn ? "효과음 끄기" : "효과음 켜기"}>
        {sfxOn ? "🔔" : "🔕"}
        <span className="ml-1 hidden sm:inline">효과음</span>
      </button>
    </span>
  );
}
