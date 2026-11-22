import { tallyOf } from "@/games/shared/statTally";
import type { ChoiceState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §10; `max*` keeps the highest,
 * others sum): answers / skips = 답한·못 답한 라운드, roundWins = 이긴 라운드,
 * allInWins / allInLosses = 칩 3개 걸고 이김·짐, reverseWins = 🔄 반전 승리,
 * loneWolves = 🐺 외톨이 성공, minorityPicks = 절반 미만 쪽을 고른 횟수,
 * maxRound = 한 라운드 최고 득점, maxScore = 최종 점수, wins = 1위.
 */
export function everyoneChoiceStatDetails(state: ChoiceState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const keys = ["answers", "skips", "roundWins", "allInWins", "allInLosses", "reverseWins", "loneWolves", "minorityPicks", "maxRound", "wins"];
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = t[k] ?? 0;
  out.maxScore = state.scores[seat] ?? 0;
  return out;
}
