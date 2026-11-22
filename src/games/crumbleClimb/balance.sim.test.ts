import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수백 라운드를 돌려
 * ① 레벨이 높을수록 확실히 이기는지 ② 라운드 길이·등정률이 적당한지 ③ 방해 카드가 선두를 실제로
 * 흔드는지(따라잡기) ④ 출발 자리 편차가 없는지 ⑤ 판이 반드시 끝나는지 본다.
 * 수치를 바꾸면 이 테스트로 다시 확인한다. 측정 기록은 룰북 §13 표.
 */

function play(levels: number[], seed: number, rounds: 1 | 3 | 5 = 3, opts: { items?: boolean; sabotage?: boolean } = {}): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { rounds, items: opts.items ?? true, sabotage: opts.sabotage ?? true });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 60 * 12) step(rt);
  return s;
}

/** 강한 쪽 둘·약한 쪽 둘 (자리 번갈아) — 1등이 강한 쪽인 비율 */
function strongerWins(a: number, b: number, games: number, seed0: number): number {
  let w = 0;
  for (let g = 0; g < games; g++) {
    const flip = g % 2 === 1;
    const s = play(flip ? [b, a, b, a] : [a, b, a, b], seed0 + g);
    const first = s.ranks!.indexOf(1);
    if (s.players[first].lv === a) w++;
  }
  return w / games;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

describe("무너지는 탑 오르기 셀프플레이", () => {
  it("레벨이 높을수록 확실히 이긴다", () => {
    expect(strongerWins(10, 1, 12, 100)).toBeGreaterThanOrEqual(0.9);
    expect(strongerWins(7, 3, 12, 200)).toBeGreaterThanOrEqual(0.75);
    expect(strongerWins(4, 2, 12, 300)).toBeGreaterThanOrEqual(0.6);
  });

  it("라운드 길이·등정률이 적당하고, 판이 끝까지 끝난다", () => {
    const lengths: number[] = [];
    let finished = 0;
    let total = 0;
    let empty = 0;
    for (const [n, games] of [
      [2, 6],
      [4, 6],
      [6, 4],
    ] as const) {
      for (let g = 0; g < games; g++) {
        const s = play(Array.from({ length: n }, () => 5), 1000 + n * 50 + g);
        expect(s.phase).toBe("gameOver");
        for (const h of s.history) {
          lengths.push(h.ms);
          if (h.order.length === 0) empty++;
        }
        for (const p of s.players) {
          finished += p.stats.finishes;
          total += s.history.length;
        }
      }
    }
    const med = median(lengths);
    expect(med).toBeGreaterThan(30_000);
    expect(med).toBeLessThan(65_000);
    // Lv.5끼리: 절반쯤 오르고, 아무도 못 오르는 라운드는 드물다
    expect(finished / total).toBeGreaterThan(0.35);
    expect(finished / total).toBeLessThan(0.9);
    expect(empty / lengths.length).toBeLessThan(0.15);
  });

  it("방해 카드가 있으면 20초 시점 선두가 그대로 이기는 비율이 확실히 낮다 (따라잡기)", () => {
    const keepRate = (sabotage: boolean) => {
      let keep = 0;
      let n = 0;
      for (let g = 0; g < 30; g++) {
        const s = createMatch(3000 + g, [5, 5, 5, 5].map((level) => ({ bot: true, level })), { rounds: 1, sabotage, items: sabotage });
        const rt = createHost(s, botThink);
        let lead = -1;
        let guard = 0;
        while (s.phase !== "gameOver" && guard++ < 60 * 300) {
          step(rt);
          if (s.phase === "climb" && lead < 0 && s.t - s.climbStart >= 20_000) lead = s.players.reduce((a, b) => (b.y > a.y ? b : a)).seat;
        }
        const first = s.history[0].order[0];
        if (lead >= 0 && first !== undefined) {
          n++;
          if (first === lead) keep++;
        }
      }
      return keep / n;
    };
    const plain = keepRate(false);
    const sab = keepRate(true);
    expect(sab).toBeLessThan(plain - 0.1);
    expect(sab).toBeGreaterThan(0.25);
  });

  it("같은 레벨 4명이면 어느 출발 자리도 크게 유리하지 않다", () => {
    const wins = [0, 0, 0, 0];
    const games = 40;
    for (let g = 0; g < games; g++) {
      const s = play([5, 5, 5, 5], 5000 + g, 1);
      s.ranks!.forEach((r, i) => {
        if (r === 1) wins[i]++;
      });
    }
    for (const w of wins) {
      expect(w / games).toBeGreaterThan(0.08);
      expect(w / games).toBeLessThan(0.45);
    }
  });
});
