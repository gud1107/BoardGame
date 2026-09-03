import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { buildMonthlyTrend, recentMonthKeys } from "@/lib/analytics/aggregate";
import { readSnapshot } from "@/lib/analytics/localStore";
import type { MonthlyPlayRow, MonthlyVisitRow } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Monthly visit + play trend for the dashboard's chart. `?months=6..12` (default 6). */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const requested = Number(request.nextUrl.searchParams.get("months") ?? 6);
  const months = Math.min(12, Math.max(6, Number.isFinite(requested) ? Math.trunc(requested) : 6));
  const monthKeys = recentMonthKeys(months);
  const monthSet = new Set(monthKeys);

  const snapshot = await readSnapshot();

  const visitByMonth = new Map<string, { pv: number; uv: Set<string> }>();
  for (const [day, v] of Object.entries(snapshot.visits)) {
    const month = day.slice(0, 7);
    if (!monthSet.has(month)) continue;
    const cur = visitByMonth.get(month) ?? { pv: 0, uv: new Set<string>() };
    cur.pv += v.pv;
    for (const id of v.uv) cur.uv.add(id);
    visitByMonth.set(month, cur);
  }
  const visits: MonthlyVisitRow[] = [...visitByMonth.entries()].map(([month, v]) => ({
    month,
    totalVisits: v.pv,
    uniqueVisitors: v.uv.size,
  }));

  const playByMonth = new Map<string, number>();
  for (const [day, byGame] of Object.entries(snapshot.games)) {
    const month = day.slice(0, 7);
    if (!monthSet.has(month)) continue;
    const dayTotal = Object.values(byGame).reduce((sum, s) => sum + s.starts, 0);
    playByMonth.set(month, (playByMonth.get(month) ?? 0) + dayTotal);
  }
  const plays: MonthlyPlayRow[] = [...playByMonth.entries()].map(([month, totalPlays]) => ({ month, totalPlays }));

  return NextResponse.json({ trend: buildMonthlyTrend(visits, plays, monthKeys) });
}
