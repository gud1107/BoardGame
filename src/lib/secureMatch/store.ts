import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import type { MatchRecord } from "./core";

/**
 * `secure_matches` (supabase/secure_matches.sql) — RLS on with no policies,
 * so only this service-role client can read a match. Writes are
 * compare-and-swap on `version` so two devices acting at once can't
 * overwrite each other; the route retries on a lost race.
 */

export class StoreUnavailable extends Error {}

type Row = { id: string; version: number; data: Omit<MatchRecord, "id" | "version"> };

/** `SECURE_MATCH_MEMORY=1 next dev` — keeps matches in this process, to try the flow locally without the service key. Never in production. */
const memory: Map<string, MatchRecord> | null =
  process.env.NODE_ENV !== "production" && process.env.SECURE_MATCH_MEMORY === "1"
    ? (((globalThis as { __secureMatches?: Map<string, MatchRecord> }).__secureMatches ??= new Map()))
    : null;

function client() {
  const sb = getServiceSupabase();
  if (!sb) throw new StoreUnavailable("SUPABASE_SERVICE_ROLE_KEY is not set");
  return sb;
}

/** PostgREST answers a missing table with 42P01 / PGRST205 — treat it like "not set up yet". */
function check(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205") throw new StoreUnavailable(error.message);
  throw new Error(error.message);
}

function toRow(rec: MatchRecord): Row {
  const { id, version, ...data } = rec;
  return { id, version, data };
}

export async function loadMatch(id: string): Promise<MatchRecord | null> {
  if (memory) return structuredClone(memory.get(id) ?? null);
  const { data, error } = await client().from("secure_matches").select("id, version, data").eq("id", id).maybeSingle();
  check(error);
  if (!data) return null;
  const row = data as Row;
  return { ...row.data, id: row.id, version: row.version };
}

export async function insertMatch(rec: MatchRecord): Promise<void> {
  if (memory) return void memory.set(rec.id, structuredClone(rec));
  const sb = client();
  const { error } = await sb.from("secure_matches").insert({ ...toRow(rec), updated_at: new Date().toISOString() });
  check(error);
  // Finished/abandoned matches are only needed while someone may still reconnect.
  await sb.from("secure_matches").delete().lt("updated_at", new Date(Date.now() - 24 * 3600_000).toISOString());
}

/** False when someone else saved first — reload and retry. */
export async function saveMatch(rec: MatchRecord, prevVersion: number): Promise<boolean> {
  if (memory) {
    if (memory.get(rec.id)?.version !== prevVersion) return false;
    memory.set(rec.id, structuredClone(rec));
    return true;
  }
  const { data, error } = await client()
    .from("secure_matches")
    .update({ version: rec.version, data: toRow(rec).data, updated_at: new Date().toISOString() })
    .eq("id", rec.id)
    .eq("version", prevVersion)
    .select("id");
  check(error);
  return (data?.length ?? 0) > 0;
}
