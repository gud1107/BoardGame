import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  computeRankings,
  CURSE_FINE,
  currentActor,
  drawOdds,
  fullDeck,
  nextCard,
  PERFECT_BONUS,
  RELIGHT,
  startGame,
  type TaleCard,
  type TalesState,
} from "./engine";
import { chooseBotAction } from "./bot";
import { hundredTalesStatDetails } from "./stats";
import { hundredTalesCues } from "./hundredTalesSound";

let id = 1000;
const card = (kind: TaleCard["kind"], fear = 0): TaleCard => ({ id: id++, kind, fear });
const withDeck = (s: TalesState, deck: TaleCard[], extra: Partial<TalesState> = {}): TalesState => ({ ...s, deck, ...extra });
const draw = (s: TalesState) => applyAction(s, { type: "draw", seat: s.seat, turn: s.turn });
const stop = (s: TalesState) => applyAction(s, { type: "stop", seat: s.seat, turn: s.turn });

describe("deck", () => {
  it("later tellers start with a point per place after the first", () => {
    const s = startGame(4, 3);
    expect(s.scores[s.seat]).toBe(0);
    expect(s.scores[(s.seat + 3) % 4]).toBe(3);
  });
  it("has 45 cards: 5 ghosts × 7 + 10 specials, 80 fear", () => {
    const d = fullDeck();
    expect(d.length).toBe(45);
    expect(d.reduce((a, c) => a + c.fear, 0)).toBe(80);
    expect(new Set(d.map((c) => c.id)).size).toBe(45);
  });
  it("same seed → same game", () => {
    expect(startGame(4, 7).deck).toEqual(startGame(4, 7).deck);
    expect(startGame(4, 7).deck).not.toEqual(startGame(4, 8).deck);
  });
});

describe("turn rules", () => {
  const base = { ...startGame(3, 1), seat: 0, scores: [0, 0, 0] };

  it("must tell a tale before stopping", () => {
    expect(stop(base)).toBe(base);
  });

  it("ghost tales snuff candles and bank on stop", () => {
    let s = withDeck(base, [card("fox", 3), card("egg", 2), card("maiden", 1)]);
    s = draw(draw(s));
    expect(s.candles).toBe(95);
    expect(s.story.length).toBe(2);
    s = stop(s);
    expect(s.scores[0]).toBe(5);
    expect(s.seat).toBe(1);
    expect(s.story).toEqual([]);
  });

  it("the same ghost twice possesses you — story lost, turn passes", () => {
    let s = withDeck(base, [card("fox", 3), card("fox", 1), card("egg", 2)]);
    s = draw(draw(s));
    expect(s.seat).toBe(1);
    expect(s.scores[0]).toBe(0);
    expect(s.busts[0]).toBe(1);
    expect(s.lastEvent?.act).toBe("bust");
    expect(s.candles).toBe(96);
  });

  it("🧂 salt saves one possession", () => {
    let s = withDeck(base, [card("salt"), card("fox", 3), card("fox", 1), card("egg", 2)]);
    s = draw(s);
    expect(s.salts[0]).toBe(1);
    s = draw(draw(s));
    expect(s.seat).toBe(0);
    expect(s.salts[0]).toBe(0);
    expect(s.story.map((c) => c.kind)).toEqual(["fox"]);
    s = stop(draw(s));
    expect(s.scores[0]).toBe(5);
  });

  it("🕯️ relights up to the start count, 🪞 shows the next card", () => {
    let s = withDeck(base, [card("fox", 4), card("candle"), card("mirror"), card("egg", 2)]);
    s = draw(s);
    expect(s.candles).toBe(96);
    s = draw(s);
    expect(s.candles).toBe(Math.min(100, 96 + RELIGHT));
    s = draw(s);
    expect(s.peek).toBe(true);
    expect(nextCard(s)?.kind).toBe("egg");
    expect(drawOdds(s).bust).toBe(0);
    s = draw(s);
    expect(s.peek).toBe(false);
  });

  it("five different ghosts bank automatically with the bonus", () => {
    let s = withDeck(base, [card("maiden", 1), card("dokkaebi", 1), card("fox", 1), card("reaper", 1), card("egg", 1), card("egg", 1)]);
    for (let i = 0; i < 5; i++) s = draw(s);
    expect(s.scores[0]).toBe(5 + PERFECT_BONUS);
    expect(s.seat).toBe(1);
    expect(s.lastEvent?.act).toBe("perfect");
  });

  it("snuffing the last candle curses and ends the game", () => {
    let s = withDeck(base, [card("fox", 2), card("egg", 3)], { candles: 4, scores: [10, 3, 0] });
    s = draw(draw(s));
    expect(s.phase).toBe("ended");
    expect(s.cursedSeat).toBe(0);
    expect(s.scores[0]).toBe(10 - CURSE_FINE);
    // half the score once that is more than the flat fine
    let t = withDeck(base, [card("fox", 3)], { candles: 2, scores: [40, 0, 0] });
    t = draw(t);
    expect(t.scores[0]).toBe(20);
    expect(currentActor(s)).toBeNull();
  });

  it("timeout tells the required tale then stops", () => {
    const s = withDeck(base, [card("fox", 2), card("egg", 3)]);
    const t = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(t.scores[0]).toBe(2);
    expect(t.seat).toBe(1);
    expect(t.lastEvent).toMatchObject({ act: "stop", auto: true });
  });

  it("rejects stale or out-of-turn actions", () => {
    expect(applyAction(base, { type: "draw", seat: 1, turn: base.turn })).toBe(base);
    expect(applyAction(base, { type: "draw", seat: 0, turn: base.turn + 3 })).toBe(base);
  });

  it("reshuffles the discard when the deck runs out", () => {
    let s = withDeck(base, [card("fox", 1)], { discard: [card("egg", 1), card("maiden", 1)] });
    s = draw(draw(s));
    expect(s.reshuffles).toBe(1);
    expect(s.story.length + s.discard.length + s.deck.length).toBeGreaterThan(0);
  });

  it("ranks by score, then fewer possessions", () => {
    const s = { ...base, scores: [5, 5, 9], busts: [2, 1, 0] };
    expect(computeRankings(s).map((r) => [r.seat, r.rank])).toEqual([
      [2, 1],
      [1, 2],
      [0, 3],
    ]);
  });
});

describe("bots, stats and sound", () => {
  it("every level finishes games with legal moves", () => {
    for (let lv = 1; lv <= 10; lv++) {
      const rng = seededRng(lv);
      let s = startGame(4, lv * 11);
      let prev: TalesState | null = null;
      for (let i = 0; i < 3000 && s.phase === "play"; i++) {
        const a = chooseBotAction(s, currentActor(s)!, lv, rng);
        prev = s;
        s = applyAction(s, a);
        expect(s).not.toBe(prev);
      }
      expect(s.phase).toBe("ended");
      const d = hundredTalesStatDetails(s, 0);
      expect(d.told).toBeGreaterThan(0);
      expect(hundredTalesCues(0)(prev!, s)).toContain("curse");
    }
  });
});
