import { describe, expect, it } from "vitest";
import { createDevelopmentDeck } from "./cards";
import {
  allSelections,
  applyAction,
  checkVictory,
  chooseBotAction,
  effectiveCost,
  getValidMoves,
  isValidSelection,
  prestigeOf,
  selectionGivesPrivilege,
  SPIRAL_ORDER,
  startGame,
  TOTAL_SCROLLS,
  totalGold,
  GOLD_SUPPLY,
  type BoardToken,
  type DuelCard,
  type OwnedCard,
  type PlayerState,
  type SplendorDuelState,
} from "./engine";

const idx = (r: number, c: number) => r * 5 + c;

function fullGrid(token: BoardToken = "white"): (BoardToken | null)[] {
  return Array(25).fill(token);
}

function owned(card: Partial<DuelCard> & { color: DuelCard["color"] }, boundColor = card.color): OwnedCard {
  return { id: `t-${Math.random()}`, level: 1, points: 0, crowns: 0, bonus: 1, cost: {}, ...card, boundColor } as OwnedCard;
}

function scrollTotal(s: SplendorDuelState) {
  return s.tableScrolls + s.players.p1.scrolls + s.players.p2.scrolls;
}

describe("setup", () => {
  it("builds the documented 30/24/13 deck and a spiral-filled board with 3 empty cells", () => {
    const deck = createDevelopmentDeck();
    expect(deck.filter((c) => c.level === 1)).toHaveLength(30);
    expect(deck.filter((c) => c.level === 2)).toHaveLength(24);
    expect(deck.filter((c) => c.level === 3)).toHaveLength(13);
    expect(new Set(deck.map((c) => c.id)).size).toBe(67);

    const s = startGame(42);
    expect(s.grid.filter((t) => t !== null)).toHaveLength(22);
    expect(s.grid.filter((t) => t === "pearl")).toHaveLength(2);
    // The last 3 spiral positions are the empty ones.
    expect(SPIRAL_ORDER.slice(22).every((i) => s.grid[i] === null)).toBe(true);
    expect(s.bag).toHaveLength(0);
    expect(s.goldSupply).toBe(3);
    expect(s.players.p2.scrolls).toBe(1);
    expect(s.tableScrolls).toBe(2);
    expect(s.market[1]).toHaveLength(5);
    expect(s.market[2]).toHaveLength(4);
    expect(s.market[3]).toHaveLength(3);
  });

  it("is deterministic per seed", () => {
    expect(startGame(7)).toEqual(startGame(7));
  });
});

describe("token selection", () => {
  const grid = fullGrid();
  it("accepts horizontal, vertical and both diagonals of 1-3", () => {
    expect(isValidSelection([idx(2, 2)], grid)).toBe(true);
    expect(isValidSelection([idx(0, 0), idx(0, 1), idx(0, 2)], grid)).toBe(true);
    expect(isValidSelection([idx(1, 3), idx(2, 3), idx(3, 3)], grid)).toBe(true);
    expect(isValidSelection([idx(0, 0), idx(1, 1), idx(2, 2)], grid)).toBe(true);
    expect(isValidSelection([idx(2, 0), idx(1, 1), idx(0, 2)], grid)).toBe(true);
    expect(isValidSelection([idx(4, 4), idx(3, 3)], grid)).toBe(true);
  });

  it("rejects gaps, bends, far cells, duplicates and more than 3", () => {
    expect(isValidSelection([idx(0, 0), idx(0, 2)], grid)).toBe(false);
    expect(isValidSelection([idx(0, 0), idx(0, 1), idx(1, 1)], grid)).toBe(false);
    expect(isValidSelection([idx(0, 0), idx(3, 3)], grid)).toBe(false);
    expect(isValidSelection([idx(0, 0), idx(0, 0)], grid)).toBe(false);
    expect(isValidSelection([idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3)], grid)).toBe(false);
    expect(isValidSelection([], grid)).toBe(false);
  });

  it("rejects a line broken by an empty cell", () => {
    const g = fullGrid();
    g[idx(0, 1)] = null;
    expect(isValidSelection([idx(0, 0), idx(0, 1), idx(0, 2)], g)).toBe(false);
    expect(isValidSelection([idx(0, 0), idx(0, 2)], g)).toBe(false);
  });

  it("flags 3 same color or 2 pearls as a privilege penalty", () => {
    const g = fullGrid("red");
    expect(selectionGivesPrivilege([0, 1, 2], g)).toBe(true);
    g[1] = "blue";
    expect(selectionGivesPrivilege([0, 1, 2], g)).toBe(false);
    g[0] = "pearl";
    g[1] = "pearl";
    expect(selectionGivesPrivilege([0, 1], g)).toBe(true);
  });
});

describe("turn actions", () => {
  it("taking 3 same color hands the opponent a scroll, stealing it when the table is empty", () => {
    let s = startGame(1);
    s = { ...s, grid: fullGrid("green"), tableScrolls: 0, players: { ...s.players, p1: { ...s.players.p1, scrolls: 2 }, p2: { ...s.players.p2, scrolls: 1 } } };
    s = applyAction(s, { type: "takeTokens", seat: "p1", cells: [0, 1, 2] });
    expect(s.players.p1.tokens.green).toBe(3);
    expect(s.players.p2.scrolls).toBe(2);
    expect(s.players.p1.scrolls).toBe(1);
    expect(scrollTotal(s)).toBe(TOTAL_SCROLLS);
    expect(s.activeSeat).toBe("p2");
  });

  it("rejects an invalid selection without changing state", () => {
    const s = startGame(1);
    const filled = SPIRAL_ORDER.slice(0, 22);
    const bad = [filled[0], filled[5], filled[10]];
    if (!isValidSelection(bad, s.grid)) expect(applyAction(s, { type: "takeTokens", seat: "p1", cells: bad })).toBe(s);
  });

  it("using a scroll takes any token and returns the scroll to the table", () => {
    let s = startGame(3);
    s = { ...s, activeSeat: "p2" };
    const cell = s.grid.findIndex((t) => t !== null);
    const token = s.grid[cell]!;
    s = applyAction(s, { type: "useScroll", seat: "p2", cell });
    expect(s.players.p2.scrolls).toBe(0);
    expect(s.tableScrolls).toBe(3);
    expect(s.players.p2.tokens[token]).toBe(1);
    expect(s.activeSeat).toBe("p2");
  });

  it("refilling the board fills empty cells from the bag and gives the opponent a scroll", () => {
    let s = startGame(5);
    s = { ...s, grid: s.grid.map((t, i) => (i < 5 ? null : t)), bag: [...s.grid.slice(0, 5).filter((t): t is BoardToken => t !== null)] };
    const bagSize = s.bag.length;
    s = applyAction(s, { type: "refillBoard", seat: "p1" });
    expect(s.bag).toHaveLength(0);
    expect(s.grid.filter((t) => t !== null)).toHaveLength(22 - (5 - bagSize) + (5 - bagSize));
    expect(s.players.p2.scrolls).toBe(2);
    expect(s.refillCount).toBe(1);
  });

  it("buys with bonus discount and gold, returning gems to the bag and gold to the stand", () => {
    let s = startGame(9);
    const card: DuelCard = { id: "test-card", level: 1, color: "red", points: 1, crowns: 0, bonus: 1, cost: { blue: 3, pearl: 1 } };
    const p1: PlayerState = { ...s.players.p1, tokens: { blue: 1, gold: 2 }, cards: [owned({ color: "blue" })] };
    s = { ...s, goldSupply: 1, market: { ...s.market, 1: [card, ...s.market[1].slice(1)] }, players: { ...s.players, p1 } };
    expect(effectiveCost(card, p1)).toEqual({ blue: 2, pearl: 1 });
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "test-card", source: "market" });
    expect(s.players.p1.cards.map((c) => c.id)).toContain("test-card");
    expect(s.players.p1.tokens.blue).toBe(0);
    expect(s.players.p1.tokens.gold).toBe(0);
    expect(s.goldSupply).toBe(3);
    expect(s.bag).toEqual(["blue"]);
    expect(s.market[1]).toHaveLength(5);
  });

  it("reserving gives gold, caps at 3, and still works with the gold stand empty", () => {
    let s = startGame(11);
    s = applyAction(s, { type: "reserveCard", seat: "p1", level: 1, marketIndex: 0 });
    expect(s.players.p1.reserved).toHaveLength(1);
    expect(s.players.p1.tokens.gold).toBe(1);
    s = { ...s, activeSeat: "p1", goldSupply: 0 };
    s = applyAction(s, { type: "reserveCard", seat: "p1", level: 2 });
    expect(s.players.p1.reserved).toHaveLength(2);
    expect(s.players.p1.tokens.gold).toBe(1);
    s = { ...s, activeSeat: "p1", players: { ...s.players, p1: { ...s.players.p1, reserved: [...s.players.p1.reserved, s.market[3][0]!] } } };
    expect(applyAction(s, { type: "reserveCard", seat: "p1", level: 1, marketIndex: 0 })).toBe(s);
  });

  it("an extra-turn card keeps the turn with the same player", () => {
    let s = startGame(13);
    const card: DuelCard = { id: "xt", level: 1, color: "white", points: 0, crowns: 0, bonus: 1, cost: {}, ability: "extraTurn" };
    s = { ...s, market: { ...s.market, 1: [card, ...s.market[1].slice(1)] } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "xt", source: "market" });
    expect(s.activeSeat).toBe("p1");
    expect(s.phase).toBe("playing");
    expect(s.mandatoryDone).toBe(false);
  });

  it("reaching 3 crowns pauses for a royal choice, and the royal's ability fires", () => {
    let s = startGame(17);
    const card: DuelCard = { id: "cr", level: 1, color: "black", points: 0, crowns: 3, bonus: 1, cost: {} };
    s = { ...s, market: { ...s.market, 1: [card, ...s.market[1].slice(1)] } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "cr", source: "market" });
    expect(s.phase).toBe("resolving");
    expect(s.pending[0].kind).toBe("chooseRoyal");
    s = applyAction(s, { type: "chooseRoyal", seat: "p1", royalId: "royal-privilege" });
    expect(s.players.p1.royals.map((r) => r.id)).toEqual(["royal-privilege"]);
    expect(s.players.p1.scrolls).toBe(1);
    expect(s.royals).toHaveLength(3);
    expect(s.activeSeat).toBe("p2");
  });

  it("copy bonus binds a colorless card to an owned color", () => {
    let s = startGame(19);
    const copy: DuelCard = { id: "cp", level: 2, color: null, points: 2, crowns: 0, bonus: 1, cost: {}, ability: "copyBonus" };
    s = { ...s, market: { ...s.market, 2: [copy, ...s.market[2].slice(1)] }, players: { ...s.players, p1: { ...s.players.p1, cards: [owned({ color: "green" })] } } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "cp", source: "market" });
    expect(s.pending[0].kind).toBe("copyBonus");
    expect(applyAction(s, { type: "resolveCopy", seat: "p1", color: "red" })).toBe(s);
    s = applyAction(s, { type: "resolveCopy", seat: "p1", color: "green" });
    expect(s.players.p1.cards.find((c) => c.id === "cp")?.boundColor).toBe("green");
    expect(s.activeSeat).toBe("p2");
  });

  it("copy bonus with no colored cards is skipped automatically", () => {
    let s = startGame(19);
    const copy: DuelCard = { id: "cp", level: 2, color: null, points: 0, crowns: 0, bonus: 1, cost: {}, ability: "copyBonus" };
    s = { ...s, market: { ...s.market, 2: [copy, ...s.market[2].slice(1)] } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "cp", source: "market" });
    expect(s.activeSeat).toBe("p2");
    expect(s.players.p1.cards[0].boundColor).toBeNull();
  });

  it("steal takes a non-gold token from the opponent", () => {
    let s = startGame(23);
    const card: DuelCard = { id: "st", level: 2, color: "blue", points: 0, crowns: 0, bonus: 1, cost: {}, ability: "stealToken" };
    s = { ...s, market: { ...s.market, 2: [card, ...s.market[2].slice(1)] }, players: { ...s.players, p2: { ...s.players.p2, tokens: { gold: 1, pearl: 1 } } } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "st", source: "market" });
    expect(getValidMoves(s, "p1")).toEqual([{ type: "resolveSteal", seat: "p1", color: "pearl" }]);
    s = applyAction(s, { type: "resolveSteal", seat: "p1", color: "pearl" });
    expect(s.players.p1.tokens.pearl).toBe(1);
    expect(s.players.p2.tokens).toEqual({ gold: 1, pearl: 0 });
  });

  it("take-matching-token grabs the card's color from the board", () => {
    let s = startGame(29);
    const color = s.grid.find((t): t is Exclude<BoardToken, "pearl"> => t !== null && t !== "pearl")!;
    const card: DuelCard = { id: "tk", level: 1, color, points: 0, crowns: 0, bonus: 1, cost: {}, ability: "takeToken" };
    s = { ...s, market: { ...s.market, 1: [card, ...s.market[1].slice(1)] } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "tk", source: "market" });
    const cell = s.grid.findIndex((t) => t === color);
    s = applyAction(s, { type: "resolveTakeToken", seat: "p1", cell });
    expect(s.players.p1.tokens[color]).toBe(1);
    expect(s.grid[cell]).toBeNull();
  });

  it("forces a discard down to 10 tokens before the turn ends", () => {
    let s = startGame(31);
    s = { ...s, grid: fullGrid("white"), players: { ...s.players, p1: { ...s.players.p1, tokens: { red: 9 } } } };
    s = applyAction(s, { type: "takeTokens", seat: "p1", cells: [0, 1] });
    expect(s.phase).toBe("resolving");
    expect(s.pending[0].kind).toBe("discard");
    expect(applyAction(s, { type: "discardTokens", seat: "p1", discard: { red: 2 } })).toBe(s);
    s = applyAction(s, { type: "discardTokens", seat: "p1", discard: { red: 1 } });
    expect(s.activeSeat).toBe("p2");
    expect(s.bag).toContain("red");
  });
});

describe("gold reservoir", () => {
  it("3 reserves drain the stand to 0, a 4th reservation-eligible player gets no gold", () => {
    let s = startGame(41);
    for (let i = 0; i < 3; i++) {
      s = { ...s, activeSeat: "p1", players: { ...s.players, p1: { ...s.players.p1, reserved: [] } } };
      s = applyAction(s, { type: "reserveCard", seat: "p1", level: 1, marketIndex: 0 });
    }
    expect(s.goldSupply).toBe(0);
    expect(s.players.p1.tokens.gold).toBe(3);
    s = { ...s, activeSeat: "p2" };
    s = applyAction(s, { type: "reserveCard", seat: "p2", level: 2, marketIndex: 0 });
    expect(s.players.p2.reserved).toHaveLength(1);
    expect(s.players.p2.tokens.gold ?? 0).toBe(0);
    expect(s.lastEvent).toMatchObject({ kind: "reserve", gainedGold: false });
    expect(totalGold(s)).toBe(GOLD_SUPPLY);
  });

  it("gold spent on a purchase returns to the stand, never the bag", () => {
    let s = startGame(43);
    const card: DuelCard = { id: "g2", level: 1, color: "red", points: 0, crowns: 0, bonus: 1, cost: { blue: 2, pearl: 1 } };
    s = { ...s, goldSupply: 0, market: { ...s.market, 1: [card, ...s.market[1].slice(1)] }, players: { ...s.players, p1: { ...s.players.p1, tokens: { gold: 3, pearl: 1 } } } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "g2", source: "market" });
    expect(s.players.p1.tokens.gold).toBe(1);
    expect(s.goldSupply).toBe(2);
    expect(s.bag).toEqual(["pearl"]);
    expect(totalGold(s)).toBe(GOLD_SUPPLY);
  });

  it("stealing gold is rejected; refills never put gold on the grid", () => {
    let s = startGame(47);
    const card: DuelCard = { id: "st2", level: 2, color: "blue", points: 0, crowns: 0, bonus: 1, cost: {}, ability: "stealToken" };
    s = { ...s, market: { ...s.market, 2: [card, ...s.market[2].slice(1)] }, players: { ...s.players, p2: { ...s.players.p2, tokens: { gold: 1, red: 1 } } } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "st2", source: "market" });
    const bogus = { type: "resolveSteal", seat: "p1", color: "gold" } as unknown as Parameters<typeof applyAction>[1];
    expect(applyAction(s, bogus)).toBe(s);
    expect(getValidMoves(s, "p1").every((m) => m.type === "resolveSteal" && m.color !== ("gold" as string))).toBe(true);
  });
});

describe("victory", () => {
  const base: PlayerState = { tokens: {}, cards: [], reserved: [], royals: [], scrolls: 0 };
  it("detects each of the three conditions", () => {
    expect(checkVictory(base)).toBeNull();
    expect(checkVictory({ ...base, cards: [owned({ color: "red", points: 5 }), owned({ color: "blue", points: 5 }), owned({ color: "green", points: 5 })], royals: [{ id: "r", name: "테스트", points: 5 }] })).toBe("prestige");
    expect(checkVictory({ ...base, cards: [owned({ color: "red", crowns: 5 }), owned({ color: "blue", crowns: 5 })] })).toBe("crowns");
    expect(checkVictory({ ...base, cards: [owned({ color: "red", points: 6 }), owned({ color: null, points: 4 }, "red")] })).toBe("singleColor");
  });

  it("ends the game immediately at the end of the winning turn", () => {
    let s = startGame(37);
    const card: DuelCard = { id: "win", level: 3, color: "red", points: 4, crowns: 0, bonus: 1, cost: {} };
    s = { ...s, market: { ...s.market, 3: [card, ...s.market[3].slice(1)] }, players: { ...s.players, p1: { ...s.players.p1, cards: [owned({ color: "red", points: 6 })] } } };
    s = applyAction(s, { type: "buyCard", seat: "p1", cardId: "win", source: "market" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("p1");
    expect(s.winReason).toBe("singleColor");
  });
});

describe("bot self-play", () => {
  it("finishes full games across seeds with conserved scrolls/tokens", () => {
    let finished = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = startGame(seed);
      let rngState = seed;
      const rng = () => ((rngState = (rngState * 16807) % 2147483647) / 2147483647);
      for (let step = 0; step < 3000 && s.phase !== "gameOver"; step++) {
        const actor = s.activeSeat;
        const move = chooseBotAction(s, actor, step % 2 === 0 ? 8 : 4, rng);
        expect(move).not.toBeNull();
        const next = applyAction(s, move!);
        expect(next).not.toBe(s);
        s = next;
        expect(scrollTotal(s)).toBe(TOTAL_SCROLLS);
        expect(totalGold(s)).toBe(GOLD_SUPPLY);
        expect([...s.bag, ...s.grid].includes("gold" as BoardToken)).toBe(false);
        const held = (["p1", "p2"] as const).reduce(
          (sum, seat) => sum + Object.entries(s.players[seat].tokens).reduce((a, [k, v]) => a + (k === "gold" ? 0 : (v ?? 0)), 0),
          0,
        );
        expect(held + s.bag.length + s.grid.filter((t) => t !== null).length).toBe(22);
      }
      if (s.phase === "gameOver") finished++;
      if (s.phase === "gameOver") expect(checkVictory(s.players[s.winner!])).not.toBeNull();
    }
    expect(finished).toBe(40);
  });

  it("offers at least one legal line on a fresh board", () => {
    expect(allSelections(startGame(1).grid).length).toBeGreaterThan(22);
    expect(prestigeOf(startGame(1).players.p1)).toBe(0);
  });
});
