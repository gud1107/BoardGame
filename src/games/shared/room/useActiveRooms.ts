"use client";

import { useEffect, useState } from "react";
import { listActiveRooms, subscribeActiveRooms } from "@/lib/activeRooms/repository";
import type { ActiveRoomRecord } from "@/lib/activeRooms/types";

/**
 * Periodic re-fetch on top of the Realtime subscription. Re-applies the
 * staleness filter even when no DB write happens (a host's tab can die with
 * no event ever firing), and keeps the 🌐 공개방 list live on a project
 * where `active_rooms` isn't in the Realtime publication yet.
 */
const REFRESH_MS = 15_000;

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
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") void listActiveRooms().then(setRooms);
    }, REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(refresh);
    };
  }, []);

  return rooms;
}
