"use client";

import { getDb } from "@/lib/db/client";
import type { PendingMatchStat, StatSlice, StatTotalsRecord } from "@/lib/db/types";
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
 * - Each total also carries `noBot` (matches without bots) and `byBotLevel`
 *   (keyed by the highest lobby-bot level at the table) for the /stats filter.
 *
 * Design review: docs/player-stats-hybrid-sync-spec.md.
 */

export const STATS_CHANGED_EVENT = "player-stats-changed";

function emptyTotals(gameId: string): StatTotalsRecord {
  return { gameId, played: 0, wins: 0, losses: 0, bestRank: null, updatedAt: new Date().toISOString() };
}

const EMPTY_SLICE: StatSlice = { played: 0, wins: 0, losses: 0, bestRank: null };

type MatchFacts = Pick<PendingMatchStat, "won" | "rank" | "details" | "withBots" | "botLevel">;

function addToSlice(s: StatSlice, m: MatchFacts): StatSlice {
  return {
    played: s.played + 1,
    wins: s.wins + (m.won ? 1 : 0),
    losses: s.losses + (m.won ? 0 : 1),
    bestRank: s.bestRank === null ? m.rank : Math.min(s.bestRank, m.rank),
    details: mergeStatDetails(s.details, m.details),
  };
}

/** Adds one match to every slice it belongs to. `withBots` absent = unknown → not in `noBot`. */
function applyMatch(t: StatTotalsRecord, m: MatchFacts): StatTotalsRecord {
  const out: StatTotalsRecord = { ...t, ...addToSlice(t, m) };
  if (typeof m.withBots === "boolean") out.classified = (t.classified ?? 0) + 1;
  if (m.withBots === false) out.noBot = addToSlice(t.noBot ?? EMPTY_SLICE, m);
  // Level 0 = only mid-game takeover bots (they have no level).
  const level = typeof m.botLevel === "number" ? m.botLevel : m.withBots === true ? 0 : null;
  if (level !== null) {
    const key = String(level);
    out.byBotLevel = { ...t.byBotLevel, [key]: addToSlice(t.byBotLevel?.[key] ?? EMPTY_SLICE, m) };
  }
  return out;
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
    const pending: PendingMatchStat = {
      matchId: newMatchId(),
      gameId,
      won: self.rank === 1,
      rank: self.rank,
      playerCount: self.playerCount,
      playedAt,
      details: self.details,
      withBots: self.withBots,
      botLevel: self.botLevel,
      userId,
    };
    const db = await getDb();
    const tx = db.transaction(["statTotals", "statPending"], "readwrite");
    const totals = (await tx.objectStore("statTotals").get(gameId)) ?? emptyTotals(gameId);
    updated = { ...applyMatch(totals, pending), updatedAt: new Date().toISOString() };
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

interface SliceRow {
  game_id: string;
  played: number;
  wins: number;
  losses: number;
  best_rank: number | null;
  details?: Record<string, number> | null;
}

function toSlice(row: SliceRow): StatSlice {
  return { played: row.played, wins: row.wins, losses: row.losses, bestRank: row.best_rank, details: row.details ?? {} };
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
        // Queued before this flag existed → null (unknown): off the no-bots board.
        p_with_bots: p.withBots ?? null,
        p_bot_level: p.botLevel ?? null,
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

    const [all, noBot, byLevel, classified] = await Promise.all([
      supabase.from("player_game_stats").select("game_id, played, wins, losses, best_rank, details, updated_at").eq("user_id", userId),
      supabase.from("player_game_stats_nobot").select("game_id, played, wins, losses, best_rank, details").eq("user_id", userId),
      supabase.rpc("my_bot_level_stats"),
      supabase.rpc("my_classified_counts"),
    ]);
    if (all.error || !all.data) return;

    // Server is now the source of truth for this account. If the filter
    // tables aren't readable (older SQL), keep this device's slices instead.
    const previous = new Map((await db.getAll("statTotals")).map((t) => [t.gameId, t]));
    const byGame = new Map<string, StatTotalsRecord>();
    for (const row of all.data) {
      byGame.set(row.game_id, {
        gameId: row.game_id,
        ...toSlice(row),
        updatedAt: row.updated_at,
        ...(noBot.error || byLevel.error || classified.error
          ? {
              noBot: previous.get(row.game_id)?.noBot,
              byBotLevel: previous.get(row.game_id)?.byBotLevel,
              classified: previous.get(row.game_id)?.classified,
            }
          : {}),
      });
    }
    if (!noBot.error && noBot.data) {
      for (const row of noBot.data as SliceRow[]) {
        const t = byGame.get(row.game_id);
        if (t) t.noBot = toSlice(row);
      }
    }
    if (!byLevel.error && Array.isArray(byLevel.data)) {
      for (const row of byLevel.data as (SliceRow & { bot_level: number })[]) {
        const t = byGame.get(row.game_id);
        if (t) t.byBotLevel = { ...t.byBotLevel, [String(row.bot_level)]: toSlice(row) };
      }
    }
    if (!classified.error && Array.isArray(classified.data)) {
      for (const row of classified.data as { game_id: string; classified: number }[]) {
        const t = byGame.get(row.game_id);
        if (t) t.classified = row.classified;
      }
    }
    // Re-add anything still queued (e.g. another account's matches) so they stay visible.
    for (const p of await db.getAll("statPending")) {
      byGame.set(p.gameId, applyMatch(byGame.get(p.gameId) ?? emptyTotals(p.gameId), p));
    }
    const tx = db.transaction("statTotals", "readwrite");
    await tx.store.clear();
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
      byGame.set(p.gameId, applyMatch(byGame.get(p.gameId) ?? emptyTotals(p.gameId), p));
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
