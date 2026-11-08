import { tallyOf } from "@/games/shared/statTally";
import { parPlayed, totalOf, type MiniGolfState, type Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §13; merge rule: `max*` keeps the highest,
 * `min*` the lowest, others sum). holeInOnes / eagles / birdies / pars / bogeys =
 * 홀 결과, strokes = 친 타수(벌타 제외), falls = 섬 밖 추락, knockOffs = 남의
 * 공을 섬 밖으로, gifts = 남의 공을 넣어줌, jumps = 점프대 성공,
 * windmillPasses = 풍차 터널 통과, obstacleHoles = 장애물 홀에서 홀아웃,
 * picks = 장애물 고르기, pickups = 공 줍기(타수 한도), maxUnderPar = 한
 * 게임 최고 언더파(파보다 적게 친 타수, 오버파면 0 — 값은 음수가 될 수 없음),
 * min9 = 9홀 정식 게임 최소 타수(9홀 게임에서만 보냄 — `min*`은 낮은 값을 남김).
 */
export function miniGolfStatDetails(state: MiniGolfState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const total = totalOf(state, seat);
  return {
    holes: t.holes ?? 0,
    holeInOnes: t.holeInOnes ?? 0,
    eagles: t.eagles ?? 0,
    birdies: t.birdies ?? 0,
    pars: t.pars ?? 0,
    bogeys: t.bogeys ?? 0,
    strokes: t.strokes ?? 0,
    falls: t.falls ?? 0,
    knockOffs: t.knockOffs ?? 0,
    gifts: t.gifts ?? 0,
    jumps: t.jumps ?? 0,
    windmillPasses: t.windmillPasses ?? 0,
    obstacleHoles: t.obstacleHoles ?? 0,
    picks: t.picks ?? 0,
    pickups: t.pickups ?? 0,
    maxUnderPar: Math.max(0, parPlayed(state, seat) - total),
    ...(state.holes.length === 9 && state.phase === "ended" ? { min9: total } : {}),
  };
}
