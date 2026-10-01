import { tallyOf } from "@/games/shared/statTally";
import { computeGameOverScores, type RatATatCatState, type SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, `min*` the
 * lowest, others sum). Lower hand totals are better in this game.
 * gainfulSwaps = Swap으로 내 숫자 카드를 더 낮은 상대 카드와 바꾼 횟수.
 */
export function ratATatCatStatDetails(state: RatATatCatState, seat: SeatIndex, rank: number): Record<string, number> {
  const total = computeGameOverScores(state).find((s) => s.seat === seat)?.total ?? 0;
  const called = state.callerId === seat;
  return {
    ...tallyOf(state.statTally, seat),
    totalHandScore: total,
    minHandScore: total,
    zeroHands: total === 0 ? 1 : 0,
    ratCalls: called ? 1 : 0,
    ratCallWins: called && rank === 1 ? 1 : 0,
  };
}
