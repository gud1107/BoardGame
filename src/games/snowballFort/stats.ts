import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, 나머지는 더함).
 * matchWins = 이긴 판(팀 승리), roundWins = 이긴 라운드, hits = 맞힌 눈덩이, freezes = 얼린 사람,
 * frozen = 내가 얼음, snowmanHits = 상대 눈사람 맞힘, finishers = 눈사람 마무리, walls = 세운 벽,
 * wallBreaks = 부순 상대 벽, gathered = 뭉친 눈덩이, items = 주운 아이템, lobHits = 포물선 명중,
 * dodges = 봇 구르기(사람은 0), throws = 던진 수, maxPoints = 한 판 기여 점수, mvps = 라운드 MVP.
 */
export function snowballStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  return {
    rounds: state.history.length,
    matchWins: state.winnerTeam === p.team ? 1 : 0,
    roundWins: st.roundWins,
    throws: st.throws,
    hits: st.hits,
    freezes: st.freezes,
    frozen: st.frozen,
    snowmanHits: st.snowmanHits,
    finishers: st.finishers,
    walls: st.walls,
    wallBreaks: st.wallBreaks,
    gathered: st.gathered,
    items: st.items,
    lobHits: st.lobHits,
    maxPoints: p.points,
    mvps: state.history.filter((h) => h.mvp === seat).length,
    maxAccuracy: st.throws >= 5 ? Math.round((st.hits / st.throws) * 100) : 0,
  };
}
