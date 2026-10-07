import { useSyncExternalStore } from "react";

/**
 * Waiting-room "누가 들어왔어요 / 나갔어요" toasts (2026-10-08). Pushed by
 * `useActiveRoomListing` from the occupant list every online game already
 * passes it, rendered once by the root layout's `RoomEntryToasts` — so none
 * of the games' (all different) waiting screens needed changes.
 */
export interface RoomToast {
  id: number;
  kind: "join" | "leave";
  name: string;
}

/** How long one toast stays on screen. */
export const ROOM_TOAST_MS = 3200;
/** Oldest toasts drop off once this many are stacked (a burst of joins). */
const MAX_TOASTS = 4;

const EMPTY: RoomToast[] = [];
let toasts: RoomToast[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: RoomToast[]): void {
  toasts = next;
  listeners.forEach((l) => l());
}

export function pushRoomToast(kind: RoomToast["kind"], name: string): void {
  const toast = { id: nextId++, kind, name: name.trim() || "새 플레이어" };
  emit([...toasts, toast].slice(-MAX_TOASTS));
  setTimeout(() => emit(toasts.filter((t) => t.id !== toast.id)), ROOM_TOAST_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoomToasts(): RoomToast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
}
