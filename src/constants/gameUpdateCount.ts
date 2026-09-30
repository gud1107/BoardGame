import { PATCH_NOTES } from "./patchNotes";
import type { GameId } from "@/games/types";
import { GAME_ADDED, GAME_LAST_UPDATED } from "./gameLastUpdated.generated";

/**
 * How many patch-note releases touched each game at least once — computed
 * live from `PATCH_NOTES` (the same single source `/patch-notes` renders)
 * rather than hand-maintained, so it can never drift out of sync as new
 * entries are backfilled or shipped. A release with two changes for the same
 * game (e.g. a FEAT + a FIX in one version) still counts once, matching how
 * a user would describe it ("페루도가 이번 업데이트에서 또 바뀌었네").
 * `"common"` (site-wide changes) isn't a specific game and is excluded.
 */
function computeGameUpdateCounts(): Map<GameId, number> {
  const counts = new Map<GameId, number>();
  for (const entry of PATCH_NOTES) {
    const gamesInEntry = new Set(
      entry.changes
        .map((c) => c.game)
        .filter((g): g is GameId => g !== "common"),
    );
    for (const gameId of gamesInEntry) {
      counts.set(gameId, (counts.get(gameId) ?? 0) + 1);
    }
  }
  return counts;
}

export const GAME_UPDATE_COUNTS = computeGameUpdateCounts();

export function getGameUpdateCount(gameId: GameId): number {
  return GAME_UPDATE_COUNTS.get(gameId) ?? 0;
}

/** Newest patch-note `releaseDate` that mentions each game (ISO date). */
function computePatchNoteLastDates(): Map<GameId, string> {
  const dates = new Map<GameId, string>();
  for (const entry of PATCH_NOTES) {
    for (const { game } of entry.changes) {
      if (game === "common") continue;
      const prev = dates.get(game);
      if (!prev || entry.releaseDate > prev) dates.set(game, entry.releaseDate);
    }
  }
  return dates;
}

const PATCH_NOTE_LAST_DATES = computePatchNoteLastDates();

/**
 * When each game was last updated, as a sortable ISO string — the later of
 * its newest game-specific commit (`gameLastUpdated.generated.ts`, from git)
 * and its newest patch note. Empty string for games never touched (준비중).
 * Backs the lobby's default "최근 업데이트순" sort (2026-09-30 request:
 * recency, not the old patch-count ranking).
 */
export function getGameLastUpdated(gameId: GameId): string {
  const fromGit = GAME_LAST_UPDATED[gameId] ?? "";
  const fromNotes = PATCH_NOTE_LAST_DATES.get(gameId) ?? "";
  return fromGit > fromNotes ? fromGit : fromNotes;
}

export type GameFreshnessBadge = "NEW" | "UPDATED";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A game counts as NEW for this long after its first commit. */
export const NEW_BADGE_DAYS = 14;
/** …and UPDATED for this long after its last game-specific update. */
export const UPDATED_BADGE_DAYS = 5;

/**
 * Lobby card badge: NEW wins over UPDATED (a fresh game is also recently
 * touched). `now` is passed in (not read here) so the lobby can freeze one
 * timestamp per page load and keep render pure.
 */
export function getGameFreshnessBadge(gameId: GameId, now: number): GameFreshnessBadge | null {
  const addedAt = GAME_ADDED[gameId];
  if (addedAt && now - Date.parse(addedAt) < NEW_BADGE_DAYS * DAY_MS) return "NEW";
  const updatedAt = getGameLastUpdated(gameId);
  if (updatedAt && now - Date.parse(updatedAt) < UPDATED_BADGE_DAYS * DAY_MS) return "UPDATED";
  return null;
}
