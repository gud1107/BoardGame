import { describe, expect, it } from "vitest";
import { computeRankings } from "./engine";
import { playOut } from "./selfPlay";

/**
 * Light self-play guard for the tuning in boardGameRule/마법상점/마법상점.md §8
 * (the full 300-game tables came from a scratch run of the same playOut).
 */
describe("마법 상점 self-play balance", () => {
  it("games end in a sensible number of rounds at every player count (Lv.7 mirror)", () => {
    for (const n of [2, 3, 4]) {
      let rounds = 0;
      const G = 12;
      for (let g = 0; g < G; g++) {
        const { state } = playOut(Array(n).fill(7), 4000 + g * 11 + n);
        expect(state.phase).toBe("gameOver");
        rounds += state.round;
      }
      expect(rounds / G).toBeGreaterThan(9);
      expect(rounds / G).toBeLessThan(22);
    }
  }, 120_000);

  it("Lv.10 beats Lv.1 clearly in 2-player games", () => {
    let wins = 0;
    const G = 24;
    for (let g = 0; g < G; g++) {
      const strong = g % 2;
      const { state } = playOut(strong ? [1, 10] : [10, 1], 6000 + g);
      if (computeRankings(state).find((r) => r.seat === strong)!.rank === 1) wins++;
    }
    expect(wins / G).toBeGreaterThanOrEqual(0.7);
  }, 120_000);
});
