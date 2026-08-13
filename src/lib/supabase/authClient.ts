"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auth-aware browser client — distinct from `getSupabase()` in `client.ts`.
 *
 * `client.ts`'s plain `createClient()` keeps its session in localStorage,
 * which a server-side Route Handler / `proxy.ts` can never read. Anything
 * involving login state (auth calls themselves, and reading the current
 * user's own `profiles`/`subscriptions`/`usage_daily` rows under RLS) must
 * go through *this* client instead, since `createBrowserClient` stores the
 * session in cookies that `src/lib/supabase/server.ts` can read on the
 * server. Data-only features unrelated to login (device_sightings,
 * daily_records, bug_reports, guest_usage) keep using the plain client.
 *
 * Same "null means disabled" contract as `getSupabase()` — every caller
 * must treat `null` as "accounts feature unavailable" and degrade
 * gracefully.
 */
let client: SupabaseClient | null | undefined;

export function getAuthSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  client = url && anonKey ? createBrowserClient(url, anonKey) : null;
  return client;
}
