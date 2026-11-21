import { isCoop, starsFor, type MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`·`best*`는 큰 값, 나머지는 더함).
 * loads/loadValue = 실은 상자·점수, normals·fragiles·colds·heavies·expresses = 종류별, expressOnTime = ⚡ 시간 안,
 * heavyDuo = 🛋️ 둘이 들어 실음, shots = 🎯 던져 넣기, throws, catches/steals = 받기/가로채기, scans = 🔍,
 * fullTrucks = 🚚 가득 채움, breaks = 깨뜨림·녹임, dashes, knocks/knocked = ⚔️ 들이받기, forkHits = 🚜,
 * bestStreak = 연속 싣기, teamScore/maxTeamScore = 팀 점수, stars/maxStars/threeStars = ★,
 * coopClears = ★1 이상 근무, wins = 1등(협동은 ★1 이상), versusWins = 경쟁 1등.
 */
export function parcelPanicStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const coop = isCoop(state);
  const stars = coop ? starsFor(state) : 0;
  const win = state.ranks?.[seat] === 1 ? 1 : 0;
  return {
    score: Math.round(coop ? state.teamScore : p.score),
    loads: st.loads,
    loadValue: st.loadValue,
    normals: st.normals,
    fragiles: st.fragiles,
    colds: st.colds,
    heavies: st.heavies,
    expresses: st.expresses,
    expressOnTime: st.expressOnTime,
    heavyDuo: st.heavyDuo,
    shots: st.shots,
    throws: st.throws,
    catches: st.catches,
    steals: st.steals,
    scans: st.scans,
    fullTrucks: st.fullTrucks,
    breaks: st.breaks,
    dashes: st.dashes,
    knocks: st.knocks,
    knocked: st.knocked,
    forkHits: st.forkHits,
    bestStreak: st.bestStreak,
    teamScore: coop ? Math.round(state.teamScore) : 0,
    maxTeamScore: coop ? Math.round(state.teamScore) : 0,
    stars,
    maxStars: stars,
    threeStars: stars >= 3 ? 1 : 0,
    coopClears: coop && stars >= 1 ? 1 : 0,
    wins: win,
    versusWins: coop ? 0 : win,
  };
}
