import { tallyOf } from "@/games/shared/statTally";
import type { CorridorState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §9; `max*` keeps the highest, others
 * sum): rounds, correct, found = 이상 찾음, cleared = 평범한 복도 통과,
 * missed = 이상을 놓침, falseAlarms = 헛것, timeouts, maxStreak, maxSpeed =
 * 최고 속도 보너스, perfectGames, maxScore = 최종 점수.
 */
export function strangeCorridorStatDetails(state: CorridorState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const keys = ["rounds", "correct", "found", "cleared", "missed", "falseAlarms", "timeouts", "maxStreak", "maxSpeed", "perfectGames"];
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = t[k] ?? 0;
  out.maxScore = Math.max(0, state.scores[seat] ?? 0);
  return out;
}
