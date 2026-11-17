import { rankOf, type GameState } from "./engine";

/**
 * 한 판의 개인 기록 (src/lib/stats — achievements/details/presentation이 이 키를 읽는다).
 * 끝난 상태(보기)에서만 부른다.
 */
export function cctvStats(view: GameState, seat: number): Record<string, number> {
  const t = view.tally[seat];
  const won = view.outcome?.winners.includes(seat) ? 1 : 0;
  const guestCases = t?.guestCases ?? 0;
  const culpritCases = t?.culpritCases ?? 0;
  const correct = t?.correctVotes ?? 0;
  const escapes = t?.escapes ?? 0;
  return {
    wins: won,
    survived: rankOf(view, seat) <= 2 ? 1 : 0,
    score: view.scores[seat] ?? 0,
    guestCases,
    culpritCases,
    /** 손님으로 범인을 잡은 사건 */
    catches: t?.catches ?? 0,
    /** 범인을 정확히 찍은 표 */
    correctVotes: correct,
    /** 손님이었던 사건마다 전부 범인을 찍음 */
    sharpEye: guestCases > 0 && correct === guestCases ? 1 : 0,
    escapes,
    /** 범인일 때 한 표도 안 받고 달아남 */
    cleanEscapes: escapes > 0 && (t?.votesAgainstAsCulprit ?? 0) === 0 ? 1 : 0,
    caughtAsCulprit: t?.caughtAsCulprit ?? 0,
    checks: t?.checks ?? 0,
    /** 영상과 어긋난 칸을 찾아낸 센서 대조 */
    hits: t?.hits ?? 0,
    testimonies: t?.testimonies ?? 0,
    /** 내 기억과 영상이 어긋나는 걸 본 사건 */
    witnessed: t?.witnessed ?? 0,
    /** 결백한데 받은 표 */
    framedVotes: t?.framedVotes ?? 0,
    fullHouse: won && view.seatCount === 6 ? 1 : 0,
    [`wins_${view.seatCount}p`]: won,
  };
}
