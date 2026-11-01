import { tallyOf } from "@/games/shared/statTally";
import type { SeatIndex, StarRummyState } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * The counters come from the engine's statTally; `bestTotal` is the final score.
 */
export function starRummyStatDetails(state: StarRummyState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const total = state.scores[seat] ?? 0;
  return {
    ...t,
    maxTurnTiles: t.maxTurnTiles ?? 0,
    maxTotal: total,
    gamesWon: rank === 1 ? 1 : 0,
    rounds: state.results.length,
  };
}
