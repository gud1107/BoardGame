import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { buildDailyTrend, recentDayKeys } from "@/lib/analytics/aggregate";
import { readSnapshot } from "@/lib/analytics/localStore";
import type { DailyPlayRow, DailyVisitRow } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily visit + play trend for the dashboard's "일별 추이" table. `?days=7..30`
 * (default 14). Only exists for the local file store (the old Supabase
 * system had no daily breakdown, only the monthly rollup) — per the
 * requirement to view stats "일별/월별".
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const requested = Number(request.nextUrl.searchParams.get("days") ?? 14);
  const days = Math.min(30, Math.max(7, Number.isFinite(requested) ? Math.trunc(requested) : 14));
  const dayKeys = recentDayKeys(days);

  const snapshot = await readSnapshot();

  const visits: DailyVisitRow[] = dayKeys
    .filter((d) => snapshot.visits[d])
    .map((d) => ({ date: d, totalVisits: snapshot.visits[d].pv, uniqueVisitors: snapshot.visits[d].uv.length }));

  const plays: DailyPlayRow[] = dayKeys
    .filter((d) => snapshot.games[d])
    .map((d) => ({ date: d, totalPlays: Object.values(snapshot.games[d]).reduce((sum, s) => sum + s.starts, 0) }));

  return NextResponse.json({ trend: buildDailyTrend(visits, plays, dayKeys) });
}
