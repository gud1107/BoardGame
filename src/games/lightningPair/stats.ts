import type { PairState } from "./engine";

/**
 * 기록 탭 details (src/lib/stats/details.ts 합치기 규칙: max* 큰 값, min* 작은 값, 나머지 합).
 * minRt는 맞힌 적이 있을 때만 넣는다 (0을 넣으면 최솟값이 0으로 굳는다).
 */
export function lightningPairDetails(s: PairState, seat: number, rank: number): Record<string, number> {
  const st = s.stats[seat];
  const out: Record<string, number> = {
    wins: rank === 1 ? 1 : 0,
    [s.mode === "grab" ? "grabWins" : "dumpWins"]: rank === 1 ? 1 : 0,
    claims: st.claims,
    rtSum: st.rtSum,
    swift: st.swift,
    wrong: st.wrong,
    close: st.close,
    goldens: st.goldens,
    cleanWins: rank === 1 && st.wrong === 0 ? 1 : 0,
    maxStreak: st.maxStreak,
    maxClaims: st.claims,
  };
  if (st.minRt > 0) out.minRt = st.minRt;
  return out;
}
