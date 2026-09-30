import { NextRequest, NextResponse } from "next/server";
import { recordVisit } from "@/lib/analytics/localStore";
import { isAutomatedClient } from "@/lib/analytics/playCounts";
import { recordVisitorVisit } from "@/lib/analytics/visitors";
import { clientIp } from "@/lib/analytics/clientIp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VisitBody {
  deviceId?: string;
  path?: string;
  nickname?: string;
  /** Client's `navigator.webdriver` — true under Playwright (Claude's test runs). */
  automated?: boolean;
  referrer?: string;
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

  // Durable per-device record for the /visitors page (who came, who came back).
  const userAgent = request.headers.get("user-agent");
  if (!isAutomatedClient(userAgent, body.automated)) {
    await recordVisitorVisit({
      deviceId: body.deviceId,
      path: body.path,
      userAgent,
      nickname: body.nickname,
      ip: clientIp(request),
      referrer: body.referrer,
    });
  }

  return NextResponse.json({ ok: true });
}
