import { tallyOf } from "@/games/shared/statTally";
import type { IslandState, SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * Counters come from the engine's statTally; see src/lib/stats/details.ts.
 */
export function islandStatDetails(state: IslandState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    ...t,
    maxRegionPoints: t.maxRegionPoints ?? 0,
    maxRegionTiles: t.maxRegionTiles ?? 0,
    maxScore: state.scores[seat] ?? 0,
    gamesWon: rank === 1 ? 1 : 0,
  };
}
