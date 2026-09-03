import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { dayKey, momChangePct, monthKey } from "@/lib/analytics/aggregate";
import { readSnapshot } from "@/lib/analytics/localStore";
import type { AnalyticsSummary } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** KPI cards at the top of /admin/stats. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const snapshot = await readSnapshot();
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const today = dayKey(now);

  let totalVisits = 0;
  let thisMonthVisits = 0;
  let lastMonthVisits = 0;
  for (const [day, v] of Object.entries(snapshot.visits)) {
    totalVisits += v.pv;
    const month = day.slice(0, 7);
    if (month === thisMonth) thisMonthVisits += v.pv;
    else if (month === lastMonth) lastMonthVisits += v.pv;
  }

  let totalPlays = 0;
  let todayPlays = 0;
  for (const [day, byGame] of Object.entries(snapshot.games)) {
    for (const stats of Object.values(byGame)) {
      totalPlays += stats.starts;
      if (day === today) todayPlays += stats.starts;
    }
  }

  const summary: AnalyticsSummary = {
    totalVisits,
    thisMonthVisits,
    visitMomChangePct: momChangePct(thisMonthVisits, lastMonthVisits),
    totalPlays,
    todayPlays,
  };

  return NextResponse.json(summary);
}
