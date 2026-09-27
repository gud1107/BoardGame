import { describe, expect, it } from "vitest";
import { purseValue } from "./constants";
import { applyAction, chooseBotAction, startGame } from "./engine";

/**
 * Regression guard for bot budget pacing (engine.ts budgetPerLot). Before it,
 * 4-player Lv9 bots went broke by ~lot 12 of 22 in 73% of seats and one bot
 * won 54% of all lots on average; after, ~38% / ~38%.
 */
describe("bot economy (4p, Lv9, seeded)", () => {
  it("no single bot hoards the deck and most bots still have coins at the end", () => {
    const seeds = 30;
    let topShare = 0;
    let brokeSeats = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let s = startGame("4p", seed);
      let r = seed * 7919;
      const rng = () => ((r = (r * 16807) % 2147483647), r / 2147483647);
      const won = new Map<number, number>();
      let lots = 0;
      while (s.phase === "playing") {
        const cardId = s.auction!.card.cardId;
        const before = s.players;
        s = applyAction(s, chooseBotAction(s, s.auction!.activeSeat, 9, rng)!);
        if (!s.auction || s.auction.card.cardId !== cardId) {
          lots++;
          const w = s.players.find((p) => {
            const o = before.find((q) => q.seat === p.seat)!;
            return o.assets !== p.assets || o.pendingSpecials !== p.pendingSpecials;
          });
          if (w) won.set(w.seat, (won.get(w.seat) ?? 0) + 1);
        }
      }
      topShare += Math.max(...won.values()) / lots;
      brokeSeats += s.players.filter((p) => purseValue(p.purse) === 0).length;
    }
    expect(topShare / seeds).toBeLessThan(0.45);
    expect(brokeSeats / (seeds * 4)).toBeLessThan(0.5);
  });
});
