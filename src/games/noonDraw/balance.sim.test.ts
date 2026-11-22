import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { seededRng } from "@/lib/rng";
import type { Mode } from "./data";
import { applyAction, createGame, tick, type HostSecret, type NoonAction, type NoonState } from "./engine";
import { createBotMemory, runBots } from "./bots";

/**
 * 셀프플레이 측정 (룰북 §12 표). `NOON_SIM_OUT=<파일>`이면 표를 파일로 남긴다 (vitest가 console.log를 삼켜서).
 * 단정은 느슨하게 — 판 길이·레벨 차이가 망가지지 않았는지만 본다.
 */

const T0 = 1_000_000;

function play(mode: Mode, n: number, bots: Map<number, number>, seed: number, human?: { seat: number; rt: number; jitter: number; fool: number }) {
  const rng = seededRng(seed);
  const hr = seededRng(seed * 7 + 1);
  let s: NoonState = createGame({ playerCount: n, mode, seed, now: T0, rng });
  const mem = createBotMemory();
  let secret: HostSecret | null = null;
  let now = T0;
  let humanPlan: { bout: number; at: number; early: boolean; rt?: number } | null = null;
  let seenFeints = 0;
  while (s.phase !== "finished" && now < T0 + 20 * 60_000) {
    now += 50;
    const r = tick(s, secret, now, rng);
    s = r.state;
    secret = r.secret;
    for (const a of runBots(s, now, bots, mem, rng)) s = applyAction(s, a, now);
    if (human && s.bout && s.bout.participants.includes(human.seat) && !s.bout.draws[human.seat]) {
      const b = s.bout;
      if (!humanPlan || humanPlan.bout !== b.id) {
        humanPlan = { bout: b.id, at: Infinity, early: false };
        seenFeints = 0;
      }
      for (; seenFeints < b.feints.length; seenFeints++) if (hr() < human.fool && !humanPlan.early) humanPlan = { bout: b.id, at: b.feints[seenFeints].at + 250, early: true };
      if (b.signalAt !== null && !humanPlan.early && humanPlan.at === Infinity) {
        const rt = Math.round(human.rt + (hr() - 0.5) * 2 * human.jitter);
        humanPlan = { bout: b.id, at: b.signalAt + rt, early: false, rt };
      }
      if (now >= humanPlan.at) {
        const a: NoonAction = humanPlan.early ? { type: "draw", seat: human.seat, early: true } : { type: "draw", seat: human.seat, rt: humanPlan.rt };
        s = applyAction(s, a, now);
      }
    }
  }
  return { s, ms: now - T0 };
}

describe("noon-draw balance (self-play)", () => {
  it("measures game length, level gaps and human-vs-bot", () => {
    const lines: string[] = [];
    for (const mode of ["tournament", "brawl"] as Mode[]) {
      for (const n of [2, 4, 6, 8]) {
        const lens: number[] = [];
        let bouts = 0;
        let early = 0;
        let draws = 0;
        for (let seed = 1; seed <= 30; seed++) {
          const bots = new Map(Array.from({ length: n }, (_, i) => [i, 5]));
          const { s, ms } = play(mode, n, bots, seed);
          lens.push(ms / 1000);
          bouts += s.boutSeq;
          for (const st of s.stats) {
            early += st.early;
            draws += st.bouts;
          }
        }
        const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
        lines.push(`${mode} ${n}p Lv5: ${mean.toFixed(0)}s avg (max ${Math.max(...lens).toFixed(0)}s), ${(bouts / 30).toFixed(1)} bouts, false start ${((early / draws) * 100).toFixed(1)}%`);
        expect(mean).toBeLessThan(6 * 60);
      }
    }
    for (const [hi, lo] of [
      [10, 1],
      [8, 5],
      [6, 5],
    ]) {
      let w = 0;
      for (let seed = 1; seed <= 80; seed++) if (play("tournament", 2, new Map([[0, hi], [1, lo]]), seed).s.ranking![0] === 0) w++;
      lines.push(`1:1 Lv${hi} vs Lv${lo}: ${((w / 80) * 100).toFixed(0)}%`);
    }
    // "사람" 가정: 평균 260ms ±60, 가짜 신호에 10% 속음 — 레벨별 승률
    for (const lv of [3, 5, 7, 9, 10]) {
      let w = 0;
      for (let seed = 1; seed <= 80; seed++) if (play("tournament", 2, new Map([[1, lv]]), seed, { seat: 0, rt: 260, jitter: 60, fool: 0.1 }).s.ranking![0] === 0) w++;
      lines.push(`human(260±60ms, 10% fooled) vs Lv${lv}: ${((w / 80) * 100).toFixed(0)}%`);
      if (lv === 3) expect(w / 80).toBeGreaterThan(0.6);
      if (lv === 10) expect(w / 80).toBeLessThan(0.5);
    }
    if (process.env.NOON_SIM_OUT) writeFileSync(process.env.NOON_SIM_OUT, lines.join("\n") + "\n");
  }, 120_000);
});
