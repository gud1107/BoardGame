import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses Row Level Security entirely. Import this
 * ONLY inside `src/app/api/admin/*` and `src/app/api/auth/bootstrap` Route
 * Handlers, and only AFTER independently verifying (via
 * `src/lib/supabase/server.ts`'s cookie-based client) that the caller is
 * either the user they claim to be (bootstrap) or has `role: 'admin'`
 * (admin routes). Never import this from client-side ("use client") code —
 * `SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_` prefix specifically so
 * Next.js refuses to inline it into the browser bundle; keep it that way.
 */
export function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
