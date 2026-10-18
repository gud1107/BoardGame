import { describe, expect, it } from "vitest";
import { applyAction, currentThrower, startGame } from "./engine";
import { predictionHit, sanitizeCall, sanitizePrediction, stoneStayedIn } from "./spectate";
import { restingPoint, weightForTravel } from "./physics";

describe("spectator layer (§17)", () => {
  it("scores a prediction by whether the delivered stone stayed in the house", () => {
    let s = startGame(2, 5, { party: false });
    const w = weightForTravel(28.35);
    let aim = 0;
    let best = Infinity;
    for (let a = -2; a <= 2; a += 0.02) {
      const r = restingPoint({ aim: a, weight: w, spin: 1, kind: null });
      if (Math.abs(r.x) < best) {
        best = Math.abs(r.x);
        aim = a;
      }
    }
    s = applyAction(s, { type: "throw", seat: currentThrower(s)!, turn: s.turn, aim, weight: w, spin: 1, useCard: false, own: [], opp: [] });
    expect(stoneStayedIn(s, s.lastThrow!)).toBe(true);
    expect(predictionHit("in", true)).toBe(true);
    expect(predictionHit("out", true)).toBe(false);
    s = applyAction(s, { type: "throw", seat: currentThrower(s)!, turn: s.turn, aim: 0, weight: 1, spin: 1, useCard: false, own: [], opp: [] });
    expect(stoneStayedIn(s, s.lastThrow!)).toBe(false);
  });

  it("rejects malformed predictions and calls", () => {
    expect(sanitizePrediction({ seat: 1, turn: 3, pick: "in" }, 4)).toEqual({ seat: 1, turn: 3, pick: "in" });
    expect(sanitizePrediction({ seat: 9, turn: 3, pick: "in" }, 4)).toBeNull();
    expect(sanitizePrediction({ seat: 1, turn: 3, pick: "maybe" }, 4)).toBeNull();
    expect(sanitizeCall({ seat: 0, turn: 1, x: 0.3, y: 0.5, tag: "hit" }, 4)).toMatchObject({ tag: "hit" });
    expect(sanitizeCall({ seat: 0, turn: 1, x: 9, y: 0.5, tag: "hit" }, 4)).toBeNull();
    expect(sanitizeCall({ seat: 0, turn: 1, x: 0, y: 0, tag: "nuke" }, 4)).toBeNull();
  });
});
