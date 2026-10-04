import { describe, expect, it } from "vitest";
import { selfResult } from "./selfResult";

const rankings = [
  { seat: 2, rank: 1 },
  { seat: 0, rank: 2 },
  { seat: 1, rank: 2 },
];

describe("selfResult", () => {
  it("finds this device's seat rank", () => {
    expect(selfResult(0, rankings)).toEqual({ rank: 2, playerCount: 3, botPlayed: false, withBots: false });
    expect(selfResult(2, rankings)?.rank).toBe(1);
  });

  it("returns undefined when there is no local seat", () => {
    expect(selfResult(null, rankings)).toBeUndefined();
    expect(selfResult(5, rankings)).toBeUndefined();
  });

  it("flags a seat a takeover bot finished", () => {
    expect(selfResult(1, rankings, { takeovers: { "1": { originalUserId: "x" } } })?.botPlayed).toBe(true);
    expect(selfResult(0, rankings, { takeovers: { "1": { originalUserId: "x" } } })?.botPlayed).toBe(false);
  });

  it("flags games with a lobby bot or another seat's takeover bot", () => {
    expect(selfResult(0, rankings, { botSeats: [2] })?.withBots).toBe(true);
    expect(selfResult(0, rankings, { takeovers: { "1": {} } })?.withBots).toBe(true);
    // Only my own seat taken over → no bot opponents.
    expect(selfResult(1, rankings, { takeovers: { "1": {} } })?.withBots).toBe(false);
  });
});
