import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §11; 합치기 규칙: `max*`는 큰 값, 나머지는 더함).
 * songs = 친 곡 수, perfects/greats/goods/misses = 판정 수, maxCombo = 최대 콤보,
 * fullCombos = 미스 없이 끝낸 곡, roundWins = 곡 1등, pranksSent = 쏜 장난,
 * pranksBlocked = 게이지로 막은 장난, pranksTaken = 걸린 장난,
 * maxAcc = 한 곡 최고 정확도(%), maxScore = 한 판 총점.
 */
export function beatMayhemStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  return {
    songs: state.history.length,
    perfects: st.perfects,
    greats: st.greats,
    goods: st.goods,
    misses: st.misses,
    maxCombo: st.maxCombo,
    fullCombos: st.fullCombos,
    roundWins: st.roundWins,
    pranksSent: st.pranksSent,
    pranksBlocked: st.pranksBlocked,
    pranksTaken: st.pranksTaken,
    maxAcc: Math.round(st.bestAcc),
    maxScore: p.total,
  };
}
