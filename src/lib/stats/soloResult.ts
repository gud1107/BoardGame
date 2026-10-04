"use client";

import { recordMatchStat } from "./playerStats";

/**
 * Personal stats for 1-player games (배고픈 상어, 게 생존). Each finished
 * dive/match is recorded the moment it ends — while the page is still alive —
 * so closing the tab or navigating away never loses a finished run (IndexedDB
 * writes started from pagehide/unload aren't reliable). The run is reported as
 * 1st of 1: /stats keeps solo games out of win totals and shows `details` in
 * its 솔로 기록 table instead. Never throws.
 */
export function recordSoloRun(gameId: string, details: Record<string, number>): void {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(details)) if (Number.isFinite(v) && v >= 0) clean[k] = Math.round(v);
  void recordMatchStat(gameId, { rank: 1, playerCount: 1, botPlayed: false, withBots: false, botLevel: null, details: clean }, new Date().toISOString());
}
