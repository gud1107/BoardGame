import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  computeRankings,
  currentSide,
  currentThrower,
  fgzThrows,
  measure,
  startGame,
  stonesPerSide,
  TIMEOUT_THROW,
  type CurlingState,
  type EngineAction,
} from "./engine";
import { planBotThrow, recordBotSweeps } from "./bot";
import { BACK_Y, HOG_Y, restingPoint, runThrow, STONE_R, weightForTravel, type Stone } from "./physics";

const stone = (id: number, side: number, x: number, y: number, kind: Stone["kind"] = null): Stone => ({ id, side, x, y, angle: 0, kind });

function throwAction(s: CurlingState, aim: number, weight: number, spin: 1 | -1 = 1, extra: Partial<EngineAction & { type: "throw" }> = {}): EngineAction {
  return { type: "throw", seat: currentThrower(s)!, turn: s.turn, aim, weight, spin, useCard: false, own: [], opp: [], ...extra } as EngineAction;
}

/** Aim that brings a lone no-sweep draw to rest nearest (tx, ty) at this weight. */
function aimFor(tx: number, weight: number, spin: 1 | -1 = 1): number {
  let best = 0;
  let err = Infinity;
  for (let a = -2.2; a <= 2.2; a += 0.01) {
    const r = restingPoint({ aim: a, weight, spin, kind: null });
    if (Math.abs(r.x - tx) < err) {
      err = Math.abs(r.x - tx);
      best = a;
    }
  }
  return best;
}

describe("setup (§2, §3)", () => {
  it("team mode alternates seats into two sides and the hammer throws last", () => {
    const s = startGame(4, 11);
    expect(s.sides).toBe(2);
    expect(s.members).toEqual([[0, 2], [1, 3]]);
    expect(s.order).toHaveLength(8);
    expect(s.order[7]).toBe(s.hammer);
    expect(s.order[0]).toBe(1 - s.hammer);
    for (let i = 1; i < 8; i++) expect(s.order[i]).not.toBe(s.order[i - 1]);
  });

  it("ffa: every seat is a side; 3 stones each at 3p, 2 each at 4p+", () => {
    const s3 = startGame(3, 5, { mode: "ffa" });
    expect(s3.sides).toBe(3);
    expect(stonesPerSide(s3)).toBe(3);
    expect(s3.order).toHaveLength(9);
    expect(s3.order[8]).toBe(s3.hammer);
    const s5 = startGame(5, 5, { mode: "ffa" });
    expect(s5.order).toHaveLength(10);
  });

  it("ffa falls back to team outside 3–6 players", () => {
    expect(startGame(2, 1, { mode: "ffa" }).options.mode).toBe("team");
    expect(startGame(8, 1, { mode: "ffa" }).options.mode).toBe("team");
  });

  it("free guard zone covers the first round(total×5/16) throws", () => {
    expect(fgzThrows(startGame(4, 1))).toBe(3);
    expect(fgzThrows(startGame(4, 1, { stones: 8 }))).toBe(5);
    expect(fgzThrows(startGame(4, 1, { fgz: false }))).toBe(0);
  });
});

describe("scoring (§9)", () => {
  it("counts every stone closer than the rival's best", () => {
    const m = measure([stone(1, 0, 0, 0.1), stone(2, 0, 0.3, 0.3), stone(3, 1, 0, 0.9), stone(4, 0, 1.2, 0)]);
    expect(m.scorer).toBe(0);
    expect(m.points).toBe(2);
  });

  it("all of a side's house stones count when nobody else is in the house", () => {
    const m = measure([stone(1, 1, 0, 1.5), stone(2, 1, -0.5, 0.2), stone(3, 0, 0, 3.5)]);
    expect(m).toMatchObject({ scorer: 1, points: 2 });
  });

  it("a stone touching the house counts; one fully outside doesn't", () => {
    expect(measure([stone(1, 0, 0, 1.83 + STONE_R - 0.001)]).points).toBe(1);
    expect(measure([stone(1, 0, 0, 1.83 + STONE_R + 0.001)]).points).toBe(0);
  });

  it("an exact tie for shot stone is a blank end", () => {
    expect(measure([stone(1, 0, 0.5, 0), stone(2, 1, -0.5, 0)]).scorer).toBeNull();
  });
});

describe("throws (§4–§8)", () => {
  it("a short stone is removed at the hog line, a long one past the back line", () => {
    let s = startGame(2, 3, { party: false });
    s = applyAction(s, throwAction(s, 0, weightForTravel(20)));
    expect(s.stones).toHaveLength(0);
    expect(s.lastThrow?.call.key).toBe("hog");
    s = applyAction(s, throwAction(s, 0, 1));
    expect(s.stones).toHaveLength(0);
    expect(s.lastThrow?.call.key).toBe("through");
  });

  it("a draw to the tee stays in play and the turn passes to the other side", () => {
    let s = startGame(2, 4, { party: false });
    const side = currentSide(s);
    const w = weightForTravel(28.35);
    s = applyAction(s, throwAction(s, aimFor(0, w), w));
    expect(s.stones).toHaveLength(1);
    expect(Math.abs(s.stones[0].x)).toBeLessThan(0.1);
    expect(currentSide(s)).toBe(1 - side);
    expect(["button", "shot"]).toContain(s.lastThrow?.call.key);
  });

  it("free guard zone: knocking out a protected guard resets the board (§8)", () => {
    let s = startGame(2, 9, { party: false });
    const w = weightForTravel(24.6);
    const aim = aimFor(0, w);
    s = applyAction(s, throwAction(s, aim, w)); // guard by side A
    expect(s.stones).toHaveLength(1);
    const guard = s.stones[0];
    expect(guard.y).toBeGreaterThan(1.9);
    expect(guard.y).toBeLessThan(HOG_Y);
    // side B fires straight at it
    let hit: CurlingState | null = null;
    for (let a = -1.2; a <= 1.2 && !hit; a += 0.01) {
      const t = applyAction(s, throwAction(s, a, 1));
      if (t.lastThrow?.call.key === "fgz") hit = t;
    }
    expect(hit).not.toBeNull();
    expect(hit!.stones).toEqual([guard]);
  });

  it("without the free guard zone the same hit removes the guard", () => {
    let s = startGame(2, 9, { party: false, fgz: false });
    const w = weightForTravel(24.6);
    const aim = aimFor(0, w);
    s = applyAction(s, throwAction(s, aim, w));
    let removed = false;
    for (let a = -1.2; a <= 1.2 && !removed; a += 0.01) {
      const t = applyAction(s, throwAction(s, a, 1));
      removed = t.lastThrow!.call.removedOpp > 0;
    }
    expect(removed).toBe(true);
  });

  it("rival sweep only counts once the stone is past the tee line (§6)", () => {
    const params = { aim: 0, weight: weightForTravel(28.35), spin: 1 as const, kind: null };
    const plain = runThrow([], params, 0, 0);
    const rivalEarly = runThrow([], params, 0, 0, [], Array(60).fill(10));
    expect(rivalEarly.deliveredStone().y).toBe(plain.deliveredStone().y);
    const own = runThrow([], params, 0, 0, Array(200).fill(10));
    expect(own.deliveredStone().out).toBe("back");
  });

  it("stale and out-of-turn actions are ignored", () => {
    const s = startGame(4, 2);
    expect(applyAction(s, { ...throwAction(s, 0, 0.4), turn: s.turn + 1 } as EngineAction)).toBe(s);
    const wrong = (currentThrower(s)! + 1) % 4;
    expect(applyAction(s, { ...throwAction(s, 0, 0.4), seat: wrong } as EngineAction)).toBe(s);
  });

  it("timeout throws the 얼어붙은 손 guard", () => {
    const s = startGame(2, 2, { party: false });
    const t = applyAction(s, { type: "timeout", seat: currentThrower(s)!, turn: s.turn });
    expect(t.lastThrow?.auto).toBe(true);
    expect(t.lastThrow?.params).toMatchObject({ ...TIMEOUT_THROW, kind: null });
    expect(t.stones).toHaveLength(1);
  });

  it("a party stone is spent only when used, and a bomb leaves the sheet", () => {
    let s = startGame(2, 21, { party: true });
    s = { ...s, cards: ["bomb", "bomb"] };
    const side = currentSide(s);
    const w = weightForTravel(28.35);
    s = applyAction(s, throwAction(s, aimFor(0, w), w, 1, { useCard: true }));
    expect(s.cards[side]).toBeNull();
    expect(s.cards[1 - side]).toBe("bomb");
    expect(s.stones).toHaveLength(0);
    expect(s.lastThrow?.call.key).toBe("bomb");
  });

  it("actions survive a JSON round trip bit-for-bit (lockstep)", () => {
    let a = startGame(4, 77);
    let b = startGame(4, 77);
    const rng = seededRng(5);
    for (let i = 0; i < 8; i++) {
      const plan = planBotThrow(a, 4, rng);
      const sw = recordBotSweeps(a, { ...plan, kind: plan.useCard ? a.cards[currentSide(a)] : null }, { own: 5, opp: 5 }, rng);
      const act: EngineAction = { type: "throw", seat: currentThrower(a)!, turn: a.turn, ...plan, ...sw };
      a = applyAction(a, act);
      b = applyAction(b, JSON.parse(JSON.stringify(act)));
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("ends and game flow (§9–§12)", () => {
  function playEnd(s: CurlingState, rng: () => number, level = 3): CurlingState {
    let g = s;
    for (let guard = 0; guard < 40 && g.phase === "aim"; guard++) {
      const plan = planBotThrow(g, level, rng);
      g = applyAction(g, { type: "throw", seat: currentThrower(g)!, turn: g.turn, ...plan, own: [], opp: [] });
    }
    return g;
  }

  it("scorer throws first next end; a blank end keeps the hammer", () => {
    const rng = seededRng(8);
    let s = playEnd(startGame(2, 31, { party: false }), rng);
    expect(s.phase).toBe("scored");
    const rec = s.history[0];
    const next = applyAction(s, { type: "next", turn: s.turn });
    if (rec.scorer === null) expect(next.hammer).toBe(s.hammer);
    else expect(next.order[0]).toBe(rec.scorer);
    expect(next.stones).toHaveLength(0);
    expect(next.end).toBe(1);
    s = next;
  });

  it("a tie after the last end plays one extra end, then shares the rank", () => {
    let s = startGame(2, 1, { ends: 1, party: false });
    s = { ...s, phase: "scored", scores: [2, 2], history: [{ end: 0, scorer: null, points: 0, counting: [], stones: [], hammer: 0, extra: false }] };
    const extra = applyAction(s, { type: "next", turn: s.turn });
    expect(extra.phase).toBe("aim");
    expect(extra.extraEnds).toBe(1);
    const tied = { ...extra, phase: "scored" as const, scores: [3, 3] };
    const done = applyAction(tied, { type: "next", turn: tied.turn });
    expect(done.phase).toBe("ended");
    expect(computeRankings(done).map((r) => r.rank)).toEqual([1, 1]);
  });

  it.each([
    [2, "team"],
    [5, "team"],
    [4, "ffa"],
  ] as const)("a whole %ip %s game with bots finishes with sane rankings", (n, mode) => {
    const rng = seededRng(n * 13);
    let s = startGame(n, 1234 + n, { mode, ends: 1, party: true });
    for (let guard = 0; guard < 10 && s.phase !== "ended"; guard++) {
      s = playEnd(s, rng, 2);
      if (s.phase === "scored") s = applyAction(s, { type: "next", turn: s.turn });
    }
    expect(s.phase).toBe("ended");
    const r = computeRankings(s);
    expect(r).toHaveLength(n);
    expect(r[0].rank).toBe(1);
    expect(s.history.length).toBeGreaterThanOrEqual(1);
    for (const st of s.stones) expect(st.y).toBeGreaterThan(BACK_Y - STONE_R);
  }, 60_000);
});
