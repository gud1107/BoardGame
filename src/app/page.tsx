"use client";

import { useMemo, useState } from "react";
import { GAME_REGISTRY, sortByPlayability } from "@/games/registry";
import { GENRE_META, GENRE_ORDER } from "@/games/genres";
import type { GameGenre } from "@/games/types";
import GameGrid from "@/components/GameGrid";
import CollectionShowcase from "@/components/CollectionShowcase";
import GameCategoryRow from "@/components/lobby/GameCategoryRow";
import { GAME_CATEGORIES } from "@/constants/gameCategories";
import { useGameBgm } from "@/lib/audio/useGameBgm";

const PLAYER_FILTERS = [
  { label: "전체", test: () => true },
  { label: "2인", test: (min: number, max: number) => min <= 2 && max >= 2 },
  { label: "3~4인", test: (min: number, max: number) => min <= 4 && max >= 3 },
  { label: "5~7인", test: (min: number, max: number) => min <= 7 && max >= 5 },
  { label: "8인", test: (min: number, max: number) => min <= 8 && max >= 8 },
];

type GenreFilter = GameGenre | "all";

export default function DashboardPage() {
  // 편안한 Lo-fi/Jazz Hop 테마 BGM — 게임 허브(이 페이지)에 머무는 동안만 재생.
  useGameBgm("lobby");
  const [query, setQuery] = useState("");
  const [filterIdx, setFilterIdx] = useState(0);
  const [genreFilter, setGenreFilter] = useState<GenreFilter>("all");

  // Search + player-count filter only — genre is applied separately below so
  // the collection showcase (always shown at the "전체" genre view) and the
  // main grid (narrowed to one genre when picked) can both read off the same
  // base list without double-filtering.
  //
  // Query matches title (kr/en), theme tags, and description keywords —
  // shared identically between the desktop-visible-always section and the
  // mobile copy of it below the curated carousel (2026-09-02, AskUserQuestion).
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = PLAYER_FILTERS[filterIdx];
    return GAME_REGISTRY.filter((g) => {
      const matchesQuery =
        !q ||
        g.name.toLowerCase().includes(q) ||
        g.nameEn?.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q) ||
        g.tags?.some((tag) => tag.toLowerCase().includes(q));
      const matchesPlayers = filter.test(g.players.min, g.players.max);
      return matchesQuery && matchesPlayers;
    });
  }, [query, filterIdx]);

  const filtered = useMemo(() => {
    const byGenre =
      genreFilter === "all"
        ? baseFiltered
        : baseFiltered.filter((g) => g.genres?.includes(genreFilter));
    // Default sort: playable games surface first, "준비중" games sink to the
    // end — kept in sync with search/genre/player-count filtering above so
    // it applies no matter what the user typed or selected.
    return sortByPlayability(byGenre);
  }, [baseFiltered, genreFilter]);

  const playableCount = GAME_REGISTRY.filter((g) => g.playable).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">함께할 보드게임을 골라보세요</h1>
        <p className="mt-1 text-sm text-white/50">
          총 {GAME_REGISTRY.length}종 · 플레이 가능 {playableCount}종 · 1~10명, 폰이나 데스크톱으로 즐기세요
        </p>
      </div>

      {/* Mobile-only (< sm) Netflix-style category carousel — a curated
          preview shown ABOVE the full searchable catalog below (as of
          2026-09-02 that section is no longer desktop-only; see its own
          comment). `-mx-4` cancels the page container's own `px-4` (its only
          horizontal padding below `sm`, since `sm:px-6` doesn't apply here)
          so each row's cards can bleed to the viewport edge — the "next card
          peeks in" swipe affordance only works if the row isn't boxed in by
          the container's padding. */}
      <div className="-mx-4 sm:hidden">
        {GAME_CATEGORIES.map((category) => (
          <GameCategoryRow key={category.id} category={category} />
        ))}
      </div>

      {/* Full searchable catalog. On mobile this now renders below the
          curated carousel above (rather than being hidden entirely) so every
          registered game — not just the 6 curated ones — stays reachable via
          search or scroll (2026-09-02, AskUserQuestion: keep the carousel,
          add this section underneath on mobile too). */}
      <div className="mt-8 sm:mt-0">
        <h2 className="mb-3 text-base font-bold text-white sm:hidden">🔍 전체 게임 검색</h2>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="게임 이름, 태그로 검색..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-9 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="검색어 지우기"
                className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {PLAYER_FILTERS.map((f, idx) => (
              <button
                key={f.label}
                onClick={() => setFilterIdx(idx)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  filterIdx === idx
                    ? "border-rose-400 bg-rose-500/20 text-white"
                    : "border-white/10 text-white/60 hover:border-white/25"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setGenreFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              genreFilter === "all"
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/10 text-white/60 hover:border-white/25"
            }`}
          >
            전체 장르
          </button>
          {GENRE_ORDER.map((genre) => {
            const meta = GENRE_META[genre];
            const active = genreFilter === genre;
            return (
              <button
                key={genre}
                onClick={() => setGenreFilter(active ? "all" : genre)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                style={
                  active
                    ? { borderColor: meta.accent, backgroundColor: `${meta.accent}26`, color: "white" }
                    : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }
                }
              >
                {meta.emoji} {meta.label}
              </button>
            );
          })}
        </div>

        {genreFilter === "all" && (
          <CollectionShowcase collectionId="netflix-death-game" games={baseFiltered} />
        )}

        {filtered.length > 0 ? (
          <GameGrid games={filtered} />
        ) : (
          <p className="py-16 text-center text-sm text-white/40">검색 결과가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
