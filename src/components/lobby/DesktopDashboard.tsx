"use client";

import { useMemo } from "react";
import type { GameMeta } from "@/games/types";
import { useActiveRooms } from "@/games/shared/room/useActiveRooms";
import LobbyProfileCard from "./LobbyProfileCard";
import ActiveRoomsPanel from "./ActiveRoomsPanel";
import PatchNotesSummaryPanel from "./PatchNotesSummaryPanel";
import CompactGameCard from "./CompactGameCard";

/**
 * Desktop-only (xl+, ≥1280px) zero-scroll 3-column lobby dashboard —
 * profile & quick actions / compact game catalog / live rooms & patch notes,
 * all inside one `100dvh`-minus-header viewport with no outer page scroll
 * (see `src/app/page.tsx`). Confirmed via AskUserQuestion (2026-09-12) to be
 * desktop-only: every viewport below `xl` keeps the existing, separately
 * hand-tuned mobile/tablet layout completely untouched — this component
 * renders alongside it, toggled purely by the `hidden xl:flex` wrapper in
 * the caller.
 *
 * Reuses the exact same `query`/`filtered` state `page.tsx` already computes
 * for the existing layout, so search results (and the player-count/genre
 * filters applied upstream) always agree between both layouts — there is no
 * separate desktop-only filter state to drift out of sync.
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
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        {/* 좌측: 프로필 & 퀵 액션 */}
        <aside className="col-span-3 min-h-0">
          <LobbyProfileCard />
        </aside>

        {/* 중앙: 전체 게임 컴팩트 그리드 (내부 스크롤) */}
        <main
          id="lobby-game-grid"
          className="col-span-6 flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-3"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-2">
            <span className="shrink-0 text-xs font-bold text-rose-400">
              🎮 전체 게임 목록 ({totalCount}종 · 플레이 가능 {playableCount}종)
            </span>
            <div className="relative w-full max-w-[220px]">
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="게임 이름, 태그로 검색..."
                aria-label="게임 검색"
                className="w-full rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {games.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {games.map((game) => (
                  <CompactGameCard key={game.id} game={game} liveRoomCount={liveCountByGame.get(game.id) ?? 0} />
                ))}
              </div>
            ) : (
              <p className="py-16 text-center text-xs text-white/40">검색 결과가 없습니다.</p>
            )}
          </div>
        </main>

        {/* 우측: 실시간 대기실 & 패치노트 */}
        <section className="col-span-3 flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-[3]">
            <ActiveRoomsPanel rooms={rooms} />
          </div>
          <div className="shrink-0 flex-[2]">
            <PatchNotesSummaryPanel />
          </div>
        </section>
      </div>
    </div>
  );
}
