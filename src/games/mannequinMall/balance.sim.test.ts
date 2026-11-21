import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { DIFFICULTIES, TICK_MS, TIME_LIMIT_MS, type Difficulty } from "./data";
import { createHost, createMatch, hostStep } from "./sim";

/**
 * 셀프플레이 밸런스 표 (봇끼리 한 판을 끝까지). 평소에는 적은 판수로 "끝난다·이길 수 있다"만 확인하고,
 * `MM_SIM=1 npx vitest run src/games/mannequinMall/balance.sim.test.ts` 로 돌리면 인원×난이도×레벨 표를 찍는다
 * (`MM_OUT=파일`을 주면 파일로). 드라이브 문자가 대문자인 경로(C:\project\…)에서 돌려야 vitest가 뜬다.
 * 측정 결과는 룰북 §13에 적는다.
 */

export function playOut(seed: number, seats: number, level: number, difficulty: Difficulty) {
  const match = createMatch(seed, Array.from({ length: seats }, () => ({ bot: true, level })), { difficulty });
  const rt = createHost(match, botThink);
  const max = TIME_LIMIT_MS / TICK_MS + 10;
  for (let i = 0; i < max && rt.state.phase === "play"; i++) hostStep(rt, TICK_MS);
  return rt.state;
}

const FULL = process.env.MM_SIM === "1";

describe("mannequin mall self-play", () => {
  it("every match ends, and mid-level bots can win on normal", () => {
    let wins = 0;
    const n = FULL ? 30 : 5;
    for (let i = 0; i < n; i++) {
      const s = playOut(1000 + i, 2, 7, "normal");
      expect(s.phase).toBe("gameOver");
      expect(s.outcome).not.toBeNull();
      if (s.outcome?.win) wins++;
    }
    expect(wins).toBeGreaterThan(0);
  }, 120_000);

  it.runIf(FULL)("prints the balance table", async () => {
    const rows: string[] = [];
    const diffs = (process.env.MM_DIFF?.split(",") as Difficulty[] | undefined) ?? DIFFICULTIES;
    const N = Number(process.env.MM_N ?? 24);
    for (const diff of diffs)
      for (const seats of [1, 2, 3, 4])
        for (const level of [3, 6, 9]) {
          let wins = 0;
          let esc = 0;
          let time = 0;
          let downs = 0;
          let placed = 0;
          let stare = 0;
          const why: Record<string, number> = {};
          for (let i = 0; i < N; i++) {
            const s = playOut(7000 + i * 13 + seats, seats, level, diff);
            if (s.outcome?.win) wins++;
            esc += (s.outcome?.escaped ?? 0) / seats;
            time += s.t / 1000;
            placed += s.placed / s.need;
            downs += s.players.reduce((a, p) => a + p.stats.downs, 0) / seats;
            stare += s.players.reduce((a, p) => a + p.stats.stareSec, 0) / seats;
            why[s.outcome?.why ?? "?"] = (why[s.outcome?.why ?? "?"] ?? 0) + 1;
          }
          rows.push(
            `${diff.padEnd(9)} ${seats}p Lv${String(level).padEnd(2)} win ${String(Math.round((wins / N) * 100)).padStart(3)}%  esc ${(esc / N).toFixed(2)}  placed ${(placed / N).toFixed(2)}  downs/p ${(downs / N).toFixed(2)}  stare/p ${Math.round(stare / N)}s  ${Math.round(time / N)}s  ${JSON.stringify(why)}`,
          );
        }
    if (process.env.MM_OUT) (await import("node:fs")).writeFileSync(process.env.MM_OUT, rows.join("\n"));
    else console.log("\n" + rows.join("\n"));
  }, 1_800_000);
});
