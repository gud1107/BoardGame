"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import { sanitizeAvatar, type AvatarProfile } from "./avatar";
import { useMyCharacter } from "./myCharacter";

/**
 * Shares each player's chosen character with the rest of the room.
 *
 * One small presence channel per room (`room-chars:<gameId>:<roomCode>`), opened
 * by `useActiveRoomListing` — which every online game already calls on every
 * client — so no game's own room protocol changes. Each tab tracks
 * `{ name, look }`; the 3D tables look players up by the seat name they
 * display (`useRoomCharacter`). Bots and players without a choice simply
 * aren't in the map and get their seat's default look.
 *
 * Keyed by name because that's what every 3D board already has per seat; two
 * people sharing one nickname in a room would share a look (the last one wins).
 */

interface RoomCharactersState {
  byName: Record<string, AvatarProfile>;
}

export const useRoomCharacters = create<RoomCharactersState>(() => ({ byName: {} }));

const key = (name: string) => name.trim();

/** The character the player shown as `name` chose, if any. */
export function useRoomCharacter(name: string | null | undefined): AvatarProfile | undefined {
  return useRoomCharacters((s) => (name ? s.byName[key(name)] : undefined));
}

/** Non-hook lookup for boards that resolve many seats inside one render. */
export function roomCharacterOf(byName: Record<string, AvatarProfile>, name: string | null | undefined): AvatarProfile | undefined {
  return name ? byName[key(name)] : undefined;
}

interface Tracked {
  name: string;
  look: AvatarProfile | null;
}

/**
 * Joins the room's character channel while `roomCode` is set and publishes this
 * tab's look under `myName` (the occupant entry with this device's id).
 */
export function useRoomCharacterSync({
  gameId,
  roomCode,
  occupants,
}: {
  gameId: string;
  roomCode: string | null | undefined;
  occupants?: readonly { deviceId: string; name: string }[];
}): void {
  const character = useMyCharacter((s) => s.character);
  const init = useMyCharacter((s) => s.init);
  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const myName = occupants?.find((o) => o.deviceId === deviceId)?.name ?? "";

  useEffect(() => {
    void init();
  }, [init]);

  // channel lifetime = the room
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !roomCode || !deviceId) return;
    let channel: RealtimeChannel | null = null;
    try {
      channel = supabase.channel(`room-chars:${gameId}:${roomCode}`, { config: { presence: { key: deviceId } } });
    } catch {
      return;
    }
    const ch = channel;
    ch.on("presence", { event: "sync" }, () => {
      const byName: Record<string, AvatarProfile> = {};
      for (const entries of Object.values(ch.presenceState<Tracked>())) {
        for (const e of entries) {
          if (typeof e.name !== "string" || !e.name.trim()) continue;
          const look = sanitizeAvatar(e.look);
          if (Object.keys(look).length) byName[key(e.name)] = look;
        }
      }
      useRoomCharacters.setState({ byName });
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") void publish(ch);
    });
    current = ch;
    return () => {
      if (current === ch) current = null;
      void supabase.removeChannel(ch);
      useRoomCharacters.setState({ byName: {} });
    };
  }, [gameId, roomCode, deviceId]);

  // (re)publish whenever my name or my character changes
  useEffect(() => {
    latest = { name: myName, look: character };
    if (current) void publish(current);
  }, [myName, character]);
}

let current: RealtimeChannel | null = null;
let latest: Tracked = { name: "", look: null };

async function publish(ch: RealtimeChannel): Promise<void> {
  if (!latest.name) return;
  try {
    await ch.track(latest);
  } catch {
    // Best-effort — the others just see this seat's default look.
  }
}
