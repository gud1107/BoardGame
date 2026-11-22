"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GameGenre } from "@/games/types";
import { GENRE_META, GENRE_ORDER } from "@/games/genres";
import { PLAYER_FILTERS } from "@/constants/playerFilters";
import type { SortOption } from "@/constants/sortOptions";
import type { ViewFilter } from "@/games/viewModes";
import SortFilterChips from "./SortFilterChips";
import NewOnlyChip from "./NewOnlyChip";
import ViewFilterChips from "./ViewFilterChips";

type GenreFilter = GameGenre | "all";

const VIEW_LABEL: Record<ViewFilter, string> = { all: "", "3d": "🧊 3D", "2d": "🖼️ 2D" };

/**
 * Phone/tablet lobby filter row (2026-11-22, proposal 5): the player-count,
 * 신규만, 3D/2D and genre chip rows (four stacked rows before the first card)
 * folded into one "⚙ 필터 N" button that opens a bottom sheet. Sort stays
 * inline since it's the most used. Active filters show as removable chips
 * under the row so they're never hidden state. The xl desktop dashboard
 * keeps its own single inline row.
 */
export default function LobbyFilterBar({
  filterIdx,
  onFilterChange,
  genre,
  onGenreChange,
  newOnly,
  onNewOnlyChange,
  viewFilter,
  onViewFilterChange,
  sortOption,
  onSortChange,
  admin,
  resultCount,
  onReset,
}: {
  filterIdx: number;
  onFilterChange: (idx: number) => void;
  genre: GenreFilter;
  onGenreChange: (g: GenreFilter) => void;
  newOnly: boolean;
  onNewOnlyChange: (v: boolean) => void;
  viewFilter: ViewFilter;
  onViewFilterChange: (v: ViewFilter) => void;
  sortOption: SortOption;
  onSortChange: (o: SortOption) => void;
  admin: boolean;
  resultCount: number;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);

  const active: { key: string; label: string; clear: () => void }[] = [];
  if (filterIdx !== 0) active.push({ key: "players", label: `👥 ${PLAYER_FILTERS[filterIdx].label}`, clear: () => onFilterChange(0) });
  if (genre !== "all")
    active.push({ key: "genre", label: `${GENRE_META[genre].emoji} ${GENRE_META[genre].label}`, clear: () => onGenreChange("all") });
  if (viewFilter !== "all") active.push({ key: "view", label: VIEW_LABEL[viewFilter], clear: () => onViewFilterChange("all") });
  if (newOnly) active.push({ key: "new", label: "🆕 신규만", clear: () => onNewOnlyChange(false) });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            active.length > 0
              ? "border-amber-400/70 bg-amber-500/20 text-white light:text-slate-900"
              : "border-white/15 text-white/80 hover:border-amber-400/40 light:border-slate-300 light:text-slate-700"
          }`}
        >
          ⚙ 필터
          {active.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] leading-none font-extrabold text-black">
              {active.length}
            </span>
          )}
        </button>
        <span aria-hidden className="h-5 w-px shrink-0 bg-white/15 light:bg-slate-300" />
        <SortFilterChips value={sortOption} onChange={onSortChange} admin={admin} className="min-w-0 flex-1" />
      </div>

      {active.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.clear}
              aria-label={`${a.label} 필터 끄기`}
              className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/25 light:bg-amber-100 light:text-amber-900"
            >
              {a.label}
              <span aria-hidden className="text-amber-300/80 light:text-amber-700">✕</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="px-1.5 py-1 text-xs font-semibold text-white/60 underline-offset-2 hover:text-white hover:underline light:text-slate-500 light:hover:text-slate-900"
          >
            모두 지우기
          </button>
        </div>
      )}

      {/* Portalled: the phone sticky bar has backdrop-filter, which would
          make it this fixed sheet's containing block. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="게임 필터">
          <button
            type="button"
            aria-label="필터 닫기"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <div className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-3xl border border-white/10 bg-neutral-900 shadow-[0_-20px_50px_-10px_rgba(0,0,0,0.7)] light:border-slate-200 light:bg-white">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span aria-hidden className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20 light:bg-slate-300" />
              <h2 className="text-lg font-bold text-white light:text-slate-900">필터</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-white/70 hover:bg-white/10 light:text-slate-500 light:hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-5 overflow-y-auto px-5 pt-2 pb-4">
              <FilterGroup title="인원">
                {PLAYER_FILTERS.map((f, idx) => (
                  <Chip key={f.label} active={filterIdx === idx} onClick={() => onFilterChange(idx)}>
                    {f.label}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup title="장르">
                <Chip active={genre === "all"} onClick={() => onGenreChange("all")}>
                  전체
                </Chip>
                {GENRE_ORDER.map((g) => (
                  <Chip key={g} active={genre === g} onClick={() => onGenreChange(genre === g ? "all" : g)}>
                    {GENRE_META[g].emoji} {GENRE_META[g].label}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup title="화면">
                <ViewFilterChips value={viewFilter} onChange={onViewFilterChange} />
              </FilterGroup>

              <FilterGroup title="새 게임">
                <NewOnlyChip value={newOnly} onChange={onNewOnlyChange} />
              </FilterGroup>
            </div>

            <div className="flex gap-2 border-t border-white/10 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] light:border-slate-200">
              <button
                type="button"
                onClick={onReset}
                className="h-12 flex-1 rounded-xl border border-white/15 text-sm font-semibold text-white/80 hover:bg-white/5 light:border-slate-300 light:text-slate-700 light:hover:bg-slate-50"
              >
                ↺ 초기화
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-12 flex-[2] rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-sm font-extrabold text-black shadow-[0_6px_20px_-6px_rgba(245,158,11,0.6)]"
              >
                게임 {resultCount}개 보기
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-bold text-white/70 light:text-slate-600">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
        active
          ? "border-amber-400/70 bg-amber-500/20 text-white light:text-slate-900"
          : "border-white/15 text-white/75 hover:border-amber-400/40 light:border-slate-200 light:text-slate-600 light:hover:border-amber-500/50"
      }`}
    >
      {children}
    </button>
  );
}
