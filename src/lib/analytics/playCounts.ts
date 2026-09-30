import { getSupabase } from "@/lib/supabase/client";

/**
 * Durable all-time play counts per game, stored in Supabase's
 * `game_play_counts` table (see schema.sql) — the source for the lobby's
 * "인기순" sort. Separate from `localStore.ts`, whose file store resets on
 * every Vercel cold start. Both functions are best-effort and never throw:
 * no Supabase config or the table not yet created just means the counts
 * stay at `GAME_PLAY_COUNT_SEED`.
 */

/**
 * Baseline all-time starts from the pre-Supabase local analytics file
 * (`data/analytics.json`, 2026-09-14~27; lotr-confrontation's 12 folded into
 * lotr-duel) — the same numbers schema.sql seeds into `game_play_counts`.
 * Shown until the table exists in production, so the lobby's 인기순 and
 * "🔥 N회 플레이" aren't empty; once it does, the DB value wins whenever it's
 * higher (it starts at these seeds and only grows).
 */
export const GAME_PLAY_COUNT_SEED: ReadonlyMap<string, number> = new Map([
  ["perudo", 113],
  ["dalmuti", 79],
  ["mafia", 42],
  ["splendor-duel", 24],
  ["rat-a-tat-cat", 20],
  ["lotr-duel", 20],
  ["hill-of-truth", 10],
  ["century", 8],
  ["lost-cities", 6],
  ["mine-of-oblivion-2", 6],
  ["coyote", 4],
  ["destiny-war-39", 2],
  ["crab-survival", 2],
  ["great-legacy", 1],
]);

/**
 * Server-only (called from `/api/analytics/game-play`). Counts production
 * plays only: local `next dev`/Playwright sessions — including Claude's
 * automated test runs — share the same Supabase project, and the 2026-10-01
 * review of the old local analytics showed those runs dominate the numbers.
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
  const counts = new Map(GAME_PLAY_COUNT_SEED);
  const supabase = getSupabase();
  if (!supabase) return counts;
  try {
    const { data, error } = await supabase.from("game_play_counts").select("game_id, plays");
    if (error || !data) return counts;
    for (const row of data as { game_id: string; plays: number }[]) {
      counts.set(row.game_id, Math.max(counts.get(row.game_id) ?? 0, Number(row.plays) || 0));
    }
  } catch {
    // Network/table missing — seed baseline only.
  }
  return counts;
}
