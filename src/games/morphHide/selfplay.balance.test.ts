import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { hiderParamsFor, seekerParamsFor } from "./botParams";
import { evalMany, type RoundStats } from "./selfplay";
import { AUGS } from "./augments";

/**
 * 밸런스 측정 — 평소 테스트에선 건너뛴다.
 *   MH_BALANCE=1 MH_OUT=balance.txt npx vitest run src/games/morphHide/selfplay.balance.test.ts
 * 학습된 정책(botParams.ts TRAINED_*)으로 레벨·인원·시간별 결과를 많은 시드로 잰다.
 */
const fmt = (r: RoundStats) =>
  `잡힘 ${(r.catchFrac * 100).toFixed(0).padStart(3)}% · 술래 전원검거 ${(r.seekerWin * 100).toFixed(0).padStart(3)}% · 술래 탈락 ${(r.seekerDown * 100).toFixed(0).padStart(3)}% · 헛손질 ${r.wrongHits.toFixed(1).padStart(4)} · 분신 ${r.decoys.toFixed(1)} · 움직이다 잡힘 ${r.caughtMoving.toFixed(2)}`;

describe.skipIf(!process.env.MH_BALANCE)("balance", () => {
  it("measures", () => {
    const n = Number(process.env.MH_N ?? 24);
    const seeds = Array.from({ length: n }, (_, i) => 50_000 + i);
    const lines: string[] = [];
    const row = (label: string, r: RoundStats) => lines.push(`${label.padEnd(26)} ${fmt(r)}`);
    for (const lv of [1, 5, 10]) row(`Lv${lv} 숨기 vs Lv${lv} 술래 (5인 3분)`, evalMany(seeds, hiderParamsFor(lv), seekerParamsFor(lv)));
    row("Lv10 숨기 vs Lv1 술래", evalMany(seeds, hiderParamsFor(10), seekerParamsFor(1)));
    row("Lv1 숨기 vs Lv10 술래", evalMany(seeds, hiderParamsFor(1), seekerParamsFor(10)));
    row("Lv10 vs Lv10 (5인 5분)", evalMany(seeds, hiderParamsFor(10), seekerParamsFor(10), { huntSec: 300 }));
    row("Lv10 vs Lv10 (4인 3분)", evalMany(seeds, hiderParamsFor(10), seekerParamsFor(10), {}, 4));
    row("Lv10 vs Lv10 (8인 3분)", evalMany(seeds, hiderParamsFor(10), seekerParamsFor(10), {}, 8));
    writeFileSync(process.env.MH_OUT ?? "balance.txt", lines.join("\n"));
  }, 3_600_000);
});

/**
 * 증강 하나씩 — 술래 봇이 그 증강만 들고 (Lv10 vs Lv10, 5인 3분). 맨 위 "없음"과 비교한다.
 *   MH_AUG=1 MH_OUT=aug.txt npx vitest run src/games/morphHide/selfplay.balance.test.ts
 */
describe.skipIf(!process.env.MH_AUG)("augment balance", () => {
  it("measures each augment alone", () => {
    const n = Number(process.env.MH_N ?? 24);
    const seeds = Array.from({ length: n }, (_, i) => 70_000 + i);
    const lines: string[] = [];
    const h = hiderParamsFor(10);
    const sk = seekerParamsFor(10);
    lines.push(`${"없음".padEnd(14)} ${fmt(evalMany(seeds, h, sk, {}, 5, { seeker: [], hider: [] }))}`);
    for (const a of AUGS) {
      if (a.mode === "kkom") continue;
      // MH_AUG_ONLY=ear,dossier 처럼 일부만
      if (process.env.MH_AUG_ONLY && !process.env.MH_AUG_ONLY.split(",").includes(a.id)) continue;
      lines.push(`${`${a.icon}${a.name}`.padEnd(14)} ${fmt(evalMany(seeds, h, sk, {}, 5, a.side === "hider" ? { seeker: [], hider: [a.id] } : { seeker: [a.id], hider: [] }))}`);
    }
    writeFileSync(process.env.MH_OUT ?? "aug.txt", lines.join("\n"));
  }, 3_600_000);
});
