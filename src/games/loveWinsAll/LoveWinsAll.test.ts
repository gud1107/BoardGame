import { describe, expect, it } from "vitest";
import {
  ANTE_PER_ROUND,
  applyAction,
  chooseBotAction,
  currentActor,
  getValidMoves,
  isStateSyncStale,
  MAX_TIE_ROUNDS,
  otherSeat,
  startGame,
  type EngineAction,
  type LoveWinsAllState,
  type Seat,
} from "./engine";

function bothChoose(state: LoveWinsAllState, p1: "LOVE" | "WAR", p2: "LOVE" | "WAR"): LoveWinsAllState {
  let s = applyAction(state, { type: "choose", seat: "p1", choice: p1 });
  s = applyAction(s, { type: "choose", seat: "p2", choice: p2 });
  return s;
}

describe("startGame", () => {
  it("is deterministic", () => {
    expect(startGame()).toEqual(startGame());
  });

  it("starts round 1 in the choice phase with the confirmed opening ante", () => {
    const s = startGame();
    expect(s.round).toBe(1);
    expect(s.phase).toBe("choice");
    expect(s.pot).toBe(ANTE_PER_ROUND);
    expect(s.choices).toEqual({});
    expect(s.matchOutcome).toBeNull();
  });
});

describe("secret choice phase", () => {
  it("stays in 'choice' until both seats have picked, and rejects a second pick from the same seat", () => {
    const s = startGame();
    const afterP1 = applyAction(s, { type: "choose", seat: "p1", choice: "LOVE" });
    expect(afterP1.phase).toBe("choice");
    expect(afterP1.choices).toEqual({ p1: "LOVE" });

    const repeat = applyAction(afterP1, { type: "choose", seat: "p1", choice: "WAR" });
    expect(repeat).toBe(afterP1); // no-op, first pick sticks
  });

  it("getValidMoves offers LOVE/WAR only to a seat that hasn't chosen yet", () => {
    const s = applyAction(startGame(), { type: "choose", seat: "p1", choice: "LOVE" });
    expect(getValidMoves(s, "p1")).toEqual([]);
    expect(getValidMoves(s, "p2")).toEqual([
      { type: "choose", seat: "p2", choice: "LOVE" },
      { type: "choose", seat: "p2", choice: "WAR" },
    ]);
  });

  it("currentActor tracks whichever seat is still pending, and is null once both have chosen (mid-resolve) or off-phase", () => {
    expect(currentActor(startGame())).toBe("p1");
    const afterP1 = applyAction(startGame(), { type: "choose", seat: "p1", choice: "LOVE" });
    expect(currentActor(afterP1)).toBe("p2");
    const resolved = bothChoose(startGame(), "LOVE", "WAR");
    expect(currentActor(resolved)).toBeNull(); // "gameOver" (decisive) — not a pending seat decision
  });
});

describe("betrayal (one LOVE, one WAR)", () => {
  it("awards the whole pot to the WAR seat and ends the match immediately", () => {
    const s = bothChoose(startGame(), "LOVE", "WAR");
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("p2");
    expect(s.matchOutcome).toBe("p2");
    expect(s.lastRoundResult?.outcome).toBe("betrayal");
    expect(s.lastRoundResult?.winnerSeat).toBe("p2");
    expect(s.lastRoundResult?.potWon).toBe(ANTE_PER_ROUND);
    expect(s.pot).toBe(0);
  });

  it("is symmetric regardless of which seat betrays", () => {
    const s = bothChoose(startGame(), "WAR", "LOVE");
    expect(s.winner).toBe("p1");
    expect(s.matchOutcome).toBe("p1");
  });
});

describe("mutual WAR (both betray)", () => {
  it("ends the match as a mutual defeat and forfeits the pot", () => {
    const s = bothChoose(startGame(), "WAR", "WAR");
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBeNull();
    expect(s.matchOutcome).toBe("mutualDefeat");
    expect(s.lastRoundResult?.outcome).toBe("mutualWar");
    expect(s.pot).toBe(0);
  });
});

describe("mutual LOVE (tie -> rematch)", () => {
  it("carries the pot, does not end the match, and 'continue' replays with a topped-up pot", () => {
    const s = bothChoose(startGame(), "LOVE", "LOVE");
    expect(s.phase).toBe("reveal");
    expect(s.matchOutcome).toBeNull();
    expect(s.lastRoundResult?.outcome).toBe("mutualLove");
    expect(s.pot).toBe(ANTE_PER_ROUND); // carried, not reset

    const next = applyAction(s, { type: "continue" });
    expect(next.round).toBe(2);
    expect(next.phase).toBe("choice");
    expect(next.choices).toEqual({});
    expect(next.pot).toBe(ANTE_PER_ROUND * 2); // carried + topped up
    expect(next.lastRoundResult).toBeNull();
  });

  it("'continue' is a no-op outside the 'reveal' phase", () => {
    const s = startGame();
    expect(applyAction(s, { type: "continue" })).toBe(s);
  });

  it("resolves as a mutual victory once MAX_TIE_ROUNDS is reached instead of replaying forever", () => {
    let s = startGame();
    for (let round = 1; round < MAX_TIE_ROUNDS; round++) {
      const revealed = bothChoose(s, "LOVE", "LOVE");
      expect(revealed.phase).toBe("reveal"); // not final yet
      s = applyAction(revealed, { type: "continue" });
    }
    expect(s.round).toBe(MAX_TIE_ROUNDS);
    const final = bothChoose(s, "LOVE", "LOVE");
    expect(final.phase).toBe("gameOver");
    expect(final.matchOutcome).toBe("mutualVictory");
    expect(final.winner).toBeNull();
  });
});

describe("gameOver / no-op guards", () => {
  it("every action is a no-op once the match is over", () => {
    const s = bothChoose(startGame(), "WAR", "LOVE");
    expect(applyAction(s, { type: "choose", seat: "p1", choice: "LOVE" })).toBe(s);
    expect(applyAction(s, { type: "continue" })).toBe(s);
    expect(getValidMoves(s, "p1")).toEqual([]);
    expect(getValidMoves(s, "p2")).toEqual([]);
  });
});

describe("isStateSyncStale", () => {
  it("accepts the first sync (current === null) and rejects one strictly behind the current seq", () => {
    const s = applyAction(startGame(), { type: "choose", seat: "p1", choice: "LOVE" });
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

describe("AI bot support (ARCHITECTURE.md §7)", () => {
  it("chooseBotAction always returns a legal, non-null move whenever getValidMoves is non-empty", () => {
    const seats: Seat[] = ["p1", "p2"];
    for (const level of [1, 5, 10]) {
      let s = startGame();
      let guard = 0;
      while (s.phase !== "gameOver" && guard < 200) {
        guard++;
        for (const seat of seats) {
          const legal = getValidMoves(s, seat);
          if (legal.length === 0) continue;
          const action = chooseBotAction(s, seat, level, () => 0.99); // rng near 1 -> avoid the mistake branch, exercise the scored pick
          expect(action).not.toBeNull();
          expect(legal).toContainEqual(action);
          s = applyAction(s, action as EngineAction);
        }
        if (s.phase === "reveal") s = applyAction(s, { type: "continue" });
      }
      expect(guard).toBeLessThan(200);
    }
  });

  it("an expert bot (Lv.10) grows more willing to defect as the round number rises", () => {
    // Lv.10 has a 0% mistake chance and a 0 tie-margin (botDifficulty.ts), so
    // its pick is a deterministic argmax over scoreMove — any rng works.
    let s = startGame();
    expect(chooseBotAction(s, "p1", 10, () => 0.5)).toEqual({ type: "choose", seat: "p1", choice: "LOVE" }); // round 1: temptation is low, LOVE clearly scores higher

    for (let i = 0; i < MAX_TIE_ROUNDS - 1; i++) {
      s = applyAction(bothChoose(s, "LOVE", "LOVE"), { type: "continue" });
    }
    expect(s.round).toBe(MAX_TIE_ROUNDS);
    expect(chooseBotAction(s, "p1", 10, () => 0.5)).toEqual({ type: "choose", seat: "p1", choice: "WAR" }); // by the last tie-replay round, temptation has overtaken LOVE
  });

  it("two Lv.5 bots can play an entire match to completion without an infinite loop", () => {
    let s = startGame();
    let guard = 0;
    while (s.phase !== "gameOver" && guard < 500) {
      guard++;
      const actor = currentActor(s);
      if (actor) {
        const action = chooseBotAction(s, actor, 5, () => (guard % 7) / 10);
        if (action) s = applyAction(s, action);
      } else if (s.phase === "reveal") {
        s = applyAction(s, { type: "continue" });
      }
    }
    expect(s.phase).toBe("gameOver");
    expect(guard).toBeLessThan(500);
  });
});
