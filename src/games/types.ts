/**
 * Core contracts for the game catalog. Every board game in this project —
 * whether fully implemented or just listed as "coming soon" — is described
 * by a `GameMeta` entry in the registry. This is what lets the dashboard
 * scale from 1 game to 100 without touching UI code.
 */

export type GameId = string;

export type GameCategory =
  | "card"
  | "party"
  | "strategy"
  | "worker-placement"
  | "deduction"
  | "family";

/**
 * "Feel" genres shown on the dashboard for browsing — a separate axis from
 * `GameCategory` above (which is closer to "game format"/structure and isn't
 * actually surfaced in the UI). A game can belong to more than one genre
 * (e.g. Perudo is both bluffing and luck), so this is an array. See
 * `src/games/genres.ts` for the label/emoji/accent shown for each value.
 */
export type GameGenre = "strategy" | "bluffing" | "luck" | "party" | "family";

/**
 * Groups a handful of games into a named, cross-catalog collection shown as
 * its own featured row on the dashboard (e.g. games that all appeared in
 * Netflix's <데스게임> show) — independent of both `category` and `genres`.
 * See `src/games/collections.ts` for the label/description per id.
 */
export type GameCollectionId = "netflix-death-game";

export interface PlayerRange {
  min: number;
  max: number;
}

export interface PlayTime {
  minMinutes: number;
  maxMinutes: number;
}

/**
 * The ranking a finished game produced for one participant, used to feed
 * the betting ledger. `rank` is 1-based (1 = winner).
 */
export interface GameRankingEntry {
  playerId: string;
  rank: number;
}

export interface GameCompletionResult {
  rankings: GameRankingEntry[];
  finishedAt: string;
}

/**
 * Static metadata shown on the dashboard card + detail page.
 */
export interface GameMeta {
  id: GameId;
  name: string;
  nameEn?: string;
  description: string;
  players: PlayerRange;
  playTime: PlayTime;
  category: GameCategory;
  /**
   * Thumbnail shown on the dashboard card + detail page header. `emoji` +
   * `gradient` are always present and drive a generated (no external asset)
   * card visual for every "준비중" placeholder title — this is what lets the
   * catalog scale to dozens of not-yet-built games without needing box art
   * for each one. `image` is an optional real box-cover photo (see
   * `public/games/`) that, when present, takes over the card visual instead
   * (see `GameThumbnail.tsx`); `emoji`/`gradient` still stay filled in as
   * the fallback for any spot that can't render an `<img>` (or if the photo
   * fails to load).
   */
  thumbnail: {
    emoji: string;
    gradient: [string, string];
    /** Path under `public/`, e.g. `/games/perudo.jpg`. */
    image?: string;
  };
  tags?: string[];
  /**
   * "Feel" genres for dashboard browsing (see `GameGenre` above). Optional —
   * the older placeholder entries predate this field and just don't show up
   * in any genre section, which is fine (they still show in the flat "전체"
   * grid via search/player-count filters).
   */
  genres?: GameGenre[];
  /**
   * Named cross-catalog collection this game belongs to (see
   * `GameCollectionId` above), e.g. the Netflix <데스게임> series. Optional.
   */
  collectionId?: GameCollectionId;
  /**
   * Whether this game has a real, playable implementation registered in
   * `playableGames` below. Everything else renders as "준비중" (coming soon)
   * on the dashboard — this is how we demonstrate the catalog scaling to
   * dozens of titles without needing dozens of finished engines.
   */
  playable: boolean;
  /**
   * Whether the game engine can automatically compute a final ranking
   * (e.g. a clear winner/loser) to feed the betting system. If false, the
   * player must enter final standings manually after playing.
   */
  supportsAutoRanking: boolean;
  /**
   * True for games that run as an online room (each participant on their
   * own device, synced via Supabase Realtime) instead of local pass-and-play.
   * When true, `/games/[gameId]` skips its own participant-selection step —
   * the game component runs its own room create/join lobby and determines
   * participant identity itself.
   */
  onlineMultiplayer?: boolean;
}

/**
 * Contract every playable game's React entry component must satisfy.
 * `participantIds`/`participantNames` are the subset of the active betting
 * roster (or ad-hoc local players) assigned to this play session.
 */
export interface PlayableGameProps {
  participants: { id: string; name: string }[];
  onComplete: (result: GameCompletionResult) => void;
}
