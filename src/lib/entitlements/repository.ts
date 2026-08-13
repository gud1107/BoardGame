import { getSupabase } from "@/lib/supabase/client";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import {
  DEFAULT_GUEST_LIMITS,
  DEFAULT_TIER_LIMITS,
  type AppSettings,
  type DailyUsage,
  type Subscription,
  type Tier,
} from "./types";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `app_settings` is world-readable (see supabase/schema.sql), so the plain anon client is fine here. */
export async function fetchAppSettings(): Promise<AppSettings> {
  const fallback: AppSettings = {
    guestModeEnabled: true,
    meteringMode: "coin",
    tierLimits: DEFAULT_TIER_LIMITS,
    guestLimits: DEFAULT_GUEST_LIMITS,
  };
  const supabase = getSupabase();
  if (!supabase) return fallback;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("guest_mode_enabled, metering_mode, tier_limits, guest_limits")
      .eq("id", 1)
      .single();
    if (error || !data) return fallback;
    return {
      guestModeEnabled: data.guest_mode_enabled,
      meteringMode: data.metering_mode,
      tierLimits: data.tier_limits ?? DEFAULT_TIER_LIMITS,
      guestLimits: data.guest_limits ?? DEFAULT_GUEST_LIMITS,
    };
  } catch {
    return fallback;
  }
}

/** RLS only allows a user to read their own row — must go through the auth (cookie) client. */
export async function fetchSubscription(userId: string): Promise<Subscription | null> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("user_id, tier, status, period_end, cancel_at_period_end, source")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      userId: data.user_id,
      tier: data.tier as Tier,
      status: data.status,
      periodEnd: data.period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
      source: data.source,
    };
  } catch {
    return null;
  }
}

export async function fetchUserUsageToday(userId: string): Promise<DailyUsage> {
  const supabase = getAuthSupabase();
  const empty: DailyUsage = { gamesUsed: 0, minutesUsed: 0 };
  if (!supabase) return empty;
  try {
    const { data, error } = await supabase
      .from("usage_daily")
      .select("games_used, minutes_used")
      .eq("user_id", userId)
      .eq("date", todayKey())
      .maybeSingle();
    if (error || !data) return empty;
    return { gamesUsed: data.games_used, minutesUsed: data.minutes_used };
  } catch {
    return empty;
  }
}

/**
 * Same "open to anon, not a security boundary" caveat as `device_sightings`
 * — keyed by the client-generated `bg_device_id`, resettable by clearing
 * localStorage. Read-modify-write instead of an atomic increment; an extra
 * game slipping through from a race between two tabs is an acceptable cost
 * for a soft guest nudge.
 */
export async function fetchGuestUsageToday(deviceId: string): Promise<DailyUsage> {
  const supabase = getSupabase();
  const empty: DailyUsage = { gamesUsed: 0, minutesUsed: 0 };
  if (!supabase) return empty;
  try {
    const { data, error } = await supabase
      .from("guest_usage")
      .select("games_used, minutes_used")
      .eq("device_id", deviceId)
      .eq("date", todayKey())
      .maybeSingle();
    if (error || !data) return empty;
    return { gamesUsed: data.games_used, minutesUsed: data.minutes_used };
  } catch {
    return empty;
  }
}

export async function recordGuestUsage(
  deviceId: string,
  delta: { games?: number; minutes?: number },
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const current = await fetchGuestUsageToday(deviceId);
    await supabase.from("guest_usage").upsert(
      {
        device_id: deviceId,
        date: todayKey(),
        games_used: current.gamesUsed + (delta.games ?? 0),
        minutes_used: current.minutesUsed + (delta.minutes ?? 0),
      },
      { onConflict: "device_id,date" },
    );
  } catch {
    // Best-effort — never block local play over a network hiccup.
  }
}

/**
 * Logged-in usage writes go through the server (`/api/usage/record`)
 * instead of a direct client upsert: `usage_daily` RLS only grants self
 * *select*, deliberately, so a user can't just write their own higher
 * remaining-count into the table. The route re-derives `userId` from the
 * caller's session cookie rather than trusting a client-supplied id.
 */
export async function recordUserUsage(delta: { games?: number; minutes?: number }): Promise<void> {
  try {
    await fetch("/api/usage/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delta),
    });
  } catch {
    // Best-effort — a failed usage write should never block the UI.
  }
}
