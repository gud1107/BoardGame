import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import { buildMonthlyTrend, monthKey, recentMonthKeys } from "@/lib/analytics/aggregate";
import type { MonthlyPlayRow, MonthlyVisitRow } from "@/lib/analytics/types";

/** Monthly visit + play trend for the dashboard's chart. `?months=6..12` (default 6). */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const requested = Number(request.nextUrl.searchParams.get("months") ?? 6);
  const months = Math.min(12, Math.max(6, Number.isFinite(requested) ? Math.trunc(requested) : 6));
  const monthKeys = recentMonthKeys(months);
  const earliestMonthStart = new Date(`${monthKeys[0]}-01T00:00:00.000Z`);

  const [{ data: visitData }, { data: playData }] = await Promise.all([
    service.from("monthly_visit_stats").select("month, total_visits, unique_visitors").in("month", monthKeys),
    service.from("game_play_log").select("started_at").gte("started_at", earliestMonthStart.toISOString()),
  ]);

  const visits: MonthlyVisitRow[] = (visitData ?? []).map((r) => ({
    month: r.month as string,
    totalVisits: r.total_visits as number,
    uniqueVisitors: r.unique_visitors as number,
  }));

  // game_play_log has no monthly rollup table (unlike visits) — the
  // expected row count at this project's scale makes grouping client-side
  // simpler than a dedicated Postgres aggregate function.
  const playCountByMonth = new Map<string, number>();
  for (const row of playData ?? []) {
    const month = monthKey(new Date(row.started_at as string));
    playCountByMonth.set(month, (playCountByMonth.get(month) ?? 0) + 1);
  }
  const plays: MonthlyPlayRow[] = [...playCountByMonth.entries()].map(([month, totalPlays]) => ({ month, totalPlays }));

  return NextResponse.json({ trend: buildMonthlyTrend(visits, plays, monthKeys) });
}
