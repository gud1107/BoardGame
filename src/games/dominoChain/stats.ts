import { tallyOf } from "@/games/shared/statTally";
import type { DominoState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §12; merge rule: `max*`/`best*` keep the
 * highest, others sum). bells = 울린 종, bigBells = 가운데 3점 종, steals = 가로챈
 * 도미노, toppled = 내 사슬이 쓰러뜨린 수, maxChain = 한 라운드 최장 사슬, longest =
 * 최장 사슬 보너스, bombs = 터뜨린 폭탄, placed/splits/walls = 세운 도미노·갈림길·벽,
 * roundWins = 라운드 1등, bestRound = 한 라운드 최고 점수, maxScore = 한 판 점수.
 */
export function dominoStatDetails(state: DominoState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  return {
    rounds: state.history.length,
    bells: t.bells ?? 0,
    bigBells: t.bigBells ?? 0,
    steals: t.steals ?? 0,
    toppled: t.toppled ?? 0,
    maxChain: t.maxChain ?? 0,
    longest: t.longest ?? 0,
    bombs: t.bombs ?? 0,
    placed: t.placed ?? 0,
    splits: t.splits ?? 0,
    walls: t.walls ?? 0,
    roundWins: t.roundWins ?? 0,
    bestRound: t.bestRound ?? 0,
    maxScore: state.scores[seat] ?? 0,
  };
}
