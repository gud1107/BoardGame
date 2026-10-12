import { describe, it } from "vitest";
import { tribeCounts } from "./combat";
import { playBotGame } from "./sim";
import type { Tribe } from "./units";

// 로컬 밸런스 측정: TB_SIM=200 npx vitest run src/games/tavernBrawl/balance.sim.test.ts
const N = Number(process.env.TB_SIM ?? 0);

describe.skipIf(N === 0)("tavern brawl balance sim", () => {
  it("8 bots Lv.5", () => {
    const rounds: number[] = [];
    const tribeWins: Record<string, number> = {};
    const tribeTop: Record<string, number> = {};
    const heroPlace: Record<string, number[]> = {};
    const goldens: number[] = [];
    const finalTier: number[] = [];
    const t0 = Date.now();
    for (let g = 0; g < N; g++) {
      const { state, rounds: r } = playBotGame(Array(8).fill(5), 1000 + g);
      rounds.push(r);
      state.seats.forEach((s) => {
        (heroPlace[s.hero!] ??= []).push(s.place!);
        goldens.push(s.stats.triples);
        finalTier.push(s.stats.maxTier);
        const c = tribeCounts(s.board);
        const main = (Object.entries(c) as [Tribe, number][]).sort((a, b) => b[1] - a[1])[0];
        const key = main[1] >= 2 ? main[0] : "mixed";
        tribeTop[key] = (tribeTop[key] ?? 0) + 1;
        if (s.place === 1) tribeWins[key] = (tribeWins[key] ?? 0) + 1;
      });
    }
    const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
    console.log(`games ${N} in ${Date.now() - t0}ms, rounds avg ${avg(rounds)} min ${Math.min(...rounds)} max ${Math.max(...rounds)}`);
    console.log("triples/seat", avg(goldens), "maxTier", avg(finalTier));
    console.log("hero avg place", Object.fromEntries(Object.entries(heroPlace).map(([h, p]) => [h, `${avg(p)} (${p.length})`])));
    console.log(
      "tribe win% (wins/appearances)",
      Object.fromEntries(Object.entries(tribeTop).map(([t, n]) => [t, `${(((tribeWins[t] ?? 0) / n) * 100).toFixed(1)}% of ${n}`])),
    );
  }, 600_000);

  it("Lv.10 vs Lv.1 mix", () => {
    const place: Record<number, number[]> = {};
    for (let g = 0; g < Math.max(10, N / 4); g++) {
      const levels = [1, 3, 5, 7, 8, 9, 10, 10];
      const { state } = playBotGame(levels, 5000 + g);
      state.seats.forEach((s, i) => (place[levels[i]] ??= []).push(s.place!));
    }
    console.log("avg place by level", Object.fromEntries(Object.entries(place).map(([l, p]) => [l, (p.reduce((a, b) => a + b, 0) / p.length).toFixed(2)])));
  }, 600_000);
});
