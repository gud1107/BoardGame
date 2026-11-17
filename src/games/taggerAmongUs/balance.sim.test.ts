import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { TICK_MS, timeLimitMs, type GameOptions } from "./data";
import { createHost, createMatch, hostStep } from "./sim";

/**
 * 셀프플레이 밸런스 표 (봇끼리 한 판을 끝까지). 평소에는 적은 판수로 "끝난다·양쪽 다 이길 수 있다"만 확인하고,
 * `TAG_SIM=1 TAG_OUT=파일 npx vitest run src/games/taggerAmongUs/balance.sim.test.ts` 로 인원×레벨 표를 파일에 찍는다
 * (vitest가 console.log를 삼키므로 파일로). 드라이브 문자가 대문자인 경로(C:\project\…)에서 돌려야 한다.
 * 측정값은 룰북 §12에 적는다.
 */

export function playOut(seed: number, seats: number, runnerLevel: number, taggerLevel: number, options?: Partial<GameOptions>) {
  const tagger = seed % seats;
  const match = createMatch(
    seed,
    Array.from({ length: seats }, (_, i) => ({ bot: true, level: i === tagger ? taggerLevel : runnerLevel })),
    options,
    tagger,
  );
  const rt = createHost(match, botThink);
  const max = timeLimitMs(match.options) / TICK_MS + 10;
  for (let i = 0; i < max && rt.state.phase === "play"; i++) hostStep(rt, TICK_MS);
  return rt.state;
}

const FULL = process.env.TAG_SIM === "1";

describe("tagger among us self-play", () => {
  it("every match ends, and both sides can win", () => {
    const wins: Record<string, number> = { tagger: 0, runners: 0, draw: 0 };
    const n = FULL ? 60 : 16;
    for (let i = 0; i < n; i++) {
      const s = playOut(3000 + i * 7, 3 + (i % 3), 6, 6);
      expect(s.phase).toBe("gameOver");
      expect(s.outcome).not.toBeNull();
      wins[s.outcome?.winner ?? "draw"]++;
    }
    expect(wins.tagger).toBeGreaterThan(0);
    expect(wins.runners).toBeGreaterThan(0);
  });

  it.runIf(FULL)("prints the balance table", async () => {
    const rows: string[] = [];
    for (const seats of [3, 4, 5])
      for (const [rl, tl] of [[3, 3], [6, 6], [9, 9], [3, 9], [9, 3]]) {
        const N = 40;
        const w: Record<string, number> = { tagger: 0, runners: 0, draw: 0 };
        const why: Record<string, number> = {};
        let esc = 0;
        let time = 0;
        let sealed = 0;
        let catches = 0;
        let masks = 0;
        let stunned = 0;
        for (let i = 0; i < N; i++) {
          const s = playOut(9000 + i * 13 + seats, seats, rl, tl);
          w[s.outcome?.winner ?? "draw"]++;
          why[s.outcome?.why ?? "?"] = (why[s.outcome?.why ?? "?"] ?? 0) + 1;
          esc += (s.outcome?.escaped ?? 0) / (seats - 1);
          time += s.t / 1000;
          sealed += s.sealed / s.need;
          const t = s.players[s.tg.seat];
          catches += t.stats.catches;
          masks += t.stats.masks;
          stunned += t.stats.stunned;
        }
        const pct = (v: number) => String(Math.round((v / N) * 100)).padStart(3);
        rows.push(
          `${seats}p R Lv${rl} vs T Lv${tl}  runners ${pct(w.runners)}%  draw ${pct(w.draw)}%  tagger ${pct(w.tagger)}%  esc ${(esc / N).toFixed(2)}  sealed ${(sealed / N).toFixed(2)}  catches ${(catches / N).toFixed(1)}  masks ${(masks / N).toFixed(1)}  stunned ${(stunned / N).toFixed(1)}  ${Math.round(time / N)}s  ${JSON.stringify(why)}`,
        );
      }
    if (process.env.TAG_OUT) (await import("node:fs")).writeFileSync(process.env.TAG_OUT, rows.join("\n"));
    else console.log("\n" + rows.join("\n"));
  }, 900_000);
});
