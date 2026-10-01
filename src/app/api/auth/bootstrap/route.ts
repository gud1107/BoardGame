import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { bootstrapProfile } from "@/lib/auth/bootstrapProfile";

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

  const result = await bootstrapProfile(user);
  if (!result) return NextResponse.json({ error: "not configured" }, { status: 503 });

  return NextResponse.json({ ok: true, ...result });
}
