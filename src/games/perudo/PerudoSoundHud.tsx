"use client";

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { getPerudoSound } from "./perudoSound";

/**
 * 🎲 Inca Dice BGM / 🔔 효과음 toggles next to the rulebook button (replacing
 * the old single master-mute 🔊 button). Both write the site-wide audio
 * settings store (same as the header 🔇/🔊 and the settings modal, where the
 * volume sliders live). Turning one on from the all-muted default also lifts
 * the master mute. The click doubles as the user gesture that unlocks both
 * AudioContexts.
 */
export default function PerudoSoundHud() {
  const s = useAudioSettingsStore();
  const bgmOn = !isBgmEffectivelyMuted(s);
  const sfxOn = !isSfxEffectivelyMuted(s);

  function toggle(kind: "bgm" | "sfx") {
    getPerudoSound().unlock();
    getSoundEngine().unlock();
    const setMuted = kind === "bgm" ? s.setBgmMuted : s.setSfxMuted;
    if (kind === "bgm" ? bgmOn : sfxOn) {
      setMuted(true);
      return;
    }
    s.setMasterMuted(false);
    setMuted(false);
    if (kind === "sfx") setTimeout(() => getSoundEngine().playPerudoBetStamp(), 30); // audible confirmation
  }

  const cls = (on: boolean) =>
    `flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition select-none ${
      on
        ? "border-amber-600/80 bg-amber-950/80 text-amber-200 shadow-[0_0_12px_rgba(217,119,6,0.35)] light:border-amber-500 light:bg-amber-50 light:text-amber-800"
        : "border-white/15 text-white/45 hover:border-white/30 light:border-slate-300 light:text-slate-500 light:hover:border-slate-400"
    }`;

  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => toggle("bgm")} aria-pressed={bgmOn} className={cls(bgmOn)} title={bgmOn ? "잉카 미스터리 BGM 끄기 (볼륨은 상단 설정)" : "잉카 미스터리 BGM 켜기"}>
        <span className={bgmOn ? "" : "opacity-60 grayscale"}>{bgmOn ? "🎲" : "🔇"}</span>
        <span className={`hidden sm:inline ${bgmOn ? "" : "line-through"}`}>Inca Dice</span>
      </button>
      <button type="button" onClick={() => toggle("sfx")} aria-pressed={sfxOn} className={cls(sfxOn)} title={sfxOn ? "효과음 끄기" : "효과음 켜기"}>
        {sfxOn ? "🔔" : "🔕"}
        <span className="hidden sm:inline">효과음</span>
      </button>
    </span>
  );
}
