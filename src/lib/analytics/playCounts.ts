import { getSupabase } from "@/lib/supabase/client";

/**
 * Durable all-time play counts per game, stored in Supabase's
 * `game_play_counts` table (see `supabase/game_play_counts.sql`) — the
 * source for the lobby's "인기순" sort and the cards' "🔥 N회 플레이". It is
 * bumped once per real match, by the host's `game_start` event inside the
 * `log_game_event` RPC (`supabase/game_events.sql`). Separate
 * from `localStore.ts`, whose file store resets on every Vercel cold start.
 * Best-effort and never throws: no Supabase config or the
 * table not yet created just means every game reads as 0 plays.
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

export async function fetchGamePlayCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const supabase = getSupabase();
  if (!supabase) return counts;
  try {
    const { data, error } = await supabase.from("game_play_counts").select("game_id, plays");
    if (error || !data) return counts;
    for (const row of data as { game_id: string; plays: number }[]) {
      counts.set(row.game_id, Number(row.plays) || 0);
    }
  } catch {
    // Network/table missing — every game reads as 0, 인기순 falls back to recency.
  }
  return counts;
}
