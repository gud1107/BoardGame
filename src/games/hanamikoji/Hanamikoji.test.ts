import { describe, expect, it } from "vitest";
import {
  GEISHAS,
  applyAction,
  chooseBotAction,
  chooseCompete,
  chooseGift,
  chooseSecret,
  chooseTradeoff,
  createInitialOwnership,
  determineMatchWinner,
  drawCard,
  getValidMoves,
  other,
  resolveCompeteResponse,
  resolveGiftResponse,
  scoreRound,
  seededRng,
  startRound,
  tally,
  type EngineAction,
  type GeishaOwnership,
  type HanamikojiState,
  type ItemCard,
  type Owner,
} from "./engine";

function card(geishaId: string, n: number): ItemCard {
  return { id: `${geishaId}-${n}`, geishaId };
}

describe("determineMatchWinner (win condition)", () => {
  it("returns null when neither player has reached a threshold", () => {
    expect(determineMatchWinner(createInitialOwnership())).toBeNull();
  });

  it("declares the player who controls 4+ geisha the winner", () => {
    const ownership: GeishaOwnership = {
      ...createInitialOwnership(),
      g2a: "p1",
      g2b: "p1",
      g2c: "p1",
      g3a: "p1",
    };
    expect(determineMatchWinner(ownership)).toBe("p1");
  });

  it("declares the player with 11+ charm points the winner even with fewer geisha", () => {
    const ownership: GeishaOwnership = {
      ...createInitialOwnership(),
      g5: "p2", // 5
      g4: "p2", // 4
      g3a: "p2", // 3 -> 12 points, only 3 geisha
    };
    expect(determineMatchWinner(ownership)).toBe("p2");
  });

  it("breaks a simultaneous double-threshold tie by total charm points", () => {
    const ownership: GeishaOwnership = {
      g2a: "p1",
      g2b: "p1",
      g2c: "p1",
      g3a: "p1", // p1: 4 geisha, 2+2+2+3 = 9 points
      g5: "p2",
      g4: "p2",
      g3b: "p2", // p2: 3 geisha, 5+4+3 = 12 points (>=11)
    };
    expect(determineMatchWinner(ownership)).toBe("p2");
  });
});

describe("scoreRound (geisha ownership from card counts)", () => {
  function emptyPlayer() {
    return { hand: [], actionsUsed: [], secretCard: null, wonCards: [] as ItemCard[], discarded: [] };
  }

  it("awards each geisha to whoever collected more of its cards", () => {
    const state: HanamikojiState = {
      players: {
        p1: { ...emptyPlayer(), wonCards: [card("g5", 0), card("g5", 1)] },
        p2: { ...emptyPlayer(), wonCards: [card("g5", 2)] },
      },
      deck: [],
      removedCard: null,
      geishaOwnership: createInitialOwnership(),
      activePlayer: "p1",
      roundStarter: "p1",
      turnInRound: 8,
      phase: "round-end",
      pendingOffer: null,
      roundNumber: 1,
      matchWinner: null,
      lastRoundSummary: null,
    };
    const result = scoreRound(state);
    expect(result.geishaOwnership.g5).toBe("p1"); // 2 cards vs 1
  });

  it("leaves ownership unchanged on a tie, preserving a prior round's winner", () => {
    const state: HanamikojiState = {
      players: {
        p1: { ...emptyPlayer(), wonCards: [card("g4", 0)] },
        p2: { ...emptyPlayer(), wonCards: [card("g4", 1)] },
      },
      deck: [],
      removedCard: null,
      geishaOwnership: { ...createInitialOwnership(), g4: "p2" }, // p2 owned it from a previous round
      activePlayer: "p1",
      roundStarter: "p1",
      turnInRound: 8,
      phase: "round-end",
      pendingOffer: null,
      roundNumber: 2,
      matchWinner: null,
      lastRoundSummary: null,
    };
    const result = scoreRound(state);
    expect(result.geishaOwnership.g4).toBe("p2"); // 1 vs 1 tie -> unchanged
  });

  it("reveals the secret card into the count before scoring", () => {
    const state: HanamikojiState = {
      players: {
        p1: { ...emptyPlayer(), secretCard: card("g2a", 0) },
        p2: { ...emptyPlayer(), wonCards: [card("g2a", 1)] },
      },
      deck: [],
      removedCard: null,
      geishaOwnership: createInitialOwnership(),
      activePlayer: "p1",
      roundStarter: "p1",
      turnInRound: 8,
      phase: "round-end",
      pendingOffer: null,
      roundNumber: 1,
      matchWinner: null,
      lastRoundSummary: null,
    };
    const result = scoreRound(state);
    // Without the reveal this would be a 0-vs-1 tie broken toward p2; with the
    // secret card revealed it's 1-vs-1, so ownership stays unassigned.
    expect(result.geishaOwnership.g2a).toBeNull();
  });

  it("transitions to match-end once a threshold is crossed", () => {
    const geishaValues = GEISHAS.filter((g) => ["g5", "g4", "g3a", "g3b"].includes(g.id));
    const state: HanamikojiState = {
      players: {
        p1: {
          ...emptyPlayer(),
          wonCards: geishaValues.map((g, i) => card(g.id, i)),
        },
        p2: emptyPlayer(),
      },
      deck: [],
      removedCard: null,
      geishaOwnership: createInitialOwnership(),
      activePlayer: "p1",
      roundStarter: "p1",
      turnInRound: 8,
      phase: "round-end",
      pendingOffer: null,
      roundNumber: 1,
      matchWinner: null,
      lastRoundSummary: null,
    };
    const result = scoreRound(state);
    expect(result.phase).toBe("match-end");
    expect(result.matchWinner).toBe("p1");
  });
});

describe("startRound (card dealing)", () => {
  it("deals a legal, fully-accounted-for 21-card deck", () => {
    const state = startRound(1, "p1", createInitialOwnership(), seededRng(42));

    expect(state.players.p1.hand).toHaveLength(6);
    expect(state.players.p2.hand).toHaveLength(6);
    expect(state.deck).toHaveLength(8);
    expect(state.removedCard).not.toBeNull();

    const allIds = [
      ...state.players.p1.hand,
      ...state.players.p2.hand,
      ...state.deck,
      state.removedCard!,
    ].map((c) => c.id);
    expect(new Set(allIds).size).toBe(21); // no duplicates
    expect(allIds).toHaveLength(21);

    // Per-geisha counts in the full deck must match the official 2/2/2/3/3/4/5 distribution.
    for (const geisha of GEISHAS) {
      const count = allIds.filter((id) => id.startsWith(`${geisha.id}-`)).length;
      expect(count).toBe(geisha.value);
    }
  });

  it("starts fresh at awaiting-draw with the given round starter", () => {
    const state = startRound(3, "p2", createInitialOwnership(), seededRng(7));
    expect(state.phase).toBe("awaiting-draw");
    expect(state.activePlayer).toBe("p2");
    expect(state.roundStarter).toBe("p2");
    expect(state.roundNumber).toBe(3);
    expect(state.turnInRound).toBe(0);
  });
});

describe("online-match determinism (two independent clients from one shared seed)", () => {
  it("deals an identical hand from the same seed, regardless of call site", () => {
    // This is the whole trick behind syncing two browsers over Realtime
    // broadcast without transmitting the deck: both clients call
    // startRound with the same seed and must land on bit-identical state.
    const a = startRound(1, "p1", createInitialOwnership(), seededRng(12345));
    const b = startRound(1, "p1", createInitialOwnership(), seededRng(12345));
    expect(a.players.p1.hand.map((c) => c.id)).toEqual(b.players.p1.hand.map((c) => c.id));
    expect(a.players.p2.hand.map((c) => c.id)).toEqual(b.players.p2.hand.map((c) => c.id));
    expect(a.deck.map((c) => c.id)).toEqual(b.deck.map((c) => c.id));
    expect(a.removedCard?.id).toBe(b.removedCard?.id);
  });

  it("deals a different hand from a different seed (sanity check against a no-op RNG)", () => {
    const a = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    const b = startRound(1, "p1", createInitialOwnership(), seededRng(2));
    expect(a.players.p1.hand.map((c) => c.id)).not.toEqual(b.players.p1.hand.map((c) => c.id));
  });

  it("applyAction replays identically on two independent state trees dealt from the same seed", () => {
    let a = startRound(1, "p1", createInitialOwnership(), seededRng(777));
    let b = startRound(1, "p1", createInitialOwnership(), seededRng(777));

    // Simulate a short exchange: p1 draws + goes secret, p2 draws + trade-off.
    const actions: EngineAction[] = [
      { type: "draw" },
      { type: "secret", cardId: a.players.p1.hand[0].id },
    ];
    for (const action of actions) {
      a = applyAction(a, action);
      b = applyAction(b, action);
    }
    expect(a).toEqual(b);

    const nextRoundAction: EngineAction = { type: "next-round", seed: 999 };
    a = { ...a, phase: "round-end" };
    b = { ...b, phase: "round-end" };
    a = applyAction(a, nextRoundAction);
    b = applyAction(b, nextRoundAction);
    expect(a.players.p1.hand.map((c) => c.id)).toEqual(b.players.p1.hand.map((c) => c.id));
    expect(a.roundNumber).toBe(2);
  });
});

describe("full-round action phase transitions", () => {
  it("alternates turns, enforces one-use-per-action, and reaches round-end after 8 turns", () => {
    let state = startRound(1, "p1", createInitialOwnership(), seededRng(1));

    function playSecret() {
      state = drawCard(state);
      expect(state.phase).toBe("awaiting-action");
      const active = state.activePlayer;
      state = chooseSecret(state, state.players[active].hand[0].id);
    }

    function playTradeoff() {
      state = drawCard(state);
      const active = state.activePlayer;
      const [a, b] = state.players[active].hand;
      state = chooseTradeoff(state, [a.id, b.id]);
    }

    function playGift() {
      state = drawCard(state);
      const offerer = state.activePlayer;
      const [a, b, c] = state.players[offerer].hand;
      state = chooseGift(state, [a.id, b.id, c.id]);
      expect(state.phase).toBe("awaiting-response");
      const offer = state.pendingOffer;
      if (!offer || offer.kind !== "gift") throw new Error("expected a pending gift offer");
      expect(other(offer.offeredBy)).toBe(other(offerer));
      state = resolveGiftResponse(state, offer.cards[0].id);
    }

    function playCompete() {
      state = drawCard(state);
      const offerer = state.activePlayer;
      const [a, b, c, d] = state.players[offerer].hand;
      state = chooseCompete(state, [a.id, b.id], [c.id, d.id]);
      expect(state.phase).toBe("awaiting-response");
      state = resolveCompeteResponse(state, 0);
    }

    // Each player runs through all four actions across 4 turns; 8 turns total.
    playSecret(); // p1 turn 0
    expect(state.turnInRound).toBe(1);
    expect(state.activePlayer).toBe("p2");

    playSecret(); // p2 turn 1
    expect(state.turnInRound).toBe(2);
    expect(state.activePlayer).toBe("p1");

    playTradeoff(); // p1 turn 2
    playTradeoff(); // p2 turn 3
    expect(state.turnInRound).toBe(4);
    expect(state.activePlayer).toBe("p1");

    playGift(); // p1 turn 4 (resolved by p2)
    expect(state.turnInRound).toBe(5);
    expect(state.activePlayer).toBe("p2");

    playGift(); // p2 turn 5 (resolved by p1)
    expect(state.turnInRound).toBe(6);
    expect(state.activePlayer).toBe("p1");

    playCompete(); // p1 turn 6 (resolved by p2)
    expect(state.turnInRound).toBe(7);
    expect(state.activePlayer).toBe("p2");

    playCompete(); // p2 turn 7 (resolved by p1) -> round is over
    expect(state.turnInRound).toBe(8);
    expect(["round-end", "match-end"]).toContain(state.phase);

    // Every action was used exactly once by each player.
    expect(new Set(state.players.p1.actionsUsed).size).toBe(4);
    expect(new Set(state.players.p2.actionsUsed).size).toBe(4);

    const t = tally(state.geishaOwnership);
    expect(t.p1GeishaCount + t.p2GeishaCount).toBeLessThanOrEqual(GEISHAS.length);
  });

  it("keeps geisha ownership across rounds when a match continues", () => {
    const ownershipAfterRound1: GeishaOwnership = {
      ...createInitialOwnership(),
      g5: "p1",
    };
    const round2 = startRound(2, "p2", ownershipAfterRound1, seededRng(9));
    expect(round2.geishaOwnership.g5).toBe("p1");
    expect(round2.roundNumber).toBe(2);
  });
});

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("only offers 'draw' to the active player during awaiting-draw", () => {
    const state = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    expect(getValidMoves(state, "p1")).toEqual([{ type: "draw" }]);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("enumerates every unused action, sized by hand combinatorics, and nothing for the idle seat", () => {
    let state = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    state = drawCard(state); // -> awaiting-action, p1's hand is now 7 cards
    const n = state.players.p1.hand.length;
    const moves = getValidMoves(state, "p1");
    const byType = (t: EngineAction["type"]) => moves.filter((m) => m.type === t).length;
    expect(byType("secret")).toBe(n);
    expect(byType("tradeoff")).toBe((n * (n - 1)) / 2);
    expect(byType("gift")).toBe((n * (n - 1) * (n - 2)) / 6);
    expect(byType("compete")).toBe(((n * (n - 1) * (n - 2) * (n - 3)) / 24) * 3);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("restricts gift/compete responses to the responder only", () => {
    let state = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    state = drawCard(state);
    const [a, b, c] = state.players.p1.hand;
    state = chooseGift(state, [a.id, b.id, c.id]);
    expect(getValidMoves(state, "p2")).toHaveLength(3);
    expect(getValidMoves(state, "p1")).toEqual([]);
  });

  it("offers nothing once a round has ended (a shared button, not a per-seat move)", () => {
    let state = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    state = { ...state, phase: "round-end" };
    expect(getValidMoves(state, "p1")).toEqual([]);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null when the seat has nothing to do", () => {
    const state = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    expect(chooseBotAction(state, "p2", 5)).toBeNull();
  });

  it("always returns a legal move across every level", () => {
    let state = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    state = drawCard(state);
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
  });

  it("secret: keeps the highest-value card in hand (core levels)", () => {
    const base = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    const hand: ItemCard[] = [card("g2a", 0), card("g5", 0), card("g3a", 0)];
    const state: HanamikojiState = {
      ...base,
      phase: "awaiting-action",
      activePlayer: "p1",
      players: { ...base.players, p1: { ...base.players.p1, hand, actionsUsed: [] } },
    };
    // rng forced high enough to stay outside Level 5's ~12% mistake chance,
    // so this exercises the actual scored decision rather than the noise curve.
    const action = chooseBotAction(state, "p1", 5, () => 0.99);
    expect(action).toEqual({ type: "secret", cardId: "g5-0" });
  });

  it("gift-response: takes the highest-value offered card (core levels)", () => {
    const base = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    const state: HanamikojiState = {
      ...base,
      phase: "awaiting-response",
      pendingOffer: {
        kind: "gift",
        offeredBy: "p1",
        cards: [card("g2a", 0), card("g5", 0), card("g3a", 0)],
      },
    };
    const action = chooseBotAction(state, "p2", 5, () => 0.99);
    expect(action).toEqual({ type: "gift-response", cardId: "g5-0" });
  });

  it("Level 1 (forced onto its mistake path) can diverge from Level 10, which always plays the top-scored move", () => {
    const base = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    const hand: ItemCard[] = [card("g2a", 0), card("g5", 0), card("g3a", 0)];
    const state: HanamikojiState = {
      ...base,
      phase: "awaiting-action",
      activePlayer: "p1",
      players: { ...base.players, p1: { ...base.players.p1, hand, actionsUsed: [] } },
    };

    // rng() always 0 -> always below Level 1's ~55% mistake chance -> always
    // takes candidates[Math.floor(0 * length)] === the first enumerated move
    // (a "secret" on the first hand card, g2a-0), not the best-scored one.
    const level1Action = chooseBotAction(state, "p1", 1, () => 0);
    expect(level1Action).toEqual({ type: "secret", cardId: "g2a-0" });

    // Level 10 has a 0% mistake chance and 0 tie margin -> always the true
    // argmax regardless of rng: keep the highest-value card (g5).
    const level10Action = chooseBotAction(state, "p1", 10, () => 0);
    expect(level10Action).toEqual({ type: "secret", cardId: "g5-0" });
    expect(level1Action).not.toEqual(level10Action);
  });

  it("Level 8+ reasons about which geisha are already decided from visible info, deprioritizing a locked-in geisha over a still-contested one even when its face value is lower", () => {
    const base = startRound(1, "p1", createInitialOwnership(), seededRng(1));
    // p1 already holds 2 of g3a's 3 cards (visible in wonCards) — the 3rd is
    // in hand, but even winning it can't be caught up by p2, so g3a is
    // "locked" for p1. g2a (value 2, both cards still unaccounted for) is
    // fully contested. A raw-value heuristic prefers the value-3 g3a card;
    // an info-aware Lv.8+ heuristic prefers securing the contested g2a card.
    const hand: ItemCard[] = [card("g3a", 2), card("g2a", 1)];
    const state: HanamikojiState = {
      ...base,
      removedCard: null,
      phase: "awaiting-action",
      activePlayer: "p1",
      players: {
        p1: { ...base.players.p1, hand, actionsUsed: [], wonCards: [card("g3a", 0), card("g3a", 1)] },
        p2: base.players.p2,
      },
    };

    // Core level (no lock-awareness): picks the higher face-value card.
    const coreAction = chooseBotAction(state, "p1", 5, () => 0.99);
    expect(coreAction).toEqual({ type: "secret", cardId: "g3a-2" });

    // Expert level (lock-aware): picks the still-contested card instead.
    const expertAction = chooseBotAction(state, "p1", 10, () => 0.5);
    expect(expertAction).toEqual({ type: "secret", cardId: "g2a-1" });
  });
});

function playFullBotGame(seed: number, levelOf: (seat: Owner) => number): HanamikojiState {
  let state = startRound(1, "p1", createInitialOwnership(), seededRng(seed));
  let guard = 0;
  while (state.phase !== "match-end" && guard < 2000) {
    guard++;
    if (state.phase === "round-end") {
      state = applyAction(state, { type: "next-round", seed: seed * 1000 + guard });
      continue;
    }
    const seat: Owner =
      state.phase === "awaiting-response" && state.pendingOffer
        ? other(state.pendingOffer.offeredBy)
        : state.activePlayer;
    const action = chooseBotAction(state, seat, levelOf(seat));
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 1–10 풀 시뮬레이션 (버그 없이 match-end까지 완주)", () => {
  for (const level of [1, 4, 7, 10]) {
    it(`completes an all-Level-${level} match with a decided winner`, () => {
      const state = playFullBotGame(1000 + level, () => level);
      expect(state.phase).toBe("match-end");
      expect(state.matchWinner).not.toBeNull();
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(4242, (seat) => (seat === "p1" ? 1 : 10));
    expect(state.phase).toBe("match-end");
    expect(state.matchWinner).not.toBeNull();
  });
});
