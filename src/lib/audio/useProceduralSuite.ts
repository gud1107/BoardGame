"use client";

import { useEffect, useRef } from "react";
import type { ProceduralSuite } from "./proceduralSuite";

/** A cue from a state diff: an SFX name, or a name plus its recipe argument. */
export type SoundCue = string | { name: string; arg?: number };

/**
 * Runs the suite's BGM while `wanted` (and BGM is unmuted in the site
 * settings), stopping it on unmount. `intensity` feeds `setIntensity`.
 */
export function useSuiteBgm(suite: () => ProceduralSuite, wanted: boolean, intensity = 0) {
  useEffect(() => {
    const s = suite();
    s.setBgmWanted(wanted);
    return () => s.setBgmWanted(false);
  }, [suite, wanted]);
  useEffect(() => {
    suite().setIntensity(intensity);
  }, [suite, intensity]);
}

/**
 * Plays the cues `classify(prev, next)` returns for each consecutive pair of
 * snapshots — so every client hears every seat's moves (bots and remote
 * players included), like the hand-built suites' state-diff SFX. The first
 * snapshot (mount / reconnect) never plays anything.
 */
export function useSoundCues<S>(state: S, suite: () => ProceduralSuite, classify: (prev: S, next: S) => SoundCue[]) {
  const prevRef = useRef(state);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (prev === state) return;
    const s = suite();
    for (const cue of classify(prev, state)) {
      if (typeof cue === "string") s.play(cue);
      else s.play(cue.name, cue.arg);
    }
    // classify is a module-level pure function in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, suite]);
}
