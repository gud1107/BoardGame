import { tallyOf } from "@/games/shared/statTally";
import { totalOf, type BowlingState, type Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §13; merge rule: `max*`/`best*` keep the
 * highest, others sum). strikes / spares / gutters, splitsConverted = 스플릿
 *처리, turkeys = 3연속 스트라이크, maxStreak = 최장 연속 스트라이크,
 * maxScore = 한 게임 최고 점수(그 게임 프레임 수 기준), maxScore10 = 10프레임
 * 정식 게임 최고 점수, itemsUsed / sabotages = 아이템·방해, hazardBeaten =
 * 방해받은 프레임에서 스트라이크·스페어, rolls = 던진 공 수.
 */
export function bowlingStatDetails(state: BowlingState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const total = totalOf(state, seat);
  return {
    strikes: t.strikes ?? 0,
    spares: t.spares ?? 0,
    gutters: t.gutters ?? 0,
    splits: t.splits ?? 0,
    splitsConverted: t.splitsConverted ?? 0,
    turkeys: t.turkeys ?? 0,
    maxStreak: t.maxStreak ?? 0,
    maxScore: total,
    maxScore10: state.options.frames === 10 ? total : 0,
    itemsUsed: t.itemsUsed ?? 0,
    sabotages: t.sabotages ?? 0,
    hazardBeaten: t.hazardBeaten ?? 0,
    rolls: t.rolls ?? 0,
  };
}
