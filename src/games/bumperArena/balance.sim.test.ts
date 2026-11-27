import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수백 라운드를 돌려
 * ① 레벨이 높을수록 확실히 이기는지 ② 라운드 길이가 적당한지 ③ 자리(시작 위치) 편차가 없는지
 * ④ 혼자 떨어지는(자폭) 비율이 낮은지 본다. 수치를 바꾸면 이 테스트로 다시 확인한다.
 *
 * 2026-11-08 측정(20판씩): Lv10 vs Lv1 20:0 · Lv7 vs Lv3 20:0 · Lv5 거울 8:12,
 * 라운드 중앙값 2인 ~14초 / 4인 ~21초 / 6인 ~24초, 4인전 Lv10 1명 vs Lv5 3명 → Lv10 우승 50%.
 */

function play(levels: number[], seed: number, rounds: 3 | 5 = 3): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { rounds });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 60 * 15) step(rt);
  return s;
}

function winRate(a: number, b: number, games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    // 자리를 번갈아 (0번 자리 이점 배제)
    const flip = g % 2 === 1;
    const s = play(flip ? [b, a] : [a, b], seed0 + g);
    const me = flip ? 1 : 0;
    if (s.ranks![me] === 1 && s.ranks![1 - me] !== 1) wins++;
  }
  return wins / games;
}

describe("범퍼 아레나 셀프플레이", () => {
  it("Lv.10은 Lv.1을 거의 항상 이긴다", () => {
    expect(winRate(10, 1, 16, 100)).toBeGreaterThanOrEqual(0.9);
  });

  it("Lv.7은 Lv.3을 대부분 이긴다", () => {
    expect(winRate(7, 3, 16, 200)).toBeGreaterThanOrEqual(0.75);
  });

  it("Lv.4는 Lv.2보다 낫다 (낮은 레벨 사이도 구분)", () => {
    expect(winRate(4, 2, 16, 300)).toBeGreaterThanOrEqual(0.6);
  });

  it("라운드 길이·무승부·자폭 비율이 적당하고, 판이 끝까지 끝난다", () => {
    const lengths: number[] = [];
    let timeouts = 0;
    let falls = 0;
    let selfFalls = 0;
    for (const [n, games] of [
      [2, 8],
      [4, 6],
      [6, 4],
    ] as const) {
      for (let g = 0; g < games; g++) {
        const s = play(Array.from({ length: n }, () => 5), 1000 + n * 50 + g);
        expect(s.phase).toBe("gameOver");
        for (const h of s.history) {
          lengths.push(h.ms);
          if (h.draw && h.order.length < n) timeouts++;
        }
        for (const p of s.players) {
          falls += p.stats.falls;
          selfFalls += p.stats.selfFalls;
        }
      }
    }
    lengths.sort((a, b) => a - b);
    const median = lengths[lengths.length >> 1];
    expect(median).toBeGreaterThan(9_000);
    expect(median).toBeLessThan(45_000);
    expect(timeouts / lengths.length).toBeLessThan(0.1);
    expect(selfFalls / falls).toBeLessThan(0.15);
  });

  it("같은 레벨 4명이면 어느 자리도 크게 유리하지 않다", () => {
    const wins = [0, 0, 0, 0];
    const games = 24;
    for (let g = 0; g < games; g++) {
      const s = play([5, 5, 5, 5], 5000 + g);
      s.ranks!.forEach((r, i) => {
        if (r === 1) wins[i]++;
      });
    }
    for (const w of wins) {
      expect(w / games).toBeGreaterThan(0.05);
      expect(w / games).toBeLessThan(0.5);
    }
  });
});
