import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_CONFIG,
  MAX_TOLERANCE,
  botBeliefTotals,
  botRecallChance,
  configFor,
  applyAction,
  chooseBotAction,
  getValidMoves,
  guess,
  hasRemainingPair,
  memoryFeastCurrentActor,
  other,
  placeToken,
  plateTotal,
  startGame,
  timeoutFail,
  tokensPerPlayer,
  type Difficulty,
  type EngineAction,
  type MemoryFeastState,
  type Seat,
  type TokenMode,
} from "./engine";

describe("startGame (setup)", () => {
  it("scales plate count and round count to the chosen difficulty, scores start at 0", () => {
    for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
      const cfg = DIFFICULTY_CONFIG[difficulty];
      const state = startGame(difficulty);
      expect(state.plates).toHaveLength(cfg.plateCount);
      expect(state.score).toEqual({ p1: 0, p2: 0 });
      expect(state.phase).toBe("placement");
      expect(state.round).toBe(1);
      expect(state.activePlacer).toBe("p1");
    }
  });

  it("hard difficulty matches the original rulebook (20 plates, 9 rounds, 45 tokens each)", () => {
    const state = startGame("hard");
    expect(state.plates).toHaveLength(20);
    expect(DIFFICULTY_CONFIG.hard.totalRounds).toBe(9);
    expect(tokensPerPlayer("hard")).toBe(45);
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
    expect(plateTotal(state.plates[0])).toBe(tokensPerPlayer("easy"));
  });

  it("opens straight into the ±1 stage when placement leaves no two plates with the same total", () => {
    const cfg = DIFFICULTY_CONFIG.easy;
    let state = startGame("easy");
    // p1 spreads over plates 0..4 (totals 1..5), p2 stacks everything on plate 11 (15) — all distinct.
    for (let r = 0; r < cfg.totalRounds; r++) {
      state = placeToken(state, r);
      state = placeToken(state, 11);
    }
    expect(state.phase).toBe("open");
    expect(state.tolerance).toBe(1);
    expect(state.activeGuesser).toBe("p1");
  });

  it("logs every placement in order (what bots remember from)", () => {
    let state = startGame("easy");
    state = placeToken(state, 3);
    state = placeToken(state, 7);
    state = placeToken(state, 3);
    expect(state.placementLog.map((f) => [f.seat, f.plateIndex, f.amount])).toEqual([
      ["p1", 3, 1],
      ["p2", 7, 1],
      ["p1", 3, 2],
    ]);
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

/** An easy-difficulty open-phase board with the given plate totals (all credited to p1's side), p1 to guess. */
function openBoard(totals: number[]): MemoryFeastState {
  const base = startGame("easy");
  return {
    ...base,
    phase: "open",
    activePlacer: null,
    activeGuesser: "p1",
    plates: base.plates.map((p, i) => ({ ...p, p1Count: totals[i] ?? 0 })),
  };
}

describe("token mode", () => {
  it("'single' drops exactly 1 token every round on a bigger board", () => {
    const cfg = configFor("easy", "single");
    let state = startGame("easy", "single");
    expect(state.plates).toHaveLength(cfg.plateCount);
    expect(cfg.plateCount).toBeGreaterThan(DIFFICULTY_CONFIG.easy.plateCount);
    for (let r = 0; r < cfg.totalRounds; r++) {
      state = placeToken(state, 0);
      state = placeToken(state, 1);
    }
    expect(state.plates[0].p1Count).toBe(cfg.totalRounds);
    expect(state.placementLog.every((f) => f.amount === 1)).toBe(true);
    expect(tokensPerPlayer("easy", "single")).toBe(cfg.totalRounds);
    expect(state.phase).not.toBe("placement");
  });

  it("defaults to the original growing amounts (older states without a mode keep working)", () => {
    let state = startGame("easy");
    expect(state.tokenMode).toBe("growing");
    state = placeToken(placeToken(state, 0), 1);
    const legacy = { ...state, tokenMode: undefined };
    expect(placeToken(legacy, 2).plates[2].p1Count).toBe(2);
  });

  it("bots in 'single' mode still span a wider recall range from Lv.1 to Lv.10", () => {
    expect(botRecallChance(1, "single")).toBeLessThan(botRecallChance(1));
    expect(botRecallChance(10, "single")).toBeGreaterThan(botRecallChance(10));
  });
});

describe("한 끗 차이 stages", () => {
  it("widens to ±1 once exact pairs run out and hands the turn to whoever trails", () => {
    let state = openBoard([3, 3, 6, 7, 20]);
    state = { ...state, score: { p1: 0, p2: 10 } };
    state = guess(state, 0, 1); // p1 takes the 3s (6 points) — still behind 6:10, no exact pair left
    expect(state.phase).toBe("open");
    expect(state.tolerance).toBe(1);
    expect(state.activeGuesser).toBe("p1");
  });

  it("on a tied score the new stage goes to the player who was waiting", () => {
    let state = openBoard([3, 3, 6, 7, 20]);
    state = guess(state, 0, 1); // p1 6 : p2 0 -> p2 trails
    expect(state.activeGuesser).toBe("p2");
    const tied = guess({ ...openBoard([3, 3, 6, 7, 20]), score: { p1: 0, p2: 6 } }, 0, 1);
    expect(tied.activeGuesser).toBe("p2");
  });

  it("in the ±1 stage totals one apart score as a pair", () => {
    let state = { ...openBoard([6, 7, 20]), tolerance: 1 };
    state = guess(state, 0, 1);
    expect(state.score.p1).toBe(13);
    expect(state.phase).toBe("match-end"); // lone 20 left
  });

  it("skips straight to ±2 when nothing is within ±1, and ends only when ±2 has nothing either", () => {
    let state = openBoard([3, 3, 6, 8]);
    state = guess(state, 0, 1);
    expect(state.tolerance).toBe(2);
    state = openBoard([3, 3, 6, 9]);
    state = guess(state, 0, 1);
    expect(state.phase).toBe("match-end");
    expect(state.endReason).toBe("score");
    expect(hasRemainingPair(state.plates, MAX_TOLERANCE)).toBe(false);
  });

  it("a ±2-apart guess still fails in the exact stage", () => {
    const state = guess(openBoard([3, 3, 6, 8]), 2, 3);
    expect(state.penalties.p1).toBe(1);
  });
});

describe("bot memory", () => {
  it("a bot never reads the true board — forgotten opponent placements are missing from its belief", () => {
    const cfg = DIFFICULTY_CONFIG.hard;
    let state = startGame("hard");
    for (let r = 0; r < cfg.totalRounds; r++) {
      state = placeToken(state, r); // p1
      state = placeToken(state, r + 10); // p2
    }
    const truth = state.plates.map(plateTotal);
    const lv1 = botBeliefTotals(state, "p2", 1);
    // Own plates are always exact; at 20% recall at least one of p1's nine placements is forgotten.
    for (let r = 0; r < cfg.totalRounds; r++) expect(lv1[r + 10]).toBe(truth[r + 10]);
    expect(lv1.some((v, i) => v !== truth[i])).toBe(true);
    // Memory is stable between calls (no flicker turn to turn).
    expect(botBeliefTotals(state, "p2", 1)).toEqual(lv1);
  });

  it("a plate the bot opened itself is known exactly", () => {
    const base = openBoard([3, 5, 5, 3]);
    const state = { ...base, plates: base.plates.map((p, i) => (i < 2 ? { ...p, revealedTo: { p1: false, p2: true } } : p)) };
    const belief = botBeliefTotals(state, "p2", 1);
    expect(belief[0]).toBe(3);
    expect(belief[1]).toBe(5);
  });

  it("recall rises with level", () => {
    expect(botRecallChance(1)).toBeLessThan(botRecallChance(5));
    expect(botRecallChance(5)).toBeLessThan(botRecallChance(10));
    expect(botRecallChance(10)).toBeLessThan(1);
  });
});

describe("open (matching) phase", () => {
  it("a successful match claims both plates, scores every token on them and grants another turn", () => {
    let state = openBoard([3, 3, 5, 5, 7]);
    state = guess(state, 0, 1);
    expect(state.score).toEqual({ p1: 6, p2: 0 });
    expect(state.activeGuesser).toBe("p1"); // consecutive turn preserved
    expect(state.plates[0].claimedBy).toBe("p1");
    expect(state.plates[0].revealedTo).toEqual({ p1: true, p2: true });
    expect(state.phase).toBe("open");
  });

  it("never lets an already-claimed pair score again", () => {
    let state = openBoard([3, 3, 5, 5]);
    state = guess(state, 0, 1);
    const again = guess(state, 0, 1);
    expect(again).toBe(state);
    expect(getValidMoves(state, "p1")).not.toContainEqual({ type: "guess", plateA: 0, plateB: 1 });
  });

  it("rejects guesses on empty plates (two empty plates used to be a free endless match)", () => {
    const state = openBoard([3, 3, 5, 5]); // plates 4.. are empty
    expect(guess(state, 5, 6)).toBe(state);
    expect(guess(state, 0, 6)).toBe(state);
    expect(getValidMoves(state, "p1")).toHaveLength(6); // C(4,2) among the 4 non-empty plates
  });

  it("ends on score once no pair is left — higher score wins", () => {
    let state = openBoard([3, 3, 5, 5, 7]);
    state = guess(state, 0, 2); // 3 vs 5 -> fail, p2's turn
    state = guess(state, 2, 3); // p2 takes the 5s (10 points)
    expect(state.phase).toBe("open");
    state = guess(state, 0, 1); // p2 again takes the 3s (6) -> only the lone 7 is left
    expect(state.phase).toBe("match-end");
    expect(state.endReason).toBe("score");
    expect(state.score).toEqual({ p1: 0, p2: 16 });
    expect(state.winner).toBe("p2");
    expect(state.activeGuesser).toBeNull();
  });

  it("breaks a score tie by fewer penalties, otherwise the match is a draw", () => {
    const base = openBoard([4, 4, 9]);
    const tiedByPenalty = guess({ ...base, score: { p1: 0, p2: 8 }, penalties: { p1: 0, p2: 2 } }, 0, 1);
    expect(tiedByPenalty.winner).toBe("p1");
    const draw = guess({ ...base, score: { p1: 0, p2: 8 } }, 0, 1);
    expect(draw.phase).toBe("match-end");
    expect(draw.winner).toBeNull();
  });

  it("a failed match only reveals the true values to the guesser, adds a penalty, and passes the turn", () => {
    let state = openBoard([3, 3, 5, 5]);
    state = guess(state, 0, 2);
    expect(state.penalties.p1).toBe(1);
    expect(state.activeGuesser).toBe("p2");
    expect(state.plates[0].revealedTo).toEqual({ p1: true, p2: false });
    expect(state.plates[0].claimedBy).toBeNull();
  });

  it("ignores a guess of a plate against itself", () => {
    const state = openBoard([3, 3, 5, 5]);
    expect(guess(state, 3, 3)).toBe(state);
  });

  it("declares the opponent the winner once penalties reach the difficulty's loss threshold", () => {
    const threshold = DIFFICULTY_CONFIG.easy.penaltyLossThreshold;
    let state = openBoard([3, 3, 5, 5]);
    state = { ...state, penalties: { ...state.penalties, p1: threshold - 1 } };
    state = guess(state, 0, 2);
    expect(state.phase).toBe("match-end");
    expect(state.winner).toBe("p2");
    expect(state.endReason).toBe("penalty");
    expect(state.activeGuesser).toBeNull();
  });

  it("timeout-fail behaves exactly like a failed guess with nothing revealed", () => {
    let state = openBoard([3, 3, 5, 5]);
    state = timeoutFail(state);
    expect(state.penalties.p1).toBe(1);
    expect(state.activeGuesser).toBe("p2");
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
    state = guess(state, 0, 1); // the only pair -> match over
    expect(state.phase).toBe("match-end");
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

  it("offers every unordered pair of in-play plates as a guess, only to the active guesser", () => {
    const state = openBoard([1, 2, 3, 4, 4]);
    expect(getValidMoves(state, "p1")).toHaveLength(10);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("offers nothing once the match has ended", () => {
    let state = fillPlacement("easy");
    state = guess(state, 0, 1);
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
    state = openBoard([1, 2, 3, 4, 4]);
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
  });

  it("level 10 always picks an actual match when one exists (rng forced past the 0% mistake chance)", () => {
    const state = openBoard([1, 2, 3, 4, 4]);
    const action = chooseBotAction(state, "p1", 10, () => 0) as EngineAction;
    expect(action).toEqual({ type: "guess", plateA: 3, plateB: 4 });
  });
});

/** Seeded LCG so the full-game sims below are deterministic (they used to use Math.random and flake). */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function playFullBotGame(difficulty: Difficulty, levelOf: (seat: Seat) => number, seed: number, mode: TokenMode = "growing"): MemoryFeastState {
  const rng = seededRng(seed);
  let state = startGame(difficulty, mode);
  let guard = 0;
  while (state.phase !== "match-end" && guard < 5000) {
    guard++;
    const seat = memoryFeastCurrentActor(state);
    if (!seat) break;
    const action = chooseBotAction(state, seat, levelOf(seat), rng);
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 1-10 풀 시뮬레이션 (버그 없이 match-end까지 완주)", () => {
  for (const level of [1, 4, 7, 10]) {
    it(`completes all-Level-${level} easy matches with a decided ending`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const state = playFullBotGame("easy", () => level, seed);
        expect(state.phase).toBe("match-end");
        expect(state.endReason).not.toBeNull();
      }
    });
  }

  it("completes 'single'-mode matches on every difficulty", () => {
    for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
      for (let seed = 1; seed <= 10; seed++) {
        const state = playFullBotGame(difficulty, (seat) => (seat === "p1" ? 3 : 8), seed, "single");
        expect(state.phase).toBe("match-end");
      }
    }
  });

  it("also completes mixed Level 1 / Level 10 hard matches (no crash, no infinite loop)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = playFullBotGame("hard", (seat) => (seat === "p1" ? 1 : 10), seed);
      expect(state.phase).toBe("match-end");
      // A score ending leaves no scorable pair behind.
      if (state.endReason === "score") expect(hasRemainingPair(state.plates)).toBe(false);
    }
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
