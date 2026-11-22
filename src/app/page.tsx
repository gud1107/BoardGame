"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { GAME_REGISTRY, sortByPlayability } from "@/games/registry";
import type { GameGenre } from "@/games/types";
import GameGrid, { LobbyCard } from "@/components/GameGrid";
import LobbySections from "@/components/lobby/LobbySections";
import { buildLobbySections } from "@/components/lobby/buildLobbySections";
import { getGameFreshnessBadge } from "@/constants/gameUpdateCount";
import DesktopDashboard from "@/components/lobby/DesktopDashboard";
import PublicRoomBrowser from "@/components/lobby/PublicRoomBrowser";
import { useActiveRooms } from "@/games/shared/room/useActiveRooms";
import { PLAYER_FILTERS } from "@/constants/playerFilters";
import { matchesViewFilter, type ViewFilter } from "@/games/viewModes";
import { DEFAULT_SORT_OPTION, isAdminSortOption, type SortOption, sortGamesBy } from "@/constants/sortOptions";
import LobbyFilterBar from "@/components/lobby/LobbyFilterBar";
import { isNewGame } from "@/constants/gameUpdateCount";
import { useGameBgm } from "@/lib/audio/useGameBgm";
import { fetchGamePlayStats } from "@/lib/analytics/playCounts";
import { applyGameOverrides, fetchGameOverrides, type GameOverride } from "@/lib/siteConfig/siteConfig";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useIsSiteAdmin } from "@/lib/admin/useIsSiteAdmin";
import { useGameReleases } from "@/lib/admin/useGameReleases";
import AdminReleaseLine from "@/components/lobby/AdminReleaseLine";

type GenreFilter = GameGenre | "all";

/** sessionStorage key for restoring search/filter/sort state after a
 * game-detail visit and back-navigation (see `readSavedLobbyState` below). */
const LOBBY_STATE_KEY = "lobby:filterState:v1";

interface SavedLobbyState {
  query: string;
  filterIdx: number;
  genreFilter: GenreFilter;
  sortOption: SortOption;
  newOnly: boolean;
  viewFilter: ViewFilter;
}

/**
 * Reads persisted search/player-filter/genre/sort state back from
 * `sessionStorage`. Needed because clicking a game card and pressing the
 * browser's back button was observed (2026-09-16) to fully reset this
 * page's local state instead of restoring it — a report of "가나다순으로
 * 정렬해도 모바일에서 적용이 안 된다" traced back to exactly this: picking a
 * sort, opening a game, then coming back silently dropped it to the
 * 업데이트순 default.
 *
 * Read through `useSyncExternalStore` with an empty server snapshot, and
 * layered under per-field overrides set by the user: the server can't see
 * this tab's sessionStorage, so restoring it in the first (hydration) render
 * made the server HTML and the client disagree — React #418 for every
 * returning visitor with a saved sort/filter (2026-10-02). React re-renders
 * with the saved values right after hydrating; a client-side back
 * navigation (no hydration) restores them immediately as before.
 */
const EMPTY_SAVED: Partial<SavedLobbyState> = {};
let savedCache: { raw: string | null; value: Partial<SavedLobbyState> } | null = null;

function readSavedLobbyState(): Partial<SavedLobbyState> {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(LOBBY_STATE_KEY);
  } catch {
    // Inaccessible (private browsing) storage — fall back to defaults.
  }
  // useSyncExternalStore needs the same object back while nothing changed.
  if (savedCache && savedCache.raw === raw) return savedCache.value;
  let value: Partial<SavedLobbyState> = EMPTY_SAVED;
  try {
    value = raw ? (JSON.parse(raw) as Partial<SavedLobbyState>) : EMPTY_SAVED;
  } catch {
    // Corrupt — defaults.
  }
  savedCache = { raw, value };
  return value;
}

const noopSubscribe = () => () => {};

/**
 * The time NEW/UPDATED badges and the "10월" play label are judged against.
 * Null on the server and during hydration (this page is prerendered at
 * build time, so a server clock would be the build's), then the client's
 * clock — fixed once per page load.
 */
let clientNow: number | null = null;
function readClientNow(): number {
  if (clientNow === null) clientNow = Date.now();
  return clientNow;
}

export default function DashboardPage() {
  // 편안한 Lo-fi/Jazz Hop 테마 BGM — 게임 허브(이 페이지)에 머무는 동안만 재생.
  useGameBgm("lobby");
  // Saved filters (hydration-safe, see readSavedLobbyState) under whatever
  // the user picks on this visit.
  const saved = useSyncExternalStore(noopSubscribe, readSavedLobbyState, () => EMPTY_SAVED);
  const [queryPick, setQuery] = useState<string | null>(null);
  const [filterIdxPick, setFilterIdx] = useState<number | null>(null);
  const [genrePick, setGenreFilter] = useState<GenreFilter | null>(null);
  const [sortPick, setSortOption] = useState<SortOption | null>(null);
  const [newOnlyPick, setNewOnly] = useState<boolean | null>(null);
  const [viewPick, setViewFilter] = useState<ViewFilter | null>(null);
  const query = queryPick ?? saved.query ?? "";
  const filterIdx = filterIdxPick ?? saved.filterIdx ?? 0;
  const genreFilter = genrePick ?? saved.genreFilter ?? "all";
  const newOnly = newOnlyPick ?? saved.newOnly ?? false;
  const viewFilter = viewPick ?? saved.viewFilter ?? "all";
  // 🛠 커밋/푸시/배포순 are site-admin only (2026-10-11); anyone else with
  // one somehow saved falls back to the default.
  const isAdmin = useIsSiteAdmin(useSubscriptionStore((s) => s.userId));
  const pickedSort = sortPick ?? saved.sortOption ?? DEFAULT_SORT_OPTION;
  const sortOption = isAdminSortOption(pickedSort) && !isAdmin ? DEFAULT_SORT_OPTION : pickedSort;
  const adminSort = isAdminSortOption(sortOption) ? sortOption : null;
  const releases = useGameReleases(adminSort !== null)?.games;
  const adminLine = adminSort
    ? (gameId: string) => <AdminReleaseLine gameId={gameId} release={releases?.[gameId]} option={adminSort} />
    : undefined;

  // Badge clock: 0 until hydrated (no NEW/UPDATED badges or month label in
  // the prerendered HTML), then this load's client time.
  const now = useSyncExternalStore(noopSubscribe, readClientNow, () => 0);
  // Real match starts per game: all-time for the default 인기순 sort, this
  // month for the cards' "🔥 10월 N회 플레이". Until this resolves, or if
  // Supabase is unreachable, every count reads as 0 and 인기순 falls back to
  // recency, so the grid never waits on the network.
  const [playCounts, setPlayCounts] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [monthPlays, setMonthPlays] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    void fetchGamePlayStats().then((stats) => {
      if (cancelled) return;
      setPlayCounts(stats.total);
      setMonthPlays(stats.month);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Admin visibility settings (/admin/games 게임 관리): hidden games drop out,
  // 준비중 overrides become unplayable, featured games lead the grid.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, GameOverride>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    void fetchGameOverrides().then((map) => {
      if (!cancelled) setOverrides(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const catalog = useMemo(
    () => applyGameOverrides(GAME_REGISTRY.filter((g) => !g.hiddenFromLobby), overrides),
    [overrides],
  );

  // Writing TO sessionStorage in response to React state changing is the
  // effect's proper direction (unlike reading FROM it, handled above) — so
  // this one's fine as a plain effect. Skipped for the hydration render,
  // whose values are the defaults: writing those would erase the saved
  // filters before the post-hydration render could restore them.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(
        LOBBY_STATE_KEY,
        JSON.stringify({ query, filterIdx, genreFilter, sortOption, newOnly, viewFilter }),
      );
    } catch {
      // Storage full/blocked — state just won't survive this particular
      // back-navigation, no worse than before this fix.
    }
  }, [hydrated, query, filterIdx, genreFilter, sortOption, newOnly, viewFilter]);

  // 2026-09-06 AskUserQuestion: 모바일 검색어 입력 중엔 캐러셀/쇼케이스를
  // 숨기고 결과 그리드를 최상단으로 끌어올린다 (인원수/장르 필터 칩은 유지).
  const isSearching = query.trim().length > 0;

  // Search + player-count filter only — genre is applied separately below so
  // the collection showcase (always shown at the "전체" genre view) and the
  // main grid (narrowed to one genre when picked) can both read off the same
  // base list without double-filtering.
  //
  // Query matches title (kr/en), theme tags, and description keywords —
  // this single `query` state is shared by two inputs that are never both
  // visible at once: the sticky mobile search bar pinned above the page
  // title, and the desktop-only (`hidden sm:flex`) input at the bottom of
  // the showcase (2026-09-16: moved there from the top filter row to keep
  // the header uncluttered — see HANDOFF.md).
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = PLAYER_FILTERS[filterIdx];
    return catalog.filter((g) => {
      const matchesQuery =
        !q ||
        g.name.toLowerCase().includes(q) ||
        g.nameEn?.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q) ||
        g.tags?.some((tag) => tag.toLowerCase().includes(q));
      const matchesPlayers = filter.test(g.players.min, g.players.max);
      // 🆕 신규만: same rule as the NEW badge (needs the client clock, so
      // it waits for hydration like the badge does).
      return (
        matchesQuery &&
        matchesPlayers &&
        matchesViewFilter(g.id, viewFilter) &&
        (!newOnly || isNewGame(g.id, now))
      );
    });
  }, [query, filterIdx, catalog, newOnly, now, viewFilter]);

  const filtered = useMemo(() => {
    const byGenre =
      genreFilter === "all"
        ? baseFiltered
        : baseFiltered.filter((g) => g.genres?.includes(genreFilter));
    // User-picked sort (default: 인기순) runs first, then playability
    // partitioning always runs last so "준비중" games still sink to the
    // end regardless of sort choice — kept in sync with search/genre/
    // player-count filtering above so it applies no matter what was typed
    // or selected.
    const sorted = sortGamesBy(byGenre, sortOption, playCounts, releases);
    // Admin-featured games first (stable, so the chosen sort still orders
    // them among themselves) — except on the admin 🛠 sorts, which want the
    // raw release order; playability partitioning still runs last.
    if (isAdminSortOption(sortOption)) return sortByPlayability(sorted);
    return sortByPlayability([...sorted.filter((g) => g.featured), ...sorted.filter((g) => !g.featured)]);
  }, [baseFiltered, genreFilter, sortOption, playCounts, releases]);

  const playableCount = catalog.filter((g) => g.playable).length;

  // 2026-11-22: with nothing searched/filtered, the catalog is shown as
  // titled sections (인기/신작/장르별, two rows each + 더 보기) instead of one
  // 81-card wall. Any search or filter switches back to the flat result grid
  // — the filter itself is then the grouping. Admin 🛠 sorts stay flat too.
  const browsing =
    !isSearching && filterIdx === 0 && genreFilter === "all" && !newOnly && viewFilter === "all" && !adminSort;
  const sections = useMemo(
    () => (browsing ? buildLobbySections(filtered, playCounts, now) : []),
    [browsing, filtered, playCounts, now],
  );
  const resetFilters = () => {
    setQuery("");
    setFilterIdx(0);
    setGenreFilter("all");
    setNewOnly(false);
    setViewFilter("all");
  };

  // "/" focuses whichever lobby search box is on screen (tablet/desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const input = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-lobby-search]")).find(
        (el) => el.offsetParent !== null,
      );
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // One Realtime subscription for both layouts' 🌐 공개방 browser and the
  // desktop cards' live room-count badges.
  const rooms = useActiveRooms();

  return (
    <>
      {/* Desktop-only (xl+, ≥1280px) zero-scroll 3-column dashboard —
          confirmed via AskUserQuestion (2026-09-12) to sit alongside the
          existing responsive layout below rather than replace it, so every
          hand-tuned mobile/tablet behavior in that layout (carousel,
          sticky search, collapse animations) stays completely untouched.
          Shares this page's own `query`/`filtered` state so search results
          never drift out of sync between the two layouts. */}
      <DesktopDashboard
        games={filtered}
        totalCount={catalog.length}
        playableCount={playableCount}
        query={query}
        onQueryChange={setQuery}
        filterIdx={filterIdx}
        onFilterChange={setFilterIdx}
        newOnly={newOnly}
        onNewOnlyChange={setNewOnly}
        viewFilter={viewFilter}
        onViewFilterChange={setViewFilter}
        sortOption={sortOption}
        onSortChange={setSortOption}
        monthPlays={monthPlays}
        now={now}
        rooms={rooms}
        adminSort={isAdmin}
        adminLine={adminLine}
        sections={browsing ? sections : null}
        onResetFilters={resetFilters}
      />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 xl:hidden">
      {/* Mobile-only (< sm) sticky search+filter bar (2026-09-03,
          AskUserQuestion; extended 2026-09-16). Pinned to the very top of
          the viewport, directly beneath the global SiteHeader's own sticky
          bar — `top` reads that header's real measured height off
          `--site-header-h` (set in SiteHeader.tsx) rather than a hardcoded
          px offset, since that header's height changes when it wraps to a
          second line or its async badge content resolves. `-mx-4 -mt-8`
          cancels this container's own edge padding (`px-4 py-8`) so the
          bar's background spans full-bleed edge-to-edge and sits flush
          against the header with no gap on first paint. The full
          desktop-style search input further below is hidden on mobile
          (`hidden sm:flex`) so there's only one active search input, not a
          confusing duplicate.

          2026-09-16: player-count + sort chips moved in here too (a report
          that "정렬 필터가 안 먹힌다" traced back to these chips scrolling
          off-screen with the rest of the page on mobile — re-tested with
          real touch-emulated taps and the sort logic itself was always
          correct, it just wasn't reachable mid-scroll). Their in-flow
          counterparts further down are now `hidden sm:flex` so mobile
          shows them only here, while tablet/desktop (no sticky bar there)
          keep the original in-flow rows unchanged. Genre chips stay
          in-flow, not stickied — mentioned in no report, and would eat a
          second wrapped line of permanent header height on narrow phones. */}
      <div
        className="sticky z-30 -mx-4 -mt-8 flex flex-col gap-2 border-b border-amber-500/15 bg-neutral-950/80 px-4 py-3 backdrop-blur sm:hidden light:border-slate-200 light:bg-white/90"
        style={{ top: "var(--site-header-h, 96px)" }}
      >
        <div className="relative w-full">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="게임 이름, 태그로 검색..."
            aria-label="게임 검색"
            className="w-full rounded-xl border border-amber-500/15 bg-white/5 px-4 py-2.5 pr-9 text-sm text-white break-keep placeholder:text-white/30 focus:border-amber-400/70 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:shadow-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
              className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white light:text-slate-400 light:hover:bg-slate-100 light:hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </div>
        <LobbyFilterBar
          filterIdx={filterIdx}
          onFilterChange={setFilterIdx}
          genre={genreFilter}
          onGenreChange={setGenreFilter}
          newOnly={newOnly}
          onNewOnlyChange={setNewOnly}
          viewFilter={viewFilter}
          onViewFilterChange={setViewFilter}
          sortOption={sortOption}
          onSortChange={setSortOption}
          admin={isAdmin}
          resultCount={filtered.length}
          onReset={resetFilters}
        />
      </div>

      <div className="mt-6 mb-8 sm:mt-0">
        <p className="text-[11px] font-medium tracking-[0.32em] text-amber-200/70 uppercase light:text-amber-800/70">
          Tonight&apos;s Table
        </p>
        <h1 className="mt-2 font-display text-[26px] leading-tight font-bold tracking-[-0.01em] text-amber-50 break-keep sm:text-[32px] light:text-slate-900">
          함께할 보드게임을 골라보세요
        </h1>
        <div aria-hidden className="mt-3 h-px w-12 bg-gradient-to-r from-amber-300/70 to-transparent light:from-amber-700/60" />
        <p className="mt-3 text-sm text-white/65 break-keep light:text-slate-600">
          {catalog.length}종의 게임 · 1~10명 · 폰과 데스크톱 어디서나
        </p>
      </div>

      {/* sm+ search — moved up here from below the grid (2026-11-22), where
          it sat under 81 cards and was effectively undiscoverable. Phones
          keep the sticky bar above instead. "/" focuses it. */}
      <div className="mb-6 hidden sm:block">
        <div className="relative w-full max-w-xl">
          <span aria-hidden className="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-white/50 light:text-slate-400">
            🔍
          </span>
          <input
            data-lobby-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="게임 이름, 태그로 검색  ( / )"
            aria-label="게임 검색"
            className="h-11 w-full rounded-xl border border-amber-500/25 bg-white/5 pr-10 pl-10 text-[15px] text-white placeholder:text-white/40 focus:border-amber-400/70 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:shadow-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
              className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white light:text-slate-400 light:hover:bg-slate-100 light:hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <PublicRoomBrowser rooms={rooms} className="mb-2" />

      {/* 2026-09-16: the Netflix-style horizontal-scroll category carousel
          that used to render here (curated preview above the full catalog)
          was removed outright — on mobile its edge-swipe gesture competed
          with the browser's own back/forward swipe navigation, and every
          game it curated is already reachable in the grid below. See
          HANDOFF.md; `GameCategoryRow.tsx`/`gameCategories.ts` were deleted
          as dead code along with it. */}
      <div className={`sm:mt-0 ${isSearching ? "mt-4" : "mt-8"}`}>
        {/* 2026-09-06: swaps to a live match-count header while a mobile
            search query is active (kept in-flow, not collapsed, since this
            IS the replacement content for that moment — no animation needed
            for a text swap). Reverts to the static heading once cleared. */}
        {!browsing && (
          <h2 className="mb-3 flex items-baseline gap-2 font-display text-lg font-bold text-white sm:hidden light:text-slate-900">
            {isSearching ? "검색 결과" : "필터 결과"}
            <span className="font-sans text-sm font-semibold text-white/60 light:text-slate-500">{filtered.length}</span>
          </h2>
        )}
        {/* sm+ (tablet; desktop xl has its own dashboard): the same one-row
            filter bar as the phone sticky bar — 2026-11-22 folded the four
            chip rows (인원 / 신규·3D·2D / 정렬 / 장르) into ⚙ 필터 + 정렬. */}
        <div className="mb-8 hidden sm:block">
          <LobbyFilterBar
            filterIdx={filterIdx}
            onFilterChange={setFilterIdx}
            genre={genreFilter}
            onGenreChange={setGenreFilter}
            newOnly={newOnly}
            onNewOnlyChange={setNewOnly}
            viewFilter={viewFilter}
            onViewFilterChange={setViewFilter}
            sortOption={sortOption}
            onSortChange={setSortOption}
            admin={isAdmin}
            resultCount={filtered.length}
            onReset={resetFilters}
          />
        </div>

        {browsing ? (
          <LobbySections
            sections={sections}
            layout="hub"
            renderCard={(game) => (
              <LobbyCard
                game={game}
                badge={getGameFreshnessBadge(game.id, now)}
                plays={monthPlays.get(game.id) ?? 0}
                now={now}
              />
            )}
          />
        ) : filtered.length > 0 ? (
          <>
            <div className="mb-4 hidden items-center gap-3 sm:flex">
              <h2 className="font-display text-xl font-bold text-white light:text-slate-900">
                {isSearching ? "검색 결과" : "필터 결과"}{" "}
                <span className="font-sans text-base font-semibold text-white/60 light:text-slate-500">{filtered.length}</span>
              </h2>
              {/* Active filters already show as removable chips (and 모두
                  지우기) in the filter bar; only a search needs its own reset. */}
              {isSearching && <ResetFiltersButton onClick={resetFilters} />}
            </div>
            {isSearching && (
              <div className="mb-4 sm:hidden">
                <ResetFiltersButton onClick={resetFilters} />
              </div>
            )}
            <GameGrid games={filtered} monthPlays={monthPlays} now={now} adminLine={adminLine} />
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-[15px] text-white/65 light:text-slate-500">조건에 맞는 게임이 없습니다.</p>
            <ResetFiltersButton onClick={resetFilters} />
          </div>
        )}
      </div>
      </div>
    </>
  );
}

function ResetFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-amber-400/50 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:text-slate-900"
    >
      ↺ 검색·필터 초기화
    </button>
  );
}
