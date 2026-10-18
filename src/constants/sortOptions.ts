import type { GameMeta } from "@/games/types";
import { getGameDifficulty } from "./gameDifficulty";
import { getGameLastUpdated, getGameUpdateCount } from "./gameUpdateCount";
import { GAME_LAST_COMMIT } from "./gameLastUpdated.generated";
import type { GameRelease } from "@/lib/admin/gameReleases";

/**
 * Sort options for the lobby's game showcase grid — shared between the
 * mobile/tablet catalog (`src/app/page.tsx`) and the xl+ desktop dashboard
 * (`DesktopDashboard.tsx`), same pattern as `PLAYER_FILTERS`. Default is
 * `POPULAR_DESC` — most-played game first (2026-10-01). `UPDATE_DESC` is
 * most recently updated first (2026-09-30; was "most patch releases first"
 * from 2026-09-16, which buried new games). Applied in each surface's own
 * `useMemo`, then always run
 * through `sortByPlayability` afterward so the existing "준비중 games sink
 * to the bottom" invariant (see `registry.ts`) is never disturbed by a sort
 * choice; a "쉬운순"/"가나다순" pick only reorders *within* the playable and
 * 준비중 groups, not across them.
 */
export type SortOption =
  | "POPULAR_DESC"
  | "POPULAR_ASC"
  | "UPDATE_DESC"
  | "UPDATE_ASC"
  | "NAME_ASC"
  | "NAME_DESC"
  | "PLAYERS_ASC"
  | "PLAYERS_DESC"
  | "DIFFICULTY_ASC"
  | "DIFFICULTY_DESC"
  | AdminSortOption;

/**
 * Admin-only "신규 업데이트순" (2026-10-11): newest game-specific commit
 * first, by commit time, by when it was pushed, or by when it reached
 * production. Only rendered for site admins (`SortFilterChips` `admin`);
 * push/deploy times come from `/api/admin/game-releases`.
 */
export type AdminSortOption =
  | "ADMIN_COMMIT_DESC"
  | "ADMIN_COMMIT_ASC"
  | "ADMIN_PUSH_DESC"
  | "ADMIN_PUSH_ASC"
  | "ADMIN_DEPLOY_DESC"
  | "ADMIN_DEPLOY_ASC";

/** Which release time an admin sort reads, regardless of direction. */
export type AdminSortBasis = "commit" | "push" | "deploy";

export function adminSortBasis(option: AdminSortOption): AdminSortBasis {
  if (option.startsWith("ADMIN_COMMIT")) return "commit";
  if (option.startsWith("ADMIN_PUSH")) return "push";
  return "deploy";
}

/**
 * Every chip is two-way (2026-10-19): the first tap picks `key`, tapping it
 * again while active flips to `reverse` (and back), and the chip shows
 * `reverseLabel` while flipped — 인기순 ↔ 인기 낮은순 and so on. "인원순"
 * replaced the separate 인원 적은순/많은순 chips this way.
 */
export interface SortChip<K extends SortOption = SortOption> {
  key: K;
  label: string;
  reverse: K;
  reverseLabel: string;
}

export const SORT_OPTIONS: SortChip[] = [
  { key: "POPULAR_DESC", label: "👑 인기순", reverse: "POPULAR_ASC", reverseLabel: "👑 인기 낮은순" },
  { key: "UPDATE_DESC", label: "🔥 최근 업데이트순", reverse: "UPDATE_ASC", reverseLabel: "🔥 오래된 업데이트순" },
  { key: "NAME_ASC", label: "가나다순", reverse: "NAME_DESC", reverseLabel: "가나다 역순" },
  { key: "PLAYERS_ASC", label: "👥 인원순 ↑", reverse: "PLAYERS_DESC", reverseLabel: "👥 인원순 ↓" },
  { key: "DIFFICULTY_ASC", label: "🎯 난이도순 ↑", reverse: "DIFFICULTY_DESC", reverseLabel: "🎯 난이도순 ↓" },
];

export const ADMIN_SORT_OPTIONS: SortChip<AdminSortOption>[] = [
  { key: "ADMIN_COMMIT_DESC", label: "🛠 커밋순", reverse: "ADMIN_COMMIT_ASC", reverseLabel: "🛠 커밋 오래된순" },
  { key: "ADMIN_PUSH_DESC", label: "🛠 푸시순", reverse: "ADMIN_PUSH_ASC", reverseLabel: "🛠 푸시 오래된순" },
  { key: "ADMIN_DEPLOY_DESC", label: "🛠 배포순", reverse: "ADMIN_DEPLOY_ASC", reverseLabel: "🛠 배포 오래된순" },
];

export function isAdminSortOption(option: SortOption): option is AdminSortOption {
  return option.startsWith("ADMIN_");
}

export const DEFAULT_SORT_OPTION: SortOption = "POPULAR_DESC";

/** 준비중 게임 등 편집 난이도가 없는 항목은 항상 맨 뒤로 보낸다. */
const NO_DIFFICULTY_RANK = 99;

function byLastUpdatedDesc(a: GameMeta, b: GameMeta): number {
  return (
    getGameLastUpdated(b.id).localeCompare(getGameLastUpdated(a.id)) ||
    getGameUpdateCount(b.id) - getGameUpdateCount(a.id)
  );
}

const toMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Sort key for the admin sorts, in ms. Each basis falls back to the earlier
 * stage when its own time is unknown (not pushed/deployed yet, or the GitHub
 * lookup was rate-limited), so a just-committed game still sorts by commit.
 */
export function adminReleaseTime(
  gameId: string,
  option: AdminSortOption,
  releases?: Readonly<Record<string, GameRelease>>,
): number {
  const r = releases?.[gameId];
  const commit = toMs(r?.commitAt ?? GAME_LAST_COMMIT[gameId]?.at ?? getGameLastUpdated(gameId));
  const basis = adminSortBasis(option);
  if (basis === "commit") return commit;
  if (basis === "push") return toMs(r?.pushedAt) || toMs(r?.deployedAt) || commit;
  return toMs(r?.deployedAt) || toMs(r?.pushedAt) || commit;
}

/**
 * `playCounts` (all-time plays per game id, from Supabase via
 * `fetchGamePlayStats().total`) is only read by the 인기순 sorts; while it's
 * still loading, or for games nobody has played, ties fall back to recency.
 * Each `_ASC`/`_DESC` pair is one comparator run forwards or backwards, so
 * flipping a chip reverses the whole order — except games with no 난이도,
 * which stay last either way.
 */
export function sortGamesBy<T extends GameMeta>(
  games: T[],
  option: SortOption,
  playCounts?: ReadonlyMap<string, number>,
  releases?: Readonly<Record<string, GameRelease>>,
): T[] {
  const compare = (a: T, b: T): number => {
    switch (option) {
      case "ADMIN_COMMIT_DESC":
      case "ADMIN_PUSH_DESC":
      case "ADMIN_DEPLOY_DESC":
      case "ADMIN_COMMIT_ASC":
      case "ADMIN_PUSH_ASC":
      case "ADMIN_DEPLOY_ASC":
        return adminReleaseTime(b.id, option, releases) - adminReleaseTime(a.id, option, releases) || byLastUpdatedDesc(a, b);
      case "POPULAR_DESC":
      case "POPULAR_ASC":
        return (
          (playCounts?.get(b.id) ?? 0) - (playCounts?.get(a.id) ?? 0) ||
          byLastUpdatedDesc(a, b)
        );
      case "UPDATE_DESC":
      case "UPDATE_ASC":
        return byLastUpdatedDesc(a, b);
      case "NAME_ASC":
      case "NAME_DESC":
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
      case "DIFFICULTY_DESC": {
        const da = getGameDifficulty(a.id) ?? NO_DIFFICULTY_RANK;
        const db = getGameDifficulty(b.id) ?? NO_DIFFICULTY_RANK;
        if (da === NO_DIFFICULTY_RANK || db === NO_DIFFICULTY_RANK) return da - db;
        return option === "DIFFICULTY_ASC" ? da - db : db - da;
      }
      default:
        return 0;
    }
  };
  // PLAYERS_* and DIFFICULTY_* spell out both directions above; the rest
  // are written for their default direction and flipped here.
  const flipped =
    option === "POPULAR_ASC" ||
    option === "UPDATE_ASC" ||
    option === "NAME_DESC" ||
    option.startsWith("ADMIN_") && option.endsWith("_ASC");
  return [...games].sort(flipped ? (a, b) => compare(b, a) : compare);
}
