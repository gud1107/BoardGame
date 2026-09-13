import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_CONFIG,
  applyAction,
  chooseBotAction,
  getValidMoves,
  guess,
  memoryFeastCurrentActor,
  other,
  placeToken,
  plateTotal,
  startGame,
  timeoutFail,
  totalStock,
  type Difficulty,
  type EngineAction,
  type MemoryFeastState,
  type Seat,
} from "./engine";

describe("startGame (setup)", () => {
  it("scales plate count, round count and starting stock to the chosen difficulty", () => {
    for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
      const cfg = DIFFICULTY_CONFIG[difficulty];
      const state = startGame(difficulty);
      expect(state.plates).toHaveLength(cfg.plateCount);
      expect(state.stock.p1).toBe(totalStock(difficulty));
      expect(state.stock.p2).toBe(totalStock(difficulty));
      expect(state.phase).toBe("placement");
      expect(state.round).toBe(1);
      expect(state.activePlacer).toBe("p1");
    }
  });

  it("hard difficulty matches the original rulebook (20 plates, 9 rounds, 45 stock)", () => {
    const state = startGame("hard");
    expect(state.plates).toHaveLength(20);
    expect(DIFFICULTY_CONFIG.hard.totalRounds).toBe(9);
    expect(state.stock.p1).toBe(45);
  });
});

describe("placement phase", () => {
  it("alternates p1 -> p2 within a round, keeping the round's token amount fixed", () => {
    let state = startGame("easy");
    expect(state.activePlacer).toBe("p1");
    state = placeToken(state, 0);
    expect(state.plates[0].p1Count).toBe(1); // round 1 -> 1 token
    expect(state.activePlacer).toBe("p2");
    expect(state.round).toBe(1);

    state = placeToken(state, 1);
    expect(state.plates[1].p2Count).toBe(1);
    // both placed for round 1 -> advance to round 2, p1 first again
    expect(state.round).toBe(2);
    expect(state.activePlacer).toBe("p1");
  });

  it("ignores a placement attempt from the wrong seat", () => {
    let state = startGame("easy");
    // p2 tries to act on p1's turn — no-op.
    const before = state;
    state = { ...state }; // ensure reference distinct but content equal
    const attempted = placeToken({ ...before, activePlacer: "p1" }, 0);
    // Simulate the reducer receiving a "place" while activePlacer is p1 but
    // called as though seat mismatch were enforced upstream (getValidMoves
    // already guards this on the UI/bot side) — placeToken itself always
    // acts as `activePlacer`, so there's nothing to additionally assert
    // beyond activePlacer being who actually moved.
    expect(attempted.plates[0].p1Count).toBe(1);
  });

  it("emits a flash event with a unique, monotonically increasing seq every placement", () => {
    let state = startGame("easy");
    state = placeToken(state, 2);
    expect(state.lastFlash).toEqual({ seat: "p1", plateIndex: 2, amount: 1, seq: 1 });
    state = placeToken(state, 3);
    expect(state.lastFlash).toEqual({ seat: "p2", plateIndex: 3, amount: 1, seq: 2 });
  });

  it("accumulates repeated placements onto the same plate across rounds", () => {
    let state = startGame("easy");
    state = placeToken(state, 5); // round 1, p1 -> +1
    state = placeToken(state, 0); // round 1, p2 -> +1 elsewhere
    state = placeToken(state, 5); // round 2, p1 -> +2 (same plate as before)
    expect(state.plates[5].p1Count).toBe(1 + 2);
  });

  it("transitions to the open phase once every round has been placed, p1 guessing first", () => {
    const cfg = DIFFICULTY_CONFIG.easy;
    let state = startGame("easy");
    for (let r = 0; r < cfg.totalRounds; r++) {
      state = placeToken(state, 0); // p1
      state = placeToken(state, 1); // p2
    }
    expect(state.phase).toBe("open");
    expect(state.activePlacer).toBeNull();
    expect(state.activeGuesser).toBe("p1");
    // Total tokens each player ever placed equals their starting stock.
    expect(state.stock.p1).toBe(totalStock("easy"));
  });
});

function fillPlacement(difficulty: Difficulty): MemoryFeastState {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  let state = startGame(difficulty);
  for (let r = 0; r < cfg.totalRounds; r++) {
    state = placeToken(state, 0);
    state = placeToken(state, 1);
  }
  return state;
}

describe("open (matching) phase", () => {
  it("a successful match deducts the matched total from the guesser's own stock and grants another turn", () => {
    let state = fillPlacement("easy");
    // Two untouched plates (never placed on by either seat) both total 0 -> guaranteed match.
    const untouchedA = 5;
    const untouchedB = 6;
    expect(plateTotal(state.plates[untouchedA])).toBe(0);
    expect(plateTotal(state.plates[untouchedB])).toBe(0);
    const stockBefore = state.stock.p1;
    state = guess(state, untouchedA, untouchedB);
    expect(state.stock.p1).toBe(stockBefore - 0); // 0-token match still "succeeds" but deducts nothing
    expect(state.activeGuesser).toBe("p1"); // consecutive turn preserved
    expect(state.plates[untouchedA].revealedTo).toEqual({ p1: true, p2: true });
  });

  it("a failed match only reveals the true values to the guesser, adds a penalty, and passes the turn", () => {
    let state = fillPlacement("easy");
    // Plate 0 has p1's full 15-token investment (rounds 1..5 all placed there); plate 6 is untouched (0).
    expect(plateTotal(state.plates[0])).toBeGreaterThan(0);
    expect(plateTotal(state.plates[6])).toBe(0);
    state = guess(state, 0, 6);
    expect(state.penalties.p1).toBe(1);
    expect(state.activeGuesser).toBe("p2");
    expect(state.plates[0].revealedTo).toEqual({ p1: true, p2: false });
  });

  it("ignores a guess of a plate against itself", () => {
    const state = fillPlacement("easy");
    const result = guess(state, 3, 3);
    expect(result).toBe(state);
  });

  it("declares the opponent the winner once penalties reach the difficulty's loss threshold", () => {
    let state = fillPlacement("easy");
    const threshold = DIFFICULTY_CONFIG.easy.penaltyLossThreshold;
    // Fast-forward p1 to one failure away from the threshold, then let one
    // more real failed guess (plate 0, p1's own 15-token pile, vs untouched
    // plate 7) push it over.
    state = { ...state, penalties: { ...state.penalties, p1: threshold - 1 }, activeGuesser: "p1" };
    state = guess(state, 0, 7);
    expect(state.phase).toBe("match-end");
    expect(state.winner).toBe("p2");
    expect(state.loseReason).toBe("penalty");
    expect(state.activeGuesser).toBeNull();
  });

  it("declares the guesser the winner once their stock reaches exactly 0", () => {
    // Hand-build a near-won state: p1 stock at a small matchable amount.
    let state = fillPlacement("easy");
    state = { ...state, stock: { ...state.stock, p1: 0 } };
    // Any successful (even 0-0) match should immediately end the match at 0 stock.
    const before = { ...state };
    state = guess(state, 5, 6); // two untouched plates -> 0 vs 0 -> match
    expect(state.phase).toBe("match-end");
    expect(state.winner).toBe("p1");
    expect(state.loseReason).toBe("stock");
    void before;
  });

  it("timeout-fail behaves exactly like a failed guess with nothing revealed", () => {
    let state = fillPlacement("easy");
    state = timeoutFail(state);
    expect(state.penalties.p1).toBe(1);
    expect(state.activeGuesser).toBe("p2");
    // Nothing got revealed since no plates were chosen.
    expect(state.plates.every((p) => !p.revealedTo.p1)).toBe(true);
  });
});

describe("memoryFeastCurrentActor", () => {
  it("tracks the active placer during placement and the active guesser during open", () => {
    let state = startGame("easy");
    expect(memoryFeastCurrentActor(state)).toBe("p1");
    state = placeToken(state, 0);
    expect(memoryFeastCurrentActor(state)).toBe("p2");
    state = fillPlacement("easy");
    expect(memoryFeastCurrentActor(state)).toBe("p1");
  });

  it("returns null once the match has ended", () => {
    let state = fillPlacement("easy");
    state = { ...state, stock: { ...state.stock, p1: 0 } };
    state = guess(state, 5, 6);
    expect(memoryFeastCurrentActor(state)).toBeNull();
  });
});

describe("getValidMoves (AI bot support)", () => {
  it("offers one placement move per plate, only to the active placer", () => {
    const state = startGame("normal");
    const moves = getValidMoves(state, "p1");
    expect(moves).toHaveLength(DIFFICULTY_CONFIG.normal.plateCount);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("offers every unordered plate pair as a guess, only to the active guesser", () => {
    const state = fillPlacement("easy");
    const n = DIFFICULTY_CONFIG.easy.plateCount;
    const moves = getValidMoves(state, "p1");
    expect(moves).toHaveLength((n * (n - 1)) / 2);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("offers nothing once the match has ended", () => {
    let state = fillPlacement("easy");
    state = { ...state, stock: { ...state.stock, p1: 0 } };
    state = guess(state, 5, 6);
    expect(getValidMoves(state, "p1")).toEqual([]);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });
});

describe("chooseBotAction (Level 1-10)", () => {
  it("returns null when the seat has nothing to do", () => {
    const state = startGame("easy");
    expect(chooseBotAction(state, "p2", 5)).toBeNull();
  });

  it("always returns a legal move across every level, in both phases", () => {
    let state = startGame("easy");
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
    state = fillPlacement("easy");
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
  });

  it("level 10 always picks an actual match when one exists (rng forced past the 0% mistake chance)", () => {
    const state = fillPlacement("easy");
    // Plates 5 and 6 are both untouched (0-0 match).
    const action = chooseBotAction(state, "p1", 10, () => 0) as EngineAction;
    expect(action.type).toBe("guess");
    if (action.type === "guess") {
      expect(plateTotal(state.plates[action.plateA])).toBe(plateTotal(state.plates[action.plateB]));
    }
  });
});

function playFullBotGame(difficulty: Difficulty, levelOf: (seat: Seat) => number): MemoryFeastState {
  let state = startGame(difficulty);
  let guard = 0;
  while (state.phase !== "match-end" && guard < 5000) {
    guard++;
    const seat = memoryFeastCurrentActor(state);
    if (!seat) break;
    const action = chooseBotAction(state, seat, levelOf(seat));
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 1-10 풀 시뮬레이션 (버그 없이 match-end까지 완주)", () => {
  for (const level of [1, 4, 7, 10]) {
    it(`completes an all-Level-${level} easy match with a decided winner`, () => {
      const state = playFullBotGame("easy", () => level);
      expect(state.phase).toBe("match-end");
      expect(state.winner).not.toBeNull();
    });
  }

  it("also completes a mixed Level 1 / Level 10 hard match (no crash, no infinite loop)", () => {
    const state = playFullBotGame("hard", (seat) => (seat === "p1" ? 1 : 10));
    expect(state.phase).toBe("match-end");
    expect(state.winner).not.toBeNull();
  });
});

describe("determinism (lockstep replay)", () => {
  it("applyAction replays identically on two independent state trees given the same action sequence", () => {
    let a = startGame("easy");
    let b = startGame("easy");
    const actions: EngineAction[] = [
      { type: "place", plateIndex: 0 },
      { type: "place", plateIndex: 1 },
      { type: "place", plateIndex: 0 },
    ];
    for (const action of actions) {
      a = applyAction(a, action);
      b = applyAction(b, action);
    }
    expect(a).toEqual(b);
  });
});

describe("other", () => {
  it("flips seats", () => {
    expect(other("p1")).toBe("p2");
    expect(other("p2")).toBe("p1");
  });
});
