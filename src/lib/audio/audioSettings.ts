/**
 * Single shared source of truth for every game's sound preferences — the
 * "AudioManager" state layer requested for the site-wide BGM/SFX rollout
 * (2026-08-26 세션). Built on `zustand` (already a project dependency, same
 * pattern as `bettingStore`/`subscriptionStore`) specifically because it
 * exposes `getState()`/`subscribe()` outside of React: `soundEngine.ts` (pure
 * Web Audio, no React) and `bgmManager.ts` (native `<audio>`, no React) both
 * need to read/react to these settings without being hooks themselves, while
 * `SiteHeader`'s toggle button and the settings modal consume it as a normal
 * zustand hook.
 *
 * Defaults are **all muted** (`masterMuted`/`bgmMuted`/`sfxMuted: true`) per
 * this session's brief — a reversal of this project's previous default
 * (unmuted), applied retroactively to every game that already had sound
 * (Perudo/Spot the Difference/Dalmuti/Grid Poker) as well as the newly wired
 * ones. Browsers block audio with sound before a user gesture anyway, so a
 * muted default also sidesteps the autoplay-policy problem outright — the
 * first tap of the header's 🔇→🔊 toggle (or any per-game mute button, which
 * now all proxy to the same `masterMuted` flag — see `soundEngine.ts`'s
 * `isMuted`/`setMuted`) is a real user gesture that both flips this flag and
 * (via each consumer's own `unlock()`) resumes/starts its audio context.
 *
 * Migration: a returning visitor who had *explicitly* unmuted under the old
 * per-feature localStorage keys (`bg_sound_muted` = "0", or Grid Poker's
 * separate `grid-poker-bgm-enabled` = "1") keeps that choice instead of
 * going silent by surprise — see `loadInitial`. Anyone who never touched
 * those keys (the vast majority, since the old default was already
 * "unmuted" without them ever writing anything) gets the new muted default.
 */

import { create } from "zustand";

const STORAGE_KEY = "boardgame_audio_settings_v1";
const LEGACY_SFX_MUTE_KEY = "bg_sound_muted";
const LEGACY_GRIDPOKER_BGM_KEY = "grid-poker-bgm-enabled";

export interface AudioSettings {
  /** Quick top-level toggle (header 🔇/🔊). Muted here silences BGM and SFX regardless of the two flags below. */
  masterMuted: boolean;
  bgmMuted: boolean;
  sfxMuted: boolean;
  /** 0..1, applied to background music (both the synthesized ambient loops in soundEngine.ts and the themed <audio> tracks in bgmManager.ts). */
  bgmVolume: number;
  /** 0..1, applied to one-shot sound effects in soundEngine.ts. */
  sfxVolume: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterMuted: true,
  bgmMuted: true,
  sfxMuted: true,
  bgmVolume: 0.4,
  sfxVolume: 0.7,
};

function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function snapshot(s: AudioSettings): AudioSettings {
  return {
    masterMuted: s.masterMuted,
    bgmMuted: s.bgmMuted,
    sfxMuted: s.sfxMuted,
    bgmVolume: s.bgmVolume,
    sfxVolume: s.sfxVolume,
  };
}

function persist(settings: AudioSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(settings)));
  } catch {
    // Privacy mode / storage quota — settings just won't survive a reload.
  }
}

function loadInitial(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_AUDIO_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        masterMuted: parsed.masterMuted ?? DEFAULT_AUDIO_SETTINGS.masterMuted,
        bgmMuted: parsed.bgmMuted ?? DEFAULT_AUDIO_SETTINGS.bgmMuted,
        sfxMuted: parsed.sfxMuted ?? DEFAULT_AUDIO_SETTINGS.sfxMuted,
        bgmVolume: clampVolume(parsed.bgmVolume ?? DEFAULT_AUDIO_SETTINGS.bgmVolume),
        sfxVolume: clampVolume(parsed.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume),
      };
    }
  } catch {
    // Corrupt JSON — fall through to the legacy migration / defaults below.
  }

  // One-time migration from the pre-existing per-feature keys (see file
  // header). Only ever *unmutes* relative to the new default; never mutes
  // someone who had left the old keys untouched.
  let migrated = DEFAULT_AUDIO_SETTINGS;
  let sawLegacyChoice = false;
  try {
    const legacySfx = window.localStorage.getItem(LEGACY_SFX_MUTE_KEY);
    if (legacySfx === "0") {
      migrated = { ...migrated, masterMuted: false, sfxMuted: false, bgmMuted: false };
      sawLegacyChoice = true;
    }
    const legacyGridBgm = window.localStorage.getItem(LEGACY_GRIDPOKER_BGM_KEY);
    if (legacyGridBgm === "1") {
      migrated = { ...migrated, masterMuted: false, bgmMuted: false };
      sawLegacyChoice = true;
    }
  } catch {
    // ignore
  }
  if (sawLegacyChoice) persist(migrated);
  return migrated;
}

interface AudioSettingsStore extends AudioSettings {
  setMasterMuted: (muted: boolean) => void;
  toggleMasterMuted: () => void;
  setBgmMuted: (muted: boolean) => void;
  toggleBgmMuted: () => void;
  setSfxMuted: (muted: boolean) => void;
  toggleSfxMuted: () => void;
  setBgmVolume: (v: number) => void;
  setSfxVolume: (v: number) => void;
}

export const useAudioSettingsStore = create<AudioSettingsStore>((set, get) => ({
  ...loadInitial(),
  setMasterMuted: (muted) => set(() => { const next = { ...snapshot(get()), masterMuted: muted }; persist(next); return next; }),
  toggleMasterMuted: () => get().setMasterMuted(!get().masterMuted),
  setBgmMuted: (muted) => set(() => { const next = { ...snapshot(get()), bgmMuted: muted }; persist(next); return next; }),
  toggleBgmMuted: () => get().setBgmMuted(!get().bgmMuted),
  setSfxMuted: (muted) => set(() => { const next = { ...snapshot(get()), sfxMuted: muted }; persist(next); return next; }),
  toggleSfxMuted: () => get().setSfxMuted(!get().sfxMuted),
  setBgmVolume: (v) => set(() => { const next = { ...snapshot(get()), bgmVolume: clampVolume(v) }; persist(next); return next; }),
  setSfxVolume: (v) => set(() => { const next = { ...snapshot(get()), sfxVolume: clampVolume(v) }; persist(next); return next; }),
}));

export function isBgmEffectivelyMuted(s: AudioSettings): boolean {
  return s.masterMuted || s.bgmMuted;
}

export function isSfxEffectivelyMuted(s: AudioSettings): boolean {
  return s.masterMuted || s.sfxMuted;
}
