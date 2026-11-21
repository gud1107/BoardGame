import { isBomb, isTeam, type MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`·`best*`는 큰 값, 나머지는 더함).
 * score = 최종 점수, maxScore = 한 판 최고 점수, depositValue/deposits = 바구니에 넣은 값/개수,
 * picks = 바닥 줍기, snatches/snatchedValue = 가로채기 횟수/값, lost/lostValue = 당한 횟수/값,
 * bestRun/bestRunToys = 한 번에 넣은 최고 값/개수, socks·ducks·robots·gifts·trophies = 종류별로 넣은 개수,
 * setBonus = 세트 보너스 점수, saleBonus = 타임세일 덤, goalsWon = 🎖 목표 달성, cuts = ✂️ 줄 끊기,
 * passes = 🤝 넘겨주기, loots/looted = 마감 세일 털기/털림, dashes/dashHits, maxChain = 가장 긴 줄,
 * wastedValue = 끝날 때 줄에 남은 값, bombPasses/bombBooms = 💣 떠넘기기/터짐,
 * wins = 1등(팀전은 이긴 팀), teamWins = 팀전 승, bombWins = 폭탄 세일 1등.
 */
export function findersKeepersStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const win = state.ranks?.[seat] === 1 ? 1 : 0;
  return {
    score: Math.round(p.score),
    maxScore: Math.round(p.score),
    depositValue: st.depositValue,
    deposits: st.deposits,
    picks: st.picks,
    snatches: st.snatches,
    snatchedValue: st.snatchedValue,
    lost: st.lost,
    lostValue: st.lostValue,
    bestRun: st.bestRun,
    bestRunToys: st.bestRunToys,
    socks: st.socks,
    ducks: st.ducks,
    robots: st.robots,
    gifts: st.gifts,
    trophies: st.trophies,
    setBonus: st.setBonus,
    saleBonus: st.saleBonus,
    goalsWon: st.goalsWon,
    cuts: st.cuts,
    passes: st.passes,
    loots: st.loots,
    looted: st.looted,
    dashes: st.dashes,
    dashHits: st.dashHits,
    maxChain: st.maxChain,
    wastedValue: st.wastedValue,
    maxWasted: st.wastedValue,
    bombPasses: st.bombPasses,
    bombBooms: st.bombBooms,
    wins: win,
    teamWins: isTeam(state) && win && state.winnerTeam >= 0 ? 1 : 0,
    bombWins: isBomb(state) ? win : 0,
  };
}
