import { describe, expect, it } from "vitest";
import { computeFinalStandings, computeRoundDeltas, mergeDeltasIntoTotals } from "./ledger";

describe("computeRoundDeltas", () => {
  const payoutTable = [4000, 1000, -1000, -4000];

  it("assigns each distinct rank its own payout slot in order", () => {
    const deltas = computeRoundDeltas({ a: 1, b: 2, c: 3, d: 4 }, payoutTable);
    expect(deltas).toEqual({ a: 4000, b: 1000, c: -1000, d: -4000 });
  });

  it("splits the payout evenly across a tied group (gaps in rank values are fine)", () => {
    // Two players tied for 1st share the top two payout slots (4000+1000)/2,
    // per ledger.ts's doc comment — "1, 1, 4" is a valid ranking.
    const deltas = computeRoundDeltas({ a: 1, b: 1, c: 4 }, payoutTable.slice(0, 3));
    expect(deltas.a).toBe(2500);
    expect(deltas.b).toBe(2500);
    expect(deltas.c).toBe(-1000);
  });

  it("still sums to zero for a fully-tied group", () => {
    const deltas = computeRoundDeltas({ a: 1, b: 1, c: 1, d: 1 }, payoutTable);
    const sum = Object.values(deltas).reduce((x, y) => x + y, 0);
    expect(sum).toBe(0);
    expect(deltas.a).toBe(0);
  });

  it("throws when the ranked entry count doesn't match the payout table length", () => {
    expect(() => computeRoundDeltas({ a: 1, b: 2 }, payoutTable)).toThrow();
  });
});

describe("mergeDeltasIntoTotals", () => {
  it("adds deltas onto existing totals, defaulting missing players to 0", () => {
    const totals = mergeDeltasIntoTotals({ a: 1000 }, { a: 500, b: -500 });
    expect(totals).toEqual({ a: 1500, b: -500 });
  });

  it("does not mutate the input totals object", () => {
    const totals = { a: 1000 };
    mergeDeltasIntoTotals(totals, { a: 500 });
    expect(totals.a).toBe(1000);
  });
});

describe("computeFinalStandings", () => {
  it("ranks by total descending and gives ties a shared rank with a gap after", () => {
    const standings = computeFinalStandings({ a: 3000, b: 3000, c: 1000, d: -4000 });
    const byId = Object.fromEntries(standings.map((s) => [s.playerId, s]));
    expect(byId.a.rank).toBe(1);
    expect(byId.b.rank).toBe(1);
    expect(byId.c.rank).toBe(3); // skips rank 2 — two players already share 1st
    expect(byId.d.rank).toBe(4);
  });
});
