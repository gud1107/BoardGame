import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import type { GameMode } from "./data";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수십 판을 돌려 설계 목표를 확인한다.
 *
 * 목표: ① 분당 왕관 이동 8~15회(팀전은 경호 때문에 6회 이상) ② 1등의 왕관 보유 비율 40% 이하(4인 이상)
 * ③ 황금 왕관(마지막 20초) 시작 때 1등이 지는 막판 역전 30% 이상(개인전) ④ 자리 편차 없음
 * ⑤ 레벨이 높을수록 확실히 이김 ⑥ 점프대 왕복 무한 도망 없음.
 *
 * 2026-11-19 측정 (Lv.5 거울전, 인원별 16판 · 120초):
 *   개인전 2/4/6/8인 — 분당 이동 7.8/11.4/10.3/11.7 · 1등 보유 54/37/30/25% · 막판 역전 31/44/50/56%
 *   팀전 4/6/8인 — 분당 이동 8.7/7.3/9.2 · 막판 역전 38/38/38%
 *   저주 2/4/6/8인 — 분당 이동 8.7/9.5/8.0/9.1 · 최다 저주 보유 54/42/35/33%
 *   Lv.10 vs Lv.1 12:0, Lv.7 vs Lv.3 12:0, Lv.5 vs Lv.3 12:0, Lv.4 vs Lv.2 11:1 (1:1, 90초)
 * 처음 수치(무거운 왕관 5초/3%/20%, 점프대 재사용 1.5초)에선 막판 역전이 25~38%였고, 저주 모드에서
 * 도망치는 봇이 점프대를 왕복하며(한 판 80번 넘게) 왕을 따돌려 → 4초/4%/24%, 재사용 4초로 바꿨다.
 */

function play(levels: number[], seed: number, mode: GameMode = "classic", seconds: 90 | 120 | 180 = 120): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { mode, seconds, items: true });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 400) step(rt);
  return s;
}

function winRate(a: number, b: number, games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const flip = g % 2 === 1;
    const s = play(flip ? [b, a] : [a, b], seed0 + g, "classic", 90);
    const me = flip ? 1 : 0;
    if (s.ranks![me] === 1 && s.ranks![1 - me] !== 1) wins++;
  }
  return wins / games;
}

describe("왕관 도둑 셀프플레이", () => {
  it("Lv.10은 Lv.1을, Lv.7은 Lv.3을 거의 항상 이긴다", () => {
    expect(winRate(10, 1, 8, 100)).toBeGreaterThanOrEqual(0.85);
    expect(winRate(7, 3, 8, 200)).toBeGreaterThanOrEqual(0.75);
  });

  it("Lv.4는 Lv.2보다 낫다 (낮은 레벨 사이도 구분)", () => {
    expect(winRate(4, 2, 8, 300)).toBeGreaterThanOrEqual(0.6);
  });

  it("개인전: 왕관이 자주 오가고, 1등이 독점하지 않고, 막판 역전이 나온다", () => {
    let transfers = 0;
    let share = 0;
    let comeback = 0;
    let games = 0;
    for (const n of [4, 6]) {
      for (let g = 0; g < 8; g++) {
        const s = play(Array(n).fill(5), 1000 + g * 7 + n);
        expect(s.phase).toBe("gameOver");
        transfers += s.transfers / 2;
        const tot = s.players.reduce((a, p) => a + p.score, 0);
        share += Math.max(...s.players.map((p) => p.score)) / tot;
        if (s.goldenLeader >= 0 && s.ranks![s.goldenLeader] !== 1) comeback++;
        games++;
      }
    }
    expect(transfers / games).toBeGreaterThanOrEqual(8);
    expect(transfers / games).toBeLessThanOrEqual(15);
    expect(share / games).toBeLessThanOrEqual(0.42);
    expect(comeback / games).toBeGreaterThanOrEqual(0.25);
  });

  it("팀전·저주도 왕관이 오가고 판이 끝난다", () => {
    for (const mode of ["team", "curse"] as GameMode[]) {
      let transfers = 0;
      for (let g = 0; g < 6; g++) {
        const s = play(Array(6).fill(5), 3000 + g, mode);
        expect(s.phase).toBe("gameOver");
        transfers += s.transfers / 2;
      }
      expect(transfers / 6).toBeGreaterThanOrEqual(5.5);
    }
  });

  it("점프대 왕복으로 끝없이 도망치지 않는다 (한 사람당 2분에 12번 이하)", () => {
    for (let g = 0; g < 4; g++) {
      const s = play(Array(8).fill(8), 4000 + g, "curse");
      for (const p of s.players) expect(p.stats.padJumps).toBeLessThanOrEqual(24);
      const avg = s.players.reduce((a, p) => a + p.stats.padJumps, 0) / s.players.length;
      expect(avg).toBeLessThanOrEqual(12);
    }
  });

  it("같은 레벨 4명이면 어느 자리도 크게 유리하지 않다", () => {
    const wins = [0, 0, 0, 0];
    const games = 24;
    for (let g = 0; g < games; g++) {
      const s = play([5, 5, 5, 5], 5000 + g, "classic", 90);
      s.ranks!.forEach((r, i) => {
        if (r === 1) wins[i]++;
      });
    }
    for (const w of wins) {
      expect(w / games).toBeGreaterThan(0.06);
      expect(w / games).toBeLessThan(0.5);
    }
  });
});
