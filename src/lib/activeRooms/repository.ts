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
  /** Absent when the live table predates the 2026-10-07 `is_public` column. */
  is_public?: boolean | null;
  /** Absent when the live table predates the 2026-10-07 `title` column. */
  title?: string | null;
  updated_at: string;
}

const BASE_COLUMNS = "id, game_id, room_code, host_name, player_count, max_players, updated_at";

function fromRow(row: ActiveRoomRow): ActiveRoomRecord {
  return {
    id: row.id,
    gameId: row.game_id,
    roomCode: row.room_code,
    hostName: row.host_name,
    playerCount: row.player_count,
    maxPlayers: row.max_players,
    // A table without the column can't tell 공개 from 비공개, so nothing is
    // advertised as public until the migration in schema.sql is applied.
    isPublic: row.is_public === true,
    title: row.title?.trim() || null,
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
  isPublic: boolean;
  title?: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const row = {
      id: `${input.gameId}:${input.roomCode}`,
      game_id: input.gameId,
      room_code: input.roomCode,
      host_name: input.hostName ?? null,
      player_count: input.playerCount,
      max_players: input.maxPlayers,
      updated_at: new Date().toISOString(),
    };
    // Newest columns first; a table created before `title` / `is_public`
    // existed rejects the unknown column, so step down rather than dropping
    // the listing entirely (the room stays findable by code).
    const attempts = [
      { ...row, is_public: input.isPublic, title: input.title ?? null },
      { ...row, is_public: input.isPublic },
      row,
    ];
    for (const attempt of attempts) {
      const { error } = await supabase.from("active_rooms").upsert(attempt);
      if (!error) break;
    }
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
    const query = (columns: string) =>
      supabase.from("active_rooms").select(columns).order("updated_at", { ascending: false }).limit(100);
    let { data, error } = await query(`${BASE_COLUMNS}, is_public, title`);
    if (error) ({ data, error } = await query(`${BASE_COLUMNS}, is_public`));
    if (error) ({ data, error } = await query(BASE_COLUMNS));
    if (error || !data) return [];
    return (data as unknown as ActiveRoomRow[]).map(fromRow).filter((r) => isFresh(r.updatedAt));
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
    const { data, error } = await supabase.from("active_rooms").select(BASE_COLUMNS).eq("room_code", roomCode.trim());
    if (error || !data) return [];
    return (data as unknown as ActiveRoomRow[]).map(fromRow).filter((r) => isFresh(r.updatedAt));
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

  // Unique topic per subscriber: supabase-js hands back an already-joined
  // channel for a repeated topic, and adding `.on()` to that one throws —
  // e.g. when a game's room-creation screen remounts before the old channel
  // has finished tearing down.
  const channel = supabase
    .channel(`active-rooms-watch-${Math.random().toString(36).slice(2, 10)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "active_rooms" }, refresh)
    .subscribe();

  refresh();

  return () => {
    void supabase.removeChannel(channel);
  };
}
