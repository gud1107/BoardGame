import { getSupabase } from "@/lib/supabase/client";

/**
 * Public play counts for the lobby's "인기순" sort and the cards'
 * "🔥 10월 N회 플레이" — one per real match (the host's `game_start`), see
 * `fetchGamePlayStats`. Separate from `localStore.ts`, whose file store
 * resets on every Vercel cold start. Best-effort and never throws: no
 * Supabase config or the RPC not yet created just means every game reads
 * as 0 plays.
 *
 * Real players only (2026-10-01 decision): the old local analytics totals
 * (`data/analytics.json`, mostly Claude's Playwright test runs) are kept in
 * that file but are neither seeded into the table nor shown.
 */

const AUTOMATION_UA = /HeadlessChrome|Playwright|Puppeteer|Selenium|PhantomJS|bot\b|crawler|spider/i;

/**
 * True for a scripted browser rather than a person: the client-reported
 * `navigator.webdriver` flag (always set under Playwright) or a headless /
 * crawler User-Agent. Used to keep Claude's test runs out of the count.
 */
export function isAutomatedClient(userAgent: string | null, webdriverFlag: unknown): boolean {
  return webdriverFlag === true || AUTOMATION_UA.test(userAgent ?? "");
}

export interface GamePlayStats {
  /** All-time real match starts per game — the 인기순 sort key. */
  total: Map<string, number>;
  /** This calendar month (Korea time) — shown on cards as "🔥 10월 N회 플레이". */
  month: Map<string, number>;
}

/**
 * Real match starts per game (a host's `game_start` event), via the
 * `public_game_play_stats` RPC (`supabase/play_stats_monthly.sql`), which
 * counts straight from `game_events` — the old "opening a game page = +1"
 * counts can never appear here.
 */
export async function fetchGamePlayStats(): Promise<GamePlayStats> {
  const stats: GamePlayStats = { total: new Map(), month: new Map() };
  const supabase = getSupabase();
  if (!supabase) return stats;
  try {
    const { data, error } = await supabase.rpc("public_game_play_stats");
    if (error || !data) return stats;
    for (const row of data as { game_id: string; total_plays: number; month_plays: number }[]) {
      stats.total.set(row.game_id, Number(row.total_plays) || 0);
      stats.month.set(row.game_id, Number(row.month_plays) || 0);
    }
  } catch {
    // Network/RPC missing — every game reads as 0, 인기순 falls back to recency.
  }
  return stats;
}
