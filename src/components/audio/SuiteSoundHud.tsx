"use client";

import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import type { ProceduralSuite } from "@/lib/audio/proceduralSuite";

/**
 * BGM / 🔔 효과음 toggles for a procedural sound suite, next to a board's
 * rulebook button. Both write the site-wide audio settings store (same as the
 * header 🔇/🔊 and the settings modal, where the volume sliders live); turning
 * one on from the all-muted default also lifts the master mute. The click
 * doubles as the user gesture that unlocks the AudioContext. Colors inherit
 * the board's text color, so it reads on dark tables and light panels alike.
 */
export default function SuiteSoundHud({
  suite,
  icon,
  label,
  preview,
  showSfx = true,
}: {
  suite: () => ProceduralSuite;
  /** BGM button emoji while on. */
  icon: string;
  /** BGM name, shown from `sm` up. */
  label: string;
  /** SFX played as confirmation when 효과음 is switched on. */
  preview?: string;
  /** Hide the 효과음 toggle (games whose SFX live in another engine with its own toggle). */
  showSfx?: boolean;
}) {
  const s = useAudioSettingsStore();
  const bgmOn = !isBgmEffectivelyMuted(s);
  const sfxOn = !isSfxEffectivelyMuted(s);

  function toggle(kind: "bgm" | "sfx") {
    const sound = suite();
    sound.unlock();
    const setMuted = kind === "bgm" ? s.setBgmMuted : s.setSfxMuted;
    if (kind === "bgm" ? bgmOn : sfxOn) {
      setMuted(true);
      return;
    }
    s.setMasterMuted(false);
    setMuted(false);
    if (kind === "sfx" && preview) setTimeout(() => sound.play(preview), 30);
  }

  const cls = (on: boolean) =>
    `flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition select-none ${
      on ? "border-amber-500/70 bg-amber-500/15 shadow-[0_0_10px_rgba(245,158,11,0.3)]" : "border-current/20 opacity-60 hover:opacity-90"
    }`;

  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => toggle("bgm")} aria-pressed={bgmOn} className={cls(bgmOn)} title={bgmOn ? `${label} BGM 끄기 (볼륨은 상단 설정)` : `${label} BGM 켜기`}>
        <span className={bgmOn ? "" : "grayscale"}>{bgmOn ? icon : "🔇"}</span>
        <span className={`hidden sm:inline ${bgmOn ? "" : "line-through"}`}>{label}</span>
      </button>
      {showSfx && (
        <button type="button" onClick={() => toggle("sfx")} aria-pressed={sfxOn} className={cls(sfxOn)} title={sfxOn ? "효과음 끄기" : "효과음 켜기"}>
          {sfxOn ? "🔔" : "🔕"}
          <span className="hidden sm:inline">효과음</span>
        </button>
      )}
    </span>
  );
}
