"use client";

import { useEffect } from "react";
import { useRoomCharacters } from "@/lib/character/roomCharacters";
import { cardBackSkin, tableSkin, type CardBackSkin, type TableSkin } from "./catalog";
import { useMySkin } from "./mySkin";

/**
 * Which skin to draw — the one rule both the 2D boards and the 3D tables follow:
 * - Table: the host's table skin, for everyone in the room. Outside a room (or
 *   before the host's presence arrives) it's my own pick.
 * - Card back: a hand of cards wears its owner's back. Mine is my pick right
 *   away; anyone else's comes from the room presence. Bots and players who
 *   never picked one get the game's own back (null).
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

/** `owner` = the seat name the board shows; `isMe` when it's this device's own hand. */
export function useCardBackSkin(owner: string | null | undefined, isMe = false): CardBackSkin | null {
  useHydrate();
  const key = owner?.trim() ?? "";
  const theirs = useRoomCharacters((s) => (key ? s.skinsByName[key]?.back : undefined));
  const myName = useRoomCharacters((s) => s.myName);
  const mine = useMySkin((s) => s.skin.back);
  if (isMe || (key && key === myName)) return cardBackSkin(mine);
  return cardBackSkin(theirs);
}
