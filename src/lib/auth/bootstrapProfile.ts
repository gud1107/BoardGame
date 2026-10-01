import type { User } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import { TRIAL_DAYS } from "@/lib/entitlements/types";

/**
 * Creates the private `profiles` row and, only the first time, a Lite trial
 * `subscriptions` row. Idempotent. Shared by `/api/auth/bootstrap` (email
 * signup/login) and `/auth/callback` (social OAuth login).
 *
 * Returns null when it can't run: no service role key, or the user has no
 * email (e.g. a Kakao account that didn't consent to sharing one —
 * `profiles.email` is NOT NULL). The public display profile
 * (`user_profiles`, see supabase/social_auth.sql) is filled by a DB trigger
 * instead and doesn't depend on this.
 */
export async function bootstrapProfile(user: User): Promise<{ created: boolean; role: string } | null> {
  if (!user.email) return null;
  const service = getServiceSupabase();
  if (!service) return null;

  const { data: existingProfile } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile) return { created: false, role: existingProfile.role };

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const role = adminEmails.includes(user.email.toLowerCase()) ? "admin" : "user";

  await service.from("profiles").insert({ id: user.id, email: user.email, role });

  const periodEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await service.from("subscriptions").insert({
    user_id: user.id,
    tier: "lite",
    status: "active",
    period_end: periodEnd,
    cancel_at_period_end: false,
    source: "trial",
  });

  return { created: true, role };
}
