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

  // Heartbeats from a Web Worker (2026-11-24): a background tab's timers are
  // throttled to once a minute, which let the server time the socket out —
  // a host looking at another tab vanished from the 🌐 공개방 list and its
  // room channel. Browser only; there's no Worker on the server.
  const worker = typeof window !== "undefined" && typeof Worker !== "undefined";
  client = url && anonKey ? createClient(url, anonKey, { realtime: { worker } }) : null;
  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}
