"use client";

import { useEffect, useMemo, useState } from "react";
import { listActiveRooms, subscribeActiveRooms } from "@/lib/activeRooms/repository";
import { watchPresenceRooms } from "@/lib/activeRooms/presence";
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
 *
 * Two sources merged by room id: the `active_rooms` table and the
 * table-free Presence channel (`presence.ts`) — the latter is what keeps
 * the list working on a project where the table was never created.
 * Presence wins on a duplicate since it's live.
 */
export function useActiveRooms(): ActiveRoomRecord[] {
  const [rooms, setRooms] = useState<ActiveRoomRecord[]>([]);
  const [presenceRooms, setPresenceRooms] = useState<ActiveRoomRecord[]>([]);

  useEffect(() => watchPresenceRooms(setPresenceRooms), []);

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

  return useMemo(() => {
    if (presenceRooms.length === 0) return rooms;
    const byId = new Map(rooms.map((r) => [r.id, r]));
    for (const r of presenceRooms) byId.set(r.id, r);
    return [...byId.values()];
  }, [rooms, presenceRooms]);
}
