"use client";

import { getDb } from "@/lib/db/client";
import type { PendingMatchStat, StatTotalsRecord } from "@/lib/db/types";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import type { GameSelfResult } from "@/games/types";
import { mergeStatDetails } from "./details";

/**
 * Personal per-game stats (played / wins / losses / best rank).
 *
 * - Every finished match is written to IndexedDB immediately (guest or not):
 *   `statTotals` for display and `statPending` as an upload queue.
 * - When logged in, the queue is drained through the `record_match_stats`
 *   RPC (one call per match, idempotent on matchId), then the server totals
 *   replace the local cache. Guest matches drain the same way on the next
 *   login — that *is* the guest → account merge.
 * - Only per-match deltas ever reach the server, never totals, which is
 *   what makes re-login and multi-device play safe.
 *
 * Design review: docs/player-stats-hybrid-sync-spec.md.
 */

export const STATS_CHANGED_EVENT = "player-stats-changed";

function emptyTotals(gameId: string): StatTotalsRecord {
  return { gameId, played: 0, wins: 0, losses: 0, bestRank: null, updatedAt: new Date().toISOString() };
}

function newMatchId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function currentUserId(): Promise<string | null> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

function notifyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STATS_CHANGED_EVENT));
}

/**
 * Called once per finished match from the game page. Never throws. Resolves
 * to this game's updated local totals (for the post-game card), or null when
 * nothing was recorded.
 */
export async function recordMatchStat(gameId: string, self: GameSelfResult, playedAt: string): Promise<StatTotalsRecord | null> {
  if (self.botPlayed) return null;
  let updated: StatTotalsRecord;
  try {
    const userId = await currentUserId();
    const won = self.rank === 1;
    const pending: PendingMatchStat = {
      matchId: newMatchId(),
      gameId,
      won,
      rank: self.rank,
      playerCount: self.playerCount,
      playedAt,
      details: self.details,
      withBots: self.withBots,
      userId,
    };
    const db = await getDb();
    const tx = db.transaction(["statTotals", "statPending"], "readwrite");
    const totals = (await tx.objectStore("statTotals").get(gameId)) ?? emptyTotals(gameId);
    updated = {
      ...totals,
      played: totals.played + 1,
      wins: totals.wins + (won ? 1 : 0),
      losses: totals.losses + (won ? 0 : 1),
      bestRank: totals.bestRank === null ? self.rank : Math.min(totals.bestRank, self.rank),
      details: mergeStatDetails(totals.details, self.details),
      updatedAt: new Date().toISOString(),
    };
    await tx.objectStore("statTotals").put(updated);
    await tx.objectStore("statPending").put(pending);
    await tx.done;
    notifyChanged();
  } catch (err) {
    console.warn("[stats] local record failed", err);
    return null;
  }
  void syncPlayerStats();
  return updated;
}

let syncInFlight: Promise<void> | null = null;

/**
 * Upload this account's (and any guest) pending matches, then pull the
 * server totals into the local cache. Safe to call any time; concurrent
 * calls share one run. No-op for guests or when Supabase isn't configured.
 */
export function syncPlayerStats(): Promise<void> {
  if (!syncInFlight) {
    syncInFlight = runSync().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

async function runSync(): Promise<void> {
  const supabase = getAuthSupabase();
  const userId = await currentUserId();
  if (!supabase || !userId) return;

  try {
    const db = await getDb();
    const pending = await db.getAll("statPending");
    let uploadFailed = false;
    for (const p of pending) {
      // Matches played while logged in as someone else stay queued for them.
      if (p.userId !== null && p.userId !== userId) continue;
      const { error } = await supabase.rpc("record_match_stats", {
        p_match_id: p.matchId,
        p_game_id: p.gameId,
        p_won: p.won,
        p_rank: p.rank,
        p_player_count: p.playerCount,
        p_played_at: p.playedAt,
        p_details: p.details ?? {},
        // Queued before this flag existed → unknown, so keep it out of the no-bots board.
        p_with_bots: p.withBots ?? true,
      });
      if (error) {
        // Table/function not installed yet, offline, rate limit… keep the
        // queue and the local totals as they are; next sync retries.
        console.warn("[stats] upload failed", error.message);
        uploadFailed = true;
        break;
      }
      await db.delete("statPending", p.matchId);
    }
    if (uploadFailed) return;

    const { data, error } = await supabase
      .from("player_game_stats")
      .select("game_id, played, wins, losses, best_rank, details, updated_at")
      .eq("user_id", userId);
    if (error || !data) return;

    // Server is now the source of truth for this account. Re-add anything
    // still queued (e.g. another account's matches) so they stay visible.
    const stillPending = await db.getAll("statPending");
    const tx = db.transaction("statTotals", "readwrite");
    await tx.store.clear();
    const byGame = new Map<string, StatTotalsRecord>();
    for (const row of data) {
      byGame.set(row.game_id, {
        gameId: row.game_id,
        played: row.played,
        wins: row.wins,
        losses: row.losses,
        bestRank: row.best_rank,
        details: row.details ?? {},
        updatedAt: row.updated_at,
      });
    }
    for (const p of stillPending) {
      const t = byGame.get(p.gameId) ?? emptyTotals(p.gameId);
      byGame.set(p.gameId, {
        ...t,
        played: t.played + 1,
        wins: t.wins + (p.won ? 1 : 0),
        losses: t.losses + (p.won ? 0 : 1),
        bestRank: t.bestRank === null ? p.rank : Math.min(t.bestRank, p.rank),
        details: mergeStatDetails(t.details, p.details),
      });
    }
    for (const t of byGame.values()) await tx.store.put(t);
    await tx.done;
    notifyChanged();
  } catch (err) {
    console.warn("[stats] sync failed", err);
  }
}

export async function listPlayerStats(): Promise<StatTotalsRecord[]> {
  try {
    const db = await getDb();
    return await db.getAll("statTotals");
  } catch {
    return [];
  }
}

export async function countPendingStats(): Promise<number> {
  try {
    const db = await getDb();
    return await db.count("statPending");
  } catch {
    return 0;
  }
}

/**
 * After logout: drop the account's cached totals from this device and keep
 * only guest matches still waiting for a login, so the next person on a
 * shared browser doesn't see the previous account's record.
 */
export async function resetLocalStatsToGuest(): Promise<void> {
  try {
    const db = await getDb();
    const guestPending = (await db.getAll("statPending")).filter((p) => p.userId === null);
    const byGame = new Map<string, StatTotalsRecord>();
    for (const p of guestPending) {
      const t = byGame.get(p.gameId) ?? emptyTotals(p.gameId);
      byGame.set(p.gameId, {
        ...t,
        played: t.played + 1,
        wins: t.wins + (p.won ? 1 : 0),
        losses: t.losses + (p.won ? 0 : 1),
        bestRank: t.bestRank === null ? p.rank : Math.min(t.bestRank, p.rank),
        details: mergeStatDetails(t.details, p.details),
      });
    }
    const tx = db.transaction("statTotals", "readwrite");
    await tx.store.clear();
    for (const t of byGame.values()) await tx.store.put(t);
    await tx.done;
    notifyChanged();
  } catch (err) {
    console.warn("[stats] reset failed", err);
  }
}
