import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  chooseBotAction,
  getValidMoves,
  isStateSyncStale,
  otherSeat,
  startGame,
  STARTING_COINS,
  type EngineAction,
  type Seat,
  type ShowMeTheCoinState,
} from "./engine";

function bothCommit(state: ShowMeTheCoinState, p1Amount: number, p2Amount: number): ShowMeTheCoinState {
  let s = applyAction(state, { type: "commit", seat: "p1", amount: p1Amount });
  s = applyAction(s, { type: "commit", seat: "p2", amount: p2Amount });
  return s;
}

describe("startGame", () => {
  it("is deterministic for a given seed", () => {
    const a = startGame(seededRng(42));
    const b = startGame(seededRng(42));
    expect(a).toEqual(b);
  });

  it("deals the confirmed starting stack to both seats", () => {
    const s = startGame(seededRng(1));
    expect(s.stacks.p1).toBe(STARTING_COINS);
    expect(s.stacks.p2).toBe(STARTING_COINS);
    expect(s.alive).toEqual({ p1: true, p2: true });
    expect(s.phase).toBe("commit");
    expect(s.round).toBe(1);
  });
});

describe("§1 commit phase", () => {
  it("rejects a commit outside the 2~6 range and does not deduct the stack", () => {
    const s = startGame(() => 0);
    const tooLow = applyAction(s, { type: "commit", seat: "p1", amount: 1 });
    const tooHigh = applyAction(s, { type: "commit", seat: "p1", amount: 7 });
    expect(tooLow).toBe(s);
    expect(tooHigh).toBe(s);
  });

  it("deducts the commit from the stack and adds it to the pot, staying in 'commit' until both seats have committed", () => {
    const s = startGame(() => 0);
    const afterP1 = applyAction(s, { type: "commit", seat: "p1", amount: 4 });
    expect(afterP1.stacks.p1).toBe(STARTING_COINS - 4);
    expect(afterP1.pot).toBe(4);
    expect(afterP1.phase).toBe("commit");

    const afterP2 = applyAction(afterP1, { type: "commit", seat: "p2", amount: 3 });
    expect(afterP2.pot).toBe(7);
    expect(afterP2.phase).toBe("betting");
    expect(afterP2.actingSeat).toBe(afterP2.dealerSeat);
  });

  it("ignores a second commit from the same seat", () => {
    const s = startGame(() => 0);
    const once = applyAction(s, { type: "commit", seat: "p1", amount: 3 });
    const twice = applyAction(once, { type: "commit", seat: "p1", amount: 5 });
    expect(twice).toBe(once);
  });

  it("clamps the commit range down when a seat's stack is below MIN_COMMIT (forced all-in commit)", () => {
    let s = startGame(() => 0);
    // Drain p1's stack to 1 by looping full 30-coin rounds where p1 always
    // commits/folds away everything — simplest is to directly synthesize the
    // state via getValidMoves' own clamp logic instead of a long playthrough.
    s = { ...s, stacks: { ...s.stacks, p1: 1 } };
    const moves = getValidMoves(s, "p1").filter((m) => m.type === "commit");
    expect(moves).toEqual([{ type: "commit", seat: "p1", amount: 1 }]);
  });
});

describe("§2 betting phase", () => {
  it("getValidMoves only offers actions to the acting seat", () => {
    const s = bothCommit(startGame(() => 0), 3, 4); // dealerSeat = p1 (rng()=0 < 0.5)
    expect(getValidMoves(s, otherSeat(s.dealerSeat))).toEqual([]);
    const mine = getValidMoves(s, s.dealerSeat);
    expect(mine.some((m) => m.type === "fold")).toBe(true);
    expect(mine.some((m) => m.type === "call")).toBe(true);
    expect(mine.some((m) => m.type === "raise")).toBe(true);
  });

  it("a free check (call with nothing owed) passes the turn without moving coins", () => {
    const s = bothCommit(startGame(() => 0), 3, 4);
    const afterCheck = applyAction(s, { type: "call" });
    expect(afterCheck.pot).toBe(s.pot);
    expect(afterCheck.actingSeat).toBe(otherSeat(s.dealerSeat));
    expect(afterCheck.phase).toBe("betting");
  });

  it("check-check resolves the showdown", () => {
    const s = bothCommit(startGame(() => 0), 3, 4);
    const afterFirstCheck = applyAction(s, { type: "call" });
    const afterSecondCheck = applyAction(afterFirstCheck, { type: "call" });
    expect(afterSecondCheck.phase).toBe("showdown");
    expect(afterSecondCheck.lastRoundResult).not.toBeNull();
  });

  it("a raise must exceed the current bet and is capped by the raiser's remaining stack", () => {
    const s = bothCommit(startGame(() => 0), 3, 4);
    const seat = s.dealerSeat;
    const tooLow = applyAction(s, { type: "raise", amount: 0 });
    expect(tooLow).toBe(s);
    const overStack = applyAction(s, { type: "raise", amount: s.stacks[seat] + 1 });
    expect(overStack).toBe(s);
    const legal = applyAction(s, { type: "raise", amount: 5 });
    expect(legal.stacks[seat]).toBe(s.stacks[seat] - 5);
    expect(legal.pot).toBe(s.pot + 5);
    expect(legal.currentBet).toBe(5);
    expect(legal.actingSeat).toBe(otherSeat(seat));
  });

  it("call-for-less is allowed when the caller is short-stacked, and still resolves the showdown", () => {
    let s = startGame(() => 0);
    s = { ...s, stacks: { p1: 10, p2: 10 } };
    s = bothCommit(s, 2, 2); // stacks now p1:8, p2:8, pot 4
    const dealer = s.dealerSeat;
    const other = otherSeat(dealer);
    s = applyAction(s, { type: "raise", amount: 8 }); // dealer shoves remaining 8
    expect(s.stacks[dealer]).toBe(0);
    // other seat only has 8 too, but let's shrink it further to prove call-for-less
    s = { ...s, stacks: { ...s.stacks, [other]: 3 } };
    const afterCall = applyAction(s, { type: "call" });
    expect(afterCall.stacks[other]).toBe(0);
    expect(afterCall.phase === "showdown" || afterCall.phase === "gameOver").toBe(true);
  });

  it("folding awards the entire pot to the opponent without revealing either commit", () => {
    const s = bothCommit(startGame(() => 0), 5, 2);
    const dealer = s.dealerSeat;
    const other = otherSeat(dealer);
    const potBefore = s.pot;
    const afterFold = applyAction(s, { type: "fold" });
    expect(afterFold.phase === "showdown" || afterFold.phase === "gameOver").toBe(true);
    expect(afterFold.stacks[other]).toBe(s.stacks[other] + potBefore);
    expect(afterFold.lastRoundResult?.outcome).toBe("fold");
    expect(afterFold.lastRoundResult?.committed).toBeNull();
    expect(afterFold.lastRoundResult?.winnerSeat).toBe(other);
    expect(afterFold.lastRoundResult?.folderSeat).toBe(dealer);
  });
});

describe("§3 showdown", () => {
  it("awards the pot to whoever committed the higher amount", () => {
    const s = bothCommit(startGame(() => 0), 6, 2); // p1 commits more
    const afterCheck1 = applyAction(s, { type: "call" });
    const resolved = applyAction(afterCheck1, { type: "call" });
    expect(resolved.lastRoundResult?.outcome).toBe("win");
    expect(resolved.lastRoundResult?.winnerSeat).toBe("p1");
    expect(resolved.pot).toBe(0);
    expect(resolved.stacks.p1).toBeGreaterThan(STARTING_COINS - 6); // p1 got the pot back plus profit
  });

  it("a tie carries the pot into the next round instead of resetting it", () => {
    const s = bothCommit(startGame(() => 0), 4, 4);
    const afterCheck1 = applyAction(s, { type: "call" });
    const resolved = applyAction(afterCheck1, { type: "call" });
    expect(resolved.lastRoundResult?.outcome).toBe("tie");
    expect(resolved.lastRoundResult?.winnerSeat).toBeNull();
    expect(resolved.pot).toBe(8); // NOT reset to 0

    const nextRound = applyAction(resolved, { type: "continue" });
    expect(nextRound.round).toBe(2);
    expect(nextRound.phase).toBe("commit");
    expect(nextRound.pot).toBe(8); // still carried

    const bothCommittedAgain = bothCommit(nextRound, 2, 2);
    expect(bothCommittedAgain.pot).toBe(12); // 8 carried + 2 + 2
  });

  it("'continue' is a no-op outside the showdown phase, and moves commit->betting seats + dealer alternate on success", () => {
    const s = startGame(() => 0);
    expect(applyAction(s, { type: "continue" })).toBe(s);

    const resolved = applyAction(bothCommit(s, 4, 3), { type: "call" }); // dealer checks first... wait dealer already acted via bothCommit's transition; use call to check then resolve
    // Force a decisive showdown quickly: p1 raises, p2 calls.
    const raised = applyAction(bothCommit(startGame(() => 0), 4, 3), { type: "raise", amount: 5 });
    const decisive = applyAction(raised, { type: "call" });
    expect(decisive.phase === "showdown" || decisive.phase === "gameOver").toBe(true);
    if (decisive.phase === "showdown") {
      const next = applyAction(decisive, { type: "continue" });
      expect(next.dealerSeat).toBe(otherSeat(decisive.dealerSeat));
      expect(next.committed).toEqual({});
    }
    void resolved;
  });
});

describe("KO / gameOver", () => {
  it("only ends the game once a resolved hand actually leaves a seat at 0 coins (never mid-hand while at risk)", () => {
    let s = startGame(() => 0); // dealerSeat = p1
    s = { ...s, stacks: { p1: 2, p2: 6 } };
    s = bothCommit(s, 2, 3); // p1 forced all-in (clamped to its 2-coin stack) -> stack 0; p2 -> stack 3, pot 5
    expect(s.stacks.p1).toBe(0);
    // Still mid-hand (betting phase) — must NOT be gameOver yet even though p1 is already at 0.
    expect(s.phase).toBe("betting");
    const afterFirstCheck = applyAction(s, { type: "call" }); // p1 (dealer)'s opening check — just passes the turn
    expect(afterFirstCheck.phase).toBe("betting");
    const resolved = applyAction(afterFirstCheck, { type: "call" }); // p2's second check closes betting -> showdown
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winner).toBe("p2"); // p2 committed more (3 > 2)
    expect(resolved.stacks.p1).toBe(0);
    expect(resolved.alive.p1).toBe(false);
  });

  it("a tie that leaves both seats at 0 (both all-in on an equal secret commit) ends the match as a draw", () => {
    let s = startGame(() => 0);
    s = { ...s, stacks: { p1: 6, p2: 6 } };
    s = bothCommit(s, 6, 6); // both go all-in on an equal secret commit — stacks now 0/0, pot 12
    expect(s.phase).toBe("betting"); // still mid-hand despite both stacks already at 0
    const afterFirstCheck = applyAction(s, { type: "call" });
    const resolved = applyAction(afterFirstCheck, { type: "call" });
    expect(resolved.lastRoundResult?.outcome).toBe("tie");
    expect(resolved.phase).toBe("gameOver");
    expect(resolved.winner).toBeNull();
    expect(resolved.alive).toEqual({ p1: false, p2: false });
  });

  it("getValidMoves returns [] for every seat once the game is over", () => {
    let s = startGame(() => 0);
    s = { ...s, stacks: { p1: 2, p2: 2 } };
    s = bothCommit(s, 2, 2);
    const resolved = applyAction(applyAction(s, { type: "call" }), { type: "call" });
    expect(resolved.phase).toBe("gameOver");
    expect(getValidMoves(resolved, "p1")).toEqual([]);
    expect(getValidMoves(resolved, "p2")).toEqual([]);
    expect(applyAction(resolved, { type: "continue" })).toBe(resolved);
  });
});

describe("isStateSyncStale", () => {
  it("accepts the first sync (current === null) and rejects one strictly behind the current seq", () => {
    const s = bothCommit(startGame(() => 0), 3, 3);
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
    const s = bothCommit(startGame(() => 0), 6, 2); // dealer's own commit is strong (6) -> raise should score best
    const dealer = s.dealerSeat;
    const alwaysZero = () => 0; // Lv.1: rng()=0 < mistake chance -> random pick (first candidate = "fold"); Lv.10: rng()=0 < 0% mistake chance -> argmax
    const lv1 = chooseBotAction(s, dealer, 1, alwaysZero);
    const lv10 = chooseBotAction(s, dealer, 10, alwaysZero);
    expect(lv1).toEqual({ type: "fold" }); // random-pick path always lands on the first legal candidate
    expect(lv10).not.toEqual({ type: "fold" }); // argmax path — a strong 6-commit should never fold for free
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
    expect(s.stacks[otherSeat(winner)]).toBe(0);
  });
});
