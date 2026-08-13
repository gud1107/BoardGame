import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";

/**
 * Flips the caller's own `cancel_at_period_end` flag. Routed through the
 * server (rather than a direct client `.update()`) because Postgres RLS
 * can only allow/deny a whole-row UPDATE, not restrict it to this one
 * column — see the comment above `subscriptions` in supabase/schema.sql.
 */
export async function POST() {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data: current, error: readError } = await service
    .from("subscriptions")
    .select("cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError || !current) return NextResponse.json({ error: "no subscription" }, { status: 404 });

  const next = !current.cancel_at_period_end;
  await service.from("subscriptions").update({ cancel_at_period_end: next }).eq("user_id", user.id);

  return NextResponse.json({ ok: true, cancelAtPeriodEnd: next });
}
