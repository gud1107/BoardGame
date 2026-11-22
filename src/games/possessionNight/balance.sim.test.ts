import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { DIFFICULTIES, TICK_MS, TIME_LIMIT_MS, type Difficulty } from "./data";
import { createHost, createMatch, hostStep } from "./sim";

/**
 * 셀프플레이 밸런스 표 (봇끼리 한 판을 끝까지). 평소에는 적은 판수로 "끝난다·양쪽 다 이길 수 있다"만 확인하고,
 * `PN_SIM=1 npx vitest run src/games/possessionNight/balance.sim.test.ts` 로 돌리면 인원×난이도×레벨 표를 찍는다
 * (`PN_OUT=파일`을 주면 파일로). 드라이브 문자가 대문자인 경로(C:\project\…)에서 돌려야 vitest가 뜬다.
 * 측정 결과는 룰북 §13에 적는다.
 */

export function playOut(seed: number, seats: number, hunterLv: number, ghostLv: number, difficulty: Difficulty) {
  const ghost = seed % seats;
  const match = createMatch(seed, Array.from({ length: seats }, (_, s) => ({ bot: true, level: s === ghost ? ghostLv : hunterLv })), ghost, { difficulty });
  const rt = createHost(match, botThink);
  const max = TIME_LIMIT_MS / TICK_MS + 10;
  for (let i = 0; i < max && rt.state.phase === "play"; i++) hostStep(rt, TICK_MS);
  return rt.state;
}

const FULL = process.env.PN_SIM === "1";

describe("possession night self-play", () => {
  it("every match ends, and both sides can win on normal", () => {
    let hunterWins = 0;
    let ghostWins = 0;
    const n = FULL ? 30 : 8;
    for (let i = 0; i < n; i++) {
      const s = playOut(1000 + i, 4, 6, 6, "normal");
      expect(s.phase).toBe("gameOver");
      expect(s.outcome).not.toBeNull();
      if (s.outcome?.winner === "hunter") hunterWins++;
      else ghostWins++;
    }
    expect(hunterWins).toBeGreaterThan(0);
    expect(ghostWins).toBeGreaterThan(0);
  }, 120_000);

  it.runIf(FULL)("prints the balance table", async () => {
    const rows: string[] = [];
    const diffs = (process.env.PN_DIFF?.split(",") as Difficulty[] | undefined) ?? DIFFICULTIES;
    const seatsList = (process.env.PN_SEATS?.split(",").map(Number) as number[] | undefined) ?? [2, 3, 4, 5, 6];
    const lvls = (process.env.PN_LV?.split(",").map((v) => v.split(":").map(Number)) as number[][] | undefined) ?? [[5, 5], [8, 8], [3, 3], [8, 3], [3, 8]];
    const N = Number(process.env.PN_N ?? 24);
    for (const diff of diffs)
      for (const seats of seatsList)
        for (const [hl, gl] of lvls) {
          let hw = 0;
          let time = 0;
          let burned = 0;
          let poss = 0;
          let hits = 0;
          let panics = 0;
          const why: Record<string, number> = {};
          for (let i = 0; i < N; i++) {
            const s = playOut(7000 + i * 13 + seats, seats, hl, gl, diff);
            if (s.outcome?.winner === "hunter") hw++;
            time += s.t / 1000;
            burned += s.burned / s.need;
            poss += s.players.reduce((a, p) => a + p.hunter.possessed, 0);
            hits += s.players.reduce((a, p) => a + p.hunter.waterHits, 0);
            panics += s.players.reduce((a, p) => a + p.hunter.panics, 0);
            why[s.outcome?.why ?? "?"] = (why[s.outcome?.why ?? "?"] ?? 0) + 1;
          }
          rows.push(
            `${diff.padEnd(6)} ${seats}p H${hl}/G${gl}  hunterWin ${String(Math.round((hw / N) * 100)).padStart(3)}%  burned ${(burned / N).toFixed(2)}  possess ${(poss / N).toFixed(1)}  waterHit ${(hits / N).toFixed(1)}  panic ${(panics / N).toFixed(1)}  ${Math.round(time / N)}s  ${JSON.stringify(why)}`,
          );
        }
    if (process.env.PN_OUT) (await import("node:fs")).writeFileSync(process.env.PN_OUT, rows.join("\n"));
    else console.log("\n" + rows.join("\n"));
  }, 3_600_000);
});
