import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/client";
import { detectDeviceType } from "@/lib/analytics/deviceType";

interface VisitBody {
  deviceId?: string;
  path?: string;
  userAgent?: string;
}

/**
 * Logs one row to `site_visit_log`; `monthly_visit_stats` is folded in
 * atomically by the `bump_monthly_visit_stats` DB trigger (see
 * supabase/schema.sql), not here. Uses the anon client, not the service
 * role — `site_visit_log` has an anon-insert RLS policy for exactly this,
 * since `getServiceSupabase()` is reserved for `/api/admin/*` routes.
 * Called via `navigator.sendBeacon`, so the body may arrive as a Blob with
 * no explicit content-type — `request.json()` still parses it fine either way.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as VisitBody | null;
  if (!body?.deviceId || !body.path) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await supabase.from("site_visit_log").insert({
    device_id: body.deviceId,
    path: body.path.slice(0, 512),
    device_type: detectDeviceType(body.userAgent),
  });

  return NextResponse.json({ ok: true });
}
