import { describe, expect, it } from "vitest";
import { detectAuctionEvent } from "./AuctionEffects";
import { applyAction, startGame, type NoThanksState } from "./engine";

function makeState(overrides: Partial<NoThanksState> = {}): NoThanksState {
  return {
    playerCount: 3,
    players: [
      { seat: 0, chips: 11, cards: [] },
      { seat: 1, chips: 11, cards: [] },
      { seat: 2, chips: 11, cards: [] },
    ],
    deck: [10, 11, 12],
    currentCard: 9,
    chipsOnCard: 0,
    activeSeat: 0,
    phase: "playing",
    removedCards: [],
    chipVisibility: "secret",
    ...overrides,
  };
}

describe("detectAuctionEvent", () => {
  it("returns null when the reference hasn't changed (e.g. a rejected no-op action)", () => {
    const state = makeState();
    expect(detectAuctionEvent(state, state)).toBeNull();
  });

  it("detects a pass and attributes it to the seat that WAS active (not the new active seat)", () => {
    const prev = makeState({ activeSeat: 1, chipsOnCard: 2 });
    const next = applyAction(prev, { type: "pass", seat: 1 });
    const event = detectAuctionEvent(prev, next);
    expect(event).toEqual({ kind: "pass", seat: 1, coinCount: 1, cardValue: null });
  });

  it("detects a take, attributing the chips that WERE on the card and the card that WAS current", () => {
    const prev = makeState({ activeSeat: 2, currentCard: 20, chipsOnCard: 4, deck: [21, 22] });
    const next = applyAction(prev, { type: "take", seat: 2 });
    const event = detectAuctionEvent(prev, next);
    expect(event).toEqual({ kind: "take", seat: 2, coinCount: 4, cardValue: 20 });
  });

  it("still detects a take that empties the deck, even though the resulting state has no next card", () => {
    const prev = makeState({ activeSeat: 0, currentCard: 35, chipsOnCard: 1, deck: [] });
    const next = applyAction(prev, { type: "take", seat: 0 });
    expect(next.phase).toBe("gameOver");
    // The board swaps to the scoring screen the instant this arrives, so the
    // seat elements the animation would fly toward are already gone —
    // detectAuctionEvent deliberately suppresses this last transition.
    expect(detectAuctionEvent(prev, next)).toBeNull();
  });

  it("returns null across a rematch/fresh startGame, even though every field changes", () => {
    const finished = makeState({
      phase: "gameOver",
      currentCard: null,
      deck: [],
      players: [
        { seat: 0, chips: 3, cards: [9, 10, 20] },
        { seat: 1, chips: 5, cards: [15] },
        { seat: 2, chips: 2, cards: [3, 4] },
      ],
    });
    const rematch = startGame(3, 42);
    expect(detectAuctionEvent(finished, rematch)).toBeNull();
  });

  it("is a no-op-safe when passed two states that are neither a pass nor a take (defensive)", () => {
    const prev = makeState({ chipsOnCard: 3 });
    const weird = { ...prev, activeSeat: 1 }; // some other kind of change, not a real transition
    expect(detectAuctionEvent(prev, weird)).toBeNull();
  });
});
