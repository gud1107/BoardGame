"use client";

import { useMemo, useState } from "react";
import { GAME_REGISTRY, sortByPlayability } from "@/games/registry";
import { GENRE_META, GENRE_ORDER } from "@/games/genres";
import type { GameGenre } from "@/games/types";
import GameGrid from "@/components/GameGrid";
import CollectionShowcase from "@/components/CollectionShowcase";

const PLAYER_FILTERS = [
  { label: "전체", test: () => true },
  { label: "2인", test: (min: number, max: number) => min <= 2 && max >= 2 },
  { label: "3~4인", test: (min: number, max: number) => min <= 4 && max >= 3 },
  { label: "5~7인", test: (min: number, max: number) => min <= 7 && max >= 5 },
  { label: "8인", test: (min: number, max: number) => min <= 8 && max >= 8 },
];

type GenreFilter = GameGenre | "all";

export default function DashboardPage() {
  const [query, setQuery] = useState("");
  const [filterIdx, setFilterIdx] = useState(0);
  const [genreFilter, setGenreFilter] = useState<GenreFilter>("all");

  // Search + player-count filter only — genre is applied separately below so
  // the collection showcase (always shown at the "전체" genre view) and the
  // main grid (narrowed to one genre when picked) can both read off the same
  // base list without double-filtering.
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = PLAYER_FILTERS[filterIdx];
    return GAME_REGISTRY.filter((g) => {
      const matchesQuery =
        !q || g.name.toLowerCase().includes(q) || g.nameEn?.toLowerCase().includes(q);
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="게임 이름 검색..."
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none sm:max-w-xs"
        />
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
  );
}
