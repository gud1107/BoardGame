import { getSupabase } from "@/lib/supabase/client";
import type { ActiveRoomRecord } from "./types";

/**
 * Rows older than this are treated as abandoned (host's tab closed without
 * ever sending the delete — crash, network loss, etc.) and filtered out
 * client-side on every read. Paired with `HEARTBEAT_INTERVAL_MS` in
 * `useActiveRoomListing.ts`, which re-upserts well inside this window.
 */
export const ACTIVE_ROOM_STALE_MS = 90_000;

interface ActiveRoomRow {
  id: string;
  game_id: string;
  room_code: string;
  host_name: string | null;
  player_count: number;
  max_players: number;
  updated_at: string;
}

function fromRow(row: ActiveRoomRow): ActiveRoomRecord {
  return {
    id: row.id,
    gameId: row.game_id,
    roomCode: row.room_code,
    hostName: row.host_name,
    playerCount: row.player_count,
    maxPlayers: row.max_players,
    updatedAt: row.updated_at,
  };
}

function isFresh(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() < ACTIVE_ROOM_STALE_MS;
}

/**
 * Registers or heartbeats a joinable room. Never throws — best-effort only,
 * same "live delivery already happened elsewhere" convention as
 * `src/lib/chat/history.ts`'s `persistMessage`. Missing table (schema.sql
 * not yet applied to the live project) just means the panel stays empty,
 * nothing in this app depends on it succeeding.
 */
export async function upsertActiveRoom(input: {
  gameId: string;
  roomCode: string;
  hostName?: string | null;
  playerCount: number;
  maxPlayers: number;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("active_rooms").upsert({
      id: `${input.gameId}:${input.roomCode}`,
      game_id: input.gameId,
      room_code: input.roomCode,
      host_name: input.hostName ?? null,
      player_count: input.playerCount,
      max_players: input.maxPlayers,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort only.
  }
}

/** Removes a room's listing (game started, room closed, host left). */
export async function deleteActiveRoom(gameId: string, roomCode: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("active_rooms").delete().eq("id", `${gameId}:${roomCode}`);
  } catch {
    // Best-effort only.
  }
}

/** Current joinable rooms, freshest first, with stale (abandoned) rows filtered out. Never throws. */
export async function listActiveRooms(): Promise<ActiveRoomRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("active_rooms")
      .select("id, game_id, room_code, host_name, player_count, max_players, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return (data as ActiveRoomRow[]).map(fromRow).filter((r) => isFresh(r.updatedAt));
  } catch {
    return [];
  }
}

/**
 * Rooms matching a bare room code, across every game — powers the lobby
 * dashboard's "초대 코드로 즉시 입장" quick action, which only has a code (not
 * a game id) to go on. Usually resolves to exactly one row since each game
 * generates its own random code independently, but a cross-game collision
 * is possible, so callers must handle 0/1/many.
 */
export async function findActiveRoomsByCode(roomCode: string): Promise<ActiveRoomRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("active_rooms")
      .select("id, game_id, room_code, host_name, player_count, max_players, updated_at")
      .eq("room_code", roomCode.trim());
    if (error || !data) return [];
    return (data as ActiveRoomRow[]).map(fromRow).filter((r) => isFresh(r.updatedAt));
  } catch {
    return [];
  }
}

/**
 * Live-subscribes to every change on `active_rooms` and calls `onChange`
 * with a freshly re-fetched, stale-filtered list on each event. Returns an
 * unsubscribe function; a no-op one if Supabase isn't configured. Re-fetches
 * rather than patching the payload in-place so the staleness filter always
 * applies uniformly (a row can go from fresh to stale without any DB event
 * firing at all).
 */
export function subscribeActiveRooms(onChange: (rooms: ActiveRoomRecord[]) => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const refresh = () => {
    void listActiveRooms().then(onChange);
  };

  const channel = supabase
    .channel("active-rooms-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "active_rooms" }, refresh)
    .subscribe();

  refresh();

  return () => {
    void supabase.removeChannel(channel);
  };
}
