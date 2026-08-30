import { describe, expect, it } from "vitest";
import {
  applyAction,
  calculateExpeditionBreakdown,
  calculateExpeditionScore,
  calculateTotalScore,
  canPlayToExpedition,
  chooseBotAction,
  COLORS,
  getValidMoves,
  otherSeat,
  scoreBreakdownForSeat,
  seededRng,
  startGame,
  type Card,
  type Color,
  type EngineAction,
  type LostCitiesState,
  type Seat,
} from "./engine";

function num(color: Color, value: number): Card {
  return { id: `${color}-${value}`, color, kind: "number", value };
}
function inv(color: Color, n: number): Card {
  return { id: `${color}-inv-${n}`, color, kind: "investment" };
}

/** A minimal, fully-specified state for unit-testing individual actions in isolation, independent of `startGame`'s shuffle. */
function baseState(overrides: Partial<LostCitiesState> = {}): LostCitiesState {
  const emptyByColor = () => ({ white: [] as Card[], green: [] as Card[], yellow: [] as Card[], red: [] as Card[], blue: [] as Card[] });
  return {
    deck: [],
    discardPiles: emptyByColor(),
    hands: { p1: [], p2: [] },
    expeditions: { p1: emptyByColor(), p2: emptyByColor() },
    activeSeat: "p1",
    turnPhase: "PLAY_OR_DISCARD",
    justDiscardedColor: null,
    turnNumber: 1,
    phase: "playing",
    winner: null,
    isDraw: false,
    ...overrides,
  };
}

describe("scoring (rulebook §6 worked examples)", () => {
  it("example 1: invest×2, numbers [4,6,7,9,10] (7 cards) -> +48", () => {
    const cards = [inv("red", 0), inv("red", 1), num("red", 4), num("red", 6), num("red", 7), num("red", 9), num("red", 10)];
    const b = calculateExpeditionBreakdown("red", cards);
    expect(b.numberSum).toBe(36);
    expect(b.multiplier).toBe(3);
    expect(b.baseScore).toBe(48);
    expect(b.bonus).toBe(0);
    expect(b.total).toBe(48);
  });

  it("example 2: invest×1, numbers [2,5,6] (4 cards) -> -14", () => {
    const cards = [inv("blue", 0), num("blue", 2), num("blue", 5), num("blue", 6)];
    expect(calculateExpeditionScore(cards)).toBe(-14);
  });

  it("example 3: invest×1, numbers [2..8] (8 cards) -> +50 (with 8-card bonus)", () => {
    const cards = [inv("green", 0), num("green", 2), num("green", 3), num("green", 4), num("green", 5), num("green", 6), num("green", 7), num("green", 8)];
    const b = calculateExpeditionBreakdown("green", cards);
    expect(b.baseScore).toBe(30);
    expect(b.bonus).toBe(20);
    expect(b.total).toBe(50);
  });

  it("an untouched lane scores exactly 0, not -20", () => {
    expect(calculateExpeditionScore([])).toBe(0);
  });

  it("calculateTotalScore sums all 5 lanes", () => {
    const state = baseState();
    state.expeditions.p1.red = [num("red", 5), num("red", 8)]; // (13-20)*1 = -7
    state.expeditions.p1.blue = [inv("blue", 0), num("blue", 9)]; // (9-20)*2 = -22
    expect(calculateTotalScore(state, "p1")).toBe(-29);
    expect(scoreBreakdownForSeat(state, "p1").find((b) => b.color === "red")!.total).toBe(-7);
  });
});

describe("startGame determinism", () => {
  it("same seed produces an identical initial state", () => {
    const a = startGame(seededRng(42));
    const b = startGame(seededRng(42));
    expect(a).toEqual(b);
  });

  it("deals 8 cards per seat and a 44-card draw pile (60 total)", () => {
    const s = startGame(seededRng(1));
    expect(s.hands.p1).toHaveLength(8);
    expect(s.hands.p2).toHaveLength(8);
    expect(s.deck).toHaveLength(44);
    const allIds = new Set([...s.hands.p1, ...s.hands.p2, ...s.deck].map((c) => c.id));
    expect(allIds.size).toBe(60);
  });
});

describe("play-expedition validation (§4)", () => {
  it("rejects a non-ascending number card", () => {
    const state = baseState({ hands: { p1: [num("red", 3)], p2: [] } });
    state.expeditions.p1.red = [num("red", 5)];
    const next = applyAction(state, { type: "play-expedition", cardId: "red-3" });
    expect(next).toBe(state); // no-op
  });

  it("accepts a higher number card, skipping intermediate values", () => {
    const state = baseState({ hands: { p1: [num("red", 7)], p2: [] } });
    state.expeditions.p1.red = [num("red", 2)];
    const next = applyAction(state, { type: "play-expedition", cardId: "red-7" });
    expect(next.expeditions.p1.red.map((c) => c.id)).toEqual(["red-2", "red-7"]);
    expect(next.turnPhase).toBe("DRAW");
    expect(next.hands.p1).toHaveLength(0);
  });

  it("allows up to 3 investment cards before any number card", () => {
    const state = baseState({ hands: { p1: [inv("blue", 1)], p2: [] } });
    state.expeditions.p1.blue = [inv("blue", 0)];
    const next = applyAction(state, { type: "play-expedition", cardId: "blue-inv-1" });
    expect(next.expeditions.p1.blue).toHaveLength(2);
  });

  it("rejects an investment card once a number card is already down", () => {
    const state = baseState({ hands: { p1: [inv("blue", 0)], p2: [] } });
    state.expeditions.p1.blue = [num("blue", 4)];
    const next = applyAction(state, { type: "play-expedition", cardId: "blue-inv-0" });
    expect(next).toBe(state);
  });

  it("canPlayToExpedition mirrors applyPlayExpedition's own gate exactly", () => {
    const state = baseState({ hands: { p1: [num("yellow", 3)], p2: [] } });
    expect(canPlayToExpedition(state, "p1", num("yellow", 3))).toBe(true);
    state.expeditions.p1.yellow = [num("yellow", 5)];
    expect(canPlayToExpedition(state, "p1", num("yellow", 3))).toBe(false);
  });
});

describe("discard + draw turn flow (§4)", () => {
  it("discard moves the card to the top of that color's pile and opens DRAW phase", () => {
    const state = baseState({ hands: { p1: [num("green", 4)], p2: [] } });
    const next = applyAction(state, { type: "discard", cardId: "green-4" });
    expect(next.discardPiles.green.map((c) => c.id)).toEqual(["green-4"]);
    expect(next.turnPhase).toBe("DRAW");
    expect(next.justDiscardedColor).toBe("green");
  });

  it("forbids immediately re-drawing the card just discarded this same turn", () => {
    const discarded = num("green", 4);
    const state = baseState({
      turnPhase: "DRAW",
      justDiscardedColor: "green",
      discardPiles: { white: [], green: [discarded], yellow: [], red: [], blue: [] },
    });
    const next = applyAction(state, { type: "draw-discard", color: "green" });
    expect(next).toBe(state); // no-op
  });

  it("allows drawing a *different* color's discard pile the same turn", () => {
    const state = baseState({
      turnPhase: "DRAW",
      justDiscardedColor: "green",
      discardPiles: { white: [num("white", 6)], green: [num("green", 4)], yellow: [], red: [], blue: [] },
      hands: { p1: [], p2: [] },
    });
    const next = applyAction(state, { type: "draw-discard", color: "white" });
    expect(next.hands.p1.map((c) => c.id)).toEqual(["white-6"]);
    expect(next.activeSeat).toBe("p2"); // turn passes
    expect(next.justDiscardedColor).toBeNull(); // cleared once the turn actually passes
  });

  it("a fresh turn (no discard this turn) never blocks any discard-pile color", () => {
    const state = baseState({
      turnPhase: "DRAW",
      justDiscardedColor: null,
      discardPiles: { white: [], green: [num("green", 4)], yellow: [], red: [], blue: [] },
    });
    const next = applyAction(state, { type: "draw-discard", color: "green" });
    expect(next.hands.p1).toHaveLength(1);
  });
});

describe("deck exhaustion ends the game (§5)", () => {
  it("drawing the last deck card ends the game immediately, no turn handoff", () => {
    const state = baseState({ turnPhase: "DRAW", deck: [num("red", 9)] });
    state.expeditions.p1.red = [num("red", 2), num("red", 5)]; // (7-20)*1 = -13
    const next = applyAction(state, { type: "draw-deck" });
    expect(next.phase).toBe("gameOver");
    expect(next.deck).toHaveLength(0);
    expect(next.activeSeat).toBe("p1"); // no handoff — game is over
    expect(next.winner).toBe("p2"); // p1 total -13, p2 total 0
    expect(next.isDraw).toBe(false);
  });

  it("an exact tie is recorded as a draw", () => {
    const state = baseState({ turnPhase: "DRAW", deck: [num("red", 9)] });
    const next = applyAction(state, { type: "draw-deck" });
    expect(next.phase).toBe("gameOver");
    expect(next.isDraw).toBe(true);
    expect(next.winner).toBeNull();
  });

  it("drawing when the deck still has cards left after just continues the turn", () => {
    const state = baseState({ turnPhase: "DRAW", deck: [num("red", 9), num("blue", 3)] });
    const next = applyAction(state, { type: "draw-deck" });
    expect(next.phase).toBe("playing");
    expect(next.activeSeat).toBe("p2");
    expect(next.turnPhase).toBe("PLAY_OR_DISCARD");
  });
});

describe("getValidMoves (ARCHITECTURE.md §7.1)", () => {
  it("returns nothing for the seat not currently acting", () => {
    const state = baseState({ activeSeat: "p1", hands: { p1: [num("red", 4)], p2: [num("blue", 5)] } });
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("returns nothing once the game is over", () => {
    const state = baseState({ phase: "gameOver", winner: "p1", hands: { p1: [num("red", 4)], p2: [] } });
    expect(getValidMoves(state, "p1")).toEqual([]);
  });

  it("PLAY_OR_DISCARD phase always offers discard for every hand card, plus play-expedition where legal", () => {
    const state = baseState({ hands: { p1: [num("red", 4), num("red", 2)], p2: [] } });
    state.expeditions.p1.red = [num("red", 3)];
    const moves = getValidMoves(state, "p1");
    expect(moves).toContainEqual({ type: "discard", cardId: "red-4" });
    expect(moves).toContainEqual({ type: "discard", cardId: "red-2" });
    expect(moves).toContainEqual({ type: "play-expedition", cardId: "red-4" });
    expect(moves).not.toContainEqual({ type: "play-expedition", cardId: "red-2" }); // 2 < 3, illegal
  });

  it("DRAW phase excludes the just-discarded color and empty piles", () => {
    const state = baseState({
      turnPhase: "DRAW",
      justDiscardedColor: "green",
      deck: [num("red", 9)],
      discardPiles: { white: [], green: [num("green", 4)], yellow: [num("yellow", 3)], red: [], blue: [] },
    });
    const moves = getValidMoves(state, "p1");
    expect(moves).toContainEqual({ type: "draw-deck" });
    expect(moves).toContainEqual({ type: "draw-discard", color: "yellow" });
    expect(moves).not.toContainEqual({ type: "draw-discard", color: "green" });
    expect(moves).not.toContainEqual({ type: "draw-discard", color: "white" });
  });
});

describe("chooseBotAction (ARCHITECTURE.md §7.1/§7.4)", () => {
  it("always returns a legal move for every difficulty level", () => {
    const state = startGame(seededRng(7));
    for (const level of [1, 5, 10]) {
      const move = chooseBotAction(state, state.activeSeat, level, seededRng(level));
      expect(move).not.toBeNull();
      expect(getValidMoves(state, state.activeSeat)).toContainEqual(move);
    }
  });

  it("returns null when the seat has no legal move to make (not its turn)", () => {
    const state = startGame(seededRng(7));
    const idleSeat = otherSeat(state.activeSeat);
    expect(chooseBotAction(state, idleSeat, 5)).toBeNull();
  });
});

describe("full bot-vs-bot playthrough", () => {
  it.each([
    [123, 5, 5],
    [7, 1, 10],
    [55, 10, 1],
    [2026, 3, 8],
    [8080, 10, 10],
  ])("seed=%i p1Lv=%i p2Lv=%i terminates cleanly with a consistent final score, no exceptions/NaN/infinite loop", (seed, p1Level, p2Level) => {
    let state: LostCitiesState = startGame(seededRng(seed));
    const rng = seededRng(seed * 31 + 1);
    const levels: Record<Seat, number> = { p1: p1Level, p2: p2Level };
    let guard = 0;
    while (state.phase === "playing") {
      guard++;
      if (guard > 5000) throw new Error("bot playthrough did not terminate");
      const seat: Seat = state.activeSeat;
      const action: EngineAction | null = chooseBotAction(state, seat, levels[seat], rng);
      expect(action).not.toBeNull();
      state = applyAction(state, action!);
    }
    expect(state.deck).toHaveLength(0);
    const p1Total = calculateTotalScore(state, "p1");
    const p2Total = calculateTotalScore(state, "p2");
    expect(Number.isFinite(p1Total)).toBe(true);
    expect(Number.isFinite(p2Total)).toBe(true);
    if (state.isDraw) {
      expect(p1Total).toBe(p2Total);
      expect(state.winner).toBeNull();
    } else {
      expect(state.winner).toBe(p1Total > p2Total ? "p1" : "p2");
    }
    // Every color's total in the breakdown must reconcile with the sum used for the winner check.
    const breakdownTotal = scoreBreakdownForSeat(state, "p1").reduce((s, b) => s + b.total, 0);
    expect(breakdownTotal).toBe(p1Total);
    expect(COLORS).toHaveLength(5);
  });
});
