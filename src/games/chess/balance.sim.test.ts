import { describe, expect, it } from "vitest";
import { applyAction, chooseBotAction, currentActor, startGame, type ChessState, type EngineAction, type Seat } from "./engine";

/**
 * Bot self-play (rulebook §18). Skipped unless CHESS_SIM is set:
 *   CHESS_SIM=6 npx vitest run src/games/chess/balance.sim.test.ts --reporter=verbose
 * Expert levels use a reduced budget here (EXPERT_MS) so a run takes minutes, not hours.
 */

const GAMES = Number(process.env.CHESS_SIM ?? 0);
const EXPERT_MS = 250;

function playOut(a: number, b: number, seed: number, aIsWhite: boolean): { score: number; plies: number; ms: Record<number, number[]> } {
  let s: ChessState = startGame(seed, { hostColor: aIsWhite ? "w" : "b" });
  const ms: Record<number, number[]> = { [a]: [], [b]: [] };
  while (s.phase === "playing" && s.moves.length < 300) {
    const seat = currentActor(s) as Seat;
    const lv = seat === "p1" ? a : b;
    const t = Date.now();
    const act = chooseBotAction(s, seat, lv, Math.random, { budgetMs: EXPERT_MS }) as EngineAction;
    ms[lv].push(Date.now() - t);
    s = applyAction(s, act);
  }
  const r = s.result;
  const aColor = s.colors.p1;
  const score = !r || r.winner === null ? 0.5 : r.winner === aColor ? 1 : 0;
  return { score, plies: s.moves.length, ms };
}

describe.skipIf(!GAMES)("chess bot ladder", () => {
  for (const [a, b] of [
    [3, 1],
    [5, 3],
    [7, 5],
    [10, 7],
  ] as const) {
    it(`Lv.${a} vs Lv.${b}`, () => {
      let total = 0;
      const times: number[] = [];
      const timesB: number[] = [];
      let plies = 0;
      for (let g = 0; g < GAMES; g++) {
        const res = playOut(a, b, 1000 + g, g % 2 === 0);
        total += res.score;
        plies += res.plies;
        times.push(...res.ms[a]);
        timesB.push(...res.ms[b]);
      }
      const avg = (xs: number[]) => Math.round(xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length));
      console.log(`Lv.${a} vs Lv.${b}: ${((total / GAMES) * 100).toFixed(0)}% · avg ${Math.round(plies / GAMES)} plies · ${avg(times)}ms / ${avg(timesB)}ms per move (max ${Math.max(...times)} / ${Math.max(...timesB)})`);
      expect(total / GAMES).toBeGreaterThanOrEqual(0.5);
    }, 3_600_000);
  }
});
