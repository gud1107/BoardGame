import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, `min*`은 작은 값, 나머지는 더함).
 * minLapCs = 가장 빠른 랩(센티초, 작을수록 좋음 — 기록이 없으면 키를 빼서 0이 최고 기록이 되지 않게),
 * maxPoints = 그랑프리 한 판 최고 점수.
 * wins = 1등(그랑프리는 종합 1등), raceWins = 레이스 1등 횟수, podiums = 3등 안, gpWins = 그랑프리 우승,
 * passes = 추월, items = 아이템 사용, hits = 내 아이템으로 빙글 돌린 차, spun = 내가 빙글, blocked = 방패로 막음,
 * driftBoosts / bigDrifts = 드리프트 부스트(2단), rockets / stalls = 출발 부스트 성공 / 시동 꺼짐,
 * jumps / perfectLands, toyDrops / toyHits = 꼴찌 장난감 던짐 / 선두가 박음, crashes, walls, resets, boxes.
 */
export function toyRaceStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const rank = state.ranks?.[seat] ?? 0;
  const gp = state.races > 1;
  const out: Record<string, number> = {
    wins: rank === 1 ? 1 : 0,
    podiums: rank > 0 && rank <= 3 ? 1 : 0,
    gpWins: gp && rank === 1 ? 1 : 0,
    raceWins: st.raceWins,
    races: p.raceRanks.length,
    passes: st.passes,
    items: st.items,
    hits: st.hits,
    spun: st.spun,
    blocked: st.blocked,
    driftBoosts: st.driftBoosts,
    bigDrifts: st.bigDrifts,
    rockets: st.rockets,
    stalls: st.stalls,
    jumps: st.jumps,
    perfectLands: st.perfectLands,
    toyDrops: st.toyDrops,
    toyHits: st.toyHits,
    crashes: st.crashes,
    walls: st.walls,
    resets: st.resets,
    boxes: st.boxes,
    maxPoints: gp ? p.points : 0,
  };
  if (st.bestLapMs > 0) out.minLapCs = Math.round(st.bestLapMs / 10);
  return out;
}
