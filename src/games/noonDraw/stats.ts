import type { NoonState } from "./engine";

/**
 * 기록 탭 details (src/lib/stats/details.ts 합치기 규칙: max* 큰 값, min* 작은 값, 나머지 합).
 * minRt는 정상 발도가 한 번이라도 있을 때만 넣는다 (0을 넣으면 최솟값이 0으로 굳는다).
 */
export function noonDrawDetails(s: NoonState, seat: number, rank: number): Record<string, number> {
  const st = s.stats[seat];
  const out: Record<string, number> = {
    wins: rank === 1 ? 1 : 0,
    bouts: st.bouts,
    valid: st.valid,
    rtSum: st.rtSum,
    early: st.early,
    misses: st.misses,
    swift: st.swift,
    boutWins: st.boutWins,
    matchWins: st.matchWins,
    feintsResisted: st.feintsResisted,
    predictions: st.predictions,
    predictHits: st.predictHits,
    [s.mode === "brawl" ? "brawlWins" : "tournamentWins"]: rank === 1 ? 1 : 0,
    cleanWins: rank === 1 && st.early === 0 ? 1 : 0,
    maxBoutWins: st.boutWins,
  };
  if (st.minRt > 0) out.minRt = st.minRt;
  return out;
}
