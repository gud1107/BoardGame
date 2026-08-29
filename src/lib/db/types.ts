/**
 * Domain types persisted in IndexedDB. IndexedDB is the primary datastore
 * (per spec) — everything here must be able to work fully offline with no
 * server. Supabase (see `src/lib/supabase`) is an optional mirror on top.
 */

export interface PlayerRecord {
  id: string;
  /** Most recently used nickname. */
  name: string;
  /** Historical nicknames, most recent last, for identity matching across days. */
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps a browser (device) to a canonical player. One device can only point
 * to one player at a time; a player can have multiple devices linked to it
 * (e.g. someone who plays from both their phone and a shared desktop).
 */
export interface DeviceIdentityRecord {
  deviceId: string;
  playerId: string;
  lastIp?: string;
  updatedAt: string;
}

export type BettingStatus = "active" | "ended";

export interface BettingParticipant {
  playerId: string;
  name: string;
}

/** One game played while a betting session was active. */
export interface BettingRound {
  id: string;
  gameId: string;
  gameName: string;
  /** Ordered best (rank 1) to worst. Only participants who played are listed. */
  rankedPlayerIds: string[];
  /** Payout delta applied to each participant for this round. */
  deltas: Record<string, number>;
  playedAt: string;
}

/** A hand-entered correction outside the normal round flow (e.g. a cash-settlement rounding fix). */
export interface BettingManualAdjustment {
  id: string;
  playerId: string;
  amount: number;
  note?: string;
  createdAt: string;
}

/**
 * Post-hoc "same person, different name" consolidation for the settlement
 * view — see `src/lib/betting/mergeGroups.ts` for the full rationale. Purely
 * a display-time fold: `rounds`/`totals` above always stay keyed by the raw
 * `playerId` that was actually used at the time, so merging (and undoing a
 * merge) never rewrites history.
 */
export interface BettingMergedGroup {
  canonicalId: string;
  memberIds: string[];
}

export interface BettingSessionRecord {
  id: string;
  status: BettingStatus;
  startedAt: string;
  endedAt?: string;
  participants: BettingParticipant[];
  /** Index 0 = 1st place payout, index N-1 = last place. Must sum to 0. */
  payoutTable: number[];
  rounds: BettingRound[];
  /** Cumulative totals per playerId, derived from rounds but cached for fast reads. */
  totals: Record<string, number>;
  /** Absent on sessions created before this field existed — treat as `[]`. */
  manualAdjustments?: BettingManualAdjustment[];
  /** Absent on sessions created before this field existed — treat as `[]`. */
  mergedGroups?: BettingMergedGroup[];
}

export interface DailyRecordStanding {
  playerId: string;
  name: string;
  total: number;
  rank: number;
}

/** A finalized (내기끝) betting session, archived for history/leaderboards. */
export interface DailyRecord {
  id: string;
  date: string; // YYYY-MM-DD
  sessionId: string;
  standings: DailyRecordStanding[];
  payoutTable: number[];
  roundCount: number;
  createdAt: string;
}

export interface GameResultRecord {
  id: string;
  gameId: string;
  gameName: string;
  participantIds: string[];
  rankedPlayerIds: string[];
  playedAt: string;
  bettingSessionId?: string;
}

export type BugReportStatus = "접수됨" | "확인 중" | "수정 완료";

export interface BugReportAttachment {
  fileName: string;
  mimeType: string;
  /** Base64 `data:` URI. Images are downscaled client-side before storage — see `lib/bugReports/attachment.ts`. */
  dataUrl: string;
}

export interface BugReportRecord {
  id: string;
  /** Which game this bug happened in. Absent for hub-level (game-agnostic) reports. */
  gameId?: string;
  /** Denormalized snapshot of the game's display name at submission time, so the board still reads fine even if the game is later renamed/removed from the registry. */
  gameName?: string;
  title: string;
  description: string;
  author: string;
  /** Unmasked, formatted phone (e.g. "010-1234-5678"). Mask only at render time — see `maskPhoneNumber`. */
  phone?: string;
  attachment?: BugReportAttachment;
  status: BugReportStatus;
  createdAt: string;
  /** Set only when an admin edits a legacy (account-less) local report's content — see `board.ts`'s "수정됨" badge logic. */
  updatedAt?: string;
  /** Soft-delete flag for admin-deleted legacy reports. `listBugReports()` filters these out; absent/false = not deleted. */
  isDeleted?: boolean;
}
