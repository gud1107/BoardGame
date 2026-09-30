import type { NextRequest } from "next/server";

/** Caller's IP as Vercel reports it (first hop of x-forwarded-for). Only ever hashed in the database, never stored raw. */
export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || null;
  return request.headers.get("x-real-ip");
}
