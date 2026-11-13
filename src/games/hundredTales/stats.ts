import { tallyOf } from "@/games/shared/statTally";
import type { Seat, TalesState } from "./engine";

/**
 * Per-match detail stats (rulebook §10; `max*` keeps the highest, others
 * sum): told = 들려준 괴담, banked = 모은 점수, stories = 무사히 마친 이야기,
 * maxStory = 한 번에 최고 점수, maxChain = 한 번에 최대 장수, busts = 씌임,
 * lostToBust, perfects = 다섯 귀신, curses = 백 번째 이야기, saltSaves,
 * relit, mirrors, snuffed = 끈 촛불, timeouts, maxScore = 최종 점수(0 이상).
 */
export function hundredTalesStatDetails(state: TalesState, seat: Seat): Record<string, number> {
  const t = tallyOf(state.statTally, seat);
  const keys = ["told", "banked", "stories", "maxStory", "maxChain", "busts", "lostToBust", "perfects", "curses", "saltSaves", "relit", "mirrors", "snuffed", "timeouts"];
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = t[k] ?? 0;
  out.maxScore = Math.max(0, state.scores[seat] ?? 0);
  return out;
}
