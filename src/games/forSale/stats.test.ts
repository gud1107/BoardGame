import { describe, expect, it } from "vitest";
import { applyAction, chooseBotAction, computeRankings, startGame, type ForSaleState } from "./engine";
import { forSaleStatDetails } from "./stats";

function playOut(seed: number, players: number): ForSaleState {
  let s = startGame(players, seed);
  for (let i = 0; i < 5000 && s.phase !== "gameOver"; i++) {
    let moved = false;
    for (const p of s.players) {
      const a = chooseBotAction(s, p.seat, 5, () => 0.5);
      if (a) {
        s = applyAction(s, a);
        moved = true;
        break;
      }
    }
    if (!moved && s.phase === "selling" && s.sale?.revealed) {
      s = applyAction(s, { type: "continueSale" });
      moved = true;
    }
    if (!moved) break;
  }
  return s;
}

describe("forSaleStatDetails", () => {
  it("derives stats from a finished game", () => {
    const s = playOut(7, 4);
    expect(s.phase).toBe("gameOver");
    const all = s.players.map((p) => forSaleStatDetails(s, p.seat, computeRankings(s).find((r) => r.seat === p.seat)!.rank));
    // Exactly one player owned property #30 at some point.
    expect(all.reduce((n, d) => n + d.had30, 0)).toBe(1);
    for (const [i, d] of all.entries()) {
      const p = s.players[i];
      expect(p.sales?.length).toBe(p.checks.length);
      expect(d.zeroChecks).toBe(p.checks.filter((c) => c === 0).length);
      expect(d.maxTotal).toBe(d.totalMoney);
    }
  });
});
