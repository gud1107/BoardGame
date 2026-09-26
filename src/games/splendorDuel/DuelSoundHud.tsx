"use client";

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { getSplendorDuelSound } from "./splendorDuelSound";

/**
 * 🎻 Chamber Noir BGM / 🔔 SFX toggles next to the rulebook button. Both write the
 * site-wide audio settings store, so they stay in sync with the header's
 * 🔇/🔊 and the settings modal (where the volume sliders live). Turning one
 * on from the all-muted default also lifts the master mute.
 */
export default function DuelSoundHud() {
  const s = useAudioSettingsStore();
  const bgmOn = !isBgmEffectivelyMuted(s);
  const sfxOn = !isSfxEffectivelyMuted(s);

  function toggle(kind: "bgm" | "sfx") {
    const sound = getSplendorDuelSound();
    sound.unlock();
    const on = kind === "bgm" ? bgmOn : sfxOn;
    if (on) {
      (kind === "bgm" ? s.setBgmMuted : s.setSfxMuted)(true);
      return;
    }
    s.setMasterMuted(false);
    (kind === "bgm" ? s.setBgmMuted : s.setSfxMuted)(false);
    // Preview so the player hears it's live (the BGM starts on its own).
    if (kind === "sfx") setTimeout(() => sound.gemPick(), 30);
  }

  const cls = (on: boolean, noir = false) =>
    `shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold transition ${
      on && noir
        ? "border-rose-500/70 bg-rose-950/80 text-rose-200 shadow-[0_0_12px_rgba(225,29,72,0.4)] light:bg-rose-100 light:text-rose-800"
        : on
        ? "border-amber-400/60 bg-amber-950/70 text-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.3)] light:bg-amber-100 light:text-amber-800"
        : "border-white/10 text-white/40 hover:border-white/25 light:border-slate-200 light:text-slate-400"
    }`;

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={() => toggle("bgm")} className={cls(bgmOn, true)} title={bgmOn ? "챔버 느와르 BGM 끄기 (볼륨은 상단 설정)" : "챔버 느와르 BGM 켜기"} aria-pressed={bgmOn}>
        <span className={`inline-block ${bgmOn ? "animate-pulse" : "opacity-50 grayscale"}`}>🎻</span>
        <span className={`ml-0.5 hidden sm:inline ${bgmOn ? "" : "line-through"}`}>BGM</span>
      </button>
      <button type="button" onClick={() => toggle("sfx")} className={cls(sfxOn)} title={sfxOn ? "효과음 끄기 (볼륨은 상단 설정)" : "효과음 켜기"} aria-pressed={sfxOn}>
        {sfxOn ? "🔔" : "🔕"}
        <span className="ml-0.5 hidden sm:inline">효과음</span>
      </button>
    </span>
  );
}
