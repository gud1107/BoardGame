import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import type { GameMode } from "./data";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수십 판을 돌려 설계 목표를 확인한다.
 *
 * 목표: ① 판이 늘 끝나고 줄에 남기고 끝난 값이 적다(욕심 실패는 있되 판을 망치지 않음) ② 꼴찌가 0점 근처로
 * 버려지지 않는다(꼴찌 점수 ÷ 평균) ③ 가로채기 독식 없음 ④ 마감 세일에 순위가 바뀔 여지 ⑤ 레벨이 높을수록 이김
 * ⑥ 자리 편차 없음.
 *
 * 2026-11-21 측정 (Lv.5 거울전, 인원별 8판 · 150초):
 *   개인전 2/4/6/8인 — 분당 가로채기 8.6/27.9/49.0/67.5 · 꼴찌÷평균 0.86/0.67/0.41/0.43 ·
 *     마감 세일 역전 13/38/50/38% · 줄에 남긴 값 3/3/7/6% · 한 사람이 가로채기 40% 넘게 독식 0판
 *   팀전 6인 — 분당 33.2 · 꼴찌÷평균 0.45 · 💣 폭탄 세일 5인 — 판당 펑 9.9 · 꼴찌÷평균 0.63
 *   Lv.10 vs Lv.1 10:2 · Lv.7 vs Lv.3 8:4 · Lv.4 vs Lv.2 9:3 (1:1, 120초 12판)
 * 처음 수치(보호 1.2초·가로채기 쿨다운 없음·몸 뒤 첫 칸도 뺏김·무게 1.2%/36%)에선 4인전 분당 가로채기가 96번,
 * 가로챈 값이 넣은 값의 4배라 물건이 끝없이 돌기만 했고 6~8인전 꼴찌는 0~2점이었다 → 🤲 가로챈 뒤 5초 쿨다운,
 * 가로챈 물건 보호 2.2초, ✊ 몸 뒤 첫 칸 안전, 🧺 바구니 안 줄 안전, 🐣 꼴찌 보호(앞 3개·바구니), 무게 1%/30%.
 */

function play(levels: number[], seed: number, mode: GameMode = "classic", seconds: 120 | 150 | 180 = 150): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { mode, seconds });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 400) step(rt);
  return s;
}

function winRate(a: number, b: number, games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const flip = g % 2 === 1;
    const s = play(flip ? [b, a] : [a, b], seed0 + g, "classic", 120);
    const me = flip ? 1 : 0;
    if (s.ranks![me] === 1 && s.ranks![1 - me] !== 1) wins++;
  }
  return wins / games;
}

describe("만지면 내 꺼! 셀프플레이", () => {
  it("높은 레벨이 이긴다", () => {
    expect(winRate(10, 1, 8, 500)).toBeGreaterThanOrEqual(0.75);
    expect(winRate(7, 3, 8, 600)).toBeGreaterThanOrEqual(0.55);
  });

  it("개인전: 판이 끝나고, 꼴찌가 버려지지 않고, 독식이 없다", () => {
    for (const n of [4, 6, 8]) {
      let bottom = 0;
      let waste = 0;
      let mono = 0;
      let flip = 0;
      const G = 6;
      for (let g = 0; g < G; g++) {
        const s = play(Array(n).fill(5), 2000 + g * 17 + n);
        expect(s.phase).toBe("gameOver");
        const sc = s.players.map((p) => p.score);
        bottom += Math.min(...sc) / (sc.reduce((a, b) => a + b, 0) / n);
        const dep = s.players.reduce((a, p) => a + p.stats.depositValue, 0);
        const w = s.players.reduce((a, p) => a + p.stats.wastedValue, 0);
        waste += w / Math.max(1, dep + w);
        const maxSn = Math.max(...s.players.map((p) => p.stats.snatches));
        if (s.snatchCount > 0 && maxSn / s.snatchCount > 0.4) mono++;
        if (s.saleLeader >= 0 && s.ranks![s.saleLeader] !== 1) flip++;
      }
      expect(bottom / G, `${n}인 꼴찌÷평균`).toBeGreaterThanOrEqual(0.25);
      expect(waste / G, `${n}인 줄에 남긴 값`).toBeLessThanOrEqual(0.15);
      expect(mono, `${n}인 독식`).toBe(0);
      expect(flip, `${n}인 마감 세일 역전`).toBeGreaterThanOrEqual(1);
    }
  });

  it("팀전·폭탄 세일도 판이 끝나고 점수가 쌓인다", () => {
    for (const mode of ["team", "bomb"] as GameMode[]) {
      for (let g = 0; g < 3; g++) {
        const s = play(Array(6).fill(5), 3000 + g, mode, 120);
        expect(s.phase).toBe("gameOver");
        expect(s.players.reduce((a, p) => a + p.stats.depositValue, 0)).toBeGreaterThan(60);
        if (mode === "bomb") expect(s.players.reduce((a, p) => a + p.stats.bombBooms, 0)).toBeGreaterThan(2);
        if (mode === "team") expect(s.players.reduce((a, p) => a + p.stats.passes, 0)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("같은 레벨 4명이면 어느 자리도 크게 유리하지 않다", () => {
    const wins = [0, 0, 0, 0];
    const games = 20;
    for (let g = 0; g < games; g++) {
      const s = play([5, 5, 5, 5], 7000 + g, "classic", 120);
      s.ranks!.forEach((r, i) => {
        if (r === 1) wins[i]++;
      });
    }
    for (const w of wins) {
      expect(w / games).toBeGreaterThan(0.04);
      expect(w / games).toBeLessThan(0.55);
    }
  });
});
