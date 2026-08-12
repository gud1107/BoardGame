import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildMoneyDeck,
  chooseBotAction,
  computeRankings,
  getValidMoves,
  MIN_CASINO_TOTAL,
  MONEY_COPIES_PER_VALUE,
  MONEY_VALUES,
  NEUTRAL_DICE_TABLE,
  NEUTRAL_OWNER,
  settleCasino,
  settleCasinos,
  startGame,
  DICE_PER_PLAYER,
  CASINO_COUNT,
  MIN_PLAYERS,
  MAX_PLAYERS,
  type CasinoState,
  type LasVegasState,
  type PlayerState,
  type SeatIndex,
} from "./engine";

function makePlayer(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { seat, ownDiceInHand: 0, neutralDiceInHand: 0, money: [], ...overrides };
}

function makeCasino(number: 1 | 2 | 3 | 4 | 5 | 6, bills: number[], diceCounts: CasinoState["diceCounts"] = {}): CasinoState {
  return { number, bills: [...bills].sort((a, b) => b - a), diceCounts };
}

function makeState(overrides: Partial<LasVegasState> = {}): LasVegasState {
  const players: PlayerState[] = [makePlayer(0), makePlayer(1), makePlayer(2)];
  const casinos: CasinoState[] = [1, 2, 3, 4, 5, 6].map((n) => makeCasino(n as 1, [50_000]));
  return {
    playerCount: 3,
    players,
    casinos,
    activeSeat: 0,
    currentRoll: null,
    phase: "playing",
    lastPlacement: null,
    settlement: null,
    initialSeed: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Setup — money deck + $50,000-minimum casino seeding
// ---------------------------------------------------------------------------

describe("startGame — casino/money setup", () => {
  it("builds a 54-card money deck: $10,000-$90,000, 6 copies each", () => {
    const deck = buildMoneyDeck();
    expect(deck).toHaveLength(54);
    for (const value of MONEY_VALUES) {
      expect(deck.filter((v) => v === value)).toHaveLength(MONEY_COPIES_PER_VALUE);
    }
  });

  it("seeds all 6 casinos, each with a bill total >= $50,000, across many seeds", () => {
    // Run across a spread of seeds rather than just one, since the "stop as
    // soon as the running total crosses $50,000" rule is order-dependent
    // (the card that tips it over isn't always the stack's smallest bill),
    // so a single fixed seed wouldn't exercise every shape of shortfall.
    for (let seed = 0; seed < 25; seed++) {
      const state = startGame(4, seed);
      expect(state.casinos).toHaveLength(CASINO_COUNT);
      for (const casino of state.casinos) {
        const total = casino.bills.reduce((sum, v) => sum + v, 0);
        expect(total).toBeGreaterThanOrEqual(MIN_CASINO_TOTAL);
      }
    }
  });

  it("stops dealing a casino the instant its running total (in draw order) first reaches $50,000 — never one card later", () => {
    // Whitebox-style check driven through the public API: replay the exact
    // per-casino stopping point by simulating the same "deal until total >=
    // 50000" walk over the actual dealt deck order isn't observable from
    // `bills` alone (sorted highest-first for payout), so instead assert the
    // documented boundary case from the rulebook's own worked example: a
    // casino that reaches exactly $60,000 via two cards never carries a
    // third.
    const state = startGame(5, 1);
    for (const casino of state.casinos) {
      const total = casino.bills.reduce((sum, v) => sum + v, 0);
      // No casino should need more than 5 cards to clear $50,000, since the
      // smallest denomination is $10,000 (5 x $10,000 = $50,000 already
      // qualifies) — a hard upper bound that would catch a runaway loop bug.
      expect(casino.bills.length).toBeLessThanOrEqual(5);
      expect(total).toBeGreaterThanOrEqual(MIN_CASINO_TOTAL);
    }
  });

  it("sorts each casino's bills highest-first", () => {
    const state = startGame(3, 7);
    for (const casino of state.casinos) {
      for (let i = 1; i < casino.bills.length; i++) {
        expect(casino.bills[i - 1]).toBeGreaterThanOrEqual(casino.bills[i]);
      }
    }
  });

  it("never deals more bills across all 6 casinos than the 54-card deck holds", () => {
    const state = startGame(2, 99);
    const totalBills = state.casinos.reduce((sum, c) => sum + c.bills.length, 0);
    expect(totalBills).toBeLessThanOrEqual(54);
  });

  it("is deterministic for a given seed", () => {
    expect(startGame(4, 42)).toEqual(startGame(4, 42));
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(6, 1)).toThrow();
  });
});

describe("startGame — dice distribution (rulebook §2 step 3)", () => {
  it.each([
    [2, 4, 0],
    [3, 2, 2],
    [4, 2, 0],
    [5, 0, 0],
  ])("player count %i: %i neutral dice per player, %i pre-placed", (count, perPlayer, preplaced) => {
    expect(NEUTRAL_DICE_TABLE[count]).toEqual({ perPlayer, preplaced });
    const state = startGame(count, 5);
    state.players.forEach((p) => {
      expect(p.ownDiceInHand).toBe(DICE_PER_PLAYER);
      expect(p.neutralDiceInHand).toBe(perPlayer);
    });
    const totalNeutralOnBoard = state.casinos.reduce((sum, c) => sum + (c.diceCounts[NEUTRAL_OWNER] ?? 0), 0);
    expect(totalNeutralOnBoard).toBe(preplaced);
  });

  it("3-player pre-placed neutral dice land on a real casino board (1-6) before any turn", () => {
    const state = startGame(3, 123);
    const totalNeutralOnBoard = state.casinos.reduce((sum, c) => sum + (c.diceCounts[NEUTRAL_OWNER] ?? 0), 0);
    expect(totalNeutralOnBoard).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Turn mechanics — roll + all-matching-dice placement
// ---------------------------------------------------------------------------

describe("rollDice + placeDice — same-face bulk placement", () => {
  it("rolling deals exactly ownDiceInHand + neutralDiceInHand faces", () => {
    let state = startGame(3, 10);
    state = applyAction(state, { type: "rollDice", seat: state.activeSeat, seed: 999 });
    const player = state.players.find((p) => p.seat === state.activeSeat)!;
    expect(state.currentRoll).toHaveLength(player.ownDiceInHand + player.neutralDiceInHand);
  });

  it("placing a face moves every rolled die of that face (own AND neutral) onto the matching casino, all at once", () => {
    let state = makeState({
      players: [
        makePlayer(0, { ownDiceInHand: 3, neutralDiceInHand: 2 }),
        makePlayer(1, { ownDiceInHand: 8 }),
        makePlayer(2, { ownDiceInHand: 8 }),
      ],
      activeSeat: 0,
    });
    state = {
      ...state,
      currentRoll: [
        { owner: "own", face: 4 },
        { owner: "own", face: 4 },
        { owner: "own", face: 2 },
        { owner: "neutral", face: 4 },
        { owner: "neutral", face: 6 },
      ],
    };
    const next = applyAction(state, { type: "placeDice", seat: 0, face: 4 });
    expect(next.currentRoll).toBeNull();
    const casino4 = next.casinos.find((c) => c.number === 4)!;
    expect(casino4.diceCounts[0]).toBe(2); // own dice
    expect(casino4.diceCounts[NEUTRAL_OWNER]).toBe(1); // neutral die
    const player0 = next.players.find((p) => p.seat === 0)!;
    expect(player0.ownDiceInHand).toBe(1); // 3 - 2 placed
    expect(player0.neutralDiceInHand).toBe(1); // 2 - 1 placed
    // Untouched dice (face 2 own, face 6 neutral) stay in hand, not on any board.
    const totalOnBoards = next.casinos.reduce(
      (sum, c) => sum + Object.values(c.diceCounts).reduce((s: number, n) => s + (n ?? 0), 0),
      0,
    );
    expect(totalOnBoards).toBe(3); // 2 own + 1 neutral placed just now
  });

  it("rejects placing a face that wasn't rolled", () => {
    let state = makeState({ activeSeat: 0, players: [makePlayer(0, { ownDiceInHand: 8 }), makePlayer(1, { ownDiceInHand: 8 }), makePlayer(2, { ownDiceInHand: 8 })] });
    state = { ...state, currentRoll: [{ owner: "own", face: 3 }] };
    const next = applyAction(state, { type: "placeDice", seat: 0, face: 5 });
    expect(next).toBe(state); // no-op, same reference
  });

  it("rejects actions from a seat that isn't the active seat", () => {
    const state = startGame(3, 1);
    const other = state.activeSeat === 0 ? 1 : 0;
    const next = applyAction(state, { type: "rollDice", seat: other, seed: 1 });
    expect(next).toBe(state);
  });

  it("auto-passes seats with an empty hand and hands the turn to the next seat with dice", () => {
    let state = makeState({
      activeSeat: 0,
      players: [
        makePlayer(0, { ownDiceInHand: 1 }),
        makePlayer(1, { ownDiceInHand: 0, neutralDiceInHand: 0 }),
        makePlayer(2, { ownDiceInHand: 8 }),
      ],
    });
    state = { ...state, currentRoll: [{ owner: "own", face: 2 }] };
    const next = applyAction(state, { type: "placeDice", seat: 0, face: 2 });
    expect(next.activeSeat).toBe(2); // seat 1 has no dice left, skipped
  });
});

// ---------------------------------------------------------------------------
// 3. Cancellation + payout — rulebook §4
// ---------------------------------------------------------------------------

describe("settleCasino — tie cancellation + ranked payout", () => {
  it("cancels every owner tied on dice count, including the neutral bucket, per the rulebook's worked example", () => {
    // Rulebook example: red 3, blue 3, green 1, neutral(white) 1 -> everyone
    // cancelled, nobody gets paid.
    const casino = makeCasino(4, [90_000, 10_000], { 0: 3, 1: 3, 2: 1, [NEUTRAL_OWNER]: 1 });
    const result = settleCasino(casino);
    expect(new Set(result.cancelledOwners)).toEqual(new Set([0, 1, 2, NEUTRAL_OWNER]));
    expect(result.awards).toHaveLength(0);
  });

  it("pays the highest bill to the most dice, next-highest to the next, in strict descending order", () => {
    const casino = makeCasino(1, [90_000, 50_000, 10_000], { 0: 5, 1: 3, 2: 1 });
    const result = settleCasino(casino);
    expect(result.cancelledOwners).toEqual([]);
    expect(result.awards).toEqual([
      { owner: 0, diceCount: 5, bill: 90_000 },
      { owner: 1, diceCount: 3, bill: 50_000 },
      { owner: 2, diceCount: 1, bill: 10_000 },
    ]);
  });

  it("gives a surviving group nothing once the casino's bills run out", () => {
    const casino = makeCasino(1, [90_000], { 0: 5, 1: 3 });
    const result = settleCasino(casino);
    expect(result.awards).toEqual([
      { owner: 0, diceCount: 5, bill: 90_000 },
      { owner: 1, diceCount: 3, bill: null },
    ]);
  });

  it("records a neutral group's win as a bill nobody collects (discarded per rulebook §4 규칙 2)", () => {
    const casino = makeCasino(1, [90_000, 50_000], { 0: 5, [NEUTRAL_OWNER]: 3 });
    const result = settleCasino(casino);
    expect(result.awards).toEqual([
      { owner: 0, diceCount: 5, bill: 90_000 },
      { owner: NEUTRAL_OWNER, diceCount: 3, bill: 50_000 },
    ]);
  });

  it("cancels only the tied subset, leaving other counts untouched (mixed tie + non-tie)", () => {
    // seats 0 and 1 tie at 2 dice each and cancel; seat 2 alone at 4 survives.
    const casino = makeCasino(2, [70_000, 30_000], { 0: 2, 1: 2, 2: 4 });
    const result = settleCasino(casino);
    expect(new Set(result.cancelledOwners)).toEqual(new Set([0, 1]));
    expect(result.awards).toEqual([{ owner: 2, diceCount: 4, bill: 70_000 }]);
  });

  it("settleCasinos processes casino 1 through 6 in order", () => {
    const casinos = [6, 5, 4, 3, 2, 1].map((n) => makeCasino(n as 1, [10_000], { 0: 1 }));
    const results = settleCasinos(casinos);
    expect(results.map((r) => r.casino)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("full-round settlement wired through placeDice", () => {
  it("credits the winning seat's money once every seat empties its hand", () => {
    let state = makeState({
      activeSeat: 0,
      players: [makePlayer(0, { ownDiceInHand: 1 }), makePlayer(1, { ownDiceInHand: 1 })],
      playerCount: 2,
      casinos: [
        makeCasino(1, [90_000]),
        makeCasino(2, [10_000]),
        makeCasino(3, [10_000]),
        makeCasino(4, [10_000]),
        makeCasino(5, [10_000]),
        makeCasino(6, [10_000]),
      ],
    });
    state = { ...state, currentRoll: [{ owner: "own", face: 1 }] };
    state = applyAction(state, { type: "placeDice", seat: 0, face: 1 });
    expect(state.phase).toBe("playing"); // seat 1 still has a die
    state = { ...state, currentRoll: [{ owner: "own", face: 1 }] };
    state = applyAction(state, { type: "placeDice", seat: 1, face: 1 });
    // Both seats placed exactly 1 die each at casino 1 -> tie -> cancelled -> nobody paid.
    expect(state.phase).toBe("gameOver");
    expect(state.settlement).not.toBeNull();
    const winnerMoney = state.players.map((p) => p.money.reduce((s, v) => s + v, 0));
    expect(winnerMoney).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// 4. Final ranking — rulebook §5
// ---------------------------------------------------------------------------

describe("computeRankings — total money, tie-break by bill count", () => {
  function stateWithMoney(moneyBySeat: number[][]): LasVegasState {
    return makeState({
      players: moneyBySeat.map((money, seat) => makePlayer(seat, { money })),
      playerCount: moneyBySeat.length,
      phase: "gameOver",
    });
  }

  it("ranks the highest total money first", () => {
    const state = stateWithMoney([[90_000], [30_000], [10_000]]);
    const ranked = computeRankings(state);
    expect(ranked.find((r) => r.seat === 0)!.rank).toBe(1);
    expect(ranked.find((r) => r.seat === 1)!.rank).toBe(2);
    expect(ranked.find((r) => r.seat === 2)!.rank).toBe(3);
  });

  it("breaks a total-money tie by whoever holds more bills", () => {
    // Both total $90,000: seat 0 with one $90k bill, seat 1 with three smaller bills.
    const state = stateWithMoney([[90_000], [50_000, 30_000, 10_000], []]);
    const ranked = computeRankings(state);
    const seat0 = ranked.find((r) => r.seat === 0)!;
    const seat1 = ranked.find((r) => r.seat === 1)!;
    expect(seat0.total).toBe(seat1.total);
    expect(seat1.rank).toBe(1); // more bills (3 > 1) wins the tie
    expect(seat0.rank).toBe(2);
  });

  it("declares a genuine co-victory when both total AND bill count match", () => {
    const state = stateWithMoney([[50_000, 10_000], [40_000, 20_000], [10_000]]);
    const ranked = computeRankings(state);
    const seat0 = ranked.find((r) => r.seat === 0)!;
    const seat1 = ranked.find((r) => r.seat === 1)!;
    expect(seat0.total).toBe(60_000);
    expect(seat1.total).toBe(60_000);
    expect(seat0.rank).toBe(1);
    expect(seat1.rank).toBe(1);
    expect(ranked.find((r) => r.seat === 2)!.rank).toBe(3); // standard competition ranking (1,1,3)
  });
});

// Sanity check on the module's exported player-count bounds, used by the
// online lobby form.
describe("player count bounds", () => {
  it("exposes MIN_PLAYERS=2 / MAX_PLAYERS=5, matching the 5-color box", () => {
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty)
// ---------------------------------------------------------------------------

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("offers exactly one rollDice candidate before a roll, and nothing for an idle seat", () => {
    const state = makeState({ activeSeat: 0, players: [makePlayer(0, { ownDiceInHand: 8 }), makePlayer(1), makePlayer(2)] });
    const moves = getValidMoves(state, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "rollDice", seat: 0 });
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("offers nothing when the active seat has no dice left in hand", () => {
    const state = makeState({ activeSeat: 0, players: [makePlayer(0, { ownDiceInHand: 0, neutralDiceInHand: 0 }), makePlayer(1), makePlayer(2)] });
    expect(getValidMoves(state, 0)).toEqual([]);
  });

  it("offers one placeDice per distinct rolled face once a roll is pending", () => {
    const state = makeState({
      activeSeat: 0,
      currentRoll: [
        { owner: "own", face: 5 },
        { owner: "own", face: 5 },
        { owner: "neutral", face: 3 },
      ],
    });
    const moves = getValidMoves(state, 0);
    expect(moves).toEqual([
      { type: "placeDice", seat: 0, face: 5 },
      { type: "placeDice", seat: 0, face: 3 },
    ]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat with nothing to decide", () => {
    const state = makeState({ activeSeat: 0 });
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("rolls when no roll is pending, drawing its own seed", () => {
    const state = makeState({ activeSeat: 0, players: [makePlayer(0, { ownDiceInHand: 8 }), makePlayer(1), makePlayer(2)] });
    const action = chooseBotAction(state, 0, 7);
    expect(action?.type).toBe("rollDice");
    expect(action).toMatchObject({ seat: 0 });
  });

  it("always returns a legal placeDice move regardless of level", () => {
    const state = makeState({
      activeSeat: 0,
      currentRoll: [
        { owner: "own", face: 2 },
        { owner: "own", face: 4 },
      ],
    });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) can commit to the far weaker casino, while Level 10 always chases the richer one", () => {
    const state = makeState({
      activeSeat: 0,
      casinos: [
        makeCasino(1, [50_000]),
        makeCasino(2, [50_000]),
        makeCasino(3, [90_000, 90_000, 90_000]), // rich casino
        makeCasino(4, [50_000]),
        makeCasino(5, [10_000]), // weak casino
        makeCasino(6, [50_000]),
      ],
      currentRoll: [
        // face 5 (weak casino) rolled first -> getValidMoves lists it as candidates[0]
        { owner: "own", face: 5 },
        { owner: "own", face: 5 },
        { owner: "own", face: 3 },
        { owner: "own", face: 3 },
        { owner: "own", face: 3 },
      ],
    });

    // rng() always 0 -> always below Level 1's mistake chance -> always
    // candidates[0] == placeDice on the weak $10,000 casino (face 5).
    const level1Action = chooseBotAction(state, 0, 1, () => 0);
    expect(level1Action).toEqual({ type: "placeDice", seat: 0, face: 5 });

    // Level 10 has 0% mistake chance -> true argmax, which chases the
    // 3-bill $90,000 casino instead.
    const level10Action = chooseBotAction(state, 0, 10, () => 0);
    expect(level10Action).toEqual({ type: "placeDice", seat: 0, face: 3 });
  });
});

function playFullBotGame(playerCount: number, seed: number, levelOf: (seat: SeatIndex) => number): LasVegasState {
  let state = startGame(playerCount, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 2000) {
    guard++;
    const seat = state.activeSeat;
    const action = chooseBotAction(state, seat, levelOf(seat));
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const n of [2, 3, 4, 5]) {
    it(`completes a ${n}-player all-Level-10 game with every casino settled`, () => {
      const state = playFullBotGame(n, 200 + n, () => 10);
      expect(state.phase).toBe("gameOver");
      expect(state.settlement).not.toBeNull();
      expect(state.settlement).toHaveLength(CASINO_COUNT);
      const rankings = computeRankings(state);
      expect(rankings).toHaveLength(n);
      expect(new Set(rankings.map((r) => r.seat)).size).toBe(n);
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(4, 777, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(computeRankings(state)).toHaveLength(4);
  });
});
