import { describe, expect, it } from "vitest";
import { computeRankings } from "./engine";
import { playOut } from "./selfPlay";

const VERBOSE = !!process.env.ISLAND_SIM;

describe("섬 개척자 self-play balance", () => {
  it("every player count finishes and scores sensibly (Lv.7 mirror)", () => {
    for (const n of [2, 3, 4, 5]) {
      const totals: number[] = [];
      let turnsSum = 0;
      const firstSeatWins: number[] = [];
      const games = VERBOSE ? 20 : 3;
      for (let g = 0; g < games; g++) {
        const { state, turns } = playOut(Array.from({ length: n }, () => 7), 1000 + g * 17 + n);
        expect(state.phase).toBe("gameOver");
        totals.push(...state.scores);
        turnsSum += turns;
        firstSeatWins.push(computeRankings(state)[0].seat);
      }
      const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
      if (VERBOSE) console.log(`${n}p avg score ${avg.toFixed(1)} min ${Math.min(...totals)} max ${Math.max(...totals)} turns ${(turnsSum / games).toFixed(1)} winners ${firstSeatWins.join("")}`);
      expect(avg).toBeGreaterThan(15);
    }
  }, 120_000);

  it("Lv.10 beats Lv.1 clearly in 2-player games", () => {
    let wins = 0;
    const games = VERBOSE ? 30 : 6;
    for (let g = 0; g < games; g++) {
      const strongSeat = g % 2;
      const levels = strongSeat === 0 ? [10, 1] : [1, 10];
      const { state } = playOut(levels, 5000 + g);
      if (state.scores[strongSeat] > state.scores[1 - strongSeat]) wins++;
    }
    if (VERBOSE) console.log(`Lv10 vs Lv1 wins ${wins}/${games}`);
    expect(wins / games).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
});
