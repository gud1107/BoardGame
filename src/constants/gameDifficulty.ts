/**
 * Editorial "체감 난이도" (1~5 star) rating for the desktop dashboard's
 * enlarged game showcase cards (see `GameShowcaseCard.tsx`).
 *
 * `GameMeta` (src/games/types.ts) has no difficulty field at all — this is
 * NOT derived from any real gameplay data or player stats, it's a one-time
 * hand-assigned judgment call per game (rules complexity / decision depth),
 * added because the 2026-09-12 desktop grid-overhaul request explicitly
 * asked for a difficulty badge and confirmed (AskUserQuestion) that
 * inventing this rating is acceptable here — unlike e.g. `LobbyProfileCard`
 * (since removed) which deliberately did NOT invent a win-rate/rating field
 * because no such data exists anywhere in the app.
 *
 * Only covers the 28 `playable: true` games; a "준비중" game has no rating
 * (nothing to judge yet) — `getGameDifficulty` returns `null` for any id
 * not listed here rather than a fabricated default.
 */
export const GAME_DIFFICULTY: Record<string, 1 | 2 | 3 | 4 | 5> = {
  "hanamikoji": 2,
  "splendor": 2,
  "avalon": 3,
  "bang": 3,
  "grid-poker": 3,
  "no-thanks": 1,
  "perudo": 2,
  "century": 3,
  "spot-difference": 1,
  "five-cucumbers": 2,
  "las-vegas": 2,
  "dalmuti": 2,
  "summoners-rift": 4,
  "coyote": 2,
  "love-letter": 1,
  "for-sale": 2,
  "mal-dalli-ja": 1,
  "pieces-of-language": 2,
  "coup": 2,
  "destiny-war-39": 4,
  "show-me-the-coin": 3,
  "love-wins-all": 3,
  "worm": 2,
  "lost-cities": 3,
  "rat-a-tat-cat": 2,
  "mine-of-oblivion": 3,
  "mine-of-oblivion-2": 4,
  "hill-of-truth": 3,
};

export function getGameDifficulty(gameId: string): 1 | 2 | 3 | 4 | 5 | null {
  return GAME_DIFFICULTY[gameId] ?? null;
}
