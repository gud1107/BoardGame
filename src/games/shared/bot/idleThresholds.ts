/**
 * How long the current actor may sit on a turn before the room is offered a
 * "봇으로 바꿀까요?" (idle) takeover vote. One table for every game so the
 * numbers are tuned in one place instead of a copy of `45_000` per *Game.tsx.
 *
 *  - quick:    single short decision per turn (bid/pass, play a card, call). 45s
 *              is already several times a normal turn.
 *  - strategy: turns where reading the board is the game (Splendor Duel,
 *              Century, Lost Cities, Star Rummy's table rearranging, Avalon's
 *              team pick after discussion). 45s fired votes on players who were
 *              simply thinking.
 *  - deep:     chess-style analysis.
 */
export const IDLE_VOTE_MS = {
  quick: 45_000,
  strategy: 120_000,
  deep: 180_000,
} as const;
