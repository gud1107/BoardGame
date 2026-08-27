import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import { SUPER_ADMIN_EMAIL } from "@/lib/admin/superAdmin";
import type { AppSettings } from "@/lib/entitlements/types";

/**
 * `app_settings` is world-*readable* already (see supabase/schema.sql), so
 * the admin dashboard reads it with the plain `fetchAppSettings()` helper —
 * this route only handles the write side, which has no client-reachable
 * RLS policy at all.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Partial<AppSettings> | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.guestModeEnabled === "boolean") patch.guest_mode_enabled = body.guestModeEnabled;
  // Kill switch is restricted to the super-admin account server-side too —
  // the client only hides/disables the control, this is the real boundary.
  if (typeof body.entitlementsEnabled === "boolean" && admin.email === SUPER_ADMIN_EMAIL) {
    patch.entitlements_enabled = body.entitlementsEnabled;
  }
  if (body.meteringMode === "coin" || body.meteringMode === "time") patch.metering_mode = body.meteringMode;
  if (body.tierLimits) patch.tier_limits = body.tierLimits;
  if (body.guestLimits) patch.guest_limits = body.guestLimits;

  await service.from("app_settings").update(patch).eq("id", 1);

  return NextResponse.json({ ok: true });
}
