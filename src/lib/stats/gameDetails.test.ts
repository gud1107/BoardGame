import { describe, expect, it } from "vitest";
import * as perudo from "@/games/perudo/engine";
import { perudoStatDetails } from "@/games/perudo/stats";
import * as coyote from "@/games/coyote/engine";
import { coyoteStatDetails } from "@/games/coyote/stats";
import * as cucumbers from "@/games/five-cucumbers/engine";
import { fiveCucumbersStatDetails } from "@/games/five-cucumbers/stats";

// Low levels keep these bot playouts fast; the point is that every engine's
// statTally stays consistent with what actually happened in a full game.

describe("per-game detail stats from full bot games", () => {
  it("perudo: every call is tallied once, hits never exceed calls", () => {
    let s = perudo.startGame(4, 42);
    let calls = 0;
    for (let g = 0; s.phase !== "gameOver" && g < 3000; g++) {
      if (s.phase === "reveal") {
        s = perudo.applyAction(s, { type: "continue", seed: 9000 + g });
        calls++;
        continue;
      }
      s = perudo.applyAction(s, perudo.chooseBotAction(s, s.activeSeat, 3)!);
    }
    expect(s.phase).toBe("gameOver");
    calls++; // the call that ended the game never reaches "reveal"
    const ranks = perudo.computeRankings(s);
    const all = s.players.map((p) => perudoStatDetails(s, p.seat, ranks.find((r) => r.seat === p.seat)!.rank));
    const sum = (k: string) => all.reduce((n, d) => n + (d[k] ?? 0), 0);
    expect(sum("dudoCalls") + sum("calzaCalls")).toBe(calls);
    expect(sum("dudoCorrect")).toBe(sum("bluffsCaught"));
    expect(sum("dudoCalls")).toBe(sum("dudoCorrect") + sum("bidsHeld"));
    for (const d of all) expect(d.calzaCorrect ?? 0).toBeLessThanOrEqual(d.calzaCalls ?? 0);
  });

  it("coyote: calls = challenged bids, correct + held = calls", () => {
    let s = coyote.startGame(4, 7);
    for (let g = 0, cs = 1; s.phase !== "gameOver" && g < 5000; g++) {
      if (s.phase === "reveal") {
        s = coyote.applyAction(s, { type: "continue", seed: cs++ });
        continue;
      }
      s = coyote.applyAction(s, coyote.chooseBotAction(s, s.activeSeat, 3)!);
    }
    expect(s.phase).toBe("gameOver");
    const ranks = coyote.computeRankings(s);
    const all = s.players.map((p) => coyoteStatDetails(s, p.seat, ranks.find((r) => r.seat === p.seat)!.rank));
    const sum = (k: string) => all.reduce((n, d) => n + (d[k] ?? 0), 0);
    expect(sum("coyoteCalls")).toBe(sum("bidsChallenged"));
    expect(sum("coyoteCorrect") + sum("bidsHeld")).toBe(sum("coyoteCalls"));
    expect(sum("flawlessWins")).toBeLessThanOrEqual(1);
  });

  it("five cucumbers: cucumbers eaten match the final board", () => {
    let s = cucumbers.startGame(4, 3);
    for (let g = 0; s.phase !== "gameOver" && g < 5000; g++) {
      s = cucumbers.applyAction(s, cucumbers.chooseBotAction(s, s.activeSeat, 2)! as cucumbers.EngineAction);
    }
    expect(s.phase).toBe("gameOver");
    for (const p of s.players) {
      const d = fiveCucumbersStatDetails(s, p.seat);
      expect(d.cucumbersEaten).toBe(p.cucumbers);
      expect(d.finalTricksSurvived ?? 0).toBeLessThanOrEqual(d.finalTricks ?? 0);
      expect(d.maxPenaltyOnce ?? 0).toBeLessThanOrEqual(p.cucumbers);
    }
  });
});
