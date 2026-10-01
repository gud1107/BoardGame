import { tallyOf } from "@/games/shared/statTally";
import type { FiveCucumbersState, SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * finalTricks/finalTricksSurvived = 7번째(마지막) 트릭에 참여/오이를 피함,
 * topCardTricks = 15 카드로 따낸 트릭(1~6번째), oneCardDefenses = 마지막
 * 트릭에 1을 내고 오이를 피함, maxPenaltyOnce = 한 번에 먹은 가장 많은 오이.
 */
export function fiveCucumbersStatDetails(state: FiveCucumbersState, seat: SeatIndex): Record<string, number> {
  const p = state.players.find((pl) => pl.seat === seat);
  if (!p) return {};
  return {
    ...tallyOf(state.statTally, seat),
    cucumbersEaten: p.cucumbers,
    eliminated: p.eliminated ? 1 : 0,
  };
}
