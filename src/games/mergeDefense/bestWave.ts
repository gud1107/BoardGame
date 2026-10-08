import { useSyncExternalStore } from "react";
import { DIFFICULTIES, type Difficulty } from "./engine";

/**
 * Per-device best wave reached, by difficulty (localStorage). Read through
 * useSyncExternalStore so the server render (no storage) and the first client
 * render agree, then the saved records fill in.
 */

export type BestWaves = Record<Difficulty, number>;

const KEY = "merge-defense:best-wave";
const EMPTY: BestWaves = { easy: 0, normal: 0, hard: 0 };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: BestWaves = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function snapshot(): BestWaves {
  const raw = readRaw();
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  const next: BestWaves = { ...EMPTY };
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<string, unknown>>) : {};
    for (const d of DIFFICULTIES) {
      const v = parsed[d];
      if (Number.isInteger(v) && (v as number) > 0) next[d] = v as number;
    }
  } catch {
    /* corrupt entry — start fresh */
  }
  cached = next;
  return cached;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useBestWaves(): BestWaves {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** Saves `wave` if it beats the record; returns the previous best (0 = none). */
export function recordBestWave(difficulty: Difficulty, wave: number): number {
  const prev = snapshot()[difficulty];
  if (wave > prev) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...snapshot(), [difficulty]: wave }));
    } catch {
      /* storage blocked — record just isn't kept */
    }
    listeners.forEach((l) => l());
  }
  return prev;
}
