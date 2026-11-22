import { describe, expect, it } from "vitest";
import { addVerdict, advise, EMPTY_TALLY, judge, standing, tallyTip } from "./coach";
import { applyAction, startGame, type TaleCard, type TalesState } from "./engine";

const g = (id: number, kind: TaleCard["kind"], fear: number): TaleCard => ({ id, kind, fear });

/** A mid-game state where seat 0 has told `story` and the deck is `deck`. */
function rig(story: TaleCard[], deck: TaleCard[], over: Partial<TalesState> = {}): TalesState {
  const s = startGame(2, 1);
  return { ...s, seat: 0, scores: [0, 0], story, told: story.length, deck, discard: [], turn: 5, candles: 80, ...over };
}

describe("hundred tales coach", () => {
  it("has no advice before the forced first tale", () => {
    const s = { ...startGame(2, 1), seat: 0 };
    expect(advise(s, 0)).toBeNull();
  });

  it("recommends drawing when the deck is safe and stopping when it isn't", () => {
    const safe = rig([g(1, "maiden", 2)], [g(10, "fox", 3), g(11, "egg", 2), g(12, "reaper", 4)]);
    expect(advise(safe, 0)?.pick).toBe("draw");
    const risky = rig([g(1, "maiden", 4), g(2, "fox", 4), g(3, "egg", 4), g(4, "reaper", 4)], [g(10, "maiden", 1), g(11, "fox", 1), g(12, "egg", 1)]);
    expect(advise(risky, 0)?.pick).toBe("stop");
  });

  it("grades a stop on a risky story as good and a bust after a safe-looking deck as bad luck", () => {
    const risky = rig([g(1, "maiden", 4), g(2, "fox", 4), g(3, "egg", 4), g(4, "reaper", 4)], [g(10, "maiden", 1), g(11, "fox", 1), g(12, "egg", 1)]);
    const stopped = applyAction(risky, { type: "stop", seat: 0, turn: risky.turn });
    expect(judge(risky, stopped, 0)?.grade).toBe("good");
    const drew = applyAction(risky, { type: "draw", seat: 0, turn: risky.turn });
    expect(judge(risky, drew, 0)?.grade).toBe("greedy");

    const mostlySafe = rig([g(1, "maiden", 2)], [g(10, "maiden", 1), ...Array.from({ length: 9 }, (_, i) => g(20 + i, "fox", 1))]);
    const bust = applyAction(mostlySafe, { type: "draw", seat: 0, turn: mostlySafe.turn });
    expect(bust.lastEvent?.act).toBe("bust");
    expect(judge(mostlySafe, bust, 0)?.grade).toBe("unlucky");
  });

  it("ignores other seats' moves and flags timeouts", () => {
    const s = rig([g(1, "maiden", 2)], [g(10, "fox", 3)]);
    const next = applyAction(s, { type: "stop", seat: 0, turn: s.turn });
    expect(judge(s, next, 1)).toBeNull();
    const timed = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(judge(s, timed, 0)?.grade).toBe("timeout");
  });

  it("tallies verdicts into a closing tip and reports standing", () => {
    let t = EMPTY_TALLY;
    for (let i = 0; i < 4; i++) t = addVerdict(t, { grade: "greedy", text: "", agreed: false });
    expect(t.decisions).toBe(4);
    expect(tallyTip(t)).toContain("35%");
    const s = rig([], [], { scores: [12, 5] });
    expect(standing(s, 0).text).toContain("1위");
    expect(standing(s, 1).text).toContain("7점");
  });
});
