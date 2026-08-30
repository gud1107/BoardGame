import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildDeck,
  chooseBotAction,
  computeGameOverScores,
  computeRankings,
  currentActor,
  getValidMoves,
  isStateSyncStale,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  type EngineAction,
  type RatATatCatState,
  type SeatIndex,
} from "./engine";

function allAck(state: RatATatCatState): RatATatCatState {
  let s = state;
  for (let seat = 0; seat < s.playerCount; seat++) {
    s = applyAction(s, { type: "INITIAL_PEEK_DONE", seat });
  }
  return s;
}

/**
 * Plays turns forward (drawing from the deck, discarding anything that
 * isn't a number card — using a drawTwo's power instead so its chain keeps
 * going for the *same* seat, and passing the turn via PASS_TURN whenever a
 * resolved action parks the seat in TURN_DECISION) until whoever is
 * currently up lands in DECIDE_CARD holding a number card. Since a
 * peek/swap draw always resolves (and ends that seat's turn once passed) in
 * one action, the seat that ends up in DECIDE_CARD isn't necessarily the one
 * active when this was called — callers should use the returned `seat`, not
 * their own pre-call variable.
 */
function drawUntilNumberCard(state: RatATatCatState): { state: RatATatCatState; seat: SeatIndex } {
  let s = state;
  // Safety cap — 54-card deck, can't loop forever.
  for (let i = 0; i < 200; i++) {
    if (s.phase !== "playing") return { state: s, seat: s.currentTurn };
    const seat = s.currentTurn;
    if (s.turnPhase === "DECIDE_CARD") return { state: s, seat };
    if (s.turnPhase === "TURN_DECISION") {
      s = applyAction(s, { type: "PASS_TURN", seat });
      continue;
    }
    if (s.turnPhase === "EXECUTE_POWER") {
      s = s.drawnCard?.kind === "drawTwo"
        ? applyAction(s, { type: "USE_SPECIAL_CARD", seat, power: "drawTwo" })
        : applyAction(s, { type: "DISCARD_CARD", seat });
      continue;
    }
    if (s.turnPhase === "DRAW") {
      s = applyAction(s, { type: "DRAW_CARD", seat, source: "deck" });
      continue;
    }
    return { state: s, seat };
  }
  return { state: s, seat: s.currentTurn };
}

/** Finishes out a seat's turn from TURN_DECISION by just passing (no call) — the common case in tests that only care about a plain turn-advance. */
function passTurn(state: RatATatCatState, seat: SeatIndex): RatATatCatState {
  return applyAction(state, { type: "PASS_TURN", seat });
}

/**
 * Draws for the current seat until it holds a number card, then resolves
 * that card (replace if forced, otherwise a plain discard) to land it in
 * TURN_DECISION — the only phase `CALL_RAT_A_TAT_CAT` is legal from (engine.ts
 * docstring point 5). Returns the seat now parked in TURN_DECISION.
 */
function reachTurnDecision(state: RatATatCatState): { state: RatATatCatState; seat: SeatIndex } {
  const drawn = drawUntilNumberCard(state);
  let s = drawn.state;
  const seat = drawn.seat;
  if (s.turnPhase === "DECIDE_CARD") {
    s = s.mustReplace
      ? applyAction(s, { type: "REPLACE_CARD", seat, slot: 0 })
      : applyAction(s, { type: "DISCARD_CARD", seat });
  }
  return { state: s, seat };
}

describe("startGame — setup", () => {
  it("builds a 54-card deck: 45 number cards (0-8 x4, 9 x9) + 9 special cards", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(54);
    const numbers = deck.filter((c) => c.kind === "number");
    expect(numbers).toHaveLength(45);
    for (let v = 0; v <= 8; v++) expect(numbers.filter((c) => c.kind === "number" && c.value === v)).toHaveLength(4);
    expect(numbers.filter((c) => c.kind === "number" && c.value === 9)).toHaveLength(9);
    expect(deck.filter((c) => c.kind === "peek")).toHaveLength(3);
    expect(deck.filter((c) => c.kind === "swap")).toHaveLength(3);
    expect(deck.filter((c) => c.kind === "drawTwo")).toHaveLength(3);
  });

  it("deals exactly 4 face-down cards per seat, 1 discard starter, and the remainder in deck — no overlaps", () => {
    const state = startGame(4, 1);
    expect(state.hands).toHaveLength(4);
    for (const hand of state.hands) expect(hand).toHaveLength(4);
    const allIds = [
      ...state.hands.flat().map((hc) => hc.card.id),
      ...state.discardPile.map((c) => c.id),
      ...state.deck.map((c) => c.id),
    ];
    expect(allIds).toHaveLength(54);
    expect(new Set(allIds).size).toBe(54);
    expect(state.deck).toHaveLength(54 - 16 - 1);
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(4, 777);
    const b = startGame(4, 777);
    expect(a).toEqual(b);
  });

  it("rejects out-of-range player counts", () => {
    expect(() => startGame(MIN_PLAYERS - 1, 1)).toThrow();
    expect(() => startGame(MAX_PLAYERS + 1, 1)).toThrow();
  });

  it("starts every hand fully unknown to its owner", () => {
    const state = startGame(3, 5);
    for (const hand of state.hands) for (const hc of hand) expect(hc.isKnownToOwner).toBe(false);
  });
});

describe("setup peek", () => {
  it("INITIAL_PEEK_DONE reveals only slots 0 and 3 to the owner, not 1/2", () => {
    const state = startGame(3, 5);
    const seat = state.currentTurn; // seat identity doesn't matter, use any valid one
    const next = applyAction(state, { type: "INITIAL_PEEK_DONE", seat });
    expect(next.hands[seat][0].isKnownToOwner).toBe(true);
    expect(next.hands[seat][3].isKnownToOwner).toBe(true);
    expect(next.hands[seat][1].isKnownToOwner).toBe(false);
    expect(next.hands[seat][2].isKnownToOwner).toBe(false);
    expect(next.phase).toBe("setup"); // other seats haven't acked yet
  });

  it("flips phase to playing only once every seat has acked, at the pre-picked starting seat", () => {
    const state = startGame(3, 5);
    const started = allAck(state);
    expect(started.phase).toBe("playing");
    expect(started.currentTurn).toBe(state.currentTurn);
  });

  it("a duplicate ack for an already-acked seat is a no-op", () => {
    const state = startGame(2, 5);
    const once = applyAction(state, { type: "INITIAL_PEEK_DONE", seat: 0 });
    const twice = applyAction(once, { type: "INITIAL_PEEK_DONE", seat: 0 });
    expect(twice).toEqual(once);
  });

  it("getValidMoves only offers the ack to seats that haven't acked yet", () => {
    const state = startGame(2, 5);
    expect(getValidMoves(state, 0)).toEqual([{ type: "INITIAL_PEEK_DONE", seat: 0 }]);
    const acked = applyAction(state, { type: "INITIAL_PEEK_DONE", seat: 0 });
    expect(getValidMoves(acked, 0)).toEqual([]);
    expect(getValidMoves(acked, 1)).toEqual([{ type: "INITIAL_PEEK_DONE", seat: 1 }]);
  });
});

describe("draw / decide flow", () => {
  it("drawing a number card from the deck moves to DECIDE_CARD; REPLACE_CARD swaps it in and discards the old card", () => {
    let state = allAck(startGame(3, 9));
    const first = drawUntilNumberCard(state);
    state = first.state;
    const seat = first.seat;
    expect(state.turnPhase).toBe("DECIDE_CARD");
    const drawnValue = state.drawnCard!;
    const oldCard = state.hands[seat][0].card;
    state = applyAction(state, { type: "REPLACE_CARD", seat, slot: 0 });
    expect(state.hands[seat][0].card).toEqual(drawnValue);
    expect(state.hands[seat][0].isKnownToOwner).toBe(true);
    expect(state.discardPile[state.discardPile.length - 1]).toEqual(oldCard);
    // The card action is done, but the turn doesn't advance yet — it rests
    // in TURN_DECISION so this seat can choose PASS_TURN or the call
    // (engine.ts docstring point 5) before the next seat is up.
    expect(state.turnPhase).toBe("TURN_DECISION");
    expect(state.currentTurn).toBe(seat);
    state = passTurn(state, seat);
    expect(state.currentTurn).not.toBe(seat); // turn advanced only after PASS_TURN
  });

  it("DISCARD_CARD on a plain deck-drawn number card rests in TURN_DECISION without touching the hand; PASS_TURN then advances", () => {
    let state = allAck(startGame(2, 9));
    const first = drawUntilNumberCard(state);
    state = first.state;
    const seat = first.seat;
    const handBefore = state.hands[seat];
    state = applyAction(state, { type: "DISCARD_CARD", seat });
    expect(state.hands[seat]).toEqual(handBefore);
    expect(state.turnPhase).toBe("TURN_DECISION");
    expect(state.currentTurn).toBe(seat);
    state = passTurn(state, seat);
    expect(state.currentTurn).not.toBe(seat);
  });

  it("taking from the discard pile forces a replace — DISCARD_CARD is rejected (mustReplace)", () => {
    let state = allAck(startGame(2, 3));
    // Force a known number card onto the discard pile top via a real replace first.
    const forced = drawUntilNumberCard(state);
    state = forced.state;
    const seat0 = forced.seat;
    state = passTurn(applyAction(state, { type: "REPLACE_CARD", seat: seat0, slot: 0 }), seat0);
    expect(state.discardPile[state.discardPile.length - 1].kind).toBe("number");

    const seat = state.currentTurn;
    expect(getValidMoves(state, seat).some((m) => m.type === "DRAW_CARD" && m.source === "discard")).toBe(true);
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "discard" });
    expect(state.turnPhase).toBe("DECIDE_CARD");
    expect(state.mustReplace).toBe(true);
    expect(getValidMoves(state, seat).some((m) => m.type === "DISCARD_CARD")).toBe(false);
    state = applyAction(state, { type: "DISCARD_CARD", seat }); // rejected, no-op
    expect(state.turnPhase).toBe("DECIDE_CARD");
    state = applyAction(state, { type: "REPLACE_CARD", seat, slot: 1 });
    expect(state.turnPhase).toBe("TURN_DECISION");
    state = passTurn(state, seat);
    expect(state.currentTurn).not.toBe(seat);
  });

  it("discard-pile take is unavailable when its top card is a special card", () => {
    let state = allAck(startGame(2, 1));
    // Manually stack a special card on top of the discard pile for this test.
    const special = state.deck.find((c) => c.kind !== "number")!;
    state = { ...state, discardPile: [...state.discardPile, special] };
    expect(getValidMoves(state, state.currentTurn).some((m) => m.type === "DRAW_CARD" && m.source === "discard")).toBe(false);
  });
});

describe("special cards", () => {
  it("Peek reveals a chosen slot to the owner only, resting in TURN_DECISION; PASS_TURN then ends the turn", () => {
    let state = allAck(startGame(2, 1));
    // Rig a peek card to the top of the deck for a deterministic draw.
    const peekCard = state.deck.find((c) => c.kind === "peek")!;
    state = { ...state, deck: [peekCard, ...state.deck.filter((c) => c.id !== peekCard.id)] };
    const seat = state.currentTurn;
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" });
    expect(state.turnPhase).toBe("EXECUTE_POWER");
    state = applyAction(state, { type: "USE_SPECIAL_CARD", seat, power: "peek", slot: 2 });
    expect(state.hands[seat][2].isKnownToOwner).toBe(true);
    expect(state.turnPhase).toBe("TURN_DECISION");
    expect(state.currentTurn).toBe(seat);
    expect(state.discardPile[state.discardPile.length - 1]).toEqual(peekCard);
    state = passTurn(state, seat);
    expect(state.currentTurn).not.toBe(seat);
  });

  it("Swap blindly exchanges one own slot with one opponent slot — neither side learns the new value", () => {
    let state = allAck(startGame(2, 1));
    const swapCard = state.deck.find((c) => c.kind === "swap")!;
    state = { ...state, deck: [swapCard, ...state.deck.filter((c) => c.id !== swapCard.id)] };
    const seat = state.currentTurn;
    const other = (seat + 1) % state.playerCount;
    const mineBefore = state.hands[seat][0].card;
    const theirsBefore = state.hands[other][1].card;
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" });
    state = applyAction(state, { type: "USE_SPECIAL_CARD", seat, power: "swap", mySlot: 0, targetSeat: other, targetSlot: 1 });
    expect(state.hands[seat][0].card).toEqual(theirsBefore);
    expect(state.hands[other][1].card).toEqual(mineBefore);
    expect(state.hands[seat][0].isKnownToOwner).toBe(false);
    expect(state.hands[other][1].isKnownToOwner).toBe(false);
  });

  it("Draw Two: liking the first candidate uses/discards it without a second draw", () => {
    let state = allAck(startGame(2, 1));
    const drawTwoCard = state.deck.find((c) => c.kind === "drawTwo")!;
    state = { ...state, deck: [drawTwoCard, ...state.deck.filter((c) => c.id !== drawTwoCard.id)] };
    const seat = state.currentTurn;
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" });
    state = applyAction(state, { type: "USE_SPECIAL_CARD", seat, power: "drawTwo" });
    expect(state.drawTwoStage).toBe(1);
    expect(state.turnPhase).toBe("DRAW");
    expect(getValidMoves(state, seat).some((m) => m.type === "CALL_RAT_A_TAT_CAT")).toBe(false);
    expect(getValidMoves(state, seat).some((m) => m.type === "DRAW_CARD" && m.source === "discard")).toBe(false);
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" });
    // Whatever came up, just resolve it (replace or discard) — either way it rests in
    // TURN_DECISION without a forced 3rd draw; PASS_TURN then ends the turn.
    state = state.turnPhase === "DECIDE_CARD"
      ? applyAction(state, { type: "REPLACE_CARD", seat, slot: 0 })
      : applyAction(state, { type: "DISCARD_CARD", seat });
    expect(state.turnPhase).toBe("TURN_DECISION");
    state = passTurn(state, seat);
    expect(state.currentTurn).not.toBe(seat);
  });

  it("Draw Two: rejecting the first candidate forces a mandatory second draw with no further reject option", () => {
    let state = allAck(startGame(2, 1));
    const drawTwoCard = state.deck.find((c) => c.kind === "drawTwo")!;
    state = { ...state, deck: [drawTwoCard, ...state.deck.filter((c) => c.id !== drawTwoCard.id)] };
    const seat = state.currentTurn;
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" });
    state = applyAction(state, { type: "USE_SPECIAL_CARD", seat, power: "drawTwo" });
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" }); // candidate #1
    state = applyAction(state, { type: "DISCARD_CARD", seat }); // reject it
    expect(state.drawTwoStage).toBe(2);
    expect(state.turnPhase).toBe("DRAW");
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" }); // mandatory candidate #2
    expect(state.turnPhase === "DECIDE_CARD" || state.turnPhase === "EXECUTE_POWER").toBe(true);
    // Discarding now must rest in TURN_DECISION (no 3rd draw); PASS_TURN then ends the turn.
    state = applyAction(state, { type: "DISCARD_CARD", seat });
    expect(state.turnPhase).toBe("TURN_DECISION");
    expect(state.drawTwoStage).toBe(0);
    state = passTurn(state, seat);
    expect(state.currentTurn).not.toBe(seat);
  });
});

describe("call / final round / game end", () => {
  it("CALL_RAT_A_TAT_CAT is only legal from TURN_DECISION (house-rule call timing, engine.ts docstring point 5) — never from DRAW", () => {
    const state = allAck(startGame(3, 22));
    const seat = state.currentTurn;
    expect(state.turnPhase).toBe("DRAW");
    expect(getValidMoves(state, seat).some((m) => m.type === "CALL_RAT_A_TAT_CAT")).toBe(false);
    const rejected = applyAction(state, { type: "CALL_RAT_A_TAT_CAT", seat });
    expect(rejected).toEqual(state); // no-op — the pre-draw "call instead of drawing" option was removed entirely
  });

  it("CALL_RAT_A_TAT_CAT (from TURN_DECISION, after this turn's card action) ends the caller's turn instantly and gives every other seat exactly one more turn", () => {
    let state = allAck(startGame(3, 22));
    const reached = reachTurnDecision(state);
    state = reached.state;
    const caller = reached.seat;
    expect(state.turnPhase).toBe("TURN_DECISION");
    state = applyAction(state, { type: "CALL_RAT_A_TAT_CAT", seat: caller });
    expect(state.callerId).toBe(caller);
    expect(state.finalRoundTurnsLeft).toBe(2);
    expect(state.currentTurn).not.toBe(caller);
    expect(state.phase).toBe("playing");

    // Two remaining seats each take one full turn (draw+decide+pass).
    for (let i = 0; i < 2 && state.phase === "playing"; i++) {
      const step = reachTurnDecision(state);
      state = step.state;
      if (state.phase === "playing") state = passTurn(state, step.seat);
    }
    expect(state.phase).toBe("gameOver");
    // Every hand is revealed at game end.
    for (const hand of state.hands) for (const hc of hand) expect(hc.isRevealed).toBe(true);
  });

  it("a seat cannot call twice, and a non-caller can't call after someone already has", () => {
    let state = allAck(startGame(2, 22));
    const first = reachTurnDecision(state);
    state = first.state;
    const caller = first.seat;
    state = applyAction(state, { type: "CALL_RAT_A_TAT_CAT", seat: caller });
    expect(state.currentTurn).not.toBe(caller);

    // The now-current seat reaches its own TURN_DECISION — CALL_RAT_A_TAT_CAT
    // must be rejected as a no-op purely because someone already called
    // (getValidMoves agrees it isn't offered).
    const second = reachTurnDecision(state);
    state = second.state;
    const other = second.seat;
    expect(state.turnPhase).toBe("TURN_DECISION");
    expect(getValidMoves(state, other).some((m) => m.type === "CALL_RAT_A_TAT_CAT")).toBe(false);
    const beforeCallAttempt = state;
    const afterBadCall = applyAction(state, { type: "CALL_RAT_A_TAT_CAT", seat: other });
    expect(afterBadCall).toEqual(beforeCallAttempt); // rejected no-op

    // The original caller is no longer even the current seat, so a repeat call is rejected on that basis too.
    const afterCallerRetry = applyAction(state, { type: "CALL_RAT_A_TAT_CAT", seat: caller });
    expect(afterCallerRetry).toEqual(state);
  });

  it("deck exhaustion ends the round immediately, even mid final-round countdown", () => {
    let state = allAck(startGame(2, 3));
    // Drain the deck down to 1 card via repeated forced draw/decide/pass turns.
    let guard = 0;
    while (state.deck.length > 1 && guard < 200) {
      const step = reachTurnDecision(state);
      state = step.state;
      if (state.phase === "playing") state = passTurn(state, step.seat);
      guard++;
    }
    expect(state.phase).toBe("playing");
    expect(state.deck.length).toBe(1);
    const seat = state.currentTurn;
    state = applyAction(state, { type: "DRAW_CARD", seat, source: "deck" });
    expect(state.deck).toHaveLength(0);
    state = applyAction(state, { type: "DISCARD_CARD", seat });
    expect(state.turnPhase).toBe("TURN_DECISION"); // the card action itself never ends the round early
    expect(state.phase).toBe("playing");
    state = passTurn(state, seat); // only PASS_TURN's advanceTurn actually checks deck exhaustion
    expect(state.phase).toBe("gameOver");
  });
});

describe("scoring (§6.2 special-card substitution)", () => {
  it("a hand of all-number cards scores as the plain sum", () => {
    let state = allAck(startGame(2, 4));
    // Force gameOver by calling as soon as possible, then letting the other seat play its one final turn out.
    const reached = reachTurnDecision(state);
    state = reached.state;
    state = applyAction(state, { type: "CALL_RAT_A_TAT_CAT", seat: reached.seat });
    const step = reachTurnDecision(state);
    state = step.state;
    if (state.phase === "playing") state = passTurn(state, step.seat);
    expect(state.phase).toBe("gameOver");

    const scores = computeGameOverScores(state);
    for (const s of scores) {
      const expected = s.slots.reduce((sum, sl) => sum + sl.value, 0);
      expect(s.total).toBe(expected);
      for (const sl of s.slots) {
        if (sl.card.kind === "number") expect(sl.value).toBe(sl.card.value);
      }
    }
  });

  it("a leftover special card in a hand is substituted with the next number card drawn from the remaining deck", () => {
    let state = allAck(startGame(2, 4));
    state = { ...state, phase: "gameOver" };
    // Force seat 0 slot 0 to hold a special card, and rig the remaining deck's first card to a known number.
    const special = state.hands[1].find((hc) => hc.card.kind !== "number")?.card ?? state.deck.find((c) => c.kind !== "number")!;
    const hands = state.hands.map((hand, s) =>
      s === 0 ? (hand.map((hc, i) => (i === 0 ? { ...hc, card: special } : hc)) as typeof hand) : hand,
    );
    const rigged = { ...state, hands, deck: [{ id: "rigged-3", kind: "number" as const, value: 3 }, ...state.deck] };
    const scores = computeGameOverScores(rigged);
    const slot0 = scores[0].slots[0];
    expect(slot0.substituted).toBe(true);
    expect(slot0.value).toBe(3);
  });
});

describe("getValidMoves / chooseBotAction", () => {
  it("only the current turn's seat gets non-empty moves during playing", () => {
    const state = allAck(startGame(3, 11));
    const active = state.currentTurn;
    for (let seat = 0; seat < 3; seat++) {
      if (seat === active) expect(getValidMoves(state, seat).length).toBeGreaterThan(0);
      else expect(getValidMoves(state, seat)).toEqual([]);
    }
  });

  it("chooseBotAction always returns a legal move for the active actor, across every phase reachable in a short playthrough", () => {
    let state = startGame(4, 123);
    for (let i = 0; i < 4; i++) state = applyAction(state, { type: "INITIAL_PEEK_DONE", seat: i });

    // Bumped from the pre-TURN_DECISION 500 — every turn now needs an extra
    // PASS_TURN/CALL_RAT_A_TAT_CAT step after its card action resolves
    // (engine.ts docstring point 5), so a full playthrough takes roughly 1.5x
    // as many actions as before.
    let guard = 0;
    while (state.phase !== "gameOver" && guard < 800) {
      const actor = currentActor(state);
      expect(actor).not.toBeNull();
      const action = chooseBotAction(state, actor!, 5, () => 0.999);
      expect(action).not.toBeNull();
      const legal = getValidMoves(state, actor!);
      expect(legal.some((m) => JSON.stringify(m) === JSON.stringify(action))).toBe(true);
      state = applyAction(state, action as EngineAction);
      guard++;
    }
    expect(state.phase).toBe("gameOver");
  });

  it("Lv.1 (rng always 0, forced mistake path) and Lv.10 (never a mistake) can diverge on the same candidate set", () => {
    let state = allAck(startGame(2, 9));
    const drawn = drawUntilNumberCard(state);
    state = drawn.state;
    const seat = drawn.seat;
    const lv1 = chooseBotAction(state, seat, 1, () => 0); // rng<mistake-chance -> uniformly random first candidate
    const lv10 = chooseBotAction(state, seat, 10, () => 0); // never a mistake -> pure argmax
    expect(lv1).not.toBeNull();
    expect(lv10).not.toBeNull();
    const legal = getValidMoves(state, seat);
    expect(lv1).toEqual(legal[0]);
  });
});

describe("bot vs bot full games never hang or error", () => {
  const seeds = [1, 2, 3, 42, 12345];
  for (const seed of seeds) {
    for (const playerCount of [2, 4, 6]) {
      it(`playerCount=${playerCount} seed=${seed} completes`, () => {
        let state = startGame(playerCount, seed);
        for (let seat = 0; seat < playerCount; seat++) state = applyAction(state, { type: "INITIAL_PEEK_DONE", seat });
        // Bumped from 2000 — see the same-sized comment in the
        // getValidMoves/chooseBotAction describe block above.
        let guard = 0;
        while (state.phase !== "gameOver" && guard < 3000) {
          const actor = currentActor(state)!;
          const action = chooseBotAction(state, actor, 5);
          if (!action) break;
          state = applyAction(state, action);
          guard++;
        }
        expect(state.phase).toBe("gameOver");
        expect(guard).toBeLessThan(3000);
        const rankings = computeRankings(state);
        expect(rankings).toHaveLength(playerCount);
        expect(rankings[0].rank).toBe(1);
      });
    }
  }
});

describe("isStateSyncStale", () => {
  it("accepts when the caller has no current state yet", () => {
    const synced = startGame(2, 1);
    expect(isStateSyncStale(null, synced)).toBe(false);
  });

  it("rejects a synced snapshot whose seq is behind the caller's own", () => {
    const state = startGame(2, 1);
    const advanced = applyAction(state, { type: "INITIAL_PEEK_DONE", seat: 0 });
    expect(isStateSyncStale(advanced, state)).toBe(true);
    expect(isStateSyncStale(state, advanced)).toBe(false);
  });
});
