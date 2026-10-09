import { useSyncExternalStore } from "react";
import { DIFFICULTIES, GAME_MODES, MAP_IDS, sanitizeMap, type Difficulty, type GameMode, type MapId } from "./engine";

/**
 * Per-device best wave reached, by mode, map and difficulty (localStorage). Read
 * through useSyncExternalStore so the server render (no storage) and the
 * first client render agree, then the saved records fill in.
 */

export type BestWaves = Record<Difficulty, number>;
export type BestByMap = Record<MapId, BestWaves>;
export type BestByMode = Record<GameMode, BestByMap>;

const KEY = "merge-defense:best-wave";
const emptyWaves = (): BestWaves => ({ easy: 0, normal: 0, hard: 0 });
const emptyMaps = (): BestByMap => Object.fromEntries(MAP_IDS.map((id) => [id, emptyWaves()])) as BestByMap;
const EMPTY: BestByMode = { survival: emptyMaps(), versus: emptyMaps() };
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

/** One mode's records. Before maps existed a mode held { easy, normal, hard } directly — those were all on 순환로. */
function readMaps(src: unknown): BestByMap {
  const out = emptyMaps();
  if (!src || typeof src !== "object") return out;
  const rec = src as Record<string, unknown>;
  if (DIFFICULTIES.some((d) => d in rec)) {
    out.classic = readWaves(rec);
    return out;
  }
  for (const id of MAP_IDS) out[id] = readWaves(rec[id]);
  return out;
}

/** Best over every map — what a 🎲 랜덤 맵 room shows. */
export function bestAcrossMaps(byMap: BestByMap): BestWaves {
  const out = emptyWaves();
  for (const id of MAP_IDS) for (const d of DIFFICULTIES) out[d] = Math.max(out[d], byMap[id][d]);
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
    cached = flat ? { survival: readMaps(parsed), versus: emptyMaps() } : { survival: readMaps(parsed.survival), versus: readMaps(parsed.versus) };
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

/** Saves `wave` if it beats this mode + map + difficulty's record; returns the previous best (0 = none). */
export function recordBestWave(mode: GameMode, map: MapId | undefined, difficulty: Difficulty, wave: number): number {
  const m: GameMode = GAME_MODES.includes(mode) ? mode : "survival";
  const id = sanitizeMap(map);
  const all = snapshot();
  const prev = all[m][id][difficulty];
  if (wave > prev) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...all, [m]: { ...all[m], [id]: { ...all[m][id], [difficulty]: wave } } }));
    } catch {
      /* storage blocked — record just isn't kept */
    }
    listeners.forEach((l) => l());
  }
  return prev;
}
