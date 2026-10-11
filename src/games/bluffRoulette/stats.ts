import { tallyOf } from "@/games/shared/statTally";
import type { BluffRouletteState, SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * liarCalls/liarCorrect = "거짓말!" 외침/적중, liesTold/liesCaught = 거짓
 * 선언/들킴, triggerPulls/survivedPulls = 방아쇠/생존, maxPullsSurvived =
 * 한 판에서 살아남은 최대 방아쇠 수, skullTriggers = 내 해골 발동,
 * flawlessWins = 방아쇠 없이 1위.
 */
export function bluffRouletteStatDetails(state: BluffRouletteState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    ...t,
    flawlessWins: rank === 1 && (state.players[seat]?.shots ?? 0) === 0 ? 1 : 0,
  };
}
