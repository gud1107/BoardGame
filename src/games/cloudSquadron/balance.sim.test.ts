import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { PILOT_IDS, type PilotId } from "./data";
import { choosePilot, createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 원정을 돌려 ① 레벨이 높을수록 확실히 잘 깨는지
 * ② 조종사마다 혼자서도 깰 수 있는지(지배 조종사·쓸모없는 조종사가 없는지) ③ 판이 반드시 끝나는지 본다.
 *
 * 2026-11-22 측정 (편대 난이도):
 * - 4인 3스테이지: Lv.10 3/3 성공 · Lv.5 3/3 · Lv.1 1/3 (이어 하기 다 쓰고 실패 2판)
 * - 혼자 1스테이지 Lv.6 (10판): 바람 8 · 무쇠 10 · 반디 10 · 번개 10 · 그림자 8 · 불꽃 9
 * - 스테이지 길이 약 86~118초, 3스테이지 원정 약 5.3~5.9분
 */

function play(levels: number[], seed: number, stages: 1 | 3, pilots: PilotId[] = []): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { stages });
  const rt = createHost(s, botThink);
  pilots.forEach((id, i) => choosePilot(s, i, id));
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 60 * 25) step(rt);
  return s;
}

describe("구름 편대 셀프플레이", () => {
  it("4인 편대: Lv.10이 Lv.1보다 확실히 잘 깬다", () => {
    let hi = 0;
    let lo = 0;
    for (let g = 0; g < 3; g++) {
      if (play([10, 10, 10, 10], 1000 + g * 7 + 4, 3).result === "clear") hi++;
      if (play([1, 1, 1, 1], 1000 + g * 7 + 4, 3).result === "clear") lo++;
    }
    expect(hi).toBe(3);
    expect(lo).toBeLessThan(hi);
  }, 120000);

  it("조종사마다 혼자서도 첫 스테이지를 대부분 깬다 (Lv.6)", () => {
    for (const id of PILOT_IDS) {
      let clears = 0;
      for (let g = 0; g < 10; g++) if (play([6], 5000 + g * 13, 1, [id]).result === "clear") clears++;
      expect(clears, id).toBeGreaterThanOrEqual(7);
    }
  }, 120000);

  it("원정이 적당한 길이로 반드시 끝난다", () => {
    const s = play([5, 5], 777, 3);
    expect(s.phase).toBe("gameOver");
    expect(s.t / 60000).toBeLessThan(9);
    for (const h of s.history) expect(h.ms / 1000).toBeGreaterThan(60);
  }, 120000);
});
