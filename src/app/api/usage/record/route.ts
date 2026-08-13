import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Increments the caller's own `usage_daily` row for today. `userId` always
 * comes from the session cookie, never from the request body — the whole
 * point of routing usage writes through the server is that a signed-in
 * user's RLS grant is read-only on this table (see supabase/schema.sql).
 */
export async function POST(request: NextRequest) {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { games?: number; minutes?: number };
  const gamesDelta = Number.isFinite(body.games) ? Math.max(0, Math.trunc(body.games!)) : 0;
  const minutesDelta = Number.isFinite(body.minutes) ? Math.max(0, Math.trunc(body.minutes!)) : 0;
  if (gamesDelta === 0 && minutesDelta === 0) return NextResponse.json({ ok: true });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const date = todayKey();
  const { data: existing } = await service
    .from("usage_daily")
    .select("games_used, minutes_used")
    .eq("user_id", user.id)
    .eq("date", date)
    .maybeSingle();

  await service.from("usage_daily").upsert(
    {
      user_id: user.id,
      date,
      games_used: (existing?.games_used ?? 0) + gamesDelta,
      minutes_used: (existing?.minutes_used ?? 0) + minutesDelta,
    },
    { onConflict: "user_id,date" },
  );

  return NextResponse.json({ ok: true });
}
