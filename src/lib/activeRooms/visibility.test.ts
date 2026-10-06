import { describe, expect, it, vi } from "vitest";
import {
  clearHostedRoom,
  getRoomTitle,
  getRoomVisibility,
  normalizeRoomTitle,
  setHostedRoom,
  setRoomTitle,
  setRoomVisibility,
  subscribeRoomSettings,
  useHostedRoom,
} from "./visibility";

describe("room listing settings", () => {
  it("defaults to public with no title, and remembers per game without localStorage", () => {
    expect(getRoomVisibility("test-a")).toBe("public");
    setRoomVisibility("test-a", "private");
    expect(getRoomVisibility("test-a")).toBe("private");
    expect(getRoomVisibility("test-b")).toBe("public");
    setRoomTitle("test-a", "x".repeat(50));
    expect(getRoomTitle("test-a")).toHaveLength(30);
  });

  it("normalizes titles: collapses spaces, empty → null", () => {
    expect(normalizeRoomTitle("  초보   환영 ")).toBe("초보 환영");
    expect(normalizeRoomTitle("   ")).toBeNull();
  });

  it("notifies on changes and only clears the hosted room it set", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRoomSettings(listener);
    setHostedRoom({ gameId: "coyote", roomCode: "1111" });
    setHostedRoom({ gameId: "coyote", roomCode: "2222" });
    clearHostedRoom({ gameId: "coyote", roomCode: "1111" }); // stale cleanup — ignored
    expect(listener).toHaveBeenCalledTimes(2);
    clearHostedRoom({ gameId: "coyote", roomCode: "2222" });
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(typeof useHostedRoom).toBe("function");
  });
});
