import { describe, expect, it } from "vitest";
import { applyAction, chooseBotAction, computePlayerScore, startGame } from "./engine";
import { greatLegacyStatDetails } from "./stats";
import type { GreatLegacyState } from "./types";

function playOut(seed: number): GreatLegacyState {
  let s = startGame("4p", seed);
  for (let i = 0; i < 20000 && s.phase !== "gameOver"; i++) {
    const seat = s.auction!.activeSeat;
    const a = chooseBotAction(s, seat, 5, () => 0.5);
    if (!a) break;
    s = applyAction(s, a);
  }
  return s;
}

describe("greatLegacyStatDetails", () => {
  it("derives stats from a finished game", () => {
    const s = playOut(11);
    expect(s.phase).toBe("gameOver");
    const totalWinningBids = s.players.reduce((n, p) => n + (p.winningBids?.length ?? 0), 0);
    expect(totalWinningBids).toBeGreaterThan(0);
    for (const p of s.players) {
      const d = greatLegacyStatDetails(s, p.seat);
      const score = computePlayerScore(p);
      expect(d.maxScore).toBe(score.total);
      expect(d.totalPaid).toBe((p.winningBids ?? []).reduce((a, b) => a + b, 0));
      expect(d.brokeGames).toBe(score.remainingCoinValue === 0 ? 1 : 0);
      expect(d.delisted).toBe(p.assets.filter((a) => a.discarded).length);
    }
  });
});
