import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { createGraceState, markRoomClosed, reconcilePresenceRooms, type LiveRoom } from "./presenceGrace";
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
 * watcher reads the presence state. `useActiveRooms` merges this with the
 * table rows, so both paths work side by side.
 *
 * One channel per tab, shared by the lobby list and a hosted room (every
 * tab must use the same topic to see each other). It's only rebuilt when it
 * has really died — removed first, so the re-`channel()` call doesn't get
 * the half-closed one back.
 *
 * Staying listed while the host looks away (2026-11-24, "그림 전화기
 * 공개방이 안 보여요"): Presence drops a host the moment its socket does,
 * and a phone host sharing the invite link in a messenger loses its socket
 * right then. So a host that vanishes without saying goodbye stays listed
 * for `PRESENCE_GRACE_MS` (45s, presenceGrace.ts); a host that really
 * closes the room (match start, leaving, closing the tab) broadcasts
 * `room-closed` first and disappears at once. Coming back to the tab
 * re-tracks the room or rebuilds a dead channel.
 */
const TOPIC = "lobby-active-rooms-v1";
const CLOSED_EVENT = "room-closed";

interface PresenceRoom {
  id: string;
  gameId: string;
  roomCode: string;
  hostName: string | null;
  playerCount: number;
  maxPlayers: number;
  isPublic: boolean;
  title: string | null;
  /** Unique per announcement; absent from tabs older than 2026-11-24. */
  session?: string;
}

const tabKey = `tab-${Math.random().toString(36).slice(2, 12)}`;
let channel: RealtimeChannel | null = null;
let subscribed = false;
let rebuilding = false;
let myRoom: PresenceRoom | null = null;
const listeners = new Set<(rooms: ActiveRoomRecord[]) => void>();
const grace = createGraceState();
let pruneTimer: ReturnType<typeof setTimeout> | undefined;

function liveRooms(): LiveRoom[] {
  if (!channel) return [];
  const now = new Date().toISOString();
  const byId = new Map<string, LiveRoom>();
  for (const entries of Object.values(channel.presenceState<PresenceRoom>())) {
    for (const e of entries) {
      if (typeof e.gameId !== "string" || typeof e.roomCode !== "string") continue;
      byId.set(e.id, {
        session: typeof e.session === "string" ? e.session : "",
        room: {
          id: e.id,
          gameId: e.gameId,
          roomCode: e.roomCode,
          hostName: e.hostName ?? null,
          playerCount: Number(e.playerCount) || 1,
          maxPlayers: Number(e.maxPlayers) || 1,
          isPublic: e.isPublic === true,
          title: e.title ?? null,
          updatedAt: now,
        },
      });
    }
  }
  return [...byId.values()];
}

function currentRooms(): ActiveRoomRecord[] {
  return reconcilePresenceRooms(grace, liveRooms(), Date.now());
}

function emit(): void {
  const rooms = currentRooms();
  listeners.forEach((l) => l(rooms));
  // Re-emit once the oldest ghost expires so it leaves the list on time.
  clearTimeout(pruneTimer);
  const nextExpiry = Math.min(...[...grace.ghosts.values()].map((g) => g.until));
  if (Number.isFinite(nextExpiry)) pruneTimer = setTimeout(emit, Math.max(250, nextExpiry - Date.now() + 50));
}

function openChannel(): void {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const ch = supabase.channel(TOPIC, { config: { presence: { key: tabKey } } });
    channel = ch;
    ch.on("presence", { event: "sync" }, emit)
      .on("broadcast", { event: CLOSED_EVENT }, ({ payload }) => {
        const id = payload?.id;
        if (typeof id !== "string") return;
        markRoomClosed(grace, id, typeof payload?.session === "string" ? payload.session : "", Date.now());
        emit();
      })
      .subscribe((status) => {
        if (channel !== ch) return;
        subscribed = status === "SUBSCRIBED";
        if (subscribed && myRoom) void ch.track(myRoom).catch(() => {});
        if (subscribed) emit();
      });
  } catch {
    channel = null;
  }
}

function ensureChannel(): boolean {
  if (!channel) openChannel();
  return channel !== null;
}

/**
 * A channel that ended up closed (not just reconnecting — supabase-js
 * retries errored ones by itself) is removed and opened again.
 */
async function reviveChannel(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !channel || rebuilding) return;
  if (channel.state !== "closed") {
    if (subscribed && myRoom) void channel.track(myRoom).catch(() => {});
    return;
  }
  rebuilding = true;
  const dead = channel;
  try {
    await supabase.removeChannel(dead).catch(() => "error");
    if (channel !== dead) return;
    if (supabase.getChannels().some((c) => c === dead)) return; // couldn't drop it; try next time
    channel = null;
    subscribed = false;
    openChannel();
  } finally {
    rebuilding = false;
  }
}

function sendClosed(room: PresenceRoom): void {
  // This tab's own list too (broadcasts don't echo back to the sender).
  markRoomClosed(grace, room.id, room.session ?? "", Date.now());
  if (!channel || !subscribed) return;
  void channel.send({ type: "broadcast", event: CLOSED_EVENT, payload: { id: room.id, session: room.session ?? "" } }).catch(() => {});
}

if (typeof window !== "undefined") {
  const onReturn = () => {
    if (document.visibilityState === "visible") void reviveChannel();
  };
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("online", onReturn);
  window.addEventListener("pageshow", (e) => {
    // Back from the bfcache after pagehide announced a close: re-list under
    // a fresh session, since watchers now hide the old one.
    if (e.persisted && myRoom) myRoom.session = Math.random().toString(36).slice(2, 12);
    onReturn();
  });
  // Closing / navigating the tab: tell watchers now instead of leaving a
  // ghost. The socket dies with the page before a channel message gets out
  // (prod check: the room lingered the full grace), so this goes over the
  // REST broadcast endpoint with `keepalive`, which outlives the page.
  window.addEventListener("pagehide", () => {
    if (myRoom) sendClosedOnUnload(myRoom);
  });
}

function sendClosedOnUnload(room: PresenceRoom): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    void fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: TOPIC, event: CLOSED_EVENT, payload: { id: room.id, session: room.session ?? "" } }] }),
    }).catch(() => {});
  } catch {
    // best-effort
  }
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
  update: (room: Omit<PresenceRoom, "id" | "session">) => void;
  withdraw: () => void;
} {
  const ok = ensureChannel();
  const session = Math.random().toString(36).slice(2, 12);
  let mine: PresenceRoom | null = null;
  return {
    update(room) {
      if (!ok) return;
      mine = { ...room, id: `${room.gameId}:${room.roomCode}`, session: mine?.session ?? session };
      myRoom = mine;
      if (subscribed) void channel?.track(mine).catch(() => {});
    },
    withdraw() {
      if (!ok || !mine) return;
      sendClosed(mine);
      // A newer announcement (another room) may already own the slot.
      if (myRoom === mine) {
        myRoom = null;
        if (subscribed) void channel?.untrack().catch(() => {});
      }
      mine = null;
    },
  };
}
