import { seatDetails, type GameState, type Seat } from "./engine";

/**
 * 개인 기록 (규칙서 §10; `max*`는 최고값, 나머지는 합산): lives = 살아 본 인생, scenes = 장면,
 * fastPicks = ⚡ 지름길, traits = 굳은 성격, echoes = 나비효과, swaps = 성격 때문에 바뀐 선택지를
 * 고른 횟수, claps / clapsGiven = 받은·쳐 준 박수, bestEndings = 명장면 엔딩(보너스 14 이상),
 * noFast = 지름길 없이 완주, maxScore / maxLove / maxMoney.
 */
export function lifeSkitStatDetails(state: GameState, seat: Seat): Record<string, number> {
  return seatDetails(state, seat);
}
