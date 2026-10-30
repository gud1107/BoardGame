"use client";

import { useEffect } from "react";
import { useRoomCharacters } from "@/lib/character/roomCharacters";
import { DEFAULT_SKIN, cardBackSkin, plateSkin, tableSkin, type CardBackSkin, type PlateSkin, type SkinChoice, type TableSkin } from "./catalog";
import { useMySkin } from "./mySkin";

/**
 * Which skin to draw — the one rule both the 2D boards and the 3D tables follow:
 * - Table: the host's table skin, for everyone in the room. Outside a room (or
 *   before the host's presence arrives) it's my own pick.
 * - Card back / name plate: a seat wears its owner's pick. Mine is my pick
 *   right away; anyone else's comes from the room presence. Bots and players
 *   who never picked one get the game's own look (null).
 */

function useHydrate(): void {
  const init = useMySkin((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
}

export function useTableSkin(): TableSkin | null {
  useHydrate();
  const hostTable = useRoomCharacters((s) => s.hostTable);
  const mine = useMySkin((s) => s.skin.table);
  return tableSkin(hostTable ?? mine);
}

/** The skins of the player shown as `owner`; `isMe` when it's this device's own seat. */
function useSeatSkin(owner: string | null | undefined, isMe: boolean): SkinChoice {
  useHydrate();
  const key = owner?.trim() ?? "";
  const theirs = useRoomCharacters((s) => (key ? s.skinsByName[key] : undefined));
  const myName = useRoomCharacters((s) => s.myName);
  const mine = useMySkin((s) => s.skin);
  if (isMe || (key && key === myName)) return mine;
  return theirs ?? DEFAULT_SKIN;
}

/** `owner` = the seat name the board shows; `isMe` when it's this device's own hand. */
export function useCardBackSkin(owner: string | null | undefined, isMe = false): CardBackSkin | null {
  return cardBackSkin(useSeatSkin(owner, isMe).back);
}

export function usePlateSkin(owner: string | null | undefined, isMe = false): PlateSkin | null {
  return plateSkin(useSeatSkin(owner, isMe).plate);
}
