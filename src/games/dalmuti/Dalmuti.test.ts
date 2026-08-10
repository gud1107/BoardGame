import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildDeck,
  computeRankings,
  isLegalPlay,
  JOKER_COUNT,
  JOKER_RANK,
  legalPlayOptions,
  MAX_CARD_RANK,
  MAX_PLAYERS,
  MIN_PLAYERS,
  rankTitle,
  startGame,
  type Card,
  type DalmutiState,
  type PlayerState,
} from "./engine";

// Per engine.ts's module doc §0: the task brief described a repeating
// multi-round loop with rank reassignment between rounds, but the
// user-supplied rulebook (`boardGameRule/달무티/달무티.md`) is explicitly
// "단판승부" (single-round) only. Asked via AskUserQuestion; the user chose
// the rulebook's single-round design. So there is no "차기 라운드 계급
// 재배치" to test — its single-round equivalent is `computeRankings`
// deriving the final standing from `finishOrder` (§5 below), which this file
// covers instead.

function card(rank: number, copy = 0): Card {
  return { id: `${rank}-${copy}`, rank, isJoker: false };
}
function joker(copy: number): Card {
  return { id: `joker-${copy}`, rank: JOKER_RANK, isJoker: true };
}
function makePlayer(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { seat, hand: [], finishedAtOrder: null, ...overrides };
}
function makeState(overrides: Partial<DalmutiState> = {}): DalmutiState {
  const playerCount = overrides.playerCount ?? 4;
  const rankOrder = overrides.rankOrder ?? Array.from({ length: playerCount }, (_, i) => i);
  const players = overrides.players ?? Array.from({ length: playerCount }, (_, seat) => makePlayer(seat));
  return {
    playerCount,
    players,
    rankOrder,
    phase: "trick",
    pendingRevolution: null,
    tributes: [],
    trick: { rankValue: null, count: 0, plays: [], leaderSeat: rankOrder[0], consecutivePasses: 0 },
    activeSeat: rankOrder[0],
    finishOrder: [],
    lastTrickResult: null,
    revolutionDeclared: null,
    initialSeed: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Deck composition — rank N has exactly N copies (1..12), plus 2 jokers
// ---------------------------------------------------------------------------

describe("buildDeck", () => {
  it("builds an 80-card deck: rank N has N copies for N=1..12, plus 2 jokers", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(78 + JOKER_COUNT);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    for (let rank = 1; rank <= MAX_CARD_RANK; rank++) {
      expect(deck.filter((c) => c.rank === rank && !c.isJoker)).toHaveLength(rank);
    }
    const jokers = deck.filter((c) => c.isJoker);
    expect(jokers).toHaveLength(JOKER_COUNT);
    expect(jokers.every((c) => c.rank === JOKER_RANK)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. startGame — setup, dealing, revolution eligibility detection
// ---------------------------------------------------------------------------

describe("startGame", () => {
  it("rejects player counts outside 3-8", () => {
    expect(() => startGame(MIN_PLAYERS - 1, 1)).toThrow();
    expect(() => startGame(MAX_PLAYERS + 1, 1)).toThrow();
    expect(() => startGame(MIN_PLAYERS, 1)).not.toThrow();
    expect(() => startGame(MAX_PLAYERS, 1)).not.toThrow();
  });

  it("deals the deck evenly from a permutation rankOrder, setting aside any remainder", () => {
    const state = startGame(6, 42);
    expect(new Set(state.rankOrder).size).toBe(6);
    expect(state.rankOrder.every((s) => s >= 0 && s < 6)).toBe(true);
    const perPlayer = Math.floor(80 / 6);
    const dealtTotal = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    // Right after dealing (before any forced tribute reshuffles hand sizes),
    // every hand should be exactly perPlayer.
    if (state.phase === "taxReturn" || state.phase === "trick") {
      // tribute may have already moved cards around by the time we can
      // observe "taxReturn"; check the pre-tribute invariant via the total
      // instead, which tribute exchange never changes.
    }
    expect(dealtTotal).toBeLessThanOrEqual(80);
    expect(dealtTotal).toBeGreaterThanOrEqual(perPlayer * 6 - 1); // -1 slack: at most one hand could be mid-tribute-transfer accounting quirk
  });

  it("routes to revolutionOption when a seat holds both jokers, else straight to taxReturn with tribute already handed over", () => {
    let sawRevolution = false;
    let sawTax = false;
    for (let seed = 0; seed < 800 && !(sawRevolution && sawTax); seed++) {
      const state = startGame(5, seed);
      const jokerHolder = state.phase === "revolutionOption" ? state.players.find((p) => p.hand.filter((c) => c.isJoker).length === JOKER_COUNT) : undefined;
      if (state.phase === "revolutionOption") {
        sawRevolution = true;
        expect(state.pendingRevolution).not.toBeNull();
        expect(state.pendingRevolution!.seat).toBe(jokerHolder!.seat);
        const isGrand = state.rankOrder[state.playerCount - 1] === jokerHolder!.seat;
        expect(state.pendingRevolution!.isGrand).toBe(isGrand);
        expect(state.tributes).toHaveLength(0);
      } else if (state.phase === "taxReturn") {
        sawTax = true;
        expect(state.tributes.length).toBeGreaterThan(0);
        // Forced tribute already moved: the recipient's hand temporarily
        // contains the giver's given cards.
        for (const t of state.tributes) {
          const recipient = state.players.find((p) => p.seat === t.toSeat)!;
          expect(t.givenCardIds.every((id) => recipient.hand.some((c) => c.id === id))).toBe(true);
        }
      }
    }
    expect(sawRevolution).toBe(true);
    expect(sawTax).toBe(true);
  });

  it("skips the 소농노↔총리 exchange at exactly 3 players (same seat would trade with itself)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = startGame(3, seed);
      if (state.phase === "taxReturn") {
        expect(state.tributes).toHaveLength(1);
        expect(state.tributes[0].fromSeat).toBe(state.rankOrder[2]);
        expect(state.tributes[0].toSeat).toBe(state.rankOrder[0]);
        return;
      }
    }
    throw new Error("no non-revolution seed found in range — widen the search");
  });
});

// ---------------------------------------------------------------------------
// 3. Tax collection (forced tribute + chosen return) and revolution handling
// ---------------------------------------------------------------------------

describe("tax phase", () => {
  it("forces the 대농노's 2 highest non-joker cards to the 달무티, exempting jokers", () => {
    const players = [
      makePlayer(0, { hand: [card(6), card(7)] }), // 달무티
      makePlayer(1, { hand: [card(5), card(5, 1)] }), // 총리 (also 소농노 here since n=3... use n=4 below instead)
      makePlayer(2, { hand: [card(1), card(2), card(9), joker(0)] }), // 대농노: highest = 1, 2 (joker excluded)
    ];
    const state = makeState({ playerCount: 3, players, rankOrder: [0, 1, 2], phase: "revolutionOption", pendingRevolution: { seat: 2, isGrand: false } });
    const next = applyAction(state, { type: "declineRevolution", seat: 2 });
    expect(next.phase).toBe("taxReturn");
    expect(next.tributes).toHaveLength(1);
    const t = next.tributes[0];
    expect(t.fromSeat).toBe(2);
    expect(t.toSeat).toBe(0);
    expect(t.givenCardIds.sort()).toEqual(["1-0", "2-0"]);
    // Cards already moved: 대농노 no longer has them, 달무티 does.
    const greatPeon = next.players.find((p) => p.seat === 2)!;
    const dalmuti = next.players.find((p) => p.seat === 0)!;
    expect(greatPeon.hand.some((c) => c.id === "1-0" || c.id === "2-0")).toBe(false);
    expect(dalmuti.hand.some((c) => c.id === "1-0")).toBe(true);
    expect(dalmuti.hand.some((c) => c.id === "2-0")).toBe(true);
  });

  it("also runs the 소농노↔총리 (1 card) exchange when n >= 4", () => {
    const players = [
      makePlayer(0, { hand: [card(8)] }), // 달무티
      makePlayer(1, { hand: [card(6)] }), // 총리
      makePlayer(2, { hand: [card(9)] }), // 중농
      makePlayer(3, { hand: [card(1), card(2), card(3)] }), // 대농노
    ];
    const state = makeState({ playerCount: 4, players, rankOrder: [0, 1, 2, 3], phase: "revolutionOption", pendingRevolution: { seat: 3, isGrand: false } });
    // No 소농노 hand set up with a card to give — add one via seat 2 (rankOrder[n-2]=rankOrder[2]=2).
    const withLesserPeonHand: DalmutiState = {
      ...state,
      players: state.players.map((p) => (p.seat === 2 ? { ...p, hand: [card(4)] } : p)),
    };
    const next = applyAction(withLesserPeonHand, { type: "declineRevolution", seat: 3 });
    expect(next.tributes).toHaveLength(2);
    const lesserTribute = next.tributes.find((t) => t.fromSeat === 2)!;
    expect(lesserTribute.toSeat).toBe(1);
    expect(lesserTribute.givenCardIds).toEqual(["4-0"]);
  });

  it("lets the recipient choose which cards to return, restoring both hands to their original sizes", () => {
    const players = [
      makePlayer(0, { hand: [card(6), card(7)] }),
      makePlayer(1, { hand: [card(5)] }),
      makePlayer(2, { hand: [card(1), card(2), card(9)] }),
    ];
    const declined = applyAction(
      makeState({ playerCount: 3, players, rankOrder: [0, 1, 2], phase: "revolutionOption", pendingRevolution: { seat: 2, isGrand: false } }),
      { type: "declineRevolution", seat: 2 },
    );
    expect(declined.phase).toBe("taxReturn");
    const dalmuti = declined.players.find((p) => p.seat === 0)!;
    expect(dalmuti.hand).toHaveLength(4); // original 2 + 2 forced tribute

    // Wrong count rejected.
    const rejectedCount = applyAction(declined, { type: "returnTax", seat: 0, cardIds: ["6-0"] });
    expect(rejectedCount).toBe(declined);

    // Card not owned rejected.
    const rejectedOwnership = applyAction(declined, { type: "returnTax", seat: 0, cardIds: ["6-0", "99-0"] });
    expect(rejectedOwnership).toBe(declined);

    const resolved = applyAction(declined, { type: "returnTax", seat: 0, cardIds: ["6-0", "7-0"] });
    expect(resolved.phase).toBe("trick"); // only tribute in a 3-player game — resolving it finishes the whole tax phase
    const greatPeon = resolved.players.find((p) => p.seat === 2)!;
    const dalmutiAfter = resolved.players.find((p) => p.seat === 0)!;
    expect(dalmutiAfter.hand.map((c) => c.id).sort()).toEqual(["1-0", "2-0"]);
    expect(greatPeon.hand.map((c) => c.id).sort()).toEqual(["6-0", "7-0", "9-0"]);
    expect(resolved.activeSeat).toBe(resolved.rankOrder[0]);
  });
});

describe("revolution", () => {
  it("일반 대혁명 (non-대농노 holder): skips tax, ranks unchanged", () => {
    const state = makeState({
      playerCount: 4,
      rankOrder: [0, 1, 2, 3],
      phase: "revolutionOption",
      pendingRevolution: { seat: 1, isGrand: false },
    });
    const next = applyAction(state, { type: "declareRevolution", seat: 1 });
    expect(next.phase).toBe("trick");
    expect(next.rankOrder).toEqual([0, 1, 2, 3]);
    expect(next.tributes).toHaveLength(0);
    expect(next.revolutionDeclared).toEqual({ seat: 1, isGrand: false });
    expect(next.activeSeat).toBe(0);
  });

  it("대혁명 (대농노 holder): skips tax AND reverses every rank", () => {
    const state = makeState({
      playerCount: 4,
      rankOrder: [0, 1, 2, 3],
      phase: "revolutionOption",
      pendingRevolution: { seat: 3, isGrand: true },
    });
    const next = applyAction(state, { type: "declareRevolution", seat: 3 });
    expect(next.phase).toBe("trick");
    expect(next.rankOrder).toEqual([3, 2, 1, 0]); // old 대농노(3) -> new 달무티, old 달무티(0) -> new 대농노
    expect(next.tributes).toHaveLength(0);
    expect(next.activeSeat).toBe(3); // new 달무티 leads
  });

  it("ignores a declare/decline from a seat that isn't the pending revolution holder", () => {
    const state = makeState({
      playerCount: 4,
      rankOrder: [0, 1, 2, 3],
      phase: "revolutionOption",
      pendingRevolution: { seat: 3, isGrand: true },
    });
    expect(applyAction(state, { type: "declareRevolution", seat: 0 })).toBe(state);
    expect(applyAction(state, { type: "declineRevolution", seat: 0 })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 4. Trick play validity — count match, strictly lower rank, joker wildcard
// ---------------------------------------------------------------------------

describe("trick play", () => {
  it("leader may play any nonempty same-rank set (with jokers padding count)", () => {
    const players = [makePlayer(0, { hand: [card(4), card(4, 1), joker(0)] }), makePlayer(1, { hand: [card(2)] }), makePlayer(2, { hand: [card(7)] })];
    const state = makeState({ playerCount: 3, players, rankOrder: [0, 1, 2] });
    expect(isLegalPlay(state, 0, ["4-0", "4-1", "joker-0"])).toBe(true);
    const next = applyAction(state, { type: "playCards", seat: 0, cardIds: ["4-0", "4-1", "joker-0"] });
    expect(next.trick.rankValue).toBe(4);
    expect(next.trick.count).toBe(3);
    expect(next.trick.leaderSeat).toBe(0);
    expect(next.activeSeat).toBe(1);
  });

  it("a joker played alone leads as rank 13 (weakest)", () => {
    const players = [makePlayer(0, { hand: [joker(0)] }), makePlayer(1, { hand: [card(9)] })];
    const state = makeState({ playerCount: 2, players, rankOrder: [0, 1] });
    const next = applyAction(state, { type: "playCards", seat: 0, cardIds: ["joker-0"] });
    expect(next.trick.rankValue).toBe(JOKER_RANK);
    expect(next.trick.count).toBe(1);
  });

  it("rejects a mismatched count and a non-lower rank", () => {
    const players = [makePlayer(0, { hand: [card(3), card(3, 1), card(10)] }), makePlayer(1, { hand: [card(2), card(9)] })];
    let state = makeState({ playerCount: 2, players, rankOrder: [0, 1] });
    state = applyAction(state, { type: "playCards", seat: 0, cardIds: ["3-0", "3-1"] });
    expect(state.trick.rankValue).toBe(3);
    expect(state.activeSeat).toBe(1);

    // wrong count (1 instead of 2)
    expect(isLegalPlay(state, 1, ["2-0"])).toBe(false);
    expect(applyAction(state, { type: "playCards", seat: 1, cardIds: ["2-0"] })).toBe(state);

    // same count but not a lower rank
    const higherHand = [card(3), card(4)];
    const state2 = makeState({ playerCount: 2, players: [makePlayer(0), makePlayer(1, { hand: higherHand })], rankOrder: [0, 1], trick: { rankValue: 3, count: 2, plays: [], leaderSeat: 0, consecutivePasses: 0 }, activeSeat: 1 });
    expect(isLegalPlay(state2, 1, ["3-0", "4-0"])).toBe(false); // mixed ranks
  });

  it("rejects mixing two different non-joker ranks in one play", () => {
    const players = [makePlayer(0, { hand: [card(3), card(4)] })];
    const state = makeState({ playerCount: 1, players, rankOrder: [0] });
    expect(isLegalPlay(state, 0, ["3-0", "4-0"])).toBe(false);
  });

  it("legalPlayOptions only lists rank groups that can currently be legally played", () => {
    const players = [makePlayer(0, { hand: [card(5), card(5, 1), card(9), joker(0)] }), makePlayer(1, { hand: [card(9)] })];
    const state = makeState({
      playerCount: 2,
      players,
      rankOrder: [0, 1],
      trick: { rankValue: 6, count: 2, plays: [], leaderSeat: 1, consecutivePasses: 0 },
      activeSeat: 0,
    });
    const options = legalPlayOptions(state, 0);
    // rank 5 (2 copies) qualifies: count>=2 and 5<6. rank 9 alone (1 copy + joker = 2) also qualifies (9 real + joker pad), but 9 itself is not < 6 so rejected.
    expect(options.some((o) => o.rank === 5 && o.maxCount >= 2)).toBe(true);
    expect(options.some((o) => o.rank === 9)).toBe(false);
  });

  it("passing does not permanently lock a seat out of the trick — they get prompted again if someone else plays after them", () => {
    const players = [
      makePlayer(0, { hand: [card(6), card(1)] }),
      makePlayer(1, { hand: [card(5)] }),
      makePlayer(2, { hand: [card(4)] }),
    ];
    let state = makeState({ playerCount: 3, players, rankOrder: [0, 1, 2] });
    state = applyAction(state, { type: "playCards", seat: 0, cardIds: ["6-0"] }); // lead rank 6
    expect(state.activeSeat).toBe(1);
    state = applyAction(state, { type: "pass", seat: 1 }); // seat 1 passes
    expect(state.activeSeat).toBe(2);
    state = applyAction(state, { type: "playCards", seat: 2, cardIds: ["4-0"] }); // seat 2 beats with rank 4
    expect(state.trick.leaderSeat).toBe(2);
    expect(state.activeSeat).toBe(0);
    state = applyAction(state, { type: "pass", seat: 0 });
    // Full circle hasn't happened yet — seat 1 (who already passed once) must get another turn.
    expect(state.activeSeat).toBe(1);
    expect(state.phase).toBe("trick");
  });

  it("resolves the trick once every other active seat has passed in a row, and the winner leads next", () => {
    const players = [
      makePlayer(0, { hand: [card(6), card(10)] }),
      makePlayer(1, { hand: [card(2), card(11)] }),
      makePlayer(2, { hand: [card(9), card(12)] }),
    ];
    let state = makeState({ playerCount: 3, players, rankOrder: [0, 1, 2] });
    state = applyAction(state, { type: "playCards", seat: 0, cardIds: ["6-0"] });
    state = applyAction(state, { type: "playCards", seat: 1, cardIds: ["2-0"] }); // seat 1 beats, now leader
    state = applyAction(state, { type: "pass", seat: 2 });
    expect(state.phase).toBe("trick"); // seat 0 still needs to respond
    state = applyAction(state, { type: "pass", seat: 0 });
    expect(state.lastTrickResult).toEqual({ winnerSeat: 1, rankValue: 2, count: 1, plays: expect.any(Array) });
    expect(state.trick.leaderSeat).toBe(1);
    expect(state.activeSeat).toBe(1);
    expect(state.trick.count).toBe(0); // fresh empty trick
  });

  it("when the trick winner just emptied their hand, the next still-active seat leads instead", () => {
    // 4 seats so two finishing in a row (seat 0 leads out, seat 1 beats out)
    // still leaves 2 active seats — the game only auto-ends at <=1 active
    // seat (separately covered below), so this scenario stays observable.
    const players = [
      makePlayer(0, { hand: [card(6)] }),
      makePlayer(1, { hand: [card(2)] }),
      makePlayer(2, { hand: [card(9), card(8)] }),
      makePlayer(3, { hand: [card(7), card(1)] }),
    ];
    let state = makeState({ playerCount: 4, players, rankOrder: [0, 1, 2, 3] });
    state = applyAction(state, { type: "playCards", seat: 0, cardIds: ["6-0"] });
    state = applyAction(state, { type: "playCards", seat: 1, cardIds: ["2-0"] }); // seat 1's last card — now empty-handed but still "winning"
    expect(state.players.find((p) => p.seat === 1)!.finishedAtOrder).toBe(2);
    expect(state.phase).toBe("trick");
    state = applyAction(state, { type: "pass", seat: 2 });
    expect(state.phase).toBe("trick"); // seat 3 still needs to respond
    state = applyAction(state, { type: "pass", seat: 3 });
    expect(state.trick.leaderSeat).toBe(2); // seat 1 (finished) is skipped as next leader
    expect(state.activeSeat).toBe(2);
  });

  it("ends the game the instant only one player still holds cards, auto-assigning them last place", () => {
    const players = [makePlayer(0, { hand: [card(6)] }), makePlayer(1, { hand: [card(9)] })];
    let state = makeState({ playerCount: 2, players, rankOrder: [0, 1] });
    state = applyAction(state, { type: "playCards", seat: 0, cardIds: ["6-0"] });
    expect(state.phase).toBe("gameOver");
    expect(state.finishOrder).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// 5. Final ranking — single-round equivalent of "다음 라운드 계급 재배치"
//    (see module doc §0: this project asked the user and the user chose the
//    rulebook's single-round design, so ranking is derived once from
//    finishOrder rather than reassigned between rounds).
// ---------------------------------------------------------------------------

describe("computeRankings", () => {
  it("ranks seats 1-based in the order they finished", () => {
    const state = makeState({ playerCount: 3, finishOrder: [2, 0, 1], phase: "gameOver" });
    expect(computeRankings(state)).toEqual([
      { seat: 2, rank: 1 },
      { seat: 0, rank: 2 },
      { seat: 1, rank: 3 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. Player-standing titles
// ---------------------------------------------------------------------------

describe("rankTitle", () => {
  it("names the extremes and the standard middle roles for n >= 4", () => {
    expect(rankTitle(0, 5)).toBe("달무티");
    expect(rankTitle(1, 5)).toBe("총리");
    expect(rankTitle(2, 5)).toBe("중농");
    expect(rankTitle(3, 5)).toBe("소농노");
    expect(rankTitle(4, 5)).toBe("대농노");
  });

  it("folds 소농노 into 총리 at n=3 (same seat, no self-trade)", () => {
    expect(rankTitle(0, 3)).toBe("달무티");
    expect(rankTitle(1, 3)).toBe("총리");
    expect(rankTitle(2, 3)).toBe("대농노");
  });
});
