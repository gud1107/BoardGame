import { useEffect, useRef } from "react";
import { deleteActiveRoom, upsertActiveRoom } from "@/lib/activeRooms/repository";
import { announcePresenceRoom } from "@/lib/activeRooms/presence";
import {
  clearHostedRoom,
  getRoomTitle,
  getRoomVisibility,
  normalizeRoomTitle,
  setHostedRoom,
  subscribeRoomSettings,
} from "@/lib/activeRooms/visibility";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { pushRoomToast } from "@/lib/activeRooms/roomToasts";

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
  /**
   * Who's in the room (presence occupants — real devices, never bots). Lets
   * the waiting room toast the nickname of whoever joins/leaves; without it
   * only the join/leave sounds play, off `playerCount` alone.
   */
  occupants?: readonly RoomOccupant[];
}

interface RoomOccupant {
  deviceId: string;
  name: string;
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
  occupants,
}: UseActiveRoomListingInput): void {
  useRoomFunnelEvents({ gameId, roomCode, isHost, isWaiting, isPlaying });
  useWaitingRoomArrivals({ roomCode, isWaiting, playerCount, occupants });

  // Heartbeat reads the latest counts without needing to restart the
  // interval every time they change. Synced in its own effect (not during
  // render) per the rules of hooks.
  const latest = useRef({ hostName, playerCount, maxPlayers });
  useEffect(() => {
    latest.current = { hostName, playerCount, maxPlayers };
  });

  const shouldPublish = isHost && isWaiting && !!roomCode;
  // Lets a seat filling up reach the room lists now, not at the next heartbeat.
  const publishNow = useRef<(() => void) | null>(null);
  useEffect(() => {
    publishNow.current?.();
  }, [hostName, playerCount, maxPlayers]);

  useEffect(() => {
    if (!shouldPublish || !roomCode) return;

    const hosted = { gameId, roomCode };
    setHostedRoom(hosted);

    // 🌐/🔒 and the title are read fresh on every publish — set on the
    // room-creation screen (`RulebookGate`), changeable from the waiting
    // room via the global `HostedRoomControls` pill.
    // Table row + table-free Presence announcement (see presence.ts — the
    // live project may not have the `active_rooms` table at all).
    const presence = announcePresenceRoom();
    const publish = () => {
      const room = {
        gameId,
        roomCode,
        hostName: latest.current.hostName ?? null,
        playerCount: latest.current.playerCount,
        maxPlayers: latest.current.maxPlayers,
        isPublic: getRoomVisibility(gameId) === "public",
        title: normalizeRoomTitle(getRoomTitle(gameId)),
      };
      void upsertActiveRoom(room);
      presence.update(room);
    };

    publish();
    publishNow.current = publish;
    const timer = setInterval(publish, HEARTBEAT_INTERVAL_MS);

    // Re-publish shortly after a settings change (debounced for title typing).
    let last = `${getRoomVisibility(gameId)}|${getRoomTitle(gameId)}`;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeRoomSettings(() => {
      const next = `${getRoomVisibility(gameId)}|${getRoomTitle(gameId)}`;
      if (next === last) return;
      last = next;
      clearTimeout(pending);
      pending = setTimeout(publish, 600);
    });

    return () => {
      clearInterval(timer);
      clearTimeout(pending);
      unsubscribe();
      clearHostedRoom(hosted);
      presence.withdraw();
      publishNow.current = null;
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

/**
 * After entering a room, the seat count can still jump while this tab's
 * state syncs in (a guest first sees only itself) — those aren't real
 * arrivals, so diffs inside this window only move the baseline.
 */
const ROOM_SOUND_SETTLE_MS = 1500;

/**
 * Waiting-room arrivals (2026-10-08), for every online game at once since
 * they all pass their seats through here: a doorbell chime when this tab
 * enters a room's waiting lobby, a fanfare pop + "OO님이 입장했어요" toast
 * when someone else joins, a knock + toast when someone leaves. Silent once
 * the match starts; sounds follow the site-wide SFX mute like every other
 * `soundEngine` effect, toasts show regardless.
 */
function useWaitingRoomArrivals({
  roomCode,
  isWaiting,
  playerCount,
  occupants,
}: {
  roomCode: string | null | undefined;
  isWaiting: boolean;
  playerCount: number;
  occupants?: readonly RoomOccupant[];
}): void {
  const room = useRef<{ code: string; count: number; people: Map<string, string>; settleUntil: number } | null>(null);
  // Content key, so a fresh-but-identical presence array doesn't re-run the diff.
  const occupantKey = occupants ? occupants.map((o) => `${o.deviceId}\u0000${o.name}`).join("\u0001") : null;
  const latestOccupants = useRef(occupants);
  useEffect(() => {
    latestOccupants.current = occupants;
  });

  useEffect(() => {
    const list = latestOccupants.current;
    const people = new Map((list ?? []).map((o) => [o.deviceId, o.name]));
    if (!roomCode || !isWaiting) {
      // Leaving the lobby (match start / room left) — the next lobby visit,
      // even of the same room after a match, starts a fresh baseline.
      if (!roomCode) room.current = null;
      else if (room.current) Object.assign(room.current, { count: playerCount, people });
      return;
    }
    const now = Date.now();
    if (room.current?.code !== roomCode) {
      room.current = { code: roomCode, count: playerCount, people, settleUntil: now + ROOM_SOUND_SETTLE_MS };
      getSoundEngine().playRoomJoinChime();
      return;
    }
    const prev = room.current;
    room.current = { ...prev, count: playerCount, people };
    if (now < prev.settleUntil) return;

    let joined = 0;
    let left = 0;
    if (list) {
      people.forEach((name, id) => {
        if (prev.people.has(id)) return;
        joined++;
        pushRoomToast("join", name);
      });
      prev.people.forEach((name, id) => {
        if (people.has(id)) return;
        left++;
        pushRoomToast("leave", name);
      });
    } else if (playerCount > prev.count) joined = 1;
    else if (playerCount < prev.count) left = 1;

    if (joined > 0) getSoundEngine().playRoomJoinPop();
    else if (left > 0) getSoundEngine().playRoomLeave();
  }, [roomCode, isWaiting, playerCount, occupantKey]);
}
