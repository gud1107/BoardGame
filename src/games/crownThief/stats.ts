import { isCurse, isTeam, type MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`·`best*`는 큰 값, 나머지는 더함).
 * crownSec = 개인전·팀전에서 왕관을 쓴 점수(초, 황금 2배 포함), curseSec = 저주 모드 저주 점수(초),
 * steals = 뺏은 횟수(저주: 떠넘긴 횟수), lost = 뺏긴 횟수, pickups = 바닥 왕관 줍기,
 * dashes/dashHits = 돌진/돌진으로 박은 사람, roars/roarHits = 호령/밀친 사람, snares = 저주의 손길,
 * falls/selfFalls = 떨어짐/혼자 떨어짐, kos = 떨어뜨린 사람, kingKos = 떨어뜨린 왕, items, bananaHits,
 * slipped, padJumps, bestReignSec = 한 번에 가장 오래 쓴 시간, goldenSec = 황금 구간에 쓴 시간,
 * crownAtEnd = 끝날 때 왕관, wins = 1등(팀전은 이긴 팀), teamWins = 팀전 승, curseWins = 저주 모드 1등,
 * maxCrownSec = 한 판 최고 왕관 점수.
 */
export function crownThiefStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const win = state.ranks?.[seat] === 1 ? 1 : 0;
  const sec = Math.round(p.score / 1000);
  const curse = isCurse(state);
  return {
    crownSec: curse ? 0 : sec,
    maxCrownSec: curse ? 0 : sec,
    curseSec: curse ? sec : 0,
    steals: st.steals,
    lost: st.lost,
    pickups: st.pickups,
    dashes: st.dashes,
    dashHits: st.dashHits,
    roars: st.roars,
    roarHits: st.roarHits,
    snares: st.snares,
    falls: st.falls,
    selfFalls: st.selfFalls,
    kos: st.kos,
    kingKos: st.kingKos,
    items: st.items,
    bananaHits: st.bananaHits,
    slipped: st.slipped,
    padJumps: st.padJumps,
    bestReignSec: Math.round(st.bestReignMs / 1000),
    goldenSec: Math.round(st.goldenMs / 1000),
    crownAtEnd: st.crownAtEnd,
    wins: win,
    teamWins: isTeam(state) && win && state.winnerTeam >= 0 ? 1 : 0,
    curseWins: curse ? win : 0,
  };
}
