import type { VisitorRow } from "./visitors";

const KST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

/** 'YYYY-MM-DD' in Korea time — the site's audience is Korean. */
export function kstDay(date: Date | string | number): string {
  return KST_DAY.format(new Date(date));
}

export interface VisitorSummary {
  total: number;
  returning: number;
  returningRate: number;
  todayActive: number;
  todayNew: number;
  last7Active: number;
  totalVisits: number;
  totalPlays: number;
}

/** A visitor is "returning" once they've opened the site in 2+ separate tab sessions. */
export function isReturning(row: Pick<VisitorRow, "visit_count">): boolean {
  return row.visit_count >= 2;
}

export function summarizeVisitors(rows: VisitorRow[], now: number): VisitorSummary {
  const today = kstDay(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  let returning = 0;
  let todayActive = 0;
  let todayNew = 0;
  let last7Active = 0;
  let totalVisits = 0;
  let totalPlays = 0;
  for (const r of rows) {
    if (isReturning(r)) returning++;
    if (kstDay(r.last_seen) === today) todayActive++;
    if (kstDay(r.first_seen) === today) todayNew++;
    if (Date.parse(r.last_seen) >= weekAgo) last7Active++;
    totalVisits += r.visit_count;
    totalPlays += r.play_count;
  }
  return {
    total: rows.length,
    returning,
    returningRate: rows.length ? returning / rows.length : 0,
    todayActive,
    todayNew,
    last7Active,
    totalVisits,
    totalPlays,
  };
}

/** Most-played games for one visitor, highest first. */
export function topGames(games: Record<string, number> | null | undefined, limit = 3): [string, number][] {
  return Object.entries(games ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}
