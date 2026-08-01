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
  /** Thumbnail accent used to render a generated (no external asset) card visual. */
  thumbnail: {
    emoji: string;
    gradient: [string, string];
  };
  tags?: string[];
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
