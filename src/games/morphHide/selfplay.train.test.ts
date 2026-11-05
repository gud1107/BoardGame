import { describe, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import { train } from "./selfplay";

/**
 * 셀프플레이 학습 실행기 — 평소 테스트에선 건너뛴다.
 *   MH_TRAIN=1 MH_OUT=out.json npx vitest run src/games/morphHide/selfplay.train.test.ts
 * 끝나면 MH_OUT에 학습된 파라미터, MH_OUT.log에 세대별 기록. 결과를 botParams.ts의 TRAINED_*에 붙여 넣는다.
 */
describe.skipIf(!process.env.MH_TRAIN)("self-play training", () => {
  it("trains", () => {
    const out = process.env.MH_OUT ?? "selfplay-out.json";
    writeFileSync(`${out}.log`, "");
    const res = train({
      gens: Number(process.env.MH_GENS ?? 8),
      pop: Number(process.env.MH_POP ?? 12),
      seedsPer: Number(process.env.MH_SEEDS ?? 8),
      seed: Number(process.env.MH_SEED ?? 1),
      onLog: (l) => appendFileSync(`${out}.log`, JSON.stringify(l) + "\n"),
    });
    writeFileSync(out, JSON.stringify({ hider: res.hider, seeker: res.seeker }, null, 2));
  }, 3_600_000);
});
