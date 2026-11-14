import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { DIFFICULTIES, TICK_MS, TIME_LIMIT_MS, type Difficulty } from "./data";
import { createHost, createMatch, hostStep } from "./sim";

/**
 * 셀프플레이 밸런스 표 (봇끼리 한 판을 끝까지). 평소에는 적은 판수로 "끝난다·이길 수 있다"만 확인하고,
 * `HW_SIM=1 npx vitest run src/games/hushedWard/balance.sim.test.ts` 로 돌리면 인원×난이도×레벨 표를 찍는다
 * (`HW_OUT=파일`을 주면 파일로). 드라이브 문자가 대문자인 경로(C:\project\…)에서 돌려야 vitest가 뜬다.
 *
 * 2026-11-14 측정 (30판씩, 승률 = 한 명이라도 탈출): 보통 — 1인 Lv3 33% · Lv6 80% / 2인 Lv3 50% · Lv6 87% /
 * 4인 Lv3 83% · Lv6 100%. 악몽 — 1인 Lv3 0% · Lv9 53% / 2인 Lv3 10% · Lv9 70%. 순한 밤은 전 구간 80%↑.
 * 봇은 길을 헤매지 않아 2~4분에 끝낸다(사람은 더 오래 걸리고 더 자주 들킨다 — 사람 기준으로는 Lv3 줄에 가깝다).
 * 그 뒤 인원 보정(CROWD_HEAR)을 넣어 3~4인은 표보다 조금 어렵다.
 */

export function playOut(seed: number, seats: number, level: number, difficulty: Difficulty) {
  const match = createMatch(seed, Array.from({ length: seats }, () => ({ bot: true, level })), { difficulty });
  const rt = createHost(match, botThink);
  const max = TIME_LIMIT_MS / TICK_MS + 10;
  for (let i = 0; i < max && rt.state.phase === "play"; i++) hostStep(rt, TICK_MS);
  return rt.state;
}

const FULL = process.env.HW_SIM === "1";

describe("hushed ward self-play", () => {
  it("every match ends, and mid-level bots can win on normal", () => {
    let wins = 0;
    const n = FULL ? 40 : 6;
    for (let i = 0; i < n; i++) {
      const s = playOut(1000 + i, 2, 7, "normal");
      expect(s.phase).toBe("gameOver");
      expect(s.outcome).not.toBeNull();
      if (s.outcome?.win) wins++;
    }
    expect(wins).toBeGreaterThan(0);
  });

  it.runIf(FULL)("prints the balance table", async () => {
    const rows: string[] = [];
    for (const diff of DIFFICULTIES)
      for (const seats of [1, 2, 3, 4])
        for (const level of [3, 6, 9]) {
          const N = 30;
          let wins = 0;
          let esc = 0;
          let time = 0;
          let downs = 0;
          let placed = 0;
          const why: Record<string, number> = {};
          for (let i = 0; i < N; i++) {
            const s = playOut(7000 + i * 13 + seats, seats, level, diff);
            if (s.outcome?.win) wins++;
            esc += (s.outcome?.escaped ?? 0) / seats;
            time += s.t / 1000;
            placed += s.placed / s.need;
            downs += s.players.reduce((a, p) => a + p.stats.downs, 0) / seats;
            why[s.outcome?.why ?? "?"] = (why[s.outcome?.why ?? "?"] ?? 0) + 1;
          }
          rows.push(`${diff.padEnd(9)} ${seats}p Lv${String(level).padEnd(2)} win ${String(Math.round((wins / N) * 100)).padStart(3)}%  esc ${(esc / N).toFixed(2)}  placed ${(placed / N).toFixed(2)}  downs/p ${(downs / N).toFixed(2)}  ${Math.round(time / N)}s  ${JSON.stringify(why)}`);
        }
    if (process.env.HW_OUT) (await import("node:fs")).writeFileSync(process.env.HW_OUT, rows.join("\n"));
    else console.log("\n" + rows.join("\n"));
  }, 900_000);
});
