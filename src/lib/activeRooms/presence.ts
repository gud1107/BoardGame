import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import type { ActiveRoomRecord } from "./types";

/**
 * Table-free room list over Supabase Realtime Presence (2026-10-07).
 *
 * The `active_rooms` table only exists once someone runs
 * `supabase/base_tables.sql` on the live project — production had never
 * had it, so the 🌐 공개방 list stayed empty no matter how many rooms were
 * open. Presence needs no schema (it's the same Realtime service every
 * online game already uses for its own room channel): each hosting tab
 * `track()`s its waiting room on one shared lobby channel and every
 * watcher reads the presence state. Presence also drops a host the moment
 * its tab disconnects, so there's no staleness window. `useActiveRooms`
 * merges this with the table rows, so both paths work side by side.
 *
 * One channel per tab, opened on first use and kept for the tab's
 * lifetime: supabase-js hands back the existing channel for a repeated
 * topic, so the lobby list and a hosted room share it — and since every
 * tab must use the same topic to see each other, it can't be torn down and
 * reopened safely (the re-`channel()` call would get the half-closed one).
 */
const TOPIC = "lobby-active-rooms-v1";

interface PresenceRoom {
  id: string;
  gameId: string;
  roomCode: string;
  hostName: string | null;
  playerCount: number;
  maxPlayers: number;
  isPublic: boolean;
  title: string | null;
}

const tabKey = `tab-${Math.random().toString(36).slice(2, 12)}`;
let channel: RealtimeChannel | null = null;
let subscribed = false;
let myRoom: PresenceRoom | null = null;
const listeners = new Set<(rooms: ActiveRoomRecord[]) => void>();

function currentRooms(): ActiveRoomRecord[] {
  if (!channel) return [];
  const now = new Date().toISOString();
  const byId = new Map<string, ActiveRoomRecord>();
  for (const entries of Object.values(channel.presenceState<PresenceRoom>())) {
    for (const e of entries) {
      if (typeof e.gameId !== "string" || typeof e.roomCode !== "string") continue;
      byId.set(e.id, {
        id: e.id,
        gameId: e.gameId,
        roomCode: e.roomCode,
        hostName: e.hostName ?? null,
        playerCount: Number(e.playerCount) || 1,
        maxPlayers: Number(e.maxPlayers) || 1,
        isPublic: e.isPublic === true,
        title: e.title ?? null,
        updatedAt: now,
      });
    }
  }
  return [...byId.values()];
}

function emit(): void {
  const rooms = currentRooms();
  listeners.forEach((l) => l(rooms));
}

function ensureChannel(): boolean {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!channel) {
    try {
      channel = supabase.channel(TOPIC, { config: { presence: { key: tabKey } } });
      channel
        .on("presence", { event: "sync" }, emit)
        .subscribe((status) => {
          subscribed = status === "SUBSCRIBED";
          if (subscribed && myRoom) void channel?.track(myRoom);
          if (subscribed) emit();
        });
    } catch {
      channel = null;
    }
  }
  return channel !== null;
}

/** Live presence room list; returns an unsubscribe. Never throws. */
export function watchPresenceRooms(onChange: (rooms: ActiveRoomRecord[]) => void): () => void {
  if (!ensureChannel()) return () => {};
  listeners.add(onChange);
  onChange(currentRooms());
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Announces (or updates) this tab's hosted waiting room. `withdraw` takes it
 * back off the list. Best-effort, never throws.
 */
export function announcePresenceRoom(): {
  update: (room: Omit<PresenceRoom, "id">) => void;
  withdraw: () => void;
} {
  const ok = ensureChannel();
  return {
    update(room) {
      if (!ok) return;
      myRoom = { ...room, id: `${room.gameId}:${room.roomCode}` };
      if (subscribed) void channel?.track(myRoom).catch(() => {});
    },
    withdraw() {
      if (!ok) return;
      myRoom = null;
      if (subscribed) void channel?.untrack().catch(() => {});
    },
  };
}
