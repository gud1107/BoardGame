import { tallyOf } from "@/games/shared/statTally";
import type { CargoState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §13; merge rule: `max*` keeps the
 * highest, others sum). placed / points = 실은 수·실어서 얻은 점수,
 * maxTier = 최고 층, maxPlace = 한 번에 최고 점수, spills = 내 차례에
 * 떨어뜨린 수, lost = 내 컨테이너 잃은 수(쏠림+출항), stormLost = 출항
 * 때 잃은 수, capsizes, ballasts, crushes = 유리 깨뜨림, fragileSaved =
 * 유리 배달, golds / steel = 💎·⚙️ 실음, passes, timeouts, cleanVoyages =
 * 하나도 안 잃은 항해, voyages, maxVoyage = 한 항해 최고 득점, maxScore =
 * 게임 최종 점수(음수면 0).
 */
export function cargoStackStatDetails(state: CargoState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const keys = ["placed", "points", "maxTier", "maxPlace", "spills", "lost", "stormLost", "capsizes", "ballasts", "crushes", "fragileSaved", "golds", "steel", "passes", "timeouts", "cleanVoyages", "voyages", "maxVoyage"];
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = t[k] ?? 0;
  out.maxScore = Math.max(0, state.scores[seat] ?? 0);
  return out;
}
