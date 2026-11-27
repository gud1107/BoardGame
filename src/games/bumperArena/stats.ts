import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, 나머지는 더함).
 * kos = 내가 떨어뜨린 수, falls = 내가 떨어진 수, selfFalls = 아무도 안 밀었는데 떨어짐,
 * roundWins = 라운드 1등, draws = 시간 종료·동시 추락 무승부, dashHits = 대시로 세게 박기,
 * pounds = 착지 충격파로 민 사람 수, gusts = 유령 입김으로 민 사람 수, items = 주운 아이템,
 * shieldBlocks = 방패로 막음, postBounces = 범퍼 기둥에 튕김, maxKosRound = 한 라운드 최다 KO,
 * maxHeatWin = 라운드를 이겼을 때 열기 % 최고, cleanWins = 열기 20% 미만으로 라운드 승리,
 * maxScore = 한 판 최고 점수.
 */
export function bumperArenaStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  return {
    rounds: state.history.length,
    kos: st.kos,
    falls: st.falls,
    selfFalls: st.selfFalls,
    roundWins: st.roundWins,
    draws: st.draws,
    dashHits: st.dashHits,
    pounds: st.pounds,
    gusts: st.gusts,
    items: st.items,
    shieldBlocks: st.shieldBlocks,
    postBounces: st.postBounces,
    maxKosRound: st.maxKosRound,
    maxHeatWin: st.maxHeatWin,
    cleanWins: st.cleanWins,
    maxScore: p.score,
  };
}
