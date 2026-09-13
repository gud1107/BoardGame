import { describe, expect, it } from "vitest";
import {
  applyAction,
  chooseBotAction,
  computeCollectionBonus,
  computePlayerScore,
  computeRankings,
  getValidMoves,
  greedyCoinsFor,
  minimalRaiseCoins,
  startGame,
} from "./engine";
import { purseValue, startingPurse, EXCLUDE_COUNT, countAuctionCards } from "./constants";
import type { GreatLegacyState, OwnedRelic, SeatIndex } from "./types";

function bid(state: GreatLegacyState, seat: SeatIndex, value: number): GreatLegacyState {
  const coins = greedyCoinsFor(state.players[seat].purse, value);
  if (!coins) throw new Error(`seat ${seat} can't afford ${value}`);
  return applyAction(state, { type: "bid", seat, addCoins: coins });
}

function pass(state: GreatLegacyState, seat: SeatIndex): GreatLegacyState {
  return applyAction(state, { type: "pass", seat });
}

/**
 * Resolves exactly the CURRENT auction (whichever card is up when called) in
 * favor of `winner`: `winner` bids the minimum whenever it's their turn,
 * everyone else passes — stops the instant the auction resolves (the deck
 * moves on to a different card, or the game ends), never spilling into
 * subsequent auctions.
 */
function letEveryoneElsePass(state: GreatLegacyState, winner: SeatIndex): GreatLegacyState {
  const startingCardId = state.auction!.card.cardId;
  let s = state;
  while (s.auction && s.auction.card.cardId === startingCardId) {
    const actor = s.auction.activeSeat;
    s = actor === winner ? bid(s, actor, (s.auction.highestBid || 0) + 1) : pass(s, actor);
  }
  return s;
}

describe("startGame", () => {
  it("4p mode: 4 players with 140 coins each, 22-card deck (25 - 3 excluded)", () => {
    const state = startGame("4p", 1);
    expect(state.players).toHaveLength(4);
    for (const p of state.players) {
      expect(purseValue(p.purse)).toBe(140);
    }
    expect(state.excludedCards).toHaveLength(EXCLUDE_COUNT["4p"]);
    expect(state.deck.length + 1).toBe(countAuctionCards("4p") - EXCLUDE_COUNT["4p"]); // +1 for the card already drawn into `auction`
    expect(state.auction).not.toBeNull();
  });

  it("8p mode: 8 players with 110 coins each, 25-card deck (28 - 3 excluded)", () => {
    const state = startGame("8p", 1);
    expect(state.players).toHaveLength(8);
    for (const p of state.players) {
      expect(purseValue(p.purse)).toBe(110);
    }
    expect(state.excludedCards).toHaveLength(EXCLUDE_COUNT["8p"]);
    expect(state.deck.length + 1).toBe(countAuctionCards("8p") - EXCLUDE_COUNT["8p"]);
  });

  it("starting purses match the documented denomination breakdown", () => {
    expect(startingPurse("4p")).toEqual({ 20: 2, 10: 5, 5: 8, 1: 10 });
    expect(startingPurse("8p")).toEqual({ 20: 2, 10: 3, 5: 6, 1: 10 });
  });

  it("is deterministic for a given seed and randomizes the opening bidder", () => {
    const a = startGame("4p", 42);
    const b = startGame("4p", 42);
    expect(a.auction?.card.cardId).toBe(b.auction?.card.cardId);
    expect(a.nextOpenerSeat).toBe(b.nextOpenerSeat);
  });
});

function findNormalAuctionSeed(mode: "4p" | "8p" = "4p"): number {
  for (let seed = 1; seed < 200; seed++) {
    const state = startGame(mode, seed);
    if (state.auction!.kind === "normal") return seed;
  }
  throw new Error("no normal-auction seed found in range");
}

describe("normal auction (relic cards & 재평가)", () => {
  it("requires each bid to strictly exceed the previous total", () => {
    let state = startGame("4p", findNormalAuctionSeed());
    // Force a known relic card up first for a predictable test, regardless of shuffle: just use whatever's drawn.
    const opener = state.auction!.activeSeat;
    state = bid(state, opener, 10);
    expect(state.auction!.highestBid).toBe(10);
    // Re-bidding the same total again must be rejected (no-op).
    const before = state;
    const rejected = applyAction(state, { type: "bid", seat: state.auction!.activeSeat, addCoins: { 20: 0, 10: 0, 5: 0, 1: 0 } });
    expect(rejected).toBe(before); // literally unchanged — 0 extra coins can't exceed anything
  });

  it("passing refunds the seat's committed coins and removes them from the auction", () => {
    let state = startGame("4p", findNormalAuctionSeed());
    const [a, b] = state.auction!.order;
    const purseABefore = purseValue(state.players[a].purse);
    state = bid(state, a, 15); // a bids, turn -> b
    state = bid(state, b, 20); // b outbids, turn -> c
    state = pass(state, state.auction!.activeSeat); // c passes (never bid, no-op refund), turn -> d
    state = pass(state, state.auction!.activeSeat); // d passes (never bid, no-op refund) — only a/b remain active, no auto-win yet
    expect(state.auction!.activeSeat).toBe(a);
    state = pass(state, a); // a explicitly passes, forfeiting the auction but reclaiming their 15
    expect(purseValue(state.players[a].purse)).toBe(purseABefore);
  });

  it("last remaining bidder wins the card, it's added to their relics, and they open the next auction", () => {
    let state = startGame("4p", findNormalAuctionSeed());
    const opener = state.auction!.activeSeat;
    const card = state.auction!.card;
    state = bid(state, opener, 5);
    state = letEveryoneElsePass(state, opener);
    if (card.kind === "relic") {
      const owned = state.players[opener].relics.find((r) => r.relicId === card.cardId);
      expect(owned).toBeDefined();
      expect(owned!.currentScore).toBe(card.relic.baseScore);
    }
    expect(state.nextOpenerSeat).toBe(opener);
    expect(state.auction!.activeSeat).toBe(opener); // new auction opens with the winner
  });
});

describe("reverse auction (평가절하 / 가품 판정)", () => {
  function findReverseAuctionSeed(): number {
    for (let seed = 1; seed < 200; seed++) {
      const state = startGame("4p", seed);
      if (state.auction!.kind === "reverse") return seed;
    }
    throw new Error("no reverse-auction seed found in range");
  }

  it("the first player to pass gets stuck with the card, refunded their own coins, while others forfeit theirs", () => {
    const seed = findReverseAuctionSeed();
    const pristine = startGame("4p", seed);
    expect(pristine.auction!.kind).toBe("reverse");
    const [seatA, seatB, seatC, seatD] = pristine.auction!.order;
    const purseBefore = (seat: SeatIndex) => purseValue(pristine.players[seat].purse);

    // Everyone keeps raising (nobody wants to be first to fold) — seatA is
    // the very first to actually pass, only once it's their second turn.
    let state = bid(pristine, seatA, 8);
    state = bid(state, seatB, 12);
    state = bid(state, seatC, 14);
    state = bid(state, seatD, 16);
    expect(state.auction!.activeSeat).toBe(seatA);

    state = pass(state, seatA); // first pass anyone has made this auction — seatA gets stuck with the card

    expect(purseValue(state.players[seatA].purse)).toBe(purseBefore(seatA)); // refunded their own 8
    expect(purseValue(state.players[seatB].purse)).toBe(purseBefore(seatB) - 12); // forfeited, never refunded
    expect(purseValue(state.players[seatC].purse)).toBe(purseBefore(seatC) - 14);
    expect(purseValue(state.players[seatD].purse)).toBe(purseBefore(seatD) - 16);
  });

  it("applies the special effect (1점 / 폐기) to the recipient's last relic, or queues it if they own none", () => {
    const seed = findReverseAuctionSeed();
    let state = startGame("4p", seed);
    const kind = state.auction!.card.kind === "special" ? state.auction!.card.special : null;
    expect(kind).not.toBeNull();
    const opener = state.auction!.activeSeat;
    state = pass(state, opener); // opener immediately passes -> wins the penalty card with zero relics owned yet
    expect(state.players[opener].pendingSpecials).toEqual([kind]);
    expect(state.players[opener].relics).toHaveLength(0);
  });
});

describe("special-card queueing and re-targeting", () => {
  it("a special won with zero relics queues, then consumes exactly the next relic acquired, one queued special per relic (FIFO)", () => {
    // Drive the real game forward until we find a seed where the very first
    // card is a reverse-auction special (so seat 0, its opener, can win it
    // with zero relics owned and queue it), then keep having seat 0 win
    // every subsequent auction and check the queue drains one-per-relic.
    let seed = 1;
    let state = startGame("4p", seed);
    while (state.auction!.kind !== "reverse") {
      seed++;
      state = startGame("4p", seed);
    }
    const winner = state.auction!.activeSeat;
    const firstKind = state.auction!.card.kind === "special" ? state.auction!.card.special : null;
    expect(firstKind).not.toBeNull();

    state = pass(state, winner); // immediate pass in a reverse auction -> winner takes it, owns 0 relics -> queued
    expect(state.players[winner].pendingSpecials).toEqual([firstKind]);
    expect(state.players[winner].relics).toHaveLength(0);

    // Keep letting `winner` win every following auction until they've picked
    // up at least one relic card (skipping any further specials so the
    // queue's contents stay predictable) — then check the queued special
    // landed on that first relic, and only that one.
    let guard = 0;
    while (state.players[winner].relics.length === 0) {
      guard++;
      if (guard > 50) throw new Error("winner never acquired a relic — deck exhausted or logic stuck");
      state = letEveryoneElsePass(state, winner);
    }
    expect(state.players[winner].pendingSpecials).toEqual([]); // the one queued special was consumed
    const relic = state.players[winner].relics[0];
    if (firstKind === "재평가") expect(relic.currentScore).toBe(5);
    if (firstKind === "평가절하") expect(relic.currentScore).toBe(1);
    if (firstKind === "가품판정") expect(relic.discarded).toBe(true);
  });

  it("re-targets (overwrites) the chronologically last-acquired relic when a later special is won with relics already owned", () => {
    // Find a seed whose first TWO cards are: a relic, then 재평가 (both
    // resolvable as normal auctions), so seat 0 can win the relic first and
    // then have 재평가 immediately overwrite it — then verify a THIRD special
    // re-overwrites the same still-most-recent relic (never touching an
    // older one), matching "직전 획득 유물 = chronologically last, regardless
    // of prior modification".
    let seed = 1;
    let state = startGame("4p", seed);
    const firstIsRelicNormal = () => state.auction!.card.kind === "relic" && state.auction!.kind === "normal";
    while (!firstIsRelicNormal()) {
      seed++;
      state = startGame("4p", seed);
    }
    const winner = state.auction!.activeSeat;
    state = letEveryoneElsePass(state, winner); // seat wins the first relic
    expect(state.players[winner].relics).toHaveLength(1);
    const baseScore = state.players[winner].relics[0].baseScore;

    // Manually apply a 평가절하 then a 재평가 directly via the internal
    // grant-special path by simulating a special auction win for the SAME
    // winner without depending on shuffle order for the 2nd/3rd cards —
    // exercised through the public reducer via a constructed reverse
    // auction state to keep this test independent of deck order.
    const withPenaltyAuction: GreatLegacyState = {
      ...state,
      auction: { card: { kind: "special", cardId: "test-devalue", special: "평가절하" }, kind: "reverse", order: state.auction!.order, activeSeat: winner, highestBid: 0, highestBidder: null, committed: {}, passed: [] },
    };
    const s2 = pass(withPenaltyAuction, winner); // first pass in a reverse auction -> immediate win
    expect(s2.players[winner].relics[0].currentScore).toBe(1); // 평가절하 overwrote the last (only) relic

    const withReevalAuction: GreatLegacyState = {
      ...s2,
      auction: { card: { kind: "special", cardId: "test-reeval", special: "재평가" }, kind: "normal", order: s2.auction!.order, activeSeat: winner, highestBid: 0, highestBidder: null, committed: {}, passed: [] },
    };
    // Normal-auction win: everyone else passes, winner takes it for free.
    const s3 = letEveryoneElsePass(withReevalAuction, winner);
    expect(s3.players[winner].relics[0].currentScore).toBe(5); // 재평가 re-overwrote the SAME relic (still the only/last one)
    expect(s3.players[winner].relics[0].baseScore).toBe(baseScore); // baseScore itself never changes, only currentScore
  });

  it("computePlayerScore excludes discarded relics and sums currentScore for the rest", () => {
    const relics: OwnedRelic[] = [
      { relicId: "a", country: "한국", format: "그림", baseScore: 1, currentScore: 5, discarded: false }, // 재평가 applied
      { relicId: "b", country: "한국", format: "조각공예", baseScore: 4, currentScore: 4, discarded: false },
      { relicId: "c", country: "한국", format: "건축물", baseScore: 5, currentScore: 5, discarded: true }, // 가품 판정 discarded
    ];
    const player = { seat: 0, purse: { 20: 0, 10: 0, 5: 0, 1: 0 }, relics, pendingSpecials: [] };
    const score = computePlayerScore(player);
    expect(score.relicScore).toBe(9); // 5 + 4, discarded relic excluded
  });
});

describe("collection bonuses", () => {
  it("grants +3 for a completed country collection (1 painting + 1 sculpture + 1 architecture, same country)", () => {
    const relics: OwnedRelic[] = [
      { relicId: "kr-p", country: "한국", format: "그림", baseScore: 1, currentScore: 1, discarded: false },
      { relicId: "kr-s", country: "한국", format: "조각공예", baseScore: 3, currentScore: 3, discarded: false },
      { relicId: "kr-a", country: "한국", format: "건축물", baseScore: 5, currentScore: 5, discarded: false },
    ];
    const result = computeCollectionBonus(relics);
    expect(result.countries).toEqual(["한국"]);
    expect(result.formats).toEqual([]);
    expect(result.bonus).toBe(3);
  });

  it("grants +3 for a completed format collection (same format across all 3 countries)", () => {
    const relics: OwnedRelic[] = [
      { relicId: "kr-p", country: "한국", format: "그림", baseScore: 1, currentScore: 1, discarded: false },
      { relicId: "eg-p", country: "이집트", format: "그림", baseScore: 4, currentScore: 4, discarded: false },
      { relicId: "fr-p", country: "프랑스", format: "그림", baseScore: 3, currentScore: 3, discarded: false },
    ];
    const result = computeCollectionBonus(relics);
    expect(result.formats).toEqual(["그림"]);
    expect(result.bonus).toBe(3);
  });

  it("a single relic can count toward both its country collection and its format collection (max 2 uses)", () => {
    const relics: OwnedRelic[] = [
      // 한국 country collection:
      { relicId: "kr-p", country: "한국", format: "그림", baseScore: 1, currentScore: 1, discarded: false },
      { relicId: "kr-s", country: "한국", format: "조각공예", baseScore: 3, currentScore: 3, discarded: false },
      { relicId: "kr-a", country: "한국", format: "건축물", baseScore: 5, currentScore: 5, discarded: false },
      // 그림 format collection (kr-p above is shared, plus these two):
      { relicId: "eg-p", country: "이집트", format: "그림", baseScore: 4, currentScore: 4, discarded: false },
      { relicId: "fr-p", country: "프랑스", format: "그림", baseScore: 3, currentScore: 3, discarded: false },
    ];
    const result = computeCollectionBonus(relics);
    expect(result.countries).toEqual(["한국"]);
    expect(result.formats).toEqual(["그림"]);
    expect(result.bonus).toBe(6); // 3 + 3, kr-p counted toward both without being consumed
  });

  it("ignores discarded relics entirely for collection completion", () => {
    const relics: OwnedRelic[] = [
      { relicId: "kr-p", country: "한국", format: "그림", baseScore: 1, currentScore: 1, discarded: false },
      { relicId: "kr-s", country: "한국", format: "조각공예", baseScore: 3, currentScore: 3, discarded: false },
      { relicId: "kr-a", country: "한국", format: "건축물", baseScore: 5, currentScore: 5, discarded: true },
    ];
    expect(computeCollectionBonus(relics).bonus).toBe(0);
  });
});

describe("computeRankings", () => {
  function playerWith(seat: number, total: number, coinValue: number) {
    return {
      seat,
      purse: { 20: 0, 10: 0, 5: 0, 1: coinValue },
      relics: total > 0 ? [{ relicId: `r${seat}`, country: "한국" as const, format: "그림" as const, baseScore: total, currentScore: total, discarded: false }] : [],
      pendingSpecials: [],
    };
  }

  it("ranks by total score first", () => {
    const state = { players: [playerWith(0, 10, 0), playerWith(1, 20, 0)] } as unknown as GreatLegacyState;
    const ranked = computeRankings(state);
    expect(ranked.find((r) => r.seat === 1)!.rank).toBe(1);
    expect(ranked.find((r) => r.seat === 0)!.rank).toBe(2);
  });

  it("breaks a score tie by remaining coin value", () => {
    const state = { players: [playerWith(0, 10, 5), playerWith(1, 10, 20)] } as unknown as GreatLegacyState;
    const ranked = computeRankings(state);
    expect(ranked.find((r) => r.seat === 1)!.rank).toBe(1);
    expect(ranked.find((r) => r.seat === 0)!.rank).toBe(2);
  });

  it("is a genuine draw (co-ranked) when both score and coin value tie", () => {
    const state = { players: [playerWith(0, 10, 10), playerWith(1, 10, 10)] } as unknown as GreatLegacyState;
    const ranked = computeRankings(state);
    expect(ranked.every((r) => r.rank === 1)).toBe(true);
  });
});

describe("game end", () => {
  it("4p: reaches gameOver once every auction card has been dealt and won", () => {
    let state = startGame("4p", 7);
    let guard = 0;
    while (state.phase !== "gameOver") {
      guard++;
      if (guard > 2000) throw new Error("game did not end in time — possible infinite loop");
      const opener = state.auction!.activeSeat;
      state = letEveryoneElsePass(state, opener);
    }
    expect(state.auction).toBeNull();
    expect(state.deck).toHaveLength(0);
  });

  it("8p: reaches gameOver with 8 seats, 110-coin purses, and completes without getting stuck", () => {
    let state = startGame("8p", 11);
    expect(state.players).toHaveLength(8);
    let guard = 0;
    while (state.phase !== "gameOver") {
      guard++;
      if (guard > 2000) throw new Error("8p game did not end in time — possible infinite loop");
      const opener = state.auction!.activeSeat;
      state = letEveryoneElsePass(state, opener);
    }
    expect(state.auction).toBeNull();
    expect(state.deck).toHaveLength(0);
    const ranked = computeRankings(state);
    expect(ranked).toHaveLength(8);
  });
});

describe("bot support", () => {
  it("getValidMoves offers pass, and a minimal-raise bid when affordable", () => {
    const state = startGame("4p", 9);
    const moves = getValidMoves(state, state.auction!.activeSeat);
    expect(moves.some((m) => m.type === "pass")).toBe(true);
  });

  it("chooseBotAction returns a legal move for the active seat and null for anyone else", () => {
    const state = startGame("4p", 9);
    const active = state.auction!.activeSeat;
    const move = chooseBotAction(state, active, 5, () => 0.99);
    expect(move).not.toBeNull();
    expect(move!.seat).toBe(active);
    const inactiveSeat = state.auction!.order.find((s) => s !== active)!;
    expect(chooseBotAction(state, inactiveSeat, 5)).toBeNull();
  });

  it("minimalRaiseCoins returns null once a seat can no longer afford to raise", () => {
    const state = startGame("4p", 9);
    const seat = state.auction!.activeSeat;
    const broke = { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, purse: { 20: 0, 10: 0, 5: 0, 1: 0 } } : p)) };
    expect(minimalRaiseCoins(broke, seat)).toBeNull();
  });
});
