import { describe, expect, it } from "vitest";
import { kstDay, summarizeVisitors, topGames } from "./visitorSummary";
import type { VisitorRow } from "./visitors";

function row(partial: Partial<VisitorRow>): VisitorRow {
  return {
    device_id: "00000000-0000-0000-0000-000000000000",
    nickname: null,
    device_type: "모바일",
    os: "iOS",
    browser: "Safari",
    first_seen: "2026-09-20T00:00:00Z",
    last_seen: "2026-09-20T00:00:00Z",
    visit_count: 1,
    play_count: 0,
    games: {},
    last_path: "/",
    ...partial,
  };
}

describe("kstDay", () => {
  it("rolls over at midnight Korea time, not UTC", () => {
    expect(kstDay("2026-09-30T14:59:00Z")).toBe("2026-09-30");
    expect(kstDay("2026-09-30T15:00:00Z")).toBe("2026-10-01");
  });
});

describe("summarizeVisitors", () => {
  const now = Date.parse("2026-10-01T03:00:00Z"); // 12:00 KST
  const rows = [
    row({ visit_count: 5, play_count: 3, first_seen: "2026-09-01T00:00:00Z", last_seen: "2026-10-01T01:00:00Z" }),
    row({ visit_count: 1, play_count: 1, first_seen: "2026-09-30T16:00:00Z", last_seen: "2026-09-30T16:00:00Z" }),
    row({ visit_count: 2, first_seen: "2026-09-10T00:00:00Z", last_seen: "2026-09-12T00:00:00Z" }),
  ];

  it("counts returning, today and 7-day activity", () => {
    expect(summarizeVisitors(rows, now)).toEqual({
      total: 3,
      returning: 2,
      returningRate: 2 / 3,
      todayActive: 2,
      todayNew: 1,
      last7Active: 2,
      totalVisits: 8,
      totalPlays: 4,
    });
  });

  it("handles no visitors", () => {
    expect(summarizeVisitors([], now).returningRate).toBe(0);
  });
});

describe("topGames", () => {
  it("sorts by plays and caps the list", () => {
    expect(topGames({ a: 1, b: 5, c: 3, d: 2 }, 2)).toEqual([
      ["b", 5],
      ["c", 3],
    ]);
    expect(topGames(null)).toEqual([]);
  });
});
