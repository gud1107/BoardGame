"use client";

import { useMemo } from "react";
import type { GameMeta } from "@/games/types";
import { useActiveRooms } from "@/games/shared/room/useActiveRooms";
import GameShowcaseCard from "./GameShowcaseCard";

/**
 * Desktop-only (xl+, ≥1280px) zero-scroll lobby dashboard — a single
 * full-width game showcase grid inside one `100dvh`-minus-header viewport
 * with no outer page scroll (see `src/app/page.tsx`). Every viewport below
 * `xl` keeps the existing, separately hand-tuned mobile/tablet layout
 * completely untouched — this component renders alongside it, toggled
 * purely by the `hidden xl:flex` wrapper below.
 *
 * 2026-09-12 grid-overhaul revision: this replaced a same-day 3-column
 * version (profile/quick-start rail + this grid + a live-room-list/patch-
 * notes rail) within hours of shipping, per an explicit follow-up request
 * to devote ~85%+ of the screen to the game grid instead. What moved
 * rather than disappeared: the invite-code quick-join now lives in
 * `SiteHeader` (`InviteCodeJoin`, xl+ only) since the global header already
 * carries the profile summary/patch-notes button/sound toggle this
 * dashboard needed; the `active_rooms` live-room infra built that same day
 * is NOT reverted — `useActiveRooms` still feeds a live room-count badge on
 * each card, only the dedicated right-rail panel UI was removed.
 */
export default function DesktopDashboard({
  games,
  totalCount,
  playableCount,
  query,
  onQueryChange,
}: {
  games: GameMeta[];
  totalCount: number;
  playableCount: number;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const rooms = useActiveRooms();

  const liveCountByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rooms) map.set(r.gameId, (map.get(r.gameId) ?? 0) + 1);
    return map;
  }, [rooms]);

  return (
    <div
      className="relative hidden min-h-0 w-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900 via-neutral-950 to-black px-4 pt-3 pb-4 xl:flex"
      style={{ height: "calc(100dvh - var(--site-header-h, 96px))" }}
    >
      {/* 은은한 배경 앰비언트 골드 오라 — 다크 럭셔리 리뉴얼(2026-09-12) */}
      <div className="pointer-events-none absolute top-0 left-1/2 h-32 w-3/4 -translate-x-1/2 bg-amber-500/5 blur-[120px]" />
      <main className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-amber-500/20 bg-neutral-900/60 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/15 pb-3">
          <div className="flex items-center gap-2">
            <span className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-500 bg-clip-text font-serif text-sm font-bold tracking-wide text-transparent">
              🎮 게임 선택
            </span>
            <span className="text-xs font-normal text-white/40">
              플레이할 보드게임을 선택하여 방을 개설하세요
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs font-medium text-amber-500/60">
              총 {totalCount}개 게임 · 플레이 가능 {playableCount}개
            </span>
            <div className="relative w-full max-w-[240px]">
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="게임 이름, 태그로 검색..."
                aria-label="게임 검색"
                className="w-full rounded-full border border-amber-500/20 bg-neutral-950/40 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-amber-400/70 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {games.length > 0 ? (
            <div className="grid grid-cols-4 gap-4 xl:grid-cols-5">
              {games.map((game) => (
                <GameShowcaseCard
                  key={game.id}
                  game={game}
                  liveRoomCount={liveCountByGame.get(game.id) ?? 0}
                />
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-xs text-white/40">검색 결과가 없습니다.</p>
          )}
        </div>
      </main>
    </div>
  );
}
