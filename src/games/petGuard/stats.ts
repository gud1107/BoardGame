import { tallyOf } from "@/games/shared/statTally";
import { finalRows, type PetState, type SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * Counters come from the engine's statTally; see src/lib/stats/details.ts.
 */
export function petGuardStatDetails(state: PetState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const row = finalRows(state).find((r) => r.seat === seat);
  return {
    ...t,
    rounds: t.rounds ?? 0,
    survived: t.survived ?? 0,
    coinsSaved: t.coinsSaved ?? 0,
    tier3Survived: t.tier3Survived ?? 0,
    twistHits: t.twistHits ?? 0,
    maxScore: row?.total ?? 0,
    gamesWon: rank === 1 ? 1 : 0,
  };
}
