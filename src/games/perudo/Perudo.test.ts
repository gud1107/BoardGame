import { describe, expect, it } from "vitest";
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  countMatching,
  getValidMoves,
  isPalafico,
  MAX_DICE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_DICE,
  startGame,
  totalDiceInPlay,
  validateRaise,
  type Bid,
  type EngineAction,
  type Face,
  type PerudoState,
  type PlayerState,
} from "./engine";

function makeState(overrides: Partial<PerudoState> = {}): PerudoState {
  const players: PlayerState[] = [
    { seat: 0, diceCount: 5, dice: [1, 2, 3, 4, 5] },
    { seat: 1, diceCount: 5, dice: [1, 2, 3, 4, 5] },
    { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
  ];
  return {
    playerCount: 3,
    players,
    currentBid: null,
    activeSeat: 0,
    roundStarter: 0,
    roundNumber: 1,
    phase: "playing",
    lastResolution: null,
    eliminationOrder: [],
    winnerSeat: null,
    ...overrides,
  };
}

describe("startGame — setup", () => {
  it("deals 5 dice to every player and picks a starter within range", () => {
    const state = startGame(4, 1);
    expect(state.players).toHaveLength(4);
    expect(state.players.every((p) => p.diceCount === STARTING_DICE && p.dice.length === STARTING_DICE)).toBe(true);
    expect(state.players.every((p) => p.dice.every((d) => d >= 1 && d <= 6))).toBe(true);
    expect(state.activeSeat).toBeGreaterThanOrEqual(0);
    expect(state.activeSeat).toBeLessThan(4);
    expect(state.roundStarter).toBe(state.activeSeat);
    expect(state.currentBid).toBeNull();
    expect(state.phase).toBe("playing");
    expect(state.roundNumber).toBe(1);
    expect(totalDiceInPlay(state)).toBe(4 * STARTING_DICE);
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(5, 42);
    const b = startGame(5, 42);
    expect(a).toEqual(b);
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(9, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(8);
  });

  it("supports the full 8-player table (extends beyond the physical box's 6 cups)", () => {
    const state = startGame(8, 1);
    expect(state.players).toHaveLength(8);
    expect(totalDiceInPlay(state)).toBe(8 * STARTING_DICE);
  });
});

describe("validateRaise — rulebook §3 formulas", () => {
  it("always accepts the round's opening bid", () => {
    expect(validateRaise(null, { quantity: 1, face: 1 }, false)).toBe(true);
    expect(validateRaise(null, { quantity: 99, face: 6 }, false)).toBe(true);
  });

  it("rejects an out-of-range face or non-positive quantity", () => {
    expect(validateRaise(null, { quantity: 1, face: 0 as Face }, false)).toBe(false);
    expect(validateRaise(null, { quantity: 1, face: 7 as Face }, false)).toBe(false);
    expect(validateRaise(null, { quantity: 0, face: 3 }, false)).toBe(false);
  });

  describe("normal(2-6) -> normal(2-6)", () => {
    const prev: Bid = { seat: 0, quantity: 4, face: 3 };
    it("quantity up, face unchanged or changed — both allowed (rulebook's worked example)", () => {
      expect(validateRaise(prev, { quantity: 5, face: 3 }, false)).toBe(true);
      expect(validateRaise(prev, { quantity: 5, face: 5 }, false)).toBe(true);
    });
    it("same quantity, higher face — allowed", () => {
      expect(validateRaise(prev, { quantity: 4, face: 4 }, false)).toBe(true);
      expect(validateRaise(prev, { quantity: 4, face: 6 }, false)).toBe(true);
    });
    it("same quantity, lower or equal face — rejected", () => {
      expect(validateRaise(prev, { quantity: 4, face: 2 }, false)).toBe(false);
      expect(validateRaise(prev, { quantity: 4, face: 3 }, false)).toBe(false);
    });
    it("lower quantity — always rejected regardless of face", () => {
      expect(validateRaise(prev, { quantity: 3, face: 6 }, false)).toBe(false);
    });
  });

  describe("normal -> 페루도(1)", () => {
    it("rulebook's worked example: 4가 5개 -> 페루도 3개 이상 (ceil(5/2)=3)", () => {
      const prev: Bid = { seat: 0, quantity: 5, face: 4 };
      expect(validateRaise(prev, { quantity: 2, face: 1 }, false)).toBe(false);
      expect(validateRaise(prev, { quantity: 3, face: 1 }, false)).toBe(true);
      expect(validateRaise(prev, { quantity: 4, face: 1 }, false)).toBe(true);
    });
  });

  describe("페루도(1) -> normal", () => {
    it("rulebook's worked example: 페루도 3개 -> 숫자 7개 이상 (3*2+1=7)", () => {
      const prev: Bid = { seat: 0, quantity: 3, face: 1 };
      expect(validateRaise(prev, { quantity: 6, face: 2 }, false)).toBe(false);
      expect(validateRaise(prev, { quantity: 7, face: 2 }, false)).toBe(true);
      expect(validateRaise(prev, { quantity: 7, face: 6 }, false)).toBe(true);
    });
  });

  describe("페루도 -> 페루도", () => {
    it("only a strictly higher quantity is a valid raise", () => {
      const prev: Bid = { seat: 0, quantity: 3, face: 1 };
      expect(validateRaise(prev, { quantity: 3, face: 1 }, false)).toBe(false);
      expect(validateRaise(prev, { quantity: 4, face: 1 }, false)).toBe(true);
    });
  });

  describe("Palafico round (§5) — face locked, quantity-only raises", () => {
    it("rejects any face change even if it would otherwise be a legal raise", () => {
      const prev: Bid = { seat: 0, quantity: 2, face: 3 };
      expect(validateRaise(prev, { quantity: 3, face: 4 }, true)).toBe(false);
      expect(validateRaise(prev, { quantity: 3, face: 1 }, true)).toBe(false);
    });
    it("accepts same-face, higher-quantity raises", () => {
      const prev: Bid = { seat: 0, quantity: 2, face: 3 };
      expect(validateRaise(prev, { quantity: 3, face: 3 }, true)).toBe(true);
      expect(validateRaise(prev, { quantity: 2, face: 3 }, true)).toBe(false);
    });
  });
});

describe("countMatching", () => {
  const players: PlayerState[] = [
    { seat: 0, diceCount: 3, dice: [1, 4, 4] },
    { seat: 1, diceCount: 2, dice: [4, 6] },
  ];
  it("counts 1s (페루도) as wild for any other face when wild=true", () => {
    expect(countMatching(players, 4, true)).toBe(4); // three real 4s + one wild 1
  });
  it("does not apply wilds when wild=false (Palafico rounds)", () => {
    expect(countMatching(players, 4, false)).toBe(3);
  });
  it("counting face 1 itself never double-counts via the wild branch", () => {
    expect(countMatching(players, 1, true)).toBe(1);
  });
});

describe("raise (action)", () => {
  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "raise", seat: 1, quantity: 3, face: 4 });
    expect(next).toEqual(state);
  });

  it("is a no-op for an invalid raise", () => {
    const state = makeState({ activeSeat: 0, currentBid: { seat: 2, quantity: 4, face: 3 } });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 4, face: 2 });
    expect(next).toEqual(state);
  });

  it("updates currentBid and advances to the next alive seat", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 2, face: 3 });
    expect(next.currentBid).toEqual({ seat: 0, quantity: 2, face: 3 });
    expect(next.activeSeat).toBe(1);
  });

  it("skips eliminated seats when advancing", () => {
    const state = makeState({
      activeSeat: 0,
      players: [
        { seat: 0, diceCount: 5, dice: [1, 2, 3, 4, 5] },
        { seat: 1, diceCount: 0, dice: [] },
        { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
      ],
    });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 2, face: 3 });
    expect(next.activeSeat).toBe(2);
  });
});

describe("dudo (페루도!)", () => {
  it("is a no-op without a pending bid", () => {
    const state = makeState({ activeSeat: 1, currentBid: null });
    const next = applyAction(state, { type: "dudo", seat: 1 });
    expect(next).toEqual(state);
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0, currentBid: { seat: 2, quantity: 3, face: 4 } });
    const next = applyAction(state, { type: "dudo", seat: 1 });
    expect(next).toEqual(state);
  });

  it("penalizes the bidder by the exact shortfall when the bid was too high (rulebook §4①: 선언 개수 - 실제 개수)", () => {
    // Table has three 4s + no 1s = 3 actual, but seat 2 bid 5 -> shortfall of 2.
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 5, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [4, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.players.find((p) => p.seat === 2)!.diceCount).toBe(3); // 5 - (5-3) = 3
    expect(next.lastResolution).toMatchObject({ kind: "dudo", actorSeat: 0, affectedSeat: 2, diceDelta: -2, actualCount: 3 });
    expect(next.phase).toBe("reveal");
    expect(next.roundStarter).toBe(2); // penalized player leads the next round
  });

  it("penalizes the doubter by the exact overshoot+1 when the bid was accurate or conservative (rulebook §4①: 실제 개수 - 선언 개수 + 1)", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [4, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(3); // 5 - (3-2+1) = 3
    expect(next.lastResolution).toMatchObject({ affectedSeat: 0, diceDelta: -2 });
    expect(next.roundStarter).toBe(0);
  });

  it("matches the rulebook's worked example — 5개 선언, 실제 2개면 3개 상실", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 5, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 2, diceDelta: -3 });
    expect(next.players.find((p) => p.seat === 2)!.diceCount).toBe(2); // 5 - 3
  });

  it("ends the game once only one player has dice left", () => {
    const state = makeState({
      playerCount: 2,
      activeSeat: 0,
      currentBid: { seat: 1, quantity: 6, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 1, dice: [2] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.phase).toBe("gameOver");
    expect(next.winnerSeat).toBe(0);
    expect(next.eliminationOrder).toEqual([1]);
  });

  it("does not apply the wild joker during a Palafico round", () => {
    // Round starter (seat 0) has exactly 1 die -> Palafico. Bid is on face 4;
    // the lone 1 must NOT count as a wild, so actualCount should be 1, not 2.
    const state = makeState({
      roundStarter: 0,
      activeSeat: 1,
      currentBid: { seat: 0, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 5, dice: [1, 2, 3, 5, 6] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    expect(isPalafico(state)).toBe(true);
    const next = applyAction(state, { type: "dudo", seat: 1 });
    expect(next.lastResolution?.actualCount).toBe(1);
    expect(next.lastResolution?.wasPalafico).toBe(true);
    // Bid of 2 was too high given the real count of 1 -> bidder (seat 0) is penalized and eliminated,
    // but seats 1 and 2 both still have dice, so the game continues (not a win).
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(0);
    expect(next.eliminationOrder).toEqual([0]);
    expect(next.phase).toBe("reveal");
    expect(next.roundStarter).toBe(1); // seat 0 is eliminated, so the next alive seat leads
  });
});

describe("calza (맞아!)", () => {
  it("is not restricted to the active seat", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    // seat 1 calls calza even though it's seat 0's turn.
    const next = applyAction(state, { type: "calza", seat: 1 });
    expect(next.phase).toBe("reveal");
  });

  it("regains a die on an exact match, capped at MAX_DICE", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: MAX_DICE, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ kind: "calza", diceDelta: 1, actualCount: 2 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(MAX_DICE); // capped, was already at max
  });

  it("loses dice equal to the exact absolute margin on a wrong call (rulebook §4②: |실제 개수 - 선언 개수|)", () => {
    // face-4 count: seat0's two 4s + seat1's wild 1 = 3 actual, bid was 5 -> |3-5| = 2.
    const state = makeState({
      currentBid: { seat: 2, quantity: 5, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 3, diceDelta: -2 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(3);
  });

  it("matches the rulebook's worked example — 4개라 외쳤으나 실제 7개면 3개 상실", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 4, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 4, 4, 5] },
        { seat: 1, diceCount: 5, dice: [4, 4, 4, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 7, diceDelta: -3 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(2); // 5 - 3
  });

  it("clamps the loss at 0 dice rather than going negative when the margin exceeds the caller's stock", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 30, face: 4 },
      players: [
        { seat: 0, diceCount: 2, dice: [4, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 1, diceDelta: -29 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(0);
  });

  it("is disallowed during a Palafico round", () => {
    const state = makeState({
      roundStarter: 0,
      currentBid: { seat: 0, quantity: 1, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 1 });
    expect(next).toEqual(state);
  });

  it("is a no-op for a seat that's already eliminated", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 0, dice: [] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next).toEqual(state);
  });
});

describe("continue (round transition)", () => {
  it("is a no-op outside the reveal phase", () => {
    const state = makeState({ phase: "playing" });
    const next = applyAction(state, { type: "continue", seed: 1 });
    expect(next).toEqual(state);
  });

  it("rerolls every alive player's dice, clears the bid, and advances the round counter", () => {
    const state = makeState({
      phase: "reveal",
      roundNumber: 1,
      roundStarter: 1,
      currentBid: { seat: 0, quantity: 2, face: 3 },
      players: [
        { seat: 0, diceCount: 4, dice: [4, 4, 2, 3] },
        { seat: 1, diceCount: 0, dice: [] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "continue", seed: 123 });
    expect(next.phase).toBe("playing");
    expect(next.currentBid).toBeNull();
    expect(next.roundNumber).toBe(2);
    expect(next.activeSeat).toBe(1);
    expect(next.players.find((p) => p.seat === 0)!.dice).toHaveLength(4);
    expect(next.players.find((p) => p.seat === 1)!.dice).toHaveLength(0);
    expect(next.players.find((p) => p.seat === 2)!.dice).toHaveLength(5);
  });

  it("is deterministic for a given seed", () => {
    const state = makeState({ phase: "reveal", roundStarter: 0 });
    const a = applyAction(state, { type: "continue", seed: 55 });
    const b = applyAction(state, { type: "continue", seed: 55 });
    expect(a).toEqual(b);
  });
});

describe("computeRankings", () => {
  it("ranks the winner 1st and the rest by reverse elimination order", () => {
    const state = makeState({
      phase: "gameOver",
      winnerSeat: 1,
      eliminationOrder: [2, 0], // seat 2 eliminated first, seat 0 eliminated last
    });
    const rankings = computeRankings(state);
    expect(rankings).toEqual([
      { seat: 1, rank: 1 },
      { seat: 0, rank: 2 }, // last eliminated -> 2nd place
      { seat: 2, rank: 3 }, // first eliminated -> last place
    ]);
  });
});

describe("full game simulation", () => {
  it("always terminates with exactly one winner under a deterministic always-dudo policy", () => {
    let state = startGame(4, 2024);
    let guard = 0;
    while (state.phase !== "gameOver" && guard < 2000) {
      if (state.phase === "reveal") {
        state = applyAction(state, { type: "continue", seed: guard + 1 });
      } else if (!state.currentBid) {
        state = applyAction(state, { type: "raise", seat: state.activeSeat, quantity: 1, face: 2 });
      } else {
        state = applyAction(state, { type: "dudo", seat: state.activeSeat });
      }
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    expect(state.winnerSeat).not.toBeNull();
    expect(aliveCount(state)).toBe(1);
    expect(state.eliminationOrder).toHaveLength(3);
  });

  it("also terminates under a mixed raise/dudo policy without dice counts ever going out of [0, MAX_DICE]", () => {
    let state = startGame(3, 777);
    let guard = 0;
    while (state.phase !== "gameOver" && guard < 3000) {
      if (state.phase === "reveal") {
        state = applyAction(state, { type: "continue", seed: guard + 7 });
      } else if (!state.currentBid) {
        state = applyAction(state, { type: "raise", seat: state.activeSeat, quantity: 1, face: 3 });
      } else if (guard % 3 === 0) {
        state = applyAction(state, { type: "raise", seat: state.activeSeat, quantity: state.currentBid.quantity + 1, face: state.currentBid.face });
      } else {
        state = applyAction(state, { type: "dudo", seat: state.activeSeat });
      }
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    expect(state.players.every((p) => p.diceCount >= 0 && p.diceCount <= MAX_DICE)).toBe(true);
  });
});

function aliveCount(state: PerudoState): number {
  return state.players.filter((p) => p.diceCount > 0).length;
}

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("gives the active seat opening raises for every face and nothing to anyone else", () => {
    const state = makeState({ activeSeat: 0 });
    const moves = getValidMoves(state, 0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === "raise")).toBe(true); // no pending bid yet -> no dudo/calza
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("includes dudo and calza once a bid is pending (outside Palafico)", () => {
    const state = makeState({ activeSeat: 1, currentBid: { seat: 0, quantity: 2, face: 3 } });
    const moves = getValidMoves(state, 1);
    expect(moves.some((m) => m.type === "dudo")).toBe(true);
    expect(moves.some((m) => m.type === "calza")).toBe(true);
  });

  it("omits calza during a Palafico round and locks every raise to the opening face", () => {
    const state = makeState({
      activeSeat: 1,
      roundStarter: 0,
      currentBid: { seat: 0, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 5, dice: [1, 2, 3, 4, 5] },
        { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
      ],
    });
    expect(isPalafico(state)).toBe(true);
    const moves = getValidMoves(state, 1);
    expect(moves.some((m) => m.type === "calza")).toBe(false);
    expect(moves.filter((m) => m.type === "raise").every((m) => m.type === "raise" && m.face === 4)).toBe(true);
  });

  it("returns nothing for an already-eliminated seat", () => {
    const state = makeState({
      activeSeat: 0,
      players: [
        { seat: 0, diceCount: 0, dice: [] },
        { seat: 1, diceCount: 5, dice: [1, 2, 3, 4, 5] },
        { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
      ],
    });
    expect(getValidMoves(state, 0)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, ARCHITECTURE.md §7)", () => {
  it("returns null for a seat that isn't up", () => {
    const state = makeState({ activeSeat: 0 });
    expect(chooseBotAction(state, 1)).toBeNull();
  });

  it("calls dudo when the pending bid is far beyond a fair estimate", () => {
    const state = makeState({
      activeSeat: 1,
      currentBid: { seat: 0, quantity: 15, face: 2 },
      players: [
        { seat: 0, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 1, diceCount: 5, dice: [3, 3, 3, 3, 3] }, // no 2s, no 1s in my own hand
        { seat: 2, diceCount: 5, dice: [3, 3, 3, 3, 3] },
      ],
    });
    expect(chooseBotAction(state, 1)).toEqual({ type: "dudo", seat: 1 });
  });

  it("always returns a legal move — driving every seat via the bot reaches gameOver", () => {
    let state = startGame(4, 123);
    let guard = 0;
    while (state.phase !== "gameOver" && guard < 3000) {
      guard++;
      if (state.phase === "reveal") {
        state = applyAction(state, { type: "continue", seed: guard });
        continue;
      }
      const action: EngineAction | null = chooseBotAction(state, state.activeSeat, () => 0.5);
      expect(action).not.toBeNull();
      state = applyAction(state, action!);
    }
    expect(state.phase).toBe("gameOver");
  });
});
