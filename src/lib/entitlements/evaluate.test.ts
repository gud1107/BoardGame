import { describe, expect, it } from "vitest";
import { effectiveTier, evaluateEntitlement, limitsForTier } from "./evaluate";
import { DEFAULT_GUEST_LIMITS, DEFAULT_TIER_LIMITS, type AppSettings, type Subscription } from "./types";

const coinSettings: AppSettings = {
  guestModeEnabled: true,
  meteringMode: "coin",
  tierLimits: DEFAULT_TIER_LIMITS,
  guestLimits: DEFAULT_GUEST_LIMITS,
};

const timeSettings: AppSettings = { ...coinSettings, meteringMode: "time" };

describe("evaluateEntitlement", () => {
  it("gates on games used when metering mode is coin", () => {
    const result = evaluateEntitlement(coinSettings, DEFAULT_TIER_LIMITS.free, {
      gamesUsed: 6,
      minutesUsed: 999,
    });
    expect(result).toEqual({ allowed: true, unit: "games", used: 6, cap: 7, remaining: 1 });
  });

  it("blocks once the coin cap is reached, ignoring minutes entirely", () => {
    const result = evaluateEntitlement(coinSettings, DEFAULT_TIER_LIMITS.free, {
      gamesUsed: 7,
      minutesUsed: 0,
    });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("gates on minutes used when metering mode is time, ignoring games entirely", () => {
    const result = evaluateEntitlement(timeSettings, DEFAULT_TIER_LIMITS.free, {
      gamesUsed: 999,
      minutesUsed: 59,
    });
    expect(result).toEqual({ allowed: true, unit: "minutes", used: 59, cap: 60, remaining: 1 });
  });

  it("never returns negative remaining", () => {
    const result = evaluateEntitlement(coinSettings, DEFAULT_TIER_LIMITS.free, {
      gamesUsed: 50,
      minutesUsed: 0,
    });
    expect(result.remaining).toBe(0);
  });
});

describe("limitsForTier", () => {
  it("looks up the tier-specific limits from settings", () => {
    expect(limitsForTier(coinSettings, "max")).toEqual(DEFAULT_TIER_LIMITS.max);
  });
});

describe("effectiveTier", () => {
  const base: Subscription = {
    userId: "u1",
    tier: "lite",
    status: "active",
    periodEnd: null,
    cancelAtPeriodEnd: false,
    source: "trial",
  };

  it("defaults to free with no subscription row", () => {
    expect(effectiveTier(null)).toBe("free");
  });

  it("returns the stored tier while active and unexpired", () => {
    const sub: Subscription = { ...base, periodEnd: "2099-01-01T00:00:00.000Z" };
    expect(effectiveTier(sub, new Date("2026-01-01"))).toBe("lite");
  });

  it("downgrades to free once periodEnd has passed, even if status is still 'active'", () => {
    const sub: Subscription = { ...base, periodEnd: "2020-01-01T00:00:00.000Z" };
    expect(effectiveTier(sub, new Date("2026-01-01"))).toBe("free");
  });

  it("downgrades to free when status is 'expired' regardless of periodEnd", () => {
    const sub: Subscription = { ...base, status: "expired", periodEnd: "2099-01-01T00:00:00.000Z" };
    expect(effectiveTier(sub, new Date("2026-01-01"))).toBe("free");
  });

  it("treats a null periodEnd on a non-free tier as never-expiring (admin-granted)", () => {
    const sub: Subscription = { ...base, periodEnd: null };
    expect(effectiveTier(sub, new Date("2099-01-01"))).toBe("lite");
  });
});
