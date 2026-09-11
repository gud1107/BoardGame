"use client";

import Link from "next/link";
import { getGameMeta } from "@/games/registry";
import type { ActiveRoomRecord } from "@/lib/activeRooms/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Desktop dashboard right rail's top section (see `src/app/page.tsx`) — the
 * live cross-game "누가 지금 방을 열어놨는지" list. Sourced from the real
 * `active_rooms` table (`src/lib/activeRooms/`); every online game
 * publishes its own room here while in its waiting-for-players lobby.
 *
 * Renders an honest empty state rather than fabricated rows when there's
 * genuinely nothing to show (no configured Supabase project, table not yet
 * created in a given deployment, or simply no rooms open right now) — see
 * `supabase/schema.sql`'s `active_rooms` block for the "user must run this
 * SQL once" caveat this project already uses for every other table.
 */
export default function ActiveRoomsPanel({ rooms }: { rooms: ActiveRoomRecord[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 pb-2">
        <span className="text-xs font-bold text-emerald-400">⚡ 실시간 참가 가능 방</span>
        <span className="text-[10px] text-white/40">{rooms.length}개 룸 오픈</span>
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {!isSupabaseConfigured() ? (
          <p className="py-8 text-center text-xs leading-relaxed text-white/30">
            실시간 방 목록은 Supabase 연동이 필요해요.
          </p>
        ) : rooms.length === 0 ? (
          <p className="py-8 text-center text-xs leading-relaxed text-white/30">
            지금 열려있는 방이 없어요.
            <br />
            게임을 골라 직접 방을 만들어보세요!
          </p>
        ) : (
          rooms.map((room) => {
            const meta = getGameMeta(room.gameId);
            const full = room.playerCount >= room.maxPlayers;
            return (
              <Link
                key={room.id}
                href={`/games/${room.gameId}?room=${room.roomCode}`}
                className={`flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-emerald-400/40 hover:bg-emerald-500/5 ${
                  full ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <span className="text-xl leading-none" aria-hidden>
                  {meta?.thumbnail.emoji ?? "🎲"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{meta?.name ?? room.gameId}</p>
                  <p className="truncate text-[10px] text-white/40">
                    {room.hostName ? `${room.hostName}님의 방 · ` : ""}#{room.roomCode}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    full ? "bg-white/10 text-white/40" : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {room.playerCount}/{room.maxPlayers}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
