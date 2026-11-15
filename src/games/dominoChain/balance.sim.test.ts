import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, computeRankings, currentActor, startGame, type DominoState } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance check (rulebook §10). Skipped unless DC_SIM is set:
 *   DC_SIM=40 DC_OUT=dc.txt npx vitest run src/games/dominoChain/balance.sim.test.ts
 */
const N = Number(process.env.DC_SIM ?? 0);
const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  writeFileSync(process.env.DC_OUT ?? "domino-sim.txt", lines.join("\n"));
};

function play(levels: number[], seed: number): DominoState {
  const rng = seededRng(seed * 13 + 1);
  let s = startGame(levels.length, seed, { rounds: 3, turns: Number(process.env.DC_TURNS ?? 0) });
  for (let guard = 0; guard < 800 && s.phase !== "ended"; guard++) {
    if (s.phase === "topple") {
      s = applyAction(s, { type: "next" });
      continue;
    }
    const actor = currentActor(s)!;
    const a = chooseBotAction(s, actor, levels[actor], rng) ?? { type: "pass" as const, seat: actor };
    s = applyAction(s, a);
  }
  return s;
}

describe.skipIf(!N)("domino chain balance", { timeout: 3_000_000 }, () => {
  it.each([[2], [3], [4]])("%ip Lv.6 mirror: seat fairness, scores, steals, bombs", (n) => {
    const wins = Array(n).fill(0);
    const seatPts = Array(n).fill(0);
    let pts = 0;
    let steals = 0;
    let bombs = 0;
    let spread = 0;
    let ms = 0;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const s = play(Array(n).fill(6), 500 + i);
      ms = Math.max(ms, (performance.now() - t0) / (s.history.length || 1));
      for (const r of computeRankings(s)) if (r.rank === 1) wins[r.seat]++;
      pts += s.scores.reduce((a, b) => a + b, 0) / n;
      s.scores.forEach((v, k) => (seatPts[k] += v));
      steals += s.history.reduce((a, r) => a + r.steals.reduce((x, y) => x + y, 0), 0);
      bombs += s.history.reduce((a, r) => a + r.bombs.reduce((x, y) => x + y, 0), 0);
      spread += Math.max(...s.scores) - Math.min(...s.scores);
    }
    log(`${n}p avg score by seat ${seatPts.map((v) => (v / N).toFixed(1)).join("/")}`);
    log(`${n}p Lv6: wins by seat ${wins.join("/")}, avg score ${(pts / N).toFixed(1)}, spread ${(spread / N).toFixed(1)}, steals/game ${(steals / N).toFixed(1)}, bombs/game ${(bombs / N).toFixed(1)}, slowest round ${ms.toFixed(0)}ms`);
    expect(pts).toBeGreaterThan(0);
  });

  it("2p Lv.6: does building first or last win more? (per round)", () => {
    let firstBetter = 0;
    let lastBetter = 0;
    let ties = 0;
    for (let i = 0; i < N * 2; i++) {
      const s = play([6, 6], 1500 + i);
      const opener = startGame(2, 1500 + i).firstSeat;
      const r = computeRankings(s);
      if (r[0].rank === r[1].rank) ties++;
      else if (r[0].seat === opener) firstBetter++;
      else lastBetter++;
    }
    log(`2p games: round-1 opener wins ${firstBetter}, the other wins ${lastBetter}, ties ${ties}`);
  });

  it("Lv.10 vs Lv.1 / Lv.5 (2p)", () => {
    for (const weak of [1, 5]) {
      let w = 0;
      let draws = 0;
      for (let i = 0; i < N; i++) {
        const strong = i % 2;
        const r = computeRankings(play(strong === 0 ? [10, weak] : [weak, 10], 900 + i));
        if (r[0].rank === r[1].rank) draws++;
        else if (r[0].seat === strong) w++;
      }
      log(`Lv10 vs Lv${weak}: ${((w / N) * 100).toFixed(0)}% win, ${((draws / N) * 100).toFixed(0)}% draw`);
    }
  });
});
