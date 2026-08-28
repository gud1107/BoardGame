/**
 * Pure list operations backing the bug report board (`useBugReportStore` +
 * `/bug-reports`). Kept separate from the store so "제출 성공 시 목록 갱신"
 * and "게임/상태 필터" logic is unit-testable without touching IndexedDB —
 * same split as `src/lib/betting/ledger.ts` vs `bettingStore.ts`.
 */

import type { BugReportRecord, BugReportStatus } from "@/lib/db/types";
import type { CloudBugReportRecord, UnifiedBugReport } from "./types";

export const BUG_REPORT_STATUSES: BugReportStatus[] = ["접수됨", "확인 중", "수정 완료"];

/**
 * Adds a freshly submitted report to the front of the list. `listBugReports`
 * (repository.ts) / the cloud `GET /api/bug-reports` both return newest-first
 * (sorted by `createdAt` desc); this mirrors that order without a full
 * re-fetch after every submission. Generic so it works for both the legacy
 * `BugReportRecord[]` (local) and `CloudBugReportRecord[]` lists.
 */
export function prependReport<T extends { id: string }>(list: T[], report: T): T[] {
  return [report, ...list];
}

export function updateReportStatusInList<T extends { id: string; status: BugReportStatus }>(
  list: T[],
  id: string,
  status: BugReportStatus,
): T[] {
  return list.map((r) => (r.id === id ? { ...r, status } : r));
}

/** Merges a content-edit patch into the targeted item; used after a successful `PATCH`/local content update. */
export function updateReportInList<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Drops a report after a successful delete (soft-delete responses don't return the row). */
export function removeReportFromList<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((r) => r.id !== id);
}

/**
 * Combines the legacy local (IndexedDB, no account link — see HANDOFF.md
 * for why these weren't migrated) and the new cloud-backed lists into one
 * chronological feed for the board. Tagging each item with `source` lets
 * the detail modal decide whether edit/delete availability follows
 * author-or-admin (cloud) or admin-only (local, since there's no authorId
 * to check ownership against).
 */
export function mergeReportSources(local: BugReportRecord[], cloud: CloudBugReportRecord[]): UnifiedBugReport[] {
  const localTagged: UnifiedBugReport[] = local.map((r) => ({ ...r, source: "local" as const }));
  const cloudTagged: UnifiedBugReport[] = cloud.map((r) => ({ ...r, source: "cloud" as const }));
  return [...localTagged, ...cloudTagged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface BugReportFilter {
  /**
   * `undefined`/`"all"` = no game filter. `""` = hub-only (reports with no
   * `gameId`) — deliberately *not* treated as falsy-therefore-no-filter, so
   * a caller can distinguish "show everything" from "show only the
   * game-agnostic ones". Any other string = exact `gameId` match.
   */
  gameId?: string;
  /** A specific status, `"all"`/undefined for no status filter. */
  status?: BugReportStatus | "all";
  /** Case-insensitive substring match against the title. */
  query?: string;
}

/** Generic over `T` so it works on both a plain local list and the merged `UnifiedBugReport[]` feed. */
export function filterReports<T extends { gameId?: string; status: BugReportStatus; title: string }>(
  list: T[],
  filter: BugReportFilter,
): T[] {
  const q = filter.query?.trim().toLowerCase();
  return list.filter((r) => {
    const gameOk =
      filter.gameId === undefined || filter.gameId === "all"
        ? true
        : (r.gameId ?? "") === filter.gameId;
    const statusOk = !filter.status || filter.status === "all" || r.status === filter.status;
    const queryOk = !q || r.title.toLowerCase().includes(q);
    return gameOk && statusOk && queryOk;
  });
}
