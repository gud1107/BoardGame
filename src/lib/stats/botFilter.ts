"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { StatSlice, StatTotalsRecord } from "@/lib/db/types";

/**
 * /stats bot filter, shared by 내 전적 and 공개 랭킹.
 * - includeBots false → only matches with no bot at the table
 * - botLevel 1..10    → only matches whose strongest lobby bot was that level
 * - botLevel 0         → only matches whose bots were all mid-game takeovers
 *   (both only meaningful with includeBots on)
 */
export interface StatsBotFilter {
  includeBots: boolean;
  botLevel: number | null;
}

export const DEFAULT_BOT_FILTER: StatsBotFilter = { includeBots: true, botLevel: null };

/** Date the bot flag / bot level started being recorded — older matches only show under "all". */
export const BOT_FILTER_SINCE = "2026-10-04";

const STORAGE_KEY = "stats.botFilter";

function parse(raw: string | null): StatsBotFilter {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v.includeBots !== "boolean") return DEFAULT_BOT_FILTER;
    const level = Number.isInteger(v.botLevel) && v.botLevel >= 0 && v.botLevel <= 10 ? (v.botLevel as number) : null;
    return { includeBots: v.includeBots, botLevel: v.includeBots ? level : null };
  } catch {
    return DEFAULT_BOT_FILTER;
  }
}

const listeners = new Set<() => void>();
// In-memory copy so the filter still works for this visit when storage throws.
let memory: string | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

/** Filter state remembered per browser (falls back to the default when storage is unavailable). */
export function useStatsBotFilter(): [StatsBotFilter, (next: StatsBotFilter) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const filter = useMemo(() => parse(raw), [raw]);

  const update = useCallback((next: StatsBotFilter) => {
    memory = JSON.stringify({ includeBots: next.includeBots, botLevel: next.includeBots ? next.botLevel : null });
    try {
      window.localStorage.setItem(STORAGE_KEY, memory);
    } catch {}
    for (const notify of listeners) notify();
  }, []);

  return [filter, update];
}

export function isDefaultBotFilter(f: StatsBotFilter): boolean {
  return f.includeBots && f.botLevel === null;
}

/** The part of a game's local totals that matches the filter (null = no matches). */
export function pickSlice(t: StatTotalsRecord, f: StatsBotFilter): StatSlice | null {
  const s = !f.includeBots ? t.noBot : f.botLevel !== null ? t.byBotLevel?.[String(f.botLevel)] : t;
  return s && s.played > 0 ? s : null;
}

/** Matches recorded before the bot flag existed (only counted under "all"). */
export function unclassifiedCount(stats: readonly StatTotalsRecord[]): number {
  return stats.reduce((n, t) => n + Math.max(0, t.played - (t.classified ?? 0)), 0);
}

export interface BotLevelRow {
  /** null = bot-free matches ("사람끼리"), 0 = takeover bots only. */
  level: number | null;
  played: number;
  wins: number;
  losses: number;
}

/** 사람끼리 + 도중 교체 봇 + Lv.1..10 rows, summed over every game or just `gameId`. */
export function botLevelRows(stats: readonly StatTotalsRecord[], gameId: string | null): BotLevelRow[] {
  const games = gameId ? stats.filter((t) => t.gameId === gameId) : stats;
  const sum = (pick: (t: StatTotalsRecord) => StatSlice | undefined) =>
    games.reduce(
      (acc, t) => {
        const s = pick(t);
        return s ? { played: acc.played + s.played, wins: acc.wins + s.wins, losses: acc.losses + s.losses } : acc;
      },
      { played: 0, wins: 0, losses: 0 },
    );
  return [
    { level: null, ...sum((t) => t.noBot) },
    ...Array.from({ length: 11 }, (_, level) => ({ level, ...sum((t) => t.byBotLevel?.[String(level)]) })),
  ];
}
