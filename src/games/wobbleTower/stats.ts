import { tallyOf } from "@/games/shared/statTally";
import type { Seat, WobbleTowerState } from "./engine";

/**
 * Per-match detail stats (rulebook §14; merge rule: `max*`/`best*` keep the
 * highest, others sum). pulls = 빼기 성공, collapses = 무너뜨림,
 * lastBuilder = 🏅 마지막 건축가, perfectPulls = 손놀림 95%+, riskyPulls =
 * 약한 층에서 빼고 버팀, maxLevels = 한 판 최고 층수, bestQuality = 최고 손놀림(%),
 * cleanGames = 한 번도 무너뜨리지 않은 판.
 */
export function wobbleTowerStatDetails(state: WobbleTowerState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    pulls: t.pulls ?? 0,
    collapses: t.collapses ?? 0,
    lastBuilder: t.lastBuilder ?? 0,
    perfectPulls: t.perfectPulls ?? 0,
    riskyPulls: t.riskyPulls ?? 0,
    maxLevels: t.maxLevels ?? 0,
    bestQuality: t.bestQuality ?? 0,
    cleanGames: (t.collapses ?? 0) === 0 ? 1 : 0,
  };
}
