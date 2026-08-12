/**
 * Shared Level 1–10 AI difficulty curve, reused by every game's
 * `chooseBotAction(state, seat, level, rng?)` (ARCHITECTURE.md §7.1).
 *
 * Design: each game still scores its own candidate moves with its own
 * heuristic (`scoreMove`) — this module does NOT know anything about any
 * particular game's rules. What it standardizes is the ONE curve that turns
 * "a list of scored candidates" into "the move a bot of level N actually
 * plays": how often it ignores its own best score and picks something worse
 * (mistake rate), and how pickily it insists on the single best score among
 * near-ties (epsilon). Both shrink monotonically from level 1 to level 10,
 * so "look how much smarter level 10 is than level 1" is driven by one
 * tunable table instead of five bespoke ones per game.
 *
 * Tiers (per the work order):
 *  - novice   (1–3): mostly-random legal moves, frequent "mistakes".
 *  - core     (4–7): heuristic-driven, shrinking noise.
 *  - expert   (8–10): (near-)always the top-scored move under each game's
 *    richest heuristic — games route level>=8 through a deeper scoreMove
 *    variant (opponent-info-aware EV, lookahead, etc.) themselves; this
 *    module just makes sure that once you compute a best score, an expert
 *    bot actually plays it instead of getting randomly overridden.
 */

export type BotLevel = number; // integer 1..10, see clampBotLevel

export const MIN_BOT_LEVEL = 1;
export const MAX_BOT_LEVEL = 10;
export const DEFAULT_BOT_LEVEL: BotLevel = 5;
export const BOT_LEVELS: readonly BotLevel[] = Array.from(
  { length: MAX_BOT_LEVEL - MIN_BOT_LEVEL + 1 },
  (_, i) => i + MIN_BOT_LEVEL,
);

export function clampBotLevel(level: number): BotLevel {
  if (!Number.isFinite(level)) return DEFAULT_BOT_LEVEL;
  return Math.min(MAX_BOT_LEVEL, Math.max(MIN_BOT_LEVEL, Math.round(level)));
}

export type BotTier = "novice" | "core" | "expert";

export function botTier(level: BotLevel): BotTier {
  const l = clampBotLevel(level);
  if (l <= 3) return "novice";
  if (l <= 7) return "core";
  return "expert";
}

/** Probability a bot of this level ignores its computed scores entirely and plays a uniformly random legal move ("실수"). */
const RANDOM_MOVE_CHANCE: Record<BotLevel, number> = {
  1: 0.55, 2: 0.42, 3: 0.3,
  4: 0.18, 5: 0.12, 6: 0.08, 7: 0.04,
  8: 0, 9: 0, 10: 0,
};

/** Relative score margin (as a fraction of the best score's magnitude) within which candidates are treated as "tied" and picked among by rng — wider for weaker levels, so they don't always find the exact peak even when not making an outright mistake. */
const TIE_MARGIN_FRACTION: Record<BotLevel, number> = {
  1: 0.5, 2: 0.38, 3: 0.28,
  4: 0.2, 5: 0.14, 6: 0.09, 7: 0.05,
  8: 0.02, 9: 0.01, 10: 0,
};

export function randomMoveChance(level: BotLevel): number {
  return RANDOM_MOVE_CHANCE[clampBotLevel(level)];
}

export function tieMarginFraction(level: BotLevel): number {
  return TIE_MARGIN_FRACTION[clampBotLevel(level)];
}

export interface ScoredCandidate<T> {
  move: T;
  score: number;
}

/**
 * Turns scored candidate moves into the single move a bot of `level` plays.
 * `candidates` must be non-empty (callers should already have bailed out to
 * `null` upstream when `getValidMoves` is empty).
 */
export function pickByLevel<T>(
  candidates: ReadonlyArray<ScoredCandidate<T>>,
  level: BotLevel,
  rng: () => number = Math.random,
): T {
  if (candidates.length === 1) return candidates[0].move;

  if (rng() < randomMoveChance(level)) {
    return candidates[Math.floor(rng() * candidates.length)].move;
  }

  const best = Math.max(...candidates.map((c) => c.score));
  const margin = tieMarginFraction(level) * Math.max(1, Math.abs(best));
  const top = candidates.filter((c) => c.score >= best - margin);
  return top[Math.floor(rng() * top.length)].move;
}
