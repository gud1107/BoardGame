import type { GameMeta } from "@/games/types";
import { getGameDifficulty } from "./gameDifficulty";
import { getGameLastUpdated, getGameUpdateCount } from "./gameUpdateCount";

/**
 * Sort options for the lobby's game showcase grid — shared between the
 * mobile/tablet catalog (`src/app/page.tsx`) and the xl+ desktop dashboard
 * (`DesktopDashboard.tsx`), same pattern as `PLAYER_FILTERS`. Default is
 * `UPDATE_DESC` — most recently updated game first (2026-09-30; was
 * "most patch releases first" from 2026-09-16, which buried new games) — applied in each surface's own `useMemo`, then always run
 * through `sortByPlayability` afterward so the existing "준비중 games sink
 * to the bottom" invariant (see `registry.ts`) is never disturbed by a sort
 * choice; a "쉬운순"/"가나다순" pick only reorders *within* the playable and
 * 준비중 groups, not across them.
 */
export type SortOption =
  | "UPDATE_DESC"
  | "NAME_ASC"
  | "PLAYERS_ASC"
  | "PLAYERS_DESC"
  | "DIFFICULTY_ASC";

export const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: "UPDATE_DESC", label: "🔥 최근 업데이트순" },
  { key: "NAME_ASC", label: "가나다순" },
  { key: "PLAYERS_ASC", label: "인원 적은순" },
  { key: "PLAYERS_DESC", label: "인원 많은순" },
  { key: "DIFFICULTY_ASC", label: "난이도 쉬운순" },
];

export const DEFAULT_SORT_OPTION: SortOption = "UPDATE_DESC";

/** 준비중 게임 등 편집 난이도가 없는 항목은 항상 맨 뒤로 보낸다. */
const NO_DIFFICULTY_RANK = 99;

export function sortGamesBy<T extends GameMeta>(
  games: T[],
  option: SortOption,
): T[] {
  return [...games].sort((a, b) => {
    switch (option) {
      case "UPDATE_DESC":
        return (
          getGameLastUpdated(b.id).localeCompare(getGameLastUpdated(a.id)) ||
          getGameUpdateCount(b.id) - getGameUpdateCount(a.id)
        );
      case "NAME_ASC":
        return a.name.localeCompare(b.name, "ko");
      case "PLAYERS_ASC":
        return (
          a.players.min - b.players.min || a.players.max - b.players.max
        );
      case "PLAYERS_DESC":
        return (
          b.players.max - a.players.max || b.players.min - a.players.min
        );
      case "DIFFICULTY_ASC":
        return (
          (getGameDifficulty(a.id) ?? NO_DIFFICULTY_RANK) -
          (getGameDifficulty(b.id) ?? NO_DIFFICULTY_RANK)
        );
      default:
        return 0;
    }
  });
}
