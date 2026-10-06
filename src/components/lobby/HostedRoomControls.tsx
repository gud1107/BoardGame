"use client";

import { useState } from "react";
import { normalizeRoomTitle, useHostedRoom, useRoomTitle, useRoomVisibility } from "@/lib/activeRooms/visibility";
import RoomListingSettings from "./RoomListingSettings";

/**
 * Floating "방 설정" pill for the host of a waiting room (2026-10-07) —
 * switch 🌐 공개방 / 🔒 비공개방 and edit the room title after the room
 * already exists. Mounted once in the root layout; it shows itself only
 * while `useActiveRoomListing` reports this tab is hosting a pre-start
 * room, so none of the 35 games' (all different) waiting screens needed
 * changes. Changes re-publish the listing within ~1s.
 */
export default function HostedRoomControls() {
  const hosted = useHostedRoom();
  if (!hosted) return null;
  // Remount per room so the panel starts collapsed for each new room.
  return <HostedRoomPill key={`${hosted.gameId}:${hosted.roomCode}`} gameId={hosted.gameId} />;
}

function HostedRoomPill({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const visibility = useRoomVisibility(gameId);
  const title = normalizeRoomTitle(useRoomTitle(gameId));
  const isPublic = visibility === "public";

  return (
    <div
      className="fixed right-3 z-40 flex flex-col items-end gap-2"
      style={{ top: "calc(var(--site-header-h, 96px) + 8px)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex max-w-[60vw] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur transition ${
          isPublic
            ? "border-emerald-400/50 bg-emerald-950/80 text-emerald-200 light:border-emerald-300 light:bg-emerald-50/95 light:text-emerald-800"
            : "border-rose-400/50 bg-rose-950/80 text-rose-200 light:border-rose-300 light:bg-rose-50/95 light:text-rose-800"
        }`}
      >
        <span>{isPublic ? "🌐 공개방" : "🔒 비공개방"}</span>
        {isPublic && title && <span className="truncate font-medium opacity-80">· {title}</span>}
        <span className="opacity-60">{open ? "▲" : "⚙️"}</span>
      </button>
      {open && (
        <div className="w-72 rounded-2xl border border-white/10 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur light:border-slate-200 light:bg-white/95">
          <RoomListingSettings gameId={gameId} heading="방장 전용 · 대기실 공개 설정" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full rounded-lg border border-white/10 py-1.5 text-xs text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600"
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
