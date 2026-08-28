/**
 * Server-only Supabase-backed CRUD for `bug_reports` (see
 * `supabase/schema.sql`). Import this ONLY from `src/app/api/bug-reports/*`
 * Route Handlers, and only after the route handler has independently
 * confirmed the caller's identity via `createServerSupabase().auth.getUser()`
 * — same convention as `src/app/api/subscription/toggle-cancel/route.ts`.
 * `bug_reports` has RLS enabled with NO client-reachable policies (same
 * posture as `monthly_visit_stats` in schema.sql) — every read and write
 * goes through the service role here, so the route handler's own
 * author/admin check (see `permissions.ts`) is the only gate; there is no
 * RLS backstop to fall back on if that check is skipped.
 */
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import type { BugReportAttachment } from "@/lib/db/types";
import type { CloudBugReportRecord } from "./types";

interface BugReportRow {
  id: string;
  game_id: string | null;
  game_name: string | null;
  title: string;
  description: string;
  author_id: string;
  author_name: string;
  phone: string | null;
  attachment: BugReportAttachment | null;
  status: CloudBugReportRecord["status"];
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: BugReportRow): CloudBugReportRecord {
  return {
    id: row.id,
    gameId: row.game_id ?? undefined,
    gameName: row.game_name ?? undefined,
    title: row.title,
    description: row.description,
    authorId: row.author_id,
    author: row.author_name,
    phone: row.phone ?? undefined,
    attachment: row.attachment ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProfileInfo {
  role: "user" | "admin";
  nickname: string | null;
  email: string;
}

export async function getProfile(userId: string): Promise<ProfileInfo | null> {
  const service = getServiceSupabase();
  if (!service) return null;
  const { data } = await service.from("profiles").select("role, nickname, email").eq("id", userId).maybeSingle();
  if (!data) return null;
  return { role: data.role === "admin" ? "admin" : "user", nickname: data.nickname ?? null, email: data.email };
}

export async function listCloudBugReports(): Promise<CloudBugReportRecord[]> {
  const service = getServiceSupabase();
  if (!service) return [];
  const { data } = await service
    .from("bug_reports")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  return (data ?? []).map(rowToRecord);
}

export async function getCloudBugReport(id: string): Promise<CloudBugReportRecord | null> {
  const service = getServiceSupabase();
  if (!service) return null;
  const { data } = await service.from("bug_reports").select("*").eq("id", id).eq("is_deleted", false).maybeSingle();
  return data ? rowToRecord(data) : null;
}

export interface InsertBugReportInput {
  gameId?: string;
  gameName?: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  phone?: string;
  attachment?: BugReportAttachment;
}

export async function insertCloudBugReport(input: InsertBugReportInput): Promise<CloudBugReportRecord | null> {
  const service = getServiceSupabase();
  if (!service) return null;
  const { data } = await service
    .from("bug_reports")
    .insert({
      game_id: input.gameId ?? null,
      game_name: input.gameName ?? null,
      title: input.title,
      description: input.description,
      author_id: input.authorId,
      author_name: input.authorName,
      phone: input.phone ?? null,
      attachment: input.attachment ?? null,
    })
    .select("*")
    .single();
  return data ? rowToRecord(data) : null;
}

export interface UpdateBugReportInput {
  gameId?: string | null;
  gameName?: string | null;
  title?: string;
  description?: string;
  authorName?: string;
  phone?: string | null;
  attachment?: BugReportAttachment | null;
  status?: CloudBugReportRecord["status"];
}

export async function updateCloudBugReport(
  id: string,
  patch: UpdateBugReportInput,
): Promise<CloudBugReportRecord | null> {
  const service = getServiceSupabase();
  if (!service) return null;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.gameId !== undefined) row.game_id = patch.gameId;
  if (patch.gameName !== undefined) row.game_name = patch.gameName;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.authorName !== undefined) row.author_name = patch.authorName;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.attachment !== undefined) row.attachment = patch.attachment;
  if (patch.status !== undefined) row.status = patch.status;

  const { data } = await service.from("bug_reports").update(row).eq("id", id).select("*").maybeSingle();
  return data ? rowToRecord(data) : null;
}

export async function softDeleteCloudBugReport(id: string): Promise<boolean> {
  const service = getServiceSupabase();
  if (!service) return false;
  const { error } = await service
    .from("bug_reports")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}
