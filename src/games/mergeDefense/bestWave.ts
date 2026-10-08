import { useSyncExternalStore } from "react";
import { DIFFICULTIES, GAME_MODES, type Difficulty, type GameMode } from "./engine";

/**
 * Per-device best wave reached, by mode and difficulty (localStorage). Read
 * through useSyncExternalStore so the server render (no storage) and the
 * first client render agree, then the saved records fill in.
 */

export type BestWaves = Record<Difficulty, number>;
export type BestByMode = Record<GameMode, BestWaves>;

const KEY = "merge-defense:best-wave";
const emptyWaves = (): BestWaves => ({ easy: 0, normal: 0, hard: 0 });
const EMPTY: BestByMode = { survival: emptyWaves(), versus: emptyWaves() };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: BestByMode = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function readWaves(src: unknown): BestWaves {
  const out = emptyWaves();
  if (!src || typeof src !== "object") return out;
  for (const d of DIFFICULTIES) {
    const v = (src as Record<string, unknown>)[d];
    if (Number.isInteger(v) && (v as number) > 0) out[d] = v as number;
  }
  return out;
}

function snapshot(): BestByMode {
  const raw = readRaw();
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    // The first version stored one flat { easy, normal, hard } without a mode —
    // those records came before the split and are kept under 생존전.
    const flat = DIFFICULTIES.some((d) => d in parsed);
    cached = flat ? { survival: readWaves(parsed), versus: emptyWaves() } : { survival: readWaves(parsed.survival), versus: readWaves(parsed.versus) };
  } catch {
    cached = EMPTY;
  }
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

export function useBestWaves(): BestByMode {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** Saves `wave` if it beats this mode + difficulty's record; returns the previous best (0 = none). */
export function recordBestWave(mode: GameMode, difficulty: Difficulty, wave: number): number {
  const m: GameMode = GAME_MODES.includes(mode) ? mode : "survival";
  const all = snapshot();
  const prev = all[m][difficulty];
  if (wave > prev) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...all, [m]: { ...all[m], [difficulty]: wave } }));
    } catch {
      /* storage blocked — record just isn't kept */
    }
    listeners.forEach((l) => l());
  }
  return prev;
}
