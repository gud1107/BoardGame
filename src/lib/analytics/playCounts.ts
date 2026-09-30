import { getSupabase } from "@/lib/supabase/client";

/**
 * Durable all-time play counts per game, stored in Supabase's
 * `game_play_counts` table (see schema.sql) — the source for the lobby's
 * "인기순" sort. Separate from `localStore.ts`, whose file store resets on
 * every Vercel cold start. Both functions are best-effort and never throw:
 * no Supabase config or the table not yet created just means every game
 * counts as 0 and the sort falls back to its tie-breaker.
 */

export async function bumpGamePlayCount(gameId: string): Promise<void> {
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
    // Network/table missing — empty map, sort falls back to recency.
  }
  return counts;
}
