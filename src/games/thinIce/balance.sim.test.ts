import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수백 라운드를 돌려
 * ① 레벨이 높을수록 확실히 이기는지 ② 라운드 길이가 적당한지(서든데스까지 가는 판도 조금 있게)
 * ③ 자리(시작 위치) 편차가 없는지 ④ 판이 반드시 끝나는지 본다. 수치를 바꾸면 이 테스트로 다시 확인한다.
 *
 * 2026-11-14 측정 (Lv.5 거울전, 8판×3라운드씩): 라운드 중앙값 2인 ~27초 / 4인 ~36초 / 6인 ~43초,
 * 60초 서든데스까지 가는 라운드 2~4%(4·6인), 시간 종료 무승부 0. Lv.10 vs Lv.1 12:0, Lv.7 vs Lv.3 12:0,
 * Lv.4 vs Lv.2 12:0, Lv.5 거울 6:6. 4인 Lv.5 40판 자리별 1등 = 표 참고(각 15~35%).
 */

function play(levels: number[], seed: number, rounds: 1 | 3 | 5 = 3): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { rounds });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 60 * 20) step(rt);
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

describe("살얼음 파티 셀프플레이", () => {
  it("Lv.10은 Lv.1을 거의 항상 이긴다", () => {
    expect(winRate(10, 1, 12, 100)).toBeGreaterThanOrEqual(0.9);
  });

  it("Lv.7은 Lv.3을 대부분 이긴다", () => {
    expect(winRate(7, 3, 12, 200)).toBeGreaterThanOrEqual(0.75);
  });

  it("Lv.4는 Lv.2보다 낫다 (낮은 레벨 사이도 구분)", () => {
    expect(winRate(4, 2, 12, 300)).toBeGreaterThanOrEqual(0.6);
  });

  it("라운드 길이가 적당하고, 시간 종료 무승부가 거의 없고, 판이 끝까지 끝난다", () => {
    const lengths: number[] = [];
    let timeouts = 0;
    for (const [n, games] of [
      [2, 6],
      [4, 5],
      [6, 4],
    ] as const) {
      for (let g = 0; g < games; g++) {
        const s = play(Array.from({ length: n }, () => 5), 1000 + n * 50 + g);
        expect(s.phase).toBe("gameOver");
        for (const h of s.history) {
          lengths.push(h.ms);
          if (h.draw && h.order.length < n) timeouts++;
        }
      }
    }
    lengths.sort((a, b) => a - b);
    const median = lengths[lengths.length >> 1];
    expect(median).toBeGreaterThan(18_000);
    expect(median).toBeLessThan(60_000);
    expect(timeouts / lengths.length).toBeLessThan(0.05);
  });

  it("같은 레벨 4명이면 어느 자리도 크게 유리하지 않다", () => {
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
