import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-based Supabase client for Server Components and Route Handlers —
 * the server-side half of the pair with `src/lib/supabase/authClient.ts`.
 * Reads the caller's session from cookies (set by the browser auth client),
 * so `.auth.getUser()` / RLS-scoped `.from(...)` calls here see the same
 * identity the client did. Returns `null` when Supabase isn't configured,
 * same contract as every other Supabase accessor in this app.
 *
 * `cookies()` is async in this Next.js version (see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md).
 * Writes here are best-effort (a plain Server Component can't set outgoing
 * cookies) — session *refresh* is `src/proxy.ts`'s job, not this file's.
 */
export async function createServerSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are
          // read-only — session refresh already happens in src/proxy.ts.
        }
      },
    },
  });
}
