import { useEffect, useState } from "react";
import { listPlayerStats, STATS_CHANGED_EVENT } from "@/lib/stats/playerStats";
import { MAX_PLAYERS, MIN_PLAYERS, setupFor } from "./engine";

/**
 * Best score / level per player count (2인 and 4인 runs aren't comparable,
 * so each count has its own record).
 *
 * Two sources, merged with max():
 * - the personal stats (`maxScore{N}p` / `maxLevel{N}p` details) — these
 *   sync to the account through `record_match_stats`, so a record set on one
 *   device shows on every device once logged in;
 * - this browser's localStorage, which covers games finished before the
 *   per-count score key existed and guests whose stats haven't synced.
 */

export const GAME_ID = "telepathy";

const scoreKey = (n: number) => `telepathy-best-score:${n}p`;
const levelKey = (n: number) => `telepathy-best-level:${n}p`;

function readNum(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function readBestScore(playerCount: number): number {
  return readNum(scoreKey(playerCount));
}

export function saveBestScore(playerCount: number, score: number, level = 0): void {
  try {
    if (score > readNum(scoreKey(playerCount))) window.localStorage.setItem(scoreKey(playerCount), String(score));
    if (level > readNum(levelKey(playerCount))) window.localStorage.setItem(levelKey(playerCount), String(level));
  } catch {
    /* storage blocked — the account stats still keep it */
  }
}

export interface BestRecord {
  score: number;
  level: number;
  maxLevel: number;
}

export type BestRecords = Record<number, BestRecord>;

export const PLAYER_COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS);

export async function loadBestRecords(): Promise<BestRecords> {
  const totals = (await listPlayerStats()).find((t) => t.gameId === GAME_ID);
  const d = totals?.details ?? {};
  const out: BestRecords = {};
  for (const n of PLAYER_COUNTS) {
    out[n] = {
      score: Math.max(d[`maxScore${n}p`] ?? 0, readNum(scoreKey(n))),
      level: Math.max(d[`maxLevel${n}p`] ?? 0, readNum(levelKey(n))),
      maxLevel: setupFor(n).levels,
    };
  }
  return out;
}

/** Live best records (reloads whenever the personal stats change, e.g. after a login sync). */
export function useBestRecords(): BestRecords | null {
  const [records, setRecords] = useState<BestRecords | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      loadBestRecords().then((r) => {
        if (alive) setRecords(r);
      });
    };
    load();
    window.addEventListener(STATS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(STATS_CHANGED_EVENT, load);
    };
  }, []);
  return records;
}
