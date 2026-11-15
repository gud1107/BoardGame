import { tallyOf } from "@/games/shared/statTally";
import type { BilliardsState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §13; merge rule: `max*`/`best*` keep the
 * highest, others sum). pots = 넣은 공, golds = ★9, luckyPots = ×2 포켓 득점,
 * multiPots = 한 번에 2개 이상, bestShot = 한 번에 넣은 최다, bestRun = 연속 득점 타,
 * caroms = 캐롬 성공, threeCushions = 쓰리쿠션, fouls = 반칙, scratches = 흰 공 빠짐,
 * rackWins = 판 1등, shots = 친 횟수, pocketGames / caromGames = 놀이별 판 수,
 * maxScore = 한 판 최고 점수.
 */
export function billiardsStatDetails(state: BilliardsState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    shots: t.shots ?? 0,
    pots: t.pots ?? 0,
    golds: t.golds ?? 0,
    luckyPots: t.luckyPots ?? 0,
    multiPots: t.multiPots ?? 0,
    bestShot: t.bestShot ?? 0,
    bestRun: t.bestRun ?? 0,
    caroms: t.caroms ?? 0,
    threeCushions: t.threeCushions ?? 0,
    fouls: t.fouls ?? 0,
    scratches: t.scratches ?? 0,
    rackWins: t.rackWins ?? 0,
    pocketGames: state.options.mode === "pocket" ? 1 : 0,
    caromGames: state.options.mode === "carom" ? 1 : 0,
    maxScore: state.scores[seat] ?? 0,
  };
}
