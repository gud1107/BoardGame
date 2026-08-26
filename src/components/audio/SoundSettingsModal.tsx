"use client";

import Overlay from "@/components/Overlay";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { getSoundEngine } from "@/lib/audio/soundEngine";

/**
 * BGM/SFX individual volume sliders + mute toggles, per this session's
 * brief ("BGM / SFX 개별 볼륨 슬라이더 및 개별 음소거 토글 팝업"). Opened from
 * `SoundToggleButton`'s gear affordance in `SiteHeader`. Every control here
 * writes straight to the shared `audioSettings` store, so it takes effect
 * immediately in whichever game (or the lobby) is currently playing.
 */
export default function SoundSettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useAudioSettingsStore();

  return (
    <Overlay title="🔊 사운드 설정" onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <label className="flex items-center justify-between gap-3">
          <span className="font-semibold text-white">전체 음소거</span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-rose-500"
            checked={settings.masterMuted}
            onChange={(e) => {
              settings.setMasterMuted(e.target.checked);
              getSoundEngine().unlock();
            }}
          />
        </label>

        <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <label className="flex items-center justify-between gap-3">
            <span>배경음악 (BGM)</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-rose-500"
              checked={settings.bgmMuted}
              onChange={(e) => settings.setBgmMuted(e.target.checked)}
              aria-label="배경음악 음소거"
            />
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.bgmVolume * 100)}
            onChange={(e) => settings.setBgmVolume(Number(e.target.value) / 100)}
            disabled={settings.masterMuted || settings.bgmMuted}
            className="w-full accent-rose-500 disabled:opacity-40"
            aria-label="배경음악 볼륨"
          />
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <label className="flex items-center justify-between gap-3">
            <span>효과음 (SFX)</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-rose-500"
              checked={settings.sfxMuted}
              onChange={(e) => settings.setSfxMuted(e.target.checked)}
              aria-label="효과음 음소거"
            />
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.sfxVolume * 100)}
            onChange={(e) => {
              settings.setSfxVolume(Number(e.target.value) / 100);
              getSoundEngine().unlock();
              getSoundEngine().playWoodTap();
            }}
            disabled={settings.masterMuted || settings.sfxMuted}
            className="w-full accent-rose-500 disabled:opacity-40"
            aria-label="효과음 볼륨"
          />
        </section>

        <p className="text-xs text-white/40">
          체크박스가 켜져 있으면(✓) 음소거 상태입니다. 설정은 이 브라우저에 저장되어 다음 방문에도 유지됩니다.
        </p>
      </div>
    </Overlay>
  );
}
