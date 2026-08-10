import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildCheckDeck,
  CHECK_DECK_SIZE,
  computeRankings,
  getPlayerView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_SETUP,
  PROPERTY_COUNT,
  startGame,
  type ForSaleState,
  type SeatIndex,
} from "./engine";

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

describe("buildCheckDeck — 룰북 §2 구성품 (수표 카드 30장)", () => {
  it("builds exactly 30 cards", () => {
    expect(buildCheckDeck()).toHaveLength(30);
    expect(CHECK_DECK_SIZE).toBe(30);
  });

  it("has 15 distinct values $0..$14,000 (step $1,000), 2 copies each — see engine.ts module doc assumption #1", () => {
    const deck = buildCheckDeck();
    const values = Array.from(new Set(deck)).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 15 }, (_, i) => i * 1000));
    for (const v of values) {
      expect(deck.filter((c) => c === v)).toHaveLength(2);
    }
    expect(deck).toContain(0);
  });
});

describe("PLAYER_SETUP — 룰북 §3 인원별 세팅", () => {
  it("gives every supported player count the same flat $14,000 (rulebook table, not the task brief's 차등 지급 framing)", () => {
    for (const n of [3, 4, 5, 6]) {
      expect(PLAYER_SETUP[n].cash).toBe(14000);
    }
  });

  it("uses card counts divisible by player count for every supported size (structural requirement — see assumption #3 for the 4-player correction)", () => {
    for (const n of [3, 4, 5, 6]) {
      expect(PLAYER_SETUP[n].cardsUsed % n).toBe(0);
      expect(PLAYER_SETUP[n].cardsUsed).toBeLessThanOrEqual(30);
    }
    expect(PLAYER_SETUP[3].cardsUsed).toBe(24);
    expect(PLAYER_SETUP[4].cardsUsed).toBe(28);
    expect(PLAYER_SETUP[5].cardsUsed).toBe(30);
    expect(PLAYER_SETUP[6].cardsUsed).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------

describe("startGame", () => {
  it("rejects unsupported player counts", () => {
    expect(() => startGame(2, 1)).toThrow();
    expect(() => startGame(7, 1)).toThrow();
  });

  it("is deterministic for a fixed seed", () => {
    const a = startGame(4, 12345);
    const b = startGame(4, 12345);
    expect(a).toEqual(b);
  });

  it("differs for different seeds (sanity check the RNG is actually wired in)", () => {
    const a = startGame(4, 1);
    const b = startGame(4, 2);
    expect(a.auction!.openCards).not.toEqual(b.auction!.openCards);
  });

  for (const n of [MIN_PLAYERS, 4, 5, MAX_PLAYERS]) {
    it(`deals every property card at most once and every player starts with $${PLAYER_SETUP[n].cash} for ${n} players`, () => {
      const state = startGame(n, 777);
      expect(state.playerCount).toBe(n);
      expect(state.players).toHaveLength(n);
      for (const p of state.players) {
        expect(p.cash).toBe(PLAYER_SETUP[n].cash);
        expect(p.properties).toEqual([]);
        expect(p.checks).toEqual([]);
      }
      // Every property number used (in the deck + this round's open cards) is unique and within 1..30.
      const used = [...state.propertyDeck, ...state.auction!.openCards];
      expect(used).toHaveLength(PLAYER_SETUP[n].cardsUsed);
      expect(new Set(used).size).toBe(used.length);
      for (const c of used) {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(PROPERTY_COUNT);
      }
    });
  }

  it("opens exactly `playerCount` property cards sorted ascending for the first round", () => {
    const state = startGame(5, 99);
    expect(state.auction!.openCards).toHaveLength(5);
    const sorted = [...state.auction!.openCards].sort((a, b) => a - b);
    expect(state.auction!.openCards).toEqual(sorted);
  });

  it("starts in the buying phase with a valid random starter", () => {
    const state = startGame(4, 5);
    expect(state.phase).toBe("buying");
    expect(state.auction!.activeSeat).toBeGreaterThanOrEqual(0);
    expect(state.auction!.activeSeat).toBeLessThan(4);
    expect(state.roundStarter).toBe(state.auction!.activeSeat);
    expect(state.auction!.activeSeats).toEqual([0, 1, 2, 3].map((i) => (state.roundStarter + i) % 4));
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — bidding validity
// ---------------------------------------------------------------------------

describe("Phase 1 — 입찰(bid) 유효성 (룰북 §4-1-2-A)", () => {
  it("rejects a bid from a seat that isn't the active seat", () => {
    const state = startGame(4, 1);
    const otherSeat = (state.auction!.activeSeat + 1) % 4;
    const next = applyAction(state, { type: "bid", seat: otherSeat, amount: 1000 });
    expect(next).toBe(state); // no-op
  });

  it("requires at least a $1,000 increase over the current bid", () => {
    const state = startGame(4, 1);
    const seat = state.auction!.activeSeat;
    const tooSmall = applyAction(state, { type: "bid", seat, amount: 999 });
    expect(tooSmall).toBe(state);
    const ok = applyAction(state, { type: "bid", seat, amount: 1000 });
    expect(ok.auction!.currentBid).toBe(1000);
    expect(ok.auction!.highBidderSeat).toBe(seat);
  });

  it("rejects a second bid from the same seat that doesn't clear the new floor", () => {
    const state = startGame(4, 1);
    const seat = state.auction!.activeSeat;
    const bidOnce = applyAction(state, { type: "bid", seat, amount: 2000 });
    const nextSeat = bidOnce.auction!.activeSeat;
    const rebid = applyAction(bidOnce, { type: "bid", seat: nextSeat, amount: 2500 });
    expect(rebid).toBe(bidOnce); // below +1000 floor
    const validRebid = applyAction(bidOnce, { type: "bid", seat: nextSeat, amount: 3000 });
    expect(validRebid.auction!.currentBid).toBe(3000);
  });

  it("rejects a bid exceeding the bidder's own cash", () => {
    const state = startGame(3, 1);
    const seat = state.auction!.activeSeat;
    const overCash = applyAction(state, { type: "bid", seat, amount: 999000 });
    expect(overCash).toBe(state);
  });

  it("rejects a non-$1,000-multiple bid", () => {
    const state = startGame(4, 1);
    const seat = state.auction!.activeSeat;
    const bad = applyAction(state, { type: "bid", seat, amount: 1500 });
    expect(bad).toBe(state);
  });

  it("advances turn to the next active seat after a bid", () => {
    const state = startGame(4, 1);
    const seat = state.auction!.activeSeat;
    const next = applyAction(state, { type: "bid", seat, amount: 1000 });
    expect(next.auction!.activeSeat).toBe((seat + 1) % 4);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — pass / refund / round resolution
// ---------------------------------------------------------------------------

describe("Phase 1 — 포기(pass) 및 정산 (룰북 §4-1-2-B, §4-1-3)", () => {
  it("pays $0 and takes the lowest open card when passing without ever bidding (rulebook FAQ example 3)", () => {
    const state = startGame(4, 1);
    const seat = state.auction!.activeSeat;
    const cash = state.players.find((p) => p.seat === seat)!.cash;
    const lowest = Math.min(...state.auction!.openCards);
    const next = applyAction(state, { type: "pass", seat });
    const player = next.players.find((p) => p.seat === seat)!;
    expect(player.cash).toBe(cash);
    expect(player.properties).toEqual([lowest]);
    expect(next.auction!.openCards).not.toContain(lowest);
    expect(next.auction!.activeSeats).not.toContain(seat);
  });

  it("pays $1,000 (floored to the nearest coin, not $1,500) when passing after a $3,000 bid — rulebook FAQ example 1", () => {
    // 3 players: bidder bids $3,000, someone else outbids to $4,000 (so the
    // round doesn't collapse to 1 the instant the bidder later folds), the
    // third seat passes with no bid of their own, then the original bidder
    // folds on their own $3,000 — testing THEIR refund specifically.
    let state = startGame(3, 1);
    const [bidder, outbidder, bystander] = state.auction!.activeSeats;
    state = applyAction(state, { type: "bid", seat: bidder, amount: 3000 });
    state = applyAction(state, { type: "bid", seat: outbidder, amount: 4000 });
    state = applyAction(state, { type: "pass", seat: bystander });
    expect(state.auction!.activeSeat).toBe(bidder);
    const cashBefore = state.players.find((p) => p.seat === bidder)!.cash;
    const lowestNow = Math.min(...state.auction!.openCards);
    const afterPass = applyAction(state, { type: "pass", seat: bidder });
    const player = afterPass.players.find((p) => p.seat === bidder)!;
    expect(player.cash).toBe(cashBefore - 1000);
    expect(player.properties).toContain(lowestNow);
  });

  it("pays $2,000 (not $2,500) when passing after a $5,000 bid — rulebook FAQ example 2", () => {
    let state = startGame(3, 1);
    const [bidder, outbidder, bystander] = state.auction!.activeSeats;
    state = applyAction(state, { type: "bid", seat: bidder, amount: 5000 });
    state = applyAction(state, { type: "bid", seat: outbidder, amount: 6000 });
    state = applyAction(state, { type: "pass", seat: bystander });
    const cashBefore = state.players.find((p) => p.seat === bidder)!.cash;
    const afterPass = applyAction(state, { type: "pass", seat: bidder });
    const player = afterPass.players.find((p) => p.seat === bidder)!;
    expect(player.cash).toBe(cashBefore - 2000);
  });

  it("resolves the round the instant one bidder remains: they pay their bid in full and take the highest remaining card", () => {
    let state = startGame(3, 1);
    const seats = state.auction!.activeSeats;
    const winner = seats[0];
    state = applyAction(state, { type: "bid", seat: winner, amount: 4000 });
    const cashBefore = state.players.find((p) => p.seat === winner)!.cash;
    const openCardsBefore = [...state.auction!.openCards];
    // Everyone else passes.
    let s2 = state;
    for (let i = 0; i < seats.length - 1; i++) {
      s2 = applyAction(s2, { type: "pass", seat: s2.auction!.activeSeat });
    }
    // Round should have auto-resolved: winner paid in full, took the single highest card.
    const winnerPlayer = s2.players.find((p) => p.seat === winner)!;
    expect(winnerPlayer.cash).toBe(cashBefore - 4000);
    expect(winnerPlayer.properties).toContain(Math.max(...openCardsBefore));
    expect(s2.lastAuctionResult).not.toBeNull();
    expect(s2.lastAuctionResult!.winnerSeat).toBe(winner);
    expect(s2.lastAuctionResult!.winnerPaid).toBe(4000);
  });

  it("makes the round winner the next round's starter (rulebook §4-1-3)", () => {
    let state = startGame(3, 1);
    const seats = state.auction!.activeSeats;
    const winner = seats[2];
    // First two pass, leaving the third as the automatic winner at $0.
    state = applyAction(state, { type: "pass", seat: state.auction!.activeSeat });
    state = applyAction(state, { type: "pass", seat: state.auction!.activeSeat });
    expect(state.roundStarter).toBe(winner);
    expect(state.auction!.activeSeat).toBe(winner);
  });

  it("rejects passing/bidding from a seat that already passed this round", () => {
    let state = startGame(4, 1);
    const passer = state.auction!.activeSeat;
    state = applyAction(state, { type: "pass", seat: passer });
    const again = applyAction(state, { type: "pass", seat: passer });
    expect(again).toBe(state); // no-op, passer is no longer active/active-seat
  });
});

// ---------------------------------------------------------------------------
// Full Phase 1 -> Phase 2 lifecycle (integration, "everyone always passes" strategy)
// ---------------------------------------------------------------------------

function playAllPassesUntilSelling(state: ForSaleState): ForSaleState {
  let s = state;
  while (s.phase === "buying") {
    s = applyAction(s, { type: "pass", seat: s.auction!.activeSeat });
  }
  return s;
}

describe("Phase 1 전체 진행 (모두가 항상 포기하는 결정론적 경로)", () => {
  for (const n of [3, 4, 5, 6]) {
    it(`gives every player exactly ${PLAYER_SETUP[n].cardsUsed / n} property cards for ${n} players once the deck is exhausted`, () => {
      let state = startGame(n, 42);
      state = playAllPassesUntilSelling(state);
      expect(state.phase).toBe("selling");
      expect(state.propertyDeck).toEqual([]);
      const expectedEach = PLAYER_SETUP[n].cardsUsed / n;
      for (const p of state.players) {
        expect(p.properties).toHaveLength(expectedEach);
      }
      // Cash is untouched since nobody ever bid (every pass/win was at $0).
      for (const p of state.players) {
        expect(p.cash).toBe(PLAYER_SETUP[n].cash);
      }
      // Every property number dealt is unique across all hands.
      const allDealt = state.players.flatMap((p) => p.properties);
      expect(new Set(allDealt).size).toBe(allDealt.length);
      expect(allDealt).toHaveLength(PLAYER_SETUP[n].cardsUsed);
    });
  }

  it("deals the first sale round with `playerCount` checks sorted ascending", () => {
    let state = startGame(4, 7);
    state = playAllPassesUntilSelling(state);
    expect(state.sale!.openChecks).toHaveLength(4);
    const sorted = [...state.sale!.openChecks].sort((a, b) => a - b);
    expect(state.sale!.openChecks).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — blind submission / reveal / scoring
// ---------------------------------------------------------------------------

function seatsOf(state: ForSaleState): SeatIndex[] {
  return state.players.map((p) => p.seat);
}

describe("Phase 2 — 동시 제출 및 정산 (룰북 §4-2)", () => {
  function makeSellingState(playerCount = 4, seed = 7): ForSaleState {
    const state = startGame(playerCount, seed);
    return playAllPassesUntilSelling(state);
  }

  it("rejects submitting a property card the seat doesn't own", () => {
    const state = makeSellingState();
    const seat = 0;
    const notOwned = state.players.find((p) => p.seat !== seat)!.properties[0];
    const next = applyAction(state, { type: "submitCard", seat, property: notOwned });
    expect(next).toBe(state);
  });

  it("rejects a second submission from the same seat before the round resolves", () => {
    let state = makeSellingState();
    const seat = 0;
    const card = state.players.find((p) => p.seat === seat)!.properties[0];
    state = applyAction(state, { type: "submitCard", seat, property: card });
    const again = applyAction(state, { type: "submitCard", seat, property: card });
    expect(again).toBe(state);
  });

  it("keeps submissions hidden from other seats until everyone has submitted, but always visible to the submitter (getPlayerView)", () => {
    let state = makeSellingState();
    const [seat0, seat1] = seatsOf(state);
    const card0 = state.players.find((p) => p.seat === seat0)!.properties[0];
    state = applyAction(state, { type: "submitCard", seat: seat0, property: card0 });

    const viewFromSeat1 = getPlayerView(state, seat1);
    expect(viewFromSeat1.find((v) => v.seat === seat0)!.property).toBeNull(); // hidden from others

    const viewFromSeat0 = getPlayerView(state, seat0);
    expect(viewFromSeat0.find((v) => v.seat === seat0)!.property).toBe(card0); // visible to submitter
  });

  it("auto-resolves once every seat has submitted: highest property gets the highest check, descending", () => {
    let state = makeSellingState(4, 7);
    const seats = seatsOf(state);
    // Submit each seat's lowest-numbered card, in seat order, tracking who submitted what.
    const submitted: Record<SeatIndex, number> = {};
    for (const seat of seats) {
      const card = Math.min(...state.players.find((p) => p.seat === seat)!.properties);
      submitted[seat] = card;
      state = applyAction(state, { type: "submitCard", seat, property: card });
    }
    expect(state.sale!.revealed).toBe(true);
    expect(state.lastSaleResult).not.toBeNull();

    const sortedChecksDesc = [...state.sale!.openChecks].sort((a, b) => b - a);
    const orderedBySubmission = [...seats].sort((a, b) => submitted[b] - submitted[a]);
    orderedBySubmission.forEach((seat, i) => {
      const assignment = state.lastSaleResult!.assignments.find((a) => a.seat === seat)!;
      expect(assignment.property).toBe(submitted[seat]);
      expect(assignment.check).toBe(sortedChecksDesc[i]);
    });

    // Winners' hands updated: submitted card gone, check added.
    for (const seat of seats) {
      const player = state.players.find((p) => p.seat === seat)!;
      expect(player.properties).not.toContain(submitted[seat]);
      const assignment = state.lastSaleResult!.assignments.find((a) => a.seat === seat)!;
      expect(player.checks).toContain(assignment.check);
    }
  });

  it("getPlayerView reveals every submission (to everyone) once the round has resolved", () => {
    let state = makeSellingState();
    for (const seat of seatsOf(state)) {
      const card = Math.min(...state.players.find((p) => p.seat === seat)!.properties);
      state = applyAction(state, { type: "submitCard", seat, property: card });
    }
    const view = getPlayerView(state, seatsOf(state)[0]);
    for (const v of view) expect(v.property).not.toBeNull();
  });

  it("continueSale is a no-op until the round has been revealed", () => {
    const state = makeSellingState();
    const next = applyAction(state, { type: "continueSale" });
    expect(next).toBe(state);
  });

  it("continueSale deals the next round, clearing submissions/reveal", () => {
    let state = makeSellingState();
    for (const seat of seatsOf(state)) {
      const card = Math.min(...state.players.find((p) => p.seat === seat)!.properties);
      state = applyAction(state, { type: "submitCard", seat, property: card });
    }
    const next = applyAction(state, { type: "continueSale" });
    expect(next.phase).toBe("selling");
    expect(next.sale!.revealed).toBe(false);
    expect(next.sale!.submissions).toEqual({});
    expect(next.sale!.openChecks).toHaveLength(next.playerCount);
  });
});

// ---------------------------------------------------------------------------
// Full game to gameOver + final scoring
// ---------------------------------------------------------------------------

function playFullGame(playerCount: number, seed: number): ForSaleState {
  let state = startGame(playerCount, seed);
  state = playAllPassesUntilSelling(state);
  while (state.phase === "selling") {
    for (const seat of seatsOf(state)) {
      const hand = state.players.find((p) => p.seat === seat)!.properties;
      if (!state.sale!.submissions[seat]) {
        state = applyAction(state, { type: "submitCard", seat, property: Math.min(...hand) });
      }
    }
    state = applyAction(state, { type: "continueSale" });
  }
  return state;
}

describe("전체 게임 흐름 (Phase 1 -> Phase 2 -> gameOver)", () => {
  for (const n of [3, 4, 5, 6]) {
    it(`reaches gameOver for ${n} players with every property/check card resolved`, () => {
      const state = playFullGame(n, 2024);
      expect(state.phase).toBe("gameOver");
      expect(state.checkDeck).toEqual([]);
      expect(state.sale).toBeNull();
      for (const p of state.players) {
        expect(p.properties).toEqual([]); // every property was eventually sold
        expect(p.checks).toHaveLength(PLAYER_SETUP[n].cardsUsed / n);
      }
      // Every check card dealt across the game is accounted for exactly once.
      const allChecks = state.players.flatMap((p) => p.checks);
      expect(allChecks).toHaveLength(PLAYER_SETUP[n].cardsUsed);
    });
  }
});

// ---------------------------------------------------------------------------
// computeRankings
// ---------------------------------------------------------------------------

function gameOverState(overridePlayers: { seat: number; cash: number; checks: number[] }[]): ForSaleState {
  const base = startGame(overridePlayers.length, 1);
  return {
    ...base,
    phase: "gameOver",
    auction: null,
    sale: null,
    checkDeck: [],
    players: overridePlayers.map((p) => ({ seat: p.seat, cash: p.cash, properties: [], checks: p.checks })),
  };
}

describe("computeRankings — 룰북 §5 최종 점수 계산 및 동점자 처리", () => {
  it("ranks by total (checks + cash) descending", () => {
    const state = gameOverState([
      { seat: 0, cash: 1000, checks: [10000] }, // 11000
      { seat: 1, cash: 5000, checks: [2000] }, // 7000
      { seat: 2, cash: 500, checks: [500] }, // 1000
    ]);
    const rankings = computeRankings(state);
    expect(rankings.find((r) => r.seat === 0)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 1)!.rank).toBe(2);
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(3);
  });

  it("breaks a total tie by remaining cash (rulebook §5 tie-breaker)", () => {
    const state = gameOverState([
      { seat: 0, cash: 3000, checks: [7000] }, // total 10000, cash 3000
      { seat: 1, cash: 1000, checks: [9000] }, // total 10000, cash 1000
      { seat: 2, cash: 0, checks: [0] }, // clearly last, just padding player count to the supported minimum
    ]);
    const rankings = computeRankings(state);
    expect(rankings.find((r) => r.seat === 0)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 1)!.rank).toBe(2);
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(3);
  });

  it("declares a shared rank (co-winners) when both total and cash tie", () => {
    const state = gameOverState([
      { seat: 0, cash: 2000, checks: [8000] },
      { seat: 1, cash: 2000, checks: [8000] },
      { seat: 2, cash: 0, checks: [1000] },
    ]);
    const rankings = computeRankings(state);
    expect(rankings.find((r) => r.seat === 0)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 1)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(3); // standard competition ranking skips rank 2
  });
});
