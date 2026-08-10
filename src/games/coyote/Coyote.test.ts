import { describe, expect, it } from "vitest";
import {
  aliveSeats,
  applyAction,
  buildDeck,
  computeRankings,
  DECK_SIZE,
  getPlayerView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_HEARTS,
  startGame,
  type Card,
  type CoyoteState,
  type PlayerState,
} from "./engine";

function card(id: number, kind: Card["kind"], value = 0): Card {
  return { id, kind, value };
}

function makeState(overrides: Partial<CoyoteState> = {}): CoyoteState {
  const players: PlayerState[] = [
    { seat: 0, hearts: STARTING_HEARTS },
    { seat: 1, hearts: STARTING_HEARTS },
    { seat: 2, hearts: STARTING_HEARTS },
  ];
  return {
    playerCount: 3,
    players,
    tableCards: {
      0: card(0, "number", 5),
      1: card(1, "number", 10),
      2: card(2, "number", 3),
    },
    roundDeck: [],
    currentBid: null,
    activeSeat: 0,
    roundStarter: 0,
    roundNumber: 1,
    phase: "playing",
    lastResolution: null,
    eliminationOrder: [],
    winnerSeat: null,
    ...overrides,
  };
}

describe("buildDeck — 룰북 §1 구성물 (36장)", () => {
  it("builds exactly 36 cards", () => {
    expect(buildDeck()).toHaveLength(36);
    expect(DECK_SIZE).toBe(36);
  });

  it("has the researched category totals: 26 코요테카드 + 3×0 + 2×-5 + 1×-10 + 4 unique specials", () => {
    const deck = buildDeck();
    const numberCards = deck.filter((c) => c.kind === "number");
    expect(numberCards).toHaveLength(32); // 26 + 3(0) + 2(-5) + 1(-10)
    expect(numberCards.filter((c) => c.value === 0)).toHaveLength(3);
    expect(numberCards.filter((c) => c.value === -5)).toHaveLength(2);
    expect(numberCards.filter((c) => c.value === -10)).toHaveLength(1);
    for (const [value, count] of [
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 3],
      [5, 3],
      [10, 3],
      [15, 3],
      [20, 2],
    ] as const) {
      expect(numberCards.filter((c) => c.value === value)).toHaveLength(count);
    }
    expect(deck.filter((c) => c.kind === "night")).toHaveLength(1);
    expect(deck.filter((c) => c.kind === "question")).toHaveLength(1);
    expect(deck.filter((c) => c.kind === "maxZero")).toHaveLength(1);
    expect(deck.filter((c) => c.kind === "double")).toHaveLength(1);
  });

  it("gives every card a unique id", () => {
    const ids = buildDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("startGame — setup", () => {
  it("deals one card per seat and keeps the rest as the round deck", () => {
    const state = startGame(4, 1);
    expect(state.players).toHaveLength(4);
    expect(Object.keys(state.tableCards)).toHaveLength(4);
    expect(state.roundDeck).toHaveLength(DECK_SIZE - 4);
    expect(state.players.every((p) => p.hearts === STARTING_HEARTS)).toBe(true);
    expect(state.currentBid).toBeNull();
    expect(state.phase).toBe("playing");
    expect(state.roundNumber).toBe(1);
    expect(state.roundStarter).toBe(state.activeSeat);
  });

  it("never deals the same card twice", () => {
    const state = startGame(6, 7);
    const allIds = [...Object.values(state.tableCards).map((c) => c.id), ...state.roundDeck.map((c) => c.id)];
    expect(new Set(allIds).size).toBe(DECK_SIZE);
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(5, 42);
    const b = startGame(5, 42);
    expect(a).toEqual(b);
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(2, 1)).toThrow();
    expect(() => startGame(7, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(3);
    expect(MAX_PLAYERS).toBe(6);
  });
});

describe("getPlayerView — 이마 카드 정보 격리", () => {
  it("hides only the viewer's own card while the round is live", () => {
    const state = makeState({ phase: "playing" });
    const view = getPlayerView(state, 0);
    expect(view.find((v) => v.seat === 0)!.card).toBeNull();
    expect(view.find((v) => v.seat === 1)!.card).toEqual(state.tableCards[1]);
    expect(view.find((v) => v.seat === 2)!.card).toEqual(state.tableCards[2]);
  });

  it("a different viewer sees their own card hidden instead", () => {
    const state = makeState({ phase: "playing" });
    const view = getPlayerView(state, 1);
    expect(view.find((v) => v.seat === 1)!.card).toBeNull();
    expect(view.find((v) => v.seat === 0)!.card).toEqual(state.tableCards[0]);
  });

  it("reveals every seat's card once the round moves to reveal/gameOver", () => {
    const state = makeState({ phase: "reveal" });
    const view = getPlayerView(state, 0);
    expect(view.find((v) => v.seat === 0)!.card).toEqual(state.tableCards[0]);

    const overState = makeState({ phase: "gameOver" });
    const overView = getPlayerView(overState, 2);
    expect(overView.find((v) => v.seat === 2)!.card).toEqual(overState.tableCards[2]);
  });
});

describe("declare — 숫자 선언 오름차순 유효성", () => {
  it("accepts any integer as the round's opening declaration", () => {
    const state = makeState({ currentBid: null, activeSeat: 0 });
    const next = applyAction(state, { type: "declare", seat: 0, number: -3 });
    expect(next.currentBid).toEqual({ seat: 0, number: -3 });
  });

  it("rejects a declaration that doesn't strictly exceed the previous one", () => {
    const state = makeState({ currentBid: { seat: 0, number: 15 }, activeSeat: 1 });
    const same = applyAction(state, { type: "declare", seat: 1, number: 15 });
    expect(same).toBe(state); // no-op
    const lower = applyAction(state, { type: "declare", seat: 1, number: 10 });
    expect(lower).toBe(state); // no-op
  });

  it("accepts a strictly higher declaration and advances to the next alive seat", () => {
    const state = makeState({ currentBid: { seat: 0, number: 15 }, activeSeat: 1 });
    const next = applyAction(state, { type: "declare", seat: 1, number: 16 });
    expect(next.currentBid).toEqual({ seat: 1, number: 16 });
    expect(next.activeSeat).toBe(2);
  });

  it("rejects a declaration from someone other than the active seat", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "declare", seat: 1, number: 5 });
    expect(next).toBe(state);
  });

  it("skips eliminated seats when advancing", () => {
    const players: PlayerState[] = [
      { seat: 0, hearts: STARTING_HEARTS },
      { seat: 1, hearts: 0 },
      { seat: 2, hearts: STARTING_HEARTS },
    ];
    const state = makeState({ players, activeSeat: 0 });
    const next = applyAction(state, { type: "declare", seat: 0, number: 5 });
    expect(next.activeSeat).toBe(2);
  });
});

describe("coyote — 외침 유효성", () => {
  it("cannot be called with no pending declaration", () => {
    const state = makeState({ currentBid: null, activeSeat: 0 });
    const next = applyAction(state, { type: "coyote", seat: 0 });
    expect(next).toBe(state);
  });

  it("cannot be called out of turn", () => {
    const state = makeState({ currentBid: { seat: 0, number: 5 }, activeSeat: 1 });
    const next = applyAction(state, { type: "coyote", seat: 2 });
    expect(next).toBe(state);
  });

  it("moves the game to the reveal phase", () => {
    const state = makeState({ currentBid: { seat: 0, number: 5 }, activeSeat: 1 });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.phase).toBe("reveal");
    expect(next.lastResolution).not.toBeNull();
  });
});

describe("showdown 계산 — 룰북 §3 특수 카드 적용 순서", () => {
  it("sums plain number cards with no specials", () => {
    // table: 5 + 10 + 3 = 18
    const state = makeState({ currentBid: { seat: 0, number: 18 }, activeSeat: 1 });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.lastResolution!.finalTotal).toBe(18);
  });

  it("chains multiple '?' draws and adds every drawn value", () => {
    const state = makeState({
      tableCards: { 0: card(0, "question"), 1: card(1, "number", 10), 2: card(2, "number", 3) },
      roundDeck: [card(90, "question"), card(91, "number", 7), card(92, "number", 100)],
      currentBid: { seat: 0, number: 5 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    // base 10+3=13, first '?' draws card 90 which is itself '?', chaining to draw card 91 (value 7).
    // total = 13 + 0(first ?) + 0(second ?) + 7 = 20; card 92 (value 100) is never drawn.
    expect(next.lastResolution!.extraDrawnCards.map((c) => c.id)).toEqual([90, 91]);
    expect(next.lastResolution!.finalTotal).toBe(20);
  });

  it("MAX→0 zeroes the single highest number card", () => {
    const state = makeState({
      tableCards: { 0: card(0, "maxZero"), 1: card(1, "number", 20), 2: card(2, "number", 3) },
      currentBid: { seat: 0, number: 1 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    // base 20+3=23, minus the zeroed 20 -> 3
    expect(next.lastResolution!.maxZeroTarget).toEqual({ seat: 1, card: card(1, "number", 20) });
    expect(next.lastResolution!.finalTotal).toBe(3);
  });

  it("MAX→0 tie-break picks the lowest seat index among equal maxima", () => {
    const state = makeState({
      tableCards: { 0: card(0, "maxZero"), 1: card(1, "number", 10), 2: card(2, "number", 10) },
      currentBid: { seat: 0, number: 1 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.lastResolution!.maxZeroTarget.seat).toBe(1);
    expect(next.lastResolution!.finalTotal).toBe(10); // 10+10 - 10(zeroed) = 10
  });

  it("x2 doubles the final total after MAX→0 has already been applied", () => {
    const state = makeState({
      tableCards: { 0: card(0, "double"), 1: card(1, "maxZero"), 2: card(2, "number", 20) },
      currentBid: { seat: 0, number: 1 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    // only number card is 20, zeroed by maxZero -> 0, doubled -> 0
    expect(next.lastResolution!.finalTotal).toBe(0);
  });

  it("combines '?' + MAX→0 + x2 in the rulebook's exact order", () => {
    const state = makeState({
      tableCards: { 0: card(0, "question"), 1: card(1, "maxZero"), 2: card(2, "double") },
      roundDeck: [card(90, "number", 20), card(91, "number", 4)],
      currentBid: { seat: 0, number: 1 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    // drawn: only card 90 (value 20) since it's not a '?'. Sum candidates: 20.
    // MAX→0 zeroes the 20 (came from extra draw, no seat) -> sum 0. x2 -> 0.
    expect(next.lastResolution!.extraDrawnCards.map((c) => c.id)).toEqual([90]);
    expect(next.lastResolution!.maxZeroTarget).toEqual({ seat: null, card: card(90, "number", 20) });
    expect(next.lastResolution!.finalTotal).toBe(0);
  });

  it("negative-value cards subtract from the sum", () => {
    const state = makeState({
      tableCards: { 0: card(0, "number", -10), 1: card(1, "number", -5), 2: card(2, "number", 20) },
      currentBid: { seat: 0, number: 100 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.lastResolution!.finalTotal).toBe(5); // -10-5+20
  });
});

describe("코요테 판정 — §4 벌점", () => {
  it("bidder loses a heart when the real total is lower than their declaration (overbid)", () => {
    // table sums to 18, bidder declared 20 -> overbid.
    const state = makeState({ currentBid: { seat: 0, number: 20 }, activeSeat: 1 });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.lastResolution!.loserWasBidder).toBe(true);
    expect(next.lastResolution!.loserSeat).toBe(0);
    expect(next.players.find((p) => p.seat === 0)!.hearts).toBe(STARTING_HEARTS - 1);
    expect(next.players.find((p) => p.seat === 1)!.hearts).toBe(STARTING_HEARTS);
  });

  it("caller loses a heart when the declaration was safe (total >= declared number)", () => {
    // table sums to 18, bidder declared 18 exactly (safe: total >= declared).
    const state = makeState({ currentBid: { seat: 0, number: 18 }, activeSeat: 1 });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.lastResolution!.loserWasBidder).toBe(false);
    expect(next.lastResolution!.loserSeat).toBe(1);
    expect(next.players.find((p) => p.seat === 1)!.hearts).toBe(STARTING_HEARTS - 1);
    expect(next.players.find((p) => p.seat === 0)!.hearts).toBe(STARTING_HEARTS);
  });

  it("eliminates a seat once its hearts hit 0 and records elimination order", () => {
    const players: PlayerState[] = [
      { seat: 0, hearts: 1 },
      { seat: 1, hearts: STARTING_HEARTS },
      { seat: 2, hearts: STARTING_HEARTS },
    ];
    const state = makeState({ players, currentBid: { seat: 0, number: 20 }, activeSeat: 1 });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.players.find((p) => p.seat === 0)!.hearts).toBe(0);
    expect(next.eliminationOrder).toEqual([0]);
    expect(next.phase).toBe("reveal"); // still 2 alive
  });

  it("ends the game once only one seat remains alive", () => {
    const players: PlayerState[] = [
      { seat: 0, hearts: 1 },
      { seat: 1, hearts: STARTING_HEARTS },
    ];
    const state = makeState({
      playerCount: 2,
      players,
      tableCards: { 0: card(0, "number", 5), 1: card(1, "number", 10) },
      currentBid: { seat: 0, number: 20 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.phase).toBe("gameOver");
    expect(next.winnerSeat).toBe(1);
    expect(computeRankings(next)).toEqual([
      { seat: 1, rank: 1 },
      { seat: 0, rank: 2 },
    ]);
  });
});

describe("night card — 다음 라운드 선 교체 (module doc assumption #3)", () => {
  it("records the night card's holder seat at showdown", () => {
    const state = makeState({
      tableCards: { 0: card(0, "night"), 1: card(1, "number", 10), 2: card(2, "number", 3) },
      currentBid: { seat: 0, number: 5 },
      activeSeat: 1,
    });
    const next = applyAction(state, { type: "coyote", seat: 1 });
    expect(next.lastResolution!.nightCardHolderSeat).toBe(0);
    expect(next.lastResolution!.finalTotal).toBe(13); // night card contributes 0
  });

  it("makes the night-card holder the next round's starter if still alive", () => {
    const state = makeState({
      tableCards: { 0: card(0, "night"), 1: card(1, "number", 10), 2: card(2, "number", 3) },
      currentBid: { seat: 0, number: 5 },
      activeSeat: 1,
    });
    const revealed = applyAction(state, { type: "coyote", seat: 1 }); // seat 1 (caller) loses, safe bid
    const continued = applyAction(revealed, { type: "continue", seed: 99 });
    expect(continued.phase).toBe("playing");
    expect(continued.activeSeat).toBe(0);
    expect(continued.roundStarter).toBe(0);
    expect(continued.currentBid).toBeNull();
  });

  it("falls back to the next alive seat after the loser if the night-card holder was just eliminated", () => {
    const players: PlayerState[] = [
      { seat: 0, hearts: STARTING_HEARTS },
      { seat: 1, hearts: 1 }, // will be eliminated as the caller-loser below
      { seat: 2, hearts: STARTING_HEARTS },
    ];
    const state = makeState({
      players,
      tableCards: { 0: card(0, "number", 5), 1: card(1, "night"), 2: card(2, "number", 3) },
      currentBid: { seat: 0, number: 8 }, // safe: total(8)>=declared(8) -> caller (seat1, the night holder) loses
      activeSeat: 1,
    });
    const revealed = applyAction(state, { type: "coyote", seat: 1 });
    expect(revealed.lastResolution!.nightCardHolderSeat).toBe(1);
    expect(revealed.players.find((p) => p.seat === 1)!.hearts).toBe(0);
    const continued = applyAction(revealed, { type: "continue", seed: 5 });
    // night holder (seat 1) is now eliminated -> fallback to next alive after loser (seat 1) -> seat 2
    expect(continued.activeSeat).toBe(2);
  });
});

describe("continueRound — 새 라운드 재딜", () => {
  it("re-deals fresh cards to every alive seat only", () => {
    const players: PlayerState[] = [
      { seat: 0, hearts: STARTING_HEARTS },
      { seat: 1, hearts: 0 },
      { seat: 2, hearts: STARTING_HEARTS },
    ];
    const state = makeState({
      players,
      phase: "reveal",
      lastResolution: {
        bid: { seat: 0, number: 5 },
        callerSeat: 2,
        tableCards: {},
        extraDrawnCards: [],
        maxZeroTarget: { seat: null, card: null },
        doubled: false,
        finalTotal: 5,
        loserSeat: 2,
        loserWasBidder: false,
        nightCardHolderSeat: null,
      },
    });
    const next = applyAction(state, { type: "continue", seed: 3 });
    expect(next.phase).toBe("playing");
    expect(Object.keys(next.tableCards).map(Number).sort()).toEqual([0, 2]);
    expect(next.roundDeck).toHaveLength(DECK_SIZE - 2);
    expect(next.currentBid).toBeNull();
    expect(next.roundNumber).toBe(2);
  });

  it("is a no-op outside the reveal phase", () => {
    const state = makeState({ phase: "playing" });
    const next = applyAction(state, { type: "continue", seed: 1 });
    expect(next).toBe(state);
  });
});

describe("aliveSeats", () => {
  it("excludes eliminated seats", () => {
    const players: PlayerState[] = [
      { seat: 0, hearts: 2 },
      { seat: 1, hearts: 0 },
      { seat: 2, hearts: 1 },
    ];
    const state = makeState({ players });
    expect(aliveSeats(state)).toEqual([0, 2]);
  });
});
