import { getSupabase } from "./client";
import type { BugReportRecord, DailyRecord } from "@/lib/db/types";

/**
 * Cross-device identity matching (same IP, different browser/localStorage)
 * only makes sense when a shared backend exists — IndexedDB alone is scoped
 * to one browser. Every function here is a no-op when Supabase isn't
 * configured, so the app degrades to device-local matching only.
 *
 * Expected Supabase schema (see README for the SQL):
 *   device_sightings(ip text, device_id text, player_id text, name text, seen_at timestamptz)
 *   daily_records(id text primary key, payload jsonb, created_at timestamptz)
 *   bug_reports(id text primary key, payload jsonb, created_at timestamptz)
 */

const RECENT_WINDOW_DAYS = 14;

export async function recordDeviceSighting(
  ip: string,
  deviceId: string,
  playerId: string,
  name: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("device_sightings").upsert(
      {
        ip,
        device_id: deviceId,
        player_id: playerId,
        name,
        seen_at: new Date().toISOString(),
      },
      { onConflict: "ip,device_id" },
    );
  } catch {
    // Best-effort only — Supabase being unreachable must never block local play.
  }
}

export async function findSameIpCandidates(
  ip: string,
  excludeDeviceId: string,
): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const since = new Date(
      Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("device_sightings")
      .select("player_id, device_id, seen_at")
      .eq("ip", ip)
      .neq("device_id", excludeDeviceId)
      .gte("seen_at", since);
    if (error || !data) return [];
    return [...new Set(data.map((row) => row.player_id as string))];
  } catch {
    return [];
  }
}

export async function backupDailyRecord(record: DailyRecord): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("daily_records").upsert({
      id: record.id,
      payload: record,
      created_at: record.createdAt,
    });
  } catch {
    // IndexedDB already has the authoritative copy; cloud backup is best-effort.
  }
}

/**
 * Best-effort mirror only — like `backupDailyRecord`, this never blocks or
 * throws into the caller. The bug report board itself still reads from
 * IndexedDB only (same "this browser's data only" scope as `/history`), so
 * this backup exists purely so reports survive outside one browser's local
 * storage even though the current UI doesn't read it back yet.
 */
export async function backupBugReport(record: BugReportRecord): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("bug_reports").upsert({
      id: record.id,
      payload: record,
      created_at: record.createdAt,
    });
  } catch {
    // IndexedDB already has the authoritative copy; cloud backup is best-effort.
  }
}
