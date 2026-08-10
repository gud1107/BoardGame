import { describe, expect, it } from "vitest";
import {
  aliveSeats,
  applyAction,
  buildDeck,
  computeRankings,
  DECK_SIZE,
  FORCED_COUP_THRESHOLD,
  getPlayerView,
  isAlive,
  MAX_PLAYERS,
  MIN_PLAYERS,
  mustCoup,
  startGame,
  type Card,
  type CoupState,
  type PlayerState,
} from "./engine";

function card(id: number, character: Card["character"]): Card {
  return { id, character };
}

/** Defaults to alive (2 arbitrary cards, unique ids well clear of any test's explicit low ids) unless a scenario needs a specific hand. */
function player(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { seat, coins: 2, influence: [card(900 + seat * 10, "duke"), card(901 + seat * 10, "captain")], revealed: [], ...overrides };
}

function makeState(overrides: Partial<CoupState> = {}): CoupState {
  const players: PlayerState[] = [
    player(0, { influence: [card(0, "duke"), card(1, "assassin")] }),
    player(1, { influence: [card(2, "contessa"), card(3, "captain")] }),
    player(2, { influence: [card(4, "ambassador"), card(5, "duke")] }),
  ];
  return {
    playerCount: 3,
    players,
    deck: [card(100, "duke"), card(101, "assassin")],
    activeSeat: 0,
    phase: "action",
    turnNumber: 1,
    pendingAction: null,
    pendingBlock: null,
    awaitingSeats: [],
    pendingLoseInfluence: null,
    pendingExchange: null,
    lastEvent: null,
    eliminationOrder: [],
    winnerSeat: null,
    ...overrides,
  };
}

describe("buildDeck — §1 구성물 (5종 x 3장 = 15장)", () => {
  it("builds exactly 15 cards", () => {
    expect(buildDeck()).toHaveLength(15);
    expect(DECK_SIZE).toBe(15);
  });

  it("has exactly 3 of each character", () => {
    const deck = buildDeck();
    for (const character of ["duke", "assassin", "contessa", "captain", "ambassador"] as const) {
      expect(deck.filter((c) => c.character === character)).toHaveLength(3);
    }
  });

  it("gives every card a unique id", () => {
    const ids = buildDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("startGame — §1 세팅", () => {
  it("rejects out-of-range player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(MAX_PLAYERS + 1, 1)).toThrow();
  });

  it("deals 2 coins + 2 hidden influence cards per seat, leaves the rest in the deck", () => {
    const state = startGame(4, 42);
    expect(state.players).toHaveLength(4);
    for (const p of state.players) {
      expect(p.coins).toBe(2);
      expect(p.influence).toHaveLength(2);
      expect(p.revealed).toHaveLength(0);
    }
    expect(state.deck).toHaveLength(15 - 4 * 2);
    expect(state.phase).toBe("action");
  });

  it("is deterministic for a fixed seed", () => {
    const a = startGame(4, 777);
    const b = startGame(4, 777);
    expect(a).toEqual(b);
  });

  it("can produce either seat as the starter across seeds", () => {
    const starters = new Set(Array.from({ length: 30 }, (_, i) => startGame(3, i).activeSeat));
    expect(starters.size).toBeGreaterThan(1);
  });
});

describe("income — 일반 행동, 방해/의심 불가", () => {
  it("grants 1 coin immediately and ends the turn", () => {
    const state = makeState();
    const next = applyAction(state, { type: "declareAction", seat: 0, action: "income" });
    expect(next.players.find((p) => p.seat === 0)!.coins).toBe(3);
    expect(next.phase).toBe("action");
    expect(next.activeSeat).toBe(1);
  });
});

describe("쿠(coup) — §3-A 필수 규칙 및 방해/도전 불가", () => {
  it("costs 7 coins and removes a chosen influence card from the target with no challenge window", () => {
    const state = makeState({ players: [player(0, { coins: 7, influence: [card(0, "duke"), card(1, "assassin")] }), player(1, { influence: [card(2, "contessa"), card(3, "captain")] }), player(2, { influence: [card(4, "ambassador")] })] });
    const declared = applyAction(state, { type: "declareAction", seat: 0, action: "coup", targetSeat: 1 });
    expect(declared.players.find((p) => p.seat === 0)!.coins).toBe(0);
    expect(declared.phase).toBe("loseInfluence");
    expect(declared.pendingLoseInfluence).toEqual({ seat: 1, reason: "coup" });

    const resolved = applyAction(declared, { type: "revealInfluence", seat: 1, cardId: 2 });
    const target = resolved.players.find((p) => p.seat === 1)!;
    expect(target.influence).toHaveLength(1);
    expect(target.revealed.map((c) => c.character)).toEqual(["contessa"]);
    expect(resolved.phase).toBe("action");
    expect(resolved.activeSeat).toBe(1); // seat 1 lost only 1 of 2 cards — still alive, turn just moves on
  });

  it("rejects an insufficient-coin coup and rejects declaring against yourself", () => {
    const state = makeState({ players: [player(0, { coins: 3 }), player(1), player(2)] });
    expect(applyAction(state, { type: "declareAction", seat: 0, action: "coup", targetSeat: 1 })).toBe(state);
    const richState = makeState({ players: [player(0, { coins: 7 }), player(1), player(2)] });
    expect(applyAction(richState, { type: "declareAction", seat: 0, action: "coup", targetSeat: 0 })).toBe(richState);
  });

  it("forces coup once coins reach 10 — any other declared action is a no-op", () => {
    const state = makeState({ players: [player(0, { coins: FORCED_COUP_THRESHOLD }), player(1), player(2)] });
    expect(mustCoup(FORCED_COUP_THRESHOLD)).toBe(true);
    expect(applyAction(state, { type: "declareAction", seat: 0, action: "income" })).toBe(state);
    expect(applyAction(state, { type: "declareAction", seat: 0, action: "tax" })).toBe(state);

    const couped = applyAction(state, { type: "declareAction", seat: 0, action: "coup", targetSeat: 1 });
    expect(couped.phase).toBe("loseInfluence");
    expect(couped.players.find((p) => p.seat === 0)!.coins).toBe(3);
  });
});

describe("세금 징수(tax, 공작) — 의심(challenge) 성공/실패", () => {
  it("도전 성공: bluffing the Duke claim costs the actor a card and cancels the tax", () => {
    const state = makeState({
      players: [player(0, { influence: [card(0, "assassin"), card(1, "captain")] }), player(1, { influence: [card(2, "contessa"), card(3, "captain")] }), player(2, { influence: [card(4, "ambassador"), card(5, "duke")] })],
    });
    const declared = applyAction(state, { type: "declareAction", seat: 0, action: "tax" });
    expect(declared.phase).toBe("actionChallengeWindow");
    expect(declared.awaitingSeats).toEqual([1, 2]);

    const challenged = applyAction(declared, { type: "challenge", seat: 1 });
    expect(challenged.phase).toBe("loseInfluence");
    expect(challenged.pendingLoseInfluence).toEqual({ seat: 0, reason: "challengeActionLost" });

    const resolved = applyAction(challenged, { type: "revealInfluence", seat: 0, cardId: 0 });
    const actor = resolved.players.find((p) => p.seat === 0)!;
    expect(actor.coins).toBe(2); // tax never paid out
    expect(actor.influence).toHaveLength(1);
    expect(resolved.phase).toBe("action");
    expect(resolved.activeSeat).toBe(1);
  });

  it("도전 실패: a true Duke claim costs the challenger a card, replaces the proven card, and tax still pays out", () => {
    const declared = applyAction(makeState(), { type: "declareAction", seat: 0, action: "tax" });
    const challenged = applyAction(declared, { type: "challenge", seat: 1 });
    expect(challenged.pendingLoseInfluence).toEqual({ seat: 1, reason: "challengeActionFailed_penalty" });

    const resolved = applyAction(challenged, { type: "revealInfluence", seat: 1, cardId: 2, seed: 12345 });
    const challenger = resolved.players.find((p) => p.seat === 1)!;
    expect(challenger.influence).toHaveLength(1);
    expect(challenger.revealed.map((c) => c.character)).toEqual(["contessa"]);

    const actor = resolved.players.find((p) => p.seat === 0)!;
    expect(actor.coins).toBe(5); // tax paid out despite the challenge
    expect(actor.influence).toHaveLength(2); // proven card replaced 1-for-1 (its new identity depends on the shuffle, not asserted here)
    expect(resolved.phase).toBe("action");
    expect(resolved.activeSeat).toBe(1);
  });

  it("everyone passing lets the claim survive unchallenged", () => {
    let state = applyAction(makeState(), { type: "declareAction", seat: 0, action: "tax" });
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.phase).toBe("actionChallengeWindow"); // seat 2 still owed a response
    state = applyAction(state, { type: "pass", seat: 2 });
    expect(state.phase).toBe("action");
    expect(state.players.find((p) => p.seat === 0)!.coins).toBe(5);
  });
});

describe("외화 도입(foreign aid) — 공작으로만 방해 가능", () => {
  it("is not itself challengeable — skips straight to the block window, open to every other seat", () => {
    const declared = applyAction(makeState(), { type: "declareAction", seat: 0, action: "foreignAid" });
    expect(declared.phase).toBe("blockWindow");
    expect(declared.awaitingSeats).toEqual([1, 2]);
  });

  it("resolves for 2 coins when nobody blocks", () => {
    let state = applyAction(makeState(), { type: "declareAction", seat: 0, action: "foreignAid" });
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    expect(state.players.find((p) => p.seat === 0)!.coins).toBe(4);
    expect(state.phase).toBe("action");
  });

  it("a Duke block, unchallenged, cancels the foreign aid entirely", () => {
    let state = applyAction(makeState(), { type: "declareAction", seat: 0, action: "foreignAid" });
    state = applyAction(state, { type: "declareBlock", seat: 2, character: "duke" });
    expect(state.phase).toBe("blockChallengeWindow");
    expect(state.awaitingSeats).toEqual([0, 1]);
    state = applyAction(state, { type: "pass", seat: 0 });
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.players.find((p) => p.seat === 0)!.coins).toBe(2); // never paid out
    expect(state.phase).toBe("action");
  });

  it("a bluffed Duke block, successfully challenged, costs the blocker a card and the foreign aid still pays out", () => {
    let state = applyAction(makeState(), { type: "declareAction", seat: 0, action: "foreignAid" });
    state = applyAction(state, { type: "declareBlock", seat: 1, character: "duke" }); // seat 1 holds no duke
    const challenged = applyAction(state, { type: "challenge", seat: 0 });
    expect(challenged.pendingLoseInfluence).toEqual({ seat: 1, reason: "blockBluffCaught" });
    const resolved = applyAction(challenged, { type: "revealInfluence", seat: 1, cardId: 2 });
    expect(resolved.players.find((p) => p.seat === 1)!.influence).toHaveLength(1);
    expect(resolved.players.find((p) => p.seat === 0)!.coins).toBe(4); // still lands
    expect(resolved.phase).toBe("action");
  });

  it("a true Duke block, wrongly challenged, costs the challenger a card and the block still stands", () => {
    const withDuke = makeState({ players: [player(0), player(1, { influence: [card(2, "duke"), card(3, "captain")] }), player(2)] });
    let state = applyAction(withDuke, { type: "declareAction", seat: 0, action: "foreignAid" });
    state = applyAction(state, { type: "declareBlock", seat: 1, character: "duke" });
    const challenged = applyAction(state, { type: "challenge", seat: 0 });
    expect(challenged.pendingLoseInfluence).toEqual({ seat: 0, reason: "challengeBlockFailed_penalty" });
    const resolved = applyAction(challenged, { type: "revealInfluence", seat: 0, cardId: 900, seed: 9 });
    expect(resolved.players.find((p) => p.seat === 0)!.influence).toHaveLength(1);
    expect(resolved.players.find((p) => p.seat === 0)!.coins).toBe(2); // blocked, never paid out
  });
});

describe("암살(assassinate) — 백작부인으로만 방해, §4-2 Double Kill", () => {
  function assassinateState(targetInfluence: Card[]) {
    return makeState({
      players: [player(0, { coins: 3, influence: [card(0, "assassin"), card(1, "captain")] }), player(1, { influence: targetInfluence }), player(2)],
    });
  }

  it("costs 3 coins upfront and lands on the target when unblocked", () => {
    let state = applyAction(assassinateState([card(2, "contessa"), card(3, "captain")]), { type: "declareAction", seat: 0, action: "assassinate", targetSeat: 1 });
    expect(state.players.find((p) => p.seat === 0)!.coins).toBe(0);
    expect(state.phase).toBe("actionChallengeWindow");
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    expect(state.phase).toBe("blockWindow");
    expect(state.awaitingSeats).toEqual([1]); // only the target may block
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.phase).toBe("loseInfluence");
    expect(state.pendingLoseInfluence).toEqual({ seat: 1, reason: "assassinateEffect" });
  });

  it("Double Kill: a bluffed Contessa block, successfully challenged, costs the target a card twice in a row", () => {
    let state = applyAction(assassinateState([card(2, "captain"), card(3, "ambassador")]), { type: "declareAction", seat: 0, action: "assassinate", targetSeat: 1 });
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    state = applyAction(state, { type: "declareBlock", seat: 1, character: "contessa" }); // bluff — seat 1 has no contessa
    state = applyAction(state, { type: "challenge", seat: 0 });
    expect(state.pendingLoseInfluence).toEqual({ seat: 1, reason: "blockBluffCaught" });

    const afterFirstLoss = applyAction(state, { type: "revealInfluence", seat: 1, cardId: 2 });
    expect(afterFirstLoss.players.find((p) => p.seat === 1)!.influence).toHaveLength(1); // 1 card gone (block-bluff penalty)
    expect(afterFirstLoss.phase).toBe("loseInfluence");
    expect(afterFirstLoss.pendingLoseInfluence).toEqual({ seat: 1, reason: "assassinateEffect" }); // the assassinate itself still lands

    const afterSecondLoss = applyAction(afterFirstLoss, { type: "revealInfluence", seat: 1, cardId: 3 });
    expect(afterSecondLoss.players.find((p) => p.seat === 1)!.influence).toHaveLength(0);
    expect(isAlive(afterSecondLoss.players.find((p) => p.seat === 1)!)).toBe(false); // eliminated by 2 losses in one turn
    expect(afterSecondLoss.eliminationOrder).toEqual([1]);
  });

  it("skips the second hit when the block-bluff penalty already eliminated a 1-card target", () => {
    let state = applyAction(assassinateState([card(2, "captain")]), { type: "declareAction", seat: 0, action: "assassinate", targetSeat: 1 });
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    state = applyAction(state, { type: "declareBlock", seat: 1, character: "contessa" });
    state = applyAction(state, { type: "challenge", seat: 0 });
    const resolved = applyAction(state, { type: "revealInfluence", seat: 1, cardId: 2 });
    expect(resolved.phase).toBe("action"); // no second loseInfluence prompt — already eliminated
    expect(resolved.eliminationOrder).toEqual([1]);
  });

  it("a true Contessa block, wrongly challenged, keeps the target's card and costs the challenger one", () => {
    let state = applyAction(assassinateState([card(2, "contessa"), card(3, "captain")]), { type: "declareAction", seat: 0, action: "assassinate", targetSeat: 1 });
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    state = applyAction(state, { type: "declareBlock", seat: 1, character: "contessa" });
    state = applyAction(state, { type: "challenge", seat: 0 });
    expect(state.pendingLoseInfluence).toEqual({ seat: 0, reason: "challengeBlockFailed_penalty" });
    const resolved = applyAction(state, { type: "revealInfluence", seat: 0, cardId: 1, seed: 3 });
    expect(resolved.players.find((p) => p.seat === 1)!.influence).toHaveLength(2); // fully protected
    expect(resolved.players.find((p) => p.seat === 0)!.influence).toHaveLength(1);
  });
});

describe("갈취(steal, 사령관) — 사령관/제상으로 방해 가능", () => {
  it("transfers min(2, target coins) when unblocked", () => {
    let state = applyAction(makeState({ players: [player(0, { influence: [card(0, "captain"), card(1, "duke")] }), player(1, { coins: 1 }), player(2)] }), {
      type: "declareAction",
      seat: 0,
      action: "steal",
      targetSeat: 1,
    });
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    state = applyAction(state, { type: "pass", seat: 1 }); // block window — only the target
    expect(state.players.find((p) => p.seat === 0)!.coins).toBe(3);
    expect(state.players.find((p) => p.seat === 1)!.coins).toBe(0);
  });

  it("can be blocked by claiming Ambassador, not just Captain", () => {
    let state = applyAction(makeState({ players: [player(0, { influence: [card(0, "captain"), card(1, "duke")] }), player(1, { influence: [card(2, "ambassador"), card(3, "duke")] }), player(2)] }), {
      type: "declareAction",
      seat: 0,
      action: "steal",
      targetSeat: 1,
    });
    state = applyAction(state, { type: "pass", seat: 1 });
    state = applyAction(state, { type: "pass", seat: 2 });
    state = applyAction(state, { type: "declareBlock", seat: 1, character: "ambassador" });
    state = applyAction(state, { type: "pass", seat: 0 });
    state = applyAction(state, { type: "pass", seat: 2 });
    expect(state.players.find((p) => p.seat === 0)!.coins).toBe(2); // never took the coins
    expect(state.players.find((p) => p.seat === 1)!.coins).toBe(2);
  });
});

describe("교환(exchange, 제상)", () => {
  it("draws 2 cards, offers all 4 as options, and returns the unwanted 2 to the deck", () => {
    const state = makeState({ deck: [card(100, "duke"), card(101, "assassin"), card(102, "contessa")] });
    let next = applyAction(state, { type: "declareAction", seat: 0, action: "exchange" });
    next = applyAction(next, { type: "pass", seat: 1 });
    next = applyAction(next, { type: "pass", seat: 2, seed: 55 });
    expect(next.phase).toBe("exchange");
    expect(next.pendingExchange!.seat).toBe(0);
    expect(next.pendingExchange!.keepCount).toBe(2);
    expect(next.pendingExchange!.options).toHaveLength(4); // 2 current + 2 drawn
    expect(next.deck).toHaveLength(1); // 3 in deck - 2 drawn

    const options = next.pendingExchange!.options;
    const keepIds = [options[0].id, options[1].id];
    const resolved = applyAction(next, { type: "resolveExchange", seat: 0, keepCardIds: keepIds });
    expect(resolved.players.find((p) => p.seat === 0)!.influence.map((c) => c.id)).toEqual(keepIds);
    expect(resolved.deck).toHaveLength(3); // 1 left + 2 returned
    expect(resolved.phase).toBe("action");
    expect(resolved.activeSeat).toBe(1);
  });

  it("rejects keeping the wrong count or an id that wasn't offered", () => {
    let next = applyAction(makeState(), { type: "declareAction", seat: 0, action: "exchange" });
    next = applyAction(next, { type: "pass", seat: 1 });
    next = applyAction(next, { type: "pass", seat: 2 });
    expect(applyAction(next, { type: "resolveExchange", seat: 0, keepCardIds: [0] })).toBe(next); // wrong count
    expect(applyAction(next, { type: "resolveExchange", seat: 0, keepCardIds: [0, 9999] })).toBe(next); // not offered
  });
});

describe("탈락 및 최종 승리 — §2 즉시 탈락, §5 단판 종료", () => {
  it("eliminates a seat the instant its 2nd influence card is revealed, and crowns the sole survivor", () => {
    const twoPlayers = makeState({
      playerCount: 2,
      players: [player(0, { coins: 7, influence: [card(0, "duke"), card(1, "assassin")] }), player(1, { influence: [card(2, "contessa")] })],
    });
    const declared = applyAction(twoPlayers, { type: "declareAction", seat: 0, action: "coup", targetSeat: 1 });
    const resolved = applyAction(declared, { type: "revealInfluence", seat: 1, cardId: 2 });
    expect(isAlive(resolved.players.find((p) => p.seat === 1)!)).toBe(false);
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winnerSeat).toBe(0);
    expect(aliveSeats(resolved)).toEqual([0]);

    const rankings = computeRankings(resolved);
    expect(rankings).toEqual([
      { seat: 0, rank: 1 },
      { seat: 1, rank: 2 },
    ]);
  });

  it("no-op once the game is already over", () => {
    const over = makeState({ phase: "gameOver", winnerSeat: 0, eliminationOrder: [1, 2] });
    expect(applyAction(over, { type: "declareAction", seat: 0, action: "income" })).toBe(over);
    expect(computeRankings(over)).toEqual([
      { seat: 0, rank: 1 },
      { seat: 2, rank: 2 },
      { seat: 1, rank: 3 },
    ]);
  });
});

describe("getPlayerView — 영향력 카드 비공개", () => {
  it("hides other seats' influence but always shows coins and revealed cards", () => {
    const state = makeState();
    const view = getPlayerView(state, 0);
    const me = view.players.find((p) => p.seat === 0)!;
    const other = view.players.find((p) => p.seat === 1)!;
    expect(me.influence).toEqual(state.players[0].influence);
    expect(other.influence).toBeNull();
    expect(other.influenceCount).toBe(2);
    expect(other.coins).toBe(2);
  });

  it("reveals every hand once the game is over", () => {
    const state = makeState({ phase: "gameOver", winnerSeat: 0 });
    const view = getPlayerView(state, 0);
    expect(view.players.find((p) => p.seat === 1)!.influence).toEqual(state.players[1].influence);
  });

  it("only exposes pendingExchange options to the seat that owns them", () => {
    let next = applyAction(makeState(), { type: "declareAction", seat: 0, action: "exchange" });
    next = applyAction(next, { type: "pass", seat: 1 });
    next = applyAction(next, { type: "pass", seat: 2 });
    expect(getPlayerView(next, 0).pendingExchangeOptions).toHaveLength(4);
    expect(getPlayerView(next, 1).pendingExchangeOptions).toBeNull();
  });
});

describe("MIN_PLAYERS/MAX_PLAYERS", () => {
  it("matches §1 인원 2명~6명", () => {
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(6);
  });
});
