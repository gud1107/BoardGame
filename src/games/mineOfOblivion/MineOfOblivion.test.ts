import { describe, expect, it } from "vitest";
import {
  ALL_TILES,
  applyAction,
  canPlaceMine,
  chooseBotAction,
  chooseBotMinePlacement,
  getValidMoves,
  isOrthogonallyAdjacent,
  otherSeat,
  orthogonalNeighbors,
  publiclyDisarmedTiles,
  START_TILE,
  startGame,
  TREASURE_TILES,
  TURN_CAP,
  type MineOfOblivionState,
  type Seat,
} from "./engine";

/** A fully-specified base state for unit-testing individual actions in isolation, independent of `startGame`'s coin flip. */
function baseState(overrides: Partial<MineOfOblivionState> = {}): MineOfOblivionState {
  return {
    phase: "PLAYER_MOVE",
    mines: { p1: [], p2: [] },
    disarmed: { p1: [], p2: [] },
    mineReady: { p1: true, p2: true },
    treasures: TREASURE_TILES.map((tileId) => ({ tileId, holder: null })),
    players: {
      p1: { position: START_TILE.p1, treasureCount: 0, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] },
      p2: { position: START_TILE.p2, treasureCount: 0, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] },
    },
    activeSeat: "p1",
    actionsPlayed: 0,
    lastEvent: null,
    pendingGameOver: false,
    winner: null,
    isDraw: false,
    ...overrides,
  };
}

describe("board geometry", () => {
  it("has exactly 25 tiles", () => {
    expect(ALL_TILES.length).toBe(25);
  });

  it("orthogonal adjacency is correct (no diagonals)", () => {
    expect(isOrthogonallyAdjacent("A1", "A2")).toBe(true);
    expect(isOrthogonallyAdjacent("A1", "B1")).toBe(true);
    expect(isOrthogonallyAdjacent("A1", "B2")).toBe(false); // diagonal
    expect(isOrthogonallyAdjacent("A1", "A1")).toBe(false); // same tile
    expect(isOrthogonallyAdjacent("A1", "C1")).toBe(false); // 2 apart
  });

  it("orthogonalNeighbors respects board edges (corner has exactly 2)", () => {
    expect(orthogonalNeighbors("A1").sort()).toEqual(["A2", "B1"]);
    expect(orthogonalNeighbors("C3").sort()).toEqual(["B3", "C2", "C4", "D3"]);
  });
});

describe("canPlaceMine (rulebook §1 constraints)", () => {
  it("forbids all 3 treasure tiles for either seat", () => {
    for (const t of TREASURE_TILES) {
      expect(canPlaceMine("p1", t)).toBe(false);
      expect(canPlaceMine("p2", t)).toBe(false);
    }
  });

  it("forbids only the seat's OWN start tile — the opponent's start tile is legal", () => {
    expect(canPlaceMine("p1", START_TILE.p1)).toBe(false);
    expect(canPlaceMine("p1", START_TILE.p2)).toBe(true);
    expect(canPlaceMine("p2", START_TILE.p2)).toBe(false);
    expect(canPlaceMine("p2", START_TILE.p1)).toBe(true);
  });

  it("allows an ordinary empty tile", () => {
    expect(canPlaceMine("p1", "B2")).toBe(true);
  });
});

describe("SETUP_MINE → PLAYER_MOVE transition", () => {
  it("stays in SETUP_MINE until both seats submit exactly 4 legal, unique tiles", () => {
    const s0 = startGame(() => 0); // deterministic: p1 goes first
    expect(s0.phase).toBe("SETUP_MINE");

    const s1 = applyAction(s0, { type: "SET_MINE_POSITION", seat: "p1", tiles: ["B1", "B2", "B3", "B4"] });
    expect(s1.mineReady.p1).toBe(true);
    expect(s1.phase).toBe("SETUP_MINE"); // p2 not ready yet

    const s2 = applyAction(s1, { type: "SET_MINE_POSITION", seat: "p2", tiles: ["D1", "D2", "D3", "D4"] });
    expect(s2.mineReady.p2).toBe(true);
    expect(s2.phase).toBe("PLAYER_MOVE");
  });

  it("rejects a submission touching a treasure tile or the seat's own start", () => {
    const s0 = startGame(() => 0);
    const withTreasure = applyAction(s0, { type: "SET_MINE_POSITION", seat: "p1", tiles: ["C3", "B2", "B3", "B4"] });
    expect(withTreasure.mineReady.p1).toBe(false);

    const withOwnStart = applyAction(s0, { type: "SET_MINE_POSITION", seat: "p1", tiles: [START_TILE.p1, "B2", "B3", "B4"] });
    expect(withOwnStart.mineReady.p1).toBe(false);
  });

  it("rejects a wrong-count or duplicate-tile submission", () => {
    const s0 = startGame(() => 0);
    expect(applyAction(s0, { type: "SET_MINE_POSITION", seat: "p1", tiles: ["B1", "B2", "B3"] }).mineReady.p1).toBe(false);
    expect(applyAction(s0, { type: "SET_MINE_POSITION", seat: "p1", tiles: ["B1", "B1", "B2", "B3"] }).mineReady.p1).toBe(false);
  });

  it("ignores a resubmission once already ready", () => {
    const s0 = startGame(() => 0);
    const s1 = applyAction(s0, { type: "SET_MINE_POSITION", seat: "p1", tiles: ["B1", "B2", "B3", "B4"] });
    const s2 = applyAction(s1, { type: "SET_MINE_POSITION", seat: "p1", tiles: ["D1", "D2", "D3", "D4"] });
    expect(s2.mines.p1).toEqual(["B1", "B2", "B3", "B4"]);
  });
});

describe("movement + arrival judgment (rulebook §2-3)", () => {
  it("rejects a non-adjacent step and a step out of turn", () => {
    const s = baseState();
    expect(applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "C1" }).players.p1.position).toBe("A1");
    expect(applyAction(s, { type: "SELECT_TILE_STEP", seat: "p2", tile: "E4" }).players.p2.position).toBe("E5"); // not p2's turn
  });

  it("safe tile: no side effect beyond the move + REVEAL_STEP gate", () => {
    const s = baseState();
    const next = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(next.players.p1.position).toBe("A2");
    expect(next.phase).toBe("REVEAL_STEP");
    expect(next.lastEvent).toEqual({ kind: "safe", actor: "p1", tile: "A2" });
    expect(next.pendingGameOver).toBe(false);
  });

  it("treasure tile: awards a treasure and marks it held", () => {
    const s = baseState({ players: { ...baseState().players, p1: { ...baseState().players.p1, position: "A4" } } });
    const next = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A5" }); // A5 is a treasure tile
    expect(next.players.p1.treasureCount).toBe(1);
    expect(next.treasures.find((t) => t.tileId === "A5")?.holder).toBe("p1");
    expect(next.lastEvent?.kind).toBe("treasure");
  });

  it("a mine hit forces retreat to start, forfeits a held treasure, and permanently disarms that tile", () => {
    const s = baseState({
      mines: { p1: [], p2: ["A2"] },
      players: { ...baseState().players, p1: { position: "A2", treasureCount: 1, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] } },
      treasures: [
        { tileId: "C3", holder: "p1" },
        { tileId: "A5", holder: null },
        { tileId: "E1", holder: null },
      ],
    });
    // p1 steps onto A2 from A1 — wait, position is already A2 in this synthetic
    // state (simulating "just arrived"); exercise resolution via a fresh move
    // from an adjacent tile instead for a realistic action.
    const fromA1 = baseState({
      mines: { p1: [], p2: ["A2"] },
      players: { ...baseState().players, p1: { position: "A1", treasureCount: 1, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] } },
      treasures: [
        { tileId: "C3", holder: "p1" },
        { tileId: "A5", holder: null },
        { tileId: "E1", holder: null },
      ],
    });
    const next = applyAction(fromA1, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(next.players.p1.position).toBe(START_TILE.p1); // forced retreat
    expect(next.players.p1.treasureCount).toBe(0); // forfeited
    expect(next.players.p1.mineHitsTaken).toBe(1);
    expect(next.treasures.find((t) => t.tileId === "C3")?.holder).toBe(null); // returned to its home tile
    expect(next.disarmed.p2).toContain("A2");
    expect(publiclyDisarmedTiles(next)).toContain("A2");
    expect(next.lastEvent).toMatchObject({ kind: "mine", mineOwners: ["p2"], treasureForfeited: true });
    void s; // (unused synthetic fixture kept only to document the "already there" shape considered above)
  });

  it("a mine hit with no held treasure forfeits nothing", () => {
    const s = baseState({ mines: { p1: [], p2: ["A2"] } });
    const next = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(next.players.p1.treasureCount).toBe(0);
    expect(next.lastEvent).toMatchObject({ treasureForfeited: false });
  });

  it("an already-disarmed tile no longer explodes", () => {
    const s = baseState({ mines: { p1: [], p2: ["A2"] }, disarmed: { p1: [], p2: ["A2"] } });
    const next = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(next.lastEvent?.kind).toBe("safe");
    expect(next.players.p1.position).toBe("A2");
  });
});

describe("win condition A — treasure race", () => {
  it("declares the mover the winner the instant they reach 2 treasures", () => {
    const s = baseState({
      players: { ...baseState().players, p1: { position: "A4", treasureCount: 1, mineHitsTaken: 0, radarUsed: false, radarRevealed: [] } },
      treasures: [
        { tileId: "C3", holder: null },
        { tileId: "A5", holder: null },
        { tileId: "E1", holder: "p1" },
      ],
    });
    const next = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A5" });
    expect(next.phase).toBe("REVEAL_STEP");
    expect(next.pendingGameOver).toBe(true);
    expect(next.winner).toBe("p1");

    const final = applyAction(next, { type: "READY_NEXT_ROUND" });
    expect(final.phase).toBe("GAME_OVER");
    expect(final.winner).toBe("p1");
  });
});

describe("REVEAL_STEP → next turn / game over gate", () => {
  it("READY_NEXT_ROUND passes the turn when no game-over is pending", () => {
    const s = baseState();
    const moved = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(moved.phase).toBe("REVEAL_STEP");
    const advanced = applyAction(moved, { type: "READY_NEXT_ROUND" });
    expect(advanced.phase).toBe("PLAYER_MOVE");
    expect(advanced.activeSeat).toBe("p2");
  });

  it("is idempotent once already advanced (double-press safety)", () => {
    const s = baseState();
    const moved = applyAction(s, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    const once = applyAction(moved, { type: "READY_NEXT_ROUND" });
    const twice = applyAction(once, { type: "READY_NEXT_ROUND" });
    expect(twice).toEqual(once);
  });
});

describe("radar item (confirmed platform extension)", () => {
  it("reveals an armed mine on an adjacent tile without moving, and consumes the one-time charge", () => {
    const s = baseState({ mines: { p1: [], p2: ["A2"] } });
    const next = applyAction(s, { type: "USE_RADAR_ITEM", seat: "p1", tile: "A2" });
    expect(next.players.p1.position).toBe("A1"); // did not move
    expect(next.players.p1.radarUsed).toBe(true);
    expect(next.players.p1.radarRevealed).toEqual(["A2"]);
    expect(next.lastEvent).toEqual({ kind: "radar-mine", actor: "p1", tile: "A2" });
    expect(next.phase).toBe("REVEAL_STEP");
  });

  it("reports radar-safe for a tile with no armed mine", () => {
    const s = baseState();
    const next = applyAction(s, { type: "USE_RADAR_ITEM", seat: "p1", tile: "A2" });
    expect(next.lastEvent?.kind).toBe("radar-safe");
  });

  it("cannot be used twice by the same seat", () => {
    const s = baseState({ players: { ...baseState().players, p1: { position: "A1", treasureCount: 0, mineHitsTaken: 0, radarUsed: true, radarRevealed: ["B1"] } } });
    const next = applyAction(s, { type: "USE_RADAR_ITEM", seat: "p1", tile: "A2" });
    expect(next).toBe(s); // untouched — illegal action no-op
  });

  it("is excluded from getValidMoves once already used", () => {
    const s = baseState({ players: { ...baseState().players, p1: { position: "A1", treasureCount: 0, mineHitsTaken: 0, radarUsed: true, radarRevealed: [] } } });
    const moves = getValidMoves(s, "p1");
    expect(moves.every((m) => m.type !== "USE_RADAR_ITEM")).toBe(true);
  });
});

describe("TURN_CAP tiebreak (confirmed Win Condition B house rule)", () => {
  function playSafeShuffle(state: MineOfOblivionState, seat: Seat): MineOfOblivionState {
    // A1 <-> A2 (p1) / E5 <-> E4 (p2) — both loops stay clear of every tile
    // used by the surrounding tests' mine/treasure setups.
    const home = START_TILE[seat];
    const away = seat === "p1" ? "A2" : "E4";
    const target = state.players[seat].position === home ? away : home;
    const moved = applyAction(state, { type: "SELECT_TILE_STEP", seat, tile: target });
    return applyAction(moved, { type: "READY_NEXT_ROUND" });
  }

  it("resolves by treasure count, then mine-hit count, then draw, once actionsPlayed hits TURN_CAP", () => {
    let s = baseState({ players: { ...baseState().players, p1: { ...baseState().players.p1, treasureCount: 1 }, p2: { ...baseState().players.p2, treasureCount: 0 } } });
    for (let i = 0; i < TURN_CAP; i++) {
      s = playSafeShuffle(s, s.activeSeat);
    }
    expect(s.actionsPlayed).toBe(TURN_CAP);
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe("p1"); // ahead on treasures
  });

  it("falls through to a draw when everything is tied", () => {
    let s = baseState();
    for (let i = 0; i < TURN_CAP; i++) {
      s = playSafeShuffle(s, s.activeSeat);
    }
    expect(s.phase).toBe("GAME_OVER");
    expect(s.isDraw).toBe(true);
    expect(s.winner).toBe(null);
  });
});

describe("bot support", () => {
  it("chooseBotMinePlacement always returns 4 legal, unique tiles", () => {
    for (const seat of ["p1", "p2"] as const) {
      const tiles = chooseBotMinePlacement(seat, 5, () => 0.5);
      expect(tiles.length).toBe(4);
      expect(new Set(tiles).size).toBe(4);
      expect(tiles.every((t) => canPlaceMine(seat, t))).toBe(true);
    }
  });

  it("chooseBotAction drives SETUP_MINE for whichever seat hasn't submitted yet", () => {
    const s0 = startGame(() => 0);
    const action = chooseBotAction(s0, "p1", 5, () => 0.5);
    expect(action?.type).toBe("SET_MINE_POSITION");
  });

  it("chooseBotAction never knowingly walks the bot onto its own armed mine", () => {
    const s = baseState({ mines: { p1: ["A2"], p2: [] } });
    for (let i = 0; i < 20; i++) {
      const action = chooseBotAction(s, "p1", 10, () => Math.random());
      expect(action).not.toEqual({ type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    }
  });

  it("otherSeat is its own inverse", () => {
    expect(otherSeat(otherSeat("p1"))).toBe("p1");
  });
});
