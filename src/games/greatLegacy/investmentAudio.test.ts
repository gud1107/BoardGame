import { describe, expect, it } from "vitest";
import { auctionHeat, detectAuctionCues } from "./auctionCues";
import { applyAction, minimalRaiseCoins, startGame } from "./engine";
import { LOOP_STEPS, STEPS_PER_BAR, symphonyEventsAt, symphonyTempo } from "./symphonyPattern";

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

describe("symphony mood & heat", () => {
  const voicesOverLoop = (mood: "normal" | "reverse", heat: number) =>
    new Set(Array.from({ length: LOOP_STEPS }, (_, i) => symphonyEventsAt(i, { mood, heat }).map((e) => e.voice)).flat());

  it("the reverse (penalty-card) variant swaps the horn pad for tremolo strings over a drone", () => {
    const calm = voicesOverLoop("normal", 0);
    const dark = voicesOverLoop("reverse", 0);
    expect(calm.has("horn") && !calm.has("tremolo") && !calm.has("drone")).toBe(true);
    expect(!dark.has("horn") && dark.has("tremolo") && dark.has("drone")).toBe(true);
    expect(symphonyTempo({ mood: "reverse", heat: 0 })).toBeLessThan(symphonyTempo({ mood: "normal", heat: 0 }));
  });

  it("heat adds the ostinato, doubles the timpani and speeds the tempo", () => {
    expect(voicesOverLoop("normal", 0.2).has("ostinato")).toBe(false);
    expect(voicesOverLoop("normal", 0.5).has("ostinato")).toBe(true);
    const timpani = (heat: number) => Array.from({ length: LOOP_STEPS }, (_, i) => symphonyEventsAt(i, { mood: "normal", heat })).flat().filter((e) => e.voice === "timpani").length;
    expect(timpani(0.9)).toBe(timpani(0) * 2);
    expect(symphonyTempo({ mood: "normal", heat: 1 })).toBeGreaterThan(symphonyTempo({ mood: "normal", heat: 0 }));
  });

  it("auctionHeat climbs with the high bid and stays 0..1", () => {
    const s = startGame("4p", 9);
    const at = (highestBid: number) => auctionHeat({ ...s, auction: { ...s.auction!, highestBid } });
    expect(at(0)).toBe(0);
    expect(at(20)).toBeGreaterThan(at(10));
    expect(at(10_000)).toBe(1);
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
