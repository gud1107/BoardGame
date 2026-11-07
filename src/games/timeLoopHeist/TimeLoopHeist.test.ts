import { describe, expect, it } from "vitest";
import { applyAction, levelOf, startGame, type GameState } from "./engine";
import { chooseBotMoves } from "./bot";
import { LEVELS, parseLevel } from "./levels";
import { simulate } from "./sim";

function playBots(levelId: string, n: number, level: number, seed = 1): GameState {
  let s = startGame(n, seed, { levelId, recordSeconds: 120 });
  let guard = 0;
  while (s.phase !== "ended" && guard++ < 200) {
    if (s.phase === "record") {
      const seat = s.pending.findIndex((m) => m === null);
      s = applyAction(s, { type: "SUBMIT", seat, loop: s.loop, moves: chooseBotMoves(s, seat, level) });
    } else if (s.phase === "replay") {
      const seat = s.ready.findIndex((r) => !r);
      s = applyAction(s, { type: "READY", seat, loop: s.loop });
    }
  }
  return s;
}

describe("time loop heist sim", () => {
  it("parses every level with exactly one spawn and van, and gate rules for each gate", () => {
    for (const def of LEVELS) {
      const lv = parseLevel(def);
      expect(def.rows.join("").split("S").length - 1).toBe(1);
      expect(def.rows.join("").split("V").length - 1).toBe(1);
      expect(Object.keys(lv.gates).length).toBe(Object.keys(def.gates).length);
      expect(lv.loot.filter((l) => l.kind === "gem").length).toBeGreaterThanOrEqual(def.need[4]);
    }
  });

  it("a ghost blocked by a closed gate vanishes in a paradox", () => {
    const def = LEVELS[0];
    // 1루프: 발판 P 지키기 → 2루프: 문 1로 들어감. 그런데 3루프에 아무도 P를 안 지키면? (P를 지키던 유령은 그대로)
    const hold = "SSS" + ".".repeat(27);
    const walk = "EEE" + "E".repeat(5);
    const ok = simulate(def, [
      { seat: 0, loop: 1, moves: hold },
      { seat: 0, loop: 2, moves: walk },
    ]);
    expect(ok.events.some((e) => e.kind === "paradox")).toBe(false);
    const broken = simulate(def, [{ seat: 0, loop: 2, moves: walk }]);
    expect(broken.events.some((e) => e.kind === "paradox")).toBe(true);
  });

  it("a guard catches a self standing in its sight", () => {
    const def = LEVELS[2];
    // 홀에서 곧장 회랑으로 직진 — 로봇과 마주친다
    const r = simulate(def, [{ seat: 0, loop: 1, moves: "NNEEEEEEEE" }]);
    expect(r.events.some((e) => e.kind === "caught")).toBe(true);
  });

  it("simulation is deterministic", () => {
    const def = LEVELS[3];
    const tracks = [
      { seat: 0, loop: 1, moves: "NNEU" + "NNNN" },
      { seat: 1, loop: 1, moves: "EEEU" },
    ];
    expect(JSON.stringify(simulate(def, tracks))).toBe(JSON.stringify(simulate(def, tracks)));
  });
});

describe("time loop heist bots", () => {
  for (const def of LEVELS) {
    for (const n of [1, 2, 3, 4]) {
      it(`Lv10 bots clear ${def.id} with ${n}p within the loop limit`, () => {
        const s = playBots(def.id, n, 10);
        expect(s.outcome?.cleared, JSON.stringify(s.history)).toBe(true);
        expect(s.outcome!.loopsUsed).toBeLessThanOrEqual(levelOf(s).loops[n]);
        // 기준 루프 안에 깨는지도 본다(⭐ 2개가 가능한 설계인가)
        expect(s.outcome!.loopsUsed, `par ${def.par[n]}`).toBeLessThanOrEqual(def.par[n]);
      });
    }
  }
});
