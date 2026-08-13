import { create } from "zustand";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { getDeviceId } from "@/lib/identity/deviceId";
import {
  fetchAppSettings,
  fetchGuestUsageToday,
  fetchSubscription,
  fetchUserUsageToday,
  recordGuestUsage,
  recordUserUsage,
} from "@/lib/entitlements/repository";
import { effectiveTier, evaluateEntitlement, limitsForTier } from "@/lib/entitlements/evaluate";
import type { AppSettings, EntitlementResult, Subscription, Tier } from "@/lib/entitlements/types";

type ComputedFields = Pick<
  SubscriptionState,
  "userId" | "email" | "tier" | "subscription" | "settings" | "entitlement" | "loginRequired"
>;

interface SubscriptionState {
  hydrated: boolean;
  configured: boolean;
  /** null while signed out (guest). */
  userId: string | null;
  email: string | null;
  tier: Tier | null;
  /** Raw row (periodEnd/cancelAtPeriodEnd/source) — `/account` needs these beyond just the effective tier. */
  subscription: Subscription | null;
  settings: AppSettings | null;
  entitlement: EntitlementResult | null;
  /** Signed out AND (guest mode is off, or Supabase isn't configured) — game entry must redirect to /login. */
  loginRequired: boolean;

  /** Idempotent — safe to call from every consumer's mount effect (SiteHeader, game page); only fetches once. */
  init: () => Promise<void>;
  /** Unlike `init`, always re-fetches — used by `/account` after a mutation (e.g. the cancel-at-period-end toggle). */
  refresh: () => Promise<void>;
  /** Call once a game finishes; re-derives entitlement afterwards so the HUD/gate reflect the new usage immediately. */
  recordPlay: (minutes: number) => Promise<void>;
  toggleCancelAtPeriodEnd: () => Promise<void>;
  signOut: () => Promise<void>;
}

async function computeState(): Promise<ComputedFields> {
  const settings = await fetchAppSettings();
  const authSupabase = getAuthSupabase();
  const {
    data: { user },
  } = authSupabase ? await authSupabase.auth.getUser() : { data: { user: null } };

  if (user) {
    const [subscription, usage] = await Promise.all([fetchSubscription(user.id), fetchUserUsageToday(user.id)]);
    const tier = effectiveTier(subscription);
    const entitlement = evaluateEntitlement(settings, limitsForTier(settings, tier), usage);
    return {
      userId: user.id,
      email: user.email ?? null,
      tier,
      subscription,
      settings,
      entitlement,
      loginRequired: false,
    };
  }

  if (!settings.guestModeEnabled) {
    return { userId: null, email: null, tier: null, subscription: null, settings, entitlement: null, loginRequired: true };
  }

  const deviceId = typeof window !== "undefined" ? getDeviceId() : null;
  const usage = deviceId ? await fetchGuestUsageToday(deviceId) : { gamesUsed: 0, minutesUsed: 0 };
  const entitlement = evaluateEntitlement(settings, settings.guestLimits, usage);
  return { userId: null, email: null, tier: null, subscription: null, settings, entitlement, loginRequired: false };
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  hydrated: false,
  configured: false,
  userId: null,
  email: null,
  tier: null,
  subscription: null,
  settings: null,
  entitlement: null,
  loginRequired: false,

  init: async () => {
    if (get().hydrated) return;
    await get().refresh();
  },

  refresh: async () => {
    const configured = getAuthSupabase() !== null;
    if (!configured) {
      set({ hydrated: true, configured: false });
      return;
    }
    const state = await computeState();
    set({ ...state, hydrated: true, configured: true });
  },

  recordPlay: async (minutes) => {
    const { userId } = get();
    if (userId) {
      await recordUserUsage({ games: 1, minutes: Math.max(1, Math.round(minutes)) });
    } else if (typeof window !== "undefined") {
      await recordGuestUsage(getDeviceId(), { games: 1, minutes: Math.max(1, Math.round(minutes)) });
    }
    await get().refresh();
  },

  toggleCancelAtPeriodEnd: async () => {
    await fetch("/api/subscription/toggle-cancel", { method: "POST" }).catch(() => {});
    await get().refresh();
  },

  signOut: async () => {
    const supabase = getAuthSupabase();
    if (supabase) await supabase.auth.signOut();
    await get().refresh();
  },
}));
