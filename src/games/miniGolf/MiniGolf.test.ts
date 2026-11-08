import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { HOLE_SETS, HOLES, layoutFor, OBSTACLE_KINDS } from "./course";
import {
  applyAction,
  ballSpot,
  capOf,
  computeRankings,
  currentActor,
  lastPlace,
  quantizeShot,
  scoreName,
  startGame,
  teeOrder,
  totalOf,
  windmillClock,
  type EngineAction,
  type MiniGolfState,
} from "./engine";
import { BALL_R, CUP_R, onGround, simulate, speedForPower, WALL_R, WINDMILL_BLOCK, windmillBlocked, type Layout } from "./physics";
import { chooseBotAction, chooseBotPick, walkDist } from "./bot";
import { ReplayPlayer, type ReplayEvent } from "./replay";
import { resultLabel } from "./labels";
import { miniGolfStatDetails } from "./stats";
import { aimLabel, velocityFor } from "./aim";

const flat = (len = 30): Layout => ({
  ground: [
    [
      [-2, -1],
      [2, -1],
      [2, len],
      [-2, len],
    ],
  ],
  voids: [],
  walls: [],
  zones: [],
  bumpers: [],
  windmill: null,
  ramps: [],
  magnets: [],
  tee: { x: 0, y: 0 },
  cup: { x: 99, y: 99 },
});

const one = (L: Layout, x: number, y: number, vx: number, vy: number, wm = 0) => simulate(L, [{ id: 0, x, y }], { shooter: 0, vx, vy, wm }).balls[0];

/** A state on hole index `idx` of a 9-hole game with these obstacles. */
function onHole(n: number, idx: number, opts: Partial<MiniGolfState["options"]> = {}, obstacle: (typeof OBSTACLE_KINDS)[number] | null = null): MiniGolfState {
  const s = startGame(n, 7, { holes: 9, ...opts });
  return { ...s, holeIdx: idx, obstacles: s.obstacles.map((o, i) => (i === idx ? obstacle : o)) };
}

describe("physics (§6)", () => {
  it("a putt on flat carpet rolls straight and stops; harder goes further", () => {
    let last = 0;
    for (const p of [0.1, 0.3, 0.5, 0.7, 1]) {
      const v = speedForPower(p);
      const r = one(flat(), 0, 0, 0, v);
      expect(r.end).toBe("rest");
      expect(Math.abs(r.x)).toBeLessThan(1e-9);
      expect(r.y).toBeGreaterThan(last);
      last = r.y;
    }
  });

  it("is deterministic — the same shot ends in the same place, bit for bit", () => {
    const L = layoutFor(4, null);
    const balls = [
      { id: 0, x: 0, y: 0.5 },
      { id: 1, x: 0.1, y: 2.2 },
      { id: 2, x: -0.4, y: 3.9 },
    ];
    const a = simulate(L, balls, { shooter: 0, vx: 0.31, vy: 3.1, wm: 1.234 });
    const b = simulate(L, balls, { shooter: 0, vx: 0.31, vy: 3.1, wm: 1.234 });
    expect(JSON.stringify(a.balls)).toBe(JSON.stringify(b.balls));
    expect(a.steps).toBe(b.steps);
  });

  it("rails keep the ball on the island", () => {
    const L = layoutFor(0, null);
    for (const [vx, vy] of [
      [3, 0.4],
      [-3, 1],
      [0.2, 4.2],
      [0, -3],
    ]) {
      const r = one(L, 0, 0.5, vx, vy);
      expect(r.end).not.toBe("out");
      expect(onGround(L, r.x, r.y)).toBe(true);
    }
  });

  it("an open edge drops the ball off (hole 2's top edge)", () => {
    const L = layoutFor(1, null);
    const r = one(L, 2.5, 3.6, 0, 3);
    expect(r.end).toBe("out");
  });

  it("a slow ball over the cup drops in, a fast one skims past", () => {
    const L = { ...flat(), cup: { x: 0, y: 2 } };
    // rolls up and over the cup slowly
    const slow = simulate(L, [{ id: 0, x: 0, y: 1.2 }], { shooter: 0, vx: 0, vy: 1.0, wm: 0 });
    expect(slow.balls[0].end).toBe("holed");
    const fast = simulate(L, [{ id: 0, x: 0, y: 1.2 }], { shooter: 0, vx: 0, vy: 3.6, wm: 0 });
    expect(fast.balls[0].end).toBe("rest");
    expect(fast.balls[0].y).toBeGreaterThan(2 + CUP_R);
  });

  it("the windmill blocks its tunnel the stated share of the time", () => {
    let blocked = 0;
    const N = 4800;
    for (let i = 0; i < N; i++) if (windmillBlocked(i / 1000)) blocked++;
    expect(blocked / N).toBeGreaterThan(WINDMILL_BLOCK - 0.02);
    expect(blocked / N).toBeLessThan(WINDMILL_BLOCK + 0.02);
  });

  it("through the windmill tunnel when it's open, bounced back by a blade", () => {
    const L = layoutFor(0, "windmill");
    const wm = L.windmill!;
    // find an open and a blocked clock for a ball that reaches the mouth ~0.4 s after starting
    let open = -1;
    let shut = -1;
    for (let c = 0; c < 2.4 && (open < 0 || shut < 0); c += 0.01) {
      const r = simulate(L, [{ id: 0, x: 0, y: wm.y - 0.6 }], { shooter: 0, vx: 0, vy: 2.2, wm: c });
      if (r.windmillPass && open < 0) open = c;
      if (r.windmillHit && shut < 0) shut = c;
    }
    expect(open).toBeGreaterThanOrEqual(0);
    expect(shut).toBeGreaterThanOrEqual(0);
    const hit = simulate(L, [{ id: 0, x: 0, y: wm.y - 0.6 }], { shooter: 0, vx: 0, vy: 2.2, wm: shut });
    expect(hit.balls[0].y).toBeLessThan(wm.y);
  });

  it("the ramp jumps a fast ball over the chasm; beside it you fall in", () => {
    const L = layoutFor(0, "ramp");
    const r = L.ramps[0];
    const start = r.cy - 1.2;
    const jump = simulate(L, [{ id: 0, x: r.cx, y: start }], { shooter: 0, vx: 0, vy: 4, wm: 0 });
    expect(jump.jumped).toBe(true);
    expect(jump.balls[0].end).not.toBe("out");
    expect(jump.balls[0].y).toBeGreaterThan(r.cy + 0.6);
    const beside = one(L, r.cx - 0.4, start, 0, 3);
    expect(beside.end).toBe("out");
    // the bridge along one rail gets you across without jumping
    const h = HOLES[0].slot;
    const bridgeX = h.side > 0 ? h.w / 2 - 0.085 : -h.w / 2 + 0.085;
    const walk = one(L, bridgeX, start, 0, 2.2);
    expect(walk.end).not.toBe("out");
    expect(walk.y).toBeGreaterThan(r.cy + 0.6);
  });

  it("the magnet drags a passing ball toward it", () => {
    const L = layoutFor(0, "magnet");
    const m = L.magnets[0];
    const plain = layoutFor(0, null);
    const x0 = m.x - Math.sign(m.x) * 0.25;
    const a = one(plain, x0, m.y - 1, 0, 1.6);
    const b = one(L, x0, m.y - 1, 0, 1.6);
    expect(Math.abs(b.x - m.x)).toBeLessThan(Math.abs(a.x - m.x));
  });

  it("balls knock each other", () => {
    const L = flat();
    const r = simulate(
      L,
      [
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 0, y: 1 },
      ],
      { shooter: 0, vx: 0, vy: 2, wm: 0 },
    );
    expect(r.balls[1].y).toBeGreaterThan(1.3);
    expect(r.balls[0].y).toBeLessThan(r.balls[1].y);
  });
});

describe("course (§3)", () => {
  it("every hole: tee and cup on the grass, clear of rails, reachable on foot, with every obstacle", () => {
    for (const h of HOLES) {
      for (const ob of [null, ...OBSTACLE_KINDS]) {
        const L = layoutFor(h.id, ob);
        expect(onGround(L, L.tee.x, L.tee.y), `${h.name} tee`).toBe(true);
        expect(onGround(L, L.cup.x, L.cup.y), `${h.name} cup`).toBe(true);
        for (const w of L.walls) {
          const dx = w.x2 - w.x1;
          const dy = w.y2 - w.y1;
          const t = Math.max(0, Math.min(1, ((L.tee.x - w.x1) * dx + (L.tee.y - w.y1) * dy) / (dx * dx + dy * dy)));
          expect(Math.hypot(L.tee.x - (w.x1 + t * dx), L.tee.y - (w.y1 + t * dy)), `${h.name} tee vs rail`).toBeGreaterThan(BALL_R + WALL_R);
        }
        expect(walkDist(L, L.tee.x, L.tee.y), `${h.name}/${ob} walk`).toBeLessThan(20);
      }
      expect(h.par).toBeGreaterThanOrEqual(2);
    }
    expect(HOLES.reduce((a, h) => a + h.par, 0)).toBe(28);
    for (const set of Object.values(HOLE_SETS)) for (const id of set) expect(HOLES[id]).toBeDefined();
  });

  it("each obstacle is built into the slot", () => {
    for (const h of HOLES) {
      expect(layoutFor(h.id, "windmill").windmill).not.toBeNull();
      expect(layoutFor(h.id, "ramp").ramps).toHaveLength(1);
      expect(layoutFor(h.id, "ramp").voids.length).toBe((h.voids ?? []).length + 1);
      expect(layoutFor(h.id, "magnet").magnets).toHaveLength(1);
      expect(layoutFor(h.id, null).windmill).toBeNull();
    }
  });
});

function shot(s: MiniGolfState, vx: number, vy: number, wm = 0): MiniGolfState {
  return applyAction(s, { type: "shot", seat: s.activeSeat, ...quantizeShot(vx, vy, wm) });
}

describe("engine (§4–§9)", () => {
  it("starts on the first hole with everyone's ball in hand, seat order", () => {
    const s = startGame(3, 1);
    expect(s.phase).toBe("play");
    expect(s.order).toEqual([0, 1, 2]);
    expect(s.activeSeat).toBe(0);
    expect(s.balls.every((b) => b.status === "hand")).toBe(true);
    expect(currentActor(s)).toBe(0);
    expect(ballSpot(s, 1)).toEqual(HOLES[0].tee);
  });

  it("one stroke each in turn; a stroke is counted and the ball rests where it stopped", () => {
    let s = startGame(2, 1);
    s = shot(s, 0, 1.2);
    expect(s.strokes[0]).toBe(1);
    expect(s.balls[0].status).toBe("rest");
    expect(s.activeSeat).toBe(1);
    expect(s.lastShot?.seat).toBe(0);
    s = shot(s, 0, 1.2);
    expect(s.activeSeat).toBe(0);
  });

  it("ignores strokes out of turn and junk input", () => {
    const s = startGame(2, 1);
    expect(applyAction(s, { type: "shot", seat: 1, vx: 0, vy: 1000, wm: 0 })).toBe(s);
    expect(applyAction(s, { type: "shot", seat: 0, vx: NaN, vy: 1000, wm: 0 })).toBe(s);
    expect(applyAction(s, { type: "pick", seat: 0, kind: "ramp" })).toBe(s);
    expect(applyAction(s, { type: "timeout", seat: 0, turn: 99 })).toBe(s);
    expect(applyAction(s, { type: "bogus" } as unknown as EngineAction)).toBe(s);
  });

  it("falling off costs a penalty stroke and puts the ball back where it was hit from", () => {
    let s = onHole(1, 1); // the L hole with an open top edge
    s = { ...s, balls: [{ x: 2.5, y: 3.6, status: "rest" }], strokes: [1] };
    s = shot(s, 0, 3);
    expect(s.lastShot?.out).toBe(true);
    expect(s.strokes[0]).toBe(3);
    expect(s.balls[0]).toMatchObject({ x: 2.5, y: 3.6, status: "rest" });
  });

  it("a whiff (time-out) is +1 and the ball stays", () => {
    let s = startGame(2, 1);
    s = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(s.strokes[0]).toBe(1);
    expect(s.lastShot?.timeout).toBe(true);
    expect(s.balls[0]).toMatchObject({ ...HOLES[0].tee, status: "rest" });
    expect(s.activeSeat).toBe(1);
  });

  it("the stroke cap picks the ball up at par × 2 and scores par × 2 + 1", () => {
    let s = startGame(1, 1, { holes: 3 });
    const cap = capOf(HOLES[0].par);
    for (let i = 0; i < cap; i++) s = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(s.scores[0][0]).toBe(cap + 1);
    expect(s.lastShot?.picked).toBe(true);
    expect(s.phase).toBe("pick");
  });

  it("holing out scores the hole; the next player keeps going; the hole ends when all are done", () => {
    let s = onHole(2, 0);
    const L = layoutFor(0, null);
    // put both balls next to the cup
    s = { ...s, balls: [{ x: L.cup.x, y: L.cup.y - 0.3, status: "rest" }, { x: L.cup.x - 0.2, y: L.cup.y - 0.3, status: "rest" }], strokes: [1, 1] };
    s = shot(s, 0, 0.9);
    expect(s.balls[0].status).toBe("holed");
    expect(s.scores[0][0]).toBe(2);
    expect(s.activeSeat).toBe(1);
    // seat 1 now plays until it's in (seat 0 is skipped)
    s = shot(s, 0.2 * 2.3, 0.3 * 2.3);
    let guard = 0;
    while (s.phase === "play" && s.holeIdx === 0 && guard++ < 10) {
      expect(s.activeSeat).toBe(1);
      const p = ballSpot(s, 1);
      const dx = L.cup.x - p.x;
      const dy = L.cup.y - p.y;
      const d = Math.hypot(dx, dy);
      s = shot(s, (dx / d) * Math.min(1.1, 0.9 + d), (dy / d) * Math.min(1.1, 0.9 + d));
    }
    expect(s.scores[1][0]).not.toBeNull();
    expect(s.phase).toBe("pick");
  });

  it("knocking someone in holes them out at their count; knocking them off puts them back", () => {
    const L = layoutFor(0, null);
    let s = onHole(2, 0);
    s = { ...s, balls: [{ x: L.cup.x, y: L.cup.y - 0.5, status: "rest" }, { x: L.cup.x, y: L.cup.y - 0.25, status: "rest" }], strokes: [1, 2] };
    s = shot(s, 0, 1.05);
    expect(s.lastShot?.knockedIn).toEqual([1]);
    expect(s.balls[1].status).toBe("holed");
    expect(s.scores[1][0]).toBe(2);

    let k = onHole(2, 1); // the L hole with the open top edge
    k = { ...k, balls: [{ x: 2.5, y: 3.3, status: "rest" }, { x: 2.5, y: 3.6, status: "rest" }], strokes: [1, 1] };
    k = shot(k, 0, 3.5);
    expect(k.lastShot?.knockedOut).toContain(1);
    expect(k.balls[1]).toMatchObject({ x: 2.5, y: 3.6, status: "rest" });
  });

  it("with collisions off, others' balls aren't on the course", () => {
    const L = layoutFor(0, null);
    let s = onHole(2, 0, { collisions: false });
    s = { ...s, balls: [{ x: L.cup.x, y: L.cup.y - 0.5, status: "rest" }, { x: L.cup.x, y: L.cup.y - 0.25, status: "rest" }], strokes: [1, 2] };
    s = shot(s, 0, 1.6);
    expect(s.lastShot?.knockedIn).toEqual([]);
    expect(s.balls[1]).toMatchObject({ y: L.cup.y - 0.25, status: "rest" });
  });

  it("after a hole last place picks the obstacle and tees off last; the leader goes first", () => {
    let s = startGame(3, 1, { holes: 3 });
    s = { ...s, scores: [[3, null, null], [2, null, null], [5, null, null]], balls: s.balls.map((b) => ({ ...b, status: "holed" as const })) };
    expect(lastPlace(s)).toBe(2);
    expect(teeOrder(s, 2)).toEqual([1, 0, 2]);
    // finish via a real stroke: give seat 0 a hole-out
    let t = startGame(3, 1, { holes: 3 });
    t = { ...t, scores: [[null, null, null], [2, null, null], [5, null, null]], balls: [{ x: HOLES[0].cup.x, y: HOLES[0].cup.y - 0.25, status: "rest" }, { x: 0, y: 0, status: "holed" }, { x: 0, y: 0, status: "holed" }], strokes: [2, 2, 5] };
    t = shot(t, 0, 0.9);
    expect(t.phase).toBe("pick");
    expect(t.picker).toBe(2);
    expect(currentActor(t)).toBe(2);
    expect(applyAction(t, { type: "pick", seat: 1, kind: "ramp" })).toBe(t);
    const u = applyAction(t, { type: "pick", seat: 2, kind: "windmill" });
    expect(u.phase).toBe("play");
    expect(u.holeIdx).toBe(1);
    expect(u.obstacles[1]).toBe("windmill");
    expect(u.order[u.order.length - 1]).toBe(2);
    expect(u.order[0]).toBe(1);
    expect(u.lastPick).toMatchObject({ seat: 2, kind: "windmill", auto: false });
    // a pick time-out picks at random, deterministically
    const v1 = applyAction(t, { type: "timeout", seat: 2, turn: t.turn });
    const v2 = applyAction(t, { type: "timeout", seat: 2, turn: t.turn });
    expect(v1.obstacles[1]).not.toBeNull();
    expect(v1.obstacles[1]).toBe(v2.obstacles[1]);
    expect(v1.lastPick?.auto).toBe(true);
  });

  it("obstacles off → straight to the next hole, no pick", () => {
    let s = startGame(1, 1, { holes: 3, obstacles: false });
    for (let i = 0; i < capOf(HOLES[0].par); i++) s = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(s.phase).toBe("play");
    expect(s.holeIdx).toBe(1);
    expect(s.obstacles[1]).toBeNull();
  });

  it("ends after the last hole; fewest strokes wins, ties → hole-in-ones", () => {
    const s = startGame(3, 1, { holes: 3 });
    const done: MiniGolfState = {
      ...s,
      phase: "ended",
      scores: [
        [2, 3, 4],
        [3, 3, 3],
        [1, 4, 4],
      ],
      statTally: { 2: { holeInOnes: 1 } },
    };
    expect(totalOf(done, 0)).toBe(9);
    const r = computeRankings(done);
    expect(r[0]).toEqual({ seat: 2, rank: 1 });
    expect(r.find((x) => x.seat === 0)?.rank).toBe(2);
    expect(r.find((x) => x.seat === 1)?.rank).toBe(2);
  });

  it("score names", () => {
    expect(scoreName(1, 3)).toBe("홀인원");
    expect(scoreName(2, 4)).toBe("이글");
    expect(scoreName(2, 3)).toBe("버디");
    expect(scoreName(3, 3)).toBe("파");
    expect(scoreName(4, 3)).toBe("보기");
    expect(scoreName(5, 3)).toBe("더블 보기");
  });

  it("the windmill clock wraps one turn and adds the windup", () => {
    expect(windmillClock(0)).toBeCloseTo(0.75);
    expect(windmillClock(2400)).toBeCloseTo(0.75);
    expect(windmillClock(-600)).toBeCloseTo(1.8 + 0.75);
    expect(quantizeShot(1, 2, 2.5).wm).toBe(100);
  });
});

describe("bot (§10)", () => {
  it("plays a whole 3-hole game for 3 seats with picks, and replaying its actions reproduces the result", () => {
    const rng = seededRng(42);
    let s = startGame(3, 99, { holes: 3 });
    const log: EngineAction[] = [];
    let guard = 0;
    while (s.phase !== "ended" && guard++ < 200) {
      const who = currentActor(s)!;
      const a = chooseBotAction(s, who, [3, 6, 9][who], rng);
      expect(a).not.toBeNull();
      log.push(a!);
      const next = applyAction(s, a!);
      expect(next).not.toBe(s);
      s = next;
    }
    expect(s.phase).toBe("ended");
    for (let seat = 0; seat < 3; seat++) for (const sc of s.scores[seat]) expect(sc).not.toBeNull();
    let r = startGame(3, 99, { holes: 3 });
    for (const a of log) r = applyAction(r, a);
    expect(JSON.stringify(r.scores)).toBe(JSON.stringify(s.scores));
    expect(JSON.stringify(r.balls)).toBe(JSON.stringify(s.balls));
    // stats stay non-negative numbers
    for (let seat = 0; seat < 3; seat++) for (const v of Object.values(miniGolfStatDetails(s, seat))) expect(v).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("a strong bot sinks a short straight putt", () => {
    const L = layoutFor(0, null);
    let s = startGame(1, 3);
    s = { ...s, balls: [{ x: L.cup.x, y: L.cup.y - 0.4, status: "rest" }], strokes: [1] };
    let holed = 0;
    for (let i = 0; i < 5; i++) {
      const a = chooseBotAction(s, 0, 10, seededRng(i + 1))!;
      if (applyAction(s, a).lastShot?.holed) holed++;
    }
    expect(holed).toBeGreaterThanOrEqual(4);
  });

  it("picks only when it's the picker", () => {
    const s = startGame(2, 1);
    expect(chooseBotPick(s, 0, 5)).toBeNull();
  });
});

describe("replay + labels (§11)", () => {
  it("replays a stroke: swing → settled → done, then idles", () => {
    let s = startGame(1, 5);
    const p = new ReplayPlayer();
    p.sample(s, 0);
    s = shot(s, 0, 2);
    const evs: ReplayEvent["kind"][] = [];
    let now = 0;
    let busy = true;
    for (let i = 0; i < 2000 && busy; i++) {
      now += 16;
      busy = p.sample(s, now, (e) => evs.push(e.kind)).busy;
    }
    expect(evs[0]).toBe("swing");
    expect(evs).toContain("settled");
    expect(evs[evs.length - 1]).toBe("done");
    expect(p.sample(s, now + 16).busy).toBe(false);
  });

  it("doesn't replay what happened before it started watching", () => {
    let s = startGame(1, 5);
    s = shot(s, 0, 2);
    const p = new ReplayPlayer();
    expect(p.sample(s, 0).busy).toBe(false);
  });

  it("result labels", () => {
    let s = startGame(1, 5);
    s = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(resultLabel(s.lastShot!).text).toContain("헛스윙");
    const L = layoutFor(0, null);
    let h: MiniGolfState = { ...startGame(1, 5), balls: [{ x: L.cup.x, y: L.cup.y - 0.3, status: "rest" }], strokes: [0] };
    h = shot(h, 0, 0.9);
    expect(resultLabel(h.lastShot!).text).toContain("홀인원");
  });

  it("aim helpers", () => {
    expect(aimLabel(Math.PI / 2)).toBe("정면");
    expect(aimLabel(Math.PI / 2 + 0.2)).toContain("왼쪽");
    const v = velocityFor(Math.PI / 2, 1);
    expect(v.vx).toBeCloseTo(0);
    expect(v.vy).toBeCloseTo(speedForPower(1));
  });
});
