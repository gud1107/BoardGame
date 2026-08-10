import { describe, expect, it } from "vitest";
import {
  aliveSeats,
  applyAction,
  buildDeck,
  computeRankings,
  DECK_SIZE,
  getPlayerView,
  isForcedCountess,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  validTargets,
  type Card,
  type LoveLetterState,
  type PlayerState,
} from "./engine";

function card(id: number, number: Card["number"]): Card {
  return { id, number };
}

function player(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    seat,
    hand: [],
    alive: true,
    protectedUntilNextTurn: false,
    discardPile: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<LoveLetterState> = {}): LoveLetterState {
  const players: PlayerState[] = [player(0), player(1), player(2)];
  return {
    playerCount: 3,
    players,
    deck: [card(100, 1), card(101, 1)],
    removedCard: card(200, 1),
    removedCardUsed: false,
    visibleRemovedCards: [],
    activeSeat: 0,
    phase: "playing",
    turnNumber: 1,
    lastEvent: null,
    eliminationOrder: [],
    winnerSeats: [],
    endReason: null,
    ...overrides,
  };
}

describe("buildDeck — 룰북 §1 구성물 (총 16장)", () => {
  it("builds exactly 16 cards", () => {
    expect(buildDeck()).toHaveLength(16);
    expect(DECK_SIZE).toBe(16);
  });

  it("matches the per-character counts (5/2/2/2/2/1/1/1)", () => {
    const deck = buildDeck();
    const counts: Record<number, number> = { 1: 5, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1 };
    for (const [number, expected] of Object.entries(counts)) {
      expect(deck.filter((c) => c.number === Number(number))).toHaveLength(expected);
    }
  });

  it("gives every card a unique id", () => {
    const ids = buildDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("startGame — 세팅 (§2)", () => {
  it("rejects out-of-range player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(5, 1)).toThrow();
  });

  it("is deterministic for a fixed seed", () => {
    const a = startGame(4, 42);
    const b = startGame(4, 42);
    expect(a).toEqual(b);
  });

  it("deals every card to exactly one place with no duplicates, across 2~4 players", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const state = startGame(n, 777 + n);
      const allCards = [
        state.removedCard,
        ...state.visibleRemovedCards,
        ...state.deck,
        ...state.players.flatMap((p) => p.hand),
      ];
      expect(allCards).toHaveLength(DECK_SIZE);
      expect(new Set(allCards.map((c) => c.id)).size).toBe(DECK_SIZE);
    }
  });

  it("burns exactly 1 hidden card always, plus 3 visible ones only at 2 players (§2-3)", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const state = startGame(n, 5);
      expect(state.removedCard).toBeDefined();
      expect(state.visibleRemovedCards).toHaveLength(n === 2 ? 3 : 0);
    }
  });

  it("deals 1 card to every seat, then draws a 2nd for the starting seat only (§3)", () => {
    const state = startGame(4, 9);
    for (const p of state.players) {
      expect(p.hand).toHaveLength(p.seat === state.activeSeat ? 2 : 1);
    }
  });

  it("leaves the draw pile at deck size minus removed cards minus dealt hands", () => {
    const state3 = startGame(3, 1);
    // 16 - 1(hidden) - 3(hands) - 1(starter's 2nd draw) = 11
    expect(state3.deck).toHaveLength(11);
    const state2 = startGame(2, 1);
    // 16 - 1(hidden) - 3(visible) - 2(hands) - 1(starter's 2nd draw) = 9
    expect(state2.deck).toHaveLength(9);
  });
});

describe("isForcedCountess / validTargets — §4 helpers", () => {
  it("forces the Countess when held with a Prince or King", () => {
    expect(isForcedCountess([card(1, 7), card(2, 5)])).toBe(true);
    expect(isForcedCountess([card(1, 7), card(2, 6)])).toBe(true);
    expect(isForcedCountess([card(1, 7), card(2, 1)])).toBe(false);
    expect(isForcedCountess([card(1, 5), card(2, 6)])).toBe(false);
  });

  it("excludes the actor and protected seats from Guard/Priest/Baron/King targets", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 3), card(2, 4)] }), player(1, { protectedUntilNextTurn: true }), player(2)],
    });
    expect(validTargets(state, 0, 1)).toEqual([2]);
  });

  it("includes the actor as a valid Prince (5) target alongside others", () => {
    const state = makeState({ players: [player(0), player(1), player(2)] });
    expect(validTargets(state, 0, 5)).toEqual([0, 1, 2]);
  });

  it("returns no targets for Guard/Priest/Baron/King when every other seat is protected", () => {
    const state = makeState({
      players: [player(0), player(1, { protectedUntilNextTurn: true }), player(2, { protectedUntilNextTurn: true })],
    });
    expect(validTargets(state, 0, 1)).toEqual([]);
    expect(validTargets(state, 0, 6)).toEqual([]);
    // Prince still has the actor themself.
    expect(validTargets(state, 0, 5)).toEqual([0]);
  });
});

describe("playCard — 1. 경비병 (Guard)", () => {
  it("eliminates the target on a correct guess", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 1), card(2, 9 as never)] }), player(1, { hand: [card(3, 5)] }), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1, guessNumber: 5 });
    expect(next.players.find((p) => p.seat === 1)!.alive).toBe(false);
    expect(next.lastEvent).toMatchObject({ type: "guard", correct: true, targetSeat: 1, guess: 5 });
    // the eliminated seat's held card lands face-up in their own discard pile (module doc #1)
    expect(next.players.find((p) => p.seat === 1)!.discardPile).toContainEqual(card(3, 5));
  });

  it("does nothing to the target on a wrong guess", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 1), card(2, 2)] }), player(1, { hand: [card(3, 5)] }), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1, guessNumber: 3 });
    expect(next.players.find((p) => p.seat === 1)!.alive).toBe(true);
    expect(next.lastEvent).toMatchObject({ type: "guard", correct: false });
  });

  it("rejects guessing 1 (경비병 자기 자신은 제외)", () => {
    const state = makeState({ players: [player(0, { hand: [card(1, 1), card(2, 2)] }), player(1, { hand: [card(3, 5)] }), player(2)] });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1, guessNumber: 1 });
    expect(next).toBe(state); // rejected, unchanged
  });

  it("fizzles with no target when every other seat is protected, and rejects an explicit target in that case", () => {
    const state = makeState({
      players: [
        player(0, { hand: [card(1, 1), card(2, 2)] }),
        player(1, { hand: [card(3, 5)], protectedUntilNextTurn: true }),
        player(2, { protectedUntilNextTurn: true }),
      ],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1 });
    expect(next.lastEvent).toMatchObject({ type: "guard", fizzled: true, targetSeat: null });
    const rejected = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1, guessNumber: 5 });
    expect(rejected).toBe(state);
  });
});

describe("playCard — 2. 사제 (Priest)", () => {
  it("reveals the target's card in lastEvent, but getPlayerView hides it from everyone except the actor", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 2), card(2, 4)] }), player(1, { hand: [card(3, 6)] }), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(next.lastEvent).toMatchObject({ type: "priest", peekedCard: card(3, 6) });
    expect(getPlayerView(next, 0).lastEvent).toMatchObject({ peekedCard: card(3, 6) });
    expect(getPlayerView(next, 1).lastEvent).toMatchObject({ peekedCard: null });
    expect(getPlayerView(next, 2).lastEvent).toMatchObject({ peekedCard: null });
  });
});

describe("playCard — 3. 남작 (Baron)", () => {
  it("eliminates the lower hand", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 3), card(2, 2)] }), player(1, { hand: [card(3, 6)] }), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(next.players.find((p) => p.seat === 0)!.alive).toBe(false);
    expect(next.players.find((p) => p.seat === 1)!.alive).toBe(true);
    expect(next.lastEvent).toMatchObject({ type: "baron", outcome: "actorEliminated" });
  });

  it("eliminates nobody on a tie (§4 3번)", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 3), card(2, 5)] }), player(1, { hand: [card(3, 5)] }), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(next.players.find((p) => p.seat === 0)!.alive).toBe(true);
    expect(next.players.find((p) => p.seat === 1)!.alive).toBe(true);
    expect(next.lastEvent).toMatchObject({ type: "baron", outcome: "tie" });
  });
});

describe("playCard — 4. 하녀 (Handmaid)", () => {
  it("protects the actor until their own next turn, and clears once that next turn is actually played", () => {
    const state = makeState({
      players: [
        player(0, { hand: [card(1, 4), card(2, 7)] }),
        player(1, { hand: [card(60, 7)] }),
        player(2, { hand: [card(61, 7)] }),
      ],
      deck: [card(70, 3), card(71, 5), card(72, 6)],
    });
    const t1 = applyAction(state, { type: "playCard", seat: 0, cardId: 1 });
    expect(t1.players.find((p) => p.seat === 0)!.protectedUntilNextTurn).toBe(true);
    expect(t1.activeSeat).toBe(1);

    const t2 = applyAction(t1, { type: "playCard", seat: 1, cardId: 60 });
    expect(t2.activeSeat).toBe(2);

    const t3 = applyAction(t2, { type: "playCard", seat: 2, cardId: 61 });
    expect(t3.activeSeat).toBe(0);
    expect(t3.players.find((p) => p.seat === 0)!.protectedUntilNextTurn).toBe(true); // still protected until they actually act

    const t4 = applyAction(t3, { type: "playCard", seat: 0, cardId: 2 }); // forced Countess (holds 7 + the drawn 6/King)
    expect(t4.players.find((p) => p.seat === 0)!.protectedUntilNextTurn).toBe(false);
  });
});

describe("playCard — 5. 왕자 (Prince)", () => {
  it("forces the target to discard and draw a fresh card", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 5), card(2, 2)] }), player(1, { hand: [card(3, 6)] }), player(2, { hand: [card(9, 3)] })],
      deck: [card(50, 3)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    const target = next.players.find((p) => p.seat === 1)!;
    expect(target.discardPile).toContainEqual(card(3, 6));
    expect(target.hand).toEqual([card(50, 3)]);
    expect(next.lastEvent).toMatchObject({ type: "prince", discardedCard: card(3, 6) });
  });

  it("eliminates the target immediately if the discarded card was the Princess (8), with no redraw", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 5), card(2, 2)] }), player(1, { hand: [card(3, 8)] }), player(2, { hand: [card(9, 3)] })],
      deck: [card(50, 3)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    const target = next.players.find((p) => p.seat === 1)!;
    expect(target.alive).toBe(false);
    expect(target.hand).toEqual([]);
    expect(target.discardPile).toContainEqual(card(3, 8));
    expect(next.lastEvent).toMatchObject({ type: "prince", eliminatedPrincess: true, newCard: null });
    // Prince's own effect never touched the deck (no redraw for an eliminated
    // target) — the card it still lost went to the *next* active seat's
    // ordinary turn-opening draw when play continued, not to this effect.
    expect(next.deck).toHaveLength(0);
    expect(next.players.find((p) => p.seat === 2)!.hand).toContainEqual(card(50, 3));
  });

  it("must target self when every other seat is protected", () => {
    const state = makeState({
      players: [
        player(0, { hand: [card(1, 5), card(2, 2)] }),
        player(1, { hand: [card(9, 3)], protectedUntilNextTurn: true }),
        player(2, { hand: [card(10, 4)], protectedUntilNextTurn: true }),
      ],
      deck: [card(50, 3)],
    });
    const rejectOther = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(rejectOther).toBe(state);
    const self = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 0 });
    const actor = self.players.find((p) => p.seat === 0)!;
    expect(actor.hand).toEqual([card(50, 3)]);
  });

  it("draws from the burned reserve card when the main deck is empty (module doc #4)", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 5), card(2, 2)] }), player(1, { hand: [card(3, 6)] }), player(2, { hand: [card(9, 3)] })],
      deck: [],
      removedCard: card(999, 7),
      removedCardUsed: false,
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    const target = next.players.find((p) => p.seat === 1)!;
    expect(target.hand).toEqual([card(999, 7)]);
    expect(next.removedCardUsed).toBe(true);
    expect(next.lastEvent).toMatchObject({ type: "prince", usedReserve: true });
  });

  it("getPlayerView hides the target's newly drawn card from everyone except the target", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 5), card(2, 2)] }), player(1, { hand: [card(3, 6)] }), player(2, { hand: [card(9, 3)] })],
      // 2 cards: one for Prince's own redraw, one left over so the round
      // doesn't hit "deck exhausted" (and its full-reveal) within this action.
      deck: [card(50, 3), card(51, 4)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(next.phase).toBe("playing");
    expect(getPlayerView(next, 1).lastEvent).toMatchObject({ newCard: card(50, 3) });
    expect(getPlayerView(next, 0).lastEvent).toMatchObject({ newCard: null });
    expect(getPlayerView(next, 2).lastEvent).toMatchObject({ newCard: null });
  });
});

describe("playCard — 6. 왕 (King)", () => {
  it("swaps hands between actor and target", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 6), card(2, 2)] }), player(1, { hand: [card(3, 8)] }), player(2, { hand: [card(9, 3)] })],
      deck: [], // empty so the round ends right after the swap, before any next-turn draw can add to seat 1's hand
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(next.players.find((p) => p.seat === 0)!.hand).toEqual([card(3, 8)]);
    expect(next.players.find((p) => p.seat === 1)!.hand).toEqual([card(2, 2)]);
  });

  it("getPlayerView reveals the swap only to the two participants", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 6), card(2, 2)] }), player(1, { hand: [card(3, 8)] }), player(2, { hand: [card(9, 3)] })],
      // Non-empty so the round is still "playing" (and thus still redacting)
      // right after this action, unlike the previous test's deliberate [].
      deck: [card(50, 3)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1 });
    expect(next.phase).toBe("playing");
    expect(getPlayerView(next, 0).lastEvent).toMatchObject({ actorNewCard: card(3, 8), targetNewCard: card(2, 2) });
    expect(getPlayerView(next, 1).lastEvent).toMatchObject({ actorNewCard: card(3, 8), targetNewCard: card(2, 2) });
    expect(getPlayerView(next, 2).lastEvent).toMatchObject({ actorNewCard: null, targetNewCard: null });
  });
});

describe("playCard — 7. 백작부인 (Countess) forced-play rule", () => {
  it("rejects playing anything but the Countess when holding Countess + Prince", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 7), card(2, 5)] }), player(1), player(2)],
    });
    const illegal = applyAction(state, { type: "playCard", seat: 0, cardId: 2, targetSeat: 0 });
    expect(illegal).toBe(state);
    const legal = applyAction(state, { type: "playCard", seat: 0, cardId: 1 });
    expect(legal.lastEvent).toMatchObject({ type: "countess" });
  });

  it("rejects playing anything but the Countess when holding Countess + King", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 7), card(2, 6)] }), player(1), player(2)],
    });
    const illegal = applyAction(state, { type: "playCard", seat: 0, cardId: 2, targetSeat: 1 });
    expect(illegal).toBe(state);
  });

  it("allows playing the Countess freely as a bluff when no Prince/King is held", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 7), card(2, 2)] }), player(1), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1 });
    expect(next.lastEvent).toMatchObject({ type: "countess" });
  });
});

describe("playCard — 8. 공주 (Princess) instant elimination", () => {
  it("eliminates the actor immediately, for any reason, the moment it's discarded", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 8), card(2, 2)] }), player(1), player(2)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1 });
    const actor = next.players.find((p) => p.seat === 0)!;
    expect(actor.alive).toBe(false);
    expect(actor.discardPile).toContainEqual(card(1, 8));
    expect(next.lastEvent).toMatchObject({ type: "princess" });
  });
});

describe("§5 종료 조건 1 — 최후의 1인 생존", () => {
  it("ends the game the instant only one seat remains alive, regardless of remaining deck", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 1), card(2, 2)] }), player(1, { hand: [card(3, 5)] }), player(2, { alive: false, hand: [] })],
      deck: [card(50, 3), card(51, 4)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1, targetSeat: 1, guessNumber: 5 });
    expect(next.phase).toBe("gameOver");
    expect(next.endReason).toBe("elimination");
    expect(next.winnerSeats).toEqual([0]);
  });
});

describe("§5 종료 조건 2 — 카드 더미 소진", () => {
  it("ends the round by highest hand number once the last card is drawn and that turn completes", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 4), card(2, 2)] }), player(1, { hand: [card(3, 8)] }), player(2, { hand: [card(4, 5)] })],
      deck: [],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1 }); // plays Handmaid, no target
    expect(next.phase).toBe("gameOver");
    expect(next.endReason).toBe("deckExhausted");
    expect(next.winnerSeats).toEqual([1]); // seat 1 holds the Princess (8), the highest number
  });

  it("breaks a hand-number tie by discard-pile sum (§5-3)", () => {
    const state = makeState({
      players: [
        player(0, { hand: [card(1, 6)], discardPile: [card(10, 5)] }), // sum 5
        player(1, { hand: [card(2, 6)], discardPile: [card(11, 2), card(12, 5)] }), // sum 7
        player(2, { hand: [card(3, 4), card(4, 2)] }), // active — its own play ends the round
      ],
      activeSeat: 2,
      deck: [],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: 3 }); // plays Handmaid, no target
    expect(next.winnerSeats).toEqual([1]); // both hold a 6, seat 1's discard sum (7) beats seat 0's (5)
  });

  it("declares a shared win when both hand number and discard sum tie exactly", () => {
    const state = makeState({
      players: [
        player(0, { hand: [card(1, 6)], discardPile: [card(10, 5)] }),
        player(1, { hand: [card(2, 6)], discardPile: [card(11, 5)] }),
        player(2, { hand: [card(3, 4), card(4, 2)] }),
      ],
      activeSeat: 2,
      deck: [],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: 3 });
    expect(next.winnerSeats.sort()).toEqual([0, 1]);
  });
});

describe("턴 진행", () => {
  it("advances to the next alive seat and deals them their turn-opening draw", () => {
    const state = makeState({
      players: [player(0, { hand: [card(1, 4), card(2, 2)] }), player(1, { hand: [] , alive: false}), player(2, { hand: [card(3, 3)] })],
      deck: [card(50, 6)],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: 1 });
    expect(next.activeSeat).toBe(2); // seat 1 is dead, skipped
    expect(next.players.find((p) => p.seat === 2)!.hand).toHaveLength(2);
    expect(next.deck).toHaveLength(0);
  });
});

describe("aliveSeats", () => {
  it("lists only alive seats", () => {
    const state = makeState({ players: [player(0), player(1, { alive: false }), player(2)] });
    expect(aliveSeats(state)).toEqual([0, 2]);
  });
});

describe("computeRankings", () => {
  it("ranks the sole survivor 1st, then eliminated seats in reverse elimination order", () => {
    const state = makeState({
      phase: "gameOver",
      endReason: "elimination",
      winnerSeats: [0],
      eliminationOrder: [2, 1],
      players: [player(0, { hand: [card(1, 5)] }), player(1, { alive: false }), player(2, { alive: false })],
    });
    expect(computeRankings(state)).toEqual([
      { seat: 0, rank: 1 },
      { seat: 1, rank: 2 }, // eliminated last -> better rank
      { seat: 2, rank: 3 },
    ]);
  });

  it("ranks a deck-exhaustion showdown by hand comparison among the non-winning survivors too", () => {
    const state = makeState({
      phase: "gameOver",
      endReason: "deckExhausted",
      winnerSeats: [1],
      eliminationOrder: [2],
      players: [
        player(0, { hand: [card(1, 4)], discardPile: [] }),
        player(1, { hand: [card(2, 8)], discardPile: [] }),
        player(2, { alive: false }),
      ],
    });
    expect(computeRankings(state)).toEqual([
      { seat: 1, rank: 1 },
      { seat: 0, rank: 2 },
      { seat: 2, rank: 3 },
    ]);
  });

  it("returns an empty list before the game is over", () => {
    const state = makeState({ phase: "playing" });
    expect(computeRankings(state)).toEqual([]);
  });
});
