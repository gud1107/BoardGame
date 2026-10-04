import { describe, expect, it } from "vitest";
import { mergeStatDetails, SOLO_HEADLINE, STAT_DETAIL_ROWS } from "./details";

describe("solo game stats", () => {
  it("crab-survival match details merge: best rank kept low, best score/kills kept high, counts summed", () => {
    const m1 = { matches: 1, firsts: 0, top3: 1, minRank: 3, maxScore: 5200, kills: 4, maxKills: 4, kingSeconds: 30, maxLevel: 7, bounties: 0, revenges: 1 };
    const m2 = { matches: 1, firsts: 1, top3: 1, minRank: 1, maxScore: 4100, kills: 9, maxKills: 9, kingSeconds: 90, maxLevel: 6, bounties: 2, revenges: 0 };
    const d = mergeStatDetails(m1, m2);
    expect(d).toMatchObject({ matches: 2, firsts: 1, top3: 2, minRank: 1, maxScore: 5200, kills: 13, maxKills: 9, kingSeconds: 120, maxLevel: 7, bounties: 2, revenges: 1 });
    expect(STAT_DETAIL_ROWS["crab-survival"].map((r) => r.value(d, 2))).toEqual([
      "5,200", "50% (1/2)", "100% (2/2)", "1위", "6.5 · 9", "2분", "7", "2 / 1",
    ]);
    expect(SOLO_HEADLINE["crab-survival"](d)).toBe("최고 5,200점 · 👑 1등 1회 · 최고 1위");
  });

  it("hungry-shark headline", () => {
    expect(SOLO_HEADLINE["hungry-shark"]({ maxScore: 12345, maxMissionStreak: 3 })).toBe("최고 12,345점 · 🔥 최고 연속 올클리어 3회");
  });
});
