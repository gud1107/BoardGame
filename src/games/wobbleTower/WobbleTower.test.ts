import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  blockCount,
  canPull,
  chooseBotAction,
  computeRankings,
  currentActor,
  interfaces,
  legalPulls,
  placeTarget,
  pullCollapseChance,
  START_LEVELS,
  startGame,
  timeoutAction,
  TIMEOUT_QUALITY,
  weakestInterface,
  type Level,
  type WobbleTowerState,
} from "./engine";
import { PullTracker, pullFeel } from "./pull";
import { TowerSway, bendOffset } from "./three/sway";
import { wobbleTowerStatDetails } from "./stats";

const full = (): Level => ({ slots: [{ id: 0, loose: 0.5 }, { id: 1, loose: 0.5 }, { id: 2, loose: 0.5 }] });

/** A state with a hand-built tower (ids made unique). */
function withLevels(levels: Level[], patch: Partial<WobbleTowerState> = {}): WobbleTowerState {
  let id = 0;
  const lv = levels.map((l) => ({ slots: l.slots.map((b) => (b ? { ...b, id: id++ } : null)) }));
  return { ...startGame(2, 1), levels: lv, activeSeat: 0, ...patch };
}

function playOut(s: WobbleTowerState, levelOf: (seat: number) => number, seed: number): WobbleTowerState {
  const rng = seededRng(seed);
  for (let i = 0; i < 4000 && s.phase !== "ended"; i++) {
    if (s.phase === "collapsed") {
      s = applyAction(s, { type: "next" });
      continue;
    }
    const actor = currentActor(s)!;
    const a = chooseBotAction(s, actor, levelOf(actor), rng);
    expect(a).not.toBeNull();
    s = applyAction(s, a!);
  }
  return s;
}

describe("setup", () => {
  it("builds 18 full levels and is deterministic", () => {
    const a = startGame(4, 42);
    const b = startGame(4, 42);
    expect(a.levels).toHaveLength(START_LEVELS);
    expect(a.levels.every((l) => blockCount(l) === 3)).toBe(true);
    expect(a).toEqual(b);
    expect(new Set(a.levels.flatMap((l) => l.slots.map((x) => x!.id))).size).toBe(54);
    for (const l of a.levels) for (const b2 of l.slots) expect(b2!.loose).toBeGreaterThanOrEqual(0);
  });
});

describe("§4 legality", () => {
  it("forbids the top level (and the one below while the top is incomplete)", () => {
    const s = startGame(2, 3);
    expect(canPull(s, 17, 0)).toBe(false);
    expect(canPull(s, 16, 0)).toBe(true);
    const partial = withLevels([...Array(18)].map(full).concat([{ slots: [{ id: 0, loose: 0.5 }, null, null] }]));
    expect(canPull(partial, 18, 0)).toBe(false);
    expect(canPull(partial, 17, 1)).toBe(false);
    expect(canPull(partial, 16, 1)).toBe(true);
  });

  it("never lets you take the last block of a level", () => {
    const lonely = full();
    lonely.slots[0] = null;
    lonely.slots[2] = null;
    const s = withLevels([full(), lonely, ...[...Array(16)].map(full)]);
    expect(canPull(s, 1, 1)).toBe(false);
    expect(legalPulls(s).some((c) => c.level === 1)).toBe(false);
  });
});

describe("§7.1 structure", () => {
  it("a full tower has a 1.5-wide margin everywhere", () => {
    const s = startGame(2, 9);
    expect(weakestInterface(s.levels)!.margin).toBeCloseTo(1.5);
  });

  it("leaving only an edge block under load is a certain collapse", () => {
    const lv = full();
    lv.slots[0] = null; // edge + middle remain
    const s = withLevels([full(), full(), lv, ...[...Array(15)].map(full)]);
    expect(pullCollapseChance(s.levels, 0, { level: 2, slot: 1 }, 1).p).toBe(1);
    expect(pullCollapseChance(s.levels, 0, { level: 2, slot: 2 }, 1).p).toBeLessThan(0.05);
  });

  it("a lone top block does not count as a weak interface", () => {
    const s = withLevels([...Array(18)].map(full).concat([{ slots: [{ id: 0, loose: 0.5 }, null, null] }]));
    const top = interfaces(s.levels).find((f) => f.level === 17)!;
    expect(top.load).toBe(1);
    expect(pullCollapseChance(s.levels, 0, { level: 3, slot: 1 }, 0.95).p).toBeLessThan(0.01);
  });

  it("rougher pulls are riskier", () => {
    const s = startGame(2, 5);
    const at = { level: 4, slot: 0 };
    expect(pullCollapseChance(s.levels, 0.2, at, 0.3).p).toBeGreaterThan(pullCollapseChance(s.levels, 0.2, at, 0.9).p);
  });
});

describe("turn flow", () => {
  it("pull → place → next seat, new level orientation alternates", () => {
    let s = startGame(3, 11);
    const seat = s.activeSeat;
    s = applyAction(s, { type: "pull", seat, level: 5, slot: 1, quality: 1 });
    expect(s.phase).toBe("place");
    expect(s.held?.from).toEqual({ level: 5, slot: 1 });
    expect(placeTarget(s.levels)).toEqual({ level: 18, slots: [0, 1, 2] });
    s = applyAction(s, { type: "place", seat, slot: 1 });
    expect(s.levels).toHaveLength(19);
    expect(s.levels[18].slots[1]).not.toBeNull();
    expect(s.activeSeat).toBe((seat + 1) % 3);
    expect(s.lastBuilder).toBe(seat);
  });

  it("ignores actions from the wrong seat or phase", () => {
    const s = startGame(3, 11);
    const other = (s.activeSeat + 1) % 3;
    expect(applyAction(s, { type: "pull", seat: other, level: 2, slot: 1, quality: 1 })).toBe(s);
    expect(applyAction(s, { type: "place", seat: s.activeSeat, slot: 0 })).toBe(s);
    expect(applyAction(s, { type: "next" })).toBe(s);
  });

  it("clamps out-of-range quality", () => {
    let s = startGame(2, 8);
    s = applyAction(s, { type: "pull", seat: s.activeSeat, level: 3, slot: 1, quality: 7 });
    expect(s.lastEvent?.kind === "pull" && s.lastEvent.quality).toBe(1);
  });
});

describe("§8 scoring and §9 ranking", () => {
  it("collapser gets nothing, last builder +2, others +1", () => {
    const lv = full();
    lv.slots[0] = null;
    let s = withLevels([full(), full(), lv, ...[...Array(15)].map(full)], { playerCount: 3, scores: [0, 0, 0], collapses: [0, 0, 0], pulls: [0, 0, 0], activeSeat: 1, lastBuilder: 0 });
    s = applyAction(s, { type: "pull", seat: 1, level: 2, slot: 1, quality: 1 });
    expect(s.phase).toBe("collapsed");
    expect(s.collapse?.cause).toBe("structure");
    expect(s.scores).toEqual([2, 0, 1]);
    const r = computeRankings({ ...s, phase: "ended" });
    expect(r.find((x) => x.seat === 0)!.rank).toBe(1);
    expect(r.find((x) => x.seat === 1)!.rank).toBe(3);
    // round over in single-round mode
    expect(applyAction(s, { type: "next" }).phase).toBe("ended");
  });

  it("3 rounds: loser starts the next tower", () => {
    const lv = full();
    lv.slots[0] = null;
    const base = withLevels([full(), full(), lv, ...[...Array(15)].map(full)], { options: { rounds: 3 }, playerCount: 2, activeSeat: 1 });
    let s = applyAction(base, { type: "pull", seat: 1, level: 2, slot: 1, quality: 1 });
    s = applyAction(s, { type: "next" });
    expect(s.phase).toBe("pull");
    expect(s.round).toBe(1);
    expect(s.activeSeat).toBe(1);
    expect(s.levels).toHaveLength(18);
  });
});

describe("§10 timeouts", () => {
  it("auto-pulls the safest block with a shaky hand, only for the current turn", () => {
    const s = startGame(2, 21);
    const auto = timeoutAction(s)!;
    expect(auto.type === "pull" && auto.quality).toBe(TIMEOUT_QUALITY);
    expect(applyAction(s, { type: "timeout", seat: s.activeSeat, turn: s.turn + 5 })).toBe(s);
    const next = applyAction(s, { type: "timeout", seat: s.activeSeat, turn: s.turn });
    expect(next.lastEvent?.kind === "pull" && next.lastEvent.timeout).toBe(true);
  });
});

describe("bots", () => {
  it.each([2, 3, 4, 6])("%ip mixed-level bots finish a 3-round match", (n) => {
    const s = playOut(startGame(n, 100 + n, { rounds: 3 }), (seat) => 1 + ((seat * 3) % 10), n);
    expect(s.phase).toBe("ended");
    expect(s.history).toHaveLength(3);
    const ranks = computeRankings(s);
    expect(ranks).toHaveLength(n);
    for (let seat = 0; seat < n; seat++) {
      const d = wobbleTowerStatDetails(s, seat);
      expect(d.pulls).toBe(s.pulls[seat]);
      expect(d.collapses).toBe(s.collapses[seat]);
    }
  });

  it("bots never pick a certain-collapse pull when a safer one exists", () => {
    const lv = full();
    lv.slots[0] = null;
    const s = withLevels([full(), full(), lv, ...[...Array(15)].map(full)]);
    for (let i = 0; i < 40; i++) {
      const a = chooseBotAction(s, 0, 1 + (i % 10), seededRng(i))!;
      expect(a.type === "pull" && a.level === 2 && a.slot === 1).toBe(false);
    }
  });
});

describe("§5 pull minigame", () => {
  const run = (feel: ReturnType<typeof pullFeel>, speed: number, waitWhenStuck: boolean) => {
    const t = new PullTracker(feel);
    let hand = 0;
    for (let i = 0; i < 4000 && !t.done; i++) {
      if (!(waitWhenStuck && t.stuck)) hand = Math.min(1, hand + speed / 60);
      t.step(hand, 1 / 60);
    }
    return t;
  };

  it("a steady pull at the safe speed that waits out catches scores high", () => {
    const feel = pullFeel(0.6, 3);
    expect(feel.catches.length).toBeGreaterThan(0);
    const t = run(feel, feel.safeSpeed * 0.9, true);
    expect(t.done && !t.jerked).toBe(true);
    expect(t.quality).toBeGreaterThan(0.9);
  });

  it("pulling through a catch costs quality; yanking jerks", () => {
    const feel = pullFeel(0.6, 3);
    const careless = run(feel, feel.safeSpeed * 0.9, false);
    expect(careless.quality).toBeLessThan(0.9);
    const yank = new PullTracker(pullFeel(0.2, 1));
    yank.step(1, 0.08);
    expect(yank.jerked).toBe(true);
    expect(yank.quality).toBeLessThan(0.1);
  });

  it("is frame-rate independent", () => {
    const feel = pullFeel(0.4, 9);
    const a = new PullTracker(feel);
    const b = new PullTracker(feel);
    for (let i = 1; i <= 240; i++) a.step((i / 240) * 1.05, 1 / 60);
    for (let i = 1; i <= 120; i++) b.step((i / 120) * 1.05, 1 / 30);
    expect(Math.abs(a.quality - b.quality)).toBeLessThan(0.06);
  });
});

describe("§13 sway", () => {
  it("a kick rings down, the base moves less than the top", () => {
    const s = new TowerSway(seededRng(1));
    s.kick(0.05, 0);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      s.step(1 / 60, { fragility: 0, leanX: 0, leanZ: 0 });
      peak = Math.max(peak, Math.abs(s.ax));
    }
    for (let i = 0; i < 60 * 30; i++) s.step(1 / 60, { fragility: 0, leanX: 0, leanZ: 0 });
    expect(peak).toBeGreaterThan(0.003);
    expect(Math.abs(s.ax)).toBeLessThan(peak / 4);
    expect(Math.abs(bendOffset(0.01, 0.3, 5.4))).toBeLessThan(Math.abs(bendOffset(0.01, 5.4, 5.4)));
  });

  it("a fragile tower breathes more than a fresh one", () => {
    const amp = (fragility: number) => {
      const s = new TowerSway(seededRng(7));
      let sum = 0;
      for (let i = 0; i < 60 * 20; i++) {
        s.step(1 / 60, { fragility, leanX: 0, leanZ: 0 });
        sum += Math.abs(s.ax);
      }
      return sum;
    };
    expect(amp(1.2)).toBeGreaterThan(amp(0) * 3);
  });
});
