import { describe, expect, it } from "vitest";
import {
  applyAction,
  BOARD_SIZE,
  compareHands,
  DEFAULT_TIMER_SETTINGS,
  evaluateHand,
  formatHandLabel,
  LINES,
  opponentLiveCell,
  startGame,
  visibleOpponentBoard,
  type Card,
  type GridPokerState,
  type Suit,
} from "./engine";

function std(rank: number, suit: Suit, id = `${rank}${suit}`): Card {
  return { id, kind: "std", rank, suit };
}
function joker(id = "joker"): Card {
  return { id, kind: "joker" };
}

describe("evaluateHand", () => {
  it("recognizes a royal flush (ace-high straight flush)", () => {
    const hand = evaluateHand([std(14, "S"), std(13, "S"), std(12, "S"), std(11, "S"), std(10, "S")]);
    expect(hand.category).toBe(8);
    expect(hand.ranks).toEqual([14]);
  });

  it("recognizes the wheel straight (A-2-3-4-5) as five-high", () => {
    const hand = evaluateHand([std(14, "S"), std(2, "D"), std(3, "H"), std(4, "C"), std(5, "S")]);
    expect(hand.category).toBe(4);
    expect(hand.ranks).toEqual([5]);
  });

  it("recognizes four of a kind with correct kicker", () => {
    const hand = evaluateHand([std(9, "S"), std(9, "D"), std(9, "H"), std(9, "C"), std(3, "S")]);
    expect(hand.category).toBe(7);
    expect(hand.ranks).toEqual([9, 3]);
  });

  it("recognizes a full house (triple rank first, then pair rank)", () => {
    const hand = evaluateHand([std(6, "S"), std(6, "D"), std(6, "H"), std(2, "C"), std(2, "S")]);
    expect(hand.category).toBe(6);
    expect(hand.ranks).toEqual([6, 2]);
  });

  it("recognizes two pair ordered high pair, low pair, kicker", () => {
    const hand = evaluateHand([std(4, "S"), std(4, "D"), std(9, "H"), std(9, "C"), std(2, "S")]);
    expect(hand.category).toBe(2);
    expect(hand.ranks).toEqual([9, 4, 2]);
  });

  it("a single joker fills the best possible rank to make quads over a worse straight", () => {
    // 9,9,9,K + joker -> joker becomes the 4th 9 (quad beats any straight/flush it could otherwise reach).
    const hand = evaluateHand([std(9, "S"), std(9, "D"), std(9, "H"), std(13, "C"), joker()]);
    expect(hand.category).toBe(7);
    expect(hand.ranks).toEqual([9, 13]);
  });

  it("a joker completes a flush when the other four share a suit", () => {
    const hand = evaluateHand([std(2, "H"), std(5, "H"), std(9, "H"), std(11, "H"), joker()]);
    expect(hand.category).toBe(5);
    expect(hand.cards.find((c) => c.fromJoker)?.suit).toBe("H");
  });

  it("two jokers plus three of a kind resolve to four of a kind with the best possible kicker", () => {
    // A 5th "7" would be redundant (4-of-a-kind is already capped), so the
    // better play is one joker completing the quad and the other becoming
    // the highest possible kicker (Ace) rather than a wasted second 7.
    const hand = evaluateHand([std(7, "S"), std(7, "D"), std(7, "H"), joker("j1"), joker("j2")]);
    expect(hand.category).toBe(7);
    expect(hand.ranks).toEqual([7, 14]);
  });

  it("five jokers resolve to the best possible hand: an ace-high spade straight flush", () => {
    const hand = evaluateHand([joker("j1"), joker("j2"), joker("j3"), joker("j4"), joker("j5")]);
    expect(hand.category).toBe(8);
    expect(hand.ranks).toEqual([14]);
    expect(hand.cards.every((c) => c.suit === "S")).toBe(true);
  });

  it("labels an ace-high straight flush as a royal flush, distinct from a plain straight flush", () => {
    const royal = evaluateHand([std(14, "S"), std(13, "S"), std(12, "S"), std(11, "S"), std(10, "S")]);
    expect(royal.categoryName).toBe("로열 스트레이트 플러시");
    const plain = evaluateHand([std(9, "H"), std(8, "H"), std(7, "H"), std(6, "H"), std(5, "H")]);
    expect(plain.categoryName).toBe("스트레이트 플러시");
    // Still the same category number — ranks alone already rank royal above
    // any other straight flush, no separate tier number is needed.
    expect(royal.category).toBe(plain.category);
    expect(compareHands(royal, plain)).toBeGreaterThan(0);
  });

  it("when a flush isn't the winning category, jokers still pick the suit that maximizes the final tiebreak instead of blindly matching the fixed cards' suit", () => {
    // 9D, 2D fixed (same suit) + three jokers. The straight/flush a diamond
    // suit could reach (2 and 9 are too far apart for a straight, and a
    // 9-2-x-x-x diamond flush is only category 5) loses to four-of-a-kind
    // nines (category 7, made from the fixed 9D plus three wild 9s) — so the
    // wilds should resolve as spades (best tiebreak suit) rather than being
    // forced into diamonds just because the two fixed cards happen to share
    // a suit.
    const hand = evaluateHand([
      std(9, "D"),
      std(2, "D"),
      joker("j1"),
      joker("j2"),
      joker("j3"),
    ]);
    expect(hand.category).toBe(7);
    expect(hand.ranks).toEqual([9, 2]);
    const jokerCards = hand.cards.filter((c) => c.fromJoker);
    expect(jokerCards).toHaveLength(3);
    expect(jokerCards.every((c) => c.suit === "S")).toBe(true);
    expect(hand.topSuitValue).toBe(4); // spade, not the fixed cards' diamond (3)

    // Cross-check against an opponent who legitimately holds four diamond
    // nines (no jokers involved): the joker-built quad's spade-resolved
    // nines must outrank the all-diamond quad on the final suit tiebreak.
    const allDiamondQuad = evaluateHand([std(9, "D"), std(9, "D", "9D-2"), std(9, "D", "9D-3"), std(9, "D", "9D-4"), std(2, "D")]);
    expect(compareHands(hand, allDiamondQuad)).toBeGreaterThan(0);
  });
});

describe("formatHandLabel", () => {
  it("folds the paired rank into one pair's label as (<rank>원페어)", () => {
    const hand = evaluateHand([std(8, "S"), std(8, "D"), std(12, "H"), std(6, "C"), std(2, "S")]);
    expect(hand.category).toBe(1);
    expect(formatHandLabel(hand)).toBe("(8원페어)");
  });

  it("uses the face-card letter (not the raw numeric rank) when a pair is J/Q/K/A", () => {
    const hand = evaluateHand([std(13, "S"), std(13, "D"), std(9, "H"), std(6, "C"), std(2, "S")]);
    expect(formatHandLabel(hand)).toBe("(K원페어)");
  });

  it("folds both pair ranks into two pair's label, higher pair first, as (<hi>, <lo>투페어)", () => {
    const hand = evaluateHand([std(13, "S"), std(13, "D"), std(10, "H"), std(10, "C"), std(2, "S")]);
    expect(hand.category).toBe(2);
    expect(formatHandLabel(hand)).toBe("(K, 10투페어)");
  });

  it("leaves every other category's label exactly as categoryName", () => {
    const trips = evaluateHand([std(11, "S"), std(11, "D"), std(11, "H"), std(6, "C"), std(2, "S")]);
    expect(formatHandLabel(trips)).toBe(trips.categoryName);
    expect(formatHandLabel(trips)).toBe("트리플");

    const flush = evaluateHand([std(2, "H"), std(5, "H"), std(9, "H"), std(11, "H"), std(13, "H")]);
    expect(formatHandLabel(flush)).toBe("플러시");

    const highCard = evaluateHand([std(14, "S"), std(10, "D"), std(7, "H"), std(5, "C"), std(2, "S")]);
    expect(formatHandLabel(highCard)).toBe("하이 카드");
  });
});

describe("compareHands", () => {
  it("orders by category first", () => {
    const flush = evaluateHand([std(2, "H"), std(5, "H"), std(9, "H"), std(11, "H"), std(13, "H")]);
    const trips = evaluateHand([std(9, "S"), std(9, "D"), std(9, "H"), std(2, "C"), std(3, "S")]);
    expect(compareHands(flush, trips)).toBeGreaterThan(0);
  });

  it("breaks a same-category tie by rank vector", () => {
    const pairAces = evaluateHand([std(14, "S"), std(14, "D"), std(2, "H"), std(3, "C"), std(4, "S")]);
    const pairKings = evaluateHand([std(13, "S"), std(13, "D"), std(2, "C"), std(3, "H"), std(4, "D")]);
    expect(compareHands(pairAces, pairKings)).toBeGreaterThan(0);
  });

  it("falls back to the top card's suit only when every rank is fully tied", () => {
    const spadeTop = evaluateHand([std(10, "S"), std(2, "H"), std(4, "C"), std(6, "D"), std(8, "S")]);
    const heartTop = evaluateHand([std(10, "H"), std(2, "H"), std(4, "C"), std(6, "D"), std(8, "S")]);
    expect(compareHands(spadeTop, heartTop)).toBeGreaterThan(0);
  });

  it("is a true tie for genuinely identical hands", () => {
    const a = evaluateHand([std(10, "S"), std(2, "H"), std(4, "C"), std(6, "D"), std(8, "S")]);
    const b = evaluateHand([std(10, "S"), std(2, "H"), std(4, "C"), std(6, "D"), std(8, "S")]);
    expect(compareHands(a, b)).toBe(0);
  });
});

describe("LINES", () => {
  it("has 12 lines of 5 cells each: 5 rows, 5 columns, 2 diagonals", () => {
    expect(LINES).toHaveLength(12);
    expect(LINES.every((l) => l.length === 5)).toBe(true);
    expect(LINES[10]).toEqual([0, 6, 12, 18, 24]);
    expect(LINES[11]).toEqual([4, 8, 12, 16, 20]);
  });
});

describe("game flow", () => {
  function fillBoards(state: GridPokerState): GridPokerState {
    let s = state;
    let seed = 1;
    while (s.phase === "placing") {
      s = applyAction(s, { type: "draw-common", seed: seed++ });
      // place the drawn card into the same cell index for every player, round-robin across the board
      const cellIndex = s.drawCount - 1;
      for (let seat = 0; seat < s.playerCount; seat++) {
        s = applyAction(s, { type: "place", seat, cellIndex });
      }
    }
    return s;
  }

  it("fills a 2-player board over exactly 25 draws and moves to submitting", () => {
    const s = fillBoards(startGame(2));
    expect(s.phase).toBe("submitting");
    expect(s.drawCount).toBe(BOARD_SIZE);
    for (const p of s.players) {
      expect(p.board.every((c) => c !== null)).toBe(true);
      expect(p.firstPlacedCell).toBe(0);
    }
  });

  it("2-player game ends immediately once a player reaches 6 round wins", () => {
    let s = fillBoards(startGame(2));
    let usedLine = 0;
    while (s.phase === "submitting" && usedLine < 10) {
      // Seat 0 always submits a line it hasn't used yet; seat 1 does too but a
      // different one, so both players' usedLines advance independently.
      s = applyAction(s, { type: "submit-line", seat: 0, lineIndex: usedLine });
      s = applyAction(s, { type: "submit-line", seat: 1, lineIndex: usedLine });
      usedLine++;
    }
    expect(s.phase).toBe("game-end");
    expect(s.winner).not.toBeNull();
    expect(s.roundNumber - 1).toBeLessThanOrEqual(10);
  });

  it("visibleOpponentBoard hides everything except the first placed cell before any line is submitted", () => {
    const s = fillBoards(startGame(3));
    const opponent = s.players[1];
    const visible = visibleOpponentBoard(opponent);
    const visibleCount = visible.filter((c) => c !== null).length;
    expect(visibleCount).toBe(1);
    expect(visible[opponent.firstPlacedCell!]).not.toBeNull();
  });

  it("visibleOpponentBoard reveals a full line once it has been submitted and scored", () => {
    let s = fillBoards(startGame(3));
    s = applyAction(s, { type: "submit-line", seat: 1, lineIndex: 2 });
    s = applyAction(s, { type: "submit-line", seat: 0, lineIndex: 0 });
    s = applyAction(s, { type: "submit-line", seat: 2, lineIndex: 0 });
    const visible = visibleOpponentBoard(s.players[1]);
    for (const cell of LINES[2]) expect(visible[cell]).not.toBeNull();
  });

  it("lastPlacedCell tracks a live 'just placed here' marker that clears on the next draw", () => {
    let s = startGame(2);
    s = applyAction(s, { type: "draw-common", seed: 1 });
    s = applyAction(s, { type: "place", seat: 0, cellIndex: 7 });
    expect(opponentLiveCell(s, s.players[0])).toBe(7);
    expect(s.players[1].lastPlacedCell).toBeNull(); // seat 1 hasn't placed yet this round

    s = applyAction(s, { type: "place", seat: 1, cellIndex: 12 });
    // round complete for both players -> currentCard is cleared, but the
    // "just placed here" marker itself stays put until the *next* draw
    expect(opponentLiveCell(s, s.players[0])).toBe(7);
    expect(opponentLiveCell(s, s.players[1])).toBe(12);

    s = applyAction(s, { type: "draw-common", seed: 2 });
    expect(s.players[0].lastPlacedCell).toBeNull();
    expect(s.players[1].lastPlacedCell).toBeNull();
    expect(opponentLiveCell(s, s.players[0])).toBeNull();
  });

  it("opponentLiveCell only applies during the placing phase, even though the field itself retains the last value", () => {
    const s = fillBoards(startGame(2));
    expect(s.phase).toBe("submitting");
    expect(s.players[0].lastPlacedCell).not.toBeNull();
    expect(opponentLiveCell(s, s.players[0])).toBeNull();
  });

  it("defaults to a 40s placing / 30s submitting limited timer when no room settings are given", () => {
    const s = startGame(2);
    expect(s.timerSettings).toEqual(DEFAULT_TIMER_SETTINGS);
    expect(s.timerSettings.mode).toBe("limited");
    expect(s.timerSettings.placingSeconds).toBe(40);
    expect(s.timerSettings.submittingSeconds).toBe(30);
  });

  it("carries a room's custom timer settings through the whole game, including an unlimited mode", () => {
    const custom = { mode: "unlimited" as const, placingSeconds: 55, submittingSeconds: 12 };
    let s = startGame(2, custom);
    expect(s.timerSettings).toEqual(custom);
    // Every reducer branch spreads `{...state, ...}`, so the room's chosen
    // settings must still be present after actions mutate other fields.
    s = applyAction(s, { type: "draw-common", seed: 1 });
    s = applyAction(s, { type: "place", seat: 0, cellIndex: 0 });
    s = applyAction(s, { type: "place", seat: 1, cellIndex: 0 });
    expect(s.timerSettings).toEqual(custom);
  });

  it("3+ player game runs all 12 rounds unless someone reaches 7 wins early", () => {
    const s = fillBoards(startGame(3));
    expect(s.totalScoringRounds).toBe(12);
    expect(s.winThreshold).toBe(7);
  });

  it("a player cannot submit the same line twice", () => {
    let s = fillBoards(startGame(2));
    s = applyAction(s, { type: "submit-line", seat: 0, lineIndex: 5 });
    s = applyAction(s, { type: "submit-line", seat: 1, lineIndex: 5 });
    // line 5 is now used for both players; resubmitting it should be a no-op
    const before = s;
    const after = applyAction(s, { type: "submit-line", seat: 0, lineIndex: 5 });
    expect(after).toBe(before);
  });
});
