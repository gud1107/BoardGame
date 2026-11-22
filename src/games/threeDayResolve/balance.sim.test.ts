import { describe, expect, it } from "vitest";
import { computeRankings } from "./engine";
import { playOut } from "./selfPlay";

/**
 * Light self-play guard for the tuning in boardGameRule/작심삼일/작심삼일.md §9
 * (the full 150-game tables came from a scratch run of the same playOut).
 */
describe("작심삼일 self-play balance", () => {
  it("Lv.8 mirror: seasons succeed most of the time but not always, and choices stay mixed", () => {
    let succ = 0,
      fail = 0,
      runs = 0;
    const strengths = new Set<string>();
    const declares = new Set<string>();
    for (let g = 0; g < 30; g++) {
      const { state } = playOut([8, 8, 8, 8], 7000 + g);
      for (const p of state.players)
        for (const h of p.history) {
          runs++;
          if (h.status === "done") succ++;
          if (h.status === "busted") fail++;
          strengths.add(h.strength);
          declares.add(h.declare);
        }
    }
    expect(succ / runs).toBeGreaterThan(0.45);
    expect(succ / runs).toBeLessThan(0.8);
    expect(fail / runs).toBeGreaterThan(0.1);
    expect(strengths.size).toBeGreaterThanOrEqual(2);
    expect(declares.size).toBe(3);
  }, 120_000);

  it("Lv.10 beats Lv.1 in most 2-player games", () => {
    let wins = 0;
    const G = 40;
    for (let g = 0; g < G; g++) {
      const strong = g % 2;
      const { state } = playOut(strong ? [1, 10] : [10, 1], 8000 + g);
      if (computeRankings(state).find((r) => r.seat === strong)!.rank === 1) wins++;
    }
    expect(wins / G).toBeGreaterThanOrEqual(0.6);
  }, 120_000);
});
