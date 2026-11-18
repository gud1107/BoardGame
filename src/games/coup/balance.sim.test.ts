import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAction, chooseBotAction, getValidMoves, startGame, type CoupState } from "./engine";

/**
 * 셀프플레이 밸런스 (2026-11-19 추가). 예전 테스트는 덱·셋업·규칙만 봤다 — 여기서는 끝까지 둔 판의 승률을 본다.
 * 숫자를 다시 보려면 `COUP_SIM_LOG=<파일>`로 돌린다(판 수가 늘어남). 단언은 "무너지지 않았는지"만 본다.
 */

function rngOf(seed: number): () => number {
  let x = seed % 2147483647 || 1;
  return () => {
    x = (x * 48271) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

function playCoup(n: number, seed: number, levels: number[]): { s: CoupState; steps: number } {
  let s = startGame(n, seed);
  const rng = rngOf(seed * 13 + 5);
  let steps = 0;
  for (; steps < 5000 && s.winnerSeat === null; steps++) {
    const seat = Array.from({ length: n }, (_, i) => i).find((i) => getValidMoves(s, i).length > 0);
    if (seat === undefined) break;
    s = applyAction(s, chooseBotAction(s, seat, levels[seat] as never, rng)!);
  }
  return { s, steps };
}

const LOG = process.env.COUP_SIM_LOG;
const GAMES = LOG ? 400 : 60;
const log = (line: string) => LOG && appendFileSync(LOG, line + "\n");

describe("coup balance (self-play)", () => {
  it.each([2, 3, 4, 5, 6])("%d players, all Lv.5: every game ends, no seat dominates", (n) => {
    const wins = Array(n).fill(0);
    let steps = 0;
    for (let g = 0; g < GAMES; g++) {
      const r = playCoup(n, 100 + g * 37 + n, Array(n).fill(5));
      expect(r.s.winnerSeat).not.toBeNull();
      wins[r.s.winnerSeat!]++;
      steps += r.steps;
    }
    log(`${n}인 Lv5: 자리별 승 ${wins.join("/")} (공정 ${Math.round(GAMES / n)}) · 평균 ${Math.round(steps / GAMES)}수`);
    for (const w of wins) expect(w / GAMES).toBeLessThan(Math.min(0.9, 2.2 / n));
  });

  it.each([[2, 9], [4, 9], [4, 1], [6, 9]])("%d players, one Lv.%d among Lv.5s", (n, lv) => {
    let won = 0;
    for (let g = 0; g < GAMES; g++) {
      const hero = g % n;
      const levels = Array(n).fill(5);
      levels[hero] = lv;
      if (playCoup(n, 900 + g * 41 + n, levels).s.winnerSeat === hero) won++;
    }
    const rate = won / GAMES;
    log(`${n}인 Lv${lv} 1명 vs Lv5: ${Math.round(rate * 100)}% (공정 ${Math.round(100 / n)}%)`);
    if (lv > 5) expect(rate).toBeGreaterThan(1 / n);
    else expect(rate).toBeLessThan(1 / n);
  });
});
