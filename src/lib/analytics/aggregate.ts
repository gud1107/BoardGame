import type { GamePlayCountRow, GameRankingRow, MonthlyPlayRow, MonthlyTrendPoint, MonthlyVisitRow } from "./types";

/** `'YYYY-MM'` for the given date (UTC — matches Postgres `to_char(..., 'YYYY-MM')` on Supabase's UTC-clock server). */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Ascending list of the `count` most recent month keys, ending at `from`'s month. */
export function recentMonthKeys(count: number, from: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(monthKey(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1))));
  }
  return out;
}

/** Month-over-month % change. `null` when there's nothing meaningful to compare against (previous was 0 but current isn't). */
export function momChangePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * Merges monthly visit + play rows into one ordered trend series, filling
 * in zero-rows for any month in `months` that has no data yet (e.g. the
 * current, still-in-progress month) so the chart never shows a gap.
 */
export function buildMonthlyTrend(visits: MonthlyVisitRow[], plays: MonthlyPlayRow[], months: string[]): MonthlyTrendPoint[] {
  const visitByMonth = new Map(visits.map((v) => [v.month, v]));
  const playsByMonth = new Map(plays.map((p) => [p.month, p.totalPlays]));

  let previousVisits: number | null = null;
  return months.map((month) => {
    const visit = visitByMonth.get(month);
    const totalVisits = visit?.totalVisits ?? 0;
    const uniqueVisitors = visit?.uniqueVisitors ?? 0;
    const totalPlays = playsByMonth.get(month) ?? 0;
    const visitMomChangePct = previousVisits === null ? null : momChangePct(totalVisits, previousVisits);
    previousVisits = totalVisits;
    return { month, totalVisits, uniqueVisitors, totalPlays, visitMomChangePct };
  });
}

/** Sorts by total plays descending, annotates rank + share%, and resolves each game's display name. */
export function buildGameRanking(rows: GamePlayCountRow[], nameFor: (gameId: string) => string): GameRankingRow[] {
  const totalAllPlays = rows.reduce((sum, row) => sum + row.totalPlays, 0);
  return [...rows]
    .sort((a, b) => b.totalPlays - a.totalPlays)
    .map((row, index) => ({
      ...row,
      name: nameFor(row.gameId),
      sharePct: totalAllPlays === 0 ? 0 : (row.totalPlays / totalAllPlays) * 100,
      rank: index + 1,
    }));
}
