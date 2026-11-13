import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, 나머지는 더함).
 * kos = 내가 빠뜨린 수, falls = 내가 빠진 수, selfFalls = 아무도 안 밀었는데 빠짐,
 * roundWins = 라운드 1등, podiums = 라운드 3등 안, stomps = 내려찍기 횟수, stompHits = 내려찍기로
 * 밀친 사람 수, tilesBroken = 내 내려찍기로 깬 얼음, jumps, items = 주운 아이템, fish = 🐟,
 * frosts = ❄️, votes = 내 표로 정해진 해빙, voteHits = 그 해빙으로 빠진 사람, maxKosRound = 한 라운드
 * 최다 KO, surviveSec = 버틴 시간 합(초), maxSurviveSec = 한 라운드 최장 버티기(초), maxScore = 한 판 점수.
 */
export function thinIceStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  return {
    rounds: state.history.length,
    kos: st.kos,
    falls: st.falls,
    selfFalls: st.selfFalls,
    roundWins: st.roundWins,
    podiums: st.podiums,
    stomps: st.stomps,
    stompHits: st.stompHits,
    tilesBroken: st.tilesBroken,
    jumps: st.jumps,
    items: st.items,
    fish: st.fish,
    frosts: st.frosts,
    votes: st.votes,
    voteHits: st.voteHits,
    maxKosRound: st.maxKosRound,
    surviveSec: Math.round(st.surviveMs / 1000),
    maxSurviveSec: Math.round(st.bestSurviveMs / 1000),
    maxScore: p.score,
  };
}
