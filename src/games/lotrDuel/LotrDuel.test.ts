import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./bot";
import { CARD_BY_ID, CHAPTER_DECKS, FRODO_START, LANDMARKS, NAZGUL_START, OFFICIAL_RING_TRACK, TOKENS, TRACK_LENGTH } from "./data";
import {
  advanceRing,
  applyAction,
  availableSlots,
  calculateCardCost,
  calculateLandmarkCost,
  missingTech,
  techCoverage,
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
    expect(checkInstantVictory({ ...s, ringTrack: { ...s.ringTrack, nazgulPosition: TRACK_LENGTH } })).toEqual({ winner: "SAURON", type: "RING_QUEST" });
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

  it("playing a blue card that brings the Nazgûl to the finish ends the game at once", () => {
    let s = startGame(1);
    s.ringTrack.frodoPosition = 5;
    s.ringTrack.nazgulPosition = 13;
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

describe("single integrated ring track (0 … 14)", () => {
  it("has 15 points, rewards every 2 spaces, both markers start on 0 with no instant win", () => {
    expect(OFFICIAL_RING_TRACK).toHaveLength(15);
    expect(TRACK_LENGTH).toBe(14);
    const rewarded = OFFICIAL_RING_TRACK.filter((p) => p.reward !== "NONE").map((p) => `${p.index}:${p.reward}`);
    expect(rewarded).toEqual(["2:COIN_1", "4:PLACE_UNIT", "6:ALLIANCE_TOKEN", "8:EXTRA_TURN", "10:DESTROY_FORTRESS", "14:MOUNT_DOOM_VICTORY"]);
    const s = startGame(1);
    expect(s.ringTrack.frodoPosition).toBe(0);
    expect(s.ringTrack.nazgulPosition).toBe(NAZGUL_START);
    expect(NAZGUL_START).toBe(0);
    expect(checkInstantVictory(s)).toBeNull();
  });

  it("Sauron's first ring move (Nazgûl level with Frodo, not behind) does not win", () => {
    const s = startGame(1);
    advanceRing(s, "SAURON", 1);
    expect(s.ringTrack.nazgulPosition).toBe(1);
    expect(checkInstantVictory(s)).toBeNull();
  });

  it("pays every point passed or landed on, in order: 0 → 12 = coin, unit, token, extra turn, fortress", () => {
    const s = startGame(1);
    s.boardRegions.MORDOR.sauronFortress = true;
    const before = s.players.FELLOWSHIP.coins;
    const steps = advanceRing(s, "FELLOWSHIP", 12);
    expect(s.ringTrack.frodoPosition).toBe(12);
    expect(s.players.FELLOWSHIP.coins).toBe(before + 1);
    expect(steps.map((x) => x.kind)).toEqual(["PLACE", "TOKEN_RACE", "DESTROY_FORTRESS"]);
    expect(s.extraTurn).toBe(true);
  });

  it("the Nazgûl collect the same rewards while they run", () => {
    const s = startGame(1);
    s.ringTrack.frodoPosition = 9;
    const before = s.players.SAURON.coins;
    const steps = advanceRing(s, "SAURON", 6);
    expect(s.players.SAURON.coins).toBe(before + 1);
    expect(steps.map((x) => x.kind)).toEqual(["PLACE", "TOKEN_RACE"]);
    expect(checkInstantVictory(s)).toBeNull();
  });

  it("the Nazgûl landing on or passing Frodo's space does not end the game, and still pay rewards", () => {
    const s = startGame(1);
    s.ringTrack.frodoPosition = 6;
    s.ringTrack.nazgulPosition = 3;
    expect(advanceRing(s, "SAURON", 3).map((x) => x.kind)).toEqual(["PLACE", "TOKEN_RACE"]);
    expect(s.ringTrack.nazgulPosition).toBe(6);
    expect(checkInstantVictory(s)).toBeNull();
    const before = s.players.SAURON.coins;
    advanceRing(s, "SAURON", 3);
    expect(s.ringTrack.nazgulPosition).toBe(9);
    expect(s.players.SAURON.coins).toBe(before);
    expect(s.extraTurn).toBe(true);
    expect(checkInstantVictory(s)).toBeNull();
  });

  it("Frodo overtaking the Nazgûl does not end the game either", () => {
    const s = startGame(1);
    s.ringTrack.frodoPosition = 3;
    s.ringTrack.nazgulPosition = 5;
    advanceRing(s, "FELLOWSHIP", 4);
    expect(s.ringTrack.frodoPosition).toBe(7);
    expect(checkInstantVictory(s)).toBeNull();
  });

  it("the Nazgûl reaching the finish (14) first wins at once with no rewards", () => {
    const s = startGame(1);
    s.ringTrack.frodoPosition = 13;
    s.ringTrack.nazgulPosition = 12;
    const before = s.players.SAURON.coins;
    expect(advanceRing(s, "SAURON", 5)).toEqual([]);
    expect(s.ringTrack.nazgulPosition).toBe(14);
    expect(s.players.SAURON.coins).toBe(before);
    expect(checkInstantVictory(s)).toEqual({ winner: "SAURON", type: "RING_QUEST" });
  });

  it("Frodo reaching Mount Doom (14) wins at once", () => {
    const s = startGame(1);
    s.ringTrack.frodoPosition = 12;
    expect(advanceRing(s, "FELLOWSHIP", 3)).toEqual([]);
    expect(s.ringTrack.frodoPosition).toBe(14);
    expect(checkInstantVictory(s)).toEqual({ winner: "FELLOWSHIP", type: "RING_QUEST" });
  });

  it("a blue card landing on 8 grants the extra turn (same player moves again)", () => {
    let s = startGame(1);
    s.turn = "FELLOWSHIP";
    s.ringTrack.frodoPosition = 7;
    const slot = s.pyramidGrid.findIndex((p) => p.row === 4);
    s.pyramidGrid[slot].card = card("엘론드의 회의"); // ring +1, 2 coins
    s = applyAction(s, { type: "TAKE_CARD", faction: "FELLOWSHIP", slot, mode: "PLAY" });
    expect(s.ringTrack.frodoPosition).toBe(8);
    expect(s.turn).toBe("FELLOWSHIP");
    expect(s.pending).toHaveLength(0);
  });
});

describe("history log card metadata", () => {
  it("binds the bought / discarded card (id, use, coins) to its log entry", () => {
    let s = startGame(11);
    const slots = availableSlots(s);
    const discarded = s.pyramidGrid[slots[0]].card;
    s = applyAction(s, { type: "TAKE_CARD", faction: "SAURON", slot: slots[0], mode: "DISCARD" });
    const d = s.log.find((e) => e.kind === "DISCARD");
    expect(d?.card).toEqual({ id: discarded.id, use: "DISCARD", coins: 1 });
    expect(d?.turn).toBe(1);

    const slot = availableSlots(s)[0];
    s.pyramidGrid[slot].card = card("브리 여관"); // free yellow
    s = applyAction(s, { type: "TAKE_CARD", faction: "FELLOWSHIP", slot, mode: "PLAY" });
    const p = s.log.find((e) => e.kind === "CARD");
    expect(p?.card).toMatchObject({ id: card("브리 여관").id, use: "PLAY", coins: 0 });
    expect(p?.faction).toBe("FELLOWSHIP");
    expect(CARD_BY_ID[p!.card!.id].name).toBe("브리 여관");
  });
});

describe("techCoverage (dual-cost display)", () => {
  it("marks each printed tech symbol covered/uncovered consistently with missingTech", () => {
    const s = startGame(1);
    const p = s.players.FELLOWSHIP;
    const need = card("강행군").cost.tech!; // FLAG FLAG SWORD
    expect(techCoverage(p, need)).toEqual([false, false, false]);
    p.tableauCards.push(card("곤도르 봉화")); // FLAG
    expect(techCoverage(p, need)).toEqual([true, false, false]);
    p.tableauCards.push(card("전쟁 회의")); // SWORD | FLAG — optimal matching covers one more
    expect(techCoverage(p, need).filter(Boolean)).toHaveLength(2);
    expect(techCoverage(p, need).filter((c) => !c)).toHaveLength(missingTech(p, need));
  });
});
