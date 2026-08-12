import type { BotLevel } from "./botDifficulty";

/**
 * Shared "AI 봇 N" labeling for every game's lobby. Bots are numbered by
 * their position in the host-broadcast seat roster (see
 * `<Game>Game.tsx`'s `botSeats` list) — since every client receives the
 * identical roster array, sorting it the same way (numeric/definition
 * order) before indexing gives every client the same labels without any
 * extra sync field.
 *
 * `level` is optional so the 4 pilot games (hanamikoji/no-thanks/perudo/
 * splendor), which don't yet have a difficulty system, keep their original
 * "🤖 AI 봇 N" label unchanged. Games that do carry a level (§7.5, "Level
 * 1–10 스마트 AI") pass it through and get "🤖 [Lv.N] AI 봇 N" instead.
 */
export const BOT_BADGE = "🤖";

export function botLabel(indexWithinRoster: number, level?: BotLevel): string {
  const base = `AI 봇 ${indexWithinRoster + 1}`;
  return level === undefined ? base : `[Lv.${level}] ${base}`;
}

export function botDisplayName(indexWithinRoster: number, level?: BotLevel): string {
  return `${BOT_BADGE} ${botLabel(indexWithinRoster, level)}`;
}
