"use client";

import { useCallback, useState } from "react";

const BGM_ENABLED_KEY = "grid-poker-bgm-enabled";

/**
 * Grid Poker's background music preference — deliberately separate from
 * `soundEngine`'s shared mute toggle (which every game's SFX/BGM funnels
 * through via one `master` gain node and one `bg_sound_muted` localStorage
 * key). That toggle defaults to *unmuted* and is shared across every game
 * in the hub (Perudo's dice SFX, Spot the Difference's BGM, ...) — flipping
 * its default would silence all of those too. Grid Poker's BGM instead
 * defaults to OFF on its own persisted flag; the in-game toggle (see
 * `GridPokerBoard`'s `bgmToggle`) is the only way to opt in, and that choice
 * is remembered per-browser across rooms/rematches.
 */
export function useGridPokerBgm() {
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(BGM_ENABLED_KEY) === "1";
  });

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BGM_ENABLED_KEY, next ? "1" : "0");
    }
  }, []);

  return { enabled, setEnabled };
}
