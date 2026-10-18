/**
 * Which card design the 보드게임허브 lobby grid uses (mobile/tablet
 * `GameGrid.tsx` and the desktop `DesktopDashboard.tsx` alike).
 *
 * - `"poster"` (2026-10-19 개편): full-bleed movie-poster cards
 *   (`GamePosterCard.tsx`) — a real in-game capture from `/posters/`, big
 *   title and a one-line hook (`posterTaglines.ts`).
 * - `"classic"`: the previous cards (`GameCard.tsx` / `GameShowcaseCard.tsx`),
 *   kept untouched so switching back is this one word. The commit before the
 *   개편 is also tagged `backup/lobby-cards-classic`.
 */
export type LobbyCardStyle = "poster" | "classic";

export const LOBBY_CARD_STYLE: LobbyCardStyle = "poster";
