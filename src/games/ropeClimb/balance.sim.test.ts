import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { COURSES, type CourseId } from "./data";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 수십 판을 돌려 ① 판이 반드시 끝나는지 ② 레벨이 높을수록
 * 잘 오르는지 ③ 산 난이도 순서(뒷산 < 빙벽 < 화산)가 맞는지 ④ 걸리는 시간이 적당한지 본다.
 * 수치를 바꾸면 이 테스트로 다시 확인한다.
 *
 * 2026-11-15 측정 (씨앗 6개씩, ⛑ 3):
 *   뒷산  Lv.1 완등 3~4/6 · Lv.5 6/6 (평균 56~75초) · Lv.10 5~6/6 (39~131초)
 *   빙벽  Lv.1 1~2/6 · Lv.5 5~6/6 (66~147초) · Lv.10 6/6 (104~167초)
 *   화산  Lv.1 0/6 · Lv.5 2~4/6 · Lv.10 2~4/6 (140~270초) — 낙석 8초 주기·제한 9분으로 완화하기 전 수치
 * 처음엔 체력이 6초 만에 바닥나 연쇄로 미끄러졌다(오르기 초당 9 → 6, 속도 2.1 → 1.6, 장애물 위 쉼터 추가),
 * 봇 길이 좌우로 갈려 줄에 막혀 서는 교착(가까워지는 칸 차선·옆걸음)도 이때 고쳤다.
 */

function play(levels: number[], seed: number, course: CourseId): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { course, lives: 3 });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 60 * 10) step(rt);
  return s;
}

function clears(n: number, lv: number, course: CourseId, games: number, seed0: number): { clear: number; ms: number[]; alt: number } {
  let clear = 0;
  let alt = 0;
  const ms: number[] = [];
  for (let g = 0; g < games; g++) {
    const s = play(Array(n).fill(lv), seed0 + g * 7, course);
    expect(s.phase).toBe("gameOver");
    if (s.cleared) {
      clear++;
      ms.push(s.endMs);
    }
    alt += s.alt / COURSES[course].height;
  }
  return { clear, ms, alt: alt / games };
}

describe("한 줄 등반대 셀프플레이", () => {
  it("Lv.8 봇 3명은 뒷산을 대부분 완등하고, 1~3분 안에 끝낸다", () => {
    const r = clears(3, 8, "hill", 8, 100);
    expect(r.clear).toBeGreaterThanOrEqual(6);
    const avg = r.ms.reduce((a, b) => a + b, 0) / r.ms.length;
    expect(avg).toBeGreaterThan(25_000);
    expect(avg).toBeLessThan(180_000);
  });

  it("Lv.10은 Lv.1보다 확실히 높이 오른다 (빙벽)", () => {
    const hi = clears(3, 10, "ice", 6, 200);
    const lo = clears(3, 1, "ice", 6, 200);
    expect(hi.clear).toBeGreaterThan(lo.clear);
    expect(hi.alt).toBeGreaterThan(lo.alt);
    expect(hi.clear).toBeGreaterThanOrEqual(4);
  });

  it("산 난이도 순서: 뒷산이 화산보다 훨씬 빨리 끝난다 (Lv.6 4명)", () => {
    const avg = (ms: number[]) => ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length);
    const hill = clears(4, 6, "hill", 5, 300);
    const volcano = clears(4, 6, "volcano", 5, 300);
    expect(hill.clear).toBeGreaterThanOrEqual(4);
    expect(volcano.clear).toBeGreaterThanOrEqual(1);
    expect(avg(hill.ms) * 1.5).toBeLessThan(avg(volcano.ms));
  });

  it("2·3·4명 어느 인원이든 판이 끝까지 끝나고, 화산도 Lv.10이면 절반 넘게 올라간다", () => {
    for (const n of [2, 3, 4]) {
      const r = clears(n, 10, "volcano", 3, 400 + n);
      expect(r.alt).toBeGreaterThan(0.5);
    }
  });
});
