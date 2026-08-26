/**
 * Shared types for the visit + game-play analytics pipeline (see
 * HANDOFF.md's analytics section). Split from `aggregate.ts` so route
 * handlers and the admin store can import just the shapes without pulling
 * in aggregation logic.
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown";

/** One row from `monthly_visit_stats`. */
export interface MonthlyVisitRow {
  month: string; // 'YYYY-MM'
  totalVisits: number;
  uniqueVisitors: number;
}

/** One `game_play_log` row grouped by month (`to_char(started_at, 'YYYY-MM')`). */
export interface MonthlyPlayRow {
  month: string;
  totalPlays: number;
}

/** One point on the admin dashboard's monthly trend chart. */
export interface MonthlyTrendPoint {
  month: string;
  totalVisits: number;
  uniqueVisitors: number;
  totalPlays: number;
  /** null when there's no prior month to compare against, or the prior month had 0 visits. */
  visitMomChangePct: number | null;
}

/** Raw per-game totals from `game_play_log`, before ranking/share is computed. */
export interface GamePlayCountRow {
  gameId: string;
  totalPlays: number;
  thisMonthPlays: number;
}

/** One row of the admin dashboard's per-game ranking table. */
export interface GameRankingRow extends GamePlayCountRow {
  name: string;
  sharePct: number;
  rank: number;
}

export interface AnalyticsSummary {
  totalVisits: number;
  thisMonthVisits: number;
  visitMomChangePct: number | null;
  totalPlays: number;
  todayPlays: number;
}
