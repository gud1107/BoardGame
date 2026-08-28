import type { BugReportAttachment, BugReportRecord, BugReportStatus } from "@/lib/db/types";

/**
 * A bug report stored server-side (Supabase `bug_reports` table, see
 * `supabase/schema.sql`) — tied to a real account (`authorId`), unlike the
 * legacy `BugReportRecord` (IndexedDB, no account link). New submissions
 * go here exclusively; see HANDOFF.md for why the legacy local records
 * were not migrated.
 */
export interface CloudBugReportRecord {
  id: string;
  gameId?: string;
  gameName?: string;
  title: string;
  description: string;
  /** Supabase `profiles.id` of the submitter — the actual authorization key. */
  authorId: string;
  /** Display name shown in the UI — free text, editable, NOT the authorization key. */
  author: string;
  phone?: string;
  attachment?: BugReportAttachment;
  status: BugReportStatus;
  createdAt: string;
  updatedAt: string;
}

export type UnifiedBugReport =
  | (BugReportRecord & { source: "local" })
  | (CloudBugReportRecord & { source: "cloud" });
