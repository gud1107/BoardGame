"use client";

import { useState } from "react";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import SoundSettingsModal from "./SoundSettingsModal";

/**
 * Global sound widget for `SiteHeader` — one-tap 🔇→🔊 master toggle (defaults
 * to 🔇 per this session's default-mute brief) plus a small ⚙ affordance that
 * opens `SoundSettingsModal` for the BGM/SFX sliders. The toggle click is
 * also, for most visitors, the very first user gesture of the session — it
 * calls `getSoundEngine().unlock()` to satisfy the browser autoplay policy
 * (resumes the shared AudioContext) at the same moment it flips the flag.
 */
export default function SoundToggleButton() {
  const masterMuted = useAudioSettingsStore((s) => s.masterMuted);
  const toggleMasterMuted = useAudioSettingsStore((s) => s.toggleMasterMuted);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function handleToggle() {
    toggleMasterMuted();
    getSoundEngine().unlock();
    if (masterMuted) getSoundEngine().playWoodTap(); // audible confirmation right as sound turns on
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleToggle}
        className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-sm text-white/70 transition hover:border-white/30 hover:text-white"
        aria-label={masterMuted ? "소리 켜기" : "소리 끄기"}
        title={masterMuted ? "소리 켜기" : "소리 끄기"}
      >
        {masterMuted ? "🔇" : "🔊"}
      </button>
      <button
        onClick={() => setSettingsOpen(true)}
        className="grid h-6 w-6 place-items-center rounded-full text-[11px] text-white/40 transition hover:text-white/70"
        aria-label="사운드 설정 열기"
        title="사운드 설정"
      >
        ⚙
      </button>
      {settingsOpen && <SoundSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
