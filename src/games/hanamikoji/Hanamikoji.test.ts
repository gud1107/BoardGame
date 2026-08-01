import { describe, expect, it } from "vitest";
import {
  GEISHAS,
  chooseCompete,
  chooseGift,
  chooseSecret,
  chooseTradeoff,
  createInitialOwnership,
  determineMatchWinner,
  drawCard,
  other,
  resolveCompeteResponse,
  resolveGiftResponse,
  scoreRound,
  startRound,
  tally,
  type GeishaOwnership,
  type HanamikojiState,
  type ItemCard,
} from "./engine";

/** Deterministic PRNG (mulberry32) so dealing/shuffling is reproducible in tests. */
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
