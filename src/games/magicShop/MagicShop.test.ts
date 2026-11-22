import { describe, expect, it } from "vitest";
import { cid, ORDERS, STARTER, WEB } from "./cards";
import {
  allCards,
  applyAction,
  bestFulfilSet,
  computeRankings,
  FAME_GOAL,
  HAND_SIZE,
  isLegal,
  PATIENCE,
  SEAT_HEADSTART,
  startGame,
  WEB_SUPPLY,
  type EngineAction,
  type MagicState,
} from "./engine";
import { chooseBotAction } from "./bot";
import { playOut } from "./selfPlay";

/** A state where seat 0 holds exactly `hand` (rest of the starter in the deck). */
function withHand(hand: number[], players = 2, seed = 1): MagicState {
  const s = structuredClone(startGame(players, seed));
  s.players[0].deck = [...STARTER];
  s.players[0].discard = [];
  s.players[0].hand = [...hand];
  return s;
}
const A = (s: MagicState, a: Partial<EngineAction> & { type: EngineAction["type"] }) => applyAction(s, { seat: s.active, turn: s.turn, ...a } as EngineAction);

describe("마법 상점 engine", () => {
  it("deals 10 starter cards, 5 in hand, and later seats get a 🧪 head start", () => {
    for (const n of [2, 3, 4]) {
      const s = startGame(n, 42);
      expect(s.players).toHaveLength(n);
      for (const p of s.players) {
        expect(allCards(p).sort()).toEqual([...STARTER].sort());
        expect(p.hand).toHaveLength(HAND_SIZE);
      }
      expect(s.goal).toBe(FAME_GOAL[n]);
      expect(s.webs).toBe(WEB_SUPPLY[n]);
      expect(s.shop.every((x) => x !== null)).toBe(true);
      expect(s.orders.every((x) => x !== null)).toBe(true);
      for (let seat = 1; seat < n; seat++) expect(s.players[seat].stored).toEqual(SEAT_HEADSTART[n][seat]);
      expect(s.pool.els).toEqual([0, 0, 0, 0]);
    }
  });

  it("is deterministic for a seed (same bot game twice)", () => {
    const a = playOut([5, 5, 5], 777).state;
    const b = playOut([5, 5, 5], 777).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("playing a card adds its 🪙/elements and rejects a stale double tap", () => {
    let s = withHand([cid("coin"), cid("candle"), cid("coin")]);
    s = A(s, { type: "play", idx: 1, card: cid("candle") });
    expect(s.pool.els[0]).toBe(2);
    // second tap on the same index now points at a coin, not the candle
    const again = A(s, { type: "play", idx: 1, card: cid("candle") });
    expect(again).toBe(s);
    s = A(s, { type: "playAll" });
    expect(s.pool.gold).toBe(2);
    expect(s.players[0].hand).toEqual([]);
  });

  it("buying puts the card in the discard pile, refills the shelf slot and guards the slot's card", () => {
    let s = withHand([cid("coin"), cid("coin"), cid("coin")]);
    s.shop[0] = cid("candle");
    s = A(s, { type: "playAll" });
    const next = s.shopDeck[s.shopDeck.length - 1];
    s = A(s, { type: "buy", src: "shop", slot: 0, card: cid("candle") });
    expect(s.players[0].discard).toContain(cid("candle"));
    expect(s.pool.gold).toBe(1);
    expect(s.shop[0]).toBe(next);
    expect(isLegal(s, { type: "buy", seat: 0, turn: s.turn, src: "shop", slot: 0, card: cid("candle") })).toBe(false);
    // counter cards are always there
    const t = A(s, { type: "buy", src: "supply", slot: cid("silver"), card: cid("silver") });
    expect(t).toBe(s); // only 🪙1 left
  });

  it("fulfilling pays the elements, gives 명성 and the 🎁 bonus", () => {
    let s = withHand([cid("candle"), cid("candle"), cid("mushroom")]);
    const forge = ORDERS.findIndex((o) => o.potion === "용광로 불씨"); // 🔥3 → 3 + flask
    s.orders[0] = forge;
    s = A(s, { type: "playAll" });
    expect(bestFulfilSet(s.pool, s.orders)).toContain(0);
    s = A(s, { type: "fulfil", slot: 0, order: forge });
    expect(s.players[0].fame).toBe(3);
    expect(s.players[0].flask).toBe(2);
    expect(s.pool.els).toEqual([1, 0, 2, 0]);
    expect(s.orders[0]).not.toBe(forge);
  });

  it("🔄 costs 🪙1, once per turn, and sends the order to the bottom", () => {
    let s = withHand([cid("coin"), cid("coin")]);
    s = A(s, { type: "playAll" });
    const old = s.orders[1]!;
    s = A(s, { type: "reroll", slot: 1, order: old });
    expect(s.orderDeck[0]).toBe(old);
    expect(s.pool.gold).toBe(1);
    expect(A(s, { type: "reroll", slot: 0, order: s.orders[0]! })).toBe(s);
  });

  it("🧹 trashing blocks everything else until chosen, and removes cards from the game", () => {
    let s = withHand([cid("broom"), cid("coin"), WEB, cid("coin")]);
    s = A(s, { type: "play", idx: 0, card: cid("broom") });
    expect(s.pending?.max).toBe(2);
    expect(A(s, { type: "playAll" })).toBe(s);
    s = A(s, { type: "trash", idxs: [1, 0, 2] }); // only 2 allowed
    expect(s.pending).toBeNull();
    expect(s.players[0].trashed).toBe(2);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it("🪞 repeats the card played just before it", () => {
    let s = withHand([cid("dragon"), cid("mirror")]);
    s = A(s, { type: "play", idx: 0, card: cid("dragon") });
    s = A(s, { type: "play", idx: 0, card: cid("mirror") });
    expect(s.pool.els).toEqual([4, 0, 0, 2]);
    // a mirror first does nothing
    let t = withHand([cid("mirror")]);
    t = A(t, { type: "play", idx: 0, card: cid("mirror") });
    expect(t.pool).toEqual({ gold: 0, els: [0, 0, 0, 0] });
  });

  it("🐈‍⬛ gives every other player a 🕸️ while the supply lasts, and 🕸️ costs 1 at the end", () => {
    let s = withHand([cid("cat")], 3);
    s.webs = 1;
    s = A(s, { type: "play", idx: 0, card: cid("cat") });
    expect(s.players[1].discard).toContain(WEB);
    expect(s.players[2].discard).not.toContain(WEB);
    expect(s.webs).toBe(0);
    expect(s.pool.gold).toBe(2);
  });

  it("🧪 keeps at most flask-size elements into the next own turn", () => {
    let s = withHand([cid("candle"), cid("mushroom")]);
    s = A(s, { type: "playAll" });
    expect(isLegal(s, { type: "end", seat: 0, turn: s.turn, store: [1, 0, 1, 0] })).toBe(false);
    s = A(s, { type: "end", store: [0, 0, 1, 0] });
    expect(s.active).toBe(1);
    expect(s.players[0].stored).toEqual([0, 0, 1, 0]);
    expect(s.pool.els).toEqual(SEAT_HEADSTART[2][1]);
    expect(s.players[0].hand).toHaveLength(HAND_SIZE);
    s = A(s, { type: "end", store: [0, 0, 0, 0] });
    expect(s.pool.els).toEqual([0, 0, 1, 0]);
  });

  it("customers leave after PATIENCE rounds", () => {
    let s = startGame(2, 5);
    const first = s.orders[2];
    for (let r = 0; r < PATIENCE * 2; r++) s = A(s, { type: "end", store: [0, 0, 0, 0] });
    expect(s.orders[2]).not.toBe(first);
    expect(s.log.some((e) => e.kind === "leave")).toBe(true);
  });

  it("reaching the goal finishes the round so everyone gets the same number of turns", () => {
    let s = startGame(3, 9);
    s = structuredClone(s);
    s.active = 1;
    s.players[1].fame = s.goal;
    s = applyAction(s, { type: "end", seat: 1, turn: s.turn, store: [0, 0, 0, 0] });
    expect(s.phase).toBe("playing");
    expect(s.finalRound).toBe(true);
    s = A(s, { type: "end", store: [0, 0, 0, 0] });
    expect(s.phase).toBe("gameOver");
    expect(computeRankings(s)[0].seat).toBe(1);
  });

  it("ties go to more orders, then fewer cards", () => {
    let s = structuredClone(startGame(2, 3));
    s.players[0].fame = 10;
    s.players[1].fame = 10;
    s.players[1].orders = [1, 2];
    s.players[0].orders = [3, 4];
    s.players[0].discard.push(cid("silver"));
    s.finalRound = true;
    s.active = 1;
    s = applyAction(s, { type: "end", seat: 1, turn: s.turn, store: [0, 0, 0, 0] });
    const r = computeRankings(s);
    expect(r[0]).toMatchObject({ seat: 1, rank: 1 });
    expect(r[1].rank).toBe(2);
  });

  it("a time-out plays the simple cards, fills what it can and passes the turn", () => {
    let s = withHand([cid("candle"), cid("candle"), cid("mushroom")]);
    const forge = ORDERS.findIndex((o) => o.potion === "용광로 불씨");
    s.orders[1] = forge;
    s = A(s, { type: "timeout" });
    expect(s.players[0].fame).toBe(3);
    expect(s.active).toBe(1);
    expect(s.log.some((e) => e.kind === "timeout")).toBe(true);
  });

  it("bots finish every player count without an illegal move", () => {
    for (const n of [2, 3, 4]) {
      for (let g = 0; g < 4; g++) {
        const { state } = playOut(Array.from({ length: n }, (_, i) => 1 + ((i * 3 + g * 4) % 10)), 300 + g * 7 + n);
        expect(state.phase).toBe("gameOver");
        expect(Math.max(...state.players.map((p) => p.fame))).toBeGreaterThan(0);
      }
    }
  });

  it("bot never returns an illegal action mid-turn", () => {
    let s = startGame(4, 11);
    for (let i = 0; i < 300 && s.phase === "playing"; i++) {
      const a = chooseBotAction(s, s.active, (i % 10) + 1)!;
      expect(isLegal(s, a)).toBe(true);
      s = applyAction(s, a);
    }
  });
});
