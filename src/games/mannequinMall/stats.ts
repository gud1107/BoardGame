import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, `min*`은 작은 값, 나머지는 더함).
 * escapes = 내가 탈출한 판, teamWins = 한 명이라도 탈출한 판, perfect = 전원 무사 탈출(S), soloEscapes = 혼자 한 판 탈출,
 * searches = 뒤진 상자, fuseFound/fusePlaced = 찾은/꽂은 퓨즈, revives = 풀어 준 동료, downs = 붙잡힌 횟수,
 * flashes = 터뜨린 플래시, revealed = 플래시로 드러낸 마네킹, binds = 묶은 횟수, decoys = 묶어 보니 그냥 마네킹,
 * topples = 노려봐서 쓰러뜨림, saves = 동료 코앞의 마네킹을 멈춤, stareSec = 붙들어 둔 시간(초),
 * cleanEscapes = 한 번도 안 붙잡히고 탈출, nightmareEscapes = 악몽 탈출, maxStareSec = 한 판 최장 응시, minEscapeSec = 가장 빠른 탈출(초).
 */
export function mannequinMallStatDetails(state: MatchState, seat: number): Record<string, number> {
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
    fuseFound: st.fuseFound,
    fusePlaced: st.fusePlaced,
    revives: st.revives,
    downs: st.downs,
    flashes: st.flashes,
    revealed: st.revealed,
    binds: st.binds,
    decoys: st.decoys,
    topples: st.topples,
    saves: st.saves,
    stareSec: Math.round(st.stareSec),
    cleanEscapes: escaped && st.downs === 0 ? 1 : 0,
    nightmareEscapes: escaped && state.options.difficulty === "nightmare" ? 1 : 0,
    maxStareSec: Math.round(st.stareSec),
  };
  if (escaped) out.minEscapeSec = Math.round(state.t / 1000);
  return out;
}
