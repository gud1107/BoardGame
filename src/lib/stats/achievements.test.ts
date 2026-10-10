import { describe, expect, it } from "vitest";
import type { StatTotalsRecord } from "@/lib/db/types";
import { GAME_REGISTRY } from "@/games/registry";
import { achievementsFor, evaluateAchievements, newlyUnlocked } from "./achievements";

const totals = (over: Partial<StatTotalsRecord>): StatTotalsRecord => ({
  gameId: "avalon",
  played: 0,
  wins: 0,
  losses: 0,
  bestRank: null,
  updatedAt: "",
  ...over,
});

describe("achievements", () => {
  it("every playable game has common + game-specific achievements with unique ids", () => {
    for (const g of GAME_REGISTRY.filter((x) => x.playable)) {
      const list = achievementsFor(g.id);
      expect(list.length, g.id).toBeGreaterThan(3);
      expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
    }
  });

  it("evaluates counters, bot slices and min-keys", () => {
    const t = totals({
      played: 12,
      wins: 1,
      details: { merlinWins: 1, goodWins: 3 },
      byBotLevel: { "10": { played: 1, wins: 1, losses: 0, bestRank: 1 } },
    });
    const byKey = Object.fromEntries(evaluateAchievements("avalon", t).map((a) => [a.id.split(":")[1], a]));
    expect(byKey["first-win"].unlocked).toBe(true);
    expect(byKey["ten-games"].unlocked).toBe(true);
    expect(byKey["bot-slayer"].unlocked).toBe(true);
    expect(byKey["merlin"].unlocked).toBe(true);
    expect(byKey["good-5"]).toMatchObject({ unlocked: false, progress: 3 });

    const fast = (v: number) => evaluateAchievements("mal-dalli-ja", totals({ gameId: "mal-dalli-ja", details: { minWinTurns: v } }));
    expect(fast(38).find((a) => a.id.endsWith("fast-40"))?.unlocked).toBe(true);
    expect(fast(41).find((a) => a.id.endsWith("fast-40"))?.unlocked).toBe(false);
  });

  it("diffs newly unlocked achievements", () => {
    const before = totals({ played: 9, wins: 0 });
    const after = totals({ played: 10, wins: 1 });
    expect(newlyUnlocked("avalon", before, after).map((a) => a.id)).toEqual(["avalon:first-win", "avalon:ten-games"]);
    expect(newlyUnlocked("avalon", after, after)).toEqual([]);
  });
});
