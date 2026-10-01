import { tallyOf } from "@/games/shared/statTally";
import { STARTING_HEARTS, type CoyoteState, type SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * coyoteCalls/coyoteCorrect = "코요테!" 호출/적중, bidsChallenged/bidsHeld =
 * 내 선언이 의심받음/버텨냄, specialCardRounds = 내 이마에 ?·MAX→0·x2 카드가
 * 붙었던 라운드, flawlessWins = 하트를 하나도 잃지 않고 1위.
 */
export function coyoteStatDetails(state: CoyoteState, seat: SeatIndex, rank: number): Record<string, number> {
  const p = state.players.find((pl) => pl.seat === seat);
  return {
    ...tallyOf(state.statTally, seat),
    flawlessWins: rank === 1 && p?.hearts === STARTING_HEARTS ? 1 : 0,
  };
}
