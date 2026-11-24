import { describe, expect, it } from "vitest";
import { createGraceState, markRoomClosed, PRESENCE_GRACE_MS, reconcilePresenceRooms, type LiveRoom } from "./presenceGrace";

const live = (code: string, session = "s1"): LiveRoom => ({
  session,
  room: { id: `doodle-phone:${code}`, gameId: "doodle-phone", roomCode: code, hostName: "호스트", playerCount: 1, maxPlayers: 6, isPublic: true, title: null, updatedAt: "" },
});
const ids = (rooms: { roomCode: string }[]) => rooms.map((r) => r.roomCode);

describe("reconcilePresenceRooms", () => {
  it("keeps a room whose host silently dropped for the grace window, then drops it", () => {
    const s = createGraceState();
    expect(ids(reconcilePresenceRooms(s, [live("1234")], 0))).toEqual(["1234"]);
    expect(ids(reconcilePresenceRooms(s, [], 1_000))).toEqual(["1234"]);
    expect(ids(reconcilePresenceRooms(s, [], 1_000 + PRESENCE_GRACE_MS - 1))).toEqual(["1234"]);
    expect(ids(reconcilePresenceRooms(s, [], 1_000 + PRESENCE_GRACE_MS))).toEqual([]);
  });

  it("a host coming back replaces its ghost without a duplicate", () => {
    const s = createGraceState();
    reconcilePresenceRooms(s, [live("1234")], 0);
    reconcilePresenceRooms(s, [], 1_000);
    expect(ids(reconcilePresenceRooms(s, [live("1234")], 2_000))).toEqual(["1234"]);
    expect(s.ghosts.size).toBe(0);
  });

  it("a room closed on purpose disappears at once, even before its untrack lands", () => {
    const s = createGraceState();
    reconcilePresenceRooms(s, [live("1234"), live("5678")], 0);
    markRoomClosed(s, "doodle-phone:1234", "s1", 500);
    expect(ids(reconcilePresenceRooms(s, [live("1234"), live("5678")], 600))).toEqual(["5678"]);
    expect(ids(reconcilePresenceRooms(s, [live("5678")], 700))).toEqual(["5678"]);
  });

  it("a close after the drop removes the ghost", () => {
    const s = createGraceState();
    reconcilePresenceRooms(s, [live("1234")], 0);
    reconcilePresenceRooms(s, [], 100);
    markRoomClosed(s, "doodle-phone:1234", "s1", 200);
    expect(reconcilePresenceRooms(s, [], 300)).toEqual([]);
  });

  it("the same room code re-listed under a new announcement (rematch) shows again", () => {
    const s = createGraceState();
    reconcilePresenceRooms(s, [live("1234", "s1")], 0);
    markRoomClosed(s, "doodle-phone:1234", "s1", 100);
    expect(ids(reconcilePresenceRooms(s, [live("1234", "s2")], 5_000))).toEqual(["1234"]);
  });
});
