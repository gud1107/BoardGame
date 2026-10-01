import { tallyOf } from "@/games/shared/statTally";
import type { SeatIndex, SpotDifferenceState } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * `opponentBotLevels` = levels of bots on the other team(s), for "Lv.10 봇
 * 상대로 승리" (bot levels live in the component, not engine state).
 */
export function spotDifferenceStatDetails(
  state: SpotDifferenceState,
  seat: SeatIndex,
  rank: number,
  opponentBotLevels: number[],
): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const found = t.spotsFound ?? 0;
  const misses = t.missClicks ?? 0;
  return {
    spotsFound: found,
    missClicks: misses,
    maxSpotsInGame: found,
    perfectGames: found > 0 && misses === 0 ? 1 : 0,
    lv10BotWins: rank === 1 && opponentBotLevels.includes(10) ? 1 : 0,
  };
}
