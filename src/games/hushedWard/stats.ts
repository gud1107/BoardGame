import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, `min*`은 작은 값, 나머지는 더함).
 * escapes = 내가 탈출한 판, teamWins = 한 명이라도 탈출한 판, perfect = 전원 무사 탈출(S), soloEscapes = 혼자 한 판 탈출,
 * searches = 뒤진 서랍, talFound/talPlaced = 찾은/붙인 봉인 부적, revives = 일으킨 동료, downs = 붙잡힌 횟수,
 * bottles = 던진 약병, pills = 먹은 진정제, hushOk = 들키지 않고 넘긴 종, hunted = 쫓긴 횟수,
 * charmsBurnt = 타 버린 수호 부적, cleanEscapes = 한 번도 안 붙잡히고 탈출, nightmareEscapes = 악몽 난이도 탈출,
 * maxFear = 최고 공포, minEscapeSec = 가장 빠른 탈출(초).
 */
export function hushedWardStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const escaped = p.st === "escaped" ? 1 : 0;
  const o = state.outcome;
  const out: Record<string, number> = {
    escapes: escaped,
    teamWins: o?.win ? 1 : 0,
    perfect: o?.grade === "S" ? 1 : 0,
    soloEscapes: escaped && state.seatCount === 1 ? 1 : 0,
    searches: st.searches,
    talFound: st.talFound,
    talPlaced: st.talPlaced,
    revives: st.revives,
    downs: st.downs,
    bottles: st.bottles,
    pills: st.pills,
    hushOk: st.hushOk,
    hunted: st.hunted,
    charmsBurnt: st.charmsBurnt,
    cleanEscapes: escaped && st.downs === 0 && st.charmsBurnt === 0 ? 1 : 0,
    nightmareEscapes: escaped && state.options.difficulty === "nightmare" ? 1 : 0,
    maxFear: st.maxFear,
  };
  if (escaped) out.minEscapeSec = Math.round(state.t / 1000);
  return out;
}
