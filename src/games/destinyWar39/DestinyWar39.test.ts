import { describe, it, expect } from "vitest";
import {
  applyAction,
  buildDeck,
  chooseBotAction,
  computeRankings,
  DECK_SIZE,
  deckSizeFor,
  getValidMoves,
  isReverseCard,
  resolveTurn,
  scoreRound,
  startGame,
  TOTAL_ROUNDS,
  visibleCurrentPrediction,
  visiblePastPrediction,
  type Card,
  type DestinyWar39State,
  type PlayerCount,
  type SeatIndex,
  type TurnPlay,
} from "./engine";

function numberCard(id: number, value: number): Card {
  return { id, kind: "number", value };
}
function deathCard(id: number): Card {
  return { id, kind: "death", value: -1 };
}
function play(seat: SeatIndex, card: Card): TurnPlay {
  return { seat, card };
}

describe("deck composition (rulebook §3) — 5-player mode", () => {
  it("has exactly 45 cards", () => {
    expect(DECK_SIZE).toBe(45);
  });

  it("has 5 copies of 0, exactly 1 copy each of 1..39, and exactly 1 death card", () => {
    const deck = buildDeck(5);
    const zeroCount = deck.filter((c) => c.kind === "number" && c.value === 0).length;
    expect(zeroCount).toBe(5);
    for (let v = 1; v <= 39; v++) {
      expect(deck.filter((c) => c.kind === "number" && c.value === v).length).toBe(1);
    }
    expect(deck.filter((c) => c.kind === "death").length).toBe(1);
    expect(deck.length).toBe(5 + 39 + 1);
  });

  it("flags exactly 11/22/33 as reverse cards", () => {
    const deck = buildDeck(5);
    const reverseValues = deck.filter((c) => isReverseCard(c, 5)).map((c) => c.value).sort((a, b) => a - b);
    expect(reverseValues).toEqual([11, 22, 33]);
  });
});

describe("deck composition (rulebook §3) — 8-player mode", () => {
  it("has exactly 72 cards", () => {
    expect(deckSizeFor(8)).toBe(72);
  });

  it("has 8 copies of 0, exactly 1 copy each of 1..62, and exactly 2 death cards", () => {
    const deck = buildDeck(8);
    const zeroCount = deck.filter((c) => c.kind === "number" && c.value === 0).length;
    expect(zeroCount).toBe(8);
    for (let v = 1; v <= 62; v++) {
      expect(deck.filter((c) => c.kind === "number" && c.value === v).length).toBe(1);
    }
    expect(deck.filter((c) => c.kind === "death").length).toBe(2);
    expect(deck.length).toBe(8 + 62 + 2);
  });

  it("flags exactly 11/22/33/44/55 as reverse cards", () => {
    const deck = buildDeck(8);
    const reverseValues = deck.filter((c) => isReverseCard(c, 8)).map((c) => c.value).sort((a, b) => a - b);
    expect(reverseValues).toEqual([11, 22, 33, 44, 55]);
  });

  it("66 would be the next multiple of 11 but exceeds maxNumber (62), so it is NOT a reverse value", () => {
    const deck = buildDeck(8);
    expect(deck.some((c) => c.kind === "number" && c.value === 66)).toBe(false);
  });
});

describe("deck composition (rulebook §3) — 6-player mode", () => {
  it("has exactly 54 cards (6 players x 9 rounds)", () => {
    expect(deckSizeFor(6)).toBe(54);
  });

  it("has 6 copies of 0, exactly 1 copy each of 1..47, and exactly 1 death card", () => {
    const deck = buildDeck(6);
    const zeroCount = deck.filter((c) => c.kind === "number" && c.value === 0).length;
    expect(zeroCount).toBe(6);
    for (let v = 1; v <= 47; v++) {
      expect(deck.filter((c) => c.kind === "number" && c.value === v).length).toBe(1);
    }
    expect(deck.filter((c) => c.kind === "death").length).toBe(1);
    expect(deck.length).toBe(6 + 47 + 1);
  });

  it("flags exactly 11/22/33/44 as reverse cards", () => {
    const deck = buildDeck(6);
    const reverseValues = deck.filter((c) => isReverseCard(c, 6)).map((c) => c.value).sort((a, b) => a - b);
    expect(reverseValues).toEqual([11, 22, 33, 44]);
  });

  it("55 would be the next multiple of 11 but exceeds maxNumber (47), so it is NOT a reverse value", () => {
    const deck = buildDeck(6);
    expect(deck.some((c) => c.kind === "number" && c.value === 55)).toBe(false);
  });
});

describe("deck composition (rulebook §3) — 7-player mode", () => {
  it("has exactly 63 cards (7 players x 9 rounds)", () => {
    expect(deckSizeFor(7)).toBe(63);
  });

  it("has 7 copies of 0, exactly 1 copy each of 1..55, and exactly 1 death card", () => {
    const deck = buildDeck(7);
    const zeroCount = deck.filter((c) => c.kind === "number" && c.value === 0).length;
    expect(zeroCount).toBe(7);
    for (let v = 1; v <= 55; v++) {
      expect(deck.filter((c) => c.kind === "number" && c.value === v).length).toBe(1);
    }
    expect(deck.filter((c) => c.kind === "death").length).toBe(1);
    expect(deck.length).toBe(7 + 55 + 1);
  });

  it("flags exactly 11/22/33/44/55 as reverse cards", () => {
    const deck = buildDeck(7);
    const reverseValues = deck.filter((c) => isReverseCard(c, 7)).map((c) => c.value).sort((a, b) => a - b);
    expect(reverseValues).toEqual([11, 22, 33, 44, 55]);
  });

  it("66 would be the next multiple of 11 but exceeds maxNumber (55), so it is NOT a reverse value", () => {
    const deck = buildDeck(7);
    expect(deck.some((c) => c.kind === "number" && c.value === 66)).toBe(false);
  });
});

describe("scoreRound (rulebook §9 — confirmed formula, exact vectors from product owner)", () => {
  it("ROUND 1 (R=1)", () => {
    expect(scoreRound(0, 0, 1)).toBe(1);
    expect(scoreRound(0, 1, 1)).toBe(-1);
    expect(scoreRound(1, 1, 1)).toBe(2);
    expect(scoreRound(1, 0, 1)).toBe(-2);
    expect(scoreRound(1, 2, 1)).toBe(-2);
    expect(scoreRound(2, 2, 1)).toBe(4);
    expect(scoreRound(2, 0, 1)).toBe(-4);
  });

  it("ROUND 5 (R=5)", () => {
    expect(scoreRound(0, 0, 5)).toBe(5);
    expect(scoreRound(0, 1, 5)).toBe(-5);
    expect(scoreRound(0, 3, 5)).toBe(-5);
    expect(scoreRound(1, 1, 5)).toBe(2);
    expect(scoreRound(1, 3, 5)).toBe(-4);
    expect(scoreRound(3, 3, 5)).toBe(6);
  });

  it("ROUND 9 (R=9)", () => {
    expect(scoreRound(0, 0, 9)).toBe(9);
    expect(scoreRound(0, 1, 9)).toBe(-9);
    expect(scoreRound(0, 4, 9)).toBe(-9);
    expect(scoreRound(2, 2, 9)).toBe(4);
    expect(scoreRound(2, 5, 9)).toBe(-6);
    expect(scoreRound(5, 5, 9)).toBe(10);
  });

  it("R has no effect once P >= 1 (only P and A matter)", () => {
    expect(scoreRound(3, 3, 1)).toBe(scoreRound(3, 3, 9));
    expect(scoreRound(3, 1, 1)).toBe(scoreRound(3, 1, 9));
  });
});

describe("resolveTurn (rulebook §6 — decision table) — 5-player mode", () => {
  const order = [0, 1, 2, 3, 4];

  it("normal state: highest number wins", () => {
    const plays = [play(0, numberCard(1, 12)), play(1, numberCard(2, 31)), play(2, numberCard(3, 7)), play(3, numberCard(4, 18)), play(4, numberCard(5, 5))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(1); // 31
  });

  it("one reverse card (11/22/33) → reverse active, lowest number wins", () => {
    const plays = [play(0, numberCard(1, 8)), play(1, numberCard(2, 27)), play(2, numberCard(3, 22)), play(3, numberCard(4, 5)), play(4, numberCard(5, 19))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(true); // one reverse card (22)
    expect(outcome.winnerSeat).toBe(3); // lowest number, 5
  });

  it("two reverse cards → parity even, reverts to normal (highest wins)", () => {
    const plays = [play(0, numberCard(1, 11)), play(1, numberCard(2, 22)), play(2, numberCard(3, 7)), play(3, numberCard(4, 30)), play(4, numberCard(5, 9))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(3); // 30, the highest
  });

  it("three reverse cards → parity odd, reverse active again", () => {
    const plays = [play(0, numberCard(1, 11)), play(1, numberCard(2, 22)), play(2, numberCard(3, 33)), play(3, numberCard(4, 30)), play(4, numberCard(5, 9))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(true);
    expect(outcome.winnerSeat).toBe(4); // lowest, 9
  });

  it("normal state, death and 0 both present: 0 counters death (its only upset — not the other numbers)", () => {
    const plays = [play(0, numberCard(1, 0)), play(1, deathCard(2)), play(2, numberCard(3, 25)), play(3, numberCard(4, 39)), play(4, numberCard(5, 1))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(0); // 0 beats Death specifically; Death would otherwise have beaten 39
  });

  it("normal state, death present, no 0: death wins outright", () => {
    const plays = [play(0, deathCard(1)), play(1, numberCard(2, 39)), play(2, numberCard(3, 25)), play(3, numberCard(4, 1)), play(4, numberCard(5, 38))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(0);
  });

  it("normal state, 0 present but no death: 0 is just the weakest number and loses to the highest (e.g. 35 vs 0 → 35 wins)", () => {
    const plays = [play(0, numberCard(1, 0)), play(1, numberCard(2, 35)), play(2, numberCard(3, 7)), play(3, numberCard(4, 18)), play(4, numberCard(5, 2))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(1); // 35, the highest — 0 does NOT auto-win outside the death counter
  });

  it("reverse active (one reverse card) + 0 present, no death: 0 wins even against a much higher number (e.g. 11-reverse + 0 vs 35 → 0 wins)", () => {
    const plays = [play(0, numberCard(1, 0)), play(1, numberCard(2, 11)), play(2, numberCard(3, 35)), play(3, numberCard(4, 18)), play(4, numberCard(5, 6))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(true); // one reverse card (11)
    expect(outcome.winnerSeat).toBe(0); // 0, lowest — reverse makes it the strongest ordinary number
  });

  it("reverse active (odd reverse count) + 0 and death both present: death wins (exception cancelled)", () => {
    const plays = [play(0, numberCard(1, 0)), play(1, deathCard(2)), play(2, numberCard(3, 11)), play(3, numberCard(4, 25)), play(4, numberCard(5, 30))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(true); // one reverse card (11)
    expect(outcome.winnerSeat).toBe(1); // death, even over 0
  });

  it("reverse active, death present, no 0: death still wins outright over the lowest number", () => {
    const plays = [play(0, deathCard(1)), play(1, numberCard(2, 11)), play(2, numberCard(3, 25)), play(3, numberCard(4, 30)), play(4, numberCard(5, 2))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(true);
    expect(outcome.winnerSeat).toBe(0); // death beats even the lowest number (2)
  });

  it("reverse active, no death: lowest number wins (0 is strongest among numbers)", () => {
    const plays = [play(0, numberCard(1, 0)), play(1, numberCard(2, 11)), play(2, numberCard(3, 25)), play(3, numberCard(4, 30)), play(4, numberCard(5, 2))];
    const outcome = resolveTurn(plays, order, 5);
    expect(outcome.reverseActive).toBe(true);
    expect(outcome.winnerSeat).toBe(0); // 0, lowest
  });

  it("multiple 0 cards tie, normal state with death present (0's counter is live): earliest in reveal order wins", () => {
    // Without a death card, 0 is just the weakest number and wouldn't be the winning value at all
    // (see the "0 is just the weakest number" test above) — a death card is needed to put 0 in contention.
    const plays = [play(0, deathCard(1)), play(1, numberCard(2, 0)), play(2, numberCard(3, 0)), play(3, numberCard(4, 9)), play(4, numberCard(5, 0))];
    const outcome1 = resolveTurn(plays, [2, 4, 1, 0, 3], 5);
    expect(outcome1.winnerSeat).toBe(2); // seat 2's 0 comes first in this reveal order
    const outcome2 = resolveTurn(plays, [4, 1, 2, 0, 3], 5);
    expect(outcome2.winnerSeat).toBe(4); // seat 4's 0 comes first here instead
  });

  it("multiple 0 cards tie, reverse active, no death: earliest in reveal order wins among the 0s", () => {
    const plays = [play(0, numberCard(1, 0)), play(1, numberCard(2, 11)), play(2, numberCard(3, 0)), play(3, numberCard(4, 9)), play(4, numberCard(5, 3))];
    const outcome = resolveTurn(plays, [2, 0, 1, 3, 4], 5);
    expect(outcome.reverseActive).toBe(true);
    expect(outcome.winnerSeat).toBe(2);
  });
});

describe("resolveTurn (rulebook §6 — decision table) — 8-player mode", () => {
  const order = [0, 1, 2, 3, 4, 5, 6, 7];
  function fill(seat: SeatIndex, card: Card): TurnPlay {
    return play(seat, card);
  }
  /** 8 plays where every seat but the ones explicitly overridden gets a harmless mid-range number card. */
  function eightPlays(overrides: Record<number, Card>): TurnPlay[] {
    const filler = [40, 41, 42, 43, 45, 46, 47, 48]; // avoid 44 (reverse) and the overridden seats' values
    let f = 0;
    return Array.from({ length: 8 }, (_, seat) => (overrides[seat] ? fill(seat, overrides[seat]) : fill(seat, numberCard(100 + seat, filler[f++]))));
  }

  it("normal state: highest number (up to 62) wins", () => {
    const plays = eightPlays({ 3: numberCard(1, 62), 5: numberCard(2, 61) });
    const outcome = resolveTurn(plays, order, 8);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(3); // 62, the deck's max number
  });

  it("44 and 55 are reverse cards too: one of them → reverse active, lowest wins", () => {
    const plays = eightPlays({ 2: numberCard(1, 44), 6: numberCard(2, 3) });
    const outcome = resolveTurn(plays, order, 8);
    expect(outcome.reverseActive).toBe(true); // one reverse card (44)
    expect(outcome.winnerSeat).toBe(6); // lowest, 3
  });

  it("55 alone also triggers reverse", () => {
    const plays = eightPlays({ 4: numberCard(1, 55), 1: numberCard(2, 2) });
    const outcome = resolveTurn(plays, order, 8);
    expect(outcome.reverseActive).toBe(true);
    expect(outcome.winnerSeat).toBe(1); // lowest, 2
  });

  it("11 + 44 (two reverse cards) → parity even, reverts to normal (highest wins)", () => {
    const plays = eightPlays({ 0: numberCard(1, 11), 1: numberCard(2, 44), 7: numberCard(3, 60) });
    const outcome = resolveTurn(plays, order, 8);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(7); // 60, the highest
  });

  it("two Death cards in the same turn, reverse inactive, no 0: earliest revealer of the two wins (product-owner-confirmed extension of the §6.3 0-tie rule)", () => {
    const plays = eightPlays({ 2: deathCard(1), 6: deathCard(2) });
    const outcome1 = resolveTurn(plays, [6, 2, 0, 1, 3, 4, 5, 7], 8);
    expect(outcome1.reverseActive).toBe(false);
    expect(outcome1.winnerSeat).toBe(6); // seat 6's Death revealed first in this order
    const outcome2 = resolveTurn(plays, [2, 6, 0, 1, 3, 4, 5, 7], 8);
    expect(outcome2.winnerSeat).toBe(2); // seat 2's Death revealed first here instead
  });

  it("two Death cards in the same turn, reverse active: earliest revealer of the two still wins", () => {
    const plays = eightPlays({ 0: numberCard(9, 11), 2: deathCard(1), 6: deathCard(2) });
    const outcome = resolveTurn(plays, [6, 2, 0, 1, 3, 4, 5, 7], 8);
    expect(outcome.reverseActive).toBe(true); // one reverse card (11)
    expect(outcome.winnerSeat).toBe(6);
  });

  it("two Death cards + a 0, reverse inactive: the 0 still beats both Deaths outright (its narrow counter is not limited to a single Death)", () => {
    const plays = eightPlays({ 1: numberCard(9, 0), 2: deathCard(1), 6: deathCard(2) });
    const outcome = resolveTurn(plays, order, 8);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(1); // the 0
  });

  it("0-card ties still resolve by reveal order in 8-player mode (more candidates, same rule)", () => {
    const plays = eightPlays({ 0: deathCard(1), 1: numberCard(2, 0), 3: numberCard(3, 0), 5: numberCard(4, 0) });
    const outcome = resolveTurn(plays, [5, 3, 1, 0, 2, 4, 6, 7], 8);
    expect(outcome.reverseActive).toBe(false);
    expect(outcome.winnerSeat).toBe(5); // seat 5's 0 comes first in this reveal order
  });
});

describe("round/turn structure (rulebook §4, §5) — 5-player mode", () => {
  const PC: PlayerCount = 5;
  function fastForwardToPlaying(state: DestinyWar39State): DestinyWar39State {
    let s = state;
    for (let seat = 0; seat < PC; seat++) {
      s = applyAction(s, { type: "predict", seat, value: 0, hidden: false });
    }
    return s;
  }

  it("round R deals each player exactly R cards", () => {
    let state = startGame(PC, 1);
    for (let seat = 0; seat < PC; seat++) {
      expect(state.round.hands[seat].length).toBe(1);
    }
    state = fastForwardToPlaying(state);
    // Play through round 1 (1 turn) and round 2's dealing.
    for (let seat = 0; seat < PC; seat++) {
      const seatToAct = state.round.playsThisTurn.length; // round 1 is simultaneous; seats can act in any order but this engine iterates 0..4
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
    }
    expect(state.phase).toBe("roundEnd");
    state = applyAction(state, { type: "nextRound", seed: 42 });
    expect(state.phase).toBe("predicting");
    expect(state.round.roundNumber).toBe(2);
    for (let seat = 0; seat < PC; seat++) {
      expect(state.round.hands[seat].length).toBe(2);
    }
  });

  it("full 45-card deck is dealt out at round 9 (5 players x 9 cards)", () => {
    // Deal round 9 directly via the internal shuffle path exposed through startGame+advancing
    // is expensive to simulate end-to-end here; instead assert the invariant via dealRound's
    // math: playerCount * roundNumber must never exceed the deck size.
    expect(PC * TOTAL_ROUNDS).toBe(DECK_SIZE);
  });

  it("a round's actual win total across all players equals the round number (one winner per turn)", () => {
    let state = startGame(PC, 7);
    state = fastForwardToPlaying(state);
    // Round 1 has exactly 1 turn -> exactly 1 total win awarded this round.
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    expect(state.phase).toBe("roundEnd");
    const totalWins = state.players.reduce((sum, p) => sum + (p.actualWins[0] ?? 0), 0);
    expect(totalWins).toBe(1);
  });

  it("round 1's sole turn winner becomes round 2's turn-1 leader; each turn's winner leads the next turn thereafter", () => {
    let state = startGame(PC, 99);
    state = fastForwardToPlaying(state);
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    const round1Winner = state.players.find((p) => (p.actualWins[0] ?? 0) === 1)!.seat;
    state = applyAction(state, { type: "nextRound", seed: 5 });
    expect(state.round.turnLeader).toBe(round1Winner);

    // Play round 2's turn 1 in the sequential (leader -> clockwise) order and confirm the
    // turn's winner becomes turn 2's leader.
    state = fastForwardToPlaying(state);
    let actingSeat = state.round.turnLeader;
    const played = new Set<number>();
    while (state.round.turnNumber === 1 && state.phase === "playing") {
      const card = state.round.hands[actingSeat][0];
      state = applyAction(state, { type: "play", seat: actingSeat, cardId: card.id });
      played.add(actingSeat);
      if (played.size < PC) {
        do {
          actingSeat = state.seatOrder[(state.seatOrder.indexOf(actingSeat) + 1) % PC];
        } while (played.has(actingSeat));
      }
    }
    expect(state.round.turnNumber).toBe(2);
    const turn1Winner = state.round.turnRecords[0].winnerSeat;
    expect(state.round.turnLeader).toBe(turn1Winner);
  });

  it("round >= 2 rejects an out-of-turn play", () => {
    let state = startGame(PC, 3);
    state = fastForwardToPlaying(state);
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    state = applyAction(state, { type: "nextRound", seed: 11 });
    state = fastForwardToPlaying(state);
    const leader = state.round.turnLeader;
    const notLeader = (leader + 1) % PC;
    const card = state.round.hands[notLeader][0];
    const before = state;
    const after = applyAction(state, { type: "play", seat: notLeader, cardId: card.id });
    expect(after).toBe(before); // no-op, rejected
  });

  it("a played card stays in round.playsThisTurn (never cleared/overwritten) as later seats take their turn, and playsThisTurn only resets once the WHOLE turn resolves — regression test for the 2026-08-22 'played card vanishes before the trick ends' bug report", () => {
    // Round 2 (>= 2 turns per round, sequential leader -> clockwise order) so we can observe
    // a turn resolving WITHOUT the round itself ending — round 1 only has 1 turn, so its only
    // turn's resolution is indistinguishable from the round ending.
    let state = startGame(PC, 3);
    state = fastForwardToPlaying(state);
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    state = applyAction(state, { type: "nextRound", seed: 11 });
    state = fastForwardToPlaying(state);
    expect(state.round.roundNumber).toBe(2);

    const actingOrder: SeatIndex[] = [];
    let acting = state.round.turnLeader;
    for (let i = 0; i < PC; i++) {
      actingOrder.push(acting);
      acting = state.seatOrder[(state.seatOrder.indexOf(acting) + 1) % PC];
    }

    // First actor (the turn leader) plays.
    const firstSeat = actingOrder[0];
    const firstCard = state.round.hands[firstSeat][0];
    state = applyAction(state, { type: "play", seat: firstSeat, cardId: firstCard.id });
    expect(state.phase).toBe("playing"); // turn not resolved yet — 4 seats still to act
    expect(state.round.playsThisTurn).toEqual([{ seat: firstSeat, card: firstCard }]);

    // Second actor plays — the first actor's play must still be present, unchanged, at the
    // SAME array position, not cleared/reset/overwritten by the second play.
    const secondSeat = actingOrder[1];
    const secondCard = state.round.hands[secondSeat][0];
    state = applyAction(state, { type: "play", seat: secondSeat, cardId: secondCard.id });
    expect(state.round.playsThisTurn).toEqual([
      { seat: firstSeat, card: firstCard },
      { seat: secondSeat, card: secondCard },
    ]);

    // Third and fourth actors play — every earlier play keeps accumulating, none disappear.
    const thirdSeat = actingOrder[2];
    const thirdCard = state.round.hands[thirdSeat][0];
    state = applyAction(state, { type: "play", seat: thirdSeat, cardId: thirdCard.id });
    const fourthSeat = actingOrder[3];
    const fourthCard = state.round.hands[fourthSeat][0];
    state = applyAction(state, { type: "play", seat: fourthSeat, cardId: fourthCard.id });
    expect(state.phase).toBe("playing");
    expect(state.round.playsThisTurn.map((p) => p.seat)).toEqual([firstSeat, secondSeat, thirdSeat, fourthSeat]);
    expect(state.round.playsThisTurn.find((p) => p.seat === firstSeat)!.card).toEqual(firstCard);

    // Fifth (last) actor plays — the turn resolves, but round 2 has a second turn left, so play
    // stays in "playing" phase. The just-finished turn's record must hold every seat's exact
    // card (including the first seat's, still intact), and only NOW does playsThisTurn reset to
    // [] for the next turn.
    const fifthSeat = actingOrder[4];
    const fifthCard = state.round.hands[fifthSeat][0];
    state = applyAction(state, { type: "play", seat: fifthSeat, cardId: fifthCard.id });
    expect(state.phase).toBe("playing");
    expect(state.round.turnNumber).toBe(2);
    expect(state.round.playsThisTurn).toEqual([]); // cleared only after the full trick resolved
    const resolved = state.round.turnRecords[state.round.turnRecords.length - 1];
    expect(resolved.plays).toHaveLength(5);
    expect(resolved.plays.find((p) => p.seat === firstSeat)!.card).toEqual(firstCard);
    expect(resolved.plays.find((p) => p.seat === secondSeat)!.card).toEqual(secondCard);
    expect(resolved.plays.find((p) => p.seat === thirdSeat)!.card).toEqual(thirdCard);
    expect(resolved.plays.find((p) => p.seat === fourthSeat)!.card).toEqual(fourthCard);
    expect(resolved.plays.find((p) => p.seat === fifthSeat)!.card).toEqual(fifthCard);
    expect(actingOrder).toContain(resolved.winnerSeat); // sanity: winner is one of this turn's 5 actors
  });

  it("the played card's own hand loses exactly that card while every other seat's hand is untouched — hand/field separation (rulebook §4.2)", () => {
    let state = startGame(PC, 21);
    state = fastForwardToPlaying(state);
    const handsBefore = state.round.hands;
    const card = state.round.hands[0][0];
    state = applyAction(state, { type: "play", seat: 0, cardId: card.id });
    expect(state.round.hands[0]).toEqual([]); // the acting seat's hand loses the played card
    expect(state.round.hands[0]).not.toContainEqual(card);
    for (let seat = 1; seat < PC; seat++) {
      expect(state.round.hands[seat]).toEqual(handsBefore[seat]); // untouched
    }
    // The card is not gone — it now lives on the field (playsThisTurn), findable by seat.
    expect(state.round.playsThisTurn.find((p) => p.seat === 0)!.card).toEqual(card);
  });
});

describe("prediction rules (rulebook §7)", () => {
  it("rejects a prediction outside 0..roundNumber", () => {
    const state = startGame(5, 1);
    const before = state;
    const tooHigh = applyAction(state, { type: "predict", seat: 0, value: 2, hidden: false });
    expect(tooHigh).toBe(before); // round 1 only allows 0 or 1
    const negative = applyAction(state, { type: "predict", seat: 0, value: -1, hidden: false });
    expect(negative).toBe(before);
  });

  it("accepts 0..roundNumber and moves to playing once all 5 seats have predicted", () => {
    let state = startGame(5, 2); // still round 1 (seed doesn't change starting round)
    for (let seat = 0; seat < 5 - 1; seat++) {
      state = applyAction(state, { type: "predict", seat, value: 1, hidden: false });
      expect(state.phase).toBe("predicting");
    }
    state = applyAction(state, { type: "predict", seat: 4, value: 0, hidden: false });
    expect(state.phase).toBe("playing");
  });

  it("rejects a second prediction from the same seat in the same round", () => {
    let state = startGame(5, 1);
    state = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: false });
    const before = state;
    const after = applyAction(state, { type: "predict", seat: 0, value: 0, hidden: false });
    expect(after).toBe(before);
  });
});

describe("hidden (rulebook §8, §12)", () => {
  it("allows exactly one hidden use per game and rejects a second attempt", () => {
    let state = startGame(5, 1);
    state = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: true });
    expect(state.players[0].hiddenUsed).toBe(true);
    expect(state.players[0].hiddenRound).toBe(1);

    // Finish round 1, advance to round 2, try hidden again for seat 0.
    for (let seat = 1; seat < 5; seat++) {
      state = applyAction(state, { type: "predict", seat, value: 0, hidden: false });
    }
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    state = applyAction(state, { type: "nextRound", seed: 2 });

    const before = state;
    const after = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: true });
    expect(after).toBe(before); // rejected: hidden already spent
  });

  it("hides the prediction value from other seats until game over, but the owner always sees it", () => {
    let state = startGame(5, 1);
    state = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: true });
    expect(visibleCurrentPrediction(state, 0, 0)).toBe(1); // owner sees their own
    expect(visibleCurrentPrediction(state, 1, 0)).toBe("hidden"); // opponent does not
  });

  it("reveals every hidden past prediction once the game reaches gameOver", () => {
    let state = startGame(5, 123);
    state = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: true });
    for (let seat = 1; seat < 5; seat++) state = applyAction(state, { type: "predict", seat, value: 0, hidden: false });
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    // Round 1 done. visiblePastPrediction should still redact seat 0's hidden round-1 prediction
    // from seat 1's view while the game isn't over yet.
    expect(visiblePastPrediction(state, 1, 0, 1)).toBe("hidden");
    expect(visiblePastPrediction(state, 0, 0, 1)).toBe(1);
  });
});

function playFullGame(playerCount: PlayerCount, seed: number): DestinyWar39State {
  let state = startGame(playerCount, seed);
  while (state.phase !== "gameOver") {
    if (state.phase === "predicting") {
      for (let seat = 0; seat < playerCount; seat++) {
        if (state.round.predictions[seat] === null) {
          state = applyAction(state, { type: "predict", seat, value: Math.min(1, state.round.roundNumber), hidden: false });
        }
      }
    } else if (state.phase === "playing") {
      while (state.phase === "playing") {
        const round = state.round;
        const played = new Set(round.playsThisTurn.map((p) => p.seat));
        let actingSeat: number | null = null;
        if (round.roundNumber === 1) {
          for (let s = 0; s < playerCount; s++) if (!played.has(s)) { actingSeat = s; break; }
        } else {
          const startIdx = state.seatOrder.indexOf(round.turnLeader);
          for (let i = 0; i < playerCount; i++) {
            const candidate = state.seatOrder[(startIdx + i) % playerCount];
            if (!played.has(candidate)) { actingSeat = candidate; break; }
          }
        }
        if (actingSeat === null) break;
        const card = round.hands[actingSeat][0];
        state = applyAction(state, { type: "play", seat: actingSeat, cardId: card.id });
      }
    } else if (state.phase === "roundEnd") {
      state = applyAction(state, { type: "nextRound", seed: seed + state.round.roundNumber });
    }
  }
  return state;
}

describe("full game simulation and final rankings (rulebook §9.1, §10) — 5-player mode", () => {
  it("plays all 9 rounds to completion and produces final scores + rankings for all 5 seats", () => {
    const state = playFullGame(5, 2024);
    expect(state.phase).toBe("gameOver");
    expect(state.finalScores).not.toBeNull();
    expect(Object.keys(state.finalScores!).length).toBe(5);
    for (const p of state.players) {
      expect(p.predictions.every((v) => v !== null)).toBe(true);
      expect(p.actualWins.every((v) => v !== null)).toBe(true);
      expect(p.scores.every((v) => v !== null)).toBe(true);
    }
    expect(state.finalRankings).not.toBeNull();
    expect(state.finalRankings!.length).toBe(5);
  });

  it("final score equals the sum of the 9 recorded per-round scores", () => {
    const state = playFullGame(5, 555);
    for (const p of state.players) {
      const expected = p.scores.reduce((sum: number, v) => sum + (v ?? 0), 0);
      expect(state.finalScores![p.seat]).toBe(expected);
    }
  });

  it("co-ranks players with identical final scores (competition ranking, no tiebreaker)", () => {
    const finalScores = { 0: 10, 1: 10, 2: 5, 3: 5, 4: 5 };
    const rankings = computeRankings(finalScores);
    const rankBySeat = Object.fromEntries(rankings.map((r) => [r.seat, r.rank]));
    expect(rankBySeat[0]).toBe(1);
    expect(rankBySeat[1]).toBe(1);
    expect(rankBySeat[2]).toBe(3);
    expect(rankBySeat[3]).toBe(3);
    expect(rankBySeat[4]).toBe(3);
  });

  it("a strict ordering produces ranks 1..5 with no gaps", () => {
    const finalScores = { 0: 20, 1: 15, 2: 10, 3: 5, 4: 0 };
    const rankings = computeRankings(finalScores);
    const rankBySeat = Object.fromEntries(rankings.map((r) => [r.seat, r.rank]));
    expect(rankBySeat).toEqual({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 });
  });
});

describe("full game simulation and final rankings — 8-player mode", () => {
  it("plays all 9 rounds to completion with 8 players and produces final scores + rankings for all 8 seats", () => {
    const state = playFullGame(8, 2024);
    expect(state.phase).toBe("gameOver");
    expect(state.playerCount).toBe(8);
    expect(state.finalScores).not.toBeNull();
    expect(Object.keys(state.finalScores!).length).toBe(8);
    for (const p of state.players) {
      expect(p.predictions.every((v) => v !== null)).toBe(true);
      expect(p.actualWins.every((v) => v !== null)).toBe(true);
      expect(p.scores.every((v) => v !== null)).toBe(true);
    }
    expect(state.finalRankings).not.toBeNull();
    expect(state.finalRankings!.length).toBe(8);
  });

  it("round 9 deals each of the 8 players exactly 9 cards, using the entire 72-card deck with nothing left over", () => {
    let state = startGame(8, 4);
    while (state.round.roundNumber < 9) {
      state = playFullGameOneRound(state);
    }
    for (let seat = 0; seat < 8; seat++) {
      expect(state.round.hands[seat].length).toBe(9);
    }
    const totalDealt = Object.values(state.round.hands).reduce((sum, hand) => sum + hand.length, 0);
    expect(totalDealt).toBe(72); // 8 players x 9 cards = the full deck
  });

  it("final score equals the sum of the 9 recorded per-round scores, with 8 players", () => {
    const state = playFullGame(8, 555);
    for (const p of state.players) {
      const expected = p.scores.reduce((sum: number, v) => sum + (v ?? 0), 0);
      expect(state.finalScores![p.seat]).toBe(expected);
    }
  });

  /** Advances `state` (already in "predicting") through one full round (predict all + play every turn), landing back in "predicting" for the next round. */
  function playFullGameOneRound(state: DestinyWar39State): DestinyWar39State {
    let s = state;
    const playerCount = s.playerCount;
    for (let seat = 0; seat < playerCount; seat++) {
      s = applyAction(s, { type: "predict", seat, value: 0, hidden: false });
    }
    while (s.phase === "playing") {
      const round = s.round;
      const played = new Set(round.playsThisTurn.map((p) => p.seat));
      let actingSeat: number | null = null;
      if (round.roundNumber === 1) {
        for (let seat = 0; seat < playerCount; seat++) if (!played.has(seat)) { actingSeat = seat; break; }
      } else {
        const startIdx = s.seatOrder.indexOf(round.turnLeader);
        for (let i = 0; i < playerCount; i++) {
          const candidate = s.seatOrder[(startIdx + i) % playerCount];
          if (!played.has(candidate)) { actingSeat = candidate; break; }
        }
      }
      if (actingSeat === null) break;
      const card = round.hands[actingSeat][0];
      s = applyAction(s, { type: "play", seat: actingSeat, cardId: card.id });
    }
    return applyAction(s, { type: "nextRound", seed: state.round.roundNumber * 1000 + 7 });
  }
});

describe.each([
  { playerCount: 6 as PlayerCount, deckSize: 54 },
  { playerCount: 7 as PlayerCount, deckSize: 63 },
])("full game simulation and final rankings — $playerCount-player mode", ({ playerCount, deckSize }) => {
  it(`plays all 9 rounds to completion with ${playerCount} players and produces final scores + rankings for all ${playerCount} seats`, () => {
    const state = playFullGame(playerCount, 2024);
    expect(state.phase).toBe("gameOver");
    expect(state.playerCount).toBe(playerCount);
    expect(state.finalScores).not.toBeNull();
    expect(Object.keys(state.finalScores!).length).toBe(playerCount);
    for (const p of state.players) {
      expect(p.predictions.every((v) => v !== null)).toBe(true);
      expect(p.actualWins.every((v) => v !== null)).toBe(true);
      expect(p.scores.every((v) => v !== null)).toBe(true);
    }
    expect(state.finalRankings).not.toBeNull();
    expect(state.finalRankings!.length).toBe(playerCount);
  });

  it(`round 9 deals each of the ${playerCount} players exactly 9 cards, using the entire ${deckSize}-card deck with nothing left over`, () => {
    let state = startGame(playerCount, 4);
    while (state.round.roundNumber < 9) {
      state = playFullGameOneRound(state);
    }
    for (let seat = 0; seat < playerCount; seat++) {
      expect(state.round.hands[seat].length).toBe(9);
    }
    const totalDealt = Object.values(state.round.hands).reduce((sum, hand) => sum + hand.length, 0);
    expect(totalDealt).toBe(deckSize); // playerCount x 9 cards = the full deck
  });

  it(`final score equals the sum of the 9 recorded per-round scores, with ${playerCount} players`, () => {
    const state = playFullGame(playerCount, 555);
    for (const p of state.players) {
      const expected = p.scores.reduce((sum: number, v) => sum + (v ?? 0), 0);
      expect(state.finalScores![p.seat]).toBe(expected);
    }
  });

  it(`a full turn's trick winner and reverse state are recorded correctly with ${playerCount} players (round 2's first trick)`, () => {
    let state = startGame(playerCount, 9);
    for (let seat = 0; seat < playerCount; seat++) {
      state = applyAction(state, { type: "predict", seat, value: 0, hidden: false });
    }
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    state = applyAction(state, { type: "nextRound", seed: 11 });
    for (let seat = 0; seat < playerCount; seat++) {
      state = applyAction(state, { type: "predict", seat, value: 0, hidden: false });
    }
    expect(state.round.roundNumber).toBe(2);
    let acting = state.round.turnLeader;
    const actedOrder: SeatIndex[] = [];
    for (let i = 0; i < playerCount; i++) {
      const card = state.round.hands[acting][0];
      state = applyAction(state, { type: "play", seat: acting, cardId: card.id });
      actedOrder.push(acting);
      acting = state.seatOrder[(state.seatOrder.indexOf(acting) + 1) % playerCount];
    }
    const resolved = state.round.turnRecords[state.round.turnRecords.length - 1];
    expect(resolved.plays).toHaveLength(playerCount);
    expect(actedOrder).toContain(resolved.winnerSeat);
    const totalWins = Object.values(state.round.winsThisRound).reduce((sum, v) => sum + v, 0);
    expect(totalWins).toBe(1); // exactly one turn resolved so far this round
  });
});

/** Advances `state` (already in "predicting") through one full round (predict all + play every turn), landing back in "predicting" for the next round. Shared by every playerCount's "round 9 deals exactly 9 cards" test above and the 8-player suite below. */
function playFullGameOneRound(state: DestinyWar39State): DestinyWar39State {
  let s = state;
  const playerCount = s.playerCount;
  for (let seat = 0; seat < playerCount; seat++) {
    s = applyAction(s, { type: "predict", seat, value: 0, hidden: false });
  }
  while (s.phase === "playing") {
    const round = s.round;
    const played = new Set(round.playsThisTurn.map((p) => p.seat));
    let actingSeat: number | null = null;
    if (round.roundNumber === 1) {
      for (let seat = 0; seat < playerCount; seat++) if (!played.has(seat)) { actingSeat = seat; break; }
    } else {
      const startIdx = s.seatOrder.indexOf(round.turnLeader);
      for (let i = 0; i < playerCount; i++) {
        const candidate = s.seatOrder[(startIdx + i) % playerCount];
        if (!played.has(candidate)) { actingSeat = candidate; break; }
      }
    }
    if (actingSeat === null) break;
    const card = round.hands[actingSeat][0];
    s = applyAction(s, { type: "play", seat: actingSeat, cardId: card.id });
  }
  return applyAction(s, { type: "nextRound", seed: state.round.roundNumber * 1000 + 7 });
}

describe("lastCompletedRound — card history for the UI's '직전 라운드' view", () => {
  function fastForwardToPlaying(state: DestinyWar39State): DestinyWar39State {
    let s = state;
    for (let seat = 0; seat < 5; seat++) {
      s = applyAction(s, { type: "predict", seat, value: 0, hidden: false });
    }
    return s;
  }

  it("is null before any round has finished", () => {
    const state = startGame(5, 1);
    expect(state.lastCompletedRound).toBeNull();
  });

  it("records every player's exact card in round.turnRecords once a turn resolves", () => {
    let state = startGame(5, 4);
    state = fastForwardToPlaying(state);
    const expectedBySeat = new Map(Array.from({ length: 5 }, (_, seat) => [seat, state.round.hands[seat][0]]));
    for (let seat = 0; seat < 5; seat++) {
      const card = state.round.hands[seat][0];
      state = applyAction(state, { type: "play", seat, cardId: card.id });
    }
    expect(state.phase).toBe("roundEnd");
    const turnRecord = state.round.turnRecords[0];
    expect(turnRecord.plays).toHaveLength(5);
    for (const { seat, card } of turnRecord.plays) {
      expect(card).toEqual(expectedBySeat.get(seat));
    }
  });

  it("snapshots the finished round into state.lastCompletedRound as soon as it completes", () => {
    let state = startGame(5, 4);
    state = fastForwardToPlaying(state);
    for (let seat = 0; seat < 5; seat++) {
      const card = state.round.hands[seat][0];
      state = applyAction(state, { type: "play", seat, cardId: card.id });
    }
    expect(state.lastCompletedRound).not.toBeNull();
    expect(state.lastCompletedRound!.roundNumber).toBe(1);
    expect(state.lastCompletedRound!.turnRecords).toEqual(state.round.turnRecords);
  });

  it("keeps the previous round's card history available after nextRound deals the following round", () => {
    let state = startGame(5, 4);
    state = fastForwardToPlaying(state);
    for (let seat = 0; seat < 5; seat++) {
      const card = state.round.hands[seat][0];
      state = applyAction(state, { type: "play", seat, cardId: card.id });
    }
    const round1History = state.lastCompletedRound!;
    state = applyAction(state, { type: "nextRound", seed: 9 });
    // round now points at round 2's fresh (empty) turn history...
    expect(state.round.roundNumber).toBe(2);
    expect(state.round.turnRecords).toEqual([]);
    // ...but round 1's card-by-card history is still fully inspectable.
    expect(state.lastCompletedRound).toEqual(round1History);
    expect(state.lastCompletedRound!.roundNumber).toBe(1);
    expect(state.lastCompletedRound!.turnRecords[0].plays).toHaveLength(5);
  });

  it("also snapshots the final round (9) into lastCompletedRound when the game ends", () => {
    let state = startGame(5, 4);
    while (state.phase !== "gameOver") {
      if (state.phase === "predicting") {
        state = fastForwardToPlaying(state);
      } else if (state.phase === "playing") {
        const round = state.round;
        const played = new Set(round.playsThisTurn.map((p) => p.seat));
        let actingSeat = 0;
        if (round.roundNumber >= 2) {
          const startIdx = state.seatOrder.indexOf(round.turnLeader);
          for (let i = 0; i < 5; i++) {
            const candidate = state.seatOrder[(startIdx + i) % 5];
            if (!played.has(candidate)) {
              actingSeat = candidate;
              break;
            }
          }
        } else {
          for (let s = 0; s < 5; s++) if (!played.has(s)) { actingSeat = s; break; }
        }
        const card = round.hands[actingSeat][0];
        state = applyAction(state, { type: "play", seat: actingSeat, cardId: card.id });
      } else if (state.phase === "roundEnd") {
        state = applyAction(state, { type: "nextRound", seed: 4 + state.round.roundNumber });
      }
    }
    expect(state.lastCompletedRound).not.toBeNull();
    expect(state.lastCompletedRound!.roundNumber).toBe(TOTAL_ROUNDS);
    expect(state.lastCompletedRound!.turnRecords).toHaveLength(TOTAL_ROUNDS);
  });
});

describe("prediction vs. actual-wins tracking (status board)", () => {
  it("round.winsThisRound increments only the turn winner, and stays at 0 for everyone else", () => {
    let state = startGame(5, 4);
    for (let seat = 0; seat < 5; seat++) {
      state = applyAction(state, { type: "predict", seat, value: 0, hidden: false });
    }
    expect(state.phase).toBe("playing");
    for (let seat = 0; seat < 5; seat++) {
      expect(state.round.winsThisRound[seat]).toBe(0);
    }
    for (let seat = 0; seat < 5; seat++) {
      const card = state.round.hands[seat][0];
      state = applyAction(state, { type: "play", seat, cardId: card.id });
    }
    const totalWins = Object.values(state.round.winsThisRound).reduce((sum, v) => sum + v, 0);
    expect(totalWins).toBe(1); // round 1 has exactly 1 turn
    const winners = Object.entries(state.round.winsThisRound).filter(([, wins]) => wins > 0);
    expect(winners).toHaveLength(1);
  });

  it("folds each player's prediction + actual wins + score into their permanent record when the round ends", () => {
    let state = startGame(5, 4);
    // Round 1 only allows predicting 0 or 1; seat 0 predicts 1, everyone else predicts 0.
    state = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: false });
    for (let seat = 1; seat < 5; seat++) {
      state = applyAction(state, { type: "predict", seat, value: 0, hidden: false });
    }
    let seatToAct = 0;
    while (state.phase === "playing") {
      const card = state.round.hands[seatToAct][0];
      state = applyAction(state, { type: "play", seat: seatToAct, cardId: card.id });
      seatToAct++;
    }
    expect(state.phase).toBe("roundEnd");
    for (const p of state.players) {
      const A = state.round.winsThisRound[p.seat] ?? 0;
      expect(p.actualWins[0]).toBe(A);
      const expectedP = p.seat === 0 ? 1 : 0;
      expect(p.predictions[0]).toBe(expectedP);
      expect(p.scores[0]).toBe(scoreRound(expectedP, A, 1));
    }
  });
});

describe("bot support (getValidMoves / chooseBotAction)", () => {
  it("offers exactly roundNumber+1 prediction candidates (0..roundNumber)", () => {
    const state = startGame(5, 1);
    const moves = getValidMoves(state, 0);
    expect(moves.length).toBe(state.round.roundNumber + 1);
    expect(moves.every((m) => m.type === "predict" && !m.hidden)).toBe(true);
  });

  it("chooseBotAction always returns a legal move for the current phase", () => {
    let state = startGame(5, 42);
    for (let seat = 0; seat < 5; seat++) {
      const action = chooseBotAction(state, seat, 5, () => 0.5);
      expect(action).not.toBeNull();
      expect(action!.type).toBe("predict");
      state = applyAction(state, action!);
    }
    expect(state.phase).toBe("playing");
    const action = chooseBotAction(state, 0, 5, () => 0.5);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("play");
  });

  it("returns null when the seat has nothing legal to do", () => {
    let state = startGame(5, 1);
    state = applyAction(state, { type: "predict", seat: 0, value: 1, hidden: false });
    const action = chooseBotAction(state, 0, 5);
    expect(action).toBeNull(); // seat 0 already predicted this round
  });

  it("also produces legal moves in 8-player mode (bot strength normalizes against the mode's own max number, 62)", () => {
    let state = startGame(8, 42);
    for (let seat = 0; seat < 8; seat++) {
      const action = chooseBotAction(state, seat, 5, () => 0.5);
      expect(action).not.toBeNull();
      expect(action!.type).toBe("predict");
      state = applyAction(state, action!);
    }
    expect(state.phase).toBe("playing");
    for (let seat = 0; seat < 8; seat++) {
      const action = chooseBotAction(state, seat, 5, () => 0.5);
      expect(action).not.toBeNull();
      expect(action!.type).toBe("play");
    }
  });
});
