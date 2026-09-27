import { describe, expect, it } from "vitest";
import { purseValue } from "./constants";
import { applyAction, chooseBotAction, computeRankings, startGame } from "./engine";

/**
 * Regression guard for bot budget pacing (engine.ts budgetPerLot). Before it,
 * 4-player Lv9 bots went broke by ~lot 12 of 22 in 73% of seats and one bot
 * won 54% of all lots on average. Now bots may still empty their purse — but
 * only in the final round (endgame spend-down; coins are tiebreak-only).
 */
describe("bot economy (4p, Lv9, seeded)", () => {
  it("no single bot hoards the deck and few bots go broke before the final round", () => {
    const seeds = 30;
    let topShare = 0;
    let brokeSeats = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let s = startGame("4p", seed);
      let r = seed * 7919;
      const rng = () => ((r = (r * 16807) % 2147483647), r / 2147483647);
      const won = new Map<number, number>();
      let lots = 0;
      const brokeEarly = new Set<number>();
      while (s.phase === "playing") {
        if (s.deck.length + 1 > s.players.length) for (const p of s.players) if (purseValue(p.purse) === 0 && !(s.auction?.committed[p.seat])) brokeEarly.add(p.seat);
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
      brokeSeats += brokeEarly.size;
    }
    expect(topShare / seeds).toBeLessThan(0.45);
    expect(brokeSeats / (seeds * 4)).toBeLessThan(0.3);
  });
});

describe("bot level ladder (engine.ts botProfile)", () => {
  // One bot of level \`x\` against three Lv3s; win share over seeded games (ties split).
  function winShare(x: number, seeds: number): number {
    let wins = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const xSeat = seed % 4;
      let s = startGame("4p", seed);
      let r = seed * 7919 + x;
      const rng = () => ((r = (r * 16807) % 2147483647), r / 2147483647);
      while (s.phase === "playing") {
        const seat = s.auction!.activeSeat;
        s = applyAction(s, chooseBotAction(s, seat, seat === xSeat ? x : 3, rng)!);
      }
      const top = computeRankings(s).filter((t) => t.rank === 1);
      if (top.some((t) => t.seat === xSeat)) wins += 1 / top.length;
    }
    return wins / seeds;
  }

  it("higher levels win clearly more often (Lv2 < Lv5 < Lv8)", () => {
    const [l2, l5, l8] = [2, 5, 8].map((x) => winShare(x, 150));
    expect(l5 - l2).toBeGreaterThan(0.2);
    expect(l8 - l5).toBeGreaterThan(0.03);
  });
});
