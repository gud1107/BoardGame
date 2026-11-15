import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §11; 합치기 규칙: `max*`는 큰 값, 나머지는 더함).
 * summits = 완등한 판, stars3 = ⭐⭐⭐로 끝낸 판, leadM = 선등한 높이, haulM = 끌어올린 거리,
 * catches = 줄로 받아낸 횟수, saved = 줄 덕에 산 횟수, stars = 주운 별, slips = 손 놓침,
 * rockHits = 낙석에 맞음, falls = 팀 추락, hangSec = 줄에 매달려 있던 시간,
 * maxAlt = 한 판 최고 높이(m), maxPts = 한 판 기여 점수, volcano = 불티 화산 완등.
 */
export function ropeClimbStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  return {
    summits: state.cleared ? 1 : 0,
    stars3: state.grade >= 3 ? 1 : 0,
    volcano: state.cleared && state.options.course === "volcano" ? 1 : 0,
    leadM: Math.round(st.leadM),
    haulM: Math.round(st.haulM),
    catches: st.catches,
    saved: st.saved,
    stars: st.stars,
    slips: st.slips,
    rockHits: st.rockHits,
    falls: state.falls,
    hangSec: Math.round(st.hangMs / 1000),
    maxAlt: state.alt,
    maxPts: p.pts,
  };
}
