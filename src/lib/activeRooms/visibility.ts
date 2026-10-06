import { useSyncExternalStore } from "react";

/**
 * The host's 🌐 공개방 / 🔒 비공개방 choice for the next room they create in
 * a given game, picked on the shared room-creation screen (`RulebookGate`)
 * and read by `useActiveRoomListing` when it publishes the room. Kept per
 * game in localStorage so a host who always plays privately with friends
 * doesn't have to flip it every time. Defaults to public.
 */
export type RoomVisibility = "public" | "private";

const KEY_PREFIX = "room-visibility:";
const listeners = new Set<() => void>();
/** Session fallback for when localStorage is blocked (private windows etc.). */
const memory = new Map<string, RoomVisibility>();

export function getRoomVisibility(gameId: string): RoomVisibility {
  const remembered = memory.get(gameId);
  if (remembered) return remembered;
  try {
    return window.localStorage.getItem(KEY_PREFIX + gameId) === "private" ? "private" : "public";
  } catch {
    return "public";
  }
}

export function setRoomVisibility(gameId: string, visibility: RoomVisibility): void {
  memory.set(gameId, visibility);
  try {
    window.localStorage.setItem(KEY_PREFIX + gameId, visibility);
  } catch {
    // Storage blocked — the choice just won't stick across visits.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoomVisibility(gameId: string): RoomVisibility {
  return useSyncExternalStore(
    subscribe,
    () => getRoomVisibility(gameId),
    () => "public",
  );
}
