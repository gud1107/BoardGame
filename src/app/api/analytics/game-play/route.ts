import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/client";

interface StartBody {
  action: "start";
  gameId?: string;
  playerCount?: number;
  deviceId?: string;
}

interface EndBody {
  action: "end";
  playId?: string;
  isCompleted?: boolean;
}

/**
 * Game session lifecycle tracking (`game_play_log`), called from the shared
 * `src/app/games/[gameId]/page.tsx` wrapper — one hook point covers every
 * game's start/complete/abandon regardless of which engine is playing, per
 * the "공통 훅" requirement (no per-game instrumentation needed).
 *
 * Two actions share one route since "end" needs nothing this route doesn't
 * already have: `action: "start"` inserts a row and returns its id;
 * `action: "end"` (given that id back) sets `ended_at`/`is_completed`.
 * Anon client + RLS insert/update policies, same reasoning as
 * `/api/analytics/visit`.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as (StartBody | EndBody) | null;
  if (!body?.action) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  if (body.action === "start") {
    if (!body.gameId) return NextResponse.json({ error: "gameId required" }, { status: 400 });
    // Generate the id here and insert it explicitly, rather than reading it
    // back via `.select().single()` after insert: `game_play_log` has no
    // anon SELECT policy (deliberately — see supabase/schema.sql), and
    // Postgres RLS filters an INSERT's RETURNING output through SELECT
    // policies, so a `.select()` chained onto the anon-client insert would
    // silently come back empty despite the row having been written.
    const playId = randomUUID();
    const { error } = await supabase.from("game_play_log").insert({
      id: playId,
      game_id: body.gameId,
      player_count: Number.isFinite(body.playerCount) ? Math.max(0, Math.trunc(body.playerCount!)) : 0,
      device_id: body.deviceId ?? null,
    });
    if (error) return NextResponse.json({ error: "insert failed" }, { status: 500 });
    return NextResponse.json({ playId });
  }

  if (body.action === "end") {
    if (!body.playId) return NextResponse.json({ error: "playId required" }, { status: 400 });
    await supabase
      .from("game_play_log")
      .update({ ended_at: new Date().toISOString(), is_completed: Boolean(body.isCompleted) })
      .eq("id", body.playId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
