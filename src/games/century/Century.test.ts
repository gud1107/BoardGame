import { describe, expect, it } from "vitest";
import { basicProductionCard, basicUpgradeCard, type MerchantCard, type PointCard } from "./cards";
import {
  applyAction,
  canAcquireMerchant,
  canClaimPoint,
  computePlayerScore,
  computeRankings,
  MAX_PLAYERS,
  maxTradeRepeats,
  MIN_PLAYERS,
  MERCHANT_MARKET_SIZE,
  POINT_MARKET_SIZE,
  startGame,
  type CenturyState,
  type PlayerState,
} from "./engine";

function makePlayer(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    seat,
    hand: [basicProductionCard(seat), basicUpgradeCard(seat)],
    playedCards: [],
    resources: {},
    pointCards: [],
    gold: 0,
    silver: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<CenturyState> = {}): CenturyState {
  const players: PlayerState[] = [makePlayer(0), makePlayer(1), makePlayer(2)];
  return {
    playerCount: 3,
    players,
    merchantDeck: [],
    merchantMarket: Array.from({ length: MERCHANT_MARKET_SIZE }, () => null),
    merchantMarketResources: Array.from({ length: MERCHANT_MARKET_SIZE }, () => ({})),
    pointDeck: [],
    pointMarket: Array.from({ length: POINT_MARKET_SIZE }, () => null),
    goldSupply: 6,
    silverSupply: 6,
    activeSeat: 0,
    awaitingDiscardSeat: null,
    endTriggered: false,
    phase: "playing",
    turnNumber: 1,
    pointCardGoal: 6,
    ...overrides,
  };
}

const PRODUCTION_CARD: MerchantCard = { id: "prod-3-yellow", effect: { kind: "production", gain: { yellow: 3 } } };
const UPGRADE_CARD: MerchantCard = { id: "upg-2", effect: { kind: "upgrade", upgrades: 2 } };
const TRADE_CARD: MerchantCard = { id: "trade-2y-1r", effect: { kind: "trade", cost: { yellow: 2 }, gain: { red: 1 } } };
const POINT_CARD: PointCard = { id: "pt-1", cost: { yellow: 2, red: 1 }, points: 9 };

describe("startGame — setup", () => {
  it("deals the two basic cards and rulebook starting resources per seat", () => {
    const state = startGame(4, 1);
    expect(state.players).toHaveLength(4);
    expect(state.players[0].resources).toEqual({ yellow: 3 });
    expect(state.players[1].resources).toEqual({ yellow: 4 });
    expect(state.players[2].resources).toEqual({ yellow: 4 });
    expect(state.players[3].resources).toEqual({ yellow: 3, red: 1 });
    for (const p of state.players) {
      expect(p.hand.map((c) => c.effect.kind).sort()).toEqual(["production", "upgrade"]);
      expect(p.pointCards).toEqual([]);
      expect(p.gold).toBe(0);
      expect(p.silver).toBe(0);
    }
    expect(state.merchantMarket).toHaveLength(MERCHANT_MARKET_SIZE);
    expect(state.merchantMarket.every((c) => c !== null)).toBe(true);
    expect(state.pointMarket).toHaveLength(POINT_MARKET_SIZE);
    expect(state.pointMarket.every((c) => c !== null)).toBe(true);
    expect(state.goldSupply).toBe(8);
    expect(state.silverSupply).toBe(8);
    expect(state.phase).toBe("playing");
    expect(state.activeSeat).toBe(0);
  });

  it("sets the point-card goal to 6 for 2-3 players and 5 for 4-5 players", () => {
    expect(startGame(2, 1).pointCardGoal).toBe(6);
    expect(startGame(3, 1).pointCardGoal).toBe(6);
    expect(startGame(4, 1).pointCardGoal).toBe(5);
    expect(startGame(5, 1).pointCardGoal).toBe(5);
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(4, 42);
    const b = startGame(4, 42);
    expect(a).toEqual(b);
  });

  it("deals the full 32-card merchant deck and 36-card point deck from Century.md (starting cards excluded)", () => {
    // createMerchantDeck()/createPointDeck() are transcribed 1:1 from
    // Century.md's card-list appendix (see cards.ts's doc comment) — every
    // card should show up somewhere across the market + draw pile, and the
    // basic starting cards (which are dealt straight into hands, never into
    // these decks) shouldn't appear a second time here.
    for (const seed of [1, 2, 3, 42, 1000]) {
      const state = startGame(5, seed);
      const allMerchantCards = [...state.merchantMarket.filter((c): c is MerchantCard => c !== null), ...state.merchantDeck];
      const allPointCards = [...state.pointMarket.filter((c): c is PointCard => c !== null), ...state.pointDeck];
      expect(allMerchantCards).toHaveLength(32);
      expect(allPointCards).toHaveLength(36);
      expect(new Set(allMerchantCards.map((c) => c.id)).size).toBe(32);
      expect(new Set(allPointCards.map((c) => c.id)).size).toBe(36);
      // The rulebook explicitly calls out one *extra* {upgrade, upgrades:2}
      // card in the 32-card deck, in addition to every seat's own starting
      // upgrade card — confirm it's really there (a former session's "fix"
      // used to strip this out before the authoritative card list settled
      // that the overlap is intentional, see cards.ts's doc comment).
      const upgradeTwoCards = allMerchantCards.filter((c) => c.effect.kind === "upgrade" && c.effect.upgrades === 2);
      expect(upgradeTwoCards).toHaveLength(1);
    }
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(6, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(5);
  });
});

describe("playing a production card", () => {
  it("moves the card to playedCards and adds its resources", () => {
    const state = makeState({ players: [makePlayer(0, { hand: [PRODUCTION_CARD], resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)] });
    const next = applyAction(state, { type: "playProduction", seat: 0, cardId: PRODUCTION_CARD.id });
    const me = next.players[0];
    expect(me.resources).toEqual({ yellow: 4 });
    expect(me.hand).toEqual([]);
    expect(me.playedCards).toEqual([PRODUCTION_CARD]);
    expect(next.activeSeat).toBe(1); // turn advances since resources stay within HAND_LIMIT
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 1, players: [makePlayer(0, { hand: [PRODUCTION_CARD] }), makePlayer(1), makePlayer(2)] });
    const next = applyAction(state, { type: "playProduction", seat: 0, cardId: PRODUCTION_CARD.id });
    expect(next).toEqual(state);
  });

  it("is a no-op for a card not in hand", () => {
    const state = makeState();
    const next = applyAction(state, { type: "playProduction", seat: 0, cardId: "does-not-exist" });
    expect(next).toEqual(state);
  });
});

describe("playing an upgrade card — 단계별 업그레이드 제한", () => {
  it("upgrades a single resource one tier per step", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { yellow: 2 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["yellow"] });
    expect(next.players[0].resources).toEqual({ yellow: 1, red: 1 });
  });

  it("chains a single cube through multiple tiers (노란색 -> 빨간색 -> 초록색)", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["yellow", "red"] });
    expect(next.players[0].resources).toEqual({ green: 1 });
  });

  it("spreads upgrades across two different cubes", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { yellow: 2 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["yellow", "yellow"] });
    expect(next.players[0].resources).toEqual({ red: 2 });
  });

  it("rejects using more upgrade steps than the card allows", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { yellow: 3 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["yellow", "yellow", "yellow"] });
    expect(next).toEqual(state);
  });

  it("rejects upgrading a resource the player doesn't have", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["red"] });
    expect(next).toEqual(state);
  });

  it("rejects upgrading brown (already the top tier)", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { brown: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["brown"] });
    expect(next).toEqual(state);
  });

  it("allows using fewer upgrade steps than the card's maximum", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [UPGRADE_CARD], resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playUpgrade", seat: 0, cardId: UPGRADE_CARD.id, upgrades: ["yellow"] });
    expect(next.players[0].resources).toEqual({ red: 1 });
  });
});

describe("playing a trade card — 자원 변환 (repeatable)", () => {
  it("applies the trade ratio once", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [TRADE_CARD], resources: { yellow: 2 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playTrade", seat: 0, cardId: TRADE_CARD.id, repeats: 1 });
    expect(next.players[0].resources).toEqual({ red: 1 });
  });

  it("repeats the trade any number of times in one play (rulebook's worked example)", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [TRADE_CARD], resources: { yellow: 6 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playTrade", seat: 0, cardId: TRADE_CARD.id, repeats: 3 });
    expect(next.players[0].resources).toEqual({ red: 3 });
  });

  it("rejects a trade the player can't fully afford", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [TRADE_CARD], resources: { yellow: 3 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playTrade", seat: 0, cardId: TRADE_CARD.id, repeats: 2 });
    expect(next).toEqual(state);
  });

  it("maxTradeRepeats clamps to what the player can currently afford", () => {
    const player = makePlayer(0, { resources: { yellow: 5 } });
    expect(maxTradeRepeats(player, { yellow: 2 })).toBe(2);
    expect(maxTradeRepeats(makePlayer(0, { resources: {} }), { yellow: 2 })).toBe(0);
  });
});

describe("acquireMerchant — N번째 카드 가져올 때 자원 배치 및 회수", () => {
  const market: MerchantCard[] = Array.from({ length: MERCHANT_MARKET_SIZE }, (_, i) => ({
    id: `m${i}`,
    effect: { kind: "production", gain: { yellow: 1 } },
  }));

  it("slot 0 is free — no payment required", () => {
    const state = makeState({ merchantMarket: [...market], merchantDeck: [] });
    const next = applyAction(state, { type: "acquireMerchant", seat: 0, index: 0, payment: [] });
    expect(next.players[0].hand.map((c) => c.id)).toContain("m0");
    expect(next.activeSeat).toBe(1);
  });

  it("rejects a mismatched payment length", () => {
    const state = makeState({
      merchantMarket: [...market],
      players: [makePlayer(0, { resources: { yellow: 3 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "acquireMerchant", seat: 0, index: 2, payment: ["yellow"] });
    expect(next).toEqual(state);
  });

  it("places 1 resource on each preceding slot and consumes them from the player", () => {
    const state = makeState({
      merchantMarket: [...market],
      players: [makePlayer(0, { resources: { yellow: 2, red: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "acquireMerchant", seat: 0, index: 2, payment: ["yellow", "red"] });
    expect(next.players[0].hand.map((c) => c.id)).toContain("m2");
    // spent 1 yellow + 1 red staking slots 0/1, gained nothing extra (fresh cards had no resources on them yet)
    expect(next.players[0].resources).toEqual({ yellow: 1 });
    expect(next.merchantMarketResources[0]).toEqual({ yellow: 1 });
    expect(next.merchantMarketResources[1]).toEqual({ red: 1 });
  });

  it("collects resources previously staked onto the acquired card by ANY player", () => {
    // Simulate: someone already staked 1 green onto slot 1 while reaching for slot 2 earlier.
    const marketResources = Array.from({ length: MERCHANT_MARKET_SIZE }, () => ({}) as Record<string, number>);
    marketResources[1] = { green: 1 };
    const state = makeState({
      merchantMarket: [...market],
      merchantMarketResources: marketResources,
      players: [makePlayer(0, { resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "acquireMerchant", seat: 0, index: 1, payment: ["yellow"] });
    // Took slot 1's card + the green sitting on it, while placing this turn's own yellow onto slot 0.
    expect(next.players[0].resources).toEqual({ green: 1 });
    expect(next.merchantMarketResources[0]).toEqual({ yellow: 1 });
  });

  it("rejects acquiring without enough resources to pay for the preceding slots", () => {
    const state = makeState({
      merchantMarket: [...market],
      players: [makePlayer(0, { resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "acquireMerchant", seat: 0, index: 2, payment: ["yellow", "yellow"] });
    expect(next).toEqual(state);
  });

  it("refills the rightmost slot from the deck after shifting cards left", () => {
    const refill: MerchantCard = { id: "refill", effect: { kind: "production", gain: { brown: 1 } } };
    const state = makeState({ merchantMarket: [...market], merchantDeck: [refill] });
    const next = applyAction(state, { type: "acquireMerchant", seat: 0, index: 0, payment: [] });
    expect(next.merchantMarket).toHaveLength(MERCHANT_MARKET_SIZE);
    expect(next.merchantMarket[MERCHANT_MARKET_SIZE - 1]).toEqual(refill);
    expect(next.merchantDeck).toEqual([]);
  });

  it("canAcquireMerchant reflects whether the player holds enough total resources", () => {
    expect(canAcquireMerchant(makePlayer(0, { resources: { yellow: 2 } }), 2)).toBe(true);
    expect(canAcquireMerchant(makePlayer(0, { resources: { yellow: 1 } }), 2)).toBe(false);
  });
});

describe("rest — recovers all played cards", () => {
  it("moves every playedCard back into hand and clears the discard row", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [PRODUCTION_CARD], playedCards: [UPGRADE_CARD, TRADE_CARD] }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "rest", seat: 0 });
    expect(next.players[0].hand.map((c) => c.id).sort()).toEqual([PRODUCTION_CARD.id, TRADE_CARD.id, UPGRADE_CARD.id].sort());
    expect(next.players[0].playedCards).toEqual([]);
    expect(next.activeSeat).toBe(1);
  });
});

describe("claimPoint — 금화/은화 지급 및 종료 조건", () => {
  it("claiming slot 0 grants a gold coin from supply", () => {
    const state = makeState({
      pointMarket: [POINT_CARD, null, null, null, null],
      players: [makePlayer(0, { resources: { yellow: 2, red: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 0, index: 0 });
    expect(next.players[0].gold).toBe(1);
    expect(next.players[0].pointCards).toEqual([POINT_CARD]);
    expect(next.players[0].resources).toEqual({});
    expect(next.goldSupply).toBe(5);
  });

  it("claiming slot 1 grants a silver coin from supply", () => {
    const state = makeState({
      pointMarket: [null, POINT_CARD, null, null, null],
      players: [makePlayer(0, { resources: { yellow: 2, red: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 0, index: 1 });
    expect(next.players[0].silver).toBe(1);
    expect(next.silverSupply).toBe(5);
  });

  it("claiming slots beyond index 1 grants no coin", () => {
    const state = makeState({
      pointMarket: [null, null, POINT_CARD, null, null],
      players: [makePlayer(0, { resources: { yellow: 2, red: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 0, index: 2 });
    expect(next.players[0].gold).toBe(0);
    expect(next.players[0].silver).toBe(0);
  });

  it("gold depletion does NOT fall back to silver (rulebook §5-D-2)", () => {
    const state = makeState({
      goldSupply: 0,
      pointMarket: [POINT_CARD, null, null, null, null],
      players: [makePlayer(0, { resources: { yellow: 2, red: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 0, index: 0 });
    expect(next.players[0].gold).toBe(0);
    expect(next.players[0].silver).toBe(0);
    expect(next.silverSupply).toBe(6); // untouched
  });

  it("rejects claiming without the exact required resources", () => {
    const state = makeState({
      pointMarket: [POINT_CARD, null, null, null, null],
      players: [makePlayer(0, { resources: { yellow: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 0, index: 0 });
    expect(next).toEqual(state);
  });

  it("canClaimPoint reflects affordability for the market-highlight UI", () => {
    expect(canClaimPoint(makePlayer(0, { resources: { yellow: 2, red: 1 } }), POINT_CARD)).toBe(true);
    expect(canClaimPoint(makePlayer(0, { resources: { yellow: 1 } }), POINT_CARD)).toBe(false);
  });

  it("reaching the point-card goal sets endTriggered but keeps the game running until the last seat's turn", () => {
    const state = makeState({
      playerCount: 3,
      pointCardGoal: 1,
      activeSeat: 0,
      pointMarket: [POINT_CARD, null, null, null, null],
      players: [makePlayer(0, { resources: { yellow: 2, red: 1 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 0, index: 0 });
    expect(next.endTriggered).toBe(true);
    expect(next.phase).toBe("playing"); // seat 0 finishing isn't the last seat (playerCount - 1 = 2)
    expect(next.activeSeat).toBe(1);
  });

  it("ends the game once the trigger has been set and the last seat (playerCount - 1) finishes their turn", () => {
    const state = makeState({
      playerCount: 3,
      pointCardGoal: 6,
      endTriggered: true,
      activeSeat: 2,
      pointMarket: [POINT_CARD, null, null, null, null],
      players: [makePlayer(0), makePlayer(1), makePlayer(2, { resources: { yellow: 2, red: 1 } })],
    });
    const next = applyAction(state, { type: "claimPoint", seat: 2, index: 0 });
    expect(next.phase).toBe("gameOver");
  });
});

describe("discardToLimit — 자원 10개 초과 시 버리기", () => {
  it("finishTurn (via playProduction) enters the discarding phase once resources exceed HAND_LIMIT", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [PRODUCTION_CARD], resources: { yellow: 9 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playProduction", seat: 0, cardId: PRODUCTION_CARD.id });
    expect(next.players[0].resources).toEqual({ yellow: 12 });
    expect(next.phase).toBe("discarding");
    expect(next.awaitingDiscardSeat).toBe(0);
    expect(next.activeSeat).toBe(0); // turn has NOT advanced yet
  });

  it("does not require discarding at exactly HAND_LIMIT", () => {
    const state = makeState({
      players: [makePlayer(0, { hand: [PRODUCTION_CARD], resources: { yellow: 7 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playProduction", seat: 0, cardId: PRODUCTION_CARD.id });
    expect(next.players[0].resources).toEqual({ yellow: 10 });
    expect(next.phase).toBe("playing");
  });

  it("resolves the discard down to exactly HAND_LIMIT and advances the turn", () => {
    const state = makeState({
      phase: "discarding",
      awaitingDiscardSeat: 0,
      activeSeat: 0,
      players: [makePlayer(0, { resources: { yellow: 8, red: 4 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "discardToLimit", seat: 0, discard: { yellow: 2 } });
    expect(next.players[0].resources).toEqual({ yellow: 6, red: 4 });
    expect(next.phase).toBe("playing");
    expect(next.awaitingDiscardSeat).toBeNull();
    expect(next.activeSeat).toBe(1);
  });

  it("rejects a discard that doesn't land exactly on HAND_LIMIT", () => {
    const state = makeState({
      phase: "discarding",
      awaitingDiscardSeat: 0,
      players: [makePlayer(0, { resources: { yellow: 8, red: 4 } }), makePlayer(1), makePlayer(2)],
    });
    const tooLittle = applyAction(state, { type: "discardToLimit", seat: 0, discard: { yellow: 1 } });
    expect(tooLittle).toEqual(state);
    const tooMuch = applyAction(state, { type: "discardToLimit", seat: 0, discard: { yellow: 4 } });
    expect(tooMuch).toEqual(state);
  });

  it("rejects a discard the player can't afford", () => {
    const state = makeState({
      phase: "discarding",
      awaitingDiscardSeat: 0,
      players: [makePlayer(0, { resources: { yellow: 11 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "discardToLimit", seat: 0, discard: { red: 1 } });
    expect(next).toEqual(state);
  });

  it("blocks other actions while a discard is pending", () => {
    const state = makeState({
      phase: "discarding",
      awaitingDiscardSeat: 0,
      activeSeat: 0,
      players: [makePlayer(0, { hand: [PRODUCTION_CARD], resources: { yellow: 11 } }), makePlayer(1), makePlayer(2)],
    });
    const next = applyAction(state, { type: "playProduction", seat: 0, cardId: PRODUCTION_CARD.id });
    expect(next).toEqual(state);
  });
});

describe("computeRankings / computePlayerScore — 최종 점수", () => {
  it("sums point cards + gold*3 + silver*1 + non-yellow resources", () => {
    const player = makePlayer(0, {
      pointCards: [{ id: "a", cost: {}, points: 10 }, { id: "b", cost: {}, points: 5 }],
      gold: 2,
      silver: 3,
      resources: { yellow: 5, red: 2, green: 1, brown: 1 },
    });
    const score = computePlayerScore(player);
    expect(score.pointCardScore).toBe(15);
    expect(score.goldScore).toBe(6);
    expect(score.silverScore).toBe(3);
    expect(score.resourceScore).toBe(4); // red 2 + green 1 + brown 1, yellow excluded
    expect(score.total).toBe(28);
  });

  it("breaks ties by later turn order (higher seat wins), rulebook §7.3", () => {
    const state = makeState({
      players: [
        makePlayer(0, { pointCards: [{ id: "a", cost: {}, points: 10 }] }),
        makePlayer(1, { pointCards: [{ id: "b", cost: {}, points: 10 }] }),
        makePlayer(2, { pointCards: [{ id: "c", cost: {}, points: 3 }] }),
      ],
    });
    const rankings = computeRankings(state);
    expect(rankings[0]).toMatchObject({ seat: 1, rank: 1 });
    expect(rankings[1]).toMatchObject({ seat: 0, rank: 2 });
    expect(rankings[2]).toMatchObject({ seat: 2, rank: 3 });
  });

  it("produces a strict full ranking (never any tied ranks)", () => {
    const state = makeState();
    const rankings = computeRankings(state);
    expect(rankings.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("full game simulation", () => {
  it("runs claim -> endTriggered -> rest-until-last-seat -> gameOver end to end, interleaving a mandatory discard", () => {
    let state = makeState({
      playerCount: 3,
      pointCardGoal: 1,
      activeSeat: 0,
      pointMarket: [POINT_CARD, null, null, null, null],
      players: [
        makePlayer(0, { resources: { yellow: 2, red: 1 } }),
        // seat 1 will be pushed over HAND_LIMIT by a production play, forcing a discard mid-simulation.
        makePlayer(1, { hand: [PRODUCTION_CARD], resources: { yellow: 8 } }),
        makePlayer(2),
      ],
    });

    // Seat 0 claims the only point card -> reaches pointCardGoal (1) -> endTriggered, turn passes to seat 1.
    state = applyAction(state, { type: "claimPoint", seat: 0, index: 0 });
    expect(state.endTriggered).toBe(true);
    expect(state.phase).toBe("playing");
    expect(state.activeSeat).toBe(1);

    // Seat 1 plays production (8 -> 11 yellow), which must gate on a discard before advancing.
    state = applyAction(state, { type: "playProduction", seat: 1, cardId: PRODUCTION_CARD.id });
    expect(state.phase).toBe("discarding");
    expect(state.awaitingDiscardSeat).toBe(1);
    state = applyAction(state, { type: "discardToLimit", seat: 1, discard: { yellow: 1 } });
    expect(state.phase).toBe("playing");
    expect(state.activeSeat).toBe(2);

    // Seat 2 (playerCount - 1) is the last seat in turn order — resting ends the game.
    state = applyAction(state, { type: "rest", seat: 2 });
    expect(state.phase).toBe("gameOver");

    const rankings = computeRankings(state);
    expect(rankings[0].seat).toBe(0); // only seat with a point card
  });
});
