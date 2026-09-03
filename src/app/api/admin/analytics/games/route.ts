import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { buildGameRanking, monthKey } from "@/lib/analytics/aggregate";
import { readSnapshot } from "@/lib/analytics/localStore";
import { getGameMeta } from "@/games/registry";
import type { GamePlayCountRow } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-game play totals + this-month counts + share%, ranked by total plays ("plays" = starts, matching the old game_play_log row-count semantics). */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const snapshot = await readSnapshot();
  const thisMonth = monthKey(new Date());

  const counts = new Map<string, GamePlayCountRow>();
  for (const [day, byGame] of Object.entries(snapshot.games)) {
    const isThisMonth = day.slice(0, 7) === thisMonth;
    for (const [gameId, stats] of Object.entries(byGame)) {
      const entry = counts.get(gameId) ?? { gameId, totalPlays: 0, thisMonthPlays: 0 };
      entry.totalPlays += stats.starts;
      if (isThisMonth) entry.thisMonthPlays += stats.starts;
      counts.set(gameId, entry);
    }
  }

  const ranking = buildGameRanking([...counts.values()], (gameId) => getGameMeta(gameId)?.name ?? gameId);

  return NextResponse.json({ games: ranking });
}
