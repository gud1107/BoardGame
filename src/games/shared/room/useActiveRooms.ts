"use client";

import { useEffect, useState } from "react";
import { ACTIVE_ROOM_STALE_MS, subscribeActiveRooms } from "@/lib/activeRooms/repository";
import type { ActiveRoomRecord } from "@/lib/activeRooms/types";

/**
 * Re-applies the staleness filter even when no DB write happens — a room
 * can go quiet (host's tab died) with no event ever firing, so this is the
 * only thing that eventually clears it out of the panel client-side.
 */
const RESTALE_CHECK_MS = 15_000;

/**
 * Live list of every currently-joinable room across all games, for the
 * desktop lobby dashboard's "실시간 활성 대기실" panel and each game card's
 * live room-count badge (see `src/app/page.tsx`). One shared subscription —
 * call this once at the page level and pass the result down, rather than
 * from every consumer, to avoid opening duplicate Realtime channels.
 */
export function useActiveRooms(): ActiveRoomRecord[] {
  const [rooms, setRooms] = useState<ActiveRoomRecord[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeActiveRooms(setRooms);
    const restale = setInterval(() => {
      setRooms((prev) =>
        prev.filter((r) => Date.now() - new Date(r.updatedAt).getTime() < ACTIVE_ROOM_STALE_MS),
      );
    }, RESTALE_CHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(restale);
    };
  }, []);

  return rooms;
}
