import { useEffect, useRef } from "react";
import { deleteActiveRoom, upsertActiveRoom } from "@/lib/activeRooms/repository";

/**
 * Re-upsert cadence while a room stays in its waiting lobby. Comfortably
 * inside `ACTIVE_ROOM_STALE_MS` (90s) in `src/lib/activeRooms/repository.ts`
 * so a live room never flickers out of the dashboard's room-list panel
 * between heartbeats.
 */
const HEARTBEAT_INTERVAL_MS = 25_000;

interface UseActiveRoomListingInput {
  /** Registry id, e.g. `"coyote"` — must match `GameMeta.id`. */
  gameId: string;
  /** Null/empty while no room exists yet (e.g. still on the "choose" screen). */
  roomCode: string | null | undefined;
  /** Only the host's tab should publish the listing — avoids duplicate upserts from every occupant. */
  isHost: boolean;
  /** True only while the room is joinable (pre-start lobby, not full, not already playing). */
  isWaiting: boolean;
  hostName?: string | null;
  playerCount: number;
  maxPlayers: number;
}

/**
 * Publishes (and heartbeats) this room into the shared `active_rooms` table
 * so it can appear in the desktop lobby dashboard's "실시간 활성 대기실" panel,
 * and removes it once the room is no longer joinable. Purely additive and
 * best-effort — every call it makes swallows its own errors (see
 * `src/lib/activeRooms/repository.ts`), so this can never affect gameplay
 * even if the table doesn't exist yet in a given Supabase project.
 */
export function useActiveRoomListing({
  gameId,
  roomCode,
  isHost,
  isWaiting,
  hostName,
  playerCount,
  maxPlayers,
}: UseActiveRoomListingInput): void {
  // Heartbeat reads the latest counts without needing to restart the
  // interval every time they change. Synced in its own effect (not during
  // render) per the rules of hooks.
  const latest = useRef({ hostName, playerCount, maxPlayers });
  useEffect(() => {
    latest.current = { hostName, playerCount, maxPlayers };
  });

  const shouldPublish = isHost && isWaiting && !!roomCode;

  useEffect(() => {
    if (!shouldPublish || !roomCode) return;

    const publish = () => {
      void upsertActiveRoom({
        gameId,
        roomCode,
        hostName: latest.current.hostName,
        playerCount: latest.current.playerCount,
        maxPlayers: latest.current.maxPlayers,
      });
    };

    publish();
    const timer = setInterval(publish, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      void deleteActiveRoom(gameId, roomCode);
    };
  }, [gameId, roomCode, shouldPublish]);
}
