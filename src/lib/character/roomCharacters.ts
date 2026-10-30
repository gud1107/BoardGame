"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import { sanitizeAvatar, type AvatarProfile } from "./avatar";
import { useMyCharacter } from "./myCharacter";
import { sanitizeSkin, type SkinChoice } from "@/lib/skins/catalog";
import { useMySkin } from "@/lib/skins/mySkin";

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
 *
 * The same entry carries the player's 🎨 skins (`src/lib/skins/`) and whether
 * that tab is the host: every table shows the host's table skin, every hand of
 * cards its owner's card back.
 */

interface RoomCharactersState {
  byName: Record<string, AvatarProfile>;
  skinsByName: Record<string, SkinChoice>;
  /** The host's table skin id; null while there's no room (or the host hasn't synced yet). */
  hostTable: string | null;
  /** The name this tab is tracked under in the room ("" outside a room). */
  myName: string;
}

export const useRoomCharacters = create<RoomCharactersState>(() => ({ byName: {}, skinsByName: {}, hostTable: null, myName: "" }));

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
  skin?: SkinChoice;
  host?: boolean;
}

/**
 * Joins the room's character channel while `roomCode` is set and publishes this
 * tab's look under `myName` (the occupant entry with this device's id).
 */
export function useRoomCharacterSync({
  gameId,
  roomCode,
  occupants,
  isHost = false,
}: {
  gameId: string;
  roomCode: string | null | undefined;
  occupants?: readonly { deviceId: string; name: string }[];
  isHost?: boolean;
}): void {
  const character = useMyCharacter((s) => s.character);
  const init = useMyCharacter((s) => s.init);
  const skin = useMySkin((s) => s.skin);
  const initSkin = useMySkin((s) => s.init);
  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const myName = occupants?.find((o) => o.deviceId === deviceId)?.name ?? "";

  useEffect(() => {
    void init();
    void initSkin();
  }, [init, initSkin]);

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
      const skinsByName: Record<string, SkinChoice> = {};
      let hostTable: string | null = null;
      for (const entries of Object.values(ch.presenceState<Tracked>())) {
        for (const e of entries) {
          if (typeof e.name !== "string" || !e.name.trim()) continue;
          const look = sanitizeAvatar(e.look);
          if (Object.keys(look).length) byName[key(e.name)] = look;
          const choice = sanitizeSkin(e.skin);
          skinsByName[key(e.name)] = choice;
          if (e.host === true) hostTable = choice.table;
        }
      }
      useRoomCharacters.setState({ byName, skinsByName, hostTable });
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") void publish(ch);
    });
    current = ch;
    return () => {
      if (current === ch) current = null;
      void supabase.removeChannel(ch);
      useRoomCharacters.setState({ byName: {}, skinsByName: {}, hostTable: null, myName: "" });
    };
  }, [gameId, roomCode, deviceId]);

  // (re)publish whenever my name, character, skin or host seat changes
  useEffect(() => {
    latest = { name: myName, look: character, skin, host: isHost };
    if (roomCode) useRoomCharacters.setState({ myName: key(myName) });
    if (current) void publish(current);
  }, [myName, character, skin, isHost, roomCode]);
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
