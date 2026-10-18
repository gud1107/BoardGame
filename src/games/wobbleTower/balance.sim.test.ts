import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, chooseBotAction, currentActor, startGame, type WobbleTowerState } from "./engine";

/**
 * Self-play balance check (rulebook §15). Skipped unless WT_SIM is set:
 *   WT_SIM=400 npx vitest run src/games/wobbleTower/balance.sim.test.ts --reporter=verbose
 */
const N = Number(process.env.WT_SIM ?? 0);

function playRound(levels: number[], seed: number): { loser: number; pulls: number; height: number } {
  const rng = seededRng(seed * 31 + 7);
  let s: WobbleTowerState = startGame(levels.length, seed);
  for (let guard = 0; guard < 2000 && s.phase !== "collapsed"; guard++) {
    const actor = currentActor(s)!;
    const a = chooseBotAction(s, actor, levels[actor], rng);
    if (!a) throw new Error("bot stuck");
    s = applyAction(s, a);
  }
  return { loser: s.collapse!.seat, pulls: s.roundPulls, height: s.levels.length };
}

describe.skipIf(!N)("wobble tower balance", { timeout: 600_000 }, () => {
  it("4× Lv.5: round length", () => {
    const pulls: number[] = [];
    let early = 0;
    for (let i = 0; i < N; i++) {
      const r = playRound([5, 5, 5, 5], 1000 + i);
      pulls.push(r.pulls);
      if (r.pulls < 5) early++;
    }
    pulls.sort((a, b) => a - b);
    const mean = pulls.reduce((a, b) => a + b, 0) / N;
    console.log(`Lv5×4 mean pulls ${mean.toFixed(1)}, median ${pulls[N >> 1]}, p10 ${pulls[Math.floor(N * 0.1)]}, p90 ${pulls[Math.floor(N * 0.9)]}, early(<5) ${((early / N) * 100).toFixed(1)}%`);
    expect(mean).toBeGreaterThan(0);
  });

  it.each([[1], [3], [5], [8], [10]])("Lv.%i ×4: round length", (lv) => {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += playRound([lv, lv, lv, lv], 5000 + i).pulls;
    console.log(`Lv${lv}×4 mean pulls ${(sum / N).toFixed(1)}`);
  });

  it("Lv.10 vs 3× Lv.1: how often Lv.10 collapses", () => {
    let lost = 0;
    for (let i = 0; i < N; i++) if (playRound([10, 1, 1, 1].map((_, k, arr) => arr[(k + i) % 4]), 9000 + i).loser === (4 - (i % 4)) % 4) lost++;
    console.log(`Lv10 collapse rate ${((lost / N) * 100).toFixed(1)}% (chance 25%)`);
  });

  it("Lv.5 vs 3× Lv.5 2p/6p", () => {
    for (const n of [2, 6]) {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += playRound(Array(n).fill(5), 20000 + i).pulls;
      console.log(`${n}p Lv5 mean pulls ${(sum / N).toFixed(1)}`);
    }
  });
});
