import { describe, expect, it } from "vitest";
import {
  applyAction,
  canMerge,
  chooseBotAction,
  computeRankings,
  fieldLoad,
  LOAD_LIMIT,
  MAX_GRADE,
  pathPoint,
  PATH_LEN,
  PREP_TICKS,
  sanitizeAction,
  startGame,
  stepGame,
  summonCost,
  type MergeDefenseState,
} from "./engine";

function runBots(n: number, seed: number, maxTicks = 20 * 60 * 25): MergeDefenseState {
  let s = startGame(n, seed, []);
  while (s.phase === "playing" && s.tick < maxTicks) {
    for (let seat = 0; seat < n; seat++) {
      if ((s.tick + seat * 3) % 10 !== 0) continue;
      const a = chooseBotAction(s, seat);
      if (a) s = applyAction(s, seat, a);
    }
    s = stepGame(s);
  }
  return s;
}

describe("merge defense engine", () => {
  it("summons a grade 1~2 unit into an empty slot and charges gold", () => {
    const s0 = startGame(2, 42);
    const s1 = applyAction(s0, 0, { type: "summon" });
    const units = s1.boards[0].units.filter(Boolean);
    expect(units).toHaveLength(1);
    expect(units[0]!.grade).toBeLessThanOrEqual(2);
    expect(s1.boards[0].gold).toBe(s0.boards[0].gold - summonCost(s0.boards[0]));
    expect(s0.boards[0].units.filter(Boolean)).toHaveLength(0); // pure
  });

  it("merges only identical kind+grade pairs into one unit a grade higher", () => {
    let s = startGame(2, 7);
    s = { ...s, boards: s.boards.map((b, i) => (i === 0 ? { ...b, units: b.units.map((_, j) => (j < 3 ? { kind: "archer" as const, grade: 1, cd: 0 } : null)) } : b)) };
    s.boards[0].units[2] = { kind: "mage", grade: 1, cd: 0 };
    expect(canMerge(s.boards[0], 0, 2)).toBe(false);
    const merged = applyAction(s, 0, { type: "merge", a: 0, b: 1 });
    expect(merged.boards[0].units[0]).toBeNull();
    expect(merged.boards[0].units[1]!.grade).toBe(2);
    expect(applyAction(s, 0, { type: "merge", a: 0, b: 2 })).toBe(s);
  });

  it("refuses to merge max-grade units", () => {
    const s = startGame(2, 1);
    s.boards[0].units[0] = { kind: "poison", grade: MAX_GRADE, cd: 0 };
    s.boards[0].units[1] = { kind: "poison", grade: MAX_GRADE, cd: 0 };
    expect(applyAction(s, 0, { type: "merge", a: 0, b: 1 })).toBe(s);
  });

  it("sanitizes untrusted network actions", () => {
    expect(sanitizeAction({ type: "merge", a: 1, b: 1 })).toBeNull();
    expect(sanitizeAction({ type: "merge", a: -1, b: 2 })).toBeNull();
    expect(sanitizeAction({ type: "upgrade", kind: "laser" })).toBeNull();
    expect(sanitizeAction({ type: "summon", extra: 1 })).toEqual({ type: "summon" });
    expect(sanitizeAction(null)).toBeNull();
  });

  it("walks the road as a closed loop", () => {
    expect(pathPoint(0)).toEqual(pathPoint(PATH_LEN));
  });

  it("is deterministic for the same seed and inputs", () => {
    const a = runBots(2, 99, 20 * 60 * 3);
    const b = runBots(2, 99, 20 * 60 * 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("an idle player is overrun by the early waves", () => {
    let s = startGame(2, 5);
    while (s.phase === "playing" && s.tick < 20 * 60 * 5) {
      if (s.tick % 10 === 0) {
        const a = chooseBotAction(s, 1);
        if (a) s = applyAction(s, 1, a);
      }
      s = stepGame(s);
    }
    expect(s.phase).toBe("gameOver");
    expect(s.boards[0].alive).toBe(false);
    expect(s.boards[0].outWave).toBeLessThan(10);
    expect(computeRankings(s)[0].seat).toBe(1);
  });

  it("bot-vs-bot games end with one winner in a reasonable time", () => {
    for (const [n, seed] of [
      [2, 11],
      [3, 12],
      [4, 13],
    ] as const) {
      const s = runBots(n, seed);
      expect(s.phase).toBe("gameOver");
      const minutes = (s.tick - PREP_TICKS) / 20 / 60;
      expect(minutes).toBeGreaterThan(4);
      expect(minutes).toBeLessThan(16);
      const ranks = computeRankings(s);
      expect(ranks).toHaveLength(n);
      expect(ranks.filter((r) => r.rank === 1).length).toBeGreaterThanOrEqual(1);
      for (const b of s.boards) if (!b.alive) expect(b.outAt).not.toBeNull();
      for (const b of s.boards) if (b.alive) expect(fieldLoad(b)).toBeLessThan(LOAD_LIMIT);
    }
  });
});
