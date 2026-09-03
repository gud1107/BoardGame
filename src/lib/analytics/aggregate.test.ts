import { describe, expect, it } from "vitest";
import {
  buildDailyTrend,
  buildGameRanking,
  buildMonthlyTrend,
  dayKey,
  momChangePct,
  monthKey,
  recentDayKeys,
  recentMonthKeys,
} from "./aggregate";

describe("monthKey", () => {
  it("formats as YYYY-MM using UTC", () => {
    expect(monthKey(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01");
    expect(monthKey(new Date(Date.UTC(2026, 10, 1)))).toBe("2026-11");
  });
});

describe("recentMonthKeys", () => {
  it("returns the last N months ascending, ending at `from`'s month", () => {
    const from = new Date(Date.UTC(2026, 2, 10)); // 2026-03
    expect(recentMonthKeys(3, from)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("crosses a year boundary correctly", () => {
    const from = new Date(Date.UTC(2026, 1, 1)); // 2026-02
    expect(recentMonthKeys(4, from)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("dayKey", () => {
  it("formats as YYYY-MM-DD using UTC", () => {
    expect(dayKey(new Date(Date.UTC(2026, 8, 3)))).toBe("2026-09-03");
  });
});

describe("recentDayKeys", () => {
  it("returns the last N days ascending, ending at `from`'s day", () => {
    const from = new Date(Date.UTC(2026, 8, 3)); // 2026-09-03
    expect(recentDayKeys(3, from)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("crosses a month boundary correctly", () => {
    const from = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01
    expect(recentDayKeys(3, from)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});

describe("momChangePct", () => {
  it("computes a straightforward percentage increase", () => {
    expect(momChangePct(150, 100)).toBe(50);
  });

  it("computes a percentage decrease", () => {
    expect(momChangePct(50, 100)).toBe(-50);
  });

  it("returns null when the previous month was 0 but the current isn't (no meaningful ratio)", () => {
    expect(momChangePct(10, 0)).toBeNull();
  });

  it("returns 0 when both months were 0", () => {
    expect(momChangePct(0, 0)).toBe(0);
  });
});

describe("buildMonthlyTrend", () => {
  it("merges visit + play rows per month and fills gaps with zeros", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const visits = [
      { month: "2026-01", totalVisits: 100, uniqueVisitors: 40 },
      { month: "2026-03", totalVisits: 150, uniqueVisitors: 60 },
    ];
    const plays = [{ month: "2026-02", totalPlays: 20 }];

    const trend = buildMonthlyTrend(visits, plays, months);

    expect(trend).toEqual([
      { month: "2026-01", totalVisits: 100, uniqueVisitors: 40, totalPlays: 0, visitMomChangePct: null },
      { month: "2026-02", totalVisits: 0, uniqueVisitors: 0, totalPlays: 20, visitMomChangePct: -100 },
      { month: "2026-03", totalVisits: 150, uniqueVisitors: 60, totalPlays: 0, visitMomChangePct: null },
    ]);
  });

  it("returns an empty array for an empty month list", () => {
    expect(buildMonthlyTrend([], [], [])).toEqual([]);
  });
});

describe("buildDailyTrend", () => {
  it("merges visit + play rows per day and fills gaps with zeros", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const visits = [
      { date: "2026-09-01", totalVisits: 10, uniqueVisitors: 4 },
      { date: "2026-09-03", totalVisits: 15, uniqueVisitors: 6 },
    ];
    const plays = [{ date: "2026-09-02", totalPlays: 2 }];

    expect(buildDailyTrend(visits, plays, days)).toEqual([
      { date: "2026-09-01", totalVisits: 10, uniqueVisitors: 4, totalPlays: 0 },
      { date: "2026-09-02", totalVisits: 0, uniqueVisitors: 0, totalPlays: 2 },
      { date: "2026-09-03", totalVisits: 15, uniqueVisitors: 6, totalPlays: 0 },
    ]);
  });

  it("returns an empty array for an empty day list", () => {
    expect(buildDailyTrend([], [], [])).toEqual([]);
  });
});

describe("buildGameRanking", () => {
  const nameFor = (id: string) => ({ dalmuti: "달무티", "las-vegas": "라스베가스", "grid-poker": "그리드 포커" })[id] ?? id;

  it("sorts by total plays descending and computes rank + share%", () => {
    const rows = [
      { gameId: "grid-poker", totalPlays: 10, thisMonthPlays: 5 },
      { gameId: "dalmuti", totalPlays: 30, thisMonthPlays: 10 },
      { gameId: "las-vegas", totalPlays: 60, thisMonthPlays: 20 },
    ];

    const ranking = buildGameRanking(rows, nameFor);

    expect(ranking.map((r) => r.gameId)).toEqual(["las-vegas", "dalmuti", "grid-poker"]);
    expect(ranking.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranking.map((r) => r.name)).toEqual(["라스베가스", "달무티", "그리드 포커"]);
    expect(ranking.map((r) => r.sharePct)).toEqual([60, 30, 10]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      { gameId: "a", totalPlays: 1, thisMonthPlays: 1 },
      { gameId: "b", totalPlays: 2, thisMonthPlays: 2 },
    ];
    buildGameRanking(rows, (id) => id);
    expect(rows[0].gameId).toBe("a");
  });

  it("gives every row 0% share when there are zero total plays", () => {
    const rows = [{ gameId: "a", totalPlays: 0, thisMonthPlays: 0 }];
    expect(buildGameRanking(rows, (id) => id)[0].sharePct).toBe(0);
  });

  it("returns an empty array for no games", () => {
    expect(buildGameRanking([], (id) => id)).toEqual([]);
  });
});
