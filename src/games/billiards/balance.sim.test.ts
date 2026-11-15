import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, computeRankings, currentActor, startGame, type BilliardsState, type GameOptions } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance check (rulebook §12). Skipped unless BIL_SIM is set:
 *   BIL_SIM=40 npx vitest run src/games/billiards/balance.sim.test.ts
 * Results go to BIL_OUT (default: billiards-sim.txt in the cwd) — vitest hides console output here.
 */
const N = Number(process.env.BIL_SIM ?? 0);
const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  writeFileSync(process.env.BIL_OUT ?? "billiards-sim.txt", lines.join("\n"));
};

function play(levels: number[], seed: number, options: Partial<GameOptions>): { s: BilliardsState; first: number; ms: number } {
  const rng = seededRng(seed * 31 + 7);
  let s = startGame(levels.length, seed, options);
  const first = s.activeSeat;
  let ms = 0;
  for (let guard = 0; guard < 600 && s.phase !== "ended"; guard++) {
    if (s.phase === "rackOver") {
      s = applyAction(s, { type: "next" });
      continue;
    }
    const actor = currentActor(s)!;
    const t0 = performance.now();
    const a = chooseBotAction(s, actor, levels[actor], rng);
    ms = Math.max(ms, performance.now() - t0);
    s = a ? applyAction(s, a) : applyAction(s, { type: "timeout", seat: actor, turn: s.turn });
  }
  return { s, first, ms };
}

describe.skipIf(!N)("billiards balance", { timeout: 3_000_000 }, () => {
  for (const mode of ["pocket", "carom"] as const) {
    it.each([[1], [5], [10]])(`${mode}: Lv.%i mirror 2p — length, first-player win rate`, (lv) => {
      let shots = 0;
      let firstWins = 0;
      let fouls = 0;
      let worst = 0;
      let limit = 0;
      for (let i = 0; i < N; i++) {
        const r = play([lv, lv], 1000 + i, { mode, target: 5 });
        shots += r.s.history.reduce((a, h) => a + h.shots, 0);
        fouls += r.s.fouls.reduce((a, b) => a + b, 0);
        if (computeRankings(r.s)[0].seat === r.first) firstWins++;
        if (r.s.history.some((h) => h.limitHit)) limit++;
        worst = Math.max(worst, r.ms);
      }
      log(`${mode} Lv${lv}x2: shots ${(shots / N).toFixed(1)}, fouls ${(fouls / N).toFixed(1)}, first wins ${((firstWins / N) * 100).toFixed(0)}%, limit ${((limit / N) * 100).toFixed(0)}%, slowest bot ${worst.toFixed(0)}ms`);
      expect(shots).toBeGreaterThan(0);
    });

    it(`${mode}: Lv.10 vs Lv.1 / Lv.5`, () => {
      for (const weak of [1, 5]) {
        let wins = 0;
        for (let i = 0; i < N; i++) {
          const strong = i % 2;
          const lv = strong === 0 ? [10, weak] : [weak, 10];
          if (computeRankings(play(lv, 3000 + i, { mode, target: 5 }).s)[0].seat === strong) wins++;
        }
        log(`${mode} Lv10 vs Lv${weak}: ${((wins / N) * 100).toFixed(0)}%`);
      }
    });

    it(`${mode}: 4p Lv.5 seat fairness`, () => {
      const by = [0, 0, 0, 0];
      let shots = 0;
      for (let i = 0; i < N; i++) {
        const r = play([5, 5, 5, 5], 6000 + i, { mode, target: 5 });
        by[computeRankings(r.s)[0].seat]++;
        shots += r.s.history.reduce((a, h) => a + h.shots, 0);
      }
      log(`${mode} 4p Lv5: wins by seat ${by.join("/")}, shots ${(shots / N).toFixed(1)}`);
    });
  }
});
