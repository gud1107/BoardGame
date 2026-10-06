import { useSyncExternalStore } from "react";

/**
 * The host's room-listing settings per game — 🌐 공개방 / 🔒 비공개방 and an
 * optional room title. Picked on the shared room-creation screen
 * (`RulebookGate`) and changeable from the waiting room via the floating
 * `HostedRoomControls` pill; `useActiveRoomListing` reads them live on every
 * publish and re-publishes right away when they change. Kept per game in
 * localStorage so a host who always plays privately with friends doesn't
 * have to flip it every time. Defaults to public, no title.
 */
export type RoomVisibility = "public" | "private";

export const ROOM_TITLE_MAX = 30;

const VISIBILITY_PREFIX = "room-visibility:";
const TITLE_PREFIX = "room-title:";
const listeners = new Set<() => void>();
/** Session fallback for when localStorage is blocked (private windows etc.). */
const memory = new Map<string, string>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked — the choice just won't stick across visits.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notified whenever any game's visibility/title or the hosted room changes. */
export const subscribeRoomSettings = subscribe;

export function getRoomVisibility(gameId: string): RoomVisibility {
  return read(VISIBILITY_PREFIX + gameId) === "private" ? "private" : "public";
}

export function setRoomVisibility(gameId: string, visibility: RoomVisibility): void {
  write(VISIBILITY_PREFIX + gameId, visibility);
}

export function useRoomVisibility(gameId: string): RoomVisibility {
  return useSyncExternalStore(
    subscribe,
    () => getRoomVisibility(gameId),
    () => "public",
  );
}

/** Raw title as typed (may be empty) — trim with `normalizeRoomTitle` before publishing. */
export function getRoomTitle(gameId: string): string {
  return (read(TITLE_PREFIX + gameId) ?? "").slice(0, ROOM_TITLE_MAX);
}

export function setRoomTitle(gameId: string, title: string): void {
  write(TITLE_PREFIX + gameId, title.slice(0, ROOM_TITLE_MAX));
}

export function useRoomTitle(gameId: string): string {
  return useSyncExternalStore(
    subscribe,
    () => getRoomTitle(gameId),
    () => "",
  );
}

export function normalizeRoomTitle(title: string): string | null {
  const t = title.replace(/\s+/g, " ").trim().slice(0, ROOM_TITLE_MAX);
  return t || null;
}

/**
 * The room this tab is currently hosting in its waiting lobby, if any — set
 * by `useActiveRoomListing` while it publishes, so the global
 * `HostedRoomControls` pill knows when (and for which game) to show itself
 * without any per-game wiring.
 */
export interface HostedRoom {
  gameId: string;
  roomCode: string;
}

let hostedRoom: HostedRoom | null = null;

export function setHostedRoom(room: HostedRoom | null): void {
  if (hostedRoom?.gameId === room?.gameId && hostedRoom?.roomCode === room?.roomCode) return;
  hostedRoom = room;
  listeners.forEach((l) => l());
}

/** Clears the hosted room only if it's still this one (a newer room may already have replaced it). */
export function clearHostedRoom(room: HostedRoom): void {
  if (hostedRoom?.gameId === room.gameId && hostedRoom?.roomCode === room.roomCode) setHostedRoom(null);
}

export function useHostedRoom(): HostedRoom | null {
  return useSyncExternalStore(
    subscribe,
    () => hostedRoom,
    () => null,
  );
}
