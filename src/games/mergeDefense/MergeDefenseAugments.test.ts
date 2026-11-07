import { describe, expect, it } from "vitest";
import {
  applyAction,
  augDamageMult,
  augmentHp,
  boardLimit,
  chooseBotAction,
  computeRankings,
  eliminationLimit,
  PREP_TICKS,
  sanitizeAction,
  sellValue,
  startGame,
  stepGame,
  summonCost,
  unitDamage,
  unitInterval,
  unitRange,
  WAVE_TICKS,
  type MergeDefenseState,
} from "./engine";
import { AUG_BALANCE, AUG_PICK_TICKS, AUG_WAVES, AUGMENT_LIST, AUGMENTS, augTotals } from "./augments";

/** Steps until the tick where wave `w` starts (and its pick round, if any, opens). */
function toWave(s: MergeDefenseState, w: number): MergeDefenseState {
  const target = PREP_TICKS + (w - 1) * WAVE_TICKS;
  while (s.tick < target) {
    s = stepGame(s);
    // Keep the boards from being overrun on an empty board.
    for (const b of s.boards) b.mobs = [];
  }
  return s;
}

describe("merge defense ✨ augments", () => {
  it("is off unless the match asks for it", () => {
    let s = toWave(startGame(2, 7), AUG_WAVES[0]);
    expect(s.augments).toBeUndefined();
    expect(s.boards.every((b) => !b.augOffer)).toBe(true);
    s = toWave(startGame(2, 7, [], "survival", null, "normal", "classic", 3, true), AUG_WAVES[0]);
    expect(s.augments).toBe(true);
    for (const b of s.boards) {
      expect(b.augOffer?.cards).toHaveLength(3);
      expect(new Set(b.augOffer!.cards).size).toBe(3);
    }
    // One tier roll per round for everybody.
    expect(new Set(s.boards.map((b) => b.augOffer!.tier)).size).toBe(1);
    expect(s.events.some((e) => e.type === "aug-round")).toBe(true);
  });

  it("picks one offered card, rejects others, and the timer takes the first card", () => {
    let s = toWave(startGame(2, 11, [], "survival", null, "normal", "classic", 3, true), AUG_WAVES[0]);
    const offer = s.boards[0].augOffer!;
    const notOffered = AUGMENT_LIST.find((a) => !offer.cards.includes(a.id))!.id;
    expect(applyAction(s, 0, { type: "augment", id: notOffered })).toBe(s);
    s = applyAction(s, 0, { type: "augment", id: offer.cards[1] });
    expect(s.boards[0].augments).toEqual([offer.cards[1]]);
    expect(s.boards[0].augOffer).toBeUndefined();
    const first = s.boards[1].augOffer!.cards[0];
    for (let i = 0; i < AUG_PICK_TICKS + 1; i++) s = stepGame(s);
    expect(s.boards[1].augments).toEqual([first]);
    expect(s.events.some((e) => e.type === "augment" && e.seat === 1 && e.auto)).toBe(true);
  });

  it("allows one reroll per match", () => {
    let s = toWave(startGame(2, 12, [], "survival", null, "normal", "classic", 3, true), AUG_WAVES[0]);
    const before = s.boards[0].augOffer!.cards;
    s = applyAction(s, 0, { type: "reroll" });
    expect(s.boards[0].augOffer!.cards).not.toEqual(before);
    expect(s.boards[0].augRerolls).toBe(1);
    expect(applyAction(s, 0, { type: "reroll" })).toBe(s);
  });

  it("never offers an owned card or a versus-only card in survival", () => {
    let s = startGame(2, 13, [], "survival", null, "normal", "classic", 3, true);
    for (const w of AUG_WAVES) {
      s = toWave(s, w);
      for (const b of s.boards) {
        for (const id of b.augOffer!.cards) {
          expect(b.augments ?? []).not.toContain(id);
          expect(AUGMENTS[id].versusOnly).toBeFalsy();
        }
      }
      s = applyAction(s, 0, { type: "augment", id: s.boards[0].augOffer!.cards[0] });
    }
    expect(s.boards[0].augments).toHaveLength(AUG_WAVES.length);
  });

  it("effects feed the existing formulas", () => {
    const s = startGame(2, 1, [], "survival", null, "normal", "classic", 3, true);
    const b = s.boards[0];
    const archer = { kind: "archer" as const, grade: 1, cd: 0, paid: 20 };
    b.units[0] = archer;
    const dmg0 = unitDamage(archer, b);
    const int0 = unitInterval(archer, b);
    const rng0 = unitRange(archer, b);
    const cost0 = summonCost(b);
    b.summons = 4;
    const cost4 = summonCost(b);
    b.augments = ["sharp", "haste", "eagle", "cheap", "recycle", "bulwark"];
    expect(unitDamage(archer, b)).toBeCloseTo(dmg0 * (1 + AUGMENTS.sharp.fx.phys!));
    expect(unitInterval(archer, b)).toBeLessThan(int0);
    expect(unitRange(archer, b)).toBe(rng0 + 18);
    expect(summonCost(b) - cost0).toBeLessThan(cost4 - cost0);
    expect(sellValue(archer, b)).toBe(20);
    expect(sellValue(archer)).toBe(16);
    expect(boardLimit(s, b)).toBe(eliminationLimit(s) + 8);
    // 외골수 only boosts the most common kind; 무지개 counts distinct kinds.
    b.augments = ["specialist"];
    b.units[1] = { kind: "archer", grade: 1, cd: 0 };
    b.units[2] = { kind: "mage", grade: 1, cd: 0 };
    expect(augDamageMult({ kind: "archer", grade: 1 }, b)).toBeCloseTo(1.6);
    expect(augDamageMult({ kind: "mage", grade: 1 }, b)).toBe(1);
    b.augments = ["rainbow"];
    expect(augDamageMult({ kind: "mage", grade: 1 }, b)).toBeCloseTo(1 + 2 * AUGMENTS.rainbow.fx.rainbow!);
    expect(augTotals(undefined).phys).toBe(0);
  });

  it("instant cards act once on pick", () => {
    const s = toWave(startGame(2, 21, [], "survival", null, "normal", "classic", 3, true), AUG_WAVES[0]);
    const b = s.boards[0];
    b.augOffer = { ...b.augOffer!, cards: ["hero", "ascend", "gempouch"] };
    const gems = b.gems;
    const after = applyAction(s, 0, { type: "augment", id: "hero" });
    expect(after.boards[0].units.filter((u) => u?.grade === 3)).toHaveLength(2);
    s.boards[0].units[3] = { kind: "frost", grade: 3, cd: 0 };
    const asc = applyAction(s, 0, { type: "augment", id: "ascend" });
    expect(asc.boards[0].units[3]!.grade).toBe(4);
    const gp = applyAction(s, 0, { type: "augment", id: "gempouch" });
    expect(gp.boards[0].gems).toBe(gems + 3);
  });

  it("monster HP bonus ramps in only with augments on", () => {
    expect(augmentHp({}, 30)).toBe(1);
    expect(augmentHp({ augments: true }, AUG_BALANCE.from)).toBe(1);
    expect(augmentHp({ augments: true }, AUG_BALANCE.to + 5)).toBeCloseTo(AUG_BALANCE.hp);
  });

  it("sanitizes augment actions and bots pick a card", () => {
    expect(sanitizeAction({ type: "augment", id: "haste" })).toEqual({ type: "augment", id: "haste" });
    expect(sanitizeAction({ type: "augment", id: "nope" })).toBeNull();
    expect(sanitizeAction({ type: "reroll" })).toEqual({ type: "reroll" });
    const s = toWave(startGame(2, 31, [], "survival", null, "normal", "classic", 3, true), AUG_WAVES[0]);
    const a = chooseBotAction(s, 0, { augmentPick: "best" });
    expect(a?.type).toBe("augment");
    expect(s.boards[0].augOffer!.cards).toContain((a as { id: string }).id);
    // The player's 🤖 자동 leaves the pick to the player (no augmentPick).
    expect(chooseBotAction(s, 0, {})?.type).not.toBe("augment");
  });

  it("bot-vs-bot augment games still end in a sane time", () => {
    for (const [n, seed, mode] of [
      [2, 41, "survival"],
      [4, 42, "survival"],
      [2, 43, "versus"],
    ] as const) {
      let s = startGame(n, seed, [], mode, null, "normal", "classic", 3, true);
      while (s.phase === "playing" && s.tick < 20 * 60 * 25) {
        for (let seat = 0; seat < n; seat++) {
          if ((s.tick + seat * 3) % 10 !== 0) continue;
          const a = chooseBotAction(s, seat, { augmentPick: "best" });
          if (a) s = applyAction(s, seat, a);
        }
        s = stepGame(s);
      }
      expect(s.phase).toBe("gameOver");
      const minutes = (s.tick - PREP_TICKS) / 20 / 60;
      expect(minutes).toBeGreaterThan(4);
      expect(minutes).toBeLessThan(16);
      expect(s.boards.some((b) => (b.augments?.length ?? 0) >= 2)).toBe(true);
      expect(computeRankings(s).filter((r) => r.rank === 1).length).toBeGreaterThanOrEqual(1);
    }
  });
});
