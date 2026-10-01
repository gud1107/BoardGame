import { describe, expect, it } from "vitest";
import { mergeStatDetails } from "./details";

describe("mergeStatDetails", () => {
  it("sums plain keys and keeps the max of max* keys", () => {
    expect(mergeStatDetails({ zeroChecks: 2, maxCheck: 12000 }, { zeroChecks: 1, maxCheck: 9000, had30: 1 })).toEqual({
      zeroChecks: 3,
      maxCheck: 12000,
      had30: 1,
    });
  });
  it("handles missing sides and ignores non-numbers", () => {
    expect(mergeStatDetails(undefined, { maxScore: 5 })).toEqual({ maxScore: 5 });
    expect(mergeStatDetails({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeStatDetails({ a: 1 }, { a: Number.NaN })).toEqual({ a: 1 });
  });
});
