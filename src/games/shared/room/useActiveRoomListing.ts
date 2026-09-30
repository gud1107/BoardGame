import { useEffect, useRef } from "react";
import { deleteActiveRoom, upsertActiveRoom } from "@/lib/activeRooms/repository";
import { trackGameEvent } from "@/lib/analytics/gameEvents";

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
  /** True while a match is in progress (`phase === "playing"`) — its rising edge is logged as a game start. */
  isPlaying?: boolean;
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
  isPlaying = false,
  hostName,
  playerCount,
  maxPlayers,
}: UseActiveRoomListingInput): void {
  useRoomFunnelEvents({ gameId, roomCode, isHost, isWaiting, isPlaying });

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

/**
 * Funnel analytics for /admin/games, derived from the same room state every
 * online game already passes this hook (so no per-game instrumentation):
 * the first time this tab reaches a room's waiting lobby it's a
 * `room_create` (host) or `join` (guest); each entry into `playing` is one
 * `game_start` (rematches count again), and leaving `playing` again — the
 * match finishing, or the room being left — is its `game_end`. A tab that lands straight in
 * `playing` without having been in this room's waiting lobby — a reload or
 * reconnect mid-match — logs nothing. Only real starts bump the public play
 * count — see `supabase/game_events.sql`.
 */
function useRoomFunnelEvents({
  gameId,
  roomCode,
  isHost,
  isWaiting,
  isPlaying,
}: {
  gameId: string;
  roomCode: string | null | undefined;
  isHost: boolean;
  isWaiting: boolean;
  isPlaying: boolean;
}): void {
  const enteredRoom = useRef<string | null>(null);
  const wasPlaying = useRef(false);

  useEffect(() => {
    if (!roomCode || !isWaiting || enteredRoom.current === roomCode) return;
    enteredRoom.current = roomCode;
    trackGameEvent(gameId, isHost ? "room_create" : "join", { roomCode, isHost });
  }, [gameId, roomCode, isHost, isWaiting]);

  // Room code of the match this tab is currently counting as started, so
  // the matching `game_end` still carries it even if the code has already
  // been cleared (leaving the room tears both down in the same render).
  const playingRoom = useRef<string | null>(null);

  useEffect(() => {
    const started = isPlaying && !wasPlaying.current;
    const stopped = !isPlaying && wasPlaying.current;
    wasPlaying.current = isPlaying;
    if (started && roomCode && enteredRoom.current === roomCode) {
      playingRoom.current = roomCode;
      trackGameEvent(gameId, "game_start", { roomCode, isHost });
    } else if (stopped && playingRoom.current) {
      trackGameEvent(gameId, "game_end", { roomCode: playingRoom.current, isHost });
      playingRoom.current = null;
    }
  }, [gameId, roomCode, isHost, isPlaying]);

  // Navigating away mid-match unmounts without `isPlaying` ever falling.
  const latest = useRef({ gameId, isHost });
  useEffect(() => {
    latest.current = { gameId, isHost };
  });
  useEffect(
    () => () => {
      if (playingRoom.current) {
        trackGameEvent(latest.current.gameId, "game_end", { roomCode: playingRoom.current, isHost: latest.current.isHost });
      }
    },
    [],
  );
}
