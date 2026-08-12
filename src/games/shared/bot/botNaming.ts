/**
 * Shared "AI 봇 N" labeling for every game's lobby. Bots are numbered by
 * their position in the host-broadcast seat roster (see
 * `<Game>Game.tsx`'s `botSeats` list) — since every client receives the
 * identical roster array, sorting it the same way (numeric/definition
 * order) before indexing gives every client the same labels without any
 * extra sync field.
 */
export const BOT_BADGE = "🤖";

export function botLabel(indexWithinRoster: number): string {
  return `AI 봇 ${indexWithinRoster + 1}`;
}

export function botDisplayName(indexWithinRoster: number): string {
  return `${BOT_BADGE} ${botLabel(indexWithinRoster)}`;
}
