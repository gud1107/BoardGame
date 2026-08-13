import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import { TRIAL_DAYS } from "@/lib/entitlements/types";

/**
 * Called by the client right after a successful signUp/signIn. Creates the
 * `profiles` row (RLS forbids a client-side insert, so this has to run
 * server-side with the service role) and, only the first time, a 60-day
 * Lite trial `subscriptions` row. Safe to call repeatedly — idempotent by
 * checking for an existing profile first, so calling it again on every
 * login is harmless and also self-heals a profile that failed to get
 * created on signup (e.g. because the project requires email confirmation
 * and no session existed yet at signup time).
 */
export async function POST() {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data: existingProfile } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json({ ok: true, created: false, role: existingProfile.role });
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const role = adminEmails.includes(user.email.toLowerCase()) ? "admin" : "user";

  await service.from("profiles").insert({ id: user.id, email: user.email, role });

  const periodEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await service.from("subscriptions").insert({
    user_id: user.id,
    tier: "lite",
    status: "active",
    period_end: periodEnd,
    cancel_at_period_end: false,
    source: "trial",
  });

  return NextResponse.json({ ok: true, created: true, role });
}
