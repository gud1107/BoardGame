import { getSupabase } from "@/lib/supabase/client";

/**
 * Durable all-time play counts per game, stored in Supabase's
 * `game_play_counts` table (see `supabase/game_play_counts.sql`) — the
 * source for the lobby's "인기순" sort and the cards' "🔥 N회 플레이". Separate
 * from `localStore.ts`, whose file store resets on every Vercel cold start.
 * Both functions are best-effort and never throw: no Supabase config or the
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

/**
 * Server-only (called from `/api/analytics/game-play`). Counts production
 * plays only: local `next dev`/Playwright sessions — including Claude's
 * automated test runs — share the same Supabase project.
 */
export async function bumpGamePlayCount(gameId: string): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.rpc("increment_game_play", { p_game_id: gameId });
  } catch {
    // Best-effort — a missed bump only nudges a cosmetic ranking.
  }
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
