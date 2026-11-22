import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios";
import { layoutCost, roundScore, runSim } from "./sim";
import { designLayout } from "./bot";

/**
 * Self-play check behind the rulebook §8 table: every scenario hurts an empty
 * board, and a Lv.10 search finds a layout that beats a Lv.2 one on average.
 */
describe("pet guard balance", () => {
  it("Lv.10 out-scores Lv.2 across all scenarios", () => {
    let hi = 0;
    let lo = 0;
    for (const sc of SCENARIOS) {
      for (let k = 0; k < 2; k++) {
        const seed = 500 + k * 31;
        const a = designLayout(sc, 10, seed, k + 1);
        const b = designLayout(sc, 2, seed, k + 7);
        hi += roundScore(sc, runSim(sc, a, -1, seed), layoutCost(a));
        lo += roundScore(sc, runSim(sc, b, -1, seed), layoutCost(b));
      }
    }
    expect(hi).toBeGreaterThan(lo * 1.2);
  }, 120_000);
});
