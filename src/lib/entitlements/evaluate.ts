import type { AppSettings, DailyUsage, EntitlementResult, Subscription, Tier, TierLimits } from "./types";

/**
 * Pure decision logic — no Supabase/IO here so it's cheap to unit test.
 * `settings.meteringMode` picks ONE dimension (coin count or minutes) to
 * gate on site-wide; the other is still tracked (for the admin dashboard /
 * a future mode switch) but never blocks play.
 */
export function evaluateEntitlement(
  settings: AppSettings,
  limits: TierLimits,
  usage: DailyUsage,
): EntitlementResult {
  if (settings.meteringMode === "time") {
    const cap = limits.minutesPerDay;
    const used = usage.minutesUsed;
    return { allowed: used < cap, unit: "minutes", used, cap, remaining: Math.max(0, cap - used) };
  }
  const cap = limits.gamesPerDay;
  const used = usage.gamesUsed;
  return { allowed: used < cap, unit: "games", used, cap, remaining: Math.max(0, cap - used) };
}

/**
 * A subscription's `tier` column can be stale (e.g. a 60-day trial whose
 * `period_end` has already passed) — there is no cron job in phase 1 to
 * proactively downgrade it, so every read re-derives the *effective* tier
 * from `periodEnd`/`status` at the moment it's checked.
 */
export function effectiveTier(subscription: Subscription | null, now: Date = new Date()): Tier {
  if (!subscription) return "free";
  if (subscription.status === "expired") return "free";
  if (subscription.tier === "free") return "free";
  if (subscription.periodEnd && new Date(subscription.periodEnd).getTime() < now.getTime()) {
    return "free";
  }
  return subscription.tier;
}

export function limitsForTier(settings: AppSettings, tier: Tier): TierLimits {
  return settings.tierLimits[tier];
}
