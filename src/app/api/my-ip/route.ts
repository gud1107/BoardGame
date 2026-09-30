import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/analytics/clientIp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own IP, as the analytics routes see it — lets /admin/games mark the admin's own devices. */
export async function GET(request: NextRequest) {
  return NextResponse.json({ ip: clientIp(request) }, { headers: { "Cache-Control": "no-store" } });
}
