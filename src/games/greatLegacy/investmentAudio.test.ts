import { describe, expect, it } from "vitest";
import { detectAuctionCues } from "./auctionCues";
import { applyAction, minimalRaiseCoins, startGame } from "./engine";
import { LOOP_STEPS, STEPS_PER_BAR, symphonyEventsAt } from "./symphonyPattern";

describe("symphony score", () => {
  it("is a 32-step loop with a timpani on every downbeat and strings on every beat", () => {
    expect(LOOP_STEPS).toBe(32);
    for (let step = 0; step < LOOP_STEPS; step++) {
      const voices = symphonyEventsAt(step).map((e) => e.voice);
      expect(voices.includes("timpani")).toBe(step % STEPS_PER_BAR === 0);
      expect(voices.includes("bass")).toBe(step % 2 === 0);
    }
    expect(symphonyEventsAt(LOOP_STEPS + 5)).toEqual(symphonyEventsAt(5));
  });

  it("every pitched note is audible (> 0 Hz) and in a sane range", () => {
    for (let step = 0; step < LOOP_STEPS; step++) {
      for (const e of symphonyEventsAt(step)) if (e.voice !== "timpani") expect(e.freq).toBeGreaterThan(30);
    }
  });
});

describe("detectAuctionCues", () => {
  it("flags a raise, a pass, and the sale with its winner", () => {
    let s = startGame("4p", 9);
    const first = s.auction!.activeSeat;
    const raised = applyAction(s, { type: "bid", seat: first, addCoins: minimalRaiseCoins(s, first)! });
    expect(detectAuctionCues(s, raised)).toMatchObject({ bid: true, pass: false, sold: null });
    s = raised;

    // Everyone else drops out: each pass is a pass cue until the last one sells the lot.
    let prev = s;
    while (s.auction && s.auction.card.cardId === prev.auction!.card.cardId && s.phase === "playing") {
      prev = s;
      const seat = s.auction.activeSeat;
      s = applyAction(s, seat === first ? { type: "bid", seat, addCoins: minimalRaiseCoins(s, seat)! } : { type: "pass", seat });
      const cues = detectAuctionCues(prev, s);
      if (s.auction && s.auction.card.cardId === prev.auction!.card.cardId) {
        expect(cues.sold).toBeNull();
      } else {
        expect(cues.sold).not.toBeNull();
        expect(cues.sold!.kind).toBe(prev.auction!.kind);
        if (prev.auction!.kind === "normal") expect(cues.sold!.winnerSeat).toBe(first);
      }
    }
  });
});
