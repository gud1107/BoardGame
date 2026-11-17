import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §10; 합치기 규칙: `max*`는 큰 값, `min*`은 작은 값, 나머지는 더함).
 * taggerGames/runnerGames = 술래/도망자로 한 판, taggerWins = 술래로 이긴 판, escapes = 내가 탈출한 판,
 * cleanEscapes = 한 번도 안 얼고 탈출, seals = 내가 손댄 채 끝난 봉인, thaws = 녹여 준 친구, frozen = 얼음이 된 횟수,
 * saltHits = 술래에게 맞힌 소금, unmasks = 변장한 술래를 소금으로 들춰낸 횟수, friendly = 친구에게 잘못 뿌린 소금,
 * catches = 술래로 얼린 횟수, sweeps = 술래로 아무도 못 나가게 한 판, kicks = 봉인 훼손,
 * minEscapeSec = 가장 빠른 탈출(초), maxCatches = 한 판 최다 얼림.
 */
export function taggerAmongUsStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const o = state.outcome;
  if (p.role === "tagger") {
    return {
      taggerGames: 1,
      taggerWins: o?.winner === "tagger" ? 1 : 0,
      sweeps: o && o.escaped === 0 ? 1 : 0,
      catches: st.catches,
      maxCatches: st.catches,
      kicks: st.kicks,
      masks: st.masks,
      stunned: st.stunned,
    };
  }
  const escaped = p.st === "escaped" ? 1 : 0;
  const out: Record<string, number> = {
    runnerGames: 1,
    escapes: escaped,
    cleanEscapes: escaped && st.frozen === 0 ? 1 : 0,
    seals: st.seals,
    thaws: st.thaws,
    frozen: st.frozen,
    salts: st.salts,
    saltHits: st.saltHits,
    unmasks: st.unmasks,
    friendly: st.friendly,
  };
  if (escaped) out.minEscapeSec = Math.round(state.t / 1000);
  return out;
}
