import { tallyOf } from "@/games/shared/statTally";
import { finalRows, type MagicState, type SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * Counters come from the engine's statTally; see src/lib/stats/details.ts.
 */
export function magicShopStatDetails(state: MagicState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const row = finalRows(state).find((r) => r.seat === seat);
  return {
    ...t,
    orders: t.orders ?? 0,
    bought: t.bought ?? 0,
    trashed: t.trashed ?? 0,
    websSent: t.websSent ?? 0,
    maxOrderFame: t.maxOrderFame ?? 0,
    maxScore: row?.total ?? 0,
    gamesWon: rank === 1 ? 1 : 0,
  };
}
