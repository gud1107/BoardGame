import { NextRequest, NextResponse } from "next/server";

/**
 * Returns the caller's best-guess public IP, read from the headers Vercel's
 * edge network attaches to every request. Used only as a weak signal for
 * cross-device player identity matching (see `src/lib/identity/resolve.ts`);
 * never treated as authoritative.
 */
export function GET(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwardedFor?.split(",")[0]?.trim() || realIp || undefined;

  return NextResponse.json({ ip });
}
