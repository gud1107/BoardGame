"use client";

import { useEffect } from "react";
import { getBgmManager, type BgmTrackId } from "./bgmManager";

/**
 * Crossfades to `id`'s themed BGM on mount (and whenever `id` changes), fades
 * to silence on unmount. One-line hook for each of the six hub games' entry
 * component (`<Game>Game.tsx`) plus the lobby page — see `bgmManager.ts` for
 * the crossfade/mute/volume mechanics themselves.
 */
export function useGameBgm(id: BgmTrackId | null) {
  useEffect(() => {
    getBgmManager().crossfadeTo(id);
    return () => {
      getBgmManager().crossfadeTo(null);
    };
  }, [id]);
}
