import { describe, expect, it } from "vitest";
import { withUniqueNames } from "./uniqueNames";

describe("withUniqueNames", () => {
  it("leaves distinct names alone (same array)", () => {
    const occ = [{ seat: 0, name: "상어" }, { seat: 1, name: "고래" }];
    expect(withUniqueNames(occ)).toBe(occ);
  });

  it("the lowest seat keeps a shared name, later seats get numbered — in any presence order", () => {
    const occ = [{ seat: 2, name: "상어", deviceId: "c" }, { seat: 0, name: "상어 ", deviceId: "a" }, { seat: 1, name: "상어", deviceId: "b" }];
    expect(withUniqueNames(occ).map((o) => [o.seat, o.name])).toEqual([[2, "상어 3"], [0, "상어 "], [1, "상어 2"]]);
  });

  it("skips a number someone already uses as their real name", () => {
    const occ = [{ seat: 0, name: "상어" }, { seat: 1, name: "상어 2" }, { seat: 2, name: "상어" }];
    expect(withUniqueNames(occ).map((o) => o.name)).toEqual(["상어", "상어 2", "상어 3"]);
  });
});
