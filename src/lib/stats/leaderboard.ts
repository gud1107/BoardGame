"use client";

import { getAuthSupabase } from "@/lib/supabase/authClient";
import type { RankMetric } from "./presentation";
import type { StatsBotFilter } from "./botFilter";

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

export interface MetricLeaderboardRow {
  rank: number;
  nickname: string;
  avatarUrl: string | null;
  value: number;
  num: number;
  den: number | null;
  played: number;
  isMe: boolean;
}

/**
 * `"not-installed"` = the RPC doesn't exist yet (supabase/player_stats.sql not
 * run on this project — PostgREST answers PGRST202); `null` = any other
 * failure (Supabase off, offline).
 */
export type LeaderboardResult<T> = T[] | "not-installed" | null;

/** Minimum games for the win-rate leaderboard — keep in sync with the "10판↑" label on /stats. */
export const RATE_MIN_PLAYED = 10;

function filterArgs(f: StatsBotFilter) {
  return {
    ...(f.includeBots ? {} : { p_include_bots: false }),
    ...(f.includeBots && f.botLevel !== null ? { p_bot_level: f.botLevel } : {}),
  };
}

function classify(error: { code?: string } | null): "not-installed" | null {
  return error?.code === "PGRST202" ? "not-installed" : null;
}

/**
 * Public leaderboard via the `public_leaderboard` RPC (supabase/player_stats.sql).
 * Uses the auth-aware client so the caller's own row comes back flagged `isMe`.
 * `filter` narrows it to bot-free matches or one bot level (see botFilter.ts).
 */
export async function fetchLeaderboard(
  gameId: string | null,
  sort: LeaderboardSort,
  filter: StatsBotFilter = { includeBots: true, botLevel: null },
  limit = 50,
): Promise<LeaderboardResult<LeaderboardRow>> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_leaderboard", {
    p_game_id: gameId,
    p_sort: sort,
    p_min_played: RATE_MIN_PLAYED,
    p_limit: limit,
    // Sent only when filtering, so the default view also works against a
    // project still on the pre-bot-filter SQL.
    ...filterArgs(filter),
  });
  if (error || !Array.isArray(data)) return classify(error);
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

/** One game's detail-stat board (`public_metric_leaderboard` RPC). */
export async function fetchMetricLeaderboard(
  gameId: string,
  metric: RankMetric,
  filter: StatsBotFilter = { includeBots: true, botLevel: null },
  limit = 50,
): Promise<LeaderboardResult<MetricLeaderboardRow>> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_metric_leaderboard", {
    p_game_id: gameId,
    p_num: metric.num,
    p_den: metric.den ?? null,
    p_asc: !!metric.asc,
    p_min_den: metric.minDen ?? 1,
    p_limit: limit,
    // Sent only when filtering, so the default view also works against a
    // project still on the pre-bot-filter SQL.
    ...filterArgs(filter),
  });
  if (error || !Array.isArray(data)) return classify(error);
  return data.map((r) => ({
    rank: Number(r.rank),
    nickname: String(r.nickname),
    avatarUrl: r.avatar_url ?? null,
    value: Number(r.value),
    num: Number(r.num),
    den: r.den === null ? null : Number(r.den),
    played: Number(r.played),
    isMe: !!r.is_me,
  }));
}
