import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { createHost, createMatch, step } from "./sim";

/**
 * Self-play balance check (rulebook §13). Skipped unless SF_SIM is set:
 *   SF_SIM=20 SF_OUT=sf.txt npx vitest run src/games/snowballFort/balance.sim.test.ts
 */
const N = Number(process.env.SF_SIM ?? 0);
const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  writeFileSync(process.env.SF_OUT ?? "snowball-sim.txt", lines.join("\n"));
};

function playRound(levels: number[], seed: number) {
  const rt = createHost(
    createMatch(
      seed,
      levels.map((level) => ({ bot: true, level })),
      { rounds: 1 },
    ),
    botThink,
  );
  let guard = 0;
  while (rt.state.phase !== "gameOver" && guard++ < 60 * 240) step(rt);
  return rt.state;
}

describe.skipIf(!N)("snowball fort balance", { timeout: 3_000_000 }, () => {
  it.each([
    [[5, 5]],
    [[5, 5, 5, 5]],
    [[5, 5, 5, 5, 5, 5, 5, 5]],
    [[8, 8, 8, 8]],
    [[2, 2, 2, 2]],
  ])("mirror %j: round length, win reasons, team fairness", (levels) => {
    const wins = [0, 0, 0];
    let ms = 0;
    const reasons: Record<string, number> = {};
    let throws = 0;
    let hits = 0;
    let freezes = 0;
    let walls = 0;
    for (let i = 0; i < N; i++) {
      const s = playRound(levels, 100 + i);
      const h = s.history[0];
      wins[h.winner < 0 ? 2 : h.winner]++;
      ms += h.ms;
      reasons[h.reason] = (reasons[h.reason] ?? 0) + 1;
      for (const p of s.players) {
        throws += p.stats.throws;
        hits += p.stats.hits;
        freezes += p.stats.freezes;
        walls += p.stats.walls;
      }
    }
    log(
      `${levels.length}p Lv${levels[0]}: team wins ${wins[0]}/${wins[1]} draw ${wins[2]}, round ${(ms / N / 1000).toFixed(0)}s, ${JSON.stringify(reasons)}, per player: throws ${(throws / N / levels.length).toFixed(0)}, acc ${((hits / Math.max(1, throws)) * 100).toFixed(0)}%, freezes ${(freezes / N / levels.length).toFixed(1)}, walls ${(walls / N / levels.length).toFixed(1)}`,
    );
    expect(ms).toBeGreaterThan(0);
  });

  it("uneven teams 3v2 and 2v1 (small team bonus)", () => {
    for (const n of [3, 5]) {
      const wins = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        const h = playRound(Array(n).fill(5), 300 + i).history[0];
        wins[h.winner < 0 ? 2 : h.winner]++;
      }
      log(`${n}p uneven Lv5: big team ${wins[0]} / small team ${wins[1]} / draw ${wins[2]}`);
    }
  });

  it("level gap: Lv.8 team vs Lv.3 team (4p)", () => {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const strong = i % 2;
      const lv = [0, 1, 2, 3].map((seat) => (seat % 2 === strong ? 8 : 3));
      const h = playRound(lv, 500 + i).history[0];
      if (h.winner === strong) w++;
    }
    log(`4p Lv8 team vs Lv3 team: strong wins ${((w / N) * 100).toFixed(0)}%`);
  });
});
