import type { GameId } from "@/games/types";

/**
 * Games with a real in-game capture under `public/posters/<id>.webp`
 * (480×600, captured 2026-10-19 by driving each game with bots in a headless
 * browser). Listed explicitly so a game without one falls straight back to
 * the generated emoji poster instead of a broken image request. The 17 games
 * first left out (opening screen mostly text / a dark role-reveal: 마피아,
 * 아발론, 여관 난투, 텔레파시…) got a still on 2026-10-21 from a mid-game moment
 * of their hover-clip recording (`stillAt` in scripts/poster-videos/
 * highlights.json), so the still and the clip show the same scene. To refresh
 * a capture, overwrite its file; to add one, drop the file and add the id here.
 */
const POSTER_IDS: ReadonlySet<GameId> = new Set<GameId>([
  "alkkagi",
  "avalon",
  "bang",
  "bluff-roulette",
  "century",
  "chess",
  "city-chase",
  "coup",
  "coyote",
  "crab-survival",
  "curling",
  "dalmuti",
  "destiny-war-39",
  "doodle-phone",
  "five-cucumbers",
  "for-sale",
  "god-life-planner",
  "great-legacy",
  "grid-poker",
  "hanamikoji",
  "hill-of-truth",
  "hungry-shark",
  "ink-duel",
  "las-vegas",
  "liar-game",
  "lost-cities",
  "lotr-duel",
  "love-letter",
  "love-wins-all",
  "mafia",
  "mal-dalli-ja",
  "memory-feast",
  "merge-defense",
  "mine-of-oblivion",
  "mine-of-oblivion-2",
  "no-thanks",
  "perudo",
  "pieces-of-language",
  "rat-a-tat-cat",
  "show-me-the-coin",
  "splendor",
  "splendor-duel",
  "spot-difference",
  "summoners-rift",
  "tavern-brawl",
  "telepathy",
  "wobble-tower",
  "word-tower",
  "worm",
]);

export function getPosterImage(gameId: GameId): string | null {
  return POSTER_IDS.has(gameId) ? `/posters/${gameId}.webp` : null;
}
