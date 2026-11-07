import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  canUseItem,
  computeRankings,
  currentSetup,
  isSplit,
  laneSetup,
  maxPossible,
  quantizeRoll,
  rackFor,
  releaseOf,
  rollLaneMods,
  runningScore,
  scoreFrames,
  startGame,
  totalOf,
  type BowlingState,
  type EngineAction,
} from "./engine";
import { ballPathX, defaultSetup, HALF_W, HEAD_Y, RACK, simulate } from "./physics";
import { chooseBotAction, chooseBotRoll, solveAim } from "./bot";
import { ReplayPlayer } from "./replay";
import { boardOf, meterAt } from "./aim";
import { resultLabel } from "./labels";

const strikes = (n: number) => Array.from({ length: n }, () => [10]);

describe("ten-pin scoring (§5)", () => {
  it("a perfect game is 300", () => {
    const frames = [...strikes(9), [10, 10, 10]];
    expect(scoreFrames(frames)[9].total).toBe(300);
    expect(scoreFrames(frames)[9].marks).toEqual(["X", "X", "X"]);
  });

  it("all 5-spares with a 5 fill ball is 150", () => {
    const frames = [...Array.from({ length: 9 }, () => [5, 5]), [5, 5, 5]];
    expect(scoreFrames(frames)[9].total).toBe(150);
    expect(scoreFrames(frames)[0].marks).toEqual(["5", "/"]);
  });

  it("open frames just add up, gutters print as -", () => {
    const frames = Array.from({ length: 10 }, () => [9, 0]);
    const s = scoreFrames(frames);
    expect(s[9].total).toBe(90);
    expect(s[0].marks).toEqual(["9", "-"]);
    expect(scoreFrames(Array.from({ length: 10 }, () => [0, 0]))[9].total).toBe(0);
  });

  it("strike bonus waits for the next two balls", () => {
    const s = scoreFrames([[10], [7], [], []]);
    expect(s[0].total).toBeNull();
    const s2 = scoreFrames([[10], [7, 2], [], []]);
    expect(s2[0].total).toBe(19);
    expect(s2[1].total).toBe(28);
    expect(scoreFrames([[10], [10], [3, 4]])[0].total).toBe(23);
  });

  it("the worked example in the rulebook (X · 7/ · 9-)", () => {
    const s = scoreFrames([[10], [7, 3], [9, 0]]);
    expect(s.map((f) => f.total)).toEqual([20, 39, 48]);
  });

  it("last-frame strike then a leave then a spare prints X 7 /", () => {
    const s = scoreFrames([[0, 0], [0, 0], [10, 7, 3]]);
    expect(s[2].marks).toEqual(["X", "7", "/"]);
    expect(s[2].total).toBe(20);
  });

  it("running score counts what's known and max possible fills strikes", () => {
    expect(runningScore([[10], [7], []])).toBe(24);
    expect(maxPossible([[], [], []])).toBe(90);
    expect(maxPossible([[9, 0], [], []])).toBe(69);
  });
});

describe("physics (§6)", () => {
  const setup = defaultSetup(RACK.map((p) => ({ ...p })));

  it("is deterministic for the same release", () => {
    const a = simulate(setup, { x: 0.12, vx: -0.18, vy: 8, spin: 0.5 });
    const b = simulate(setup, { x: 0.12, vx: -0.18, vy: 8, spin: 0.5 });
    expect(a.down).toEqual(b.down);
    expect(a.steps).toBe(b.steps);
  });

  it("a straight ball into the pocket carries a lot of pins; a gutter ball none", () => {
    const pocket = simulate(setup, { x: 0.06, vx: 0, vy: 8, spin: 0 });
    expect(pocket.down.length).toBeGreaterThanOrEqual(8);
    const gutter = simulate(setup, { x: 0.4, vx: 0.6, vy: 8, spin: 0 });
    expect(gutter.gutterStep).not.toBeNull();
    expect(gutter.down.length).toBe(0);
  });

  it("hook bends the ball the way it spins", () => {
    const straight = ballPathX(setup, { x: 0, vx: 0, vy: 7, spin: 0 }, HEAD_Y).x;
    const right = ballPathX(setup, { x: 0, vx: 0, vy: 7, spin: 0.8 }, HEAD_Y).x;
    const left = ballPathX(setup, { x: 0, vx: 0, vy: 7, spin: -0.8 }, HEAD_Y).x;
    expect(right).toBeGreaterThan(straight + 0.2);
    expect(left).toBeLessThan(straight - 0.2);
    // a faster ball hooks less
    const fast = ballPathX(setup, { x: 0, vx: 0, vy: 9.5, spin: 0.8 }, HEAD_Y).x;
    expect(fast).toBeLessThan(right);
  });

  it("bumpers keep the ball out of the gutter", () => {
    const s = laneSetup(RACK.map((p) => ({ ...p })), "bumpers", 1, [], false);
    const r = simulate(s, { x: 0.4, vx: 0.6, vy: 8, spin: 0 });
    expect(r.gutterStep).toBeNull();
  });

  it("a cone in the path deflects the ball", () => {
    const clear = simulate(setup, { x: 0.06, vx: 0, vy: 8, spin: 0 });
    const s = laneSetup(RACK.map((p) => ({ ...p })), "normal", 1, [{ kind: "cone", from: 1, x: 0.06, y: 11 }], false);
    const coned = simulate(s, { x: 0.06, vx: 0, vy: 8, spin: 0 }, true);
    expect(coned.events!.some((e) => e.kind === "cone")).toBe(true);
    expect(coned.down.length).toBeLessThan(clear.down.length);
  });

  it("oil reverses the hook through the slick", () => {
    const base = ballPathX(setup, { x: 0, vx: 0, vy: 7, spin: 0.8 }, HEAD_Y).x;
    const oiled = laneSetup([], "normal", 1, [{ kind: "oil", from: 1, y0: 11, y1: 15 }], false);
    expect(ballPathX(oiled, { x: 0, vx: 0, vy: 7, spin: 0.8 }, HEAD_Y).x).toBeLessThan(base - 0.2);
  });

  it("split detection (§5)", () => {
    expect(isSplit([6, 9])).toBe(true); // 7-10
    expect(isSplit([3, 5])).toBe(true); // 4-6
    expect(isSplit([1, 3])).toBe(false); // 2-4 touch
    expect(isSplit([0, 6])).toBe(false); // head pin standing
    expect(isSplit([9])).toBe(false);
  });
});

function play(state: BowlingState, a: EngineAction) {
  const next = applyAction(state, a);
  expect(next).not.toBe(state);
  return next;
}

const straightPocket = (seat: number) => ({ type: "roll" as const, seat, ...quantizeRoll(0.06, 0, 8, 0) });
const gutterBall = (seat: number) => ({ type: "roll" as const, seat, ...quantizeRoll(0.4, 0.8, 8, 0) });

describe("engine flow", () => {
  it("frame 1 is always a plain lane, the last frame always a twist, never twice in a row", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { mods } = rollLaneMods(seed, 10, true);
      expect(mods[0]).toBe("normal");
      expect(mods[9]).not.toBe("normal");
      for (let f = 1; f < 10; f++) if (mods[f] !== "normal") expect(mods[f]).not.toBe(mods[f - 1]);
    }
    expect(rollLaneMods(3, 5, false).mods.every((m) => m === "normal")).toBe(true);
  });

  it("gutter balls give an open frame and pass the turn", () => {
    let s = startGame(2, 1, { frames: 3, chaos: false, items: false });
    s = play(s, gutterBall(0));
    expect(s.activeSeat).toBe(0);
    expect(s.ball).toBe(1);
    s = play(s, gutterBall(0));
    expect(s.activeSeat).toBe(1);
    expect(s.ball).toBe(0);
    expect(s.standing).toHaveLength(10);
    expect(s.rolls[0][0]).toEqual([0, 0]);
    expect(s.statTally?.[0]?.gutters).toBe(2);
  });

  it("someone else's roll is ignored", () => {
    const s = startGame(2, 1, { frames: 3, chaos: false, items: false });
    expect(applyAction(s, gutterBall(1))).toBe(s);
  });

  it("a time-out is a foul: 0 pins, an F on the sheet", () => {
    let s = startGame(1, 4, { frames: 3, chaos: false, items: false });
    s = play(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(s.rolls[0][0]).toEqual([0]);
    expect(s.lastRoll?.foul).toBe(true);
    expect(resultLabel(s.lastRoll!).text).toContain("파울");
    // stale timeout is ignored
    expect(applyAction(s, { type: "timeout", seat: 0, turn: s.turn - 1 })).toBe(s);
  });

  it("a whole solo game reaches the end with a sane total", () => {
    let s = startGame(1, 9, { frames: 10, chaos: false, items: false });
    let n = 0;
    while (s.phase !== "ended" && n++ < 40) s = play(s, straightPocket(0));
    expect(s.phase).toBe("ended");
    const total = totalOf(s, 0);
    expect(total).toBeGreaterThan(60);
    expect(total).toBeLessThanOrEqual(300);
    expect(scoreFrames(s.rolls[0])[9].total).toBe(total);
  });

  it("the last frame resets the rack after a strike and allows a third ball", () => {
    let s = startGame(1, 9, { frames: 3, chaos: false, items: false });
    s = play(s, gutterBall(0));
    s = play(s, gutterBall(0));
    s = play(s, gutterBall(0));
    s = play(s, gutterBall(0));
    // frame 3: force a strike by rolling with every pin gone except... use the engine: craft state
    s = { ...s, standing: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
    let r = s;
    // find a release that strikes on this rack
    for (let mm = 0; mm <= 200 && r === s; mm += 5) {
      const a = { type: "roll" as const, seat: 0, ...quantizeRoll((mm % 2 ? -1 : 1) * (0.06 + Math.floor(mm / 2) / 1000), 0, 8, 0) };
      const t = applyAction(s, a);
      if (t.lastRoll?.strike) r = t;
    }
    expect(r.lastRoll?.strike).toBe(true);
    expect(r.phase).toBe("aim");
    expect(r.standing).toHaveLength(10);
    r = play(r, gutterBall(0));
    expect(r.phase).toBe("aim");
    r = play(r, gutterBall(0));
    expect(r.phase).toBe("ended");
    expect(r.rolls[0][2]).toEqual([10, 0, 0]);
  });

  it("rankings: score, then strikes, then spares", () => {
    let s = startGame(2, 1, { frames: 3, chaos: false, items: false });
    s = { ...s, rolls: [[[9, 0], [9, 0], [9, 0]], [[10], [0, 0], [0, 7]]], phase: "ended" };
    const r = computeRankings(s);
    expect(r[0].seat).toBe(0);
    expect(totalOf(s, 0)).toBe(27);
    expect(totalOf(s, 1)).toBe(17);
  });

  it("a shuffled rack is deterministic per seat and frame", () => {
    const a = rackFor(5, 2, 1, "shuffle");
    expect(rackFor(5, 2, 1, "shuffle")).toEqual(a);
    expect(rackFor(5, 2, 0, "shuffle")).not.toEqual(a);
    expect(rackFor(5, 2, 1, "normal")).toEqual(RACK.map((p) => ({ ...p })));
  });
});

describe("items (§8)", () => {
  it("everyone starts with one item, none solo or with items off", () => {
    expect(startGame(3, 2).items.every((l) => l.length === 1)).toBe(true);
    expect(startGame(1, 2).items[0]).toEqual([]);
    expect(startGame(3, 2, { items: false }).items.every((l) => l.length === 0)).toBe(true);
  });

  it("sabotage lands on the target's next frame turn, only before the first ball, once per frame", () => {
    let s = startGame(2, 2, { frames: 3, chaos: false, items: true });
    s = { ...s, items: [["cone", "fan"], []] };
    expect(canUseItem(s, 0, "cone", 0)).toBe(false);
    expect(canUseItem(s, 1, "cone", 0)).toBe(false);
    s = play(s, { type: "item", seat: 0, kind: "cone", target: 1 });
    expect(s.pending[1]).toHaveLength(1);
    expect(s.items[0]).toEqual(["fan"]);
    expect(canUseItem(s, 0, "fan", 1)).toBe(false); // one per frame
    s = play(s, gutterBall(0));
    s = play(s, gutterBall(0));
    // seat 1's frame starts with the cone on its lane
    expect(s.activeSeat).toBe(1);
    expect(s.active.map((h) => h.kind)).toEqual(["cone"]);
    expect(currentSetup(s).cones).toHaveLength(1);
    expect(s.pending[1]).toHaveLength(0);
  });

  it("the bumper is for yourself", () => {
    let s = startGame(2, 2, { frames: 3, chaos: false, items: true });
    s = { ...s, items: [["bumper"], []] };
    expect(canUseItem(s, 0, "bumper", 1)).toBe(false);
    s = play(s, { type: "item", seat: 0, kind: "bumper", target: 0 });
    expect(currentSetup(s).bumpers).toBe(true);
    const r = play(s, gutterBall(0));
    expect(r.lastRoll?.gutter).toBe(false);
  });

  it("the last place gets a comeback item after each frame (max 2)", () => {
    let s = startGame(2, 6, { frames: 3, chaos: false, items: true });
    s = { ...s, items: [[], []] };
    s = play(s, straightPocket(0));
    if (s.activeSeat === 0) s = play(s, gutterBall(0));
    s = play(s, gutterBall(1));
    s = play(s, gutterBall(1));
    expect(s.frame).toBe(1);
    expect(s.items[1]).toHaveLength(1);
    expect(s.items[0]).toHaveLength(0);
    expect(s.lastGift?.seats).toEqual([1]);
  });
});

describe("bot (§10)", () => {
  it("aims the ball where it means to", () => {
    const setup = defaultSetup(RACK.map((p) => ({ ...p })));
    const vx = solveAim(setup, 0.15, 8, -0.5, 0.065, HEAD_Y);
    const x = ballPathX(setup, { x: 0.15, vx, vy: 8, spin: -0.5 }, HEAD_Y - 0.12).x;
    expect(Math.abs(x - 0.065)).toBeLessThan(0.01);
  });

  it("plays legal rolls and uses items", () => {
    const rng = seededRng(4);
    let s = startGame(3, 11, { frames: 3, chaos: true, items: true });
    let usedItem = false;
    let n = 0;
    while (s.phase !== "ended" && n++ < 60) {
      const a = chooseBotAction(s, s.activeSeat, 6, rng);
      expect(a).not.toBeNull();
      if (a!.type === "item") usedItem = true;
      if (a!.type === "roll") expect(Math.abs(releaseOf(a!).x)).toBeLessThanOrEqual(HALF_W);
      s = play(s, a!);
    }
    expect(s.phase).toBe("ended");
    expect(usedItem).toBe(true);
  });

  it("a strong bot knocks down more than a weak one", () => {
    const avg = (level: number) => {
      let sum = 0;
      for (let g = 0; g < 6; g++) {
        const rng = seededRng(100 + g);
        const s = startGame(1, 50 + g, { frames: 3, chaos: false, items: false });
        const a = chooseBotRoll(s, 0, level, rng)!;
        sum += applyAction(s, a).lastRoll!.down.length;
      }
      return sum / 6;
    };
    expect(avg(10)).toBeGreaterThan(avg(1));
  });
});

describe("replay + helpers", () => {
  it("replays the last roll and lands where the engine said", () => {
    let s = startGame(1, 3, { frames: 3, chaos: false, items: false });
    const p = new ReplayPlayer();
    p.sample(s, 0);
    s = play(s, straightPocket(0));
    let t = 0;
    let settled = false;
    let done = false;
    let view = p.sample(s, t);
    while (!done && t < 30_000) {
      t += 16;
      view = p.sample(s, t, (e) => {
        if (e.kind === "settled") {
          settled = true;
          expect(e.rec.down.length).toBe(s.lastRoll!.down.length);
        }
        if (e.kind === "done") done = true;
      });
    }
    expect(settled && done).toBe(true);
    view = p.sample(s, t + 16);
    expect(view.busy).toBe(false);
  });

  it("boards count from the right, the meter ping-pongs", () => {
    expect(boardOf(0)).toBe(20);
    expect(boardOf(0.5)).toBe(1);
    expect(boardOf(-0.5)).toBe(39);
    expect(meterAt(0)).toBe(0);
    expect(meterAt(750)).toBeCloseTo(1);
    expect(meterAt(1500)).toBe(0);
  });
});
