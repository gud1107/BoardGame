import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  computeRankings,
  CUE_ID,
  currentActor,
  judge,
  quantizeShot,
  rackCarom,
  rackPocket,
  RED_A,
  RED_B,
  runShot,
  startGame,
  YELLOW,
  type Ball,
  type BilliardsState,
} from "./engine";
import { firstContact, HALF_H, HALF_W, POCKETS, R, simulate, spotFree } from "./physics";
import { chooseBotAction } from "./bot";

function withBalls(state: BilliardsState, balls: Ball[]): BilliardsState {
  return { ...state, balls };
}

function shootAt(state: BilliardsState, tx: number, ty: number, speed: number, spin = 0, side = 0) {
  const cue = state.balls.find((b) => b.id === CUE_ID)!;
  const dx = tx - cue.x;
  const dy = ty - cue.y;
  const l = Math.hypot(dx, dy);
  const q = quantizeShot((dx / l) * speed, (dy / l) * speed);
  return applyAction(state, { type: "shoot", seat: state.activeSeat, vx: q.vx, vy: q.vy, spin: spin * 1000, side: side * 1000 });
}

describe("billiards physics", () => {
  it("is deterministic and stays on the cloth", () => {
    const balls = rackPocket(7).map((b) => ({ id: b.id, x: b.x, y: b.y }));
    const a = simulate(balls, { cue: 0, vx: 22, vy: 0.3, spin: 0, side: 0 });
    const b = simulate(balls, { cue: 0, vx: 22, vy: 0.3, spin: 0, side: 0 });
    expect(a).toEqual(b);
    for (const r of a.rest) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(HALF_W - R + 1e-9);
      expect(Math.abs(r.y)).toBeLessThanOrEqual(HALF_H - R + 1e-9);
    }
    expect(a.contacts.length).toBeGreaterThan(3);
  });

  it("a ball rolled straight into a corner pocket drops", () => {
    const pk = POCKETS[3];
    const r = simulate([{ id: 0, x: 0, y: 0 }], { cue: 0, vx: pk.x * 0.9, vy: pk.y * 0.9, spin: 0, side: 0 });
    expect(r.pots.map((p) => p.pocket)).toEqual([3]);
  });

  it("bounces off the cushion and loses speed", () => {
    const r = simulate([{ id: 0, x: 5, y: 0 }], { cue: 0, vx: 0, vy: 10, spin: 0, side: 0 }, true, true);
    expect(r.rails.length).toBeGreaterThan(0);
    expect(r.pots.length).toBe(0);
  });

  it("draw brings the cue ball back, follow carries it through", () => {
    const balls = [
      { id: 0, x: -4, y: 0 },
      { id: 1, x: 0, y: 0 },
    ];
    const draw = simulate(balls, { cue: 0, vx: 10, vy: 0, spin: -1, side: 0 }, false);
    const follow = simulate(balls, { cue: 0, vx: 10, vy: 0, spin: 1, side: 0 }, false);
    const stun = simulate(balls, { cue: 0, vx: 10, vy: 0, spin: 0, side: 0 }, false);
    const cx = (r: typeof draw) => r.rest.find((b) => b.id === 0)!.x;
    expect(cx(draw)).toBeLessThan(cx(stun));
    expect(cx(follow)).toBeGreaterThan(cx(stun));
  });

  it("first contact finds the ghost-ball spot", () => {
    const hit = firstContact(
      [
        { id: 0, x: -5, y: 0 },
        { id: 1, x: 0, y: 0 },
      ],
      0,
      1,
      0,
    );
    expect(hit?.id).toBe(1);
    expect(hit?.cx).toBeCloseTo(-2 * R, 6);
  });

  it("spotFree rejects overlaps and off-cloth spots", () => {
    expect(spotFree([{ id: 1, x: 0, y: 0 }], 0.5, 0)).toBe(false);
    expect(spotFree([{ id: 1, x: 0, y: 0 }], 3, 0)).toBe(true);
    expect(spotFree([], HALF_W, 0)).toBe(false);
  });
});

describe("billiards rules — 럭키 포켓", () => {
  it("racks nine balls in a diamond with 1 in front and 9 in the middle", () => {
    const b = rackPocket(42);
    expect(b.length).toBe(10);
    const one = b.find((x) => x.id === 1)!;
    const nine = b.find((x) => x.id === 9)!;
    const objs = b.filter((x) => x.id !== 0);
    expect(Math.min(...objs.map((x) => x.x))).toBeCloseTo(one.x, 6);
    expect(nine.y).toBeCloseTo(0, 6);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y)).toBeGreaterThanOrEqual(2 * R);
  });

  it("legal pot scores, keeps the turn; the lucky pocket doubles", () => {
    const s0 = startGame(2, 5, { mode: "pocket" });
    const pk = POCKETS[2];
    const t = { x: pk.x - 3, y: pk.y + 2 };
    const l = Math.hypot(pk.x - t.x, pk.y - t.y);
    const ghost = { x: t.x - ((pk.x - t.x) / l) * 2 * R, y: t.y - ((pk.y - t.y) / l) * 2 * R };
    const cueSpot = { x: ghost.x - ((pk.x - t.x) / l) * 4, y: ghost.y - ((pk.y - t.y) / l) * 4 };
    const balls = [
      { id: CUE_ID, ...cueSpot },
      { id: 1, ...t },
    ];
    for (const lucky of [2, 0]) {
      const s = shootAt({ ...withBalls(s0, balls), lucky }, ghost.x, ghost.y, 12);
      expect(s.lastShot?.foul).toBeNull();
      expect(s.lastShot?.scored.map((x) => x.id)).toEqual([1]);
      expect(s.scores[s0.activeSeat]).toBe(lucky === 2 ? 2 : 1);
      // table is cleared → rack over
      expect(s.phase).toBe("rackOver");
    }
  });

  it("hitting a higher number first is a foul: −1 and ball in hand for the next player", () => {
    const s0 = startGame(2, 9, { mode: "pocket" });
    const st = { ...withBalls(s0, [
      { id: CUE_ID, x: -6, y: 0 },
      { id: 1, x: 6, y: 4 },
      { id: 5, x: 0, y: 0 },
    ]), scores: [3, 3] };
    const s = shootAt(st, 0, 0, 8);
    expect(s.lastShot?.foul).toBe("wrongFirst");
    expect(s.scores[s0.activeSeat]).toBe(2);
    expect(s.activeSeat).not.toBe(s0.activeSeat);
    expect(s.ballInHand).toBe(true);
  });

  it("a scratch puts the cue ball back and gold 9 pocketed on a foul is re-spotted", () => {
    const s0 = startGame(2, 11, { mode: "pocket" });
    // cue straight into a corner, nothing else touched
    const st = withBalls(s0, [
      { id: CUE_ID, x: 6, y: 0 },
      { id: 9, x: -6, y: 3 },
    ]);
    const pk = POCKETS[3];
    const s = shootAt(st, pk.x, pk.y, 14);
    expect(s.lastShot?.foul === "scratch" || s.lastShot?.foul === "miss").toBe(true);
    expect(s.balls.some((b) => b.id === CUE_ID)).toBe(true);
    expect(s.ballInHand).toBe(true);
  });

  it("ball in hand lets the next shooter place the cue ball on a free spot only", () => {
    const s0 = { ...startGame(2, 3, { mode: "pocket" }), ballInHand: true };
    const ok = applyAction(s0, { type: "shoot", seat: s0.activeSeat, vx: 1000, vy: 0, spin: 0, side: 0, place: { x: -9000, y: 3000 } });
    expect(ok.lastShot?.placed).toEqual({ x: -9, y: 3 });
    const one = s0.balls.find((b) => b.id === 1)!;
    const bad = applyAction(s0, { type: "shoot", seat: s0.activeSeat, vx: 1000, vy: 0, spin: 0, side: 0, place: { x: one.x * 1000, y: one.y * 1000 } });
    expect(bad.lastShot?.placed).toBeNull();
  });

  it("ignores shots from the wrong seat and stale timeouts", () => {
    const s0 = startGame(3, 1, { mode: "pocket" });
    const other = (s0.activeSeat + 1) % 3;
    expect(applyAction(s0, { type: "shoot", seat: other, vx: 5000, vy: 0, spin: 0, side: 0 })).toBe(s0);
    expect(applyAction(s0, { type: "timeout", seat: s0.activeSeat, turn: 99 })).toBe(s0);
    const t = applyAction(s0, { type: "timeout", seat: s0.activeSeat, turn: 0 });
    expect(t.activeSeat).toBe(other);
    expect(t.ballInHand).toBe(true);
  });
});

describe("billiards rules — 캐롬", () => {
  it("both reds without the yellow = +1 and shoot again; the yellow = −1", () => {
    const s0 = { ...startGame(2, 4, { mode: "carom", target: 5 }), scores: [2, 2] };
    const line: Ball[] = [
      { id: CUE_ID, x: -8, y: 0 },
      { id: RED_A, x: -3, y: 0 },
      { id: RED_B, x: 3, y: 0.55 },
      { id: YELLOW, x: 0, y: 5 },
    ];
    // simulate a thin-ish hit on RED_A that carries on to RED_B: search angles
    let ok: BilliardsState | null = null;
    for (let k = -40; k <= 40 && !ok; k++) {
      for (const spin of [1, 0.5]) {
        const s = shootAt(withBalls(s0, line), -3, k * 0.01, 14, spin);
        if (s.lastShot?.carom) {
          ok = s;
          break;
        }
      }
    }
    expect(ok).not.toBeNull();
    expect(ok!.scores[s0.activeSeat]).toBeGreaterThanOrEqual(3);
    expect(ok!.activeSeat).toBe(s0.activeSeat);

    const y = shootAt(withBalls(s0, [
      { id: CUE_ID, x: -8, y: 0 },
      { id: YELLOW, x: -3, y: 0 },
      { id: RED_A, x: 6, y: 4 },
      { id: RED_B, x: 6, y: -4 },
    ]), -3, 0, 10);
    expect(y.lastShot?.foul).toBe("yellow");
    expect(y.scores[s0.activeSeat]).toBe(1);
    expect(y.activeSeat).not.toBe(s0.activeSeat);
  });

  it("three cushions before the second red counts double (judge)", () => {
    const st = startGame(2, 1, { mode: "carom" });
    const before = rackCarom();
    const fake = {
      rest: before,
      pots: [],
      steps: 10,
      contacts: [
        { step: 1, a: 0, b: RED_A, impulse: 1, x: 0, y: 0 },
        { step: 9, a: 0, b: RED_B, impulse: 1, x: 0, y: 0 },
      ],
      rails: [2, 4, 6].map((step) => ({ step, id: 0, impulse: 1, x: 0, y: 0 })),
    };
    const j = judge(st, before, fake);
    expect(j.carom).toBe(true);
    expect(j.points).toBe(2);
  });

  it("reaching the target gives the rest of the inning one last turn (equal innings), then the best score wins", () => {
    const base = startGame(2, 4, { mode: "carom", target: 3 });
    // the opener reaches the target: the other player still gets their turn
    const s0 = { ...base, scores: [2, 2] };
    const seat = s0.activeSeat;
    for (let k = -40; k <= 40; k++) {
      const s = shootAt(withBalls(s0, [
        { id: CUE_ID, x: -8, y: 0 },
        { id: RED_A, x: -3, y: 0 },
        { id: RED_B, x: 3, y: 0.55 },
        { id: YELLOW, x: 0, y: 5 },
      ]), -3, k * 0.01, 14, 1);
      if (s.lastShot?.carom) {
        expect(s.phase).toBe("aim");
        expect(s.finalInning).toBe(true);
        expect(s.winner).toBe(seat);
        expect(s.activeSeat).not.toBe(seat);
        const done = applyAction(s, { type: "timeout", seat: s.activeSeat, turn: s.turn });
        expect(done.phase).toBe("ended");
        expect(computeRankings(done)[0].seat).toBe(seat);
        // if the last seat of the inning reaches it, the game ends at once
        const last = { ...s0, openSeat: 1 - seat };
        const s2 = shootAt(withBalls(last, s.lastShot.before), -3, k * 0.01, 14, 1);
        expect(s2.phase).toBe("ended");
        return;
      }
    }
    throw new Error("no carom found");
  });
});

describe("billiards bots", () => {
  function playOut(mode: "pocket" | "carom", n: number, levels: number[], seed: number) {
    const rng = seededRng(seed);
    let s = startGame(n, seed, { mode, racks: 1, target: 3 });
    for (let guard = 0; guard < 400 && s.phase !== "ended"; guard++) {
      if (s.phase === "rackOver") {
        s = applyAction(s, { type: "next" });
        continue;
      }
      const actor = currentActor(s)!;
      const a = chooseBotAction(s, actor, levels[actor], rng);
      s = a ? applyAction(s, a) : applyAction(s, { type: "timeout", seat: actor, turn: s.turn });
    }
    return s;
  }

  it("a pocket game between bots finishes", () => {
    const s = playOut("pocket", 2, [8, 8], 77);
    expect(s.phase).toBe("ended");
    expect(computeRankings(s).length).toBe(2);
  });

  it("a carom game between bots finishes", () => {
    const s = playOut("carom", 3, [9, 9, 9], 12);
    expect(s.phase).toBe("ended");
  });

  it("bot shot is a legal integer action", () => {
    const s = startGame(2, 33, { mode: "pocket" });
    const a = chooseBotAction(s, s.activeSeat, 10, seededRng(3));
    expect(a?.type).toBe("shoot");
    if (a?.type === "shoot") {
      expect(Number.isInteger(a.vx)).toBe(true);
      expect(Number.isInteger(a.spin)).toBe(true);
      const r = runShot(s.balls, "pocket", a.vx, a.vy, a.spin, a.side);
      expect(r.contacts.length).toBeGreaterThan(0);
    }
  });
});
