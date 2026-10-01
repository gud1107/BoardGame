import type { GameSelfResult } from "@/games/types";

/**
 * Builds `GameCompletionResult.self` from the usual `computeRankings()`
 * output. `takeovers` is `botTakeover.takeovers` (keyed by seat string) for
 * games that support mid-game bot takeover.
 */
export function selfResult(
  mySeat: number | null,
  rankings: readonly { seat: number; rank: number }[],
  takeovers?: Readonly<Record<string, unknown>>,
): GameSelfResult | undefined {
  if (mySeat === null) return undefined;
  const mine = rankings.find((r) => r.seat === mySeat);
  if (!mine) return undefined;
  return {
    rank: mine.rank,
    playerCount: rankings.length,
    botPlayed: !!takeovers && Object.prototype.hasOwnProperty.call(takeovers, String(mySeat)),
  };
}
