import { rankOf, type GameState } from "./engine";

/**
 * 한 판의 개인 기록 (src/lib/stats — achievements/details/presentation이 이 키를 읽는다).
 * 끝난 상태(보기)에서만 부른다.
 */
export function fogStats(view: GameState, seat: number): Record<string, number> {
  const o = view.outcome;
  const t = view.tally[seat];
  const won = o?.winners.includes(seat) ? 1 : 0;
  const accused = view.log.some((e) => e.kind === "accuse" && e.seat === seat && e.correct);
  const earlyFrac = o && won && accused ? o.solvedRound / view.maxRounds : 1;
  return {
    solves: won,
    accuseSolves: won && accused ? 1 : 0,
    dawnSolves: won && !accused ? 1 : 0,
    /** 시계의 절반 전에 고발로 해결 */
    fastSolves: won && accused && earlyFrac <= 0.5 ? 1 : 0,
    wrongAccusations: view.wrong[seat] ? 1 : 0,
    survived: rankOf(view, seat) <= 2 ? 1 : 0,
    asks: t?.asks ?? 0,
    searches: t?.searches ?? 0,
    clues: t?.clues ?? 0,
    bellClues: t?.bellClues ?? 0,
    passages: t?.passages ?? 0,
    shownTo: t?.shownTo ?? 0,
    /** 심문 한 번도 안 하고 해결 */
    silentSolves: won && (t?.asks ?? 0) === 0 ? 1 : 0,
    fullHouse: won && view.seatCount === 6 ? 1 : 0,
    [`solves_${view.seatCount}p`]: won,
  };
}
