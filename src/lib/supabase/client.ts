import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase is entirely optional (per spec: IndexedDB is the primary store).
 * The app must work fully offline with zero Supabase configuration — every
 * caller of `getSupabase()` must treat `null` as "feature disabled" and
 * degrade gracefully, never throw.
 */
let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  client = url && anonKey ? createClient(url, anonKey) : null;
  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}
