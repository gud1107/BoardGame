import { tallyOf } from "@/games/shared/statTally";
import type { CurlingState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §19; merge rule: `max*` keep the highest,
 * others sum). throws = 투구, buttons = 🎯 버튼, takeouts = 내보낸 상대 스톤,
 * doubles = 더블 이상, freezes = 🧊 프리즈, partyStones = 파티 스톤 사용,
 * endsWon/points = 내 편이 득점한 엔드/점수, maxEnd = 한 엔드 최고 득점,
 * steals = 해머 없이 득점, hogs = 호그 라인 미달, maxRemoved = 한 번에 내보낸 최다.
 */
export function curlingStatDetails(state: CurlingState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    throws: t.throws ?? 0,
    buttons: t.buttons ?? 0,
    takeouts: t.takeouts ?? 0,
    doubles: t.doubles ?? 0,
    freezes: t.freezes ?? 0,
    partyStones: t.partyStones ?? 0,
    endsWon: t.endsWon ?? 0,
    points: t.points ?? 0,
    maxEnd: t.maxEnd ?? 0,
    steals: t.steals ?? 0,
    hogs: t.hogs ?? 0,
    maxRemoved: t.maxRemoved ?? 0,
  };
}
