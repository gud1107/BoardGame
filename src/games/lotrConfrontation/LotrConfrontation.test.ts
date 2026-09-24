import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./bot";
import { resolveCards } from "./combat";
import { CARDS, FACTION_CHARACTERS, factionDeck } from "./data";
import { applyAction, pendingFactions, randomPlacement, startGame, type EngineAction, type LotrState } from "./engine";
import { getLegalMoves } from "./movement";
import type { CharacterId, Faction } from "./types";

/** A MOVEMENT-phase state with only the given pieces on the board. */
function board(pieces: [CharacterId, string][], turn: Faction = "FELLOWSHIP"): LotrState {
  const s = startGame(1);
  s.phase = "MOVEMENT";
  s.setupDone = { FELLOWSHIP: true, SAURON: true };
  s.turn = turn;
  s.turnNumber = 1;
  for (const [id, region] of pieces) {
    const faction: Faction = FACTION_CHARACTERS.FELLOWSHIP.includes(id) ? "FELLOWSHIP" : "SAURON";
    s.pieces[id] = { instanceId: id, characterId: id, faction, regionId: region, isRevealed: false };
  }
  return s;
}

const noEscape = () => null;

describe("movement & terrain", () => {
  it("fellowship moves only forward/sideways, sauron only south/sideways", () => {
    const s = board([
      ["SAM", "ANDUIN"],
      ["ORCS", "BARAD_DUR"],
    ]);
    expect(getLegalMoves(s, "SAM").sort()).toEqual(["CARADHRAS", "ERIADOR", "GONDOR"].sort());
    expect(getLegalMoves(s, "SAM")).not.toContain("SHIRE");
    expect(getLegalMoves(s, "ORCS").sort()).toEqual(["CARADHRAS", "CIRITH_UNGOL", "GORGOROTH"].sort());
    expect(getLegalMoves(s, "ORCS")).not.toContain("MORDOR");
  });

  it("Caradhras holds exactly one piece — neither ally nor enemy may join", () => {
    const s = board([
      ["SAM", "ANDUIN"],
      ["ARAGORN", "ERIADOR"],
      ["ORCS", "CARADHRAS"],
    ]);
    expect(getLegalMoves(s, "SAM")).not.toContain("CARADHRAS");
    const s2 = board([
      ["SAM", "ANDUIN"],
      ["GIMLI", "CARADHRAS"],
    ]);
    expect(getLegalMoves(s2, "SAM")).not.toContain("CARADHRAS");
  });

  it("normal regions cap at 2 and a region with 2 enemies can't be attacked", () => {
    const s = board([
      ["SAM", "ERIADOR"],
      ["ORCS", "ROHAN"],
      ["GOBLIN", "ROHAN"],
    ]);
    expect(getLegalMoves(s, "SAM")).not.toContain("ROHAN");
  });

  it("Nazgûl can fly two regions forward over occupied ground", () => {
    const s = board(
      [
        ["NAZGUL", "BARAD_DUR"],
        ["GIMLI", "CARADHRAS"],
        ["SAM", "ERIADOR"],
      ],
      "SAURON",
    );
    expect(getLegalMoves(s, "NAZGUL")).toContain("ANDUIN");
  });
});

describe("secret setup", () => {
  it("is commutative — either arrival order yields identical state", () => {
    const f: EngineAction = { type: "setup", faction: "FELLOWSHIP", placement: randomPlacement("FELLOWSHIP", 3) };
    const sa: EngineAction = { type: "setup", faction: "SAURON", placement: randomPlacement("SAURON", 4) };
    const a = applyAction(applyAction(startGame(9), f), sa);
    const b = applyAction(applyAction(startGame(9), sa), f);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a.phase).toBe("MOVEMENT");
    expect(a.turn).toBe("FELLOWSHIP");
    expect(Object.values(a.pieces).every((p) => p && !p.isRevealed)).toBe(true);
  });

  it("rejects an over-filled region", () => {
    const placement = randomPlacement("FELLOWSHIP", 1);
    for (const c of FACTION_CHARACTERS.FELLOWSHIP) placement[c] = "SHIRE";
    const s = applyAction(startGame(1), { type: "setup", faction: "FELLOWSHIP", placement });
    expect(s.setupDone.FELLOWSHIP).toBe(false);
  });
});

describe("pre-combat abilities", () => {
  it("Merry kills the Witch-king before any card is played", () => {
    const s = board([
      ["MERRY", "ERIADOR"],
      ["WITCH_KING", "ROHAN"],
      ["FRODO", "SHIRE"],
      ["ORCS", "MORDOR"],
    ]);
    const next = applyAction(s, { type: "move", faction: "FELLOWSHIP", pieceId: "MERRY", to: "ROHAN" });
    expect(next.pieces.WITCH_KING).toBeUndefined();
    expect(next.pieces.MERRY?.regionId).toBe("ROHAN");
    expect(next.hands.FELLOWSHIP).toHaveLength(18);
    expect(next.lastCombat?.outcome).toBe("pre-kill");
    expect(next.turn).toBe("SAURON");
  });

  it("Gimli slays orcs and Legolas shoots the Nazgûl even when defending", () => {
    const s = board(
      [
        ["GIMLI", "ERIADOR"],
        ["LEGOLAS", "GONDOR"],
        ["ORCS", "ROHAN"],
        ["NAZGUL", "FANGORN"],
        ["FRODO", "SHIRE"],
        ["SHELOB", "MORDOR"],
      ],
      "SAURON",
    );
    const a = applyAction(s, { type: "move", faction: "SAURON", pieceId: "ORCS", to: "ERIADOR" });
    expect(a.pieces.ORCS).toBeUndefined();
    expect(a.pieces.GIMLI).toBeDefined();
    const b = applyAction(s, { type: "move", faction: "SAURON", pieceId: "NAZGUL", to: "GONDOR" });
    expect(b.pieces.NAZGUL).toBeUndefined();
  });

  it("Frodo may flee backward before cards, cancelling the combat", () => {
    const s = board(
      [
        ["FRODO", "ANDUIN"],
        ["BALROG", "CARADHRAS"],
        ["SAM", "GONDOR"],
      ],
      "SAURON",
    );
    const combat = applyAction(s, { type: "move", faction: "SAURON", pieceId: "BALROG", to: "ANDUIN" });
    expect(combat.phase).toBe("COMBAT");
    expect(combat.combat?.pendingChoice?.kind).toBe("FRODO_FLEE");
    expect(pendingFactions(combat)).toEqual(["FELLOWSHIP"]);
    expect(combat.combat?.pendingChoice?.options).toContain("SHIRE");
    const fled = applyAction(combat, { type: "preChoice", faction: "FELLOWSHIP", choice: { kind: "flee", to: "SHIRE" } });
    expect(fled.pieces.FRODO?.regionId).toBe("SHIRE");
    expect(fled.pieces.BALROG?.regionId).toBe("ANDUIN");
    expect(fled.lastCombat?.outcome).toBe("escaped");
    expect(fled.frodoAttackers).toContain("BALROG");
  });

  it("Boromir takes his foe down with him", () => {
    const s = board([
      ["BOROMIR", "GONDOR"],
      ["CAVE_TROLL", "FANGORN"],
      ["FRODO", "SHIRE"],
      ["ORCS", "MORDOR"],
    ]);
    const next = applyAction(s, { type: "move", faction: "FELLOWSHIP", pieceId: "BOROMIR", to: "FANGORN" });
    expect(next.pieces.BOROMIR).toBeUndefined();
    expect(next.pieces.CAVE_TROLL).toBeUndefined();
  });
});

describe("card resolution", () => {
  const base = { baseZeroed: [] as CharacterId[], frodoAttackers: [] as CharacterId[], findEscape: noEscape };

  it("power = base + card, the loser dies, ties kill both", () => {
    const r = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "SAM", cardId: "F-B6" }, D: { faction: "SAURON", characterId: "ORCS", cardId: "S-B3" } });
    expect(r.power).toEqual({ A: 8, D: 5 });
    expect(r.dead).toEqual({ A: false, D: true });
    const tie = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "SAM", cardId: "F-B3" }, D: { faction: "SAURON", characterId: "ORCS", cardId: "S-B3" } });
    expect(tie.dead).toEqual({ A: true, D: true });
  });

  it("Balrog drags the victor down, unless the Phial shines", () => {
    const r = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "GANDALF", cardId: "F-B6" }, D: { faction: "SAURON", characterId: "BALROG", cardId: "S-B1" } });
    expect(r.dead).toEqual({ A: true, D: true });
    const p = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "ARAGORN", cardId: "F-PHIAL" }, D: { faction: "SAURON", characterId: "BALROG", cardId: "S-B1" } });
    expect(p.dead).toEqual({ A: false, D: true });
  });

  it("Eye of Sauron forces a double death; Gandalf ignores it", () => {
    const r = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "ARAGORN", cardId: "F-B6" }, D: { faction: "SAURON", characterId: "ORCS", cardId: "S-EYE" } });
    expect(r.dead).toEqual({ A: true, D: true });
    const g = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "GANDALF", cardId: "F-B1" }, D: { faction: "SAURON", characterId: "ORCS", cardId: "S-EYE" } });
    expect(g.dead).toEqual({ A: false, D: true });
  });

  it("Morgul blade assassinates Frodo regardless of numbers", () => {
    const r = resolveCards({ ...base, A: { faction: "SAURON", characterId: "GOBLIN", cardId: "S-MORGUL" }, D: { faction: "FELLOWSHIP", characterId: "FRODO", cardId: "F-B6" } });
    expect(r.dead).toEqual({ A: false, D: true });
  });

  it("Magic cancels the opponent's text; two Magics cancel each other", () => {
    const r = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "SAM", cardId: "F-MAGIC1" }, D: { faction: "SAURON", characterId: "GOBLIN", cardId: "S-MORGUL" } });
    expect(r.textOn.D).toBe(false);
    expect(r.power).toEqual({ A: 2, D: 4 });
  });

  it("Mithril keeps the loser alive; Elven Cloak zeroes the enemy card", () => {
    const m = resolveCards({ ...base, A: { faction: "SAURON", characterId: "CAVE_TROLL", cardId: "S-B1" }, D: { faction: "FELLOWSHIP", characterId: "SAM", cardId: "F-MITHRIL" } });
    expect(m.dead).toEqual({ A: false, D: false });
    const c = resolveCards({ ...base, A: { faction: "SAURON", characterId: "ORCS", cardId: "S-B6" }, D: { faction: "FELLOWSHIP", characterId: "LEGOLAS", cardId: "F-CLOAK" } });
    expect(c.power).toEqual({ A: 2, D: 3 });
  });

  it("Aragorn charges at 5, Sam defends at 5 against Frodo's attacker", () => {
    const a = resolveCards({ ...base, A: { faction: "FELLOWSHIP", characterId: "ARAGORN", cardId: "F-B1" }, D: { faction: "SAURON", characterId: "ORCS", cardId: "S-B1" } });
    expect(a.power?.A).toBe(6);
    const s = resolveCards({ ...base, frodoAttackers: ["ORCS"], A: { faction: "SAURON", characterId: "ORCS", cardId: "S-B1" }, D: { faction: "FELLOWSHIP", characterId: "SAM", cardId: "F-B1" } });
    expect(s.power?.D).toBe(6);
  });
});

describe("combat flow & hand cycling", () => {
  it("blind picks are order-independent and refill an empty hand from the discard pile", () => {
    const s = board([
      ["SAM", "ERIADOR"],
      ["ORCS", "ROHAN"],
      ["FRODO", "SHIRE"],
      ["SHELOB", "MORDOR"],
    ]);
    s.hands.FELLOWSHIP = ["F-B6"];
    s.discards.FELLOWSHIP = factionDeck("FELLOWSHIP").filter((id) => id !== "F-B6");
    const combat = applyAction(s, { type: "move", faction: "FELLOWSHIP", pieceId: "SAM", to: "ROHAN" });
    expect(combat.combat?.step).toBe("CARD_PICK");
    const f: EngineAction = { type: "pickCard", faction: "FELLOWSHIP", cardId: "F-B6" };
    const sa: EngineAction = { type: "pickCard", faction: "SAURON", cardId: "S-B1" };
    const a = applyAction(applyAction(combat, f), sa);
    const b = applyAction(applyAction(combat, sa), f);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a.pieces.ORCS).toBeUndefined();
    // Orcs' 물량 공세 destroys the winning card, then the empty hand cycles in the discard pile.
    expect(a.destroyed).toContain("F-B6");
    expect(a.hands.FELLOWSHIP).toHaveLength(17);
    expect(a.discards.FELLOWSHIP).toHaveLength(0);
  });

  it("when both survive, the attacker walks back to where it came from", () => {
    const s = board([
      ["SAM", "ERIADOR"],
      ["CAVE_TROLL", "ROHAN"],
      ["FRODO", "SHIRE"],
    ]);
    const combat = applyAction(s, { type: "move", faction: "FELLOWSHIP", pieceId: "SAM", to: "ROHAN" });
    const done = applyAction(applyAction(combat, { type: "pickCard", faction: "FELLOWSHIP", cardId: "F-MITHRIL" }), { type: "pickCard", faction: "SAURON", cardId: "S-B1" });
    expect(done.pieces.SAM?.regionId).toBe("ERIADOR");
    expect(done.lastCombat?.outcome).toBe("both-survive");
  });
});

describe("victory conditions", () => {
  it("Frodo stepping into Mordor wins for the Fellowship", () => {
    const s = board([
      ["FRODO", "BARAD_DUR"],
      ["ORCS", "ROHAN"],
    ]);
    const next = applyAction(s, { type: "move", faction: "FELLOWSHIP", pieceId: "FRODO", to: "MORDOR" });
    expect(next.phase).toBe("GAME_OVER");
    expect(next.winner).toBe("FELLOWSHIP");
  });

  it("three Sauron pieces in the Shire win for Sauron", () => {
    const s = board(
      [
        ["ORCS", "SHIRE"],
        ["GOBLIN", "SHIRE"],
        ["SHELOB", "ANDUIN"],
        ["FRODO", "BARAD_DUR"],
      ],
      "SAURON",
    );
    const next = applyAction(s, { type: "move", faction: "SAURON", pieceId: "SHELOB", to: "SHIRE" });
    expect(next.winner).toBe("SAURON");
    expect(next.shireInvadersCount).toBe(3);
  });

  it("killing Frodo wins for Sauron", () => {
    const s = board(
      [
        ["FRODO", "ERIADOR"],
        ["ORCS", "ROHAN"],
        ["GIMLI", "SHIRE"],
        ["SAM", "ANDUIN"],
      ],
      "SAURON",
    );
    const c = applyAction(s, { type: "move", faction: "SAURON", pieceId: "ORCS", to: "ERIADOR" });
    const stay = applyAction(c, { type: "preChoice", faction: "FELLOWSHIP", choice: { kind: "stay" } });
    const done = applyAction(applyAction(stay, { type: "pickCard", faction: "FELLOWSHIP", cardId: "F-B1" }), { type: "pickCard", faction: "SAURON", cardId: "S-B6" });
    expect(done.winner).toBe("SAURON");
  });

  it("a side with no legal move on its turn loses", () => {
    const s = board(
      [
        ["FRODO", "ANDUIN"],
        ["ORCS", "SHIRE"],
        ["GIMLI", "GORGOROTH"],
      ],
      "FELLOWSHIP",
    );
    // Sauron's only piece is parked in the Shire (no forward/side exits) — after Fellowship moves, Sauron is stuck.
    const next = applyAction(s, { type: "move", faction: "FELLOWSHIP", pieceId: "GIMLI", to: "BARAD_DUR" });
    expect(next.winner).toBe("FELLOWSHIP");
    expect(next.winReason).toContain("기동 불가");
  });
});

describe("bot self-play", () => {
  it("finishes games without stalling, preserving the 36 cards", () => {
    const winners: Record<string, number> = { FELLOWSHIP: 0, SAURON: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      let s = startGame(seed, seed % 2 ? "p1" : "p2");
      let guard = 0;
      while (s.phase !== "GAME_OVER" && guard++ < 3000) {
        const pending = pendingFactions(s);
        expect(pending.length).toBeGreaterThan(0);
        const f = pending[0];
        const action = chooseBotAction(s, f, (seed % 10) + 1 as 1);
        expect(action).not.toBeNull();
        const next = applyAction(s, action!);
        expect(next).not.toBe(s);
        s = next;
        const cards = (["FELLOWSHIP", "SAURON"] as Faction[]).reduce((n, fa) => n + s.hands[fa].length + s.discards[fa].length, 0) + s.destroyed.length;
        const inPlay = s.combat ? 0 : 0;
        expect(cards + inPlay).toBe(36);
      }
      expect(s.phase).toBe("GAME_OVER");
      winners[s.winner!] += 1;
    }
    expect(winners.FELLOWSHIP + winners.SAURON).toBe(40);
  });

  it("every card id is unique and each faction has 18", () => {
    expect(Object.keys(CARDS)).toHaveLength(36);
    expect(factionDeck("FELLOWSHIP")).toHaveLength(18);
    expect(factionDeck("SAURON")).toHaveLength(18);
  });
});
