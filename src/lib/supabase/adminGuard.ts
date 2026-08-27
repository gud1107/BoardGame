import { createServerSupabase } from "./server";

export type AdminCheck = { ok: true; userId: string; email: string | null } | { ok: false; status: 401 | 403 | 503 };

/**
 * Shared guard for every `src/app/api/admin/*` route. Uses the cookie-based
 * (RLS-scoped) server client for the identity+role check itself — a user
 * can always read their own `profiles.role` under RLS, so this doesn't need
 * the service role — and leaves the actual privileged read/write to the
 * caller, which should use `getServiceSupabase()` only after this passes.
 *
 * This exists because `src/proxy.ts` only gates page navigation to
 * `/admin/**`; a Route Handler can be hit directly regardless of which page
 * (if any) linked to it, so every admin API route must re-check itself.
 */
export async function requireAdmin(): Promise<AdminCheck> {
  const server = await createServerSupabase();
  if (!server) return { ok: false, status: 503 };

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data: profile } = await server.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, status: 403 };

  return { ok: true, userId: user.id, email: user.email ?? null };
}
