import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import { momChangePct, monthKey } from "@/lib/analytics/aggregate";
import type { AnalyticsSummary } from "@/lib/analytics/types";

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** KPI cards at the top of /admin/stats. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  // One pass over every monthly_visit_stats row covers both "sum of all
  // months" (totalVisits) and "this/last month" (for the MoM %) — the table
  // is small (one row per calendar month the site has existed) so there's
  // no need for a separate aggregate query per figure.
  const [{ data: allMonths }, { count: totalPlays }, { count: todayPlays }] = await Promise.all([
    service.from("monthly_visit_stats").select("month, total_visits"),
    service.from("game_play_log").select("id", { count: "exact", head: true }),
    service.from("game_play_log").select("id", { count: "exact", head: true }).gte("started_at", startOfTodayIso()),
  ]);

  const byMonth = new Map((allMonths ?? []).map((r) => [r.month as string, r.total_visits as number]));
  const thisMonthVisits = byMonth.get(thisMonth) ?? 0;
  const lastMonthVisits = byMonth.get(lastMonth) ?? 0;
  const totalVisits = (allMonths ?? []).reduce((sum, r) => sum + (r.total_visits as number), 0);

  const summary: AnalyticsSummary = {
    totalVisits,
    thisMonthVisits,
    visitMomChangePct: momChangePct(thisMonthVisits, lastMonthVisits),
    totalPlays: totalPlays ?? 0,
    todayPlays: todayPlays ?? 0,
  };

  return NextResponse.json(summary);
}
