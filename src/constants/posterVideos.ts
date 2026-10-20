import type { GameId } from "@/games/types";

/**
 * Hover highlight clips for the poster lobby cards (2026-10-20, desktop only).
 * Pointing at a card swaps its still capture for a short silent loop of a
 * real bot game — a hand-picked moment per game (a capture, a stone falling
 * off the board, a checkmate…), see `scripts/poster-videos/highlights.json`.
 *
 * Files: `public/posters/<id>.webm` (VP9) + `<id>.mp4` (H.264 for Safari),
 * 480×600, a few seconds, no audio. Nothing is downloaded until the pointer
 * rests on a card (`preload="none"`), so the lobby's first load is unchanged.
 * Phones/tablets (no hover), `prefers-reduced-motion` and data-saver keep the
 * still image.
 *
 * Off switch: set `POSTER_HOVER_VIDEO` to false. To add or refresh a clip,
 * edit highlights.json, run `node scripts/poster-videos/encode.mjs <id>` and
 * `node scripts/poster-videos/check.mjs`, then list the id here.
 */
export const POSTER_HOVER_VIDEO = true;

const POSTER_VIDEO_IDS: ReadonlySet<GameId> = new Set<GameId>([
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

export const POSTER_VIDEO_ID_LIST: readonly GameId[] = [...POSTER_VIDEO_IDS];

export function getPosterVideo(gameId: GameId): { webm: string; mp4: string } | null {
  if (!POSTER_HOVER_VIDEO || !POSTER_VIDEO_IDS.has(gameId)) return null;
  return { webm: `/posters/${gameId}.webm`, mp4: `/posters/${gameId}.mp4` };
}
