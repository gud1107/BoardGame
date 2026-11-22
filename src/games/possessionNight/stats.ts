import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, `min*`은 작은 값, 나머지는 더함).
 * 공통: wins = 내 편이 이긴 판, hunterGames/ghostGames = 그 역할로 한 판, hunterWins/ghostWins = 그 역할로 이긴 판.
 * 🧿 퇴마사: searches 뒤진 곳, cursesFound 찾은 물건, burned 태운 물건, revives 퇴마해 준 동료, possessed 빙의당함,
 * waters/waterHits 뿌린 성수/맞힌 성수, teas 청심환, lanterns 켠 등잔, panics 공황, ritualSec 의식 곁에 선 시간,
 * cleanWins = 한 번도 빙의 안 당하고 이긴 판.
 * 👻 원귀: whispers·slams·snuffs·manifests·possessions·quenches 쓴 힘, hits 성수에 맞음,
 * maxSouls = 한 판 최다 빙의, minWinSec = 가장 빠른 승리(초).
 */
export function possessionNightStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const o = state.outcome;
  const won = !!o && o.winner === p.role;
  const out: Record<string, number> = { wins: won ? 1 : 0 };
  if (p.role === "hunter") {
    const h = p.hunter;
    Object.assign(out, {
      hunterGames: 1,
      hunterWins: won ? 1 : 0,
      searches: h.searches,
      cursesFound: h.cursesFound,
      burned: h.burned,
      revives: h.revives,
      possessed: h.possessed,
      waters: h.waters,
      waterHits: h.waterHits,
      teas: h.teas,
      lanterns: h.lanterns,
      panics: h.panics,
      ritualSec: Math.round(h.ritualSec),
      cleanWins: won && h.possessed === 0 ? 1 : 0,
    });
  } else {
    const g = p.ghost;
    Object.assign(out, {
      ghostGames: 1,
      ghostWins: won ? 1 : 0,
      whispers: g.whispers,
      slams: g.slams,
      snuffs: g.snuffs,
      manifests: g.manifests,
      possessions: g.possessions,
      quenches: g.quenches,
      hits: g.hits,
      maxSouls: g.possessions,
    });
  }
  if (won && o) out.minWinSec = Math.round(o.tMs / 1000);
  return out;
}
