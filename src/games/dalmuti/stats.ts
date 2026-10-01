import { tallyOf } from "@/games/shared/statTally";
import type { DalmutiState, SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * "Start" is the seat's position in `rankOrder` for this hand (after a grand
 * revolution flipped it), 0 = 위대한 달무티.
 */
export function dalmutiStatDetails(state: DalmutiState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const n = state.playerCount;
  const start = state.rankOrder.indexOf(seat);
  const rev = state.revolutionDeclared;
  return {
    finishedFirst: rank === 1 ? 1 : 0,
    finishedLast: rank === n ? 1 : 0,
    startedDalmuti: start === 0 ? 1 : 0,
    startedPeon: start === n - 1 ? 1 : 0,
    winAsPeon: start === n - 1 && rank === 1 ? 1 : 0,
    loseAsDalmuti: start === 0 && rank === n ? 1 : 0,
    revolutions: rev?.seat === seat && !rev.isGrand ? 1 : 0,
    grandRevolutions: rev?.seat === seat && rev.isGrand ? 1 : 0,
    jokerFinishes: t.jokerFinish ?? 0,
    maxCardsInOnePlay: t.maxCardsInOnePlay ?? 0,
  };
}
