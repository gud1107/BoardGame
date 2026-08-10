import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildDeck,
  computeRankings,
  cucumberCount,
  CARD_MAX,
  CARD_MIN,
  COPIES_PER_VALUE,
  DEFAULT_ELIMINATION_THRESHOLD,
  FINAL_TRICK_NUMBER,
  HAND_SIZE,
  legalCardIds,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  TRICKS_PER_ROUND,
  type Card,
  type FiveCucumbersState,
  type PlayerState,
} from "./engine";

function card(value: number, copy = 0): Card {
  return { id: `${value}-${copy}`, value };
}

function makePlayer(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { seat, hand: [], cucumbers: 0, eliminated: false, eliminatedAtRound: null, ...overrides };
}

function makeState(overrides: Partial<FiveCucumbersState> = {}): FiveCucumbersState {
  const players: PlayerState[] = [makePlayer(0), makePlayer(1), makePlayer(2)];
  return {
    playerCount: 3,
    eliminationThreshold: 5,
    players,
    roundNumber: 1,
    trickNumber: 1,
    trickPlays: [],
    leadSeat: 0,
    activeSeat: 0,
    phase: "playing",
    lastTrickResult: null,
    lastRoundSummary: null,
    initialSeed: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Setup — deck composition + dealing
// ---------------------------------------------------------------------------

describe("startGame — setup", () => {
  it("builds a 60-card deck: values 1-15, 4 copies each", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(60);
    expect(new Set(deck.map((c) => c.id)).size).toBe(60);
    for (let v = CARD_MIN; v <= CARD_MAX; v++) {
      expect(deck.filter((c) => c.value === v)).toHaveLength(COPIES_PER_VALUE);
    }
    expect(CARD_MIN).toBe(1);
    expect(CARD_MAX).toBe(15);
  });

  it("deals every active seat exactly 7 cards, all unique across the table", () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const state = startGame(count, 42);
      expect(state.players).toHaveLength(count);
      state.players.forEach((p) => expect(p.hand).toHaveLength(HAND_SIZE));
      const allIds = state.players.flatMap((p) => p.hand.map((c) => c.id));
      expect(new Set(allIds).size).toBe(count * HAND_SIZE);
    }
  });

  it("is deterministic for a given seed", () => {
    expect(startGame(4, 42)).toEqual(startGame(4, 42));
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(7, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(6);
  });

  it("starts round 1, trick 1, with 0 cucumbers for everyone and a valid leader among active seats", () => {
    const state = startGame(4, 7, 6);
    expect(state.roundNumber).toBe(1);
    expect(state.trickNumber).toBe(1);
    expect(state.trickPlays).toEqual([]);
    expect(state.phase).toBe("playing");
    expect(state.eliminationThreshold).toBe(6);
    expect(state.players.every((p) => p.cucumbers === 0 && !p.eliminated)).toBe(true);
    expect(state.activeSeat).toBe(state.leadSeat);
    expect(state.leadSeat).toBeGreaterThanOrEqual(0);
    expect(state.leadSeat).toBeLessThan(4);
  });

  it("defaults the elimination threshold to 5 when unspecified", () => {
    expect(DEFAULT_ELIMINATION_THRESHOLD).toBe(5);
    expect(startGame(3, 1).eliminationThreshold).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Trick submission legality — "current max or higher" vs "lowest in hand"
// ---------------------------------------------------------------------------

describe("legalCardIds — trick submission rules (rulebook §2-3)", () => {
  it("the trick leader (no cards played yet) may play any card in hand", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [card(3), card(9), card(15)] }), makePlayer(1), makePlayer(2)],
      trickPlays: [],
      activeSeat: 0,
    });
    expect(legalCardIds(state, 0)).toEqual(new Set(["3-0", "9-0", "15-0"]));
  });

  it("a follower may play any card >= the current trick max", () => {
    const state = makeState({
      players: [makePlayer(0), makePlayer(1, { hand: [card(4), card(8, 0), card(8, 1), card(12)] }), makePlayer(2)],
      trickPlays: [{ seat: 0, card: card(7) }],
      activeSeat: 1,
    });
    const legal = legalCardIds(state, 1);
    expect(legal.has("8-0")).toBe(true);
    expect(legal.has("8-1")).toBe(true);
    expect(legal.has("12-0")).toBe(true);
  });

  it("a follower may ALSO always play their hand's lowest card, even if it's below the current max and they hold higher options", () => {
    const state = makeState({
      players: [makePlayer(0), makePlayer(1, { hand: [card(2), card(10), card(11)] }), makePlayer(2)],
      trickPlays: [{ seat: 0, card: card(9) }],
      activeSeat: 1,
    });
    const legal = legalCardIds(state, 1);
    // 2 is the hand-low -> always legal, despite being far below the trick's 9.
    expect(legal.has("2-0")).toBe(true);
    // 10 and 11 both clear the >=9 bar.
    expect(legal.has("10-0")).toBe(true);
    expect(legal.has("11-0")).toBe(true);
  });

  it("rejects a card that is neither >= the current max nor the hand's lowest", () => {
    const state = makeState({
      players: [makePlayer(0), makePlayer(1, { hand: [card(2), card(6), card(11)] }), makePlayer(2)],
      trickPlays: [{ seat: 0, card: card(9) }],
      activeSeat: 1,
    });
    const legal = legalCardIds(state, 1);
    // 6 is neither the hand-low (2 is) nor >= the trick max (9) -> illegal.
    expect(legal.has("6-0")).toBe(false);
    expect(legal.has("2-0")).toBe(true); // hand-low
    expect(legal.has("11-0")).toBe(true); // clears the bar
  });

  it("if multiple copies tie for the hand's lowest value, every copy is legal", () => {
    const state = makeState({
      players: [makePlayer(0), makePlayer(1, { hand: [card(5, 0), card(5, 1), card(9)] }), makePlayer(2)],
      trickPlays: [{ seat: 0, card: card(8) }],
      activeSeat: 1,
    });
    const legal = legalCardIds(state, 1);
    expect(legal.has("5-0")).toBe(true);
    expect(legal.has("5-1")).toBe(true);
    expect(legal.has("9-0")).toBe(true); // clears the >=8 bar too
  });

  it("returns empty when it isn't the seat's turn, or the game isn't in the playing phase", () => {
    const state = makeState({ players: [makePlayer(0, { hand: [card(3)] }), makePlayer(1), makePlayer(2)], activeSeat: 1 });
    expect(legalCardIds(state, 0)).toEqual(new Set());
    expect(legalCardIds({ ...state, phase: "gameOver", activeSeat: 0 }, 0)).toEqual(new Set());
  });

  it("playCard rejects an illegal card and leaves state untouched", () => {
    const state = makeState({
      players: [makePlayer(0), makePlayer(1, { hand: [card(2), card(6), card(11)] }), makePlayer(2)],
      trickPlays: [{ seat: 0, card: card(9) }],
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "playCard", seat: 1, cardId: "6-0" });
    expect(next).toBe(state);
  });

  it("playCard rejects an out-of-turn play", () => {
    const state = makeState({ players: [makePlayer(0, { hand: [card(3)] }), makePlayer(1), makePlayer(2)], activeSeat: 1 });
    expect(applyAction(state, { type: "playCard", seat: 0, cardId: "3-0" })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 3. Tricks 1-6 — winner becomes next leader, no penalty
// ---------------------------------------------------------------------------

describe("tricks 1-6 — winner leads next trick, no cucumber penalty", () => {
  it("the highest card wins and becomes the next trick's leader/active seat", () => {
    const state = makeState({
      trickNumber: 3,
      players: [
        makePlayer(0, { hand: [card(4)] }),
        makePlayer(1, { hand: [card(9)] }),
        makePlayer(2, { hand: [card(6)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(4) }, { seat: 1, card: card(9) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "6-0" });
    expect(next.trickNumber).toBe(4);
    expect(next.leadSeat).toBe(1); // seat 1 played the 9, the highest
    expect(next.activeSeat).toBe(1);
    expect(next.trickPlays).toEqual([]);
    expect(next.lastTrickResult?.winnerSeats).toEqual([1]);
    expect(next.lastTrickResult?.cucumberPenaltyEach).toBe(0);
    expect(next.players.every((p) => p.cucumbers === 0)).toBe(true); // no penalty on trick < 7
  });

  it("on a tie for highest, whoever played it LATER wins (rulebook §2-4)", () => {
    const state = makeState({
      trickNumber: 2,
      players: [
        makePlayer(0, { hand: [card(12, 0)] }),
        makePlayer(1, { hand: [card(5)] }),
        makePlayer(2, { hand: [card(12, 1)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(12, 0) }, { seat: 1, card: card(5) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "12-1" });
    // Seats 0 and 2 tie at 12; seat 2 played later -> seat 2 wins.
    expect(next.lastTrickResult?.winnerSeats).toEqual([2]);
    expect(next.leadSeat).toBe(2);
  });

  it("captured cards leave both winner's and losers' hands permanently (never returned)", () => {
    const state = makeState({
      trickNumber: 1,
      players: [
        // Seats 0 and 1 already played their `card(2)`/`card(3)` earlier this
        // trick (see `trickPlays` below), so — matching real play order —
        // those cards are already gone from their hands; only seat 2 (about
        // to act) still holds its trick card (6, legal since it clears the
        // running max of 3) alongside its next one.
        makePlayer(0, { hand: [card(1)] }),
        makePlayer(1, { hand: [card(4)] }),
        makePlayer(2, { hand: [card(6), card(5)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(2) }, { seat: 1, card: card(3) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "6-0" });
    expect(next.players[0].hand.map((c) => c.id)).toEqual(["1-0"]);
    expect(next.players[1].hand.map((c) => c.id)).toEqual(["4-0"]);
    expect(next.players[2].hand.map((c) => c.id)).toEqual(["5-0"]);
    expect(next.lastTrickResult?.winnerSeats).toEqual([2]); // 6 is the highest played
  });
});

// ---------------------------------------------------------------------------
// 4. Trick 7 — cucumber settlement
// ---------------------------------------------------------------------------

describe("trick 7 — final-trick cucumber penalty settlement (rulebook §3)", () => {
  it("cucumberCount matches the rulebook's tiers exactly", () => {
    expect(cucumberCount(1)).toBe(0); // the ×2-bomb special, not a real tier
    for (let v = 2; v <= 5; v++) expect(cucumberCount(v)).toBe(1);
    for (let v = 6; v <= 9; v++) expect(cucumberCount(v)).toBe(2);
    for (let v = 10; v <= 11; v++) expect(cucumberCount(v)).toBe(3);
    for (let v = 12; v <= 14; v++) expect(cucumberCount(v)).toBe(4);
    expect(cucumberCount(15)).toBe(5);
  });

  it("the sole highest player on trick 7 eats cucumbers equal to that card's tier, no multiplier if no '1' was played", () => {
    const state = makeState({
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 6,
      players: [
        makePlayer(0, { hand: [card(14)] }),
        makePlayer(1, { hand: [card(3)] }),
        makePlayer(2, { hand: [card(7)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(14) }, { seat: 1, card: card(3) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "7-0" });
    expect(next.lastTrickResult?.winnerSeats).toEqual([0]);
    expect(next.lastTrickResult?.cucumberPenaltyEach).toBe(4); // 14 -> 4 cucumbers
    expect(next.players[0].cucumbers).toBe(4);
    expect(next.players[1].cucumbers).toBe(0);
    expect(next.players[2].cucumbers).toBe(0);
    // Game continues (nobody hit 6) -> a new round is already dealt.
    expect(next.phase).toBe("playing");
    expect(next.roundNumber).toBe(2);
    expect(next.trickNumber).toBe(1);
  });

  it("doubles per '1' card played in the final trick: 1x/2x/4x/8x for 0/1/2/3 ones (rulebook §3-2 worked example)", () => {
    // A(14) wins, B plays a 1 -> A's base 4 cucumbers doubles to 8 (the rulebook's own worked example).
    const state = makeState({
      trickNumber: FINAL_TRICK_NUMBER,
      playerCount: 4,
      players: [makePlayer(0, { hand: [card(14)] }), makePlayer(1, { hand: [card(1)] }), makePlayer(2, { hand: [card(5)] }), makePlayer(3, { hand: [card(8)] })],
      leadSeat: 0,
      activeSeat: 3,
      trickPlays: [{ seat: 0, card: card(14) }, { seat: 1, card: card(1) }, { seat: 2, card: card(5) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 3, cardId: "8-0" });
    expect(next.lastTrickResult?.winnerSeats).toEqual([0]);
    expect(next.lastTrickResult?.cucumberPenaltyEach).toBe(8); // 4 base * 2 (one '1' played)
    expect(next.players[0].cucumbers).toBe(8);
  });

  it("a tie for highest on trick 7 gives the cucumbers to whoever played it LATER only (rulebook §2-4 tie-break applies to trick 7 too, not a split-the-penalty rule)", () => {
    const state = makeState({
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 6,
      players: [
        makePlayer(0, { hand: [card(12, 0)] }),
        makePlayer(1, { hand: [card(3)] }),
        makePlayer(2, { hand: [card(12, 1)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(12, 0) }, { seat: 1, card: card(3) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "12-1" });
    // Seats 0 and 2 tie at 12; seat 2 played later -> seat 2 alone wins the
    // trick and alone eats the penalty. Seat 0, despite tying the top value,
    // takes none.
    expect(next.lastTrickResult?.winnerSeats).toEqual([2]);
    expect(next.lastTrickResult?.cucumberPenaltyEach).toBe(4); // 12 -> tier 4
    expect(next.players[2].cucumbers).toBe(4);
    expect(next.players[0].cucumbers).toBe(0);
    expect(next.players[1].cucumbers).toBe(0);
  });

  it("a tie for highest on trick 7 where the EARLIER play was higher-index-seat still resolves to whoever played later, regardless of seat number", () => {
    // Same tie value (15) but this time seat 0 (lower seat number) plays it
    // LAST -> seat 0 must win despite seat 2 having a "higher" seat-adjacent
    // intuition; confirms the tie-break keys off play order, not seat index.
    const state = makeState({
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 6,
      players: [
        makePlayer(0, { hand: [card(2)] }),
        makePlayer(1, { hand: [card(15, 0)] }),
        makePlayer(2, { hand: [card(15, 1)] }),
      ],
      leadSeat: 2,
      activeSeat: 0,
      trickPlays: [{ seat: 2, card: card(15, 1) }, { seat: 1, card: card(15, 0) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 0, cardId: "2-0" });
    // 15 vs 15 tie between seats 1 and 2; neither is the last play (seat 0's
    // trailing 2 isn't the tied top value) — seat 1's 15 came after seat 2's,
    // so seat 1 (the later of the TWO TIED plays) wins, not seat 0.
    expect(next.lastTrickResult?.winnerSeats).toEqual([1]);
    expect(next.lastTrickResult?.cucumberPenaltyEach).toBe(5);
    expect(next.players[1].cucumbers).toBe(5);
    expect(next.players[0].cucumbers).toBe(0);
    expect(next.players[2].cucumbers).toBe(0);
  });

  it("TRICKS_PER_ROUND / FINAL_TRICK_NUMBER are both 7", () => {
    expect(TRICKS_PER_ROUND).toBe(7);
    expect(FINAL_TRICK_NUMBER).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 5. House rule — elimination threshold (5 vs 6)
// ---------------------------------------------------------------------------

describe("elimination threshold house rule (task brief §1 / rulebook §4)", () => {
  it("eliminates a player once cucumbers reach the 5-cucumber threshold", () => {
    const state = makeState({
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 5,
      players: [
        makePlayer(0, { hand: [card(15)], cucumbers: 0 }),
        makePlayer(1, { hand: [card(2)] }),
        makePlayer(2, { hand: [card(3)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(15) }, { seat: 1, card: card(2) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "3-0" });
    expect(next.lastTrickResult?.cucumberPenaltyEach).toBe(5); // 15 -> tier 5, exactly at threshold
    const seat0 = next.players.find((p) => p.seat === 0)!;
    expect(seat0.cucumbers).toBe(5);
    expect(seat0.eliminated).toBe(true);
    expect(seat0.eliminatedAtRound).toBe(1);
  });

  it("the SAME cucumber total (5) does NOT eliminate under the 6-cucumber threshold", () => {
    const state = makeState({
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 6,
      players: [
        makePlayer(0, { hand: [card(15)], cucumbers: 0 }),
        makePlayer(1, { hand: [card(2)] }),
        makePlayer(2, { hand: [card(3)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(15) }, { seat: 1, card: card(2) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "3-0" });
    const seat0 = next.players.find((p) => p.seat === 0)!;
    expect(seat0.cucumbers).toBe(5);
    expect(seat0.eliminated).toBe(false);
    expect(seat0.eliminatedAtRound).toBeNull();
  });

  it("eliminated seats are skipped in turn order and dealt no cards in the next round", () => {
    const state = makeState({
      playerCount: 3,
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 5,
      initialSeed: 99,
      players: [
        makePlayer(0, { hand: [card(15)], cucumbers: 0 }),
        makePlayer(1, { hand: [card(2)] }),
        makePlayer(2, { hand: [card(3)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(15) }, { seat: 1, card: card(2) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "3-0" });
    expect(next.phase).toBe("playing"); // 2 active players remain -> game continues
    const seat0 = next.players.find((p) => p.seat === 0)!;
    expect(seat0.eliminated).toBe(true);
    expect(seat0.hand).toEqual([]);
    expect(next.players[1].hand).toHaveLength(HAND_SIZE);
    expect(next.players[2].hand).toHaveLength(HAND_SIZE);
    expect(next.activeSeat).not.toBe(0);
    expect(next.leadSeat).not.toBe(0);
  });

  it("ends the game once only one active player remains, without dealing another round", () => {
    const state = makeState({
      playerCount: 3,
      trickNumber: FINAL_TRICK_NUMBER,
      eliminationThreshold: 5,
      players: [
        makePlayer(0, { hand: [card(15)], cucumbers: 0 }),
        makePlayer(1, { hand: [card(2)], eliminated: true, eliminatedAtRound: 1 }),
        makePlayer(2, { hand: [card(3)] }),
      ],
      leadSeat: 0,
      activeSeat: 2,
      trickPlays: [{ seat: 0, card: card(15) }],
    });
    const next = applyAction(state, { type: "playCard", seat: 2, cardId: "3-0" });
    expect(next.phase).toBe("gameOver");
    const seat0 = next.players.find((p) => p.seat === 0)!;
    expect(seat0.eliminated).toBe(true);
    // Only seat 2 remains active -> sole survivor -> winner.
    const rankings = computeRankings(next);
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Final rankings — survival order
// ---------------------------------------------------------------------------

describe("computeRankings — survival order", () => {
  it("the never-eliminated survivor ranks 1st, earlier-eliminated seats rank worse", () => {
    const state = makeState({
      phase: "gameOver",
      players: [
        makePlayer(0, { eliminated: false, eliminatedAtRound: null }),
        makePlayer(1, { eliminated: true, eliminatedAtRound: 3 }),
        makePlayer(2, { eliminated: true, eliminatedAtRound: 5 }),
      ],
    });
    const rankings = computeRankings(state);
    expect(rankings.find((r) => r.seat === 0)!.rank).toBe(1); // never eliminated
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(2); // survived to round 5
    expect(rankings.find((r) => r.seat === 1)!.rank).toBe(3); // eliminated earliest
  });

  it("seats eliminated in the very same round share a rank (standard competition ranking)", () => {
    const state = makeState({
      phase: "gameOver",
      players: [
        makePlayer(0, { eliminated: true, eliminatedAtRound: 4 }),
        makePlayer(1, { eliminated: true, eliminatedAtRound: 4 }),
        makePlayer(2, { eliminated: false, eliminatedAtRound: null }),
      ],
    });
    const rankings = computeRankings(state);
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 0)!.rank).toBe(2);
    expect(rankings.find((r) => r.seat === 1)!.rank).toBe(2);
  });
});
