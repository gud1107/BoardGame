import { PATCH_NOTES } from "./patchNotes";
import type { GameId } from "@/games/types";

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
