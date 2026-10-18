import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, currentActor, startGame, type AlkkagiState, type GameOptions } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance check (rulebook §16). Skipped unless AK_SIM is set:
 *   AK_SIM=200 npx vitest run src/games/alkkagi/balance.sim.test.ts --reporter=verbose
 */
const N = Number(process.env.AK_SIM ?? 0);

function playRound(levels: number[], seed: number, options: Partial<GameOptions> = {}): { state: AlkkagiState; first: number; ms: number } {
  const rng = seededRng(seed * 31 + 7);
  let s = startGame(levels.length, seed, { stones: "normal", rounds: 1, king: false, ...options });
  const first = s.activeSeat;
  let ms = 0;
  for (let guard = 0; guard < 400 && s.phase === "aim"; guard++) {
    const actor = currentActor(s)!;
    const t0 = performance.now();
    const a = chooseBotAction(s, actor, levels[actor], rng);
    ms = Math.max(ms, performance.now() - t0);
    s = a ? applyAction(s, a) : applyAction(s, { type: "timeout", seat: actor, turn: s.turn });
  }
  return { state: s, first, ms };
}

const winner = (s: AlkkagiState) => s.history[0].places[0];

describe.skipIf(!N)("alkkagi balance", { timeout: 1_200_000 }, () => {
  it.each([[1], [5], [10]])("Lv.%i mirror 2p: length, first-player win rate", (lv) => {
    let shots = 0;
    let firstWins = 0;
    let limit = 0;
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const r = playRound([lv, lv], 1000 + i);
      shots += r.state.roundShots;
      if (winner(r.state) === r.first) firstWins++;
      if (r.state.history[0].limitHit) limit++;
      worst = Math.max(worst, r.ms);
    }
    console.log(`Lv${lv}×2 mean shots ${(shots / N).toFixed(1)}, first wins ${((firstWins / N) * 100).toFixed(1)}%, limit ${((limit / N) * 100).toFixed(1)}%, slowest bot ${worst.toFixed(0)}ms`);
    expect(shots).toBeGreaterThan(0);
  });

  it("Lv.10 vs Lv.1 / Lv.5 (2p)", () => {
    for (const weak of [1, 5]) {
      let wins = 0;
      for (let i = 0; i < N; i++) {
        const strongSeat = i % 2;
        const levels = strongSeat === 0 ? [10, weak] : [weak, 10];
        if (winner(playRound(levels, 3000 + i).state) === strongSeat) wins++;
      }
      console.log(`Lv10 vs Lv${weak}: ${((wins / N) * 100).toFixed(1)}%`);
    }
  });

  it("4p Lv.5: length and seat/first fairness", () => {
    let shots = 0;
    let firstWins = 0;
    const bySide = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const r = playRound([5, 5, 5, 5], 6000 + i);
      shots += r.state.roundShots;
      if (winner(r.state) === r.first) firstWins++;
      bySide[winner(r.state)]++;
    }
    console.log(`4p Lv5 mean shots ${(shots / N).toFixed(1)}, first wins ${((firstWins / N) * 100).toFixed(1)}%, wins by seat ${bySide.join("/")}`);
  });

  it("3p Lv.5: seat fairness (south is between two neighbours)", () => {
    const bySeat = [0, 0, 0];
    for (let i = 0; i < N; i++) bySeat[winner(playRound([5, 5, 5], 8000 + i).state)]++;
    console.log(`3p Lv5 wins by seat ${bySeat.join("/")}`);
  });

  it("king mode 2p Lv.5", () => {
    let shots = 0;
    for (let i = 0; i < N; i++) shots += playRound([5, 5], 9000 + i, { king: true }).state.roundShots;
    console.log(`king 2p Lv5 mean shots ${(shots / N).toFixed(1)}`);
  });
});
