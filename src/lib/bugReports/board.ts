/**
 * Pure list operations backing the bug report board (`useBugReportStore` +
 * `/bug-reports`). Kept separate from the store so "제출 성공 시 목록 갱신"
 * and "게임/상태 필터" logic is unit-testable without touching IndexedDB —
 * same split as `src/lib/betting/ledger.ts` vs `bettingStore.ts`.
 */

import type { BugReportRecord, BugReportStatus } from "@/lib/db/types";

export const BUG_REPORT_STATUSES: BugReportStatus[] = ["접수됨", "확인 중", "수정 완료"];

/**
 * Adds a freshly submitted report to the front of the list. `listBugReports`
 * (repository.ts) returns newest-first (sorted by `createdAt` desc); this
 * mirrors that order without a full re-fetch after every submission.
 */
export function prependReport(
  list: BugReportRecord[],
  report: BugReportRecord,
): BugReportRecord[] {
  return [report, ...list];
}

export function updateReportStatusInList(
  list: BugReportRecord[],
  id: string,
  status: BugReportStatus,
): BugReportRecord[] {
  return list.map((r) => (r.id === id ? { ...r, status } : r));
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

export function filterReports(
  list: BugReportRecord[],
  filter: BugReportFilter,
): BugReportRecord[] {
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
