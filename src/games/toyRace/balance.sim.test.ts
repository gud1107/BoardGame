import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { botThink } from "./bot";
import { TRACK_IDS, type TrackId } from "./data";
import { createHost, createMatch, step, type MatchState } from "./sim";
import { project, trackFor } from "./track";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수십 판을 돌려 설계 목표를 확인한다.
 *
 * 목표: ① 레벨이 높을수록 확실히 이김 ② 모든 트랙·레벨에서 레이스가 끝남(멈춤·무한 제자리로 없음)
 * ③ 마지막 바퀴 선두가 지는 막판 역전 18% 이상, 🧸 장난감 상자를 켜도 역전이 줄지 않음
 * ④ 자리 번호 편차 없음 ⑤ 레이스당 추월이 충분(밋밋하지 않게).
 *
 * 2026-11-21 측정 (Lv.5 거울전, 3바퀴, 아이템 켬):
 *   1:1 — Lv.10 vs 1 12:0 · Lv.7 vs 3 12:0 · Lv.5 vs 3 12:0 · Lv.4 vs 2 12:0 · Lv.6 vs 5 8:4
 *   4·6인 120판 — 🧸 켬: 막판 역전 24% · 선두 장난감 명중 0.75회/레이스 / 🧸 끔: 막판 역전 23% · 추월 37~39회/레이스
 *   4인 192판 우승 자리 57/45/42/48, 2바퀴 96판 22/31/15/28 (편차 없음) · 출발 칸(옆 위치 −2.1/−0.7/0.7/2.1) 45/28/67/52
 * 처음 수치(뒤처짐 보정 없음, 2대씩 두 줄 출발)에선 막판 역전이 🧸와 상관없이 11%, 앞줄 우승 71%였다 →
 * 🐢 뒤처짐 바람(6u 넘게 뒤지면 최대 +6%)과 4대 나란히 출발로 바꿨다. 출발 칸은 매 판 섞으니 사람 사이엔 공평하다.
 * 또 처음엔 꺾은 채 드리프트하면 속도가 빠져 2단에 못 갔다(드리프트 회전 1.38배·옆 미끄럼 2.3) → 1.2배·3.4.
 * 그 뒤 🧸를 켠 쪽 역전이 오히려 8%(끔 28%)로 낮았다 — 선두는 그림자를 보고 피하고 뒤따르던 2·3등이 대신 박았다 →
 * 표적(선두)이 벽을 지나가면 벽이 무너지게, 박으면 멈칫 0.7→1초. Lv.5 봇은 벽을 잘 피해 봇끼리는 켬/끔 차이가 작다
 * (사람은 덜 피하니 사람 판에서 다시 볼 것).
 */

function play(levels: number[], seed: number, track: TrackId, toyBox = true, laps: 2 | 3 = 3): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { track, laps, items: true, toyBox });
  const rt = createHost(s, botThink);
  let g = 0;
  while (s.phase !== "gameOver" && g++ < 60 * 400) step(rt);
  return s;
}

function winRate(a: number, b: number, games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const flip = g % 2 === 1;
    const s = play(flip ? [b, a] : [a, b], seed0 + g, TRACK_IDS[g % 3], true, 2);
    if (s.ranks![flip ? 1 : 0] === 1) wins++;
  }
  return wins / games;
}

describe("장난감 방 레이스 셀프플레이", () => {
  it("레벨이 높을수록 이긴다 (Lv.10>1, 7>3, 4>2)", () => {
    expect(winRate(10, 1, 6, 100)).toBeGreaterThanOrEqual(0.99);
    expect(winRate(7, 3, 6, 200)).toBeGreaterThanOrEqual(0.83);
    expect(winRate(4, 2, 6, 300)).toBeGreaterThanOrEqual(0.66);
  });

  it("모든 트랙·레벨에서 레이스가 끝나고 제자리로가 드물다", () => {
    for (const track of TRACK_IDS)
      for (const lv of [1, 5, 10]) {
        const s = play([lv, lv, lv, lv], 700 + lv, track, true, 2);
        expect(s.phase).toBe("gameOver");
        expect(s.players.every((p) => p.finishedAt > 0)).toBe(true);
        expect(s.players.reduce((a, p) => a + p.stats.resets, 0)).toBeLessThanOrEqual(4);
      }
  });

  it("막판 역전이 나오고(≥18%) 🧸 장난감 상자가 역전을 줄이지 않는다 · 추월이 충분", () => {
    const measure = (toy: boolean) => {
      let comeback = 0;
      let passes = 0;
      let games = 0;
      for (const n of [4, 6])
        for (let g = 0; g < 60; g++) {
          const s = play(Array(n).fill(5), 1234 + g * 7 + n, TRACK_IDS[g % 3], toy);
          games++;
          passes += s.passes;
          if (s.finalLeader >= 0 && s.ranks![s.finalLeader] !== 1) comeback++;
        }
      return { comeback: comeback / games, passes: passes / games };
    };
    const on = measure(true);
    const off = measure(false);
    if (process.env.TR_LOG) writeFileSync(process.env.TR_LOG, JSON.stringify({ on, off }));
    expect(on.comeback).toBeGreaterThanOrEqual(0.18);
    expect(on.comeback).toBeGreaterThanOrEqual(off.comeback - 0.12);
    expect(on.passes).toBeGreaterThanOrEqual(15);
  });

  it("같은 레벨 4명이면 어느 자리 번호도 크게 유리하지 않다", () => {
    const wins = [0, 0, 0, 0];
    const games = 96;
    for (let g = 0; g < games; g++) {
      const s = play([5, 5, 5, 5], 9000 + g, TRACK_IDS[g % 3], true, 2);
      wins[s.ranks!.indexOf(1)]++;
    }
    if (process.env.TR_LOG) writeFileSync(process.env.TR_LOG + ".seat", JSON.stringify(wins));
    for (const w of wins) {
      expect(w / games).toBeGreaterThan(0.12);
      expect(w / games).toBeLessThan(0.4);
    }
    // 출발 칸은 4대 나란히 (진행 거리가 모두 같다)
    const s = createMatch(1, [5, 5, 5, 5].map((level) => ({ bot: true, level })), { track: "living" });
    const t = trackFor("living");
    const d = s.players.map((p) => Math.round(project(t, p.x, p.z, p.seg).s * 10));
    expect(new Set(d).size).toBe(1);
  });
});
