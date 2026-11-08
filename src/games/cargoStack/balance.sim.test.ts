import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { applyAction, computeRankings, currentActor, startGame, type CargoState } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance checks (rulebook §9 / §14). Numbers printed with
 * CARGO_SIM_LOG=1 are the ones quoted in the rulebook / HANDOFF.
 */

export function playOut(levels: BotLevel[], seed: number, voyages: 1 | 2 | 3 = 3): CargoState {
  const rng = seededRng(seed * 31 + 7);
  let s = startGame(levels.length, seed, { voyages, weather: true, helper: true });
  for (let i = 0; i < 2000 && s.phase !== "ended"; i++) {
    const a = currentActor(s)!;
    const next = applyAction(s, chooseBotAction(s, a, levels[a], rng));
    if (next === s) throw new Error(`bot made an illegal move at turn ${s.turn}`);
    s = next;
  }
  return s;
}

function winRate(levels: BotLevel[], games: number, seat = 0, seed0 = 1): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    // rotate seats so first-player advantage cancels out
    const rot = g % levels.length;
    const lv = levels.map((_, i) => levels[(i + rot) % levels.length]);
    const s = playOut(lv, seed0 + g);
    const me = (seat - rot + levels.length) % levels.length;
    const r = computeRankings(s).find((x) => x.seat === me)!;
    if (r.rank === 1) wins++;
  }
  return wins / games;
}

const log = (...a: unknown[]) => {
  if (process.env.CARGO_SIM_LOG) console.log(...a);
};

describe("cargo stack self-play", () => {
  it("every bot game ends without illegal moves", () => {
    for (let n = 1; n <= 6; n++) {
      for (let g = 0; g < 4; g++) {
        const s = playOut(Array.from({ length: n }, (_, i) => ((i * 3 + g) % 10) + 1) as BotLevel[], 100 + n * 10 + g);
        expect(s.phase).toBe("ended");
        expect(s.departures.length).toBe(3);
      }
    }
  });

  it("Lv.10 beats Lv.1 most of the time (2p)", () => {
    const r = winRate([10, 1], 60);
    log("Lv10 vs Lv1 win", r);
    expect(r).toBeGreaterThan(0.8);
  });

  it("Lv.7 beats Lv.3 more often than not (2p)", () => {
    const r = winRate([7, 3], 60, 0, 500);
    log("Lv7 vs Lv3 win", r);
    expect(r).toBeGreaterThan(0.6);
  });

  it("seat 0 has no big edge in a Lv.6 mirror (2p and 4p)", () => {
    let w2 = 0;
    let w4 = 0;
    const G = 80;
    for (let g = 0; g < G; g++) {
      if (computeRankings(playOut([6, 6], 900 + g)).find((r) => r.seat === 0)!.rank === 1) w2++;
      if (computeRankings(playOut([6, 6, 6, 6], 1900 + g)).find((r) => r.seat === 0)!.rank === 1) w4++;
    }
    log("seat0 win 2p", w2 / G, "4p", w4 / G);
    expect(w2 / G).toBeGreaterThan(0.3);
    expect(w2 / G).toBeLessThan(0.7);
    expect(w4 / G).toBeGreaterThan(0.1);
    expect(w4 / G).toBeLessThan(0.45);
  });

  it("spills happen but capsizes stay rare for good bots; scores stay in a sane band", () => {
    for (const n of [2, 4, 6]) {
      let spills = 0;
      let caps = 0;
      let top = 0;
      let turns = 0;
      let maxTier = 0;
      const G = 30;
      for (let g = 0; g < G; g++) {
        const s = playOut(Array(n).fill(7) as BotLevel[], 3000 + n * 100 + g);
        for (let seat = 0; seat < n; seat++) {
          const t = s.statTally?.[seat] ?? {};
          spills += (t.spills ?? 0) + (t.stormLost ?? 0);
          caps += t.capsizes ?? 0;
          maxTier = Math.max(maxTier, t.maxTier ?? 0);
        }
        top += Math.max(...s.scores);
        turns += s.turn;
      }
      log(`${n}p Lv7: spills/game ${(spills / G).toFixed(2)} capsizes/game ${(caps / G).toFixed(2)} winner avg ${(top / G).toFixed(1)} turns ${(turns / G).toFixed(1)} maxTier ${maxTier}`);
      expect(caps / G).toBeLessThan(0.6);
      expect(top / G).toBeGreaterThan(20);
    }
  });

  it("weak bots spill and capsize more than strong ones", () => {
    const count = (lv: BotLevel) => {
      let bad = 0;
      for (let g = 0; g < 30; g++) {
        const s = playOut([lv, lv, lv], 7000 + g);
        for (let seat = 0; seat < 3; seat++) {
          const t = s.statTally?.[seat] ?? {};
          bad += (t.spills ?? 0) + 3 * (t.capsizes ?? 0);
        }
      }
      return bad / 30;
    };
    const weak = count(1);
    const strong = count(10);
    log("spill+3cap per game Lv1", weak, "Lv10", strong);
    expect(weak).toBeGreaterThan(strong);
  });
});
