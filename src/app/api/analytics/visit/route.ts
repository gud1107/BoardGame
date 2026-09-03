import { NextRequest, NextResponse } from "next/server";
import { recordVisit } from "@/lib/analytics/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VisitBody {
  deviceId?: string;
  path?: string;
}

/**
 * Records one visit into the local file store (see `src/lib/analytics/localStore.ts`
 * — replaces the old `site_visit_log` Supabase table). Called via
 * `navigator.sendBeacon`, so the body may arrive as a Blob with no explicit
 * content-type — `request.json()` still parses it fine either way.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as VisitBody | null;
  if (!body?.deviceId || !body.path) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  recordVisit(body.deviceId);

  return NextResponse.json({ ok: true });
}
