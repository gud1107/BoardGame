import { getSupabase } from "@/lib/supabase/client";
import { summarizeUserAgent } from "./userAgent";
import { classifyTrafficSource } from "./trafficSource";

/**
 * Server-only writer for Supabase `visitor_devices` (see
 * `supabase/visitors.sql`), called from the visit route. Production only
 * (local dev shares the Supabase project) and the caller skips automated
 * browsers via `isAutomatedClient`. Plays are recorded separately by the
 * `log_game_event` RPC (`supabase/game_events.sql`). Best-effort, never throw — a missing table just
 * means nothing is recorded.
 */

function canRecord() {
  return process.env.VERCEL_ENV === "production";
}

export async function recordVisitorVisit(input: {
  deviceId: string;
  path: string;
  userAgent: string | null;
  nickname?: string;
  /** Raw caller IP (admins can see it on /admin/games; a salted hash is kept too). */
  ip?: string | null;
  /** `document.referrer` of the tab's first page — classified into a 유입 경로. */
  referrer?: string;
}): Promise<void> {
  if (!canRecord()) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const { deviceType, os, browser } = summarizeUserAgent(input.userAgent);
  const { source, referrerHost } = classifyTrafficSource(input.userAgent, input.referrer);
  const args = {
    p_device_id: input.deviceId,
    p_path: input.path,
    p_device_type: deviceType,
    p_os: os,
    p_browser: browser,
    p_nickname: input.nickname ?? "",
  };
  try {
    // Newest signature first (supabase/admin_suite.sql), then the older
    // ones, so visits keep recording whichever migration has been run.
    let { error } = await supabase.rpc("record_visitor_visit", {
      ...args,
      p_ip: input.ip ?? null,
      p_source: source,
      p_referrer_host: referrerHost,
    });
    if (error?.code === "PGRST202") ({ error } = await supabase.rpc("record_visitor_visit", { ...args, p_ip: input.ip ?? null }));
    if (error?.code === "PGRST202") await supabase.rpc("record_visitor_visit", args);
  } catch {
    // Best-effort.
  }
}

/** Row shape returned by the `list_visitors(password)` RPC. */
export interface VisitorRow {
  device_id: string;
  nickname: string | null;
  device_type: string | null;
  os: string | null;
  browser: string | null;
  first_seen: string;
  last_seen: string;
  visit_count: number;
  play_count: number;
  games: Record<string, number>;
  last_path: string | null;
}
