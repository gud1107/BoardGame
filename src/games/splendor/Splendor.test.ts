import { describe, expect, it } from "vitest";
import { createDevelopmentDeck, createNobles, type DevelopmentCard, type Noble } from "./cards";
import {
  applyAction,
  canAffordCard,
  chooseBotAction,
  computeAutoPayment,
  computeEffectiveCost,
  computePlayerScore,
  computeQualifyingNobles,
  computeRankings,
  getValidMoves,
  GOLD_SUPPLY,
  MARKET_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RESERVE_LIMIT,
  startGame,
  TOKEN_LIMIT,
  TOKEN_SUPPLY_BY_PLAYER_COUNT,
  WIN_SCORE,
  type PlayerState,
  type SeatIndex,
  type SplendorState,
} from "./engine";

function makePlayer(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { seat, tokens: {}, purchasedCards: [], reservedCards: [], nobles: [], ...overrides };
}

function makeState(overrides: Partial<SplendorState> = {}): SplendorState {
  const players: PlayerState[] = [makePlayer(0), makePlayer(1), makePlayer(2)];
  return {
    playerCount: 3,
    players,
    decks: { 1: [], 2: [], 3: [] },
    markets: {
      1: Array.from({ length: MARKET_SIZE }, () => null),
      2: Array.from({ length: MARKET_SIZE }, () => null),
      3: Array.from({ length: MARKET_SIZE }, () => null),
    },
    nobles: [],
    tokenSupply: { white: 5, blue: 5, green: 5, red: 5, black: 5, gold: 5 },
    activeSeat: 0,
    awaitingDiscardSeat: null,
    awaitingNobleSeat: null,
    endTriggered: false,
    phase: "playing",
    turnNumber: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Setup — differential starting token quantities per player count
// ---------------------------------------------------------------------------

describe("startGame — setup", () => {
  it("sets gem token supply per color by player count, gold always 5", () => {
    expect(TOKEN_SUPPLY_BY_PLAYER_COUNT).toEqual({ 2: 4, 3: 5, 4: 7 });
    for (const count of [2, 3, 4]) {
      const state = startGame(count, 1);
      for (const c of ["white", "blue", "green", "red", "black"] as const) {
        expect(state.tokenSupply[c]).toBe(TOKEN_SUPPLY_BY_PLAYER_COUNT[count]);
      }
      expect(state.tokenSupply.gold).toBe(GOLD_SUPPLY);
    }
  });

  it("deals [playerCount + 1] nobles and a 4-card market per tier", () => {
    for (const count of [2, 3, 4]) {
      const state = startGame(count, 1);
      expect(state.nobles).toHaveLength(count + 1);
      for (const tier of [1, 2, 3] as const) {
        expect(state.markets[tier]).toHaveLength(MARKET_SIZE);
        expect(state.markets[tier].every((c) => c !== null)).toBe(true);
      }
    }
  });

  it("deals every player 0 tokens, 0 cards, 0 nobles and seats them at 0..n-1", () => {
    const state = startGame(4, 1);
    expect(state.players).toHaveLength(4);
    state.players.forEach((p, i) => {
      expect(p.seat).toBe(i);
      expect(p.tokens).toEqual({});
      expect(p.purchasedCards).toEqual([]);
      expect(p.reservedCards).toEqual([]);
      expect(p.nobles).toEqual([]);
    });
    expect(state.activeSeat).toBe(0);
    expect(state.phase).toBe("playing");
  });

  it("is deterministic for a given seed", () => {
    expect(startGame(4, 42)).toEqual(startGame(4, 42));
  });

  it("deals the full 90-card development deck (40/30/20) and 10 nobles, no duplicates", () => {
    for (const seed of [1, 2, 3, 42, 1000]) {
      const state = startGame(4, seed);
      const allCards: DevelopmentCard[] = [];
      for (const tier of [1, 2, 3] as const) {
        allCards.push(...state.markets[tier].filter((c): c is DevelopmentCard => c !== null), ...state.decks[tier]);
      }
      expect(allCards.filter((c) => c.tier === 1)).toHaveLength(40);
      expect(allCards.filter((c) => c.tier === 2)).toHaveLength(30);
      expect(allCards.filter((c) => c.tier === 3)).toHaveLength(20);
      expect(new Set(allCards.map((c) => c.id)).size).toBe(90);

      const allNobles: Noble[] = [...state.nobles];
      // Only playerCount+1 of the 10 nobles are drawn; verify the full pool is exactly 10 unique tiles.
      expect(new Set(createNobles().map((n) => n.id)).size).toBe(10);
      expect(allNobles.length).toBe(5);
    }
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(5, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(4);
  });

  it("createDevelopmentDeck always produces exactly 90 uniquely-ided cards", () => {
    const deck = createDevelopmentDeck();
    expect(deck).toHaveLength(90);
    expect(new Set(deck.map((c) => c.id)).size).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// 2. Take-token actions
// ---------------------------------------------------------------------------

describe("takeThreeDifferent / takeTwoSame", () => {
  it("takes 3 distinct colors, one each, from the supply", () => {
    const state = makeState();
    const next = applyAction(state, { type: "takeThreeDifferent", seat: 0, colors: ["white", "blue", "green"] });
    expect(next.players[0].tokens).toEqual({ white: 1, blue: 1, green: 1 });
    expect(next.tokenSupply).toMatchObject({ white: 4, blue: 4, green: 4 });
    expect(next.activeSeat).toBe(1);
  });

  it("rejects taking 3 of the same color, or fewer/more than 3 colors", () => {
    const state = makeState();
    expect(applyAction(state, { type: "takeThreeDifferent", seat: 0, colors: ["white", "white", "blue"] })).toBe(state);
    expect(applyAction(state, { type: "takeThreeDifferent", seat: 0, colors: ["white", "blue"] })).toBe(state);
  });

  it("rejects taking a color the supply is out of", () => {
    const state = makeState({ tokenSupply: { white: 0, blue: 5, green: 5, red: 5, black: 5, gold: 5 } });
    expect(applyAction(state, { type: "takeThreeDifferent", seat: 0, colors: ["white", "blue", "green"] })).toBe(state);
  });

  it("takes 2 of the same color only when the supply has >= 4 of it", () => {
    const plenty = makeState({ tokenSupply: { white: 4, blue: 5, green: 5, red: 5, black: 5, gold: 5 } });
    const next = applyAction(plenty, { type: "takeTwoSame", seat: 0, color: "white" });
    expect(next.players[0].tokens).toEqual({ white: 2 });
    expect(next.tokenSupply.white).toBe(2);

    const scarce = makeState({ tokenSupply: { white: 3, blue: 5, green: 5, red: 5, black: 5, gold: 5 } });
    expect(applyAction(scarce, { type: "takeTwoSame", seat: 0, color: "white" })).toBe(scarce);
  });

  it("no-ops when it isn't the seat's turn", () => {
    const state = makeState({ activeSeat: 1 });
    expect(applyAction(state, { type: "takeThreeDifferent", seat: 0, colors: ["white", "blue", "green"] })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 3. Purchase — bonus discount + gold payment
// ---------------------------------------------------------------------------

const CARD_3WHITE: DevelopmentCard = { id: "c-3white", tier: 1, bonus: "blue", cost: { white: 3 }, points: 0 };
const CARD_2WHITE_2BLUE: DevelopmentCard = { id: "c-mix", tier: 2, bonus: "green", cost: { white: 2, blue: 2 }, points: 2 };

describe("purchaseCard — discount + gold", () => {
  it("computeEffectiveCost subtracts owned bonus-card counts per color, never below 0", () => {
    const owned = [
      { id: "b1", tier: 1, bonus: "white", cost: {}, points: 0 } as DevelopmentCard,
      { id: "b2", tier: 1, bonus: "white", cost: {}, points: 0 } as DevelopmentCard,
    ];
    expect(computeEffectiveCost(CARD_3WHITE, owned)).toEqual({ white: 1 });
    expect(computeEffectiveCost(CARD_3WHITE, [...owned, ...owned])).toEqual({});
  });

  it("computeAutoPayment spends matching-color tokens first, gold only for the shortfall", () => {
    const player = makePlayer(0, { tokens: { white: 1, gold: 5 } });
    const payment = computeAutoPayment(player, CARD_3WHITE);
    expect(payment).toEqual({ white: 1, gold: 2 });
  });

  it("canAffordCard is true iff gold can cover the shortfall after owned tokens", () => {
    expect(canAffordCard(makePlayer(0, { tokens: { white: 3 } }), CARD_3WHITE)).toBe(true);
    expect(canAffordCard(makePlayer(0, { tokens: { white: 2, gold: 1 } }), CARD_3WHITE)).toBe(true);
    expect(canAffordCard(makePlayer(0, { tokens: { white: 2, gold: 0 } }), CARD_3WHITE)).toBe(false);
  });

  it("purchasing from the market pays exact tokens, refills the slot, and grants the bonus", () => {
    const state = makeState({
      players: [makePlayer(0, { tokens: { white: 3 } }), makePlayer(1), makePlayer(2)],
      markets: {
        1: [CARD_3WHITE, null, null, null],
        2: Array.from({ length: MARKET_SIZE }, () => null),
        3: Array.from({ length: MARKET_SIZE }, () => null),
      },
      decks: { 1: [{ id: "next-1", tier: 1, bonus: "red", cost: {}, points: 0 }], 2: [], 3: [] },
    });
    const next = applyAction(state, { type: "purchaseCard", seat: 0, cardId: "c-3white", source: "market" });
    expect(next.players[0].tokens).toEqual({});
    expect(next.players[0].purchasedCards.map((c) => c.id)).toEqual(["c-3white"]);
    expect(next.tokenSupply.white).toBe(8); // 5 (default) + 3 refunded
    expect(next.markets[1][0]?.id).toBe("next-1"); // refilled from deck
  });

  it("purchasing from a reserved card removes it from the reserved pile, not the market", () => {
    const card = CARD_2WHITE_2BLUE;
    const state = makeState({
      players: [makePlayer(0, { tokens: { white: 2, blue: 2 }, reservedCards: [card] }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "purchaseCard", seat: 0, cardId: card.id, source: "reserved" });
    expect(next.players[0].reservedCards).toEqual([]);
    expect(next.players[0].purchasedCards.map((c) => c.id)).toEqual([card.id]);
  });

  it("no-ops an unaffordable purchase", () => {
    const state = makeState({
      players: [makePlayer(0, { tokens: { white: 1 } }), makePlayer(1), makePlayer(2)],
      markets: { 1: [CARD_3WHITE, null, null, null], 2: Array.from({ length: MARKET_SIZE }, () => null), 3: Array.from({ length: MARKET_SIZE }, () => null) },
    });
    expect(applyAction(state, { type: "purchaseCard", seat: 0, cardId: "c-3white", source: "market" })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 4. Token limit discard + reserve limit
// ---------------------------------------------------------------------------

describe("token limit (10) and reserve limit (3)", () => {
  it("gates the turn into 'discarding' when a take-tokens action pushes past 10", () => {
    const state = makeState({
      players: [makePlayer(0, { tokens: { white: 4, blue: 4, green: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "takeThreeDifferent", seat: 0, colors: ["red", "black", "green"] });
    expect(next.phase).toBe("discarding");
    expect(next.awaitingDiscardSeat).toBe(0);
    expect(next.activeSeat).toBe(0); // turn hasn't advanced yet
  });

  it("discardTokens only advances the turn once holdings land exactly on the 10-token cap", () => {
    const discarding = makeState({
      phase: "discarding",
      awaitingDiscardSeat: 0,
      players: [makePlayer(0, { tokens: { white: 4, blue: 4, green: 3 } }), makePlayer(1), makePlayer(2)],
    });
    // 4+4+3=11 held; discarding exactly 1 lands at 10 -> the turn should advance.
    const exact = applyAction(discarding, { type: "discardTokens", seat: 0, discard: { white: 1 } });
    expect(exact.phase).toBe("playing");
    expect(exact.activeSeat).toBe(1);

    const over = applyAction(discarding, { type: "discardTokens", seat: 0, discard: { white: 4 } });
    expect(over.phase).toBe("discarding"); // over-discarding below 10 is rejected
  });

  it("rejects discarding tokens the player doesn't hold", () => {
    const discarding = makeState({ phase: "discarding", awaitingDiscardSeat: 0, players: [makePlayer(0, { tokens: { white: 1 } }), makePlayer(1), makePlayer(2)] });
    expect(applyAction(discarding, { type: "discardTokens", seat: 0, discard: { white: 2 } })).toBe(discarding);
  });

  it("reserveCard is refused once a player already holds 3 reserved cards", () => {
    const full = [
      { id: "r1", tier: 1, bonus: "white", cost: {}, points: 0 } as DevelopmentCard,
      { id: "r2", tier: 1, bonus: "white", cost: {}, points: 0 } as DevelopmentCard,
      { id: "r3", tier: 1, bonus: "white", cost: {}, points: 0 } as DevelopmentCard,
    ];
    const state = makeState({
      players: [makePlayer(0, { reservedCards: full }), makePlayer(1), makePlayer(2)],
      markets: { 1: [CARD_3WHITE, null, null, null], 2: Array.from({ length: MARKET_SIZE }, () => null), 3: Array.from({ length: MARKET_SIZE }, () => null) },
    });
    expect(RESERVE_LIMIT).toBe(3);
    expect(applyAction(state, { type: "reserveCard", seat: 0, tier: 1, marketIndex: 0 })).toBe(state);
  });

  it("reserving grants a gold token only while the gold supply lasts", () => {
    const state = makeState({
      tokenSupply: { white: 5, blue: 5, green: 5, red: 5, black: 5, gold: 1 },
      markets: { 1: [CARD_3WHITE, null, null, null], 2: Array.from({ length: MARKET_SIZE }, () => null), 3: Array.from({ length: MARKET_SIZE }, () => null) },
    });
    const next = applyAction(state, { type: "reserveCard", seat: 0, tier: 1, marketIndex: 0 });
    expect(next.players[0].tokens.gold).toBe(1);
    expect(next.tokenSupply.gold ?? 0).toBe(0); // sparse bundle: 0 is represented as an absent key

    const dry = { ...state, tokenSupply: { ...state.tokenSupply, gold: 0 } };
    const next2 = applyAction(dry, { type: "reserveCard", seat: 0, tier: 1, marketIndex: 0 });
    expect(next2.players[0].tokens.gold ?? 0).toBe(0);
    expect(next2.players[0].reservedCards).toHaveLength(1); // reserve still succeeds without gold
  });

  it("blind-reserving off the deck top does not touch the visible market", () => {
    const state = makeState({ decks: { 1: [CARD_3WHITE], 2: [], 3: [] } });
    const next = applyAction(state, { type: "reserveCard", seat: 0, tier: 1 });
    expect(next.players[0].reservedCards.map((c) => c.id)).toEqual(["c-3white"]);
    expect(next.decks[1]).toEqual([]);
    expect(next.markets[1]).toEqual(state.markets[1]);
  });
});

// ---------------------------------------------------------------------------
// 5. Nobles + win-at-15 round completion
// ---------------------------------------------------------------------------

const NOBLE_3WHITE_3BLUE: Noble = { id: "n1", cost: { white: 3, blue: 3 }, points: 3 };
const NOBLE_3GREEN: Noble = { id: "n2", cost: { green: 3 }, points: 3 };

function cardWithBonus(id: string, bonus: DevelopmentCard["bonus"]): DevelopmentCard {
  return { id, tier: 1, bonus, cost: {}, points: 0 };
}

describe("noble visits", () => {
  it("computeQualifyingNobles only counts purchased-card bonuses, never held tokens", () => {
    const player = makePlayer(0, { tokens: { white: 10, blue: 10 } });
    const state = makeState({ nobles: [NOBLE_3WHITE_3BLUE], players: [player, makePlayer(1), makePlayer(2)] });
    expect(computeQualifyingNobles(state, 0)).toEqual([]);
  });

  it("auto-assigns the sole qualifying noble at end of turn, no token cost", () => {
    const purchased = [cardWithBonus("w1", "white"), cardWithBonus("w2", "white"), cardWithBonus("w3", "white"), cardWithBonus("b1", "blue"), cardWithBonus("b2", "blue"), cardWithBonus("b3", "blue")];
    const state = makeState({
      nobles: [NOBLE_3WHITE_3BLUE],
      players: [makePlayer(0, { tokens: { green: 1 }, purchasedCards: purchased }), makePlayer(1), makePlayer(2)],
    });
    // Trigger the end-of-turn check via a harmless take-tokens action.
    const next = applyAction(state, { type: "takeTwoSame", seat: 0, color: "green" });
    // green supply is 5 (default) >= 4, so the take succeeds and end-of-turn fires.
    expect(next.players[0].nobles.map((n) => n.id)).toEqual(["n1"]);
    expect(next.nobles).toEqual([]);
    expect(next.players[0].tokens.green).toBe(3); // unchanged by the noble (token cost is 0)
  });

  it("gates into 'choosingNoble' when more than one noble qualifies at once", () => {
    const purchased = [cardWithBonus("w1", "white"), cardWithBonus("w2", "white"), cardWithBonus("w3", "white"), cardWithBonus("g1", "green"), cardWithBonus("g2", "green"), cardWithBonus("g3", "green")];
    const state = makeState({
      tokenSupply: { white: 4, blue: 5, green: 5, red: 5, black: 5, gold: 5 },
      nobles: [{ id: "nw", cost: { white: 3 }, points: 3 }, NOBLE_3GREEN],
      players: [makePlayer(0, { purchasedCards: purchased }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "takeTwoSame", seat: 0, color: "white" });
    expect(next.phase).toBe("choosingNoble");
    expect(next.awaitingNobleSeat).toBe(0);

    const chosen = applyAction(next, { type: "chooseNoble", seat: 0, nobleId: "nw" });
    expect(chosen.players[0].nobles.map((n) => n.id)).toEqual(["nw"]);
    expect(chosen.nobles.map((n) => n.id)).toEqual([NOBLE_3GREEN.id]); // the unchosen noble stays on the board
    expect(chosen.phase).toBe("playing");
    expect(chosen.activeSeat).toBe(1);
  });

  it("rejects choosing a noble that isn't actually qualifying", () => {
    const state = makeState({ phase: "choosingNoble", awaitingNobleSeat: 0, nobles: [NOBLE_3WHITE_3BLUE, NOBLE_3GREEN] });
    expect(applyAction(state, { type: "chooseNoble", seat: 0, nobleId: NOBLE_3GREEN.id })).toBe(state);
  });
});

describe("win at 15 points + final round", () => {
  it("sets endTriggered once a player's own turn ends with score >= 15, but keeps play going", () => {
    const bigCard: DevelopmentCard = { id: "big", tier: 3, bonus: "white", cost: {}, points: 15 };
    const state = makeState({
      players: [makePlayer(0, { tokens: {}, purchasedCards: [bigCard] }), makePlayer(1), makePlayer(2)],
    });
    expect(computePlayerScore(state.players[0])).toBe(15);
    const next = applyAction(state, { type: "takeTwoSame", seat: 0, color: "white" });
    expect(next.endTriggered).toBe(true);
    expect(next.phase).toBe("playing"); // not seat playerCount-1 yet, game continues
    expect(next.activeSeat).toBe(1);
  });

  it("ends the game once the seat right before the starter finishes their turn after endTriggered", () => {
    const state = makeState({ playerCount: 3, endTriggered: true, activeSeat: 2 });
    const next = applyAction(state, { type: "takeThreeDifferent", seat: 2, colors: ["white", "blue", "green"] });
    expect(next.phase).toBe("gameOver");
  });

  it("computeRankings ranks by score desc, then fewer purchased cards, with true ties sharing a rank", () => {
    const a = makePlayer(0, { purchasedCards: [{ id: "a1", tier: 1, bonus: "white", cost: {}, points: 10 }] });
    const b = makePlayer(1, {
      purchasedCards: [
        { id: "b1", tier: 1, bonus: "white", cost: {}, points: 5 },
        { id: "b2", tier: 1, bonus: "white", cost: {}, points: 5 },
      ],
    });
    const c = makePlayer(2, { purchasedCards: [{ id: "c1", tier: 1, bonus: "white", cost: {}, points: 10 }] });
    const state = makeState({ phase: "gameOver", players: [a, b, c] });
    const rankings = computeRankings(state);
    // a and c tie on score(10) and cardCount(1) -> co-victory (both rank 1); b (score 10, but 2 cards) ranks after.
    expect(rankings.find((r) => r.seat === 0)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 2)!.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 1)!.rank).toBe(3);
  });

  it("TOKEN_LIMIT and WIN_SCORE match the rulebook", () => {
    expect(TOKEN_LIMIT).toBe(10);
    expect(WIN_SCORE).toBe(15);
  });
});

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("during 'playing', offers every affordable token-take and nothing for the idle seat", () => {
    const state = makeState(); // 5 of each gem + gold, empty markets/decks -> no reserve/purchase moves possible
    const moves = getValidMoves(state, 0);
    expect(moves.filter((m) => m.type === "takeThreeDifferent")).toHaveLength(10); // C(5,3)
    expect(moves.filter((m) => m.type === "takeTwoSame")).toHaveLength(5); // every color has >=4 in supply
    expect(moves.filter((m) => m.type === "reserveCard" || m.type === "purchaseCard")).toHaveLength(0);
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("offers a market reserve only for a visible card, and a purchase once affordable", () => {
    const card: DevelopmentCard = { id: "card-1", tier: 1, bonus: "white", cost: { white: 3 }, points: 1 };
    const state = makeState({
      markets: {
        1: [card, null, null, null],
        2: Array.from({ length: MARKET_SIZE }, () => null),
        3: Array.from({ length: MARKET_SIZE }, () => null),
      },
    });
    const noTokenMoves = getValidMoves(state, 0);
    expect(noTokenMoves).toContainEqual({ type: "reserveCard", seat: 0, tier: 1, marketIndex: 0 });
    expect(noTokenMoves.some((m) => m.type === "purchaseCard")).toBe(false); // can't afford yet

    const funded = makeState({
      players: [makePlayer(0, { tokens: { white: 3 } }), makePlayer(1), makePlayer(2)],
      markets: state.markets,
    });
    const fundedMoves = getValidMoves(funded, 0);
    expect(fundedMoves).toContainEqual({ type: "purchaseCard", seat: 0, cardId: "card-1", source: "market" });
  });

  it("during 'discarding', enumerates every way to shed exactly the overage", () => {
    const state = makeState({
      phase: "discarding",
      awaitingDiscardSeat: 0,
      players: [makePlayer(0, { tokens: { white: 6, blue: 5 } }), makePlayer(1), makePlayer(2)], // 11 tokens, 1 over
    });
    const moves = getValidMoves(state, 0);
    expect(moves).toHaveLength(2); // discard 1 white OR discard 1 blue
    expect(moves).toContainEqual({ type: "discardTokens", seat: 0, discard: { white: 1 } });
    expect(moves).toContainEqual({ type: "discardTokens", seat: 0, discard: { blue: 1 } });
    expect(getValidMoves(state, 1)).toEqual([]); // not the awaiting seat
  });

  it("during 'choosingNoble', offers only the seat's own qualifying nobles", () => {
    const noble: Noble = { id: "noble-1", cost: { white: 3 }, points: 3 };
    const otherNoble: Noble = { id: "noble-2", cost: { black: 3 }, points: 3 };
    const state = makeState({
      phase: "choosingNoble",
      awaitingNobleSeat: 0,
      nobles: [noble, otherNoble],
      players: [
        makePlayer(0, { purchasedCards: [{ id: "c1", tier: 1, bonus: "white", cost: {}, points: 0 }, { id: "c2", tier: 1, bonus: "white", cost: {}, points: 0 }, { id: "c3", tier: 1, bonus: "white", cost: {}, points: 0 }] }),
        makePlayer(1),
        makePlayer(2),
      ],
    });
    const moves = getValidMoves(state, 0);
    expect(moves).toEqual([{ type: "chooseNoble", seat: 0, nobleId: "noble-1" }]);
  });

  it("falls back to a single 'pass' move — and only that — when no A/B/C/D action is legal", () => {
    // Discovered via the Level 1–10 full-simulation stress test (bots can
    // legitimately drain the token supply and fill their reserve pile to
    // the point where nothing is left to do): token supply too depleted for
    // any take, reserve pile full, and nothing on the market is affordable.
    const card: DevelopmentCard = { id: "card-1", tier: 1, bonus: "white", cost: { white: 99 }, points: 1 };
    const state = makeState({
      tokenSupply: { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 },
      markets: {
        1: [card, null, null, null],
        2: Array.from({ length: MARKET_SIZE }, () => null),
        3: Array.from({ length: MARKET_SIZE }, () => null),
      },
      players: [
        makePlayer(0, { reservedCards: Array.from({ length: RESERVE_LIMIT }, () => card) }),
        makePlayer(1),
        makePlayer(2),
      ],
    });
    expect(getValidMoves(state, 0)).toEqual([{ type: "pass", seat: 0 }]);

    const next = applyAction(state, { type: "pass", seat: 0 });
    expect(next.activeSeat).toBe(1); // turn advances exactly like any other action
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat with nothing to decide", () => {
    const state = makeState();
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("prefers buying an affordable high-point card over merely taking tokens", () => {
    const card: DevelopmentCard = { id: "card-1", tier: 3, bonus: "white", cost: { blue: 2 }, points: 5 };
    const state = makeState({
      markets: {
        1: Array.from({ length: MARKET_SIZE }, () => null),
        2: Array.from({ length: MARKET_SIZE }, () => null),
        3: [card, null, null, null],
      },
      players: [makePlayer(0, { tokens: { blue: 2 } }), makePlayer(1), makePlayer(2)],
    });
    // rng forced high enough to stay outside Level 5's ~12% mistake chance,
    // so this exercises the actual scored decision rather than the noise curve.
    const action = chooseBotAction(state, 0, 5, () => 0.99);
    expect(action).toEqual({ type: "purchaseCard", seat: 0, cardId: "card-1", source: "market" });
  });

  it("always returns a legal move across every level", () => {
    const card: DevelopmentCard = { id: "card-1", tier: 3, bonus: "white", cost: { blue: 2 }, points: 5 };
    const state = makeState({
      markets: {
        1: Array.from({ length: MARKET_SIZE }, () => null),
        2: Array.from({ length: MARKET_SIZE }, () => null),
        3: [card, null, null, null],
      },
      players: [makePlayer(0, { tokens: { blue: 2 } }), makePlayer(1), makePlayer(2)],
    });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) can pick a far worse move than Level 10's argmax", () => {
    const card: DevelopmentCard = { id: "card-1", tier: 3, bonus: "white", cost: { blue: 2 }, points: 5 };
    const state = makeState({
      markets: {
        1: Array.from({ length: MARKET_SIZE }, () => null),
        2: Array.from({ length: MARKET_SIZE }, () => null),
        3: [card, null, null, null],
      },
      players: [makePlayer(0, { tokens: { blue: 2 } }), makePlayer(1), makePlayer(2)],
    });

    // rng() always 0 -> always below Level 1's ~55% mistake chance -> always
    // takes candidates[Math.floor(0 * length)] === the first enumerated move
    // (a "takeThreeDifferent"), not the clearly-correct purchase.
    const level1Action = chooseBotAction(state, 0, 1, () => 0);
    expect(level1Action?.type).not.toBe("purchaseCard");

    // Level 10 has a 0% mistake chance and 0 tie margin -> always the true
    // argmax regardless of rng: buy the affordable 5-point card.
    const level10Action = chooseBotAction(state, 0, 10, () => 0);
    expect(level10Action).toEqual({ type: "purchaseCard", seat: 0, cardId: "card-1", source: "market" });
    expect(level1Action).not.toEqual(level10Action);
  });
});

function playFullBotGame(playerCount: number, seed: number, levelOf: (seat: SeatIndex) => number): SplendorState {
  let state = startGame(playerCount, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 3000) {
    guard++;
    const actor =
      state.phase === "discarding"
        ? state.awaitingDiscardSeat!
        : state.phase === "choosingNoble"
          ? state.awaitingNobleSeat!
          : state.activeSeat;
    const action = chooseBotAction(state, actor, levelOf(actor));
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 1–10 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const level of [1, 4, 7, 10]) {
    it(`completes an all-Level-${level} game with a fully resolved final score`, () => {
      const state = playFullBotGame(3, 1000 + level, () => level);
      expect(state.phase).toBe("gameOver");
      const rankings = computeRankings(state);
      expect(rankings).toHaveLength(3);
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(4, 4242, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(computeRankings(state)).toHaveLength(4);
  });
});
