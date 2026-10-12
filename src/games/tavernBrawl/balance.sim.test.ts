import { describe, it } from "vitest";
import { classCounts, tribeCounts } from "./combat";
import { playBotGame } from "./sim";

// 로컬 밸런스 측정: TB_SIM=200 npx vitest run src/games/tavernBrawl/balance.sim.test.ts --reporter=verbose
const N = Number(process.env.TB_SIM ?? 0);

const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);

describe.skipIf(N === 0)("tavern brawl balance sim", () => {
  it("8 bots Lv.6, random heroes", () => {
    const rounds: number[] = [];
    const heroPlace: Record<string, number[]> = {};
    const tribePlace: Record<string, number[]> = {};
    const classPlace: Record<string, number[]> = {};
    const goldens: number[] = [];
    const t0 = Date.now();
    for (let g = 0; g < N; g++) {
      const { state, rounds: r } = playBotGame(Array(8).fill(6), 1000 + g, undefined, true);
      rounds.push(r);
      state.seats.forEach((s) => {
        (heroPlace[s.hero!] ??= []).push(s.place!);
        goldens.push(s.stats.triples);
        // 주력 = 보드에 3명 이상인 가장 많은 종족/직업
        const tm = Object.entries(tribeCounts(s.board)).sort((a, b) => b[1] - a[1])[0];
        (tribePlace[tm[1] >= 3 ? tm[0] : "(없음)"] ??= []).push(s.place!);
        const cm = Object.entries(classCounts(s.board)).sort((a, b) => b[1] - a[1])[0];
        (classPlace[cm[1] >= 3 ? cm[0] : "(없음)"] ??= []).push(s.place!);
      });
    }
    console.log(`games ${N} in ${Date.now() - t0}ms, rounds avg ${avg(rounds)} min ${Math.min(...rounds)} max ${Math.max(...rounds)}, triples/seat ${avg(goldens)}`);
    const show = (title: string, m: Record<string, number[]>) =>
      console.log(title, Object.fromEntries(Object.entries(m).sort((a, b) => Number(avg(a[1])) - Number(avg(b[1]))).map(([k, p]) => [k, `${avg(p)} (${p.length})`])));
    show("hero avg place", heroPlace);
    show("main tribe avg place", tribePlace);
    show("main class avg place", classPlace);
  }, 1_200_000);

  it("Lv.10 vs Lv.1 mix", () => {
    const place: Record<number, number[]> = {};
    for (let g = 0; g < Math.max(10, N / 4); g++) {
      const levels = [1, 3, 5, 7, 8, 9, 10, 10];
      const { state } = playBotGame(levels, 5000 + g);
      state.seats.forEach((s, i) => (place[levels[i]] ??= []).push(s.place!));
    }
    console.log("avg place by level", Object.fromEntries(Object.entries(place).map(([l, p]) => [l, avg(p)])));
  }, 1_200_000);
});
