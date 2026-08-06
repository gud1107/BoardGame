import { describe, expect, it } from "vitest";
import { generateDefaultPayoutTable, validatePayoutTable } from "./zeroSum";

describe("validatePayoutTable", () => {
  it("accepts a table that sums to exactly zero", () => {
    const check = validatePayoutTable([4000, 1000, -1000, -4000]);
    expect(check.valid).toBe(true);
    expect(check.sum).toBe(0);
  });

  it("rejects a table that doesn't sum to zero", () => {
    const check = validatePayoutTable([4000, 1000, -1000, -3000]);
    expect(check.valid).toBe(false);
    expect(check.sum).toBe(1000);
  });

  it("rejects an empty table even though an empty sum is technically zero", () => {
    expect(validatePayoutTable([])).toEqual({ valid: false, sum: 0 });
  });
});

describe("generateDefaultPayoutTable", () => {
  it("matches the spec's 8-player / 1,000 unit example (1st +4,000 ... 8th -4,000)", () => {
    expect(generateDefaultPayoutTable(8, 1000)).toEqual([4000, 3000, 2000, 1000, -1000, -2000, -3000, -4000]);
  });

  it("gives an odd player count a true middle rank of 0", () => {
    const table = generateDefaultPayoutTable(5, 1000);
    expect(table).toEqual([2000, 1000, 0, -1000, -2000]);
  });

  it("always sums to exactly zero regardless of player count or unit", () => {
    for (const n of [1, 2, 3, 4, 6, 7, 10]) {
      for (const unit of [500, 1000, 2000]) {
        const table = generateDefaultPayoutTable(n, unit);
        expect(table.reduce((a, b) => a + b, 0)).toBe(0);
        expect(validatePayoutTable(table).valid).toBe(true);
      }
    }
  });

  it("returns an empty table for a non-positive player count", () => {
    expect(generateDefaultPayoutTable(0)).toEqual([]);
  });
});
