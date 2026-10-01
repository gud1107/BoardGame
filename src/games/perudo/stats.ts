import { tallyOf } from "@/games/shared/statTally";
import type { PerudoState, SeatIndex } from "./engine";

/**
 * Per-match detail stats (merge rule: `max*` keeps the highest, others sum).
 * dudoCalls/dudoCorrect = "페루도!" 호출/적중, calzaCalls/calzaCorrect =
 * "맞아!" 호출/적중, bluffsCaught = 내 선언이 페루도!에 걸림, bidsHeld = 내
 * 선언에 페루도!를 건 상대가 틀림, exactHits = 내 선언이 경계 적중으로 판정됨.
 */
export function perudoStatDetails(state: PerudoState, seat: SeatIndex, rank: number): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const comeback = rank === 1 && t.downToOne ? 1 : 0;
  delete t.downToOne;
  return { ...t, oneDieComebacks: comeback };
}
