import { completedCollections } from "./synergy";
import { computePlayerScore } from "./engine";
import type { GreatLegacyState, SeatIndex } from "./types";

/**
 * Per-match detail stats for `GameSelfResult.details` (see
 * src/lib/stats/details.ts for how keys are merged: `max*` keeps the
 * highest, everything else is summed).
 */
export function greatLegacyStatDetails(state: GreatLegacyState, seat: SeatIndex): Record<string, number> {
  const p = state.players.find((pl) => pl.seat === seat);
  if (!p) return {};
  const score = computePlayerScore(p);
  const bids = p.winningBids ?? [];
  const live = p.assets.filter((a) => !a.discarded);
  const synergies = completedCollections(p.assets).length;
  return {
    totalScore: score.total,
    maxScore: score.total,
    maxWinningBid: bids.length ? Math.max(...bids) : 0,
    totalPaid: bids.reduce((s, b) => s + b, 0),
    totalAssetScore: score.assetScore,
    brokeGames: score.remainingCoinValue === 0 ? 1 : 0,
    synergies,
    maxSynergies: synergies,
    delisted: p.assets.length - live.length,
    boosted: live.filter((a) => a.currentScore > a.baseScore).length,
    crashed: live.filter((a) => a.currentScore < a.baseScore).length,
  };
}
