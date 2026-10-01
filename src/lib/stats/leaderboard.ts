"use client";

import { getAuthSupabase } from "@/lib/supabase/authClient";

export type LeaderboardSort = "wins" | "rate";

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  avatarUrl: string | null;
  played: number;
  wins: number;
  losses: number;
  winRate: number | null;
  bestRank: number | null;
  details: Record<string, number>;
  isMe: boolean;
}

/** Minimum games for the win-rate leaderboard — keep in sync with the "10판↑" label on /stats. */
export const RATE_MIN_PLAYED = 10;

/**
 * Public leaderboard via the `public_leaderboard` RPC (supabase/player_stats.sql).
 * Uses the auth-aware client so the caller's own row comes back flagged
 * `isMe`. Returns null on error (Supabase off, SQL not applied, offline).
 */
export async function fetchLeaderboard(gameId: string | null, sort: LeaderboardSort, limit = 50): Promise<LeaderboardRow[] | null> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_leaderboard", {
    p_game_id: gameId,
    p_sort: sort,
    p_min_played: RATE_MIN_PLAYED,
    p_limit: limit,
  });
  if (error || !Array.isArray(data)) return null;
  return data.map((r) => ({
    rank: Number(r.rank),
    nickname: String(r.nickname),
    avatarUrl: r.avatar_url ?? null,
    played: Number(r.played),
    wins: Number(r.wins),
    losses: Number(r.losses),
    winRate: r.win_rate === null ? null : Number(r.win_rate),
    bestRank: r.best_rank ?? null,
    details: r.details ?? {},
    isMe: !!r.is_me,
  }));
}
