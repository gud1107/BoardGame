"use client";

import { useMemo, useState } from "react";
import { getGameMeta } from "@/games/registry";
import type { ActiveRoomRecord } from "@/lib/activeRooms/types";

/**
 * 🌐 공개방 browser (2026-10-07) — every waiting room whose host picked
 * "공개방" on the room-creation screen (`RulebookGate`), live from the
 * `active_rooms` table via `useActiveRooms`. Clicking a room (or ⚡ 빠른
 * 참가) goes through the same `?room=` deep link every online game already
 * supports for shared invite links, so the joiner lands on that game's
 * nickname step with the code pre-filled — no per-game join code needed.
 *
 * Two placements: the lobby (`gameId` omitted — all games, with a game
 * filter) and each game's room-creation screen (`gameId` set — that game
 * only). 🔒 비공개방 never appear here; they stay invite-code only.
 */
export default function PublicRoomBrowser({
  rooms,
  gameId,
  className = "",
}: {
  rooms: ActiveRoomRecord[];
  gameId?: string;
  className?: string;
}) {
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);

  const publicRooms = useMemo(
    () =>
      rooms
        .filter((r) => r.isPublic && (!gameId || r.gameId === gameId) && getGameMeta(r.gameId))
        // Joinable first, then the fullest (closest to starting).
        .sort((a, b) => Number(isFull(a)) - Number(isFull(b)) || b.playerCount - a.playerCount),
    [rooms, gameId],
  );

  const gameOptions = useMemo(() => [...new Set(publicRooms.map((r) => r.gameId))], [publicRooms]);
  const activeFilter = gameId || !gameOptions.includes(filter) ? "all" : filter;
  const shown = activeFilter === "all" ? publicRooms : publicRooms.filter((r) => r.gameId === activeFilter);

  const quickJoin = () => {
    const target = shown.find((r) => !isFull(r));
    if (target) {
      join(target);
    } else {
      setNotice(gameId ? "지금 들어갈 수 있는 공개방이 없어요. 직접 방을 만들어 보세요!" : "지금 들어갈 수 있는 공개방이 없어요. 게임을 골라 방을 만들어 보세요!");
    }
  };

  return (
    <section
      aria-label="공개방 목록"
      className={`flex w-full flex-col gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-left light:border-emerald-200 light:bg-emerald-50/60 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-emerald-200 light:text-emerald-800">🌐 {gameId ? "이 게임의 공개방" : "공개방"}</span>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 light:bg-emerald-100 light:text-emerald-700">
            {publicRooms.length > 0 && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />}
            {publicRooms.length}개 대기중
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!gameId && gameOptions.length > 1 && (
            <select
              value={activeFilter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="게임별 공개방 필터"
              className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-white/80 focus:border-emerald-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-700"
            >
              <option value="all">전체 게임</option>
              {gameOptions.map((id) => (
                <option key={id} value={id}>
                  {getGameMeta(id)?.name ?? id}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={quickJoin}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 active:scale-95"
          >
            ⚡ 빠른 참가
          </button>
        </div>
      </div>

      {notice && shown.every(isFull) && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/60 light:bg-white light:text-slate-600">{notice}</p>
      )}

      {shown.length > 0 ? (
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {shown.map((room) => (
            <li key={room.id} className="shrink-0">
              <RoomCard room={room} showGame={!gameId} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-1 text-xs text-white/40 light:text-slate-500">
          {gameId ? "아직 열린 공개방이 없어요. 공개방으로 만들면 여기에 바로 보여요." : "지금 열린 공개방이 없어요. 게임을 골라 🌐 공개방을 만들어 보세요!"}
        </p>
      )}
    </section>
  );
}

function RoomCard({ room, showGame }: { room: ActiveRoomRecord; showGame: boolean }) {
  const meta = getGameMeta(room.gameId);
  const full = isFull(room);
  return (
    <button
      type="button"
      disabled={full}
      onClick={() => join(room)}
      className={`flex w-48 flex-col gap-1.5 rounded-xl border p-2.5 text-left transition ${
        full
          ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-50 light:border-slate-200 light:bg-slate-50"
          : "border-white/10 bg-neutral-900/70 hover:border-emerald-400/60 active:scale-[0.98] light:border-slate-200 light:bg-white light:hover:border-emerald-400"
      }`}
    >
      {showGame && (
        <span className="truncate text-[11px] font-semibold text-amber-300 light:text-amber-700">
          {meta?.thumbnail.emoji} {meta?.name}
        </span>
      )}
      <span className="truncate text-sm font-bold text-white light:text-slate-900" title={room.title ?? undefined}>
        {room.title ?? (room.hostName ? `${room.hostName}님의 방` : "공개방")}
      </span>
      {room.title && room.hostName && <span className="-mt-1 truncate text-[11px] text-white/40 light:text-slate-500">방장 {room.hostName}</span>}
      <span className="flex items-center justify-between text-[11px]">
        <span className="text-white/50 light:text-slate-500">
          인원 <strong className={full ? "text-rose-400" : "text-emerald-400 light:text-emerald-600"}>{room.playerCount}</strong>/{room.maxPlayers}
        </span>
        <span className={`rounded-md px-2 py-0.5 font-bold ${full ? "bg-white/10 text-white/60 light:bg-slate-200 light:text-slate-500" : "bg-emerald-500 text-neutral-950"}`}>
          {full ? "만원" : "즉시입장 ➔"}
        </span>
      </span>
    </button>
  );
}

function isFull(room: ActiveRoomRecord): boolean {
  return room.maxPlayers > 0 && room.playerCount >= room.maxPlayers;
}

/** Full navigation (not a client route change) so the game re-reads `?room=` on mount. */
function join(room: ActiveRoomRecord): void {
  window.location.href = `/games/${room.gameId}?room=${encodeURIComponent(room.roomCode)}`;
}
