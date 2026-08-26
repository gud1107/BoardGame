import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import { buildGameRanking, monthKey } from "@/lib/analytics/aggregate";
import { getGameMeta } from "@/games/registry";
import type { GamePlayCountRow } from "@/lib/analytics/types";

/** Per-game play totals + this-month counts + share%, ranked by total plays. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  // `game_id`/`started_at` only — enough to bucket client-side, same
  // reasoning as the visits-trend route (no per-game monthly rollup table).
  const { data } = await service.from("game_play_log").select("game_id, started_at");

  const thisMonth = monthKey(new Date());
  const counts = new Map<string, GamePlayCountRow>();
  for (const row of data ?? []) {
    const gameId = row.game_id as string;
    const entry = counts.get(gameId) ?? { gameId, totalPlays: 0, thisMonthPlays: 0 };
    entry.totalPlays += 1;
    if (monthKey(new Date(row.started_at as string)) === thisMonth) entry.thisMonthPlays += 1;
    counts.set(gameId, entry);
  }

  const ranking = buildGameRanking([...counts.values()], (gameId) => getGameMeta(gameId)?.name ?? gameId);

  return NextResponse.json({ games: ranking });
}
