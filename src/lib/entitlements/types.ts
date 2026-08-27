/**
 * Phase-1 subscription/entitlement model. No payment gateway is wired up —
 * `Subscription.tier` is only ever set by the signup route (trial) or the
 * admin dashboard (manual grant). A real PG can be layered on later by
 * having its webhook write these same rows instead.
 */

export type Tier = "free" | "lite" | "max";
export type MeteringMode = "coin" | "time";
export type SubscriptionSource = "signup" | "trial" | "admin" | "coupon" | "payment";
export type SubscriptionStatus = "active" | "expired";

export interface TierLimits {
  gamesPerDay: number;
  minutesPerDay: number;
}

/** The site-wide singleton the admin dashboard edits (`app_settings` table). */
export interface AppSettings {
  guestModeEnabled: boolean;
  /** Site-wide kill switch: when false (the default — caps are currently off), `evaluateEntitlement` always allows play regardless of usage/caps. Restricted to the super-admin account, see `src/lib/admin/superAdmin.ts`. */
  entitlementsEnabled: boolean;
  meteringMode: MeteringMode;
  tierLimits: Record<Tier, TierLimits>;
  guestLimits: TierLimits;
}

export interface Subscription {
  userId: string;
  tier: Tier;
  status: SubscriptionStatus;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  source: SubscriptionSource;
}

/** One day's consumption, for either a logged-in user or a guest device. */
export interface DailyUsage {
  gamesUsed: number;
  minutesUsed: number;
}

export interface EntitlementResult {
  allowed: boolean;
  unit: "games" | "minutes";
  used: number;
  cap: number;
  remaining: number;
}

export const DEFAULT_TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { gamesPerDay: 7, minutesPerDay: 60 },
  lite: { gamesPerDay: 25, minutesPerDay: 240 },
  max: { gamesPerDay: 100, minutesPerDay: 600 },
};

export const DEFAULT_GUEST_LIMITS: TierLimits = { gamesPerDay: 5, minutesPerDay: 60 };

export const TRIAL_DAYS = 60;

export const TIER_LABELS: Record<Tier, string> = {
  free: "무료",
  lite: "Lite",
  max: "Max",
};
