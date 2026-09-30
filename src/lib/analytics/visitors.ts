import { getSupabase } from "@/lib/supabase/client";
import { summarizeUserAgent } from "./userAgent";

/**
 * Server-only writers for Supabase `visitor_devices` (see
 * `supabase/visitors.sql`), called from the visit/game-play analytics
 * routes. Same gates as `bumpGamePlayCount`: production only (local dev
 * shares the Supabase project) and callers skip automated browsers via
 * `isAutomatedClient`. Best-effort, never throw — a missing table just
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
}): Promise<void> {
  if (!canRecord()) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const { deviceType, os, browser } = summarizeUserAgent(input.userAgent);
  try {
    await supabase.rpc("record_visitor_visit", {
      p_device_id: input.deviceId,
      p_path: input.path,
      p_device_type: deviceType,
      p_os: os,
      p_browser: browser,
      p_nickname: input.nickname ?? "",
    });
  } catch {
    // Best-effort.
  }
}

export async function recordVisitorPlay(input: {
  deviceId: string;
  gameId: string;
  nickname?: string;
}): Promise<void> {
  if (!canRecord()) return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.rpc("record_visitor_play", {
      p_device_id: input.deviceId,
      p_game_id: input.gameId,
      p_nickname: input.nickname ?? "",
    });
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
