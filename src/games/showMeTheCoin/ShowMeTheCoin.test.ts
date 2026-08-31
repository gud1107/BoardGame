import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  ANTE,
  applyAction,
  chooseBotAction,
  CHIP_CONVERSION_DIVISOR,
  commitRange,
  convertedChipTotal,
  getValidMoves,
  isSeatAllIn,
  isStateSyncStale,
  MAX_COMMIT,
  opponentCommitRange,
  otherSeat,
  startGame,
  STARTING_CHIPS,
  type CoinToken,
  type EngineAction,
  type Seat,
  type ShowMeTheCoinState,
} from "./engine";

/** Deterministic coin ids from a fresh `startGame`'s fixed denomination layout (500×3 → 100×7 → 50×10 → 10×30, indices 0-based within each denomination) — see `makeStartingCoins` in engine.ts. */
function idsFor(seat: Seat, value: 500 | 100 | 50 | 10, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${seat}-${value}-${i}`);
}

function commitWith(state: ShowMeTheCoinState, seat: Seat, coinIds: string[]): ShowMeTheCoinState {
  return applyAction(state, { type: "commit", seat, coinIds });
}

/**
 * Commits BOTH seats' own 10-value coins (a plentiful, always-available
 * denomination) in the now-mandatory sequential dealer-first order, then
 * advances the resulting "countReveal" focus beat straight into "betting"
 * via `continue` — a quick way to reach "betting" deterministically without
 * caring about exact sums. Assumes `dealerSeat === "p1"`, true for every
 * `startGame(() => 0)` call in this file (`rng() < 0.5` picks p1). `p2Count`
 * must satisfy the ±1 window relative to `p1Count` (`opponentCommitRange`) —
 * callers pick counts that differ by at most 1, or the p2 commit is silently
 * rejected by `applyCommit` and the helper would return a state stuck in
 * "commit" (this is 2026-09-01's actual rule, not a test-only shortcut).
 */
function bothCommitTens(state: ShowMeTheCoinState, p1Count: number, p2Count: number): ShowMeTheCoinState {
  let s = commitWith(state, "p1", idsFor("p1", 10, p1Count));
  s = commitWith(s, "p2", idsFor("p2", 10, p2Count));
  return applyAction(s, { type: "continue" }); // countReveal -> betting
}

describe("startGame", () => {
  it("is deterministic for a given seed", () => {
    const a = startGame(seededRng(42));
    const b = startGame(seededRng(42));
    expect(a).toEqual(b);
  });

  it("deals the confirmed 30-chip stack and full 50-coin/3000-point set, then applies the mandatory 1-chip ante immediately", () => {
    const s = startGame(seededRng(1));
    expect(s.chips.p1).toBe(STARTING_CHIPS - ANTE);
    expect(s.chips.p2).toBe(STARTING_CHIPS - ANTE);
    expect(s.pot).toBe(ANTE * 2);
    expect(s.coins.p1).toHaveLength(50);
    expect(s.coins.p2).toHaveLength(50);
    expect(s.coins.p1.reduce((sum, c) => sum + c.value, 0)).toBe(3000);
    expect(s.alive).toEqual({ p1: true, p2: true });
    expect(s.phase).toBe("commit");
    expect(s.round).toBe(1);
  });
});

describe("§1 commit phase", () => {
  it("rejects the dealer's own commit outside the 2~6 coin-count range and does not touch chips/coins", () => {
    const s = startGame(() => 0); // dealer = p1
    const tooFew = commitWith(s, "p1", idsFor("p1", 10, 1));
    const tooMany = commitWith(s, "p1", idsFor("p1", 10, MAX_COMMIT + 1));
    expect(tooFew).toBe(s);
    expect(tooMany).toBe(s);
  });

  it("rejects duplicate coin ids and coin ids the seat doesn't own", () => {
    const s = startGame(() => 0);
    const duped = commitWith(s, "p1", ["p1-10-0", "p1-10-0"]);
    const notMine = commitWith(s, "p1", [...idsFor("p1", 10, 1), "p2-10-0"]);
    expect(duped).toBe(s);
    expect(notMine).toBe(s);
  });

  it("2026-09-01: rejects the non-dealer's commit before the dealer has submitted (sequential order enforced)", () => {
    const s = startGame(() => 0); // dealer = p1
    const tooEarly = commitWith(s, "p2", idsFor("p2", 10, 3));
    expect(tooEarly).toBe(s);
    expect(getValidMoves(s, "p2")).toEqual([]);
  });

  it("2026-09-01: rejects the non-dealer's commit outside the dealer's count ±1 window", () => {
    let s = startGame(() => 0); // dealer = p1
    s = commitWith(s, "p1", idsFor("p1", 10, 4)); // dealer submits 4 -> non-dealer window is [3,5]
    const tooFew = commitWith(s, "p2", idsFor("p2", 10, 2));
    const tooMany = commitWith(s, "p2", idsFor("p2", 10, 6));
    expect(tooFew).toBe(s);
    expect(tooMany).toBe(s);
    const legal = commitWith(s, "p2", idsFor("p2", 10, 5));
    expect(legal.committed.p2).toEqual(idsFor("p2", 10, 5));
  });

  it("a legal sequential commit records both submissions WITHOUT deducting chips or moving the pot (coins are not currency — see module doc), landing in countReveal, and 'continue' from there starts betting fresh", () => {
    const s = startGame(() => 0); // dealer = p1
    const afterP1 = commitWith(s, "p1", idsFor("p1", 10, 4));
    expect(afterP1.chips.p1).toBe(s.chips.p1);
    expect(afterP1.pot).toBe(s.pot);
    expect(afterP1.coins.p1).toHaveLength(50); // still owned, just marked committed
    expect(afterP1.committed.p1).toEqual(idsFor("p1", 10, 4));
    expect(afterP1.phase).toBe("commit");

    const afterP2 = commitWith(afterP1, "p2", idsFor("p2", 10, 3)); // within [3,5]
    expect(afterP2.phase).toBe("countReveal"); // §1 done — Phase 2 focus beat, not straight into betting
    expect(afterP2.committed.p2).toEqual(idsFor("p2", 10, 3));

    const startedBetting = applyAction(afterP2, { type: "continue" });
    expect(startedBetting.phase).toBe("betting");
    expect(startedBetting.actingSeat).toBe(startedBetting.dealerSeat);
    expect(startedBetting.currentBet).toBe(0);
  });

  it("ignores a second commit from the same seat", () => {
    const s = startGame(() => 0);
    const once = commitWith(s, "p1", idsFor("p1", 10, 3));
    const twice = commitWith(once, "p1", idsFor("p1", 10, 5));
    expect(twice).toBe(once);
  });

  it("clamps the dealer's own commit range down when its remaining coins are below MIN_COMMIT (forced all-in commit)", () => {
    let s = startGame(() => 0);
    const onlyOne: CoinToken[] = [{ id: "p1-10-0", value: 10 }];
    s = { ...s, coins: { ...s.coins, p1: onlyOne } };
    expect(commitRange(1)).toEqual({ min: 1, max: 1 });
    const moves = getValidMoves(s, "p1").filter((m) => m.type === "commit");
    expect(moves.every((m) => m.type === "commit" && m.coinIds.length === 1)).toBe(true);
  });

  it("commitRange returns {0,0} once a seat's coins are fully depleted", () => {
    expect(commitRange(0)).toEqual({ min: 0, max: 0 });
  });
});

describe("opponentCommitRange (2026-09-01: second submitter's ±1 legal coin-count window)", () => {
  it("widens the dealer's exact count by ±1, capped at MAX_COMMIT", () => {
    expect(opponentCommitRange(2, 50)).toEqual({ min: 1, max: 3 });
    expect(opponentCommitRange(1, 50)).toEqual({ min: 1, max: 2 }); // floors at 1, never 0 or negative
    expect(opponentCommitRange(6, 50)).toEqual({ min: 5, max: 6 }); // +1 would be 7, clamped to MAX_COMMIT
  });

  it("clamps further down to whatever's actually available when the non-dealer is short on coins", () => {
    expect(opponentCommitRange(6, 3)).toEqual({ min: 3, max: 3 }); // window [5,6] both exceed the 3 available -> forced "everything left"
    expect(opponentCommitRange(2, 0)).toEqual({ min: 0, max: 0 });
  });
});

describe("§2 betting phase", () => {
  it("getValidMoves only offers actions to the acting seat", () => {
    const s = bothCommitTens(startGame(() => 0), 3, 4); // dealerSeat = p1 (rng()=0 < 0.5)
    expect(getValidMoves(s, otherSeat(s.dealerSeat))).toEqual([]);
    const mine = getValidMoves(s, s.dealerSeat);
    expect(mine.some((m) => m.type === "fold")).toBe(true);
    expect(mine.some((m) => m.type === "call")).toBe(true);
    expect(mine.some((m) => m.type === "raise")).toBe(true);
  });

  it("a free check (call with nothing owed) passes the turn without moving chips", () => {
    const s = bothCommitTens(startGame(() => 0), 3, 4);
    const afterCheck = applyAction(s, { type: "call" });
    expect(afterCheck.pot).toBe(s.pot);
    expect(afterCheck.actingSeat).toBe(otherSeat(s.dealerSeat));
    expect(afterCheck.phase).toBe("betting");
  });

  it("check-check resolves the showdown", () => {
    const s = bothCommitTens(startGame(() => 0), 3, 4);
    const afterFirstCheck = applyAction(s, { type: "call" });
    const afterSecondCheck = applyAction(afterFirstCheck, { type: "call" });
    expect(afterSecondCheck.phase).toBe("showdown");
    expect(afterSecondCheck.lastRoundResult).not.toBeNull();
  });

  it("a raise must exceed the current bet and is capped by the raiser's remaining chip stack", () => {
    const s = bothCommitTens(startGame(() => 0), 3, 4);
    const seat = s.dealerSeat;
    const tooLow = applyAction(s, { type: "raise", amount: 0 });
    expect(tooLow).toBe(s);
    const overStack = applyAction(s, { type: "raise", amount: s.chips[seat] + 1 });
    expect(overStack).toBe(s);
    const legal = applyAction(s, { type: "raise", amount: 5 });
    expect(legal.chips[seat]).toBe(s.chips[seat] - 5);
    expect(legal.pot).toBe(s.pot + 5);
    expect(legal.currentBet).toBe(5);
    expect(legal.actingSeat).toBe(otherSeat(seat));
  });

  it("call-for-less is allowed when the caller is short-stacked, and still resolves the showdown", () => {
    let s = startGame(() => 0); // dealer = p1
    s = { ...s, chips: { p1: 10, p2: 10 } };
    s = commitWith(s, "p1", idsFor("p1", 50, 2)); // dealer's hand (sum 100) decisively beats p2's — not a tie, so the tie-split doesn't hand chips back to the loser
    s = commitWith(s, "p2", idsFor("p2", 10, 2)); // sum 20
    s = applyAction(s, { type: "continue" }); // countReveal -> betting
    const dealer = s.dealerSeat;
    const other = otherSeat(dealer);
    s = applyAction(s, { type: "raise", amount: s.chips[dealer] }); // dealer shoves remaining chips
    expect(s.chips[dealer]).toBe(0);
    s = { ...s, chips: { ...s.chips, [other]: 3 } }; // shrink further to prove call-for-less
    const afterCall = applyAction(s, { type: "call" });
    expect(afterCall.chips[other]).toBe(0); // other lost the showdown, so nothing comes back
    expect(afterCall.lastRoundResult?.winnerSeat).toBe(dealer);
    expect(afterCall.phase === "showdown" || afterCall.phase === "gameOver").toBe(true);
  });

  it("folding awards the entire chip pot to the opponent, discards BOTH seats' coins, and never reveals either commit", () => {
    const s = bothCommitTens(startGame(() => 0), 5, 4);
    const dealer = s.dealerSeat;
    const other = otherSeat(dealer);
    const potBefore = s.pot;
    const dealerCoinsBefore = s.coins[dealer].length;
    const otherCoinsBefore = s.coins[other].length;
    const afterFold = applyAction(s, { type: "fold" });
    expect(afterFold.phase === "showdown" || afterFold.phase === "gameOver").toBe(true);
    expect(afterFold.chips[other]).toBe(s.chips[other] + potBefore);
    expect(afterFold.pot).toBe(0);
    expect(afterFold.lastRoundResult?.outcome).toBe("fold");
    expect(afterFold.lastRoundResult?.committed).toBeNull();
    expect(afterFold.lastRoundResult?.winnerSeat).toBe(other);
    expect(afterFold.lastRoundResult?.folderSeat).toBe(dealer);
    // §4 step 4: submitted coins are discarded win/tie/fold alike, including the fold-winner's own unrevealed hand.
    expect(afterFold.coins[dealer].length).toBe(dealerCoinsBefore - 5);
    expect(afterFold.coins[other].length).toBe(otherCoinsBefore - 4);
  });
});

describe("§3 showdown", () => {
  it("awards the pot to whoever submitted the higher coin sum, and discards both seats' submitted coins", () => {
    const s = bothCommitTens(startGame(() => 0), 6, 5); // p1 submits 6×10=60, p2 submits 5×10=50 -> p1 wins
    const afterCheck1 = applyAction(s, { type: "call" });
    const resolved = applyAction(afterCheck1, { type: "call" });
    expect(resolved.lastRoundResult?.outcome).toBe("win");
    expect(resolved.lastRoundResult?.winnerSeat).toBe("p1");
    expect(resolved.pot).toBe(0);
    expect(resolved.chips.p1).toBe(s.chips.p1 + s.pot); // winner gains the chip pot...
    expect(resolved.coins.p1).toHaveLength(s.coins.p1.length - 6); // ...but never gets its own submitted coins back
    expect(resolved.coins.p2).toHaveLength(s.coins.p2.length - 5);
  });

  it("a tie splits the chip pot evenly and carries the odd remainder into the next round", () => {
    let s = startGame(() => 0);
    s = { ...s, chips: { p1: s.chips.p1 + 1, p2: s.chips.p2 } }; // makes the pre-bet pot odd (2*ANTE+1) to exercise the remainder path
    s = { ...s, pot: s.pot + 1 };
    s = bothCommitTens(s, 4, 4); // equal sums -> tie
    const afterCheck1 = applyAction(s, { type: "call" });
    const resolved = applyAction(afterCheck1, { type: "call" });
    expect(resolved.lastRoundResult?.outcome).toBe("tie");
    expect(resolved.lastRoundResult?.winnerSeat).toBeNull();
    const share = Math.floor(s.pot / 2);
    expect(resolved.chips.p1).toBe(s.chips.p1 + share);
    expect(resolved.chips.p2).toBe(s.chips.p2 + share);
    expect(resolved.pot).toBe(s.pot - share * 2); // the odd leftover carries forward, NOT reset to 0
    expect(resolved.lastRoundResult?.carriedOver).toBe(s.pot - share * 2);

    const nextRound = applyAction(resolved, { type: "continue" });
    expect(nextRound.round).toBe(2);
    expect(nextRound.phase).toBe("commit");
    expect(nextRound.pot).toBe(resolved.pot + ANTE * 2); // carried remainder + this round's fresh ante
  });

  it("'continue' is a no-op outside countReveal/showdown, and advances showdown->next round with dealer alternate + fresh ante on success", () => {
    const s = startGame(() => 0);
    expect(applyAction(s, { type: "continue" })).toBe(s); // still "commit" — no-op

    const raised = applyAction(bothCommitTens(startGame(() => 0), 4, 3), { type: "raise", amount: 5 });
    const decisive = applyAction(raised, { type: "call" });
    expect(decisive.phase === "showdown" || decisive.phase === "gameOver").toBe(true);
    if (decisive.phase === "showdown") {
      const next = applyAction(decisive, { type: "continue" });
      expect(next.dealerSeat).toBe(otherSeat(decisive.dealerSeat));
      expect(next.committed).toEqual({});
      expect(next.chips.p1).toBe(decisive.chips.p1 - ANTE);
      expect(next.chips.p2).toBe(decisive.chips.p2 - ANTE);
    }
  });
});

describe("KO / gameOver", () => {
  it("파산 탈락: only ends the game once a resolved hand actually leaves a seat bankrupt (never mid-hand while chips are at risk)", () => {
    let s = startGame(() => 0); // dealerSeat = p1
    s = { ...s, chips: { p1: 2, p2: 6 } };
    s = bothCommitTens(s, 2, 3); // p1 submits 2x10=20, p2 submits 3x10=30 -> p2 will win
    s = applyAction(s, { type: "raise", amount: 2 }); // p1 (dealer) shoves its remaining 2 chips
    expect(s.chips.p1).toBe(0);
    // Still mid-hand (betting phase) — must NOT be gameOver yet even though p1 is already at 0 chips.
    expect(s.phase).toBe("betting");
    const resolved = applyAction(s, { type: "call" }); // p2 calls, closes betting -> showdown
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winner).toBe("p2");
    expect(resolved.chips.p1).toBe(0);
    expect(resolved.alive.p1).toBe(false);
  });

  it("코인 고갈: a seat with plenty of chips left is still eliminated once its coin hand fully depletes", () => {
    let s = startGame(() => 0);
    const lastTwo: CoinToken[] = [
      { id: "p1-10-0", value: 10 },
      { id: "p1-10-1", value: 10 },
    ];
    s = { ...s, coins: { ...s.coins, p1: lastTwo } };
    expect(s.chips.p1).toBeGreaterThan(0);
    s = commitWith(s, "p1", ["p1-10-0", "p1-10-1"]); // p1's only 2 remaining coins, sum 20
    s = commitWith(s, "p2", idsFor("p2", 100, 2)); // p2 submits sum 200, decisively higher
    s = applyAction(s, { type: "continue" }); // countReveal -> betting
    const afterCheck1 = applyAction(s, { type: "call" });
    const resolved = applyAction(afterCheck1, { type: "call" });
    expect(resolved.coins.p1).toHaveLength(0);
    expect(resolved.chips.p1).toBeGreaterThan(0); // NOT bankrupt — eliminated by coin exhaustion instead
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winner).toBe("p2");
    expect(resolved.alive.p1).toBe(false);
  });

  it("a tie that leaves both seats coin-depleted simultaneously ends the match as a draw (a tied chip pot instead splits back to both — see 코인 고갈 test above for why this is the realistic 'both eliminated' path)", () => {
    let s = startGame(() => 0);
    const p1Last: CoinToken[] = [
      { id: "p1-10-0", value: 10 },
      { id: "p1-10-1", value: 10 },
    ];
    const p2Last: CoinToken[] = [
      { id: "p2-10-0", value: 10 },
      { id: "p2-10-1", value: 10 },
    ];
    s = { ...s, coins: { p1: p1Last, p2: p2Last } };
    s = commitWith(s, "p1", ["p1-10-0", "p1-10-1"]);
    s = commitWith(s, "p2", ["p2-10-0", "p2-10-1"]); // equal sums -> tie
    s = applyAction(s, { type: "continue" }); // countReveal -> betting
    const afterCheck1 = applyAction(s, { type: "call" });
    const resolved = applyAction(afterCheck1, { type: "call" });
    expect(resolved.lastRoundResult?.outcome).toBe("tie");
    expect(resolved.coins).toEqual({ p1: [], p2: [] });
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winner).toBeNull();
    expect(resolved.alive).toEqual({ p1: false, p2: false });
  });

  it("getValidMoves returns [] for every seat once the game is over", () => {
    let s = startGame(() => 0); // dealer p1
    s = { ...s, chips: { p1: 2, p2: 2 } };
    s = commitWith(s, "p1", idsFor("p1", 10, 2)); // sum 20 — will lose
    s = commitWith(s, "p2", idsFor("p2", 50, 2)); // sum 100 — will win
    s = applyAction(s, { type: "continue" }); // countReveal -> betting
    s = applyAction(s, { type: "raise", amount: 2 }); // p1 (dealer) shoves both remaining chips
    const resolved = applyAction(s, { type: "call" }); // p2 calls -> showdown, p2 wins, p1 busts
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winner).toBe("p2");
    expect(getValidMoves(resolved, "p1")).toEqual([]);
    expect(getValidMoves(resolved, "p2")).toEqual([]);
    expect(applyAction(resolved, { type: "continue" })).toBe(resolved);
  });
});

describe("베팅 UI/FX rebuild (2026-08-31 follow-up) — totalBet / isSeatAllIn / chip-conversion HUD formula", () => {
  it("totalBet starts at the mandatory ante and keeps accumulating every bet/raise/call, never resetting across rounds", () => {
    let s = startGame(() => 0); // dealer = p1
    expect(s.totalBet).toEqual({ p1: ANTE, p2: ANTE });

    s = bothCommitTens(s, 4, 3);
    const dealer = s.dealerSeat;
    const other = otherSeat(dealer);
    s = applyAction(s, { type: "raise", amount: 5 });
    expect(s.totalBet[dealer]).toBe(ANTE + 5);
    s = applyAction(s, { type: "call" }); // other calls to 5, resolves showdown
    expect(s.totalBet[other]).toBe(ANTE + 5);
    expect(s.phase === "showdown" || s.phase === "gameOver").toBe(true);

    if (s.phase === "showdown") {
      const dealerTotalBeforeContinue = s.totalBet[dealer];
      const otherTotalBeforeContinue = s.totalBet[other];
      const next = applyAction(s, { type: "continue" }); // fresh ante for round 2
      expect(next.totalBet[dealer]).toBe(dealerTotalBeforeContinue + ANTE);
      expect(next.totalBet[other]).toBe(otherTotalBeforeContinue + ANTE);
    }
  });

  it("isSeatAllIn is true only once a seat's chip stack is actually at 0", () => {
    let s = startGame(() => 0);
    s = bothCommitTens(s, 3, 3);
    const seat = s.dealerSeat;
    expect(isSeatAllIn(s, seat)).toBe(false);
    s = applyAction(s, { type: "raise", amount: s.chips[seat] }); // shove the whole stack
    expect(s.chips[seat]).toBe(0);
    expect(isSeatAllIn(s, seat)).toBe(true);
    expect(isSeatAllIn(s, otherSeat(seat))).toBe(false);
  });

  it("convertedChipTotal divides the 500-excluded remaining coin count by 20 (confirmed formula — see ShowMeTheCoinBoard.tsx's doc)", () => {
    expect(CHIP_CONVERSION_DIVISOR).toBe(20);
    expect(convertedChipTotal(47)).toBeCloseTo(2.35);
    expect(convertedChipTotal(0)).toBe(0);
    expect(convertedChipTotal(20)).toBe(1);
  });
});

describe("isStateSyncStale", () => {
  it("accepts the first sync (current === null) and rejects one strictly behind the current seq", () => {
    const s = bothCommitTens(startGame(() => 0), 3, 3);
    expect(isStateSyncStale(null, s)).toBe(false);
    const older = { ...s, seq: s.seq - 1 };
    expect(isStateSyncStale(s, older)).toBe(true);
    expect(isStateSyncStale(older, s)).toBe(false);
  });
});

describe("AI bot support (ARCHITECTURE.md §7)", () => {
  it("chooseBotAction always returns a legal, non-null move whenever getValidMoves is non-empty", () => {
    const seats: Seat[] = ["p1", "p2"];
    for (const level of [1, 5, 10]) {
      let s = startGame(seededRng(level));
      for (let i = 0; i < 400 && s.phase !== "gameOver"; i++) {
        for (const seat of seats) {
          const legal = getValidMoves(s, seat);
          if (legal.length === 0) continue;
          const action = chooseBotAction(s, seat, level, seededRng(i + level));
          expect(action).not.toBeNull();
          expect(legal).toContainEqual(action);
          s = applyAction(s, action as EngineAction);
          break; // exactly one seat can legally act at a time in this engine
        }
      }
    }
  });

  it("Lv.1 (forced-mistake rng) and Lv.10 (argmax rng) diverge on the same betting decision", () => {
    const s = bothCommitTens(startGame(() => 0), 6, 5); // dealer's own hand (6x10=60) is strong -> raise should score best
    const dealer = s.dealerSeat;
    const alwaysZero = () => 0; // Lv.1: rng()=0 < mistake chance -> random pick (first candidate = "fold"); Lv.10: 0% mistake chance -> argmax
    const lv1 = chooseBotAction(s, dealer, 1, alwaysZero);
    const lv10 = chooseBotAction(s, dealer, 10, alwaysZero);
    expect(lv1).toEqual({ type: "fold" }); // random-pick path always lands on the first legal candidate
    expect(lv10).not.toEqual({ type: "fold" }); // argmax path — a strong hand should never fold for free
  });

  it("two bots (Lv.5 vs Lv.5) can play an entire match to completion without an infinite loop", () => {
    let s = startGame(seededRng(7));
    let guard = 0;
    while (s.phase !== "gameOver" && guard < 5000) {
      guard++;
      const seat: Seat = getValidMoves(s, "p1").length > 0 ? "p1" : "p2";
      const action = chooseBotAction(s, seat, 5, seededRng(guard));
      if (!action) break;
      s = applyAction(s, action);
    }
    expect(s.phase).toBe("gameOver");
    expect(guard).toBeLessThan(5000);
    const winner = s.winner as Seat;
    const loser = otherSeat(winner);
    expect(s.chips[loser] <= 0 || s.coins[loser].length === 0).toBe(true);
  });
});
