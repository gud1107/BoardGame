import { describe, expect, it } from "vitest";
import { accuracy, type Difficulty, type StyleChoice } from "./data";
import { createHost, createMatch, step, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 (룰북 §13). 봇끼리 돌려 ① 판이 반드시 끝나는지 ② 레벨이 높을수록 점수가 높은지
 * ③ 장난이 판을 뒤집을 만큼 세지는 않은지(실력이 먼저) ④ 장난이 실제로 쓰이는지 본다.
 *
 * 2026-11-15 측정 (보통, 2곡):
 *   정확도(장난 끔) Lv.1 60% · Lv.3 73% · Lv.5 84% · Lv.7 94% · Lv.9 99% · Lv.10 99.8%
 *   Lv.10 vs Lv.5 20:0 · Lv.6 vs Lv.4 20:0 · Lv.6 vs Lv.5 19:1 — 장난이 있어도 한 레벨 차이가 뒤집히지 않는다
 *   4인 같은 레벨 한 판(2곡)에 장난 Lv.3 13번 · Lv.6 19번 · Lv.9 19번, 그중 절반쯤(6·9·10번)이 방패에 막힘
 *   장난을 켜면 평균 점수가 약 3% 낮아진다 (Lv.6: 45,089 → 43,649)
 * 처음 수치(퍼펙트 +4 · 방패 50)는 한 판에 27번 쏘고 18번이 막혔다 → 퍼펙트 +3 / 그레이트 +1, 방패 80으로 조정.
 * 그래도 절반이 막히는 건 봇이 게이지가 차자마자 쏘지 않고 0.6~3초 들고 있기 때문 — 사람끼리는 더 낮을 것.
 */

function play(levels: number[], seed: number, opts: { rounds?: 1 | 2 | 3; mayhem?: boolean; difficulty?: Difficulty; style?: StyleChoice } = {}): MatchState {
  const s = createMatch(seed, levels.map((level) => ({ bot: true, level })), { rounds: 2, ...opts });
  const rt = createHost(s);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 30 * 60 * 6) step(rt);
  return s;
}

function winRate(a: number, b: number, games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const flip = g % 2 === 1;
    const s = play(flip ? [b, a] : [a, b], seed0 + g);
    expect(s.phase).toBe("gameOver");
    if (s.ranks![flip ? 1 : 0] === 1) wins++;
  }
  return wins / games;
}

const accOf = (s: MatchState, seat: number) => {
  const st = s.players[seat].stats;
  return accuracy([st.perfects, st.greats, st.goods, st.misses], s.history.reduce((a, h) => a + h.notes, 0));
};

describe("박자 난장판 셀프플레이", () => {
  it("Lv.10은 Lv.5를 거의 항상 이기고, Lv.6은 Lv.4를 대부분 이긴다 (장난이 있어도 실력이 먼저)", () => {
    expect(winRate(10, 5, 10, 100)).toBeGreaterThanOrEqual(0.9);
    expect(winRate(6, 4, 10, 200)).toBeGreaterThanOrEqual(0.7);
  });

  it("정확도는 레벨 순서대로 오르고, Lv.1도 곡을 따라가긴 한다", () => {
    const s = play([1, 4, 7, 10], 300, { mayhem: false });
    const acc = [0, 1, 2, 3].map((i) => accOf(s, i));
    expect(acc[0]).toBeLessThan(acc[1]);
    expect(acc[1]).toBeLessThan(acc[2]);
    expect(acc[2]).toBeLessThan(acc[3]);
    expect(acc[0]).toBeGreaterThan(30);
    expect(acc[3]).toBeGreaterThan(92);
    expect(s.ranks).toEqual([4, 3, 2, 1]);
  });

  it("장난이 실제로 오가고 일부는 방패에 막힌다 (4인 Lv.6, 3판)", () => {
    let sent = 0;
    let blocked = 0;
    for (let g = 0; g < 3; g++) {
      const s = play([6, 6, 6, 6], 400 + g);
      for (const p of s.players) {
        sent += p.stats.pranksSent;
        blocked += p.stats.pranksBlocked;
      }
    }
    expect(sent).toBeGreaterThanOrEqual(9);
    expect(blocked).toBeGreaterThanOrEqual(1);
    expect(blocked).toBeLessThan(sent);
  });

  it("어느 스타일·난이도·인원이든 판이 끝까지 끝난다", () => {
    for (const style of ["polka", "city", "rush"] as const)
      for (const difficulty of ["easy", "hard"] as const) {
        const s = play([3, 8], 500, { rounds: 1, style, difficulty });
        expect(s.phase).toBe("gameOver");
        expect(s.history.length).toBe(1);
      }
    const eight = play([1, 2, 3, 4, 5, 6, 7, 8], 600, { rounds: 3 });
    expect(eight.phase).toBe("gameOver");
    expect(eight.history.length).toBe(3);
    expect(new Set(eight.history.map((h) => h.style)).size).toBe(3);
  });
});
