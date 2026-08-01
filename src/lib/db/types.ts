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
