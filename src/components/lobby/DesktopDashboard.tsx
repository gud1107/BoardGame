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
      className="hidden min-h-0 w-full flex-col overflow-hidden px-4 pt-3 pb-4 xl:flex"
      style={{ height: "calc(100dvh - var(--site-header-h, 96px))" }}
    >
      <main className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-rose-400">🎮 게임 선택</span>
            <span className="text-xs font-normal text-white/40">
              플레이할 보드게임을 선택하여 방을 개설하세요
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs font-medium text-white/40">
              총 {totalCount}개 게임 · 플레이 가능 {playableCount}개
            </span>
            <div className="relative w-full max-w-[240px]">
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="게임 이름, 태그로 검색..."
                aria-label="게임 검색"
                className="w-full rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
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
