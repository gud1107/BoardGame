"use client";

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { getRatSound } from "./ratSound";

/**
 * 🐱 Sneaky Cat BGM / 🔔 효과음 toggles next to the rulebook button. Both
 * write the site-wide audio settings store (same as the header 🔇/🔊 and the
 * settings modal, where the volume sliders live). Turning one on from the
 * all-muted default also lifts the master mute. The click doubles as the user
 * gesture that unlocks the AudioContext.
 */
export default function RatSoundHud() {
  const s = useAudioSettingsStore();
  const bgmOn = !isBgmEffectivelyMuted(s);
  const sfxOn = !isSfxEffectivelyMuted(s);

  function toggle(kind: "bgm" | "sfx") {
    const sound = getRatSound();
    sound.unlock();
    const setMuted = kind === "bgm" ? s.setBgmMuted : s.setSfxMuted;
    if (kind === "bgm" ? bgmOn : sfxOn) {
      setMuted(true);
      return;
    }
    s.setMasterMuted(false);
    setMuted(false);
    if (kind === "sfx") setTimeout(() => sound.drawCard(), 30); // audible confirmation
  }

  const cls = (on: boolean) =>
    `flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition select-none ${
      on
        ? "border-emerald-500/70 bg-emerald-950/80 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.4)] light:bg-emerald-50 light:text-emerald-800"
        : "border-white/10 text-white/45 hover:border-white/25 light:border-slate-200 light:text-slate-400"
    }`;

  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => toggle("bgm")} aria-pressed={bgmOn} className={cls(bgmOn)} title={bgmOn ? "살금살금 BGM 끄기 (볼륨은 상단 설정)" : "살금살금 BGM 켜기"}>
        <span className={bgmOn ? "" : "opacity-60 grayscale"}>{bgmOn ? "🐱" : "🔇"}</span>
        <span className={`hidden sm:inline ${bgmOn ? "" : "line-through"}`}>Sneaky Cat</span>
      </button>
      <button type="button" onClick={() => toggle("sfx")} aria-pressed={sfxOn} className={cls(sfxOn)} title={sfxOn ? "효과음 끄기" : "효과음 켜기"}>
        {sfxOn ? "🔔" : "🔕"}
        <span className="hidden sm:inline">효과음</span>
      </button>
    </span>
  );
}
