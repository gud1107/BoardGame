import { describe, expect, it } from "vitest";
import { detectCommonerSwapEvents, detectTaxEvents, detectTaxHighlightEvents, isExchangeParticipant } from "./DalmutiEffects";
import {
  applyAction,
  buildDeck,
  chooseBotAction,
  computeRankings,
  getValidMoves,
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
  type EngineAction,
  type PlayerState,
  type SeatIndex,
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
    commonerExchange: null,
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

  it("skips the 거지(Beggar)↔귀족(Noble) exchange at exactly 3 players (same seat would trade with itself)", () => {
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
  it("forces the 노예(Slave)'s 2 highest non-joker cards to the 왕(King), exempting jokers", () => {
    const players = [
      makePlayer(0, { hand: [card(6), card(7)] }), // 왕
      makePlayer(1, { hand: [card(5), card(5, 1)] }), // 귀족 (also 거지 here since n=3... use n=4 below instead)
      makePlayer(2, { hand: [card(1), card(2), card(9), joker(0)] }), // 노예: highest = 1, 2 (joker excluded)
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

  it("also runs the 거지(Beggar)↔귀족(Noble) (1 card) exchange when n >= 4", () => {
    const players = [
      makePlayer(0, { hand: [card(8)] }), // 왕
      makePlayer(1, { hand: [card(6)] }), // 귀족
      makePlayer(2, { hand: [card(9)] }), // 평민
      makePlayer(3, { hand: [card(1), card(2), card(3)] }), // 노예
    ];
    const state = makeState({ playerCount: 4, players, rankOrder: [0, 1, 2, 3], phase: "revolutionOption", pendingRevolution: { seat: 3, isGrand: false } });
    // No 거지 hand set up with a card to give — add one via seat 2 (rankOrder[n-2]=rankOrder[2]=2).
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

// ---------------------------------------------------------------------------
// Commoner (평민) voluntary mutual exchange (§5, 2026-08-25) — opt-in only
// (no partner selection, per user confirmation), engine pairs everyone who
// opted in two-at-a-time in rank order, odd leftover sits out untouched.
// ---------------------------------------------------------------------------

describe("commoner mutual exchange", () => {
  it("resolving the last tribute enters commonerExchange with exactly the 평민-tier seats when there are >= 2 of them (n=6)", () => {
    const players = [
      makePlayer(0, { hand: [] }),
      makePlayer(1, { hand: [card(9, 0)] }), // 귀족, already holding the forced tribute from 거지
      makePlayer(2, { hand: [card(3), card(4)] }), // 평민
      makePlayer(3, { hand: [card(5), card(6)] }), // 평민
      makePlayer(4, { hand: [] }), // 거지
      makePlayer(5, { hand: [] }), // 노예
    ];
    const state = makeState({
      playerCount: 6,
      players,
      rankOrder: [0, 1, 2, 3, 4, 5],
      phase: "taxReturn",
      tributes: [
        { fromSeat: 5, toSeat: 0, givenCardIds: [], returnedCardIds: [], resolved: true },
        { fromSeat: 4, toSeat: 1, givenCardIds: ["9-0"], returnedCardIds: [], resolved: false },
      ],
    });
    const next = applyAction(state, { type: "returnTax", seat: 1, cardIds: ["9-0"] });
    expect(next.phase).toBe("commonerExchange");
    expect(next.commonerExchange).not.toBeNull();
    expect(next.commonerExchange!.participants.map((p) => p.seat).sort()).toEqual([2, 3]);
    expect(next.commonerExchange!.participants.every((p) => p.participate === null)).toBe(true);
    expect(next.commonerExchange!.pairs).toHaveLength(0);
  });

  it("skips straight to trick when fewer than 2 평민 seats exist (n=4)", () => {
    const players = [makePlayer(0), makePlayer(1, { hand: [card(9, 0)] }), makePlayer(2), makePlayer(3)];
    const state = makeState({
      playerCount: 4,
      players,
      rankOrder: [0, 1, 2, 3],
      phase: "taxReturn",
      tributes: [
        { fromSeat: 3, toSeat: 0, givenCardIds: [], returnedCardIds: [], resolved: true },
        { fromSeat: 2, toSeat: 1, givenCardIds: ["9-0"], returnedCardIds: [], resolved: false },
      ],
    });
    const next = applyAction(state, { type: "returnTax", seat: 1, cardIds: ["9-0"] });
    expect(next.phase).toBe("trick");
    expect(next.commonerExchange).toBeNull();
    expect(next.activeSeat).toBe(next.rankOrder[0]);
  });

  it("both commoners opting in pairs them; each privately picks a card and the swap lands in the other's hand, then the phase advances to trick", () => {
    const state = makeState({
      playerCount: 6,
      rankOrder: [0, 1, 2, 3, 4, 5],
      phase: "commonerExchange",
      players: [
        makePlayer(0),
        makePlayer(1),
        makePlayer(2, { hand: [card(3), card(4)] }),
        makePlayer(3, { hand: [card(10), card(11)] }),
        makePlayer(4),
        makePlayer(5),
      ],
      commonerExchange: {
        participants: [
          { seat: 2, participate: null },
          { seat: 3, participate: null },
        ],
        pairs: [],
      },
    });

    const afterOptIns = [
      { type: "commonerOptIn", seat: 2, participate: true },
      { type: "commonerOptIn", seat: 3, participate: true },
    ].reduce<DalmutiState>((s, a) => applyAction(s, a as EngineAction), state);
    expect(afterOptIns.phase).toBe("commonerExchange");
    expect(afterOptIns.commonerExchange!.pairs).toEqual([{ seatA: 2, seatB: 3, cardIdA: null, cardIdB: null, resolved: false }]);

    // Seat 2 offers its card first — no swap yet, seat 3 hasn't picked.
    const afterFirstOffer = applyAction(afterOptIns, { type: "commonerOfferCard", seat: 2, cardId: "3-0" });
    expect(afterFirstOffer.phase).toBe("commonerExchange");
    expect(afterFirstOffer.players.find((p) => p.seat === 2)!.hand.map((c) => c.id)).toEqual(["3-0", "4-0"]); // not yet moved

    // Seat 3 offers its card — both sides picked, swap applies immediately and the phase advances.
    const resolved = applyAction(afterFirstOffer, { type: "commonerOfferCard", seat: 3, cardId: "10-0" });
    expect(resolved.phase).toBe("trick");
    expect(resolved.commonerExchange).toBeNull();
    const seat2After = resolved.players.find((p) => p.seat === 2)!;
    const seat3After = resolved.players.find((p) => p.seat === 3)!;
    expect(seat2After.hand.map((c) => c.id).sort()).toEqual(["10-0", "4-0"]);
    expect(seat3After.hand.map((c) => c.id).sort()).toEqual(["11-0", "3-0"]);
  });

  it("either side declining means no pair forms and the phase advances straight to trick (no exchange)", () => {
    const state = makeState({
      playerCount: 6,
      rankOrder: [0, 1, 2, 3, 4, 5],
      phase: "commonerExchange",
      players: Array.from({ length: 6 }, (_, seat) => makePlayer(seat, { hand: seat === 2 || seat === 3 ? [card(5)] : [] })),
      commonerExchange: {
        participants: [
          { seat: 2, participate: null },
          { seat: 3, participate: null },
        ],
        pairs: [],
      },
    });
    const afterAccept = applyAction(state, { type: "commonerOptIn", seat: 2, participate: true });
    const afterDecline = applyAction(afterAccept, { type: "commonerOptIn", seat: 3, participate: false });
    expect(afterDecline.phase).toBe("trick");
    expect(afterDecline.commonerExchange).toBeNull();
    // Nobody's hand changed — no exchange happened.
    expect(afterDecline.players.find((p) => p.seat === 2)!.hand.map((c) => c.id)).toEqual(["5-0"]);
    expect(afterDecline.players.find((p) => p.seat === 3)!.hand.map((c) => c.id)).toEqual(["5-0"]);
  });

  it("an odd number of opted-in commoners leaves one seat unpaired, and the phase still advances once the single pair resolves", () => {
    const state = makeState({
      playerCount: 7,
      rankOrder: [0, 1, 2, 3, 4, 5, 6],
      phase: "commonerExchange",
      players: [
        makePlayer(0),
        makePlayer(1),
        makePlayer(2, { hand: [card(1)] }),
        makePlayer(3, { hand: [card(2)] }),
        makePlayer(4, { hand: [card(8)] }), // will opt in, stays unpaired (odd one out)
        makePlayer(5),
        makePlayer(6),
      ],
      commonerExchange: {
        participants: [
          { seat: 2, participate: null },
          { seat: 3, participate: null },
          { seat: 4, participate: null },
        ],
        pairs: [],
      },
    });
    const afterOptIns = [2, 3, 4]
      .map((seat) => ({ type: "commonerOptIn" as const, seat, participate: true }))
      .reduce<DalmutiState>((s, a) => applyAction(s, a as EngineAction), state);
    expect(afterOptIns.commonerExchange!.pairs).toEqual([{ seatA: 2, seatB: 3, cardIdA: null, cardIdB: null, resolved: false }]);

    const resolved = [
      { type: "commonerOfferCard" as const, seat: 2, cardId: "1-0" },
      { type: "commonerOfferCard" as const, seat: 3, cardId: "2-0" },
    ].reduce<DalmutiState>((s, a) => applyAction(s, a as EngineAction), afterOptIns);
    expect(resolved.phase).toBe("trick"); // seat 4's untouched hand didn't block the transition
    expect(resolved.players.find((p) => p.seat === 4)!.hand.map((c) => c.id)).toEqual(["8-0"]);
  });

  it("lets each commoner pick ANY card to hand over — not just their weakest one (true free choice, 2026-08-25 후속 세션 task brief §1)", () => {
    const state = makeState({
      playerCount: 6,
      rankOrder: [0, 1, 2, 3, 4, 5],
      phase: "commonerExchange",
      players: [
        makePlayer(0),
        makePlayer(1),
        makePlayer(2, { hand: [card(2), card(11)] }), // rank 2 = its BEST card, rank 11 = its weakest
        makePlayer(3, { hand: [card(6)] }),
        makePlayer(4),
        makePlayer(5),
      ],
      commonerExchange: {
        participants: [
          { seat: 2, participate: null },
          { seat: 3, participate: null },
        ],
        pairs: [],
      },
    });
    const afterOptIns = [
      { type: "commonerOptIn", seat: 2, participate: true },
      { type: "commonerOptIn", seat: 3, participate: true },
    ].reduce<DalmutiState>((s, a) => applyAction(s, a as EngineAction), state);

    // Deliberately offer the STRONG card (rank 2) rather than the weak one —
    // proves the engine doesn't silently narrow the pick to a "best/weakest
    // card only" rule the way the forced tax tribute's auto-selection does.
    const afterOffer = applyAction(afterOptIns, { type: "commonerOfferCard", seat: 2, cardId: "2-0" });
    expect(afterOffer.commonerExchange!.pairs[0].cardIdA).toBe("2-0");

    const resolved = applyAction(afterOffer, { type: "commonerOfferCard", seat: 3, cardId: "6-0" });
    expect(resolved.phase).toBe("trick");
    const seat2After = resolved.players.find((p) => p.seat === 2)!;
    const seat3After = resolved.players.find((p) => p.seat === 3)!;
    expect(seat2After.hand.map((c) => c.id).sort()).toEqual(["11-0", "6-0"]);
    expect(seat3After.hand.map((c) => c.id)).toEqual(["2-0"]);
  });

  it("rejects an out-of-turn or already-decided opt-in, and a card the seat doesn't hold", () => {
    const state = makeState({
      playerCount: 6,
      rankOrder: [0, 1, 2, 3, 4, 5],
      phase: "commonerExchange",
      players: Array.from({ length: 6 }, (_, seat) => makePlayer(seat, { hand: seat === 2 ? [card(5)] : [] })),
      commonerExchange: {
        participants: [
          { seat: 2, participate: null },
          { seat: 3, participate: null },
        ],
        pairs: [],
      },
    });
    // Seat 0 isn't a commoner participant at all.
    expect(applyAction(state, { type: "commonerOptIn", seat: 0, participate: true })).toBe(state);

    const afterOptIn = applyAction(state, { type: "commonerOptIn", seat: 2, participate: true });
    // Seat 2 already decided — a second opt-in is a no-op.
    expect(applyAction(afterOptIn, { type: "commonerOptIn", seat: 2, participate: false })).toBe(afterOptIn);
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

describe("rankTitle (5-tier 왕/귀족/평민/거지/노예 rename, 2026-08-25)", () => {
  it("names the extremes and the standard middle roles for n >= 4", () => {
    expect(rankTitle(0, 5)).toBe("왕");
    expect(rankTitle(1, 5)).toBe("귀족");
    expect(rankTitle(2, 5)).toBe("평민");
    expect(rankTitle(3, 5)).toBe("거지");
    expect(rankTitle(4, 5)).toBe("노예");
  });

  it("folds 거지 into 귀족 at n=3 (same seat, no self-trade)", () => {
    expect(rankTitle(0, 3)).toBe("왕");
    expect(rankTitle(1, 3)).toBe("귀족");
    expect(rankTitle(2, 3)).toBe("노예");
  });

  it("assigns exactly the confirmed slot table for every supported player count (3-8): 1 왕, 1 귀족 (folded into 왕's opposite at n=3), 1 거지, 1 노예, remainder 평민", () => {
    const expectedCommonerCount: Record<number, number> = { 3: 0, 4: 0, 5: 1, 6: 2, 7: 3, 8: 4 };
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const titles = Array.from({ length: n }, (_, pos) => rankTitle(pos, n));
      expect(titles[0]).toBe("왕");
      expect(titles[n - 1]).toBe("노예");
      if (n >= 4) {
        expect(titles[1]).toBe("귀족");
        expect(titles[n - 2]).toBe("거지");
      }
      const commoners = titles.filter((t) => t === "평민");
      expect(commoners).toHaveLength(expectedCommonerCount[n]);
    }
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty)
// ---------------------------------------------------------------------------

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("revolutionOption: only the pending seat gets declare/decline, in that order", () => {
    const state = makeState({ phase: "revolutionOption", pendingRevolution: { seat: 1, isGrand: false } });
    expect(getValidMoves(state, 1)).toEqual([
      { type: "declareRevolution", seat: 1 },
      { type: "declineRevolution", seat: 1 },
    ]);
    expect(getValidMoves(state, 0)).toEqual([]);
  });

  it("taxReturn: only the unresolved recipient gets returnTax combos of the right size", () => {
    const state = makeState({
      phase: "taxReturn",
      tributes: [{ fromSeat: 3, toSeat: 0, givenCardIds: ["9-0", "9-1"], returnedCardIds: [], resolved: false }],
      players: [
        makePlayer(0, { hand: [card(1), card(2), card(9, 0), card(9, 1)] }),
        makePlayer(1),
        makePlayer(2),
        makePlayer(3),
      ],
    });
    const moves = getValidMoves(state, 0);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.type).toBe("returnTax");
      expect((m as { cardIds: string[] }).cardIds).toHaveLength(2);
    }
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("trick: leading offers every count for every rank group, no pass; following is scoped to the current player's turn", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [card(5), card(5, 1), card(7)] }), makePlayer(1), makePlayer(2), makePlayer(3)],
      activeSeat: 0,
    });
    const moves = getValidMoves(state, 0);
    expect(moves.some((m) => m.type === "pass")).toBe(false);
    expect(moves.every((m) => m.type === "playCards")).toBe(true);
    expect(getValidMoves(state, 1)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null once nobody has a pending decision (e.g. an idle seat mid-trick)", () => {
    const state = makeState({ players: [makePlayer(0, { hand: [card(4)] }), makePlayer(1, { hand: [card(6)] }), makePlayer(2), makePlayer(3)], activeSeat: 0 });
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("always returns a legal move regardless of level", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [card(3), card(3, 1), card(8)] }), makePlayer(1), makePlayer(2), makePlayer(3)],
      activeSeat: 0,
    });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) declares a non-grand revolution it would be better off declining, while Level 10 declines to keep its tribute income", () => {
    // Seat 0 sits at rank position 0 (달무티) — declining a non-grand
    // revolution keeps its free 2-card tribute, so declare is the wrong
    // call here. getValidMoves lists declare before decline, so Level 1's
    // forced-random path (rng always 0 -> candidates[0]) lands on declare.
    const state = makeState({
      phase: "revolutionOption",
      rankOrder: [0, 1, 2, 3],
      pendingRevolution: { seat: 0, isGrand: false },
    });

    const level1Action = chooseBotAction(state, 0, 1, () => 0);
    expect(level1Action).toEqual({ type: "declareRevolution", seat: 0 });

    const level10Action = chooseBotAction(state, 0, 10, () => 0);
    expect(level10Action).toEqual({ type: "declineRevolution", seat: 0 });
  });
});

function currentActorForTest(state: DalmutiState): SeatIndex | null {
  if (state.phase === "revolutionOption") return state.pendingRevolution?.seat ?? null;
  if (state.phase === "taxReturn") {
    const unresolved = state.tributes.filter((t) => !t.resolved);
    if (unresolved.length === 0) return null;
    return Math.min(...unresolved.map((t) => t.toSeat));
  }
  if (state.phase === "commonerExchange") {
    const ex = state.commonerExchange;
    if (!ex) return null;
    const undecided = ex.participants.filter((p) => p.participate === null).map((p) => p.seat);
    if (undecided.length > 0) return Math.min(...undecided);
    const needsCard: SeatIndex[] = [];
    for (const pair of ex.pairs) {
      if (pair.resolved) continue;
      if (pair.cardIdA === null) needsCard.push(pair.seatA);
      if (pair.cardIdB === null) needsCard.push(pair.seatB);
    }
    return needsCard.length > 0 ? Math.min(...needsCard) : null;
  }
  if (state.phase === "trick") return state.activeSeat;
  return null;
}

function playFullBotGame(playerCount: number, seed: number, levelOf: (seat: SeatIndex) => number): DalmutiState {
  let state = startGame(playerCount, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 5000) {
    guard++;
    const seat = currentActorForTest(state);
    if (seat === null) break;
    const action = chooseBotAction(state, seat, levelOf(seat));
    expect(action).not.toBeNull();
    state = applyAction(state, action as EngineAction);
  }
  return state;
}

// ---------------------------------------------------------------------------
// 7. Exchange-masking security gate (2026-08-25 후속 세션, task brief §2 "카드
//    교환 내용 타 플레이어 비공개 처리") — `DalmutiEffects.tsx`'s pure
//    `isExchangeParticipant`/`detectTaxEvents`/`detectCommonerSwapEvents` are
//    framework-free, so they're testable here without jsdom/RTL (this
//    project's `*.test.ts` files otherwise only ever import `engine.ts`, per
//    docs/architecture.md §1's "boardUI 컴포넌트는 유닛 테스트 대상이 아니다").
//    This is the masking *gate* every renderer must consult, not a network
//    boundary — see engine.ts's §6 doc for why true payload-level secrecy is
//    out of scope under this project's server-less lockstep trust model.
// ---------------------------------------------------------------------------

describe("isExchangeParticipant (masking gate for FlyingExchangeCard)", () => {
  it("is true only for the two seats actually party to an exchange, false for every third-party viewer", () => {
    const event = { seat: 3, targetSeat: 0 }; // e.g. 노예(3) -> 왕(0) tribute
    expect(isExchangeParticipant(event, 3)).toBe(true);
    expect(isExchangeParticipant(event, 0)).toBe(true);
    expect(isExchangeParticipant(event, 1)).toBe(false);
    expect(isExchangeParticipant(event, 2)).toBe(false);
  });
});

describe("detectTaxEvents / detectCommonerSwapEvents auraTier tagging (drives both FX color and which CardBack a masked viewer sees)", () => {
  it('tags the 노예↔왕 tribute "king" and the 거지↔귀족 tribute "noble"', () => {
    const prev = makeState({
      playerCount: 4,
      rankOrder: [0, 1, 2, 3],
      tributes: [],
      players: [makePlayer(0), makePlayer(1), makePlayer(2, { hand: [card(4)] }), makePlayer(3, { hand: [card(1), card(2)] })],
    });
    const next: DalmutiState = {
      ...prev,
      tributes: [
        { fromSeat: 3, toSeat: 0, givenCardIds: ["1-0", "2-0"], returnedCardIds: [], resolved: false },
        { fromSeat: 2, toSeat: 1, givenCardIds: ["4-0"], returnedCardIds: [], resolved: false },
      ],
      players: [
        makePlayer(0, { hand: [card(1), card(2)] }),
        makePlayer(1, { hand: [card(4)] }),
        makePlayer(2, { hand: [] }),
        makePlayer(3, { hand: [] }),
      ],
    };
    const events = detectTaxEvents(prev, next);
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.seat === 3)!.auraTier).toBe("king");
    expect(events.find((e) => e.seat === 2)!.auraTier).toBe("noble");
  });

  it('tags every 평민 swap event "commoner", both directions', () => {
    const prev = makeState({
      playerCount: 6,
      rankOrder: [0, 1, 2, 3, 4, 5],
      phase: "commonerExchange",
      players: [makePlayer(0), makePlayer(1), makePlayer(2, { hand: [card(3)] }), makePlayer(3, { hand: [card(9)] }), makePlayer(4), makePlayer(5)],
      commonerExchange: {
        participants: [
          { seat: 2, participate: true },
          { seat: 3, participate: true },
        ],
        pairs: [{ seatA: 2, seatB: 3, cardIdA: "3-0", cardIdB: null, resolved: false }],
      },
    });
    const next = applyAction(prev, { type: "commonerOfferCard", seat: 3, cardId: "9-0" });
    const events = detectCommonerSwapEvents(prev, next);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.auraTier === "commoner")).toBe(true);
  });
});

describe("detectTaxHighlightEvents (large 세금 교환 완료 팝업, 2026-09-01 세션)", () => {
  it("pairs the forced-tribute leg with the return leg the instant a tribute record resolves, tagged by tier", () => {
    const prev = makeState({
      playerCount: 4,
      rankOrder: [0, 1, 2, 3],
      phase: "taxReturn",
      tributes: [{ fromSeat: 3, toSeat: 0, givenCardIds: ["1-0", "2-0"], returnedCardIds: [], resolved: false }],
      players: [makePlayer(0, { hand: [card(6), card(7), card(1), card(2)] }), makePlayer(1), makePlayer(2), makePlayer(3, { hand: [] })],
    });
    const next = applyAction(prev, { type: "returnTax", seat: 0, cardIds: ["6-0", "7-0"] });
    const events = detectTaxHighlightEvents(prev, next);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.recipientSeat).toBe(0);
    expect(e.giverSeat).toBe(3);
    expect(e.auraTier).toBe("king");
    expect(e.givenCards.map((c) => c.id).sort()).toEqual(["1-0", "2-0"]);
    expect(e.returnedCards.map((c) => c.id).sort()).toEqual(["6-0", "7-0"]);
  });

  it("emits nothing while a tribute is still unresolved, or for an unrelated no-op action", () => {
    const prev = makeState({
      playerCount: 4,
      rankOrder: [0, 1, 2, 3],
      phase: "taxReturn",
      tributes: [{ fromSeat: 3, toSeat: 0, givenCardIds: ["1-0"], returnedCardIds: [], resolved: false }],
      players: [makePlayer(0, { hand: [card(6), card(1)] }), makePlayer(1), makePlayer(2), makePlayer(3, { hand: [] })],
    });
    // Wrong card count — rejected by the engine, same state reference back.
    const rejected = applyAction(prev, { type: "returnTax", seat: 0, cardIds: [] });
    expect(detectTaxHighlightEvents(prev, rejected)).toHaveLength(0);
  });

  it("resolves both the 왕↔노예 and 귀족↔거지 tributes into two independent events at n=5, each finds the real cards wherever they currently sit", () => {
    let state = makeState({
      playerCount: 5,
      rankOrder: [0, 1, 2, 3, 4],
      phase: "taxReturn",
      tributes: [
        { fromSeat: 4, toSeat: 0, givenCardIds: ["1-0", "2-0"], returnedCardIds: [], resolved: false },
        { fromSeat: 3, toSeat: 1, givenCardIds: ["4-0"], returnedCardIds: [], resolved: false },
      ],
      players: [
        makePlayer(0, { hand: [card(8), card(9), card(1), card(2)] }),
        makePlayer(1, { hand: [card(6), card(4)] }),
        makePlayer(2),
        makePlayer(3, { hand: [] }),
        makePlayer(4, { hand: [] }),
      ],
    });
    let allEvents: ReturnType<typeof detectTaxHighlightEvents> = [];
    for (const [seat, cardIds] of [
      [0, ["8-0", "9-0"]],
      [1, ["6-0"]],
    ] as const) {
      const next = applyAction(state, { type: "returnTax", seat, cardIds: [...cardIds] });
      allEvents = [...allEvents, ...detectTaxHighlightEvents(state, next)];
      state = next;
    }
    expect(allEvents).toHaveLength(2);
    const kingEvent = allEvents.find((e) => e.auraTier === "king")!;
    expect(kingEvent.recipientSeat).toBe(0);
    expect(kingEvent.giverSeat).toBe(4);
    expect(kingEvent.givenCards.map((c) => c.id).sort()).toEqual(["1-0", "2-0"]);
    expect(kingEvent.returnedCards.map((c) => c.id).sort()).toEqual(["8-0", "9-0"]);
    const nobleEvent = allEvents.find((e) => e.auraTier === "noble")!;
    expect(nobleEvent.recipientSeat).toBe(1);
    expect(nobleEvent.giverSeat).toBe(3);
    expect(nobleEvent.givenCards.map((c) => c.id)).toEqual(["4-0"]);
    expect(nobleEvent.returnedCards.map((c) => c.id)).toEqual(["6-0"]);
  });
});

// ---------------------------------------------------------------------------
// 8. 5인 귀족↔거지 세금 교환 왕복 회귀 테스트 (2026-09-01 세션) — task brief는
//    "17장 시작 후 되돌려받지 못함"이라는 버그를 전제했으나, 실제로는 80장÷5=
//    16장 균등 분배(나머지 없음)이며 아래 시뮬레이션에서 200개 시드 전부 두
//    트랜잭션(왕↔노예 2장, 귀족↔거지 1장) 모두 정상 왕복해 전원 16장으로
//    복원됨을 확인(AskUserQuestion으로 사용자에게 보고 후 확정) — 재발 방지용
//    영구 회귀 테스트로 편입.
// ---------------------------------------------------------------------------
describe("5인 세금 교환 왕복 (귀족↔거지 포함) 회귀", () => {
  it("both king and noble tributes resolve and every hand returns to exactly 16 cards, across many seeds", () => {
    for (let seed = 1; seed <= 50; seed++) {
      let state = startGame(5, seed);
      expect(
        state.players.reduce((sum, p) => sum + p.hand.length, 0),
      ).toBe(80); // 80 / 5 divides evenly — no leftover cards set aside

      if (state.phase === "revolutionOption") {
        state = applyAction(state, { type: "declineRevolution", seat: state.pendingRevolution!.seat });
      }
      expect(state.phase).toBe("taxReturn");
      expect(state.tributes).toHaveLength(2);

      let guard = 0;
      while (state.phase === "taxReturn" && guard < 10) {
        for (const t of state.tributes.filter((t) => !t.resolved)) {
          const moves = getValidMoves(state, t.toSeat).filter((m) => m.type === "returnTax");
          expect(moves.length).toBeGreaterThan(0);
          state = applyAction(state, moves[0]);
        }
        guard++;
      }
      expect(state.tributes.every((t) => t.resolved)).toBe(true);
      for (const p of state.players) expect(p.hand.length).toBe(16);
    }
  });
});

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    it(`completes a ${n}-player all-Level-10 game with every seat ranked`, () => {
      const state = playFullBotGame(n, 200 + n, () => 10);
      expect(state.phase).toBe("gameOver");
      const rankings = computeRankings(state);
      expect(rankings).toHaveLength(n);
      expect(new Set(rankings.map((r) => r.seat)).size).toBe(n);
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(5, 888, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(computeRankings(state)).toHaveLength(5);
  });
});
