import type { GameSelfResult } from "@/games/types";

/**
 * Builds `GameCompletionResult.self` from the usual `computeRankings()`
 * output. `bots.takeovers` is `botTakeover.takeovers` (keyed by seat string)
 * for games that support mid-game bot takeover, `bots.botSeats` the lobby bot
 * seats. `details` adds game-specific stats (merge rules in
 * src/lib/stats/details.ts).
 */
export function selfResult(
  mySeat: number | null,
  rankings: readonly { seat: number; rank: number }[],
  bots: { takeovers?: Readonly<Record<string, unknown>>; botSeats?: readonly number[] } = {},
  details?: (seat: number, rank: number) => Record<string, number>,
): GameSelfResult | undefined {
  if (mySeat === null) return undefined;
  const mine = rankings.find((r) => r.seat === mySeat);
  if (!mine) return undefined;
  const takenOver = Object.keys(bots.takeovers ?? {}).map(Number);
  const botSeats = bots.botSeats ?? [];
  return {
    rank: mine.rank,
    playerCount: rankings.length,
    botPlayed: takenOver.includes(mySeat),
    withBots: rankings.some((r) => r.seat !== mySeat && (botSeats.includes(r.seat) || takenOver.includes(r.seat))),
    ...(details ? { details: details(mySeat, mine.rank) } : {}),
  };
}
