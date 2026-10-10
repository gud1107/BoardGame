import { describe, expect, it } from "vitest";
import { roleSelfResult, selfResult } from "./selfResult";

const rankings = [
  { seat: 2, rank: 1 },
  { seat: 0, rank: 2 },
  { seat: 1, rank: 2 },
];

describe("selfResult", () => {
  it("finds this device's seat rank", () => {
    expect(selfResult(0, rankings)).toEqual({ rank: 2, playerCount: 3, botPlayed: false, withBots: false, botLevel: null });
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

  it("records the highest lobby-bot level still at the table", () => {
    expect(selfResult(0, rankings, { botSeats: [2, 1], botLevels: [3, 9] })?.botLevel).toBe(9);
    expect(selfResult(0, rankings, { botSeats: [2, 7], botLevels: [3, 10] })?.botLevel).toBe(3);
    expect(selfResult(0, rankings, { takeovers: { "1": {} } })?.botLevel).toBeNull();
  });
});

describe("roleSelfResult", () => {
  it("maps p1/p2 roles onto selfResult", () => {
    const r = [
      { role: "p1" as const, rank: 2 },
      { role: "p2" as const, rank: 1 },
    ];
    expect(roleSelfResult("p2", r, { botRoles: ["p1"], botLevels: [7] })).toEqual({
      rank: 1,
      playerCount: 2,
      botPlayed: false,
      withBots: true,
      botLevel: 7,
    });
    expect(roleSelfResult("p1", r, { takeovers: { p1: {} } })?.botPlayed).toBe(true);
    expect(roleSelfResult("p1", r, { takeovers: { p2: {} } })?.withBots).toBe(true);
    expect(roleSelfResult(null, r)).toBeUndefined();
    expect(roleSelfResult("p1", r, {}, (role, rank) => ({ [`${role}x`]: rank }))?.details).toEqual({ p1x: 2 });
  });
});
