import { tallyOf } from "@/games/shared/statTally";
import type { ResolveState, SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * Counters come from the engine's statTally; see src/lib/stats/details.ts.
 */
export function threeDayResolveStatDetails(state: ResolveState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const p = state.players[seat];
  return {
    ...t,
    successes: t.successes ?? 0,
    fails: t.fails ?? 0,
    compromises: t.compromises ?? 0,
    hardSuccess: t.hardSuccess ?? 0,
    snsSuccess: t.snsSuccess ?? 0,
    crisisSurvived: t.crisisSurvived ?? 0,
    lessonsUsed: t.lessonsUsed ?? 0,
    cheerHits: t.cheerHits ?? 0,
    watchHits: t.watchHits ?? 0,
    maxSeasonGain: t.maxSeasonGain ?? 0,
    maxScore: p?.score ?? 0,
    gamesWon: rank === 1 ? 1 : 0,
  };
}
