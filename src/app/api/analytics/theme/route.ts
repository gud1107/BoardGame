import { NextRequest, NextResponse } from "next/server";
import { isAutomatedClient } from "@/lib/analytics/playCounts";
import { getSupabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ThemeBody {
  deviceId?: string;
  event?: string;
  origin?: string;
  osScheme?: string;
  pref?: string;
  theme?: string;
  automated?: boolean;
}

/**
 * Theme stats sink for /admin/games' 🌗 테마 tab — see `reportTheme` in
 * src/contexts/ThemeContext.tsx and supabase/theme_prefs.sql. Production
 * only (local dev shares the Supabase project); every automated browser,
 * Claude's included, is dropped so test runs don't skew the light/dark
 * ratio. The RPC validates every value itself. Best-effort.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ThemeBody | null;
  if (!body?.deviceId || (body.event !== "first" && body.event !== "change")) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (process.env.VERCEL_ENV !== "production") return NextResponse.json({ ok: true });
  if (isAutomatedClient(request.headers.get("user-agent"), body.automated)) return NextResponse.json({ ok: true });

  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.rpc("record_visitor_theme", {
        p_device_id: body.deviceId,
        p_event: body.event,
        p_origin: body.origin ?? null,
        p_os_scheme: body.osScheme ?? null,
        p_pref: body.pref ?? null,
        p_theme: body.theme ?? null,
      });
    } catch {
      // Best-effort.
    }
  }
  return NextResponse.json({ ok: true });
}
