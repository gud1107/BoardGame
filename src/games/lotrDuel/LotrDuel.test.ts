import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./bot";
import { CARD_BY_ID, CHAPTER_DECKS, FRODO_START, LANDMARKS, NAZGUL_START, OFFICIAL_RING_TRACK, TOKENS, TRACK_LENGTH } from "./data";
import {
  advanceRing,
  applyAction,
  availableSlots,
  calculateCardCost,
  calculateLandmarkCost,
  checkInstantVictory,
  legalActions,
  resolveCombat,
  startGame,
  type LotrDuelCard,
  type LotrDuelState,
} from "./engine";

function card(name: string): LotrDuelCard {
  const c = Object.values(CARD_BY_ID).find((x) => x.name === name);
  if (!c) throw new Error(name);
  return c;
}

function freshTurn(s: LotrDuelState): LotrDuelState {
  return { ...s, pending: [] };
}

describe("setup", () => {
  it("23 cards per chapter with the rulebook's colour split", () => {
    const counts = (ch: 1 | 2 | 3) => CHAPTER_DECKS[ch].reduce<Record<string, number>>((m, c) => ({ ...m, [c.color]: (m[c.color] ?? 0) + 1 }), {});
    expect(CHAPTER_DECKS[1]).toHaveLength(23);
    expect(CHAPTER_DECKS[2]).toHaveLength(23);
    expect(CHAPTER_DECKS[3]).toHaveLength(23);
    expect(counts(1)).toEqual({ GRAY: 6, GREEN: 6, RED: 4, YELLOW: 4, BLUE: 3 });
    expect(counts(2)).toEqual({ RED: 7, GREEN: 6, BLUE: 4, GRAY: 3, YELLOW: 3 });
    expect(counts(3)).toEqual({ PURPLE: 6, GREEN: 6, RED: 5, BLUE: 4, YELLOW: 2 });
    expect(Object.keys(TOKENS)).toHaveLength(18);
    expect(Object.keys(LANDMARKS)).toHaveLength(7);
  });

  it("Sauron starts, 3/2 coins, Arnor 2 / Mordor 2, 20-card pyramid + 3 removed, 3 landmarks", () => {
    const s = startGame(42);
    expect(s.turn).toBe("SAURON");
    expect(s.players.FELLOWSHIP.coins).toBe(3);
    expect(s.players.SAURON.coins).toBe(2);
    expect(s.boardRegions.ARNOR.fellowshipUnits).toBe(2);
    expect(s.boardRegions.MORDOR.sauronUnits).toBe(2);
    expect(s.players.FELLOWSHIP.unitsInSupply).toBe(13);
    expect(s.pyramidGrid).toHaveLength(20);
    expect(s.removedCards).toHaveLength(3);
    expect(s.revealedLandmarks).toHaveLength(3);
    expect(s.landmarkDeck).toHaveLength(4);
    // Chapter 1: only the 6-card bottom row is takeable.
    expect(availableSlots(s)).toHaveLength(6);
  });

  it("is deterministic for the same seed", () => {
    expect(startGame(7)).toEqual(startGame(7));
  });
});

describe("pyramid", () => {
  it("flips a face-down card once both cards covering it are taken", () => {
    let s = startGame(3);
    // Row 3 (5 cards, face-down) is covered by row 4 (6 cards).
    const target = s.pyramidGrid.findIndex((p) => p.row === 3 && p.x === -4);
    expect(s.pyramidGrid[target].isOpen).toBe(false);
    const [a, b] = s.pyramidGrid[target].coveredBy;
    s = applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot: a, mode: "DISCARD" });
    expect(s.pyramidGrid[target].isOpen).toBe(false);
    s = applyAction(s, { type: "TAKE_CARD", faction: "FELLOWSHIP", slot: b, mode: "DISCARD" });
    expect(s.pyramidGrid[target].isOpen).toBe(true);
    expect(availableSlots(s)).toContain(target);
  });

  it("rejects covered cards and out-of-turn actions without changing state", () => {
    const s = startGame(3);
    const covered = s.pyramidGrid.findIndex((p) => p.row === 0);
    expect(applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot: covered, mode: "DISCARD" })).toBe(s);
    const open = availableSlots(s)[0];
    expect(applyAction(s, { type: "TAKE_CARD", faction: "FELLOWSHIP", slot: open, mode: "DISCARD" })).toBe(s);
  });

  it("discarding pays the chapter number in coins", () => {
    const s = startGame(3);
    const n = applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot: availableSlots(s)[0], mode: "DISCARD" });
    expect(n.players.SAURON.coins).toBe(3);
    expect(n.discardedCards).toHaveLength(1);
    expect(n.turn).toBe("FELLOWSHIP");
  });
});

describe("costs", () => {
  it("owned tech is free, each missing tech costs 1 coin, a chain makes it free", () => {
    const s = startGame(1);
    const p = s.players.FELLOWSHIP;
    const helm = card("헬름 협곡 수비대"); // SWORD + FLAG, chain HORN
    expect(calculateCardCost(p, helm)).toMatchObject({ costInCoins: 2, viaChain: false });
    p.tableauCards.push(card("에레보르 대장간")); // SWORD
    expect(calculateCardCost(p, helm).costInCoins).toBe(1);
    p.tableauCards.push(card("로한 기마병")); // provides HORN
    expect(calculateCardCost(p, helm)).toEqual({ canAfford: true, costInCoins: 0, viaChain: true });
  });

  it("counts duplicate tech symbols and matches choice cards optimally", () => {
    const s = startGame(1);
    const p = s.players.SAURON;
    const march = card("강행군"); // FLAG FLAG SWORD
    p.tableauCards.push(card("곤도르 봉화")); // FLAG
    expect(calculateCardCost(p, { ...march, cost: { tech: march.cost.tech } }).costInCoins).toBe(2);
    p.tableauCards.push(card("전쟁 회의")); // SWORD | FLAG
    expect(calculateCardCost(p, { ...march, cost: { tech: march.cost.tech } }).costInCoins).toBe(1);
  });

  it("landmark costs +1 coin per own fortress on the board", () => {
    const s = startGame(1);
    const tile = LANDMARKS.EREBOR; // 2 coins + SWORD
    expect(calculateLandmarkCost(s, "SAURON", tile).costInCoins).toBe(3);
    s.boardRegions.MORDOR.sauronFortress = true;
    s.boardRegions.GONDOR.sauronFortress = true;
    expect(calculateLandmarkCost(s, "SAURON", tile).costInCoins).toBe(5);
  });
});

describe("combat", () => {
  it("removes units 1:1 and never touches fortresses", () => {
    expect(resolveCombat({ fellowshipUnits: 2, sauronUnits: 3, fellowshipFortress: true, sauronFortress: false })).toEqual({
      fellowshipUnits: 0,
      sauronUnits: 1,
      casualties: { fellowship: 2, sauron: 2 },
    });
  });

  it("placing units into an enemy region fights immediately; the fortress stays", () => {
    let s = startGame(1);
    s.boardRegions.MORDOR.sauronFortress = true;
    s = freshTurn(s);
    s.turn = "FELLOWSHIP";
    s.pending = [{ kind: "PLACE", count: 3, regions: ["MORDOR"], source: "test" }];
    s = applyAction(s, { type: "PLACE", faction: "FELLOWSHIP", region: "MORDOR" });
    expect(s.boardRegions.MORDOR).toEqual({ fellowshipUnits: 1, sauronUnits: 0, fellowshipFortress: false, sauronFortress: true });
    expect(s.players.FELLOWSHIP.unitsInSupply).toBe(13 - 3 + 2);
    expect(s.players.SAURON.unitsInSupply).toBe(15);
  });

  it("a red card queues a placement limited to its two regions", () => {
    let s = startGame(1);
    const slot = s.pyramidGrid.findIndex((p) => p.row === 4);
    s.pyramidGrid[slot].card = card("아이센 여울 전초");
    s = applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot, mode: "PLAY" });
    expect(s.turn).toBe("SAURON");
    expect(legalActions(s).map((a) => (a.type === "PLACE" ? a.region : null))).toEqual(["ENEDWAITH", "ROHAN"]);
    s = applyAction(s, { type: "PLACE", faction: "SAURON", region: "ROHAN" });
    expect(s.boardRegions.ROHAN.sauronUnits).toBe(1);
    expect(s.turn).toBe("FELLOWSHIP");
  });
});

describe("instant victory", () => {
  it("ring quest: Frodo at Mount Doom / Nazgûl catching Frodo", () => {
    const s = startGame(1);
    expect(s.ringTrack.frodoPosition).toBe(FRODO_START);
    expect(checkInstantVictory(s)).toBeNull();
    expect(checkInstantVictory({ ...s, ringTrack: { ...s.ringTrack, frodoPosition: TRACK_LENGTH } })).toEqual({ winner: "FELLOWSHIP", type: "RING_QUEST" });
    expect(checkInstantVictory({ ...s, ringTrack: { ...s.ringTrack, nazgulPosition: FRODO_START } })).toEqual({ winner: "SAURON", type: "RING_QUEST" });
  });

  it("race alliance: six different races, the eagle token counting as one", () => {
    const s = startGame(1);
    const greens = CHAPTER_DECKS[1].filter((c) => c.color === "GREEN");
    s.players.FELLOWSHIP.tableauCards = greens.slice(0, 5);
    expect(checkInstantVictory(s)).toBeNull();
    s.players.FELLOWSHIP.allianceTokens = [TOKENS.HOBBIT_EAGLE];
    expect(checkInstantVictory(s)).toEqual({ winner: "FELLOWSHIP", type: "RACE_ALLIANCE" });
  });

  it("conquest: presence (unit or fortress) in all 7 regions", () => {
    const s = startGame(1);
    for (const r of Object.values(s.boardRegions)) r.sauronUnits = 1;
    s.boardRegions.ARNOR.sauronUnits = 0;
    expect(checkInstantVictory(s)).toBeNull();
    s.boardRegions.ARNOR.sauronFortress = true;
    expect(checkInstantVictory(s)).toEqual({ winner: "SAURON", type: "CONQUEST" });
  });

  it("playing a blue card that lets the Nazgûl catch Frodo ends the game at once", () => {
    let s = startGame(1);
    s.ringTrack.nazgulPosition = FRODO_START - 1;
    const slot = s.pyramidGrid.findIndex((p) => p.row === 4);
    s.pyramidGrid[slot].card = card("엘론드의 회의");
    s = applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot, mode: "PLAY" });
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe("SAURON");
    expect(s.winType).toBe("RING_QUEST");
  });
});

describe("alliance tokens", () => {
  it("a second card of the same race reveals that pile's top 2 for a pick", () => {
    let s = startGame(5);
    s.players.SAURON.tableauCards.push(card("로리엔 궁수"));
    const slot = s.pyramidGrid.findIndex((p) => p.row === 4);
    s.pyramidGrid[slot].card = card("갈라드리엘의 거울"); // chained via LEAF → free
    s = applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot, mode: "PLAY" });
    expect(s.pending[0]).toMatchObject({ kind: "TOKEN", races: ["ELF"] });
    const picks = legalActions(s);
    expect(picks).toHaveLength(2);
    s = applyAction(s, picks[0]);
    expect(s.players.SAURON.allianceTokens).toHaveLength(1);
    expect(s.allianceTokenDecks.ELF).toHaveLength(2);
  });
});

describe("chapters", () => {
  it("full bot games always finish and chapters hand the lead to the other player", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = startGame(seed * 101);
      let lastChapter = s.chapter;
      for (let i = 0; i < 1500 && s.phase === "PLAYING"; i++) {
        const before = s;
        const a = chooseBotAction(s, s.turn, 5);
        expect(a).not.toBeNull();
        s = applyAction(s, a!);
        expect(s).not.toBe(before);
        if (s.chapter !== lastChapter && s.phase === "PLAYING") {
          const lastTaker = before.turn;
          expect(s.turn).toBe(lastTaker === "FELLOWSHIP" ? "SAURON" : "FELLOWSHIP");
          expect(s.revealedLandmarks.length).toBe(Math.min(3, before.revealedLandmarks.length + before.landmarkDeck.length));
          lastChapter = s.chapter;
        }
      }
      expect(s.phase).toBe("GAME_OVER");
      expect(s.winner).not.toBeNull();
    }
  });
});

describe("official ring track (0 … 24)", () => {
  it("has 25 points; the Nazgûl start on 0, Frodo & Sam on 13, Mount Doom is 24", () => {
    expect(OFFICIAL_RING_TRACK).toHaveLength(25);
    expect(TRACK_LENGTH).toBe(24);
    const s = startGame(1);
    expect(s.ringTrack.nazgulPosition).toBe(NAZGUL_START);
    expect(s.ringTrack.nazgulPosition).toBe(0);
    expect(s.ringTrack.frodoPosition).toBe(13);
    expect(OFFICIAL_RING_TRACK[0].isNazgulStart).toBe(true);
    expect(OFFICIAL_RING_TRACK[13].isFrodoStart).toBe(true);
    const rewarded = OFFICIAL_RING_TRACK.filter((p) => p.reward !== "NONE").map((p) => `${p.index}:${p.reward}`);
    expect(rewarded).toEqual([
      "2:COIN_1",
      "5:ALLIANCE_TOKEN",
      "8:MOVE_UNIT",
      "11:PLACE_UNIT",
      "13:COIN_1",
      "16:ALLIANCE_TOKEN",
      "19:MOVE_UNIT",
      "22:PLACE_UNIT",
      "24:MOUNT_DOOM_VICTORY",
    ]);
  });

  it("Frodo passing 16/19/22 from 13 queues token pick, move and placement in order", () => {
    const s = startGame(1);
    const before = s.players.FELLOWSHIP.coins;
    const steps = advanceRing(s, "FELLOWSHIP", 10);
    expect(s.ringTrack.frodoPosition).toBe(23);
    expect(steps.map((x) => x.kind)).toEqual(["TOKEN_RACE", "MOVE", "PLACE"]);
    expect(s.players.FELLOWSHIP.coins).toBe(before); // 13 is the start, not passed
  });

  it("the Nazgûl collect rewards too: 0 → 12 pays coin 2 + token 5 + move 8 + unit 11", () => {
    const s = startGame(1);
    const before = s.players.SAURON.coins;
    const steps = advanceRing(s, "SAURON", 12);
    expect(s.ringTrack.nazgulPosition).toBe(12);
    expect(s.players.SAURON.coins).toBe(before + 1);
    expect(steps.map((x) => x.kind)).toEqual(["TOKEN_RACE", "MOVE", "PLACE"]);
  });

  it("Nazgûl reaching or passing Frodo wins at once with no rewards for that move", () => {
    const s = startGame(1);
    s.ringTrack.nazgulPosition = 10;
    s.ringTrack.frodoPosition = 12;
    const before = s.players.SAURON.coins;
    expect(advanceRing(s, "SAURON", 3)).toEqual([]);
    expect(s.players.SAURON.coins).toBe(before);
    expect(checkInstantVictory(s)).toEqual({ winner: "SAURON", type: "RING_QUEST" });
  });

  it("Frodo reaching Mount Doom (24) wins at once", () => {
    const s = startGame(1);
    s.ringTrack.frodoPosition = 22;
    expect(advanceRing(s, "FELLOWSHIP", 3)).toEqual([]);
    expect(s.ringTrack.frodoPosition).toBe(24);
    expect(checkInstantVictory(s)).toEqual({ winner: "FELLOWSHIP", type: "RING_QUEST" });
  });

  it("a blue card queues the landed-on point's reward before the turn ends", () => {
    let s = startGame(1);
    s.turn = "FELLOWSHIP";
    s.ringTrack.frodoPosition = 21;
    const slot = s.pyramidGrid.findIndex((p) => p.row === 4);
    s.pyramidGrid[slot].card = card("엘론드의 회의"); // ring +1, 2 coins
    s = applyAction(s, { type: "TAKE_CARD", faction: "FELLOWSHIP", slot, mode: "PLAY" });
    expect(s.ringTrack.frodoPosition).toBe(22);
    expect(s.pending[0]).toMatchObject({ kind: "PLACE", count: 1 });
    expect(s.turn).toBe("FELLOWSHIP");
  });
});
