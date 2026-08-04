import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildCardCatalog,
  canBang,
  circleDistance,
  effectiveDistance,
  livingSeatsInOrder,
  ROLE_SETS,
  startGame,
  weaponRange,
  type BangState,
  type Card,
  type CardType,
  type EquipSlot,
  type PendingDuel,
  type PendingGeneralStore,
  type PendingGroupResponse,
  type PlayerState,
  type Role,
  type Suit,
} from "./engine";

function card(type: CardType, id: string, suit: Suit = "D", rank = 5): Card {
  return { id, type, suit, rank };
}

function emptyEquipment(): Record<EquipSlot, Card | null> {
  return { weapon: null, scope: null, mustang: null, barrel: null, jail: null, dynamite: null };
}

function makePlayer(seat: number, role: Role, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    seat,
    role,
    alive: true,
    roleRevealed: role === "sheriff",
    life: role === "sheriff" ? 5 : 4,
    maxLife: role === "sheriff" ? 5 : 4,
    hand: [],
    equipment: emptyEquipment(),
    bangPlayedThisTurn: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<BangState> = {}): BangState {
  const players = [
    makePlayer(0, "sheriff"),
    makePlayer(1, "outlaw"),
    makePlayer(2, "outlaw"),
    makePlayer(3, "renegade"),
  ];
  return {
    turnOrder: [0, 1, 2, 3],
    players,
    deck: [],
    discard: [],
    turnSeat: 0,
    turnPhase: "action",
    pending: null,
    turnNumber: 1,
    winner: null,
    playerCount: 4,
    ...overrides,
  };
}

describe("deck composition", () => {
  const deck = buildCardCatalog();

  it("has exactly 80 cards", () => {
    expect(deck.length).toBe(80);
  });

  it("has unique ids", () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(80);
  });

  it("matches the published base-game per-type counts", () => {
    const counts: Partial<Record<CardType, number>> = {};
    for (const c of deck) counts[c.type] = (counts[c.type] ?? 0) + 1;
    expect(counts).toEqual({
      bang: 25,
      missed: 12,
      beer: 6,
      panic: 4,
      "cat-balou": 4,
      duel: 3,
      stagecoach: 2,
      "general-store": 2,
      mustang: 2,
      indians: 2,
      gatling: 1,
      jail: 3,
      dynamite: 1,
      volcanic: 2,
      schofield: 3,
      remington: 1,
      "rev-carbine": 1,
      winchester: 1,
      barrel: 2,
      scope: 1,
      saloon: 1,
      "wells-fargo": 1,
    });
  });

  it("has ~20 Hearts (Barrel/Jail odds) and ~8 Spade 2-9 (Dynamite odds)", () => {
    expect(deck.filter((c) => c.suit === "H").length).toBe(20);
    expect(deck.filter((c) => c.suit === "S" && c.rank >= 2 && c.rank <= 9).length).toBe(8);
  });
});

describe("startGame", () => {
  it.each([4, 5, 6, 7])("assigns the correct role multiset for %i players", (n) => {
    const state = startGame(n, 12345);
    const roles = state.players.map((p) => p.role).sort();
    expect(roles).toEqual([...ROLE_SETS[n]].sort());
  });

  it("always seats the sheriff first in turn order", () => {
    const state = startGame(6, 999);
    const sheriffSeat = state.players.findIndex((p) => p.role === "sheriff");
    expect(state.turnOrder[0]).toBe(sheriffSeat);
    expect(state.turnSeat).toBe(sheriffSeat);
  });

  it("deals each player a hand equal to their starting life", () => {
    const state = startGame(5, 7);
    for (const p of state.players) {
      expect(p.hand.length).toBe(p.maxLife);
      expect(p.life).toBe(p.maxLife);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(7, 42);
    const b = startGame(7, 42);
    expect(a).toEqual(b);
  });

  it("leaves the sheriff's role publicly revealed and others hidden", () => {
    const state = startGame(4, 1);
    for (const p of state.players) {
      expect(p.roleRevealed).toBe(p.role === "sheriff");
    }
  });
});

describe("distance helpers", () => {
  it("computes circle distance around a 4-seat table", () => {
    const state = makeState();
    expect(circleDistance(state, 0, 1)).toBe(1);
    expect(circleDistance(state, 0, 2)).toBe(2);
    expect(circleDistance(state, 0, 3)).toBe(1);
  });

  it("closes up the circle when a seat is eliminated", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { alive: false }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    expect(livingSeatsInOrder(state)).toEqual([0, 2, 3]);
    expect(circleDistance(state, 0, 2)).toBe(1); // was 2 with seat1 alive
  });

  it("applies scope (attacker -1) and mustang (defender +1)", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { equipment: { ...emptyEquipment(), scope: card("scope", "sc1") } }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw", { equipment: { ...emptyEquipment(), mustang: card("mustang", "mu1") } }),
        makePlayer(3, "renegade"),
      ],
    });
    expect(effectiveDistance(state, 0, 2)).toBe(2); // base 2, +1 mustang, -1 scope = 2
    expect(effectiveDistance(state, 1, 2)).toBe(2); // base 1, +1 mustang, no scope
  });

  it("weaponRange defaults to 1 (Colt .45) and matches equipped weapon", () => {
    const unarmed = makePlayer(0, "sheriff");
    expect(weaponRange(unarmed)).toBe(1);
    const armed = makePlayer(0, "sheriff", {
      equipment: { ...emptyEquipment(), weapon: card("winchester", "w1") },
    });
    expect(weaponRange(armed)).toBe(5);
  });

  it("canBang respects range and living targets", () => {
    const state = makeState();
    expect(canBang(state, 0, 1)).toBe(true); // distance 1, unarmed range 1
    expect(canBang(state, 0, 2)).toBe(false); // distance 2, unarmed range 1
    expect(canBang(state, 0, 0)).toBe(false); // self
  });
});

describe("begin-turn: dynamite and jail checks", () => {
  it("draws 2 cards and moves to action phase with no equipment", () => {
    const state = makeState({
      turnPhase: "begin-turn",
      deck: [card("bang", "b1"), card("bang", "b2"), card("bang", "b3")],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.turnPhase).toBe("action");
    expect(next.players[0].hand.length).toBe(2);
    expect(next.deck.length).toBe(1);
  });

  it("dynamite explodes on Spade 2-9, deals 3 damage, and continues the same turn if the holder survives", () => {
    const state = makeState({
      turnPhase: "begin-turn",
      players: [
        makePlayer(0, "sheriff", { equipment: { ...emptyEquipment(), dynamite: card("dynamite", "dyn1") } }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "explode", "S", 5), card("bang", "d1"), card("bang", "d2")],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.players[0].life).toBe(2); // 5 - 3
    expect(next.players[0].equipment.dynamite).toBeNull();
    expect(next.turnPhase).toBe("action"); // survived, turn continues
    expect(next.players[0].hand.length).toBe(2); // still drew 2
  });

  it("dynamite explosion that kills advances to the next living seat (when it doesn't itself end the game)", () => {
    // The dying seat is the Renegade, not the Sheriff, so the game continues
    // afterward (Sheriff + Outlaws are still alive) rather than immediately
    // ending — this isolates "active player died mid-resolution" from the
    // "Sheriff died" win-condition path, which is covered separately below.
    const state = makeState({
      turnPhase: "begin-turn",
      turnSeat: 3,
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade", { life: 2, equipment: { ...emptyEquipment(), dynamite: card("dynamite", "dyn1") } }),
      ],
      deck: [card("bang", "explode", "S", 5)],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.players[3].alive).toBe(false);
    expect(next.players[3].roleRevealed).toBe(true);
    expect(next.winner).toBeNull();
    expect(next.turnSeat).toBe(0);
    expect(next.turnPhase).toBe("begin-turn");
  });

  it("a dynamite explosion that kills the Sheriff ends the game immediately (Outlaws win) instead of advancing turns", () => {
    const state = makeState({
      turnPhase: "begin-turn",
      players: [
        makePlayer(0, "sheriff", { life: 2, equipment: { ...emptyEquipment(), dynamite: card("dynamite", "dyn1") } }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "explode", "S", 5)],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.players[0].alive).toBe(false);
    expect(next.winner).toBe("outlaw");
    expect(next.turnPhase).toBe("game-end");
  });

  it("dynamite passes to the next living seat on a non-exploding draw", () => {
    const state = makeState({
      turnPhase: "begin-turn",
      players: [
        makePlayer(0, "sheriff", { equipment: { ...emptyEquipment(), dynamite: card("dynamite", "dyn1") } }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "safe", "H", 5), card("bang", "d1"), card("bang", "d2")],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.players[0].equipment.dynamite).toBeNull();
    expect(next.players[1].equipment.dynamite).not.toBeNull();
    expect(next.turnPhase).toBe("action");
  });

  it("jail: a Heart draw frees the player and their turn proceeds normally", () => {
    const state = makeState({
      turnPhase: "begin-turn",
      players: [
        makePlayer(0, "sheriff", { equipment: { ...emptyEquipment(), jail: card("jail", "j1") } }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "free", "H", 8), card("bang", "d1"), card("bang", "d2")],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.players[0].equipment.jail).toBeNull();
    expect(next.turnPhase).toBe("action");
    expect(next.players[0].hand.length).toBe(2);
  });

  it("jail: a non-Heart draw skips the whole turn", () => {
    const state = makeState({
      turnPhase: "begin-turn",
      players: [
        makePlayer(0, "sheriff", { equipment: { ...emptyEquipment(), jail: card("jail", "j1") } }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "stuck", "S", 10), card("bang", "d1"), card("bang", "d2")],
    });
    const next = applyAction(state, { type: "begin-turn", seed: 1 });
    expect(next.players[0].equipment.jail).toBeNull();
    expect(next.players[0].hand.length).toBe(0); // no draw phase reached
    expect(next.turnSeat).toBe(1);
    expect(next.turnPhase).toBe("begin-turn");
  });
});

describe("end-turn", () => {
  it("rejects ending the turn if the hand still exceeds the life limit", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { life: 5, hand: [card("bang", "a"), card("bang", "b"), card("bang", "c"), card("bang", "d"), card("bang", "e"), card("bang", "f")] }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const rejected = applyAction(state, { type: "end-turn", discardCardIds: [] }); // hand 6 > life 5, no discards given
    expect(rejected.turnSeat).toBe(0);
    expect(rejected.players[0].hand.length).toBe(6);

    const accepted = applyAction(state, { type: "end-turn", discardCardIds: ["a"] }); // hand 6 - 1 = 5 <= life 5
    expect(accepted.turnSeat).toBe(1);
    expect(accepted.players[0].hand.length).toBe(5);
  });

  it("advances to the next living seat, skipping the dead, and increments turnNumber", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { alive: false }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "end-turn", discardCardIds: [] });
    expect(next.turnSeat).toBe(2);
    expect(next.turnPhase).toBe("begin-turn");
    expect(next.turnNumber).toBe(2);
  });
});

describe("non-reactive cards", () => {
  it("Beer heals 1 life capped at maxLife, and has no effect with only 2 alive", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { life: 4, hand: [card("beer", "beer1")] }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-beer", cardId: "beer1" });
    expect(next.players[0].life).toBe(5);
    expect(next.players[0].hand.length).toBe(0);

    const twoAlive = makeState({
      players: [
        makePlayer(0, "sheriff", { life: 4, hand: [card("beer", "beer1")] }),
        makePlayer(1, "outlaw", { alive: false }),
        makePlayer(2, "outlaw", { alive: false }),
        makePlayer(3, "renegade"),
      ],
    });
    const noEffect = applyAction(twoAlive, { type: "play-beer", cardId: "beer1" });
    expect(noEffect).toEqual(twoAlive); // no-op
  });

  it("Saloon heals every living player by 1, capped at their own maxLife", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { life: 3, hand: [card("saloon", "sal1")] }),
        makePlayer(1, "outlaw", { life: 4 }), // already full, stays at 4
        makePlayer(2, "outlaw", { life: 1, alive: false }),
        makePlayer(3, "renegade", { life: 2 }),
      ],
    });
    const next = applyAction(state, { type: "play-saloon", cardId: "sal1" });
    expect(next.players[0].life).toBe(4);
    expect(next.players[1].life).toBe(4);
    expect(next.players[2].life).toBe(1); // dead, untouched
    expect(next.players[3].life).toBe(3);
  });

  it("Stagecoach draws 2, Wells Fargo draws 3", () => {
    const deck = Array.from({ length: 5 }, (_, i) => card("bang", `b${i}`));
    const state = makeState({ players: [makePlayer(0, "sheriff", { hand: [card("stagecoach", "sc1")] }), makePlayer(1, "outlaw"), makePlayer(2, "outlaw"), makePlayer(3, "renegade")], deck });
    const next = applyAction(state, { type: "play-stagecoach", cardId: "sc1", seed: 1 });
    expect(next.players[0].hand.length).toBe(2);
    expect(next.deck.length).toBe(3);

    const state2 = makeState({ players: [makePlayer(0, "sheriff", { hand: [card("wells-fargo", "wf1")] }), makePlayer(1, "outlaw"), makePlayer(2, "outlaw"), makePlayer(3, "renegade")], deck });
    const next2 = applyAction(state2, { type: "play-wells-fargo", cardId: "wf1", seed: 1 });
    expect(next2.players[0].hand.length).toBe(3);
    expect(next2.deck.length).toBe(2);
  });

  it("equipping a weapon replaces the old one, which goes to discard, and updates weaponRange", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", {
          hand: [card("schofield", "sch1")],
          equipment: { ...emptyEquipment(), weapon: card("volcanic", "volc-old") },
        }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-weapon", cardId: "sch1" });
    expect(next.players[0].equipment.weapon?.id).toBe("sch1");
    expect(next.discard.some((c) => c.id === "volc-old")).toBe(true);
    expect(weaponRange(next.players[0])).toBe(2);
  });

  it("Panic! within distance 1 steals a card from hand into the attacker's hand", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("panic", "pan1")] }),
        makePlayer(1, "outlaw", { hand: [card("bang", "victim-card")] }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-panic", cardId: "pan1", targetSeat: 1, from: "hand", seed: 1 });
    expect(next.players[1].hand.length).toBe(0);
    expect(next.players[0].hand.some((c) => c.id === "victim-card")).toBe(true);
  });

  it("Panic! is rejected beyond distance 1", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("panic", "pan1")] }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw", { hand: [card("bang", "victim-card")] }),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-panic", cardId: "pan1", targetSeat: 2, from: "hand", seed: 1 });
    expect(next).toEqual(state); // no-op, distance 2 > 1
  });

  it("Panic! from equip steals the named equipped card", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("panic", "pan1")] }),
        makePlayer(1, "outlaw", { equipment: { ...emptyEquipment(), barrel: card("barrel", "bar1") } }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, {
      type: "play-panic",
      cardId: "pan1",
      targetSeat: 1,
      from: "equip",
      equipCardId: "bar1",
    });
    expect(next.players[1].equipment.barrel).toBeNull();
    expect(next.players[0].hand.some((c) => c.id === "bar1")).toBe(true);
  });

  it("Cat Balou discards from any distance without giving the card to the attacker", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("cat-balou", "cb1")] }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw", { hand: [card("bang", "victim-card")] }),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-cat-balou", cardId: "cb1", targetSeat: 2, from: "hand", seed: 1 });
    expect(next.players[2].hand.length).toBe(0);
    expect(next.players[0].hand.some((c) => c.id === "victim-card")).toBe(false);
    expect(next.discard.some((c) => c.id === "victim-card")).toBe(true);
  });

  it("Jail cannot target the sheriff", () => {
    const state = makeState({
      turnSeat: 1,
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { hand: [card("jail", "j1")] }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-jail", cardId: "j1", targetSeat: 0 });
    expect(next).toEqual(state);
  });
});

describe("Bang! and group responses", () => {
  it("play-bang opens a pending group response for the target only", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("bang", "bg1")] }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-bang", cardId: "bg1", targetSeat: 1 });
    expect(next.turnPhase).toBe("pending");
    const pending = next.pending as PendingGroupResponse;
    expect(pending.kind).toBe("group");
    expect(pending.outstanding).toEqual([1]);
    expect(pending.requiredCard).toBe("missed");
  });

  it("out-of-range Bang! is rejected", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("bang", "bg1")] }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "play-bang", cardId: "bg1", targetSeat: 2 });
    expect(next).toEqual(state);
  });

  it("caps at 1 Bang! per turn unless Volcanic is equipped", () => {
    const state = makeState({
      players: [
        makePlayer(0, "sheriff", { hand: [card("bang", "bg1"), card("bang", "bg2")], bangPlayedThisTurn: 1 }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const rejected = applyAction(state, { type: "play-bang", cardId: "bg2", targetSeat: 1 });
    expect(rejected).toEqual(state);

    const withVolcanic = makeState({
      players: [
        makePlayer(0, "sheriff", {
          hand: [card("bang", "bg1"), card("bang", "bg2")],
          bangPlayedThisTurn: 1,
          equipment: { ...emptyEquipment(), weapon: card("volcanic", "vol1") },
        }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const allowed = applyAction(withVolcanic, { type: "play-bang", cardId: "bg2", targetSeat: 1 });
    expect(allowed.turnPhase).toBe("pending");
  });

  it("take-hit resolves the pending response and resumes the active player's action phase", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 4 }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "take-hit" });
    expect(next.players[1].life).toBe(3);
    expect(next.pending).toBeNull();
    expect(next.turnPhase).toBe("action");
  });

  it("defending with a Missed! prevents damage", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 4, hand: [card("missed", "ms1")] }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "card", cardId: "ms1" });
    expect(next.players[1].life).toBe(4);
    expect(next.players[1].hand.length).toBe(0);
    expect(next.pending).toBeNull();
  });

  it("Barrel defends on a Heart draw and fails otherwise", () => {
    const withBarrel = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 4, equipment: { ...emptyEquipment(), barrel: card("barrel", "bar1") } }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "heart-draw", "H", 9)],
    });
    const defended = applyAction(withBarrel, { type: "group-respond", seat: 1, mode: "barrel", seed: 1 });
    expect(defended.players[1].life).toBe(4);

    const failing = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 4, equipment: { ...emptyEquipment(), barrel: card("barrel", "bar1") } }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "spade-draw", "S", 9)],
    });
    const failed = applyAction(failing, { type: "group-respond", seat: 1, mode: "barrel", seed: 1 });
    expect(failed.players[1].life).toBe(3);
  });

  it("Barrel is not allowed against Indians!", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "indians", source: 0, requiredCard: "bang", barrelAllowed: false, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 4, equipment: { ...emptyEquipment(), barrel: card("barrel", "bar1") } }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "barrel", seed: 1 });
    expect(next).toEqual(state); // rejected no-op
  });

  it("group responses resolve correctly regardless of arrival order (Indians!)", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "indians", source: 0, requiredCard: "bang", barrelAllowed: false, outstanding: [1, 2, 3] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 4, hand: [card("bang", "b1")] }),
        makePlayer(2, "outlaw", { life: 4 }),
        makePlayer(3, "renegade", { life: 4 }),
      ],
    });
    let s = applyAction(state, { type: "group-respond", seat: 3, mode: "take-hit" });
    expect((s.pending as PendingGroupResponse).outstanding).toEqual([1, 2]);
    s = applyAction(s, { type: "group-respond", seat: 1, mode: "card", cardId: "b1" });
    expect((s.pending as PendingGroupResponse).outstanding).toEqual([2]);
    s = applyAction(s, { type: "group-respond", seat: 2, mode: "take-hit" });
    expect(s.pending).toBeNull();
    expect(s.turnPhase).toBe("action");
    expect(s.players[1].life).toBe(4); // defended
    expect(s.players[2].life).toBe(3);
    expect(s.players[3].life).toBe(3);
  });
});

describe("Duel", () => {
  it("alternates and the loser takes damage attributed to the winner", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "duel", attacker: 0, defender: 1, turnToRespond: 1 },
      players: [
        makePlayer(0, "sheriff", { life: 5 }),
        makePlayer(1, "outlaw", { life: 4, hand: [] }), // no Bang! left, must concede immediately
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "duel-respond", seat: 1, cardId: null });
    expect(next.players[1].life).toBe(3);
    expect(next.turnPhase).toBe("action"); // attacker (turnSeat 0) still active, resumed
  });

  it("passes the response turn back and forth on Bang! plays", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "duel", attacker: 0, defender: 1, turnToRespond: 1 },
      players: [
        makePlayer(0, "sheriff", { hand: [card("bang", "a-bang")] }),
        makePlayer(1, "outlaw", { hand: [card("bang", "d-bang")] }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    let s = applyAction(state, { type: "duel-respond", seat: 1, cardId: "d-bang" });
    expect((s.pending as PendingDuel).turnToRespond).toBe(0);
    s = applyAction(s, { type: "duel-respond", seat: 0, cardId: null }); // attacker concedes, no more Bang!
    expect(s.players[0].life).toBe(4);
    expect(s.pending).toBeNull();
  });
});

describe("General Store", () => {
  it("lets each living player pick exactly one, starting with the player who played it", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: {
        kind: "general-store",
        revealed: [card("bang", "g1"), card("bang", "g2"), card("beer", "g3"), card("beer", "g4")],
        pickOrder: [0, 1, 2, 3],
        nextPickIndex: 0,
      },
    });
    // out-of-order pick is rejected
    const rejected = applyAction(state, { type: "general-store-pick", seat: 1, cardId: "g2" });
    expect(rejected).toEqual(state);

    let s = applyAction(state, { type: "general-store-pick", seat: 0, cardId: "g2" });
    expect(s.players[0].hand.some((c) => c.id === "g2")).toBe(true);
    expect((s.pending as PendingGeneralStore).revealed.length).toBe(3);
    s = applyAction(s, { type: "general-store-pick", seat: 1, cardId: "g1" });
    s = applyAction(s, { type: "general-store-pick", seat: 2, cardId: "g3" });
    s = applyAction(s, { type: "general-store-pick", seat: 3, cardId: "g4" });
    expect(s.pending).toBeNull();
    expect(s.turnPhase).toBe("action");
  });
});

describe("elimination pipeline", () => {
  it("rewards the killer with 3 cards for eliminating an Outlaw", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff", { hand: [] }),
        makePlayer(1, "outlaw", { life: 1 }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
      deck: [card("bang", "r1"), card("bang", "r2"), card("bang", "r3")],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "take-hit" });
    expect(next.players[1].alive).toBe(false);
    expect(next.players[1].roleRevealed).toBe(true);
    expect(next.players[0].hand.length).toBe(3); // reward
  });

  it("forces the Sheriff to discard their whole hand for killing their own Deputy", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff", { hand: [card("bang", "h1"), card("beer", "h2")] }),
        makePlayer(1, "deputy", { life: 1 }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "take-hit" });
    expect(next.players[0].hand.length).toBe(0);
    expect(next.discard.some((c) => c.id === "h1")).toBe(true);
  });

  it("also discards the Sheriff's equipment (not just hand) for killing their own Deputy, per rule 7", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff", {
          hand: [card("bang", "h1")],
          equipment: { ...emptyEquipment(), weapon: card("winchester", "w1"), scope: card("scope", "sc1") },
        }),
        makePlayer(1, "deputy", { life: 1 }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "take-hit" });
    expect(next.players[0].hand.length).toBe(0);
    expect(next.players[0].equipment.weapon).toBeNull();
    expect(next.players[0].equipment.scope).toBeNull();
    expect(next.discard.some((c) => c.id === "w1")).toBe(true);
    expect(next.discard.some((c) => c.id === "sc1")).toBe(true);
  });

  it("an emergency Beer in hand saves a player from elimination, bringing them to 1 life instead", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 1, hand: [card("beer", "emergency-beer")] }),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "take-hit" });
    expect(next.players[1].alive).toBe(true);
    expect(next.players[1].life).toBe(1);
    expect(next.players[1].hand.length).toBe(0);
    expect(next.discard.some((c) => c.id === "emergency-beer")).toBe(true);
    expect(next.winner).toBeNull();
  });

  it("an emergency Beer does NOT save a player when only 2 players remain alive", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [1] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { life: 1, hand: [card("beer", "emergency-beer")] }),
        makePlayer(2, "outlaw", { alive: false, roleRevealed: true }),
        makePlayer(3, "renegade", { alive: false, roleRevealed: true }),
      ],
      // Enough deck depth that the Outlaw-kill 3-card reward draw doesn't need
      // to reshuffle the discard pile (which would otherwise pull the just-
      // discarded emergency Beer back out of discard, muddying the assertion).
      deck: [card("bang", "r1"), card("bang", "r2"), card("bang", "r3")],
    });
    const next = applyAction(state, { type: "group-respond", seat: 1, mode: "take-hit" });
    expect(next.players[1].alive).toBe(false);
    expect(next.players[1].hand.length).toBe(0); // discarded on elimination, not consumed as a save
    expect(next.discard.some((c) => c.id === "emergency-beer")).toBe(true);
  });
});

describe("win-condition priority", () => {
  it("Outlaws win once the Sheriff is dead", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 1, requiredCard: "missed", barrelAllowed: true, outstanding: [0] },
      players: [
        makePlayer(0, "sheriff", { life: 1 }),
        makePlayer(1, "outlaw"),
        makePlayer(2, "outlaw"),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 0, mode: "take-hit" });
    expect(next.winner).toBe("outlaw");
    expect(next.turnPhase).toBe("game-end");
  });

  it("Law wins once every Outlaw and the Renegade are dead", () => {
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 0, requiredCard: "missed", barrelAllowed: true, outstanding: [3] },
      players: [
        makePlayer(0, "sheriff"),
        makePlayer(1, "outlaw", { alive: false, roleRevealed: true }),
        makePlayer(2, "outlaw", { alive: false, roleRevealed: true }),
        makePlayer(3, "renegade", { life: 1 }),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 3, mode: "take-hit" });
    expect(next.winner).toBe("law");
  });

  it("the Renegade wins alone as sole survivor, even though the Sheriff died earlier and Outlaws are already dead", () => {
    // Sheriff already dead (would have flagged an outlaw win at the time, but the game continued
    // because a proper reducer sequence checks winner after every single elimination — here we
    // simulate the *final* elimination in a state where sheriff is already dead and only the
    // renegade + one outlaw remain, then the last outlaw dies too.
    const state = makeState({
      turnPhase: "pending",
      pending: { kind: "group", cause: "bang", source: 3, requiredCard: "missed", barrelAllowed: true, outstanding: [2] },
      players: [
        makePlayer(0, "sheriff", { alive: false, roleRevealed: true }),
        makePlayer(1, "outlaw", { alive: false, roleRevealed: true }),
        makePlayer(2, "outlaw", { life: 1 }),
        makePlayer(3, "renegade"),
      ],
    });
    const next = applyAction(state, { type: "group-respond", seat: 2, mode: "take-hit" });
    expect(next.winner).toBe("renegade");
  });
});

describe("deterministic reshuffle", () => {
  it("reshuffles the discard pile into the deck when it runs dry mid-draw", () => {
    const state = makeState({
      players: [makePlayer(0, "sheriff", { hand: [card("stagecoach", "sc1")] }), makePlayer(1, "outlaw"), makePlayer(2, "outlaw"), makePlayer(3, "renegade")],
      deck: [card("bang", "only-one")],
      discard: [card("bang", "d1"), card("bang", "d2"), card("bang", "d3")],
    });
    const next = applyAction(state, { type: "play-stagecoach", cardId: "sc1", seed: 7 });
    // 1 (deck) + 3 (discard) + 1 (the just-played Stagecoach card itself, which
    // joins the discard pool before drawing, exactly like the physical game) = 5 total; draw 2.
    expect(next.players[0].hand.length).toBe(2);
    expect(next.deck.length + next.discard.length).toBe(3);
  });

  it("degrades gracefully (delivers fewer cards) instead of crashing once every card is exhausted", () => {
    const state = makeState({
      players: [makePlayer(0, "sheriff", { hand: [card("wells-fargo", "wf1")] }), makePlayer(1, "outlaw"), makePlayer(2, "outlaw"), makePlayer(3, "renegade")],
      deck: [],
      discard: [],
    });
    // Only 1 card exists anywhere (the just-played Wells Fargo card itself,
    // which becomes discard-pile fodder before the draw-3 resolves) — so the
    // request for 3 cards is satisfied by exactly that 1, not by crashing.
    const next = applyAction(state, { type: "play-wells-fargo", cardId: "wf1", seed: 7 });
    expect(next.players[0].hand.length).toBe(1);
    expect(next.deck.length + next.discard.length).toBe(0);
  });
});
