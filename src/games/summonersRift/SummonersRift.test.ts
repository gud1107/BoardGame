import { describe, expect, it } from "vitest";
import {
  applyAction,
  BASE_HP,
  buildMonsterDeck,
  chooseBotAction,
  computeRankings,
  computeTotalHp,
  findKiller,
  FAILURE_TOKENS_TO_ELIMINATE,
  getItemDef,
  getValidMoves,
  ITEM_CATALOG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MONSTER_CATALOG,
  MONSTER_DECK_SIZE,
  startGame,
  SUCCESS_TOKENS_TO_WIN,
  type MonsterCard,
  type PlayerState,
  type SeatIndex,
  type SummonersRiftState,
} from "./engine";

function monster(threat: number, copy = 0): MonsterCard {
  return { id: `${threat}-${copy}`, threat };
}

function makePlayer(seat: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { seat, successTokens: 0, failureTokens: 0, eliminated: false, passed: false, hiddenCardCount: 0, removedItemIds: [], ...overrides };
}

function makeState(overrides: Partial<SummonersRiftState> = {}): SummonersRiftState {
  const players: PlayerState[] = [makePlayer(0), makePlayer(1), makePlayer(2)];
  return {
    playerCount: 3,
    players,
    roundNumber: 1,
    equippedItemIds: [1, 2, 3, 4, 5, 6],
    deck: buildMonsterDeck(),
    riftPile: [],
    pendingDraw: null,
    activeSeat: 0,
    roundStartSeat: 0,
    challengerSeat: null,
    totalHp: null,
    currentHp: null,
    spatulaDeclaredThreat: null,
    combatLog: [],
    lastRoundResult: null,
    phase: "bidding",
    winnerSeat: null,
    initialSeed: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("startGame — setup", () => {
  it("builds a 13-card monster deck matching the rulebook §2-C table", () => {
    const deck = buildMonsterDeck();
    expect(deck).toHaveLength(13);
    expect(MONSTER_DECK_SIZE).toBe(13);
    expect(new Set(deck.map((c) => c.id)).size).toBe(13);
    const byThreat = (t: number) => deck.filter((c) => c.threat === t).length;
    expect(byThreat(1)).toBe(2);
    expect(byThreat(2)).toBe(2);
    expect(byThreat(3)).toBe(2);
    expect(byThreat(4)).toBe(2);
    expect(byThreat(5)).toBe(2);
    expect(byThreat(6)).toBe(1);
    expect(byThreat(7)).toBe(1);
    expect(byThreat(9)).toBe(1);
  });

  it("starts every player with 0 tokens, all 6 items equipped, and a shuffled 13-card deck", () => {
    for (const count of [MIN_PLAYERS, 3, 4, 5, MAX_PLAYERS]) {
      const state = startGame(count, 42);
      expect(state.players).toHaveLength(count);
      state.players.forEach((p) => {
        expect(p.successTokens).toBe(0);
        expect(p.failureTokens).toBe(0);
        expect(p.eliminated).toBe(false);
      });
      expect(state.equippedItemIds).toEqual([1, 2, 3, 4, 5, 6]);
      expect(state.deck).toHaveLength(13);
      expect(state.riftPile).toEqual([]);
      expect(state.phase).toBe("bidding");
      expect(state.roundNumber).toBe(1);
    }
  });

  it("rejects unsupported player counts", () => {
    expect(() => startGame(MIN_PLAYERS - 1, 1)).toThrow();
    expect(() => startGame(MAX_PLAYERS + 1, 1)).toThrow();
  });

  it("is deterministic for a fixed seed", () => {
    const a = startGame(4, 777);
    const b = startGame(4, 777);
    expect(a.deck).toEqual(b.deck);
    expect(a.activeSeat).toBe(b.activeSeat);
  });
});

// ---------------------------------------------------------------------------
// Item/monster catalog data
// ---------------------------------------------------------------------------

describe("catalog data", () => {
  it("computeTotalHp sums base HP + equipped HP-bonus items (rulebook §4 공략 수순 1)", () => {
    expect(computeTotalHp([])).toBe(BASE_HP);
    expect(computeTotalHp([1])).toBe(BASE_HP + 3); // 루비 수정
    expect(computeTotalHp([2])).toBe(BASE_HP + 5); // 자벨
    expect(computeTotalHp([1, 2])).toBe(BASE_HP + 3 + 5);
    expect(computeTotalHp([1, 2, 3, 4, 5, 6])).toBe(BASE_HP + 3 + 5); // 3/4/5/6 grant no HP
  });

  it("findKiller matches the rulebook §2-B/§2-C item-vs-monster table", () => {
    // 시비르 스펠쉴드 (3) kills 제드(2)/블라디(4)/사신카서스(6)
    expect(findKiller([3], null, 2)).toEqual({ itemId: 3 });
    expect(findKiller([3], null, 4)).toEqual({ itemId: 3 });
    expect(findKiller([3], null, 6)).toEqual({ itemId: 3 });
    expect(findKiller([3], null, 1)).toBeNull();
    // 람머스 웅크리기 (4) kills 대포미니언(1)/제드(2)/사이온(3)
    expect(findKiller([4], null, 1)).toEqual({ itemId: 4 });
    expect(findKiller([4], null, 3)).toEqual({ itemId: 4 });
    expect(findKiller([4], null, 5)).toBeNull();
    // 강타 (6) kills only 장로드래곤(9)
    expect(findKiller([6], null, 9)).toEqual({ itemId: 6 });
    expect(findKiller([6], null, 7)).toBeNull();
    // 황금 뒤집개 (5) kills whatever was declared, only while still equipped
    expect(findKiller([5], 7, 7)).toEqual({ spatula: true });
    expect(findKiller([5], 7, 9)).toBeNull();
    expect(findKiller([], 7, 7)).toBeNull(); // spatula unequipped -> no longer works even if "declared"
  });

  it("every ITEM_CATALOG/MONSTER_CATALOG entry from the rulebook is present", () => {
    expect(ITEM_CATALOG).toHaveLength(6);
    expect(MONSTER_CATALOG).toHaveLength(8);
    expect(getItemDef(5).isGoldenSpatula).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1. Turn progression — draw+push vs draw+unequip
// ---------------------------------------------------------------------------

describe("bidding turn — draw a card, then choose push-to-rift or remove-item", () => {
  it("drawCard pops the deck top into pendingDraw and locks the turn to that seat", () => {
    const state = makeState({ deck: [monster(9), monster(1)] });
    const next = applyAction(state, { type: "drawCard", seat: 0 });
    expect(next.pendingDraw).toEqual({ seat: 0, card: monster(9) });
    expect(next.deck).toEqual([monster(1)]);
    expect(next.activeSeat).toBe(0);
  });

  it("a second drawCard before resolving the first is a no-op", () => {
    const state = makeState({ deck: [monster(9), monster(1)] });
    const drawn = applyAction(state, { type: "drawCard", seat: 0 });
    const again = applyAction(drawn, { type: "drawCard", seat: 0 });
    expect(again).toBe(drawn);
  });

  it("pushToRift places the drawn card face-down on TOP of the Rift pile and advances to the next seat", () => {
    const state = makeState({ deck: [monster(7)], pendingDraw: { seat: 0, card: monster(7) } });
    const next = applyAction(state, { type: "pushToRift", seat: 0 });
    expect(next.riftPile).toEqual([monster(7)]);
    expect(next.pendingDraw).toBeNull();
    expect(next.activeSeat).toBe(1);
  });

  it("pushing a second card stacks it on top (revealed first later — LIFO)", () => {
    let state = makeState({ riftPile: [monster(1)], pendingDraw: { seat: 1, card: monster(9) } });
    state = applyAction(state, { type: "pushToRift", seat: 1 });
    expect(state.riftPile).toEqual([monster(9), monster(1)]);
  });

  it("removeItem strips the item from the shared champion, hides the drawn card instead of ritfing it, and advances the turn", () => {
    const state = makeState({ pendingDraw: { seat: 0, card: monster(9) } });
    const next = applyAction(state, { type: "removeItem", seat: 0, itemId: 6 });
    expect(next.equippedItemIds).toEqual([1, 2, 3, 4, 5]);
    expect(next.riftPile).toEqual([]); // the drawn card never enters the rift pile
    expect(next.pendingDraw).toBeNull();
    expect(next.players.find((p) => p.seat === 0)!.hiddenCardCount).toBe(1);
    expect(next.players.find((p) => p.seat === 0)!.removedItemIds).toEqual([6]);
    expect(next.activeSeat).toBe(1);
  });

  it("removeItem appends to removedItemIds in removal order across multiple draws by the same seat", () => {
    let state = makeState({ pendingDraw: { seat: 0, card: monster(9) } });
    state = applyAction(state, { type: "removeItem", seat: 0, itemId: 6 });
    state = { ...state, activeSeat: 0, pendingDraw: { seat: 0, card: monster(1) } };
    state = applyAction(state, { type: "removeItem", seat: 0, itemId: 3 });
    expect(state.players.find((p) => p.seat === 0)!.removedItemIds).toEqual([6, 3]);
    expect(state.players.find((p) => p.seat === 0)!.hiddenCardCount).toBe(2);
  });

  it("removeItem rejects an item that's already been removed", () => {
    const state = makeState({ equippedItemIds: [1, 2, 3, 4, 5], pendingDraw: { seat: 0, card: monster(1) } });
    const next = applyAction(state, { type: "removeItem", seat: 0, itemId: 6 });
    expect(next).toBe(state);
  });

  it("pushToRift/removeItem reject a seat that isn't the one holding the pending draw", () => {
    const state = makeState({ pendingDraw: { seat: 0, card: monster(1) } });
    expect(applyAction(state, { type: "pushToRift", seat: 1 })).toBe(state);
    expect(applyAction(state, { type: "removeItem", seat: 1, itemId: 6 })).toBe(state);
  });

  it("drawCard is illegal once the deck is empty (rulebook §4 옵션 B 주의)", () => {
    const state = makeState({ deck: [] });
    const next = applyAction(state, { type: "drawCard", seat: 0 });
    expect(next).toBe(state);
  });

  it("turn order skips eliminated seats", () => {
    const state = makeState({
      players: [makePlayer(0), makePlayer(1, { eliminated: true }), makePlayer(2)],
      pendingDraw: { seat: 0, card: monster(1) },
    });
    const next = applyAction(state, { type: "pushToRift", seat: 0 });
    expect(next.activeSeat).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Pass handling & last-one-standing -> dungeon entry
// ---------------------------------------------------------------------------

describe("pass — bows out of the round; last unpassed seat becomes the challenger", () => {
  it("a pass with 3+ unpassed seats just advances the turn", () => {
    const state = makeState();
    const next = applyAction(state, { type: "pass", seat: 0 });
    expect(next.players.find((p) => p.seat === 0)!.passed).toBe(true);
    expect(next.phase).toBe("bidding");
    expect(next.activeSeat).toBe(1);
  });

  it("passing twice, or while holding a pending draw, is a no-op", () => {
    const passed = applyAction(makeState(), { type: "pass", seat: 0 });
    expect(applyAction(passed, { type: "pass", seat: 0 })).toBe(passed);

    const holding = makeState({ pendingDraw: { seat: 0, card: monster(1) } });
    expect(applyAction(holding, { type: "pass", seat: 0 })).toBe(holding);
  });

  it("the last remaining unpassed player is forced into the dungeon phase the instant the second-to-last passes", () => {
    let state = makeState({ riftPile: [monster(9)] });
    state = applyAction(state, { type: "pass", seat: 0 });
    expect(state.phase).toBe("bidding");
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.phase).not.toBe("bidding");
    expect(state.challengerSeat).toBe(2);
    expect(state.activeSeat).toBe(2);
  });

  it("with the golden spatula still equipped and a non-empty rift pile, dungeon entry pauses at declaringSpatula", () => {
    let state = makeState({ riftPile: [monster(7)], equippedItemIds: [1, 2, 3, 4, 5, 6] });
    state = applyAction(state, { type: "pass", seat: 0 });
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.phase).toBe("declaringSpatula");
    expect(state.totalHp).toBe(computeTotalHp([1, 2, 3, 4, 5, 6]));
  });

  it("without the golden spatula equipped, dungeon entry skips straight to resolvingRift", () => {
    let state = makeState({ riftPile: [monster(7)], equippedItemIds: [1, 2, 3, 4, 6] });
    state = applyAction(state, { type: "pass", seat: 0 });
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.phase).toBe("resolvingRift");
  });

  it("an empty rift pile clears instantly as a success without any declare/reveal step", () => {
    let state = makeState({ riftPile: [] });
    state = applyAction(state, { type: "pass", seat: 0 });
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.phase).not.toBe("gameOver"); // only 1 success so far, game continues
    expect(state.lastRoundResult?.outcome).toBe("success");
    expect(state.players.find((p) => p.seat === 2)!.successTokens).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Battle resolution engine
// ---------------------------------------------------------------------------

describe("declareSpatula + revealNextMonster — combat resolution", () => {
  function inDungeon(overrides: Partial<SummonersRiftState> = {}): SummonersRiftState {
    return makeState({
      phase: "resolvingRift",
      challengerSeat: 2,
      activeSeat: 2,
      totalHp: BASE_HP,
      currentHp: BASE_HP,
      riftPile: [],
      combatLog: [],
      ...overrides,
    });
  }

  it("declareSpatula only accepts the challenger, during declaringSpatula, targeting a real monster threat", () => {
    const state = makeState({ phase: "declaringSpatula", challengerSeat: 2, activeSeat: 2 });
    expect(applyAction(state, { type: "declareSpatula", seat: 0, monsterThreat: 9 })).toBe(state); // wrong seat
    expect(applyAction(state, { type: "declareSpatula", seat: 2, monsterThreat: 8 })).toBe(state); // no threat=8 monster
    const declared = applyAction(state, { type: "declareSpatula", seat: 2, monsterThreat: 9 });
    expect(declared.spatulaDeclaredThreat).toBe(9);
    expect(declared.phase).toBe("resolvingRift");
  });

  // Each of these three leaves a second monster in the pile after the reveal
  // under test, so the round doesn't auto-complete (and dealRound reset the
  // live combat fields, see finishRound) before we can inspect the result.

  it("an item that can kill the revealed monster prevents all damage", () => {
    const state = inDungeon({ equippedItemIds: [6], riftPile: [monster(9), monster(1)] }); // 강타 kills 장로드래곤
    const next = applyAction(state, { type: "revealNextMonster", seat: 2 });
    expect(next.combatLog[0].killedBy).toEqual({ itemId: 6 });
    expect(next.combatLog[0].damageTaken).toBe(0);
    expect(next.currentHp).toBe(BASE_HP);
    expect(next.phase).toBe("resolvingRift");
  });

  it("a declared golden-spatula target kills that monster on sight", () => {
    const state = inDungeon({ equippedItemIds: [5], spatulaDeclaredThreat: 7, riftPile: [monster(7), monster(1)] });
    const next = applyAction(state, { type: "revealNextMonster", seat: 2 });
    expect(next.combatLog[0].killedBy).toEqual({ spatula: true });
    expect(next.currentHp).toBe(BASE_HP);
  });

  it("no matching item/spatula means the champion takes damage equal to the monster's threat", () => {
    const state = inDungeon({ equippedItemIds: [], riftPile: [monster(5), monster(1)], totalHp: 8, currentHp: 8 });
    const next = applyAction(state, { type: "revealNextMonster", seat: 2 });
    expect(next.combatLog[0].killedBy).toBeNull();
    expect(next.combatLog[0].damageTaken).toBe(5);
    expect(next.currentHp).toBe(3);
    expect(next.phase).toBe("resolvingRift"); // one monster still left in the pile
  });

  it("reveals proceed top-of-pile first and clearing every monster while HP >= 1 finishes as a success", () => {
    const state = inDungeon({ equippedItemIds: [1, 2], totalHp: 8, currentHp: 8, riftPile: [monster(1), monster(2)] });
    const afterFirst = applyAction(state, { type: "revealNextMonster", seat: 2 });
    expect(afterFirst.combatLog[0].monster).toEqual(monster(1)); // pile[0] (top) revealed first
    expect(afterFirst.currentHp).toBe(7);
    const afterSecond = applyAction(afterFirst, { type: "revealNextMonster", seat: 2 });
    expect(afterSecond.riftPile).toEqual([]);
    expect(afterSecond.lastRoundResult?.outcome).toBe("success");
    expect(afterSecond.players.find((p) => p.seat === 2)!.successTokens).toBe(1);
  });

  it("HP dropping to 0 or below stops the challenge immediately as a failure, without revealing the remaining pile", () => {
    // Round-ending reveals feed a fresh `dealRound` right away (same
    // auto-continue pattern as five-cucumbers' final trick — see
    // engine.ts's `finishRound`), which resets the live combat fields for
    // the *next* round. What this reveal actually produced survives only in
    // `lastRoundResult`, so that's what's asserted here (not `next.currentHp`
    // /`next.combatLog`, which by now describe round 2's blank slate).
    const state = inDungeon({ equippedItemIds: [], totalHp: 3, currentHp: 3, riftPile: [monster(5), monster(9)] });
    const next = applyAction(state, { type: "revealNextMonster", seat: 2 });
    expect(next.lastRoundResult?.outcome).toBe("failure");
    expect(next.lastRoundResult?.combatLog).toHaveLength(1); // 장로드래곤(9) never got revealed
    expect(next.lastRoundResult?.combatLog[0].hpAfter).toBe(-2);
    expect(next.players.find((p) => p.seat === 2)!.failureTokens).toBe(1);
  });

  it("lastRoundResult snapshots finalHp and each seat's removed items, since the next dealRound resets player.removedItemIds", () => {
    const state = inDungeon({
      equippedItemIds: [1],
      totalHp: 6,
      currentHp: 6,
      riftPile: [monster(5)],
      players: [makePlayer(0, { removedItemIds: [2, 3] }), makePlayer(1), makePlayer(2, { removedItemIds: [4] })],
    });
    const next = applyAction(state, { type: "revealNextMonster", seat: 2 });
    expect(next.lastRoundResult?.finalHp).toBe(1); // 6 - 5, and the pile is now empty so the round finishes as a success
    expect(next.lastRoundResult?.outcome).toBe("success");
    expect(next.lastRoundResult?.removedByPlayer).toEqual([
      { seat: 0, itemIds: [2, 3] },
      { seat: 2, itemIds: [4] },
    ]);
    // The very next `dealRound` (triggered by this same action, since the
    // round ended) already wiped every active seat's live `removedItemIds` —
    // confirming `lastRoundResult.removedByPlayer` above is the only place
    // this round's removals survive.
    expect(next.players.every((p) => p.removedItemIds.length === 0)).toBe(true);
  });

  it("an empty rift pile clear's lastRoundResult.finalHp equals totalHp (no combat happened)", () => {
    let state = makeState({ riftPile: [] });
    state = applyAction(state, { type: "pass", seat: 0 });
    state = applyAction(state, { type: "pass", seat: 1 });
    expect(state.lastRoundResult?.finalHp).toBe(state.lastRoundResult?.totalHp);
  });

  it("only the challenger seat may reveal", () => {
    const state = inDungeon({ riftPile: [monster(1)] });
    expect(applyAction(state, { type: "revealNextMonster", seat: 0 })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 4. Win / elimination conditions
// ---------------------------------------------------------------------------

describe("victory and elimination (rulebook §5)", () => {
  it(`reaching ${SUCCESS_TOKENS_TO_WIN} success tokens wins immediately`, () => {
    const state = makeState({
      phase: "resolvingRift",
      challengerSeat: 1,
      activeSeat: 1,
      totalHp: 3,
      currentHp: 3,
      riftPile: [monster(1)],
      equippedItemIds: [4], // kills the 대포미니언 for free
      players: [makePlayer(0), makePlayer(1, { successTokens: 1 }), makePlayer(2)],
    });
    const next = applyAction(state, { type: "revealNextMonster", seat: 1 });
    expect(next.phase).toBe("gameOver");
    expect(next.winnerSeat).toBe(1);
    expect(next.players.find((p) => p.seat === 1)!.successTokens).toBe(2);
  });

  it(`reaching ${FAILURE_TOKENS_TO_ELIMINATE} failure tokens eliminates a player but the game continues if others remain`, () => {
    const state = makeState({
      phase: "resolvingRift",
      challengerSeat: 1,
      activeSeat: 1,
      totalHp: 1,
      currentHp: 1,
      riftPile: [monster(9)],
      equippedItemIds: [],
      players: [makePlayer(0), makePlayer(1, { failureTokens: 1 }), makePlayer(2)],
    });
    const next = applyAction(state, { type: "revealNextMonster", seat: 1 });
    const loser = next.players.find((p) => p.seat === 1)!;
    expect(loser.failureTokens).toBe(2);
    expect(loser.eliminated).toBe(true);
    expect(next.phase).not.toBe("gameOver"); // seats 0 and 2 are still in it
    expect(next.roundNumber).toBe(2); // auto-dealt the next round
  });

  it("last-survivor victory: eliminating the second-to-last remaining opponent hands the win to whoever is left", () => {
    // Seats: 0 already eliminated, 1 is about to fail out, 2 is the only
    // one who'll still be standing afterwards.
    const state = makeState({
      phase: "resolvingRift",
      challengerSeat: 1,
      activeSeat: 1,
      totalHp: 1,
      currentHp: 1,
      riftPile: [monster(9)],
      equippedItemIds: [],
      players: [makePlayer(0, { eliminated: true, failureTokens: 2 }), makePlayer(1, { failureTokens: 1 }), makePlayer(2)],
    });
    const next = applyAction(state, { type: "revealNextMonster", seat: 1 });
    expect(next.players.find((p) => p.seat === 1)!.eliminated).toBe(true);
    expect(next.phase).toBe("gameOver");
    expect(next.winnerSeat).toBe(2);
  });

  it("computeRankings ranks the winner 1st alone, then the rest by success/failure score", () => {
    const state = makeState({
      phase: "gameOver",
      winnerSeat: 2,
      players: [makePlayer(0, { successTokens: 1, failureTokens: 2, eliminated: true }), makePlayer(1, { failureTokens: 1 }), makePlayer(2, { successTokens: 2 })],
    });
    const ranked = computeRankings(state);
    expect(ranked.find((r) => r.seat === 2)!.rank).toBe(1);
    // seat 0 (score 1*10-2=8) outranks seat 1 (score 0*10-1=-1)
    expect(ranked.find((r) => r.seat === 0)!.rank).toBe(2);
    expect(ranked.find((r) => r.seat === 1)!.rank).toBe(3);
  });

  it("computeRankings is empty until the game is actually over", () => {
    expect(computeRankings(makeState({ phase: "bidding" }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end wiring: startGame -> full round -> next round dealt correctly
// ---------------------------------------------------------------------------

describe("end-to-end round wiring", () => {
  it("a full 3-player round (draw/push/pass down to 1 challenger, then clear the rift) deals a fresh round with items re-equipped", () => {
    let state = startGame(3, 5);
    const startSeat = state.activeSeat;
    const others = [0, 1, 2].filter((s) => s !== startSeat);

    // Starting seat pushes one monster into the rift, then everyone else passes.
    state = applyAction(state, { type: "drawCard", seat: startSeat });
    state = applyAction(state, { type: "pushToRift", seat: startSeat });
    state = applyAction(state, { type: "pass", seat: state.activeSeat });
    state = applyAction(state, { type: "pass", seat: state.activeSeat });

    expect(state.challengerSeat).toBe(startSeat);
    expect(["declaringSpatula", "resolvingRift"]).toContain(state.phase);
    if (state.phase === "declaringSpatula") {
      state = applyAction(state, { type: "declareSpatula", seat: startSeat, monsterThreat: 1 });
    }
    // Resolve whatever ended up in the rift pile (exactly the one card pushed above).
    while (state.phase === "resolvingRift" && state.riftPile.length > 0) {
      state = applyAction(state, { type: "revealNextMonster", seat: startSeat });
    }

    expect(state.lastRoundResult).not.toBeNull();
    expect(state.phase).toBe("bidding"); // round 2 dealt (nobody hit 2 successes/failures yet)
    expect(state.roundNumber).toBe(2);
    expect(state.equippedItemIds).toEqual([1, 2, 3, 4, 5, 6]); // re-equipped
    expect(state.deck).toHaveLength(13); // fresh shuffled deck
    expect(state.riftPile).toEqual([]);
    expect(others.every((s) => state.players.find((p) => p.seat === s)!.passed === false)).toBe(true);
    expect(state.players.every((p) => p.removedItemIds.length === 0)).toBe(true); // cleared for the new round
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty)
// ---------------------------------------------------------------------------

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("bidding, no pending draw: offers pass + drawCard (deck non-empty), and nothing for a non-active seat", () => {
    const state = makeState({ activeSeat: 0 });
    const moves = getValidMoves(state, 0);
    expect(moves).toContainEqual({ type: "pass", seat: 0 });
    expect(moves).toContainEqual({ type: "drawCard", seat: 0 });
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("bidding, no pending draw, empty deck: only pass is offered", () => {
    const state = makeState({ activeSeat: 0, deck: [] });
    expect(getValidMoves(state, 0)).toEqual([{ type: "pass", seat: 0 }]);
  });

  it("bidding, pending draw: offers pushToRift + one removeItem per equipped item, only to the drawing seat", () => {
    const state = makeState({ activeSeat: 0, pendingDraw: { seat: 0, card: monster(5) }, equippedItemIds: [1, 3] });
    const moves = getValidMoves(state, 0);
    expect(moves).toEqual([
      { type: "pushToRift", seat: 0 },
      { type: "removeItem", seat: 0, itemId: 1 },
      { type: "removeItem", seat: 0, itemId: 3 },
    ]);
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("declaringSpatula: offers one declareSpatula per monster type, only to the challenger", () => {
    const state = makeState({ phase: "declaringSpatula", challengerSeat: 1, activeSeat: 1 });
    expect(getValidMoves(state, 1)).toHaveLength(MONSTER_CATALOG.length);
    expect(getValidMoves(state, 0)).toEqual([]);
  });

  it("resolvingRift: offers revealNextMonster only to the challenger while the pile isn't empty", () => {
    const state = makeState({
      phase: "resolvingRift",
      challengerSeat: 1,
      activeSeat: 1,
      totalHp: 5,
      currentHp: 5,
      riftPile: [monster(2)],
    });
    expect(getValidMoves(state, 1)).toEqual([{ type: "revealNextMonster", seat: 1 }]);
    expect(getValidMoves(state, 0)).toEqual([]);
    expect(getValidMoves({ ...state, riftPile: [] }, 1)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat with nothing to decide", () => {
    const state = makeState({ activeSeat: 0 });
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("always returns a legal move regardless of level", () => {
    const state = makeState({ activeSeat: 0, pendingDraw: { seat: 0, card: monster(5) } });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) can feed an unmitigated threat-9 monster straight into the pile, while Level 10 strips a cheap item to hide it instead", () => {
    // No item covers threat 9 here (강타/item 6 is unequipped), so pushing it
    // is a straight loss of a scary card into the shared pile; stripping the
    // cheapest item (루비, only +3 HP, no kill coverage) to hide it entirely
    // is the clearly better play.
    const state = makeState({
      activeSeat: 0,
      pendingDraw: { seat: 0, card: monster(9) },
      equippedItemIds: [1, 2, 3, 4],
    });

    expect(getValidMoves(state, 0)).toEqual([
      { type: "pushToRift", seat: 0 },
      { type: "removeItem", seat: 0, itemId: 1 },
      { type: "removeItem", seat: 0, itemId: 2 },
      { type: "removeItem", seat: 0, itemId: 3 },
      { type: "removeItem", seat: 0, itemId: 4 },
    ]);

    // rng() always 0 -> always below Level 1's mistake chance -> candidates[0].
    const level1Action = chooseBotAction(state, 0, 1, () => 0);
    expect(level1Action).toEqual({ type: "pushToRift", seat: 0 });

    // Level 10 has 0% mistake chance -> true argmax -> strip item 1 (루비).
    const level10Action = chooseBotAction(state, 0, 10, () => 0);
    expect(level10Action).toEqual({ type: "removeItem", seat: 0, itemId: 1 });
  });
});

function playFullBotGame(playerCount: number, seed: number, levelOf: (seat: SeatIndex) => number): SummonersRiftState {
  let state = startGame(playerCount, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 5000) {
    guard++;
    let acted = false;
    for (let seat = 0; seat < playerCount; seat++) {
      const action = chooseBotAction(state, seat, levelOf(seat));
      if (action) {
        state = applyAction(state, action);
        acted = true;
        break;
      }
    }
    if (!acted) break; // safety valve — should be unreachable while the game hasn't ended
  }
  return state;
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`completes a ${n}-player all-Level-10 game with every seat ranked`, () => {
      const state = playFullBotGame(n, 300 + n, () => 10);
      expect(state.phase).toBe("gameOver");
      const rankings = computeRankings(state);
      expect(rankings).toHaveLength(n);
      expect(new Set(rankings.map((r) => r.seat)).size).toBe(n);
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(4, 888, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(computeRankings(state)).toHaveLength(4);
  });
});
