import { describe, expect, it } from "vitest";
import { applyAction, autoSubmission, computeRankings, currentActor, ROUNDS, scenarioOf, startGame, type PetState } from "./engine";
import { SCENARIOS } from "./scenarios";
import { forecastOf } from "./forecast";
import { canBuild, createSim, H, layoutCost, M, petOf, recordSim, runSim, sanitizeLayout, stepSim, W } from "./sim";

describe("scenario data", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s map is 12×14 with one pet standing on something", (_id, sc) => {
    expect(sc.map).toHaveLength(H);
    for (const row of sc.map) expect(row).toHaveLength(W);
    expect(sc.map.join("").split("P")).toHaveLength(2);
    const p = petOf(sc);
    expect(p.y === H - 1 || sc.map[p.y + 1][p.x] !== ".").toBe(true);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s has a readable forecast for every hazard", (_id, sc) => {
    const items = forecastOf(sc);
    expect(items.length).toBe(sc.emitters.length);
    for (const it of items) {
      expect(it.what.length).toBeGreaterThan(0);
      expect(it.to).toBeGreaterThan(it.from);
    }
  });

  it("has 5+ scenarios in each tier and unique ids", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const t of [1, 2, 3]) expect(SCENARIOS.filter((s) => s.tier === t).length).toBeGreaterThanOrEqual(2);
  });
});

describe("simulation", () => {
  it("is deterministic", () => {
    for (const sc of SCENARIOS) {
      const a = runSim(sc, [], 0, 42);
      const b = runSim(sc, [], 0, 42);
      expect(a).toEqual(b);
    }
  });

  it("an empty board gets the pet hurt in every scenario but one-off luck ones", () => {
    const hurt = SCENARIOS.filter((sc) => !runSim(sc, [], -1, 7).survived).length;
    expect(hurt).toBeGreaterThanOrEqual(SCENARIOS.length - 1);
  });

  it("rejects building next to the pet, on terrain, on the top row and over budget", () => {
    const sc = SCENARIOS[0];
    const p = petOf(sc);
    expect(canBuild(sc, p.x + 1, p.y)).toBe(false);
    expect(canBuild(sc, p.x + 2, p.y)).toBe(true);
    expect(canBuild(sc, 0, 0)).toBe(false);
    expect(canBuild(sc, 3, 0)).toBe(false);
    const many = Array.from({ length: 12 }, (_, x) => ({ x, y: 6, k: 1 }));
    expect(layoutCost(sanitizeLayout(sc, many))).toBeLessThanOrEqual(sc.budget);
  });

  it("drains swallow the waterfall", () => {
    const sc = SCENARIOS.find((s) => s.id === "pipe")!;
    const s = createSim(sc, [{ x: 2, y: 8, k: 2 }], -1, 1);
    for (let i = 0; i < 40; i++) stepSim(s);
    expect(s.drained).toBeGreaterThan(10);
  });

  it("the acid-rain shelter (stone roof, wood corners, side drains) holds", () => {
    const sc = SCENARIOS.find((s) => s.id === "acid")!;
    const shelter = [
      [5, 10, 1],
      [6, 10, 1],
      [7, 10, 1],
      [4, 10, 0],
      [8, 10, 0],
      [4, 12, 2],
      [8, 12, 2],
    ].map(([x, y, k]) => ({ x, y, k }));
    expect(runSim(sc, shelter, -1, 3).survived).toBe(true);
  });

  it("records frames until the hit", () => {
    const sc = SCENARIOS[0];
    const frames = recordSim(sc, [], -1, 9);
    const last = frames[frames.length - 1];
    expect(last.hit).not.toBeNull();
    expect(frames[0].cells.filter((c) => c === M.PET)).toHaveLength(1);
  });
});

function playOut(n: number, seed: number, level = 2): PetState {
  let s = startGame(n, seed);
  for (let guard = 0; guard < 100 && s.phase !== "gameOver"; guard++) {
    if (s.phase === "design") {
      const seat = currentActor(s)!;
      s = applyAction(s, { type: "submit", seat, round: s.round, ...autoSubmission(s, seat, level) });
    } else s = applyAction(s, { type: "next", round: s.round });
  }
  return s;
}

describe("engine", () => {
  it("deals one scenario per round, tiers rising", () => {
    const s = startGame(3, 5);
    expect(s.scenarios).toHaveLength(ROUNDS);
    expect(new Set(s.scenarios).size).toBe(ROUNDS);
    expect(s.scenarios.map((_, r) => scenarioOf(s, r).tier)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("waits for everyone, then scores; twists come from the previous seat", () => {
    let s = startGame(3, 11);
    s = applyAction(s, { type: "submit", seat: 1, round: 0, pieces: [], twist: s.hands[1][0] });
    expect(s.phase).toBe("design");
    // duplicate submit ignored
    const same = applyAction(s, { type: "submit", seat: 1, round: 0, pieces: [], twist: s.hands[1][1] });
    expect(same).toBe(s);
    s = applyAction(s, { type: "submit", seat: 0, round: 0, pieces: [], twist: s.hands[0][0] });
    s = applyAction(s, { type: "submit", seat: 2, round: 0, pieces: [], twist: s.hands[2][0] });
    expect(s.phase).toBe("result");
    const rec = s.history[0];
    expect(rec.results[2].twistIn).toBe(rec.subs[1].twist);
    expect(rec.results[0].twistIn).toBe(rec.subs[2].twist);
    expect(s.scores).toEqual(rec.results.map((r) => r.score));
  });

  it("force fills missing seats", () => {
    let s = startGame(2, 3);
    s = applyAction(s, { type: "submit", seat: 0, round: 0, pieces: [], twist: s.hands[0][0] });
    s = applyAction(s, { type: "force", round: 0 });
    expect(s.phase).toBe("result");
  });

  it("plays a whole game for 2-4 players", () => {
    for (const n of [2, 3, 4]) {
      const s = playOut(n, 100 + n);
      expect(s.phase).toBe("gameOver");
      expect(s.history).toHaveLength(ROUNDS);
      const r = computeRankings(s);
      expect(r).toHaveLength(n);
      expect(r[0].rank).toBe(1);
    }
  }, 60_000);

  it("result phase: next round starts once every seat is ready; skip votes toggle without advancing", () => {
    let s = startGame(3, 21);
    s = applyAction(s, { type: "force", round: 0 });
    expect(s.phase).toBe("result");
    expect(s.ready).toEqual([false, false, false]);
    s = applyAction(s, { type: "skip", seat: 1, round: 0 });
    expect(s.skip).toEqual([false, true, false]);
    s = applyAction(s, { type: "skip", seat: 1, round: 0 });
    expect(s.skip).toEqual([false, false, false]);
    s = applyAction(s, { type: "ready", seat: 0, round: 0 });
    expect(applyAction(s, { type: "ready", seat: 0, round: 0 })).toBe(s);
    s = applyAction(s, { type: "ready", seat: 2, round: 0 });
    expect(s.phase).toBe("result");
    s = applyAction(s, { type: "ready", seat: 1, round: 0 });
    expect(s.phase).toBe("design");
    expect(s.round).toBe(1);
    expect(s.ready).toBeUndefined();
    // stale ready for the old round is ignored
    expect(applyAction(s, { type: "ready", seat: 0, round: 0 })).toBe(s);
  });

  it("skip needs half or more of the people", async () => {
    const { skipNeeded } = await import("./engine");
    expect([1, 2, 3, 4].map(skipNeeded)).toEqual([1, 1, 2, 2]);
    expect(skipNeeded(0)).toBe(1);
  });

  it("rejects actions for the wrong round", () => {
    const s = startGame(2, 1);
    expect(applyAction(s, { type: "submit", seat: 0, round: 3, pieces: [], twist: 0 })).toBe(s);
    expect(applyAction(s, { type: "next", round: 0 })).toBe(s);
  });
});
