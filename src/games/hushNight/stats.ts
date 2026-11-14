import { tallyOf } from "@/games/shared/statTally";
import type { NightState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §10; `max*` keeps the highest, others
 * sum): picked = 주운 열쇠, banked = 지하실로 가져간 열쇠, escapes = 지하실
 * 문에 넣은 횟수, maxBank = 한 번에 가져간 최대, caught / dropped = 잡힘·떨어뜨린
 * 열쇠, hushes / walks / runs / throws, lured = 내 돌로 괴물을 끈 횟수,
 * maxScore = 최종 점수(가져간 열쇠).
 */
export function hushNightStatDetails(state: NightState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const keys = ["picked", "banked", "escapes", "maxBank", "caught", "dropped", "hushes", "walks", "runs", "throws", "lured"];
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = t[k] ?? 0;
  out.maxScore = state.seats[seat]?.banked ?? 0;
  return out;
}
