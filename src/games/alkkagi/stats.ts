import { tallyOf } from "@/games/shared/statTally";
import type { AlkkagiState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §15; merge rule: `max*`/`best*` keep the
 * highest, others sum). knocked = 떨어뜨린 상대 알, lost = 잃은 내 알,
 * selfFalls = 튕긴 알이 스스로 떨어짐, multiKnocks = 한 번에 2개 이상,
 * bestShot = 한 번에 가장 많이 떨어뜨린 수, roundWins = 판 1등,
 * flawless = 알을 하나도 안 잃고 이긴 판, kingKills = 왕 잡기, shots = 튕긴 횟수.
 */
export function alkkagiStatDetails(state: AlkkagiState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    knocked: t.knocked ?? 0,
    lost: t.lost ?? 0,
    selfFalls: t.selfFalls ?? 0,
    multiKnocks: t.multiKnocks ?? 0,
    bestShot: t.bestShot ?? 0,
    roundWins: t.roundWins ?? 0,
    flawless: t.flawless ?? 0,
    kingKills: t.kingKills ?? 0,
    shots: t.shots ?? 0,
  };
}
