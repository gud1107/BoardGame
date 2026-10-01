import { tallyOf } from "@/games/shared/statTally";
import { computePlayerScore, type CenturyState, type SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, `min*` the
 * lowest, others sum). minWinRounds = 이긴 판에서 걸린 라운드 수(빠를수록 좋음)
 * — only present on wins, so it never gets dragged down by a loss.
 */
export function centuryStatDetails(state: CenturyState, seat: SeatIndex, rank: number): Record<string, number> {
  const p = state.players.find((pl) => pl.seat === seat);
  if (!p) return {};
  const score = computePlayerScore(p);
  const rounds = Math.ceil(state.turnNumber / state.playerCount);
  return {
    ...tallyOf(state.statTally, seat),
    totalScore: score.total,
    maxScore: score.total,
    goldCoins: p.gold,
    silverCoins: p.silver,
    pointCards: p.pointCards.length,
    ...(rank === 1 ? { minWinRounds: rounds } : {}),
  };
}
