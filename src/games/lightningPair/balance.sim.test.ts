import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { seededRng } from "@/lib/rng";
import { DECK, FREEZE_MS, type Mode } from "./data";
import { answerFor, applyAction, createGame, tick, topCard, type PairState } from "./engine";
import { createBotMemory, runBots } from "./bots";

/**
 * 셀프플레이 측정 (룰북 §10 표). `PAIR_SIM_OUT=<파일>`이면 표를 파일로 남긴다 (vitest가 console.log를 삼켜서).
 * "사람" 가정: 짝 찾기 중앙값 2.0초 (로그정규 σ 0.5), 6%는 헛짚어 얼음, 핑 왕복 120ms.
 */

const T0 = 1_000_000;

function gauss(rng: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
}

function play(mode: Mode, n: number, bots: Map<number, number>, seed: number, human?: { seat: number; median: number }) {
  const rng = seededRng(seed);
  const hr = seededRng(seed * 7 + 3);
  let s: PairState = createGame({ playerCount: n, mode, seed, now: T0, rng: seededRng(seed + 1000) });
  const mem = createBotMemory();
  let now = T0;
  let plan: { seq: number; at: number; wrongAt: number | null; rt: number } | null = null;
  const LAG = 60;
  while (s.phase !== "finished" && now < T0 + 20 * 60_000) {
    now += 20;
    s = tick(s, now);
    for (const a of runBots(s, now, bots, mem, rng)) s = applyAction(s, a, now);
    if (human && s.phase === "play" && topCard(s, human.seat) !== null) {
      if (!plan || plan.seq !== s.seq) {
        const find = Math.max(500, human.median * Math.exp(gauss(hr) * 0.5));
        const wrong = hr() < 0.06;
        plan = { seq: s.seq, wrongAt: wrong ? s.centerAt + LAG + find * 0.5 : null, at: s.centerAt + LAG * 2 + find + (wrong ? FREEZE_MS : 0), rt: Math.round(find + (wrong ? FREEZE_MS : 0)) };
      }
      if (plan.wrongAt !== null && now >= plan.wrongAt) {
        plan.wrongAt = null;
        const ans = answerFor(s, human.seat);
        s = applyAction(s, { type: "claim", seat: human.seat, sym: DECK[topCard(s, human.seat)!].find((x) => x !== ans)!, seq: s.seq, rt: 0 }, now);
      } else if (now >= plan.at) {
        plan.at = Infinity;
        s = applyAction(s, { type: "claim", seat: human.seat, sym: answerFor(s, human.seat)!, seq: s.seq, rt: plan.rt }, now);
      }
    }
  }
  return { s, ms: now - T0 };
}

describe("lightning-pair balance (self-play)", () => {
  it("measures game length, level gaps and human-vs-bot", () => {
    const lines: string[] = [];
    for (const mode of ["grab", "dump"] as Mode[]) {
      for (const n of [2, 4, 6, 8]) {
        const lens: number[] = [];
        let zero = 0;
        for (let seed = 1; seed <= 30; seed++) {
          const { s, ms } = play(mode, n, new Map(Array.from({ length: n }, (_, i) => [i, 5])), seed);
          lens.push(ms / 1000);
          zero += s.stats.filter((st) => st.claims === 0).length;
        }
        const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
        lines.push(`${mode} ${n}p Lv5: ${mean.toFixed(0)}s avg (max ${Math.max(...lens).toFixed(0)}s), seats with 0 claims ${((zero / (30 * n)) * 100).toFixed(1)}%`);
        expect(mean).toBeLessThan(5 * 60);
      }
    }
    for (const mode of ["grab", "dump"] as Mode[]) {
      for (const [hi, lo] of [
        [10, 1],
        [6, 5],
      ]) {
        let w = 0;
        for (let seed = 1; seed <= 60; seed++) if (play(mode, 2, new Map([[0, hi], [1, lo]]), seed).s.ranking![0] === 0) w++;
        lines.push(`${mode} 1:1 Lv${hi} vs Lv${lo}: ${((w / 60) * 100).toFixed(0)}%`);
      }
      for (const lv of [1, 3, 5, 7, 9, 10]) {
        let w = 0;
        for (let seed = 1; seed <= 60; seed++) if (play(mode, 2, new Map([[1, lv]]), seed, { seat: 0, median: 2000 }).s.ranking![0] === 0) w++;
        lines.push(`${mode} human(2.0s) vs Lv${lv}: ${((w / 60) * 100).toFixed(0)}%`);
        if (lv === 1) expect(w / 60).toBeGreaterThan(0.75);
        if (lv === 10) expect(w / 60).toBeLessThan(0.4);
      }
    }
    // 4인 쟁탈전: 사람 1 + Lv5 봇 3 — 1등 비율
    let first = 0;
    for (let seed = 1; seed <= 60; seed++) if (play("grab", 4, new Map([[1, 5], [2, 5], [3, 5]]), seed, { seat: 0, median: 2000 }).s.ranking![0] === 0) first++;
    lines.push(`grab 4p human(2.0s) + 3×Lv5: human 1st ${((first / 60) * 100).toFixed(0)}%`);
    if (process.env.PAIR_SIM_OUT) writeFileSync(process.env.PAIR_SIM_OUT, lines.join("\n") + "\n");
  }, 180_000);
});
