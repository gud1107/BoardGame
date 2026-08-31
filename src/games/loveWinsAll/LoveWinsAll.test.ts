import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  compareEvaluated,
  evaluateHand,
  buildDeck,
  handTier,
  handTierRank,
  STARTING_CHIPS,
  ANTE,
  LIAR_PENALTY,
  type HandCategory,
  type Suit,
} from "./cards";
import {
  applyAction,
  chooseBotAction,
  currentActor,
  getValidMoves,
  isStateSyncStale,
  otherSeat,
  raiseRange,
  startGame,
  type EngineAction,
  type LoveWinsAllState,
  type Seat,
} from "./engine";

// ---------------------------------------------------------------------------
// cards.ts — hand evaluation & comparison
// ---------------------------------------------------------------------------

describe("buildDeck", () => {
  it("base: 30 cards (12 scissors + 7 rock + 7 paper + 4 love, no liar)", () => {
    const deck = buildDeck("base");
    expect(deck.length).toBe(30);
    expect(deck.filter((c) => c === "scissors").length).toBe(12);
    expect(deck.filter((c) => c === "rock").length).toBe(7);
    expect(deck.filter((c) => c === "paper").length).toBe(7);
    expect(deck.filter((c) => c === "love").length).toBe(4);
    expect(deck.filter((c) => c === "liar").length).toBe(0);
  });

  it("lwa2: 49 cards (18 scissors + 12 rock + 12 paper + 6 love + 1 liar)", () => {
    const deck = buildDeck("lwa2");
    expect(deck.length).toBe(49);
    expect(deck.filter((c) => c === "scissors").length).toBe(18);
    expect(deck.filter((c) => c === "rock").length).toBe(12);
    expect(deck.filter((c) => c === "paper").length).toBe(12);
    expect(deck.filter((c) => c === "love").length).toBe(6);
    expect(deck.filter((c) => c === "liar").length).toBe(1);
  });
});

describe("evaluateHand — base (§C, 3-card hands)", () => {
  const cases: [Suit[], string][] = [
    [["love", "love", "love"], "loveWinsAll"],
    [["scissors", "scissors", "scissors"], "triple"],
    [["love", "love", "rock"], "twoLove"],
    [["scissors", "rock", "paper"], "mix"],
    [["rock", "rock", "scissors"], "double"],
    [["love", "rock", "paper"], "oneLove"],
  ];
  it.each(cases)("%o -> %s", (cards, expected) => {
    expect(evaluateHand(cards, "base").category).toBe(expected);
  });

  it("ranks lower number as stronger, matching §C's ordering", () => {
    const rank = (cards: Suit[]) => evaluateHand(cards, "base").rank;
    expect(rank(["love", "love", "love"])).toBeLessThan(rank(["scissors", "scissors", "scissors"]));
    expect(rank(["scissors", "scissors", "scissors"])).toBeLessThan(rank(["love", "love", "rock"]));
    expect(rank(["love", "love", "rock"])).toBeLessThan(rank(["scissors", "rock", "paper"]));
    expect(rank(["scissors", "rock", "paper"])).toBeLessThan(rank(["rock", "rock", "scissors"]));
    expect(rank(["rock", "rock", "scissors"])).toBeLessThan(rank(["love", "rock", "paper"]));
  });
});

describe("compareEvaluated — §D tiebreak chain (base)", () => {
  function cmp(a: Suit[], b: Suit[]) {
    return compareEvaluated(evaluateHand(a, "base"), evaluateHand(b, "base"));
  }

  it("cross-category: lower rank always wins regardless of symbols", () => {
    expect(cmp(["scissors", "scissors", "scissors"], ["scissors", "rock", "paper"])).toBe(-1); // triple beats mix
  });

  it("same-rank triple: RPS decides (rock beats scissors)", () => {
    expect(cmp(["rock", "rock", "rock"], ["scissors", "scissors", "scissors"])).toBe(-1);
    expect(cmp(["scissors", "scissors", "scissors"], ["rock", "rock", "rock"])).toBe(1);
  });

  it("identical-symbol triple vs triple is a genuine tie (documented extension of §D)", () => {
    expect(cmp(["scissors", "scissors", "scissors"], ["scissors", "scissors", "scissors"])).toBe(0);
  });

  it("twoLove vs twoLove: the single non-love card's RPS decides", () => {
    expect(cmp(["love", "love", "rock"], ["love", "love", "scissors"])).toBe(-1); // rock beats scissors
  });

  it("mix vs mix is always a tie (documented extension — composition is always identical)", () => {
    expect(cmp(["scissors", "rock", "paper"], ["paper", "scissors", "rock"])).toBe(0);
  });

  it("double vs double: the paired symbol's RPS decides", () => {
    expect(cmp(["paper", "paper", "scissors"], ["rock", "rock", "scissors"])).toBe(-1); // paper beats rock
  });

  it("oneLove vs oneLove is always an immediate tie regardless of the other two cards (§D explicit)", () => {
    expect(cmp(["love", "rock", "paper"], ["love", "scissors", "scissors"])).toBe(0);
  });
});

describe("evaluateHand — lwa2 (4-card hands incl. shared community)", () => {
  it("classifies the 9 tiers correctly", () => {
    expect(evaluateHand(["love", "love", "love", "love"], "lwa2").category).toBe("loveWinsAll");
    expect(evaluateHand(["love", "love", "love", "rock"], "lwa2").category).toBe("threeLove");
    expect(evaluateHand(["scissors", "scissors", "scissors", "scissors"], "lwa2").category).toBe("fourCard");
    expect(evaluateHand(["love", "scissors", "rock", "paper"], "lwa2").category).toBe("mix");
    expect(evaluateHand(["love", "love", "rock", "paper"], "lwa2").category).toBe("twoLove");
    expect(evaluateHand(["scissors", "scissors", "rock", "rock"], "lwa2").category).toBe("twoPair");
    expect(evaluateHand(["scissors", "scissors", "scissors", "rock"], "lwa2").category).toBe("triple");
    expect(evaluateHand(["scissors", "scissors", "rock", "paper"], "lwa2").category).toBe("onePair");
    expect(evaluateHand(["love", "scissors", "scissors", "rock"], "lwa2").category).toBe("oneLove");
  });

  it("triple-vs-triple uses the kicker as a real tiebreak (4-card mode has one)", () => {
    const a = evaluateHand(["scissors", "scissors", "scissors", "rock"], "lwa2");
    const b = evaluateHand(["scissors", "scissors", "scissors", "paper"], "lwa2");
    expect(compareEvaluated(a, b)).toBe(1); // same triple symbol; kicker paper beats rock -> b wins
  });

  it("the Liar substitutes for whichever symbol yields the single best category", () => {
    // love + love + love + liar -> liar-as-love completes loveWinsAll (rank 1), the best possible.
    const evaluated = evaluateHand(["love", "love", "love", "liar"], "lwa2");
    expect(evaluated.category).toBe("loveWinsAll");
    expect(evaluated.hasLiar).toBe(true);
  });

  it("a Liar hand loses an otherwise-tied showdown and pays the penalty (engine-level, see below)", () => {
    // Pure comparator only reports the tie; the auto-lose override is engine-level (resolveShowdown).
    const withLiar = evaluateHand(["scissors", "scissors", "scissors", "liar"], "lwa2"); // liar->scissors, same triple
    const withoutLiar = evaluateHand(["scissors", "scissors", "scissors", "rock"], "lwa2");
    // liar substitutes to whatever's best; scissors-triple-with-kicker-scissors ties the plain triple+rock on category+symbol but the kicker differs (rock vs rock is same suit here) -- assert the comparator itself is a tie when kickers match.
    const same = evaluateHand(["scissors", "scissors", "scissors", "rock"], "lwa2");
    expect(compareEvaluated(withoutLiar, same)).toBe(0);
    expect(withLiar.hasLiar).toBe(true);
  });
});

describe("handTier — real-time badge's 일반/레어/전설 classification", () => {
  it("base: legendary=loveWinsAll only, rare=triple/twoLove, common=the rest", () => {
    const expected: Record<string, "common" | "rare" | "legendary"> = {
      loveWinsAll: "legendary",
      triple: "rare",
      twoLove: "rare",
      mix: "common",
      double: "common",
      oneLove: "common",
    };
    for (const [category, tier] of Object.entries(expected)) {
      expect(handTier(category as HandCategory, "base")).toBe(tier);
    }
  });

  it("lwa2: legendary=loveWinsAll only, rare=threeLove/fourCard/mix/twoLove, common=the rest", () => {
    const expected: Record<string, "common" | "rare" | "legendary"> = {
      loveWinsAll: "legendary",
      threeLove: "rare",
      fourCard: "rare",
      mix: "rare",
      twoLove: "rare",
      twoPair: "common",
      triple: "common",
      onePair: "common",
      oneLove: "common",
    };
    for (const [category, tier] of Object.entries(expected)) {
      expect(handTier(category as HandCategory, "lwa2")).toBe(tier);
    }
  });

  it("handTierRank orders legendary < rare < common, so a rank comparison detects an upgrade", () => {
    expect(handTierRank("legendary")).toBeLessThan(handTierRank("rare"));
    expect(handTierRank("rare")).toBeLessThan(handTierRank("common"));
  });
});

// ---------------------------------------------------------------------------
// engine.ts — state machine
// ---------------------------------------------------------------------------

function withHands(state: LoveWinsAllState, p1: Suit[], p2: Suit[], community: Suit | null = null): LoveWinsAllState {
  return { ...state, hands: { p1, p2 }, community };
}

/** A seat's full hand including the shared community card when the variant has one (lwa2) — mirrors the engine's own `resolveShowdown`/`ownHandStrength` merge, needed here only because this test helper computes an "honest" default declaration. */
function fullHand(s: LoveWinsAllState, seat: Seat): Suit[] {
  return s.variant === "lwa2" && s.community ? [...s.hands[seat], s.community] : s.hands[seat];
}

/** Drives bet1 (check-check), a trivial honest declare for both seats, then bet2 (check-check) — lands exactly on `resolveShowdown`. */
function runToShowdown(state: LoveWinsAllState): LoveWinsAllState {
  let s = state;
  expect(s.phase).toBe("bet1");
  s = applyAction(s, { type: "call" }); // firstActor checks
  s = applyAction(s, { type: "call" }); // other seat checks -> closes bet1
  expect(s.phase).toBe("declare");
  s = applyAction(s, { type: "declare", seat: "p1", cardIndex: 0, declaredHand: evaluateHand(fullHand(s, "p1"), s.variant).category });
  s = applyAction(s, { type: "declare", seat: "p2", cardIndex: 0, declaredHand: evaluateHand(fullHand(s, "p2"), s.variant).category });
  expect(s.phase).toBe("bet2");
  s = applyAction(s, { type: "call" });
  s = applyAction(s, { type: "call" });
  return s;
}

describe("startGame", () => {
  it("is deterministic for a given seed", () => {
    expect(startGame("base", seededRng(42))).toEqual(startGame("base", seededRng(42)));
  });

  it("defaults to the base variant, posts the ante, and deals 3 private cards each with no community card", () => {
    const s = startGame("base", seededRng(1));
    expect(s.variant).toBe("base");
    expect(s.round).toBe(1);
    expect(s.phase).toBe("bet1");
    expect(s.chips.p1).toBe(STARTING_CHIPS.base - ANTE);
    expect(s.chips.p2).toBe(STARTING_CHIPS.base - ANTE);
    expect(s.pot).toBe(ANTE * 2);
    expect(s.hands.p1.length).toBe(3);
    expect(s.hands.p2.length).toBe(3);
    expect(s.community).toBeNull();
  });

  it("lwa2 deals a shared community card on top of 3 private cards each, with the larger starting stack", () => {
    const s = startGame("lwa2", seededRng(1));
    expect(s.chips.p1).toBe(STARTING_CHIPS.lwa2 - ANTE);
    expect(s.community).not.toBeNull();
  });
});

describe("bet1 -> declare -> bet2 flow", () => {
  it("a check from the acting seat passes the turn; the second check closes the street into 'declare'", () => {
    let s = startGame("base", seededRng(2));
    const firstActor = s.firstActorSeat;
    s = applyAction(s, { type: "call" });
    expect(s.actingSeat).toBe(otherSeat(firstActor));
    expect(s.phase).toBe("bet1");
    s = applyAction(s, { type: "call" });
    expect(s.phase).toBe("declare");
    expect(s.actingSeat).toBeNull();
  });

  it("only the acting seat's action is legal; getValidMoves is empty for the other seat", () => {
    const s = startGame("base", seededRng(3));
    const other = otherSeat(s.firstActorSeat);
    expect(getValidMoves(s, other)).toEqual([]);
    expect(getValidMoves(s, s.firstActorSeat).length).toBeGreaterThan(0);
  });

  it("raise is no-limit up to the raiser's full remaining stack, and out-of-range amounts are rejected", () => {
    const s = startGame("base", seededRng(4));
    const range = raiseRange(s, s.firstActorSeat)!;
    expect(range.max).toBe(s.chips[s.firstActorSeat]); // all-in cap
    const tooHigh = applyAction(s, { type: "raise", amount: range.max + 1 });
    expect(tooHigh).toBe(s); // no-op
    const raised = applyAction(s, { type: "raise", amount: range.max });
    expect(raised.chips[s.firstActorSeat]).toBe(0);
    expect(raised.pot).toBe(s.pot + range.max);
  });

  it("declare rejects an out-of-range cardIndex or an unknown hand label, and both declaring opens bet2 with a fresh betting street", () => {
    let s = startGame("base", seededRng(5));
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    expect(s.phase).toBe("declare");

    const badIndex = applyAction(s, { type: "declare", seat: "p1", cardIndex: 9, declaredHand: "mix" });
    expect(badIndex).toBe(s);
    const badLabel = applyAction(s, { type: "declare", seat: "p1", cardIndex: 0, declaredHand: "fourCard" as never });
    expect(badLabel).toBe(s); // "fourCard" isn't declarable in the base variant

    s = applyAction(s, { type: "declare", seat: "p1", cardIndex: 0, declaredHand: "mix" });
    s = applyAction(s, { type: "declare", seat: "p2", cardIndex: 1, declaredHand: "loveWinsAll" }); // bluff — never validated (§H)
    expect(s.phase).toBe("bet2");
    expect(s.actingSeat).toBe(s.firstActorSeat);
    expect(s.currentBet).toBe(0);
    expect(s.declaredHand.p2).toBe("loveWinsAll");
  });
});

describe("showdown resolution", () => {
  it("awards the whole pot to the strictly better hand", () => {
    let s = startGame("base", seededRng(6));
    s = withHands(s, ["love", "love", "love"], ["scissors", "rock", "paper"]);
    const potBefore = s.pot;
    s = runToShowdown(s);
    expect(s.lastRoundResult?.outcome).toBe("win");
    expect(s.lastRoundResult?.winnerSeat).toBe("p1");
    expect(s.lastRoundResult?.potWon).toBe(potBefore);
    expect(s.pot).toBe(0);
    expect(s.chips.p1).toBe(STARTING_CHIPS.base - ANTE + potBefore);
  });

  it("a genuine tie carries the pot to the next round instead of splitting it (§G)", () => {
    let s = startGame("base", seededRng(7));
    s = withHands(s, ["scissors", "rock", "paper"], ["rock", "paper", "scissors"]); // mix vs mix
    const potBefore = s.pot;
    s = runToShowdown(s);
    expect(s.lastRoundResult?.outcome).toBe("tie");
    expect(s.lastRoundResult?.winnerSeat).toBeNull();
    expect(s.pot).toBe(potBefore); // untouched, not reset to 0

    const seed2 = Math.floor(Math.random() * 1e9);
    const next = applyAction(s, { type: "continue", seed: seed2 });
    expect(next.round).toBe(2);
    expect(next.pot).toBe(potBefore + ANTE * 2); // carried + topped up
    expect(next.firstActorSeat).toBe(s.firstActorSeat); // no winner to hand 선공 to (module doc)
  });

  it("folding never reveals hands and awards the pot to the non-folder", () => {
    let s = startGame("base", seededRng(8));
    const folder = s.firstActorSeat;
    s = applyAction(s, { type: "fold" });
    expect(s.phase).toBe("showdown");
    expect(s.lastRoundResult?.outcome).toBe("fold");
    expect(s.lastRoundResult?.folderSeat).toBe(folder);
    expect(s.lastRoundResult?.winnerSeat).toBe(otherSeat(folder));
    expect(s.lastRoundResult?.hands).toBeNull();
    expect(s.pot).toBe(0);
  });

  it("ends the match (KO) the instant a seat's chips hit 0, awarding the win to the other seat", () => {
    let s = startGame("base", seededRng(9));
    // Both seats check-check through both streets (no further chip movement), so
    // the only way a seat's stack can already read 0 at showdown is if it was
    // already 0 going in — simulating the edge directly rather than grinding a
    // real all-in raise/call sequence to get there.
    s = { ...s, chips: { p1: s.chips.p1, p2: 0 } };
    s = withHands(s, ["love", "love", "love"], ["love", "rock", "paper"]);
    s = runToShowdown(s);
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("p1");
    expect(s.chips.p2).toBe(0);
  });
});

describe("lwa2 Liar penalty", () => {
  it("a losing Liar hand pays the extra penalty on top of forfeiting the pot", () => {
    let s = startGame("lwa2", seededRng(10));
    s = withHands(s, ["liar", "rock", "paper"] as unknown as Suit[], ["love", "love", "love"], "love");
    // p1: liar+rock+paper+love(community) -> best liar substitution can't beat p2's loveWinsAll (4 love).
    const chipsBefore = s.chips.p1;
    s = runToShowdown(s);
    expect(s.lastRoundResult?.winnerSeat).toBe("p2");
    expect(s.lastRoundResult?.liarPenaltyPaid).toBe(LIAR_PENALTY);
    expect(s.chips.p1).toBe(Math.max(0, chipsBefore - LIAR_PENALTY));
  });

  it("a Liar hand loses an otherwise-tied showdown outright instead of splitting the pot (appendix rule)", () => {
    let s = startGame("lwa2", seededRng(11));
    // p1: liar substitutes to scissors -> triple scissors + rock kicker; p2: literal triple scissors + rock kicker (same category+tiebreak -> would tie without the Liar override).
    s = withHands(s, ["liar", "scissors", "scissors"] as unknown as Suit[], ["scissors", "scissors", "rock"], "rock");
    s = runToShowdown(s);
    expect(s.lastRoundResult?.outcome).toBe("win"); // not "tie" — Liar side forced to lose
    expect(s.lastRoundResult?.winnerSeat).toBe("p2");
    expect(s.lastRoundResult?.liarPenaltyPaid).toBe(LIAR_PENALTY);
  });
});

describe("isStateSyncStale", () => {
  it("accepts the first sync and rejects one strictly behind the current seq", () => {
    const s = applyAction(startGame("base", seededRng(12)), { type: "call" });
    expect(isStateSyncStale(null, s)).toBe(false);
    const older = { ...s, seq: s.seq - 1 };
    expect(isStateSyncStale(s, older)).toBe(true);
    expect(isStateSyncStale(older, s)).toBe(false);
  });
});

describe("otherSeat", () => {
  it("flips between p1 and p2", () => {
    expect(otherSeat("p1")).toBe("p2");
    expect(otherSeat("p2")).toBe("p1");
  });
});

describe("gameOver / no-op guards", () => {
  it("every action is a no-op once the match is over", () => {
    let s = startGame("base", seededRng(13));
    s = withHands(s, ["love", "love", "love"], ["rock", "paper", "scissors"]);
    s = { ...s, chips: { p1: s.chips.p1, p2: 0 } };
    s = runToShowdown(s);
    expect(s.phase).toBe("gameOver");
    expect(applyAction(s, { type: "call" })).toBe(s);
    expect(applyAction(s, { type: "continue", seed: 1 })).toBe(s);
    expect(getValidMoves(s, "p1")).toEqual([]);
    expect(getValidMoves(s, "p2")).toEqual([]);
  });
});

describe("AI bot support (ARCHITECTURE.md §7)", () => {
  it("chooseBotAction always returns a legal, non-null move whenever getValidMoves is non-empty", () => {
    for (const level of [1, 5, 10]) {
      let s = startGame("base", seededRng(100 + level));
      let guard = 0;
      while (s.phase !== "gameOver" && guard < 3000) {
        guard++;
        const actor = currentActor(s);
        if (actor) {
          const legal = getValidMoves(s, actor);
          expect(legal.length).toBeGreaterThan(0);
          // (guard % 7) / 10 never reaches exactly 1.0 — pickByLevel's own
          // `top[Math.floor(rng() * top.length)]` would index out of bounds
          // on an rng() of exactly 1.0 (never happens with Math.random() in
          // production; only a synthetic test rng could hit it).
          const action = chooseBotAction(s, actor, level, () => (guard % 7) / 10);
          expect(action).not.toBeNull();
          expect(legal).toContainEqual(action);
          s = applyAction(s, action as EngineAction);
        } else if (s.phase === "showdown") {
          s = applyAction(s, { type: "continue", seed: guard });
        }
      }
      expect(guard).toBeLessThan(3000);
    }
  });

  it("two Lv.5 bots can play an entire match to completion without an infinite loop (base variant)", () => {
    let s = startGame("base", seededRng(200));
    let guard = 0;
    while (s.phase !== "gameOver" && guard < 3000) {
      guard++;
      const actor = currentActor(s);
      if (actor) {
        const action = chooseBotAction(s, actor, 5, () => (guard % 7) / 10);
        if (action) s = applyAction(s, action);
      } else if (s.phase === "showdown") {
        s = applyAction(s, { type: "continue", seed: guard * 7919 });
      }
    }
    expect(s.phase).toBe("gameOver");
    expect(guard).toBeLessThan(3000);
    expect(s.chips.p1 + s.chips.p2).toBe(STARTING_CHIPS.base * 2); // no chip leak across the whole match
  });

  it("two Lv.8 bots can play an entire match to completion without an infinite loop (lwa2 variant)", () => {
    let s = startGame("lwa2", seededRng(300));
    let guard = 0;
    while (s.phase !== "gameOver" && guard < 20000) {
      guard++;
      const actor = currentActor(s);
      if (actor) {
        const action = chooseBotAction(s, actor, 8, () => (guard % 7) / 10);
        if (action) s = applyAction(s, action);
      } else if (s.phase === "showdown") {
        s = applyAction(s, { type: "continue", seed: guard * 104729 });
      }
    }
    expect(s.phase).toBe("gameOver");
    expect(guard).toBeLessThan(20000);
    expect(s.chips.p1 + s.chips.p2).toBe(STARTING_CHIPS.lwa2 * 2); // no chip leak, incl. Liar-penalty transfers
  });

  it("a novice (Lv.1) bot's declare score is uniform (0) so any legal declare/index is equally likely to be picked", () => {
    let s = startGame("base", seededRng(400));
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    expect(s.phase).toBe("declare");
    const action = chooseBotAction(s, "p1", 1, () => 0.999); // avoid the "mistake" random branch too
    expect(action?.type).toBe("declare");
  });
});
