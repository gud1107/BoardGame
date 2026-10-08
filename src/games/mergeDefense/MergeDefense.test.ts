import { describe, expect, it } from "vitest";
import {
  applyAction,
  canMerge,
  chooseBotAction,
  computeRankings,
  fieldLoad,
  hireCost,
  invaderWeight,
  SWARM_SIZE,
  SEND_COOLDOWN_TICKS,
  slotCenter,
  unitRange,
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

function runBots(n: number, seed: number, maxTicks = 20 * 60 * 25, mode: "survival" | "versus" = "survival"): MergeDefenseState {
  let s = startGame(n, seed, [], mode);
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

  it("builds on the chosen empty cell and refuses an occupied one", () => {
    const s0 = startGame(2, 3);
    const s1 = applyAction(s0, 0, { type: "summon", slot: 7 });
    expect(s1.boards[0].units[7]).not.toBeNull();
    expect(s1.boards[0].units.filter(Boolean)).toHaveLength(1);
    expect(applyAction(s1, 0, { type: "summon", slot: 7 })).toBe(s1);
  });

  it("moves a unit to an empty cell and swaps with an occupied one", () => {
    const s = startGame(2, 3);
    s.boards[0].units[0] = { kind: "archer", grade: 1, cd: 0 };
    s.boards[0].units[1] = { kind: "mage", grade: 2, cd: 0 };
    const moved = applyAction(s, 0, { type: "move", a: 0, b: 5 });
    expect(moved.boards[0].units[0]).toBeNull();
    expect(moved.boards[0].units[5]!.kind).toBe("archer");
    const swapped = applyAction(s, 0, { type: "move", a: 0, b: 1 });
    expect(swapped.boards[0].units[0]!.kind).toBe("mage");
    expect(swapped.boards[0].units[1]!.kind).toBe("archer");
  });

  it("units only shoot monsters inside their range", () => {
    let s = startGame(2, 9);
    // Centre cell (row 1, col 2) — the top road at the spawn corner is out of reach.
    s.boards[0].units[7] = { kind: "archer", grade: 1, cd: 0 };
    const c = slotCenter(7);
    expect(Math.hypot(c.x - 20, c.y - 20)).toBeGreaterThan(unitRange(s.boards[0].units[7]!));
    while (s.tick < 120 + 3) s = stepGame(s); // wave 1 starts at tick 120
    expect(s.boards[0].mobs.length).toBeGreaterThan(0);
    expect(s.boards[0].shots).toHaveLength(0);
    expect(s.boards[0].mobs.every((m) => m.hp === m.maxHp)).toBe(true);
  });

  it("유닛 대결: sending a unit removes it and drops an invader on the target's road", () => {
    let s = startGame(2, 21, [], "versus");
    while (s.wave < 1) s = stepGame(s);
    s.boards[0].units[3] = { kind: "thunder", grade: 3, cd: 0 };
    const before = s.boards[1].mobs.length;
    const sent = applyAction(s, 0, { type: "send", slot: 3 });
    expect(sent.boards[0].units[3]).toBeNull();
    expect(sent.boards[0].sendCd).toBe(SEND_COOLDOWN_TICKS);
    const inv = sent.boards[1].mobs.find((m) => m.kind === "invader")!;
    expect(sent.boards[1].mobs.length).toBe(before + 1);
    expect(inv.unitKind).toBe("thunder");
    expect(inv.weight).toBe(invaderWeight(3));
    // Cooldown blocks a second send; survival mode never allows it.
    sent.boards[0].units[4] = { kind: "mage", grade: 1, cd: 0 };
    expect(applyAction(sent, 0, { type: "send", slot: 4 })).toBe(sent);
    const surv = startGame(2, 21);
    surv.boards[0].units[3] = { kind: "thunder", grade: 3, cd: 0 };
    expect(applyAction({ ...surv, wave: 2 }, 0, { type: "send", slot: 3 }).boards[0].units[3]).not.toBeNull();
  });

  it("유닛 대결: buying monsters charges gold, drops them on the target and shares the send cooldown", () => {
    let s = startGame(2, 22, [], "versus");
    while (s.wave < 1) s = stepGame(s);
    s.boards[0].gold = 1000;
    const before = s.boards[1].mobs.length;
    const swarm = applyAction(s, 0, { type: "hire", mob: "swarm" });
    expect(swarm.boards[0].gold).toBe(1000 - hireCost("swarm", s.wave));
    expect(swarm.boards[0].sendCd).toBe(SEND_COOLDOWN_TICKS);
    expect(swarm.boards[1].mobs.length).toBe(before + SWARM_SIZE);
    expect(swarm.boards[1].mobs.slice(-SWARM_SIZE).every((m) => m.from === 0)).toBe(true);
    // Cooldown blocks the next buy; locked tiers wait for their wave; survival never allows it.
    expect(applyAction(swarm, 0, { type: "hire", mob: "swarm" })).toBe(swarm);
    expect(applyAction(s, 0, { type: "hire", mob: "warlord" })).toBe(s);
    const later = { ...s, wave: 5 };
    const lord = applyAction(later, 0, { type: "hire", mob: "warlord" });
    expect(lord.boards[1].mobs.some((m) => m.kind === "warlord")).toBe(true);
    const surv = startGame(2, 22);
    surv.boards[0].gold = 1000;
    expect(applyAction({ ...surv, wave: 3 }, 0, { type: "hire", mob: "swarm" }).boards[0].gold).toBe(1000);
    // Not enough gold → nothing happens.
    const poor = applyAction({ ...s, boards: s.boards.map((b, i) => (i === 0 ? { ...b, gold: 10 } : b)) }, 0, { type: "hire", mob: "swarm" });
    expect(poor.boards[1].mobs.length).toBe(before);
  });

  it("frost never slows a wraith", () => {
    let s = startGame(2, 23, [], "versus");
    while (s.wave < 2) s = stepGame(s);
    s.boards[0].gold = 1000;
    s.boards[1].mobs = [];
    s.boards[1].units[5] = { kind: "frost", grade: 3, cd: 0 };
    s = applyAction(s, 0, { type: "hire", mob: "wraith" });
    let frostHits = 0;
    for (let i = 0; i < 120; i++) {
      s = stepGame(s);
      s.boards[1].mobs = s.boards[1].mobs.filter((m) => m.kind === "wraith");
      const w = s.boards[1].mobs[0];
      if (!w) break;
      frostHits += s.boards[1].shots.filter((sh) => sh.kind === "frost").length;
      expect(w.slowT).toBe(0);
    }
    expect(frostHits).toBeGreaterThan(0);
  });

  it("refuses to merge max-grade units", () => {
    const s = startGame(2, 1);
    s.boards[0].units[0] = { kind: "poison", grade: MAX_GRADE, cd: 0 };
    s.boards[0].units[1] = { kind: "poison", grade: MAX_GRADE, cd: 0 };
    expect(applyAction(s, 0, { type: "merge", a: 0, b: 1 })).toBe(s);
  });

  it("sanitizes untrusted network actions", () => {
    expect(sanitizeAction({ type: "merge", a: 1, b: 1 })).toBeNull();
    expect(sanitizeAction({ type: "hire", mob: "swarm", to: 1 })).toEqual({ type: "hire", mob: "swarm", to: 1 });
    expect(sanitizeAction({ type: "hire", mob: "dragon" })).toBeNull();
    expect(sanitizeAction({ type: "merge", a: -1, b: 2 })).toBeNull();
    expect(sanitizeAction({ type: "upgrade", kind: "laser" })).toBeNull();
    expect(sanitizeAction({ type: "summon", extra: 1 })).toEqual({ type: "summon" });
    expect(sanitizeAction(null)).toBeNull();
    expect(sanitizeAction({ type: "summon", slot: 99 })).toBeNull();
    expect(sanitizeAction({ type: "summon", slot: 4 })).toEqual({ type: "summon", slot: 4 });
    expect(sanitizeAction({ type: "move", a: 0, b: 0 })).toBeNull();
    expect(sanitizeAction({ type: "send", slot: 2, to: 9 })).toBeNull();
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
    for (const [n, seed, mode] of [
      [2, 11, "survival"],
      [3, 12, "survival"],
      [4, 13, "survival"],
      [2, 14, "versus"],
      [4, 15, "versus"],
    ] as const) {
      const s = runBots(n, seed, 20 * 60 * 25, mode);
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
