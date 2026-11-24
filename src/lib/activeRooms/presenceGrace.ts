import type { ActiveRoomRecord } from "./types";

/**
 * How long a room stays listed after its host's Presence entry vanishes
 * without the host saying the room closed (2026-11-24). A host on a phone
 * who switches to a messenger to send the invite link has its socket cut
 * by the OS, and the room used to drop off every lobby that same second —
 * "공개방이 안 보여요". Short enough that a host who really left (tab
 * killed without a goodbye) isn't advertised for long.
 */
export const PRESENCE_GRACE_MS = 45_000;

/**
 * One live Presence entry. `session` is unique per announcement (one per
 * waiting-room stint), so closing a room doesn't also hide the same room
 * code re-listed after a rematch.
 */
export interface LiveRoom {
  room: ActiveRoomRecord;
  session: string;
}

/** Mutable bookkeeping for {@link reconcilePresenceRooms}. */
export interface GraceState {
  /** Room id → last live record, for rooms currently shown on grace. */
  ghosts: Map<string, { room: ActiveRoomRecord; until: number }>;
  /** `id|session` the host announced closing — hidden, never ghosted. → expiry. */
  closed: Map<string, number>;
  /** Rooms shown live in the previous reconcile, by id. */
  lastLive: Map<string, LiveRoom>;
}

export function createGraceState(): GraceState {
  return { ghosts: new Map(), closed: new Map(), lastLive: new Map() };
}

const closedKey = (id: string, session: string) => `${id}|${session}`;

/** The host withdrew this room on purpose: drop it now instead of ghosting it. */
export function markRoomClosed(state: GraceState, id: string, session: string, now: number): void {
  state.closed.set(closedKey(id, session), now + PRESENCE_GRACE_MS * 2);
  state.ghosts.delete(id);
  if (state.lastLive.get(id)?.session === session) state.lastLive.delete(id);
}

/**
 * Live presence rooms plus, for up to {@link PRESENCE_GRACE_MS}, rooms whose
 * host dropped out of Presence without announcing a close. A room that comes
 * back live replaces its ghost.
 */
export function reconcilePresenceRooms(state: GraceState, live: readonly LiveRoom[], now: number): ActiveRoomRecord[] {
  for (const [key, until] of state.closed) if (until <= now) state.closed.delete(key);

  // A closed entry whose untrack is still in flight stays hidden.
  const shown = live.filter((l) => !state.closed.has(closedKey(l.room.id, l.session)));
  const shownIds = new Set(shown.map((l) => l.room.id));

  for (const [id, prev] of state.lastLive) {
    if (shownIds.has(id) || state.ghosts.has(id)) continue;
    state.ghosts.set(id, { room: prev.room, until: now + PRESENCE_GRACE_MS });
  }
  for (const [id, ghost] of state.ghosts) {
    if (shownIds.has(id) || ghost.until <= now) state.ghosts.delete(id);
  }
  state.lastLive = new Map(shown.map((l) => [l.room.id, l]));
  return [...shown.map((l) => l.room), ...[...state.ghosts.values()].map((g) => g.room)];
}
