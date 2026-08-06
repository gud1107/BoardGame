import { describe, expect, it } from "vitest";
import {
  applyAction,
  CARD_MAX,
  CARD_MIN,
  computeGroups,
  computePlayerScore,
  computeRankings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REMOVE_COUNT,
  startGame,
  startingChips,
  type NoThanksState,
  type PlayerState,
} from "./engine";

function makeState(overrides: Partial<NoThanksState> = {}): NoThanksState {
  const players: PlayerState[] = [
    { seat: 0, chips: 11, cards: [] },
    { seat: 1, chips: 11, cards: [] },
    { seat: 2, chips: 11, cards: [] },
  ];
  return {
    playerCount: 3,
    players,
    deck: [10, 11, 12],
    currentCard: 9,
    chipsOnCard: 0,
    activeSeat: 0,
    phase: "playing",
    removedCards: [],
    ...overrides,
  };
}

describe("startGame — setup", () => {
  it("removes exactly 9 cards and deals a 24-card deck (deck + currentCard)", () => {
    const state = startGame(4, 1);
    expect(state.removedCards).toHaveLength(REMOVE_COUNT);
    expect(state.deck.length + 1).toBe(33 - REMOVE_COUNT); // +1 for currentCard already revealed
  });

  it("removed cards and dealt cards never overlap and together cover the full 3-35 range exactly once", () => {
    const state = startGame(5, 42);
    const dealt = [...state.deck, state.currentCard!];
    const all = [...state.removedCards, ...dealt].sort((a, b) => a - b);
    const expected = Array.from({ length: CARD_MAX - CARD_MIN + 1 }, (_, i) => i + CARD_MIN);
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(expected.length); // no duplicates
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(6, 777);
    const b = startGame(6, 777);
    expect(a).toEqual(b);
  });

  it("gives different removed-card sets for different seeds (sanity, not guaranteed but astronomically likely)", () => {
    const a = startGame(4, 1);
    const b = startGame(4, 2);
    expect(a.removedCards).not.toEqual(b.removedCards);
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(2, 1)).toThrow();
    expect(() => startGame(8, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(3);
    expect(MAX_PLAYERS).toBe(7);
  });

  it.each([
    [3, 11],
    [4, 11],
    [5, 11],
    [6, 9],
    [7, 7],
  ])("gives %i players %i starting chips each", (playerCount, chips) => {
    const state = startGame(playerCount, 1);
    expect(startingChips(playerCount)).toBe(chips);
    expect(state.players.every((p) => p.chips === chips)).toBe(true);
  });

  it("starts every player with an empty hand and reveals one current card with zero chips on it", () => {
    const state = startGame(3, 1);
    expect(state.players.every((p) => p.cards.length === 0)).toBe(true);
    expect(state.chipsOnCard).toBe(0);
    expect(state.currentCard).not.toBeNull();
    expect(state.phase).toBe("playing");
  });
});

describe("pass (No Thanks!)", () => {
  it("moves 1 chip from the active player onto the card and advances the turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "pass", seat: 0 });
    expect(next.players[0].chips).toBe(10);
    expect(next.chipsOnCard).toBe(1);
    expect(next.activeSeat).toBe(1);
    expect(next.currentCard).toBe(9); // card itself doesn't change on a pass
  });

  it("wraps the turn back to seat 0 after the last seat passes", () => {
    const state = makeState({ activeSeat: 2, playerCount: 3 });
    const next = applyAction(state, { type: "pass", seat: 2 });
    expect(next.activeSeat).toBe(0);
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "pass", seat: 1 });
    expect(next).toEqual(state);
  });

  it("forces a take instead: passing with 0 chips is rejected as a no-op", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 0, cards: [] },
        { seat: 1, chips: 11, cards: [] },
        { seat: 2, chips: 11, cards: [] },
      ],
      activeSeat: 0,
    });
    const next = applyAction(state, { type: "pass", seat: 0 });
    expect(next).toEqual(state); // rejected — must call "take" instead
  });
});

describe("take (인수하기)", () => {
  it("gives the active player the card and every chip stacked on it", () => {
    const state = makeState({ activeSeat: 1, chipsOnCard: 3, currentCard: 9, deck: [10, 11] });
    const next = applyAction(state, { type: "take", seat: 1 });
    expect(next.players[1].cards).toEqual([9]);
    expect(next.players[1].chips).toBe(14); // 11 + 3
    expect(next.chipsOnCard).toBe(0);
  });

  it("immediately reveals the next deck card and gives the SAME player another turn", () => {
    const state = makeState({ activeSeat: 2, currentCard: 9, deck: [10, 11] });
    const next = applyAction(state, { type: "take", seat: 2 });
    expect(next.currentCard).toBe(10);
    expect(next.deck).toEqual([11]);
    expect(next.activeSeat).toBe(2); // unchanged — same player keeps going
    expect(next.phase).toBe("playing");
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "take", seat: 1 });
    expect(next).toEqual(state);
  });

  it("keeps cards sorted ascending as more are taken", () => {
    let state = makeState({
      activeSeat: 0,
      currentCard: 20,
      deck: [5],
      players: [
        { seat: 0, chips: 11, cards: [30] },
        { seat: 1, chips: 11, cards: [] },
        { seat: 2, chips: 11, cards: [] },
      ],
    });
    state = applyAction(state, { type: "take", seat: 0 });
    expect(state.players[0].cards).toEqual([20, 30]);
  });

  it("ends the game the instant the last deck card is taken", () => {
    const state = makeState({ activeSeat: 0, currentCard: 35, deck: [] });
    const next = applyAction(state, { type: "take", seat: 0 });
    expect(next.phase).toBe("gameOver");
    expect(next.currentCard).toBeNull();
    expect(next.players[0].cards).toEqual([35]);
  });
});

describe("full game exhaustion", () => {
  it("distributes exactly 24 cards total across all players by the time the game ends", () => {
    let state = startGame(4, 123);
    let guard = 0;
    while (state.phase === "playing" && guard < 500) {
      // Deterministic policy: always take. Guarantees termination regardless
      // of chip counts (taking never requires spending a chip).
      state = applyAction(state, { type: "take", seat: state.activeSeat });
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    const totalCardsHeld = state.players.reduce((sum, p) => sum + p.cards.length, 0);
    expect(totalCardsHeld).toBe(33 - REMOVE_COUNT);
  });

  it("also terminates under a mixed pass/take policy without ever going negative on chips", () => {
    let state = startGame(3, 999);
    let guard = 0;
    while (state.phase === "playing" && guard < 1000) {
      const player = state.players[state.activeSeat];
      const action = player.chips > 0 && state.currentCard! % 2 === 0 ? "pass" : "take";
      state = applyAction(state, { type: action, seat: state.activeSeat });
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    expect(state.players.every((p) => p.chips >= 0)).toBe(true);
    const totalCardsHeld = state.players.reduce((sum, p) => sum + p.cards.length, 0);
    expect(totalCardsHeld).toBe(33 - REMOVE_COUNT);
  });
});

describe("computeGroups — consecutive-run scoring", () => {
  it("treats a lone card as its own group", () => {
    expect(computeGroups([15])).toEqual([{ cards: [15], penaltyCard: 15 }]);
  });

  it("collapses a run of 3+ consecutive numbers into one group scored by the smallest", () => {
    // Rulebook's own worked example: 13,14,15,16 -> only 13 counts.
    expect(computeGroups([13, 14, 15, 16])).toEqual([{ cards: [13, 14, 15, 16], penaltyCard: 13 }]);
  });

  it("does NOT merge a run when the middle number is missing (removed at setup)", () => {
    // 21,22 would be consecutive, but 23 is missing so a lone 24 stays separate.
    expect(computeGroups([21, 22, 24])).toEqual([
      { cards: [21, 22], penaltyCard: 21 },
      { cards: [24], penaltyCard: 24 },
    ]);
  });

  it("handles unsorted input and multiple separate runs", () => {
    expect(computeGroups([9, 7, 8, 29, 28, 15])).toEqual([
      { cards: [7, 8, 9], penaltyCard: 7 },
      { cards: [15], penaltyCard: 15 },
      { cards: [28, 29], penaltyCard: 28 },
    ]);
  });

  it("returns an empty array for an empty hand", () => {
    expect(computeGroups([])).toEqual([]);
  });
});

describe("computePlayerScore — matches the rulebook's worked example exactly", () => {
  it("7,8,9,15,28,29 with 6 chips -> penalty 50, total 44", () => {
    const score = computePlayerScore({ seat: 0, chips: 6, cards: [7, 8, 9, 15, 28, 29] });
    expect(score.cardPenalty).toBe(50); // 7 + 15 + 28
    expect(score.total).toBe(44); // 50 - 6
    expect(score.groups).toHaveLength(3);
  });

  it("more chips can push the total below zero", () => {
    const score = computePlayerScore({ seat: 0, chips: 20, cards: [5] });
    expect(score.total).toBe(-15);
  });

  it("an empty hand scores 0 penalty minus chips", () => {
    const score = computePlayerScore({ seat: 0, chips: 4, cards: [] });
    expect(score.cardPenalty).toBe(0);
    expect(score.total).toBe(-4);
  });
});

describe("computeRankings", () => {
  it("ranks strictly by lower total first", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 5, cards: [10] }, // total 5
        { seat: 1, chips: 0, cards: [3] }, // total 3
        { seat: 2, chips: 2, cards: [20] }, // total 18
      ],
    });
    const rankings = computeRankings(state);
    expect(rankings.map((r) => r.seat)).toEqual([1, 0, 2]);
    expect(rankings.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a tied total by more remaining chips", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 10, cards: [15] }, // total 5
        { seat: 1, chips: 2, cards: [7] }, // total 5
        { seat: 2, chips: 11, cards: [30] }, // total 19
      ],
    });
    const rankings = computeRankings(state);
    // seat 0 has more chips than seat 1 despite an identical total -> ranks ahead
    expect(rankings[0].seat).toBe(0);
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].seat).toBe(1);
    expect(rankings[1].rank).toBe(2);
  });

  it("gives a true co-rank (standard competition ranking) when total AND chips are both equal", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 5, cards: [10] }, // total 5
        { seat: 1, chips: 5, cards: [10] }, // total 5, identical
        { seat: 2, chips: 0, cards: [20] }, // total 20
      ],
    });
    const rankings = computeRankings(state);
    const bySeat = Object.fromEntries(rankings.map((r) => [r.seat, r.rank]));
    expect(bySeat[0]).toBe(1);
    expect(bySeat[1]).toBe(1);
    expect(bySeat[2]).toBe(3); // standard competition ranking skips rank 2
  });
});
