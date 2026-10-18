import type { GameId } from "@/games/types";

/**
 * Games with a real in-game capture under `public/posters/<id>.webp`
 * (480×600, captured 2026-10-19 by driving each game with bots in a headless
 * browser). Listed explicitly so a game without one falls straight back to
 * the generated emoji poster instead of a broken image request. Games whose
 * opening screen is mostly text or a dark role-reveal (마피아, 아발론, 갓생…)
 * are left out on purpose — the generated poster sells them better. To refresh a
 * capture, overwrite its file; to add one, drop the file and add the id here.
 */
const POSTER_IDS: ReadonlySet<GameId> = new Set<GameId>([
  "alkkagi",
  "bang",
  "bluff-roulette",
  "century",
  "chess",
  "city-chase",
  "coup",
  "coyote",
  "crab-survival",
  "curling",
  "five-cucumbers",
  "for-sale",
  "hanamikoji",
  "hungry-shark",
  "ink-duel",
  "las-vegas",
  "liar-game",
  "lost-cities",
  "lotr-duel",
  "love-letter",
  "love-wins-all",
  "mal-dalli-ja",
  "no-thanks",
  "perudo",
  "rat-a-tat-cat",
  "show-me-the-coin",
  "splendor",
  "splendor-duel",
  "spot-difference",
  "summoners-rift",
  "wobble-tower",
  "word-tower",
]);

export function getPosterImage(gameId: GameId): string | null {
  return POSTER_IDS.has(gameId) ? `/posters/${gameId}.webp` : null;
}
