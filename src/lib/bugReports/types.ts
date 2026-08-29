import type { BugReportAttachment, BugReportRecord, BugReportStatus } from "@/lib/db/types";

/**
 * A bug report stored server-side (Supabase `bug_reports` table, see
 * `supabase/schema.sql`) — either tied to a real account (`authorId`) or
 * submitted by a guest (`isGuest: true`, `authorId: null`, authorized by a
 * password instead — see `guestAuth.ts`), unlike the legacy
 * `BugReportRecord` (IndexedDB, no account link and no password). New
 * submissions go here exclusively; see HANDOFF.md for why the legacy local
 * records were not migrated.
 *
 * The guest's password hash is intentionally NOT a field here — this type
 * is what the API returns to the client, and the hash never leaves the
 * server (see `serverRepository.ts`'s `rowToRecord`, which is an allowlist
 * that simply never reads `password_hash` off the DB row).
 */
export interface CloudBugReportRecord {
  id: string;
  gameId?: string;
  gameName?: string;
  title: string;
  description: string;
  /** Supabase `profiles.id` of the submitter — the actual authorization key for a logged-in author. `null` for a guest submission. */
  authorId: string | null;
  /** Display name shown in the UI — free text, editable, NOT the authorization key. */
  author: string;
  /** True when this was submitted without logging in (authorized by password instead of `authorId`). */
  isGuest: boolean;
  phone?: string;
  attachment?: BugReportAttachment;
  status: BugReportStatus;
  createdAt: string;
  updatedAt: string;
}

export type UnifiedBugReport =
  | (BugReportRecord & { source: "local" })
  | (CloudBugReportRecord & { source: "cloud" });
