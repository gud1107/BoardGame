import { describe, expect, it } from "vitest";
import { applyRp, rpForRank, rpFromDetails, tierChange, tierOf } from "./rankTier";
import { mergeStatDetails } from "./details";

describe("rankTier", () => {
  it("8인: 1~4위 플러스, 5~8위 마이너스", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((r) => rpForRank(r, 8))).toEqual([40, 30, 20, 10, -10, -20, -30, -40]);
  });
  it("인원이 적어도 1위 +40, 꼴찌 −40, 홀수 가운데 0", () => {
    expect([rpForRank(1, 2), rpForRank(2, 2)]).toEqual([40, -40]);
    expect([1, 2, 3].map((r) => rpForRank(r, 3))).toEqual([40, 0, -40]);
    expect([1, 2, 3, 4].map((r) => rpForRank(r, 4))).toEqual([40, 20, -20, -40]);
  });
  it("0 아래로 안 내려가고, details는 음수 없이 쌓인다", () => {
    let d = mergeStatDetails({}, applyRp(0, 8, 8).details);
    expect(rpFromDetails(d)).toBe(0);
    d = mergeStatDetails(d, applyRp(rpFromDetails(d), 1, 8).details);
    d = mergeStatDetails(d, applyRp(rpFromDetails(d), 2, 8).details);
    expect(rpFromDetails(d)).toBe(70);
    const r = applyRp(70, 8, 8);
    expect(r).toMatchObject({ delta: -40, next: 30 });
    expect(Object.values(r.details).every((v) => v >= 0)).toBe(true);
  });
  it("티어와 승급/강등", () => {
    expect(tierOf(0).tier.id).toBe("iron");
    expect(tierOf(99).tier.id).toBe("iron");
    expect(tierOf(100).tier.id).toBe("bronze");
    expect(tierOf(1200).tier.id).toBe("challenger");
    expect(tierOf(5000).next).toBeNull();
    expect(tierChange(90, 120)).toBe("promoted");
    expect(tierChange(110, 80)).toBe("demoted");
    expect(tierChange(110, 150)).toBeNull();
  });
});
