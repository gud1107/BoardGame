import { describe, expect, it } from "vitest";
import { formatRankMetric, matchSummaryLines, STAT_RANK_METRICS } from "./presentation";

describe("matchSummaryLines", () => {
  it("shows only what happened this match", () => {
    const lines = matchSummaryLines("perudo", { dudoCalls: 3, dudoCorrect: 2, bidsHeld: 0, oneDieComebacks: 1 });
    expect(lines).toEqual([
      { label: "“페루도!” 적중", value: "2/3" },
      { label: "주사위 1개에서 역전승", value: "✔" },
    ]);
  });

  it("keeps a 0 on lower-is-better keys", () => {
    expect(matchSummaryLines("rat-a-tat-cat", { minHandScore: 0, zeroHands: 1 })).toEqual([
      { label: "최종 점수 (낮을수록 좋음)", value: "0점" },
      { label: "0점 퍼펙트 핸드", value: "✔" },
    ]);
  });

  it("is empty for games without rows or details", () => {
    expect(matchSummaryLines("avalon", { x: 1 })).toEqual([]);
    expect(matchSummaryLines("perudo", undefined)).toEqual([]);
  });
});

describe("rank metrics", () => {
  it("use valid detail keys and unique ids", () => {
    const ids = new Set<string>();
    for (const metrics of Object.values(STAT_RANK_METRICS)) {
      for (const m of metrics) {
        expect(ids.has(m.id)).toBe(false);
        ids.add(m.id);
        expect(m.num).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);
        if (m.den) expect(m.den).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);
      }
    }
  });

  it("formats each kind", () => {
    const [dudo] = STAT_RANK_METRICS.perudo;
    expect(formatRankMetric(dudo, 0.75, 9, 12)).toBe("75% (9/12)");
    const fsAvg = STAT_RANK_METRICS["for-sale"][1];
    expect(formatRankMetric(fsAvg, 41234.5, 0, 10)).toBe("$41,235");
  });
});
