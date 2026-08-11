import { describe, expect, it } from "vitest";
import {
  applyAction,
  computeRankings,
  DICE_COUNT,
  FACE_VALUE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  sumKept,
  TILE_MAX,
  TILE_MIN,
  TILES,
  totalWorms,
  startGame,
  wormsOnTile,
  type Face,
  type WormState,
} from "./engine";

function makeState(overrides: Partial<WormState> = {}): WormState {
  return {
    playerCount: 3,
    centerTiles: TILES.map((t) => t.number),
    removedTiles: [],
    stacks: { 0: [], 1: [], 2: [] },
    activeSeat: 0,
    currentRoll: [],
    diceRemaining: DICE_COUNT,
    keptDice: [],
    usedFaces: [],
    turnNumber: 1,
    phase: "rolling",
    winnerSeats: null,
    lastEvent: null,
    ...overrides,
  };
}

describe("startGame — setup", () => {
  it("seeds all 16 tiles (21-36) face-up in the center, nobody's stack, starter within range", () => {
    const state = startGame(4, 1);
    expect(state.centerTiles.slice().sort((a, b) => a - b)).toEqual(TILES.map((t) => t.number));
    expect(state.removedTiles).toEqual([]);
    expect(Object.values(state.stacks).every((s) => s.length === 0)).toBe(true);
    expect(state.activeSeat).toBeGreaterThanOrEqual(0);
    expect(state.activeSeat).toBeLessThan(4);
    expect(state.diceRemaining).toBe(DICE_COUNT);
    expect(state.phase).toBe("rolling");
  });

  it("is deterministic for a given seed", () => {
    expect(startGame(4, 42)).toEqual(startGame(4, 42));
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(8, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(7);
  });
});

describe("tile data", () => {
  it("has exactly 16 tiles numbered 21-36 with worm counts 1-4 in blocks of 4", () => {
    expect(TILES).toHaveLength(16);
    expect(TILE_MIN).toBe(21);
    expect(TILE_MAX).toBe(36);
    for (const t of TILES) {
      const expectedWorms = Math.floor((t.number - 21) / 4) + 1;
      expect(t.worms).toBe(expectedWorms);
      expect(t.worms).toBeGreaterThanOrEqual(1);
      expect(t.worms).toBeLessThanOrEqual(4);
    }
    expect(wormsOnTile(21)).toBe(1);
    expect(wormsOnTile(24)).toBe(1);
    expect(wormsOnTile(25)).toBe(2);
    expect(wormsOnTile(32)).toBe(3);
    expect(wormsOnTile(36)).toBe(4);
    expect(wormsOnTile(999)).toBe(0); // unknown tile -> 0, doesn't throw
  });
});

describe("sumKept — worm face counts as 5 pips", () => {
  it("sums plain pip faces directly", () => {
    expect(sumKept([1, 2, 3])).toBe(6);
  });
  it("counts a worm die as 5", () => {
    expect(FACE_VALUE.worm).toBe(5);
    expect(sumKept(["worm", "worm", 4])).toBe(14);
  });
});

describe("roll — turn ownership and pending-roll guards", () => {
  it("rejects a roll from a non-active seat", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "roll", seat: 1, seed: 1 });
    expect(next).toBe(state);
  });

  it("rejects rolling again while a roll is still pending a keep", () => {
    const state = makeState({ currentRoll: [1, 2, "worm"], diceRemaining: 5 });
    const next = applyAction(state, { type: "roll", seat: 0, seed: 1 });
    expect(next).toBe(state);
  });

  it("rejects rolling once no dice remain", () => {
    const state = makeState({ diceRemaining: 0 });
    const next = applyAction(state, { type: "roll", seat: 0, seed: 1 });
    expect(next).toBe(state);
  });

  it("rolls exactly `diceRemaining` dice, every value a valid Face", () => {
    const state = makeState({ diceRemaining: 5 });
    const next = applyAction(state, { type: "roll", seat: 0, seed: 12345 });
    expect(next.currentRoll).toHaveLength(5);
    for (const f of next.currentRoll) {
      expect([1, 2, 3, 4, 5, "worm"]).toContain(f);
    }
  });

  it("forces a bust when every rolled face is already used up (no legal `keep` possible)", () => {
    // usedFaces covers all 6 possible faces -> whatever gets rolled, anyKeepable is always false.
    const state = makeState({
      activeSeat: 0,
      diceRemaining: 2,
      usedFaces: [1, 2, 3, 4, 5, "worm"],
      keptDice: [1, 2, 3, 4, 5, "worm"],
      stacks: { 0: [24], 1: [], 2: [] },
      centerTiles: TILES.map((t) => t.number).filter((n) => n !== 24),
    });
    const next = applyAction(state, { type: "roll", seat: 0, seed: 999 });
    expect(next.lastEvent).toMatchObject({ kind: "bustedNoMoves", seat: 0 });
    // Own top tile (24) returned to center, then the new highest center tile flipped face-down.
    expect(next.stacks[0]).toEqual([]);
    expect(next.centerTiles).toContain(24);
    expect(next.removedTiles).toEqual([36]);
    expect(next.centerTiles).not.toContain(36);
    // Turn passed on, per-turn scratch state reset.
    expect(next.activeSeat).toBe(1);
    expect(next.diceRemaining).toBe(DICE_COUNT);
    expect(next.usedFaces).toEqual([]);
  });
});

describe("keep — duplicate-face lockout and face-matching", () => {
  it("rejects keeping a face not present in the current roll", () => {
    const state = makeState({ currentRoll: [1, 2, 3] });
    const next = applyAction(state, { type: "keep", seat: 0, face: "worm" });
    expect(next).toBe(state);
  });

  it("rejects keeping with nothing rolled yet", () => {
    const state = makeState({ currentRoll: [] });
    const next = applyAction(state, { type: "keep", seat: 0, face: 1 });
    expect(next).toBe(state);
  });

  it("rejects a non-active seat's keep", () => {
    const state = makeState({ activeSeat: 0, currentRoll: [1, 2] });
    const next = applyAction(state, { type: "keep", seat: 1, face: 1 });
    expect(next).toBe(state);
  });

  it("moves every matching die into keptDice, marks the face used, clears currentRoll", () => {
    const state = makeState({ currentRoll: [3, 3, 1, "worm"], diceRemaining: 4 });
    const next = applyAction(state, { type: "keep", seat: 0, face: 3 });
    expect(next.keptDice).toEqual([3, 3]);
    expect(next.usedFaces).toEqual([3]);
    expect(next.currentRoll).toEqual([]);
    expect(next.diceRemaining).toBe(2);
  });

  it("rejects re-keeping a face already used this turn, even if it reappears in a later roll", () => {
    const kept = makeState({ currentRoll: [3, 3, 1, "worm"], diceRemaining: 4 });
    const afterFirstKeep = applyAction(kept, { type: "keep", seat: 0, face: 3 });
    // Simulate a fresh roll of the remaining dice that happens to show a 3 again.
    const rerolled = { ...afterFirstKeep, currentRoll: [3, "worm"] as Face[] };
    const blocked = applyAction(rerolled, { type: "keep", seat: 0, face: 3 });
    expect(blocked).toBe(rerolled); // no-op: face 3 is locked out for the rest of this turn
  });
});

describe("stop — worm requirement", () => {
  it("rejects stopping before anything has been kept", () => {
    const state = makeState({ usedFaces: [] });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next).toBe(state);
  });

  it("rejects stopping while a roll is still pending a keep", () => {
    const state = makeState({ usedFaces: [1], keptDice: [1], currentRoll: [2, 3] });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next).toBe(state);
  });

  it("busts if the kept dice never included a worm, even with a valid-looking sum", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: [4, 3],
      keptDice: [4, 4, 3], // sum 11, no worm
      stacks: { 0: [], 1: [], 2: [] },
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.lastEvent).toMatchObject({ kind: "bustedNoWorm", seat: 0, sum: 11 });
    expect(next.activeSeat).toBe(1); // turn passed
  });
});

describe("stop — claiming from the center", () => {
  it("claims the exact-match center tile", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: ["worm"],
      keptDice: ["worm", "worm", "worm", "worm", "worm"], // sum 25
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.lastEvent).toEqual({ kind: "claimed", seat: 0, tileNumber: 25 });
    expect(next.stacks[0]).toEqual([25]);
    expect(next.centerTiles).not.toContain(25);
  });

  it("falls back to the highest center tile strictly below the sum when there's no exact match", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: ["worm"],
      keptDice: ["worm", "worm", "worm", "worm"], // sum 20 — below every tile (21-36)
      centerTiles: [21, 22, 23], // no exact 20; nothing below 20 either -> should bust (covered separately)
    });
    // Adjust to a sum that DOES have tiles below it but no exact match.
    const state2 = { ...state, keptDice: ["worm", "worm", "worm", "worm", 3] as Face[], centerTiles: [21, 22, 30, 31] };
    const sum = sumKept(state2.keptDice); // 5*4 + 3 = 23, no exact 23 in center
    expect(sum).toBe(23);
    const next = applyAction(state2, { type: "stop", seat: 0 });
    expect(next.lastEvent).toEqual({ kind: "claimed", seat: 0, tileNumber: 22 }); // highest tile < 23
    expect(next.stacks[0]).toEqual([22]);
    expect(next.centerTiles).not.toContain(22);
  });

  it("busts when the sum is below every remaining center tile (no valid claim target)", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: ["worm"],
      keptDice: ["worm", "worm", "worm", "worm"], // sum 20
      centerTiles: [21, 22, 23],
      stacks: { 0: [], 1: [], 2: [] },
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.lastEvent).toMatchObject({ kind: "bustedNoClaimTarget", seat: 0, sum: 20 });
  });
});

describe("stop — stealing an opponent's top tile", () => {
  it("steals the exact-match tile off an opponent's stack top when the center has no exact match", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: ["worm"],
      keptDice: ["worm", "worm", "worm", "worm", "worm"], // sum 25
      centerTiles: TILES.map((t) => t.number).filter((n) => n !== 25), // 25 is NOT in the center...
      stacks: { 0: [], 1: [21, 25], 2: [] }, // ...it's on top of seat 1's stack instead
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.lastEvent).toEqual({ kind: "stolen", seat: 0, tileNumber: 25, fromSeat: 1 });
    expect(next.stacks[0]).toEqual([25]);
    expect(next.stacks[1]).toEqual([21]); // 21 stays, only the top (25) is taken
  });

  it("cannot steal a tile that is buried (not the top of a stack)", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: ["worm"],
      keptDice: ["worm", "worm", "worm", "worm", "worm"], // sum 25
      centerTiles: TILES.map((t) => t.number).filter((n) => n !== 25 && n !== 26),
      stacks: { 0: [], 1: [25, 26], 2: [] }, // 25 is buried under 26 -> unreachable
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    // No exact match anywhere reachable; falls back to highest center tile below 25.
    expect(next.lastEvent).toMatchObject({ kind: "claimed", seat: 0 });
    expect((next.lastEvent as { tileNumber: number }).tileNumber).toBeLessThan(25);
    expect(next.stacks[1]).toEqual([25, 26]); // untouched
  });
});

describe("stop — bust resolution (literal two-step: return own top tile, then flip current-highest center tile)", () => {
  it("returns the busting player's own top tile to the center before flipping the highest one down", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: [4],
      keptDice: [4, 4], // sum 8, no worm -> guaranteed bust
      stacks: { 0: [24], 1: [], 2: [] },
      centerTiles: [21, 22, 23, 30, 31],
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.stacks[0]).toEqual([]); // 24 returned
    expect(next.removedTiles).toEqual([31]); // highest AFTER the return (24 < 31) gets flipped
    expect(next.centerTiles.slice().sort((a, b) => a - b)).toEqual([21, 22, 23, 24, 30]);
  });

  it("a returned tile that becomes the new highest gets immediately flipped back out (literal spec reading)", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: [4],
      keptDice: [4, 4],
      stacks: { 0: [36], 1: [], 2: [] }, // 36 is the highest possible tile
      centerTiles: [21, 22],
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.stacks[0]).toEqual([]);
    expect(next.removedTiles).toEqual([36]); // returned, then immediately re-flipped — net no-op for the center
    expect(next.centerTiles.slice().sort((a, b) => a - b)).toEqual([21, 22]);
  });

  it("has nothing to return when the busting player's stack is empty — only the center flip happens", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: [4],
      keptDice: [4, 4],
      stacks: { 0: [], 1: [], 2: [] },
      centerTiles: [21, 22, 30],
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.stacks[0]).toEqual([]);
    expect(next.removedTiles).toEqual([30]);
    expect(next.centerTiles.slice().sort((a, b) => a - b)).toEqual([21, 22]);
  });
});

describe("game over — center exhausted, winner by total worm count", () => {
  it("ends the game the instant the last center tile is claimed, ranking by total worms", () => {
    const state = makeState({
      activeSeat: 0,
      usedFaces: ["worm"],
      keptDice: ["worm", "worm", "worm", "worm", "worm"], // sum 25
      centerTiles: [25], // the last tile left anywhere in the game
      stacks: { 0: [21, 22], 1: [23, 24], 2: [] }, // seat0: 1+1=2 worms, seat1: 1+1=2 worms (pre-claim)
    });
    const next = applyAction(state, { type: "stop", seat: 0 });
    expect(next.centerTiles).toEqual([]);
    expect(next.phase).toBe("gameOver");
    // seat 0 now holds 21,22,25 -> worms 1+1+2 = 4, the sole winner.
    expect(totalWorms(next, 0)).toBe(4);
    expect(next.winnerSeats).toEqual([0]);
  });

  it("computeRankings shares a rank across tied total worm counts", () => {
    const state = makeState({
      phase: "gameOver",
      centerTiles: [],
      stacks: { 0: [21, 25], 1: [22, 26], 2: [36] }, // seat0: 1+2=3, seat1: 1+2=3, seat2: 4
    });
    const rankings = computeRankings(state);
    const bySeat = Object.fromEntries(rankings.map((r) => [r.seat, r]));
    expect(bySeat[2]).toEqual({ seat: 2, rank: 1, worms: 4 });
    expect(bySeat[0].rank).toBe(2);
    expect(bySeat[1].rank).toBe(2); // tied with seat 0, same rank
    expect(bySeat[0].worms).toBe(3);
    expect(bySeat[1].worms).toBe(3);
  });
});

describe("full turn integration via applyAction (roll -> keep -> keep -> stop)", () => {
  it("plays a deterministic turn end to end from a real seed", () => {
    let state = startGame(3, 7);
    state = { ...state, activeSeat: 0 };
    state = applyAction(state, { type: "roll", seat: 0, seed: 2024 });
    expect(state.currentRoll).toHaveLength(DICE_COUNT);

    // Keep the first distinct face that shows up.
    const firstFace = state.currentRoll[0];
    const before = state;
    state = applyAction(state, { type: "keep", seat: 0, face: firstFace });
    expect(state.usedFaces).toEqual([firstFace]);
    expect(state.diceRemaining).toBeLessThan(DICE_COUNT);
    expect(state).not.toBe(before);

    // Re-keeping the same face is now blocked even after a fresh roll.
    if (state.diceRemaining > 0) {
      state = applyAction(state, { type: "roll", seat: 0, seed: 55 });
      const rejected = applyAction(state, { type: "keep", seat: 0, face: firstFace });
      if (state.currentRoll.includes(firstFace)) {
        expect(rejected).toBe(state);
      }
    }
  });
});
