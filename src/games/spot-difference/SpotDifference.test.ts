import { describe, expect, it } from "vitest";
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  computeTeamRankings,
  computeTeamScores,
  defaultTeamAssignment,
  foundSpotCount,
  generatePhotoDiffSpots,
  getValidMoves,
  HINTS_PER_TEAM,
  MAX_PHOTO_DIFFS,
  MIN_PHOTO_DIFFS,
  startGame,
  totalSpotCount,
  WRONG_CLICK_PENALTY_MS,
  type EngineAction,
  type SpotDifferenceState,
} from "./engine";
import { BUILTIN_SCENES } from "./scenes";

function freshState(overrides: Partial<Parameters<typeof startGame>[2]> = {}): SpotDifferenceState {
  return startGame(4, 42, { source: { kind: "builtin" }, stageCount: 1, ...overrides });
}

describe("startGame", () => {
  it("assigns alternating teams and seeds exactly one stage's worth of spots by default", () => {
    const state = freshState();
    expect(state.teamOf).toEqual({ 0: "A", 1: "B", 2: "A", 3: "B" });
    expect(state.stages).toHaveLength(1);
    expect(state.stages[0].spots).toHaveLength(5); // every built-in scene ships exactly 5 diffs
    expect(state.hints).toEqual({ A: HINTS_PER_TEAM, B: HINTS_PER_TEAM });
    expect(state.phase).toBe("playing");
  });

  it("chains multiple distinct built-in scenes when stageCount > 1", () => {
    const state = freshState({ stageCount: 3 });
    expect(state.stages).toHaveLength(3);
    expect(new Set(state.builtinSceneIds).size).toBe(3); // no repeats
    for (const id of state.builtinSceneIds) {
      expect(BUILTIN_SCENES.some((s) => s.id === id)).toBe(true);
    }
  });

  it("clamps stageCount to the number of available scenes", () => {
    const state = freshState({ stageCount: 999 });
    expect(state.stages).toHaveLength(BUILTIN_SCENES.length);
  });

  it("generates the requested number of photo-mode diff spots, clamped to the allowed range", () => {
    const low = startGame(2, 1, { source: { kind: "photo", imageDataUrl: "data:x" }, diffCount: 1 });
    expect(low.stages[0].spots).toHaveLength(MIN_PHOTO_DIFFS);
    const high = startGame(2, 1, { source: { kind: "photo", imageDataUrl: "data:x" }, diffCount: 999 });
    expect(high.stages[0].spots).toHaveLength(MAX_PHOTO_DIFFS);
  });

  it("rejects out-of-range player counts", () => {
    expect(() => startGame(1, 1, { source: { kind: "builtin" } })).toThrow();
    expect(() => startGame(9, 1, { source: { kind: "builtin" } })).toThrow();
  });
});

describe("generatePhotoDiffSpots", () => {
  it("is deterministic for a given seed and count", () => {
    const a = generatePhotoDiffSpots(777, 6);
    const b = generatePhotoDiffSpots(777, 6);
    expect(a).toEqual(b);
  });

  it("keeps every spot within the safe interior margin and produces the requested count", () => {
    const spots = generatePhotoDiffSpots(123, 8);
    expect(spots).toHaveLength(8);
    for (const s of spots) {
      expect(s.xPct).toBeGreaterThanOrEqual(12);
      expect(s.xPct).toBeLessThanOrEqual(88);
      expect(s.yPct).toBeGreaterThanOrEqual(12);
      expect(s.yPct).toBeLessThanOrEqual(88);
    }
  });

  it("never places two spots close enough for their tolerance circles to overlap", () => {
    const spots = generatePhotoDiffSpots(55, 10);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dist = Math.hypot(spots[i].xPct - spots[j].xPct, spots[i].yPct - spots[j].yPct);
        expect(dist).toBeGreaterThanOrEqual((spots[i].rPct + spots[j].rPct) * 1.4);
      }
    }
  });
});

describe("click hit detection", () => {
  it("registers a hit exactly at a spot's center and credits the clicking seat's team", () => {
    const state = freshState();
    const spot = state.stages[0].spots[0];
    const next = applyAction(state, { type: "click", seat: 0, xPct: spot.xPct, yPct: spot.yPct, atMs: 1000 });
    expect(next.stages[0].foundBy[spot.id]).toBe("A");
  });

  it("registers a hit anywhere within the tolerance radius, not just dead-center", () => {
    const state = freshState();
    const spot = state.stages[0].spots[0];
    const edgeX = spot.xPct + spot.rPct * 0.9; // just inside the circle
    const next = applyAction(state, { type: "click", seat: 1, xPct: edgeX, yPct: spot.yPct, atMs: 1000 });
    expect(next.stages[0].foundBy[spot.id]).toBe("B");
  });

  it("does not register a hit just outside the tolerance radius", () => {
    const state = freshState();
    const spot = state.stages[0].spots[0];
    const outsideX = spot.xPct + spot.rPct * 1.5;
    const next = applyAction(state, { type: "click", seat: 0, xPct: outsideX, yPct: spot.yPct, atMs: 1000 });
    expect(next.stages[0].foundBy[spot.id]).toBeUndefined();
    expect(next.penalties[0]).toBe(1000 + WRONG_CLICK_PENALTY_MS); // counted as a wrong click
  });

  it("ignores a second click on an already-found spot (no double-credit, no penalty)", () => {
    const state = freshState();
    const spot = state.stages[0].spots[0];
    const found = applyAction(state, { type: "click", seat: 0, xPct: spot.xPct, yPct: spot.yPct, atMs: 1000 });
    const again = applyAction(found, { type: "click", seat: 1, xPct: spot.xPct, yPct: spot.yPct, atMs: 2000 });
    expect(foundSpotCount(again)).toBe(1);
    expect(again.penalties[1]).toBeUndefined();
  });
});

describe("team score aggregation and win condition", () => {
  it("sums every found spot per team across the whole match", () => {
    const state = freshState();
    const spots = state.stages[0].spots;
    let s = state;
    s = applyAction(s, { type: "click", seat: 0, xPct: spots[0].xPct, yPct: spots[0].yPct, atMs: 1 }); // team A
    s = applyAction(s, { type: "click", seat: 2, xPct: spots[1].xPct, yPct: spots[1].yPct, atMs: 2 }); // team A
    s = applyAction(s, { type: "click", seat: 1, xPct: spots[2].xPct, yPct: spots[2].yPct, atMs: 3 }); // team B
    expect(computeTeamScores(s)).toEqual({ A: 2, B: 1 });
  });

  it("declares the team with more finds the winner when the timer runs out", () => {
    const state = freshState();
    const spots = state.stages[0].spots;
    let s = state;
    s = applyAction(s, { type: "click", seat: 0, xPct: spots[0].xPct, yPct: spots[0].yPct, atMs: 1 });
    s = applyAction(s, { type: "click", seat: 0, xPct: spots[1].xPct, yPct: spots[1].yPct, atMs: 2 });
    s = applyAction(s, { type: "click", seat: 1, xPct: spots[2].xPct, yPct: spots[2].yPct, atMs: 3 });
    s = applyAction(s, { type: "timeUp" });
    expect(s.phase).toBe("gameOver");
    const ranked = computeTeamRankings(s);
    expect(ranked[0]).toEqual({ team: "A", rank: 1, score: 2 });
    expect(ranked[1]).toEqual({ team: "B", rank: 2, score: 1 });
  });

  it("ends the match immediately once every stage's every spot is found, before the timer expires", () => {
    const state = freshState();
    const spots = state.stages[0].spots;
    let s = state;
    for (let i = 0; i < spots.length; i++) {
      s = applyAction(s, { type: "click", seat: 0, xPct: spots[i].xPct, yPct: spots[i].yPct, atMs: i + 1 });
    }
    expect(s.phase).toBe("gameOver");
    expect(s.timeUp).toBe(false); // ended by full clear, not the clock
  });

  it("treats an equal score at time-up as a genuine co-win for both teams", () => {
    const state = freshState();
    const spots = state.stages[0].spots;
    let s = state;
    s = applyAction(s, { type: "click", seat: 0, xPct: spots[0].xPct, yPct: spots[0].yPct, atMs: 1 });
    s = applyAction(s, { type: "click", seat: 1, xPct: spots[1].xPct, yPct: spots[1].yPct, atMs: 2 });
    s = applyAction(s, { type: "timeUp" });
    const ranked = computeTeamRankings(s);
    expect(ranked.every((r) => r.rank === 1)).toBe(true);
    const seatRanks = computeRankings(s);
    expect(seatRanks.every((r) => r.rank === 1)).toBe(true);
  });

  it("ignores actions once the game is over", () => {
    const state = freshState();
    const done = applyAction(state, { type: "timeUp" });
    const spot = state.stages[0].spots[0];
    const after = applyAction(done, { type: "click", seat: 0, xPct: spot.xPct, yPct: spot.yPct, atMs: 5000 });
    expect(after).toEqual(done);
  });
});

describe("wrong-answer penalty lock", () => {
  it("locks the clicking seat for WRONG_CLICK_PENALTY_MS after a miss", () => {
    const state = freshState();
    const missed = applyAction(state, { type: "click", seat: 0, xPct: 1, yPct: 1, atMs: 1000 });
    expect(missed.penalties[0]).toBe(1000 + WRONG_CLICK_PENALTY_MS);
  });

  it("ignores further clicks from that seat while still locked, even a click on a real spot", () => {
    const state = freshState();
    let s = applyAction(state, { type: "click", seat: 0, xPct: 1, yPct: 1, atMs: 1000 });
    const spot = s.stages[0].spots[0];
    // Still inside the 2s lockout window.
    s = applyAction(s, { type: "click", seat: 0, xPct: spot.xPct, yPct: spot.yPct, atMs: 1500 });
    expect(s.stages[0].foundBy[spot.id]).toBeUndefined();
    expect(s.penalties[0]).toBe(1000 + WRONG_CLICK_PENALTY_MS); // unchanged, not re-armed
  });

  it("allows the seat to click again once the lockout window has elapsed", () => {
    const state = freshState();
    let s = applyAction(state, { type: "click", seat: 0, xPct: 1, yPct: 1, atMs: 1000 });
    const spot = s.stages[0].spots[0];
    s = applyAction(s, {
      type: "click",
      seat: 0,
      xPct: spot.xPct,
      yPct: spot.yPct,
      atMs: 1000 + WRONG_CLICK_PENALTY_MS,
    });
    expect(s.stages[0].foundBy[spot.id]).toBe("A");
  });

  it("does not lock out other seats on a miss, only the one who clicked", () => {
    const state = freshState();
    const s = applyAction(state, { type: "click", seat: 0, xPct: 1, yPct: 1, atMs: 1000 });
    expect(s.penalties[1]).toBeUndefined();
  });
});

describe("hints", () => {
  it("reveals an undiscovered spot for the team and decrements their remaining hint count", () => {
    const state = freshState();
    const s = applyAction(state, { type: "useHint", team: "A", atMs: 1 });
    expect(s.hints.A).toBe(HINTS_PER_TEAM - 1);
    expect(s.activeHint).not.toBeNull();
    expect(s.stages[0].spots.some((sp) => sp.id === s.activeHint!.spotId)).toBe(true);
  });

  it("does nothing once a team has used all of its hints", () => {
    let s = freshState();
    for (let i = 0; i < HINTS_PER_TEAM; i++) s = applyAction(s, { type: "useHint", team: "B", atMs: i });
    expect(s.hints.B).toBe(0);
    const after = applyAction(s, { type: "useHint", team: "B", atMs: 999 });
    expect(after).toEqual(s);
  });

  it("clears the active hint once its spot is found", () => {
    let s = applyAction(freshState(), { type: "useHint", team: "A", atMs: 1 });
    const hintedSpot = s.stages[0].spots.find((sp) => sp.id === s.activeHint!.spotId)!;
    s = applyAction(s, { type: "click", seat: 0, xPct: hintedSpot.xPct, yPct: hintedSpot.yPct, atMs: 2 });
    expect(s.activeHint).toBeNull();
  });
});

describe("defaultTeamAssignment / totalSpotCount", () => {
  it("alternates seats between team A and B", () => {
    expect(defaultTeamAssignment(5)).toEqual({ 0: "A", 1: "B", 2: "A", 3: "B", 4: "A" });
  });

  it("counts total spots across every stage", () => {
    const state = freshState({ stageCount: 2 });
    expect(totalSpotCount(state)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty) — this game's
// real-time free-for-all genre exception is documented in engine.ts's
// bot-support module doc.
// ---------------------------------------------------------------------------

/** Replaces stage 0 with 3 hand-picked spots, well clear of each other and of the synthetic (2,2) miss target, for fully controlled bot tests. */
function customSpotsState(): SpotDifferenceState {
  const base = freshState({});
  const spots = [
    { id: "s0", xPct: 20, yPct: 20, rPct: 5 },
    { id: "s1", xPct: 50, yPct: 50, rPct: 5 },
    { id: "s2", xPct: 80, yPct: 80, rPct: 5 },
  ];
  return { ...base, stages: [{ spots, foundBy: {} }], currentStageIndex: 0 };
}

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("offers one click per undiscovered spot plus the synthetic miss candidate", () => {
    const state = customSpotsState();
    const moves = getValidMoves(state, 0, 0);
    expect(moves).toHaveLength(4); // 3 spots + 1 miss
    expect(moves.every((m) => m.type === "click" && m.seat === 0)).toBe(true);
  });

  it("excludes spots already found by either team", () => {
    let state = customSpotsState();
    state = applyAction(state, { type: "click", seat: 0, xPct: 20, yPct: 20, atMs: 0 });
    const moves = getValidMoves(state, 1, 100);
    expect(moves).toHaveLength(3); // 2 remaining spots + 1 miss
  });

  it("returns [] while a seat is penalty-locked", () => {
    let state = customSpotsState();
    state = applyAction(state, { type: "click", seat: 0, xPct: 2, yPct: 2, atMs: 0 }); // wrong click -> locked until 2000
    expect(getValidMoves(state, 0, 500)).toEqual([]);
    expect(getValidMoves(state, 0, 2500)).not.toEqual([]); // lock has expired
  });

  it("returns [] outside the 'playing' phase", () => {
    const state = { ...customSpotsState(), phase: "gameOver" as const };
    expect(getValidMoves(state, 0, 0)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("always returns a legal move regardless of level", () => {
    const state = customSpotsState();
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5, 0);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) clicks the first-listed spot, while Level 10 prioritizes its team's actively-hinted spot", () => {
    // seat 0 is on team A (defaultTeamAssignment). An active hint points at
    // "s2" — not the first spot in stage order — so Level 10's argmax must
    // beat every other equally-legitimate spot to reach it, while Level 1's
    // forced-random path (rng always 0 -> candidates[0]) lands on "s0".
    const state = { ...customSpotsState(), activeHint: { team: "A" as const, spotId: "s2" } };

    const level1Action = chooseBotAction(state, 0, 1, () => 0, 0);
    expect(level1Action).toEqual({ type: "click", seat: 0, xPct: 20, yPct: 20, atMs: 0 });

    const level10Action = chooseBotAction(state, 0, 10, () => 0, 0);
    expect(level10Action).toEqual({ type: "click", seat: 0, xPct: 80, yPct: 80, atMs: 0 });
  });
});

function playFullBotGame(
  playerCount: number,
  seed: number,
  stageCount: number,
  levelOf: (seat: number) => number,
): SpotDifferenceState {
  let state = startGame(playerCount, seed, { source: { kind: "builtin" }, stageCount });
  let atMs = 0;
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 500) {
    guard++;
    for (let seat = 0; seat < playerCount; seat++) {
      const action = chooseBotAction(state, seat, levelOf(seat), Math.random, atMs);
      if (action) state = applyAction(state, action as EngineAction);
      if (state.phase === "gameOver") break;
    }
    atMs += 1000; // advance the wall clock a full second each round, clearing any wrong-click penalty lock
  }
  return state;
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  it("an all-Level-10 team finds every spot without a crash or infinite loop", () => {
    const state = playFullBotGame(4, 900, 1, () => 10);
    expect(state.phase).toBe("gameOver");
    expect(foundSpotCount(state)).toBe(totalSpotCount(state));
  });

  it("also completes with a mixed Level 1 / Level 10 table across multiple stages", () => {
    const state = playFullBotGame(6, 901, 2, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(foundSpotCount(state)).toBe(totalSpotCount(state));
  });
});
