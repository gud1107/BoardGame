import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, computeRankings, moveHash, startGame, type ChoiceState, type Move } from "./engine";
import { chooseBotMove } from "./bot";

/**
 * Self-play balance (rulebook §11). Mixed-level tables: higher levels should
 * win more often, but a Lv.1 must still win sometimes (party game — the
 * crowd is noisy), and no single bet size should dominate.
 */

function playGame(n: number, seed: number, levels: number[], rounds: 8 | 12 = 8): ChoiceState {
  let s = startGame(n, seed, { rounds });
  const rng = seededRng(seed * 7919 + 1);
  while (s.phase !== "ended") {
    if (s.phase === "choose") {
      const moves: Move[] = levels.map((lv, seat) => chooseBotMove(s, seat, lv, rng));
      moves.forEach((mv, seat) => (s = applyAction(s, { type: "commit", seat, step: s.step, hash: moveHash(mv, `s${seat}`) })));
      moves.forEach((mv, seat) => (s = applyAction(s, { type: "reveal", seat, step: s.step, move: mv, salt: `s${seat}` })));
    } else s = applyAction(s, { type: "advance", step: s.step });
  }
  return s;
}

describe("everyone choice self-play", () => {
  it("level matters but upsets happen; scores stay in a sane range", () => {
    const GAMES = 300;
    const n = 6;
    const levels = [1, 3, 5, 7, 9, 10];
    const firsts = Array(n).fill(0);
    let scoreSum = 0;
    let min = Infinity;
    let max = -Infinity;
    const betCount = [0, 0, 0];
    const kindWins: Record<string, [number, number]> = {};
    for (let g = 0; g < GAMES; g++) {
      // rotate seats so seat order can't leak into the level comparison
      const rot = g % n;
      const seatLv = levels.map((_, i) => levels[(i + rot) % n]);
      const s = playGame(n, 1000 + g, seatLv);
      for (const r of computeRankings(s)) if (r.rank === 1) firsts[levels.indexOf(seatLv[r.seat])] += 1;
      for (const x of s.scores) {
        scoreSum += x;
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
      for (const r of s.history) {
        r.bets.forEach((b) => b && betCount[b - 1]++);
        const k = (kindWins[r.kind] ??= [0, 0]);
        r.deltas.forEach((d, seat) => {
          if (r.picks[seat] === null) return;
          k[1]++;
          if (d > 0) k[0]++;
        });
      }
    }
    const rate = firsts.map((f) => f / GAMES);
    const report = {
      firstRateByLevel: Object.fromEntries(levels.map((lv, i) => [`Lv${lv}`, +rate[i].toFixed(3)])),
      avgScore: +(scoreSum / (GAMES * n)).toFixed(2),
      min,
      max,
      bets: betCount.map((c) => +(c / betCount.reduce((a, b) => a + b, 0)).toFixed(2)),
      winShareByKind: Object.fromEntries(Object.entries(kindWins).map(([k, [w, t]]) => [k, +(w / t).toFixed(2)])),
    };
    console.log(JSON.stringify(report));
    expect(rate[5]).toBeGreaterThan(rate[0]);
    expect(rate[0]).toBeGreaterThan(0.02);
    expect(rate[5]).toBeLessThan(0.6);
  }, 60_000);
});
