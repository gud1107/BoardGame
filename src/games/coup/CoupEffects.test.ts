import { describe, expect, it } from "vitest";
import { detectPassers } from "./CoupEffects";
import { applyAction, type Card, type CoupState, type PlayerState } from "./engine";

const card = (id: number, character: Card["character"]): Card => ({ id, character });
const player = (seat: number, influence: Card[]): PlayerState => ({ seat, coins: 2, influence, revealed: [] });

function makeState(): CoupState {
  return {
    playerCount: 3,
    players: [player(0, [card(0, "duke"), card(1, "assassin")]), player(1, [card(2, "contessa"), card(3, "captain")]), player(2, [card(4, "ambassador"), card(5, "duke")])],
    deck: [card(6, "duke"), card(7, "captain"), card(8, "contessa")],
    activeSeat: 0,
    phase: "action",
    turnNumber: 1,
    pendingAction: null,
    pendingBlock: null,
    awaitingSeats: [],
    pendingLoseInfluence: null,
    pendingExchange: null,
    lastEvent: null,
    eliminationOrder: [],
    winnerSeat: null,
  } as CoupState;
}

describe("detectPassers (👋 pass gesture)", () => {
  it("reports each seat as it passes, including the last one that closes the window", () => {
    const declared = applyAction(makeState(), { type: "declareAction", seat: 0, action: "foreignAid" });
    const afterOne = applyAction(declared, { type: "pass", seat: 1 });
    expect(detectPassers(declared, afterOne)).toEqual([1]);
    const afterTwo = applyAction(afterOne, { type: "pass", seat: 2 });
    expect(detectPassers(afterOne, afterTwo)).toEqual([2]);
  });

  it("does not count the other waiting seats as passing when someone blocks or challenges", () => {
    const declared = applyAction(makeState(), { type: "declareAction", seat: 0, action: "foreignAid" });
    const blocked = applyAction(declared, { type: "declareBlock", seat: 2, character: "duke" });
    expect(detectPassers(declared, blocked)).toEqual([]);

    const tax = applyAction(makeState(), { type: "declareAction", seat: 0, action: "tax" });
    const challenged = applyAction(tax, { type: "challenge", seat: 1 });
    expect(detectPassers(tax, challenged)).toEqual([]);
  });

  it("ignores declarations (nobody was answering yet)", () => {
    const start = makeState();
    expect(detectPassers(start, applyAction(start, { type: "declareAction", seat: 0, action: "tax" }))).toEqual([]);
  });
});
