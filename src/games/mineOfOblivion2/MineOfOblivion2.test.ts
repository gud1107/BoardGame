import { describe, expect, it } from "vitest";
import {
  ALL_TILES,
  applyAction,
  blastZone,
  canManuallyDetonate,
  canPlaceHazard,
  chooseBotAction,
  chooseBotSetup,
  eightDirectionNeighbors,
  getValidMoves,
  isEightDirectionAdjacent,
  isSafeZoneTile,
  MINES_PER_PLAYER,
  ownArmedTimeBombs,
  publiclyExplodedBombTiles,
  START_TILE,
  startGame,
  TIME_BOMBS_PER_PLAYER,
  TIME_BOMB_BLAST_PENALTY,
  TIME_BOMB_FUSE_OPTIONS,
  TIME_BOMB_MANUAL_TRIGGER_DELAY,
  TIME_BOMB_SAFE_BONUS,
  TREASURE_TILES,
  type MineOfOblivion2State,
  type TimeBomb,
} from "./engine";

/** A fully-specified base state for unit-testing individual actions in isolation, independent of `startGame`'s coin flip. */
function baseState(overrides: Partial<MineOfOblivion2State> = {}): MineOfOblivion2State {
  return {
    phase: "PLAYER_MOVE",
    mines: { p1: [], p2: [] },
    disarmed: { p1: [], p2: [] },
    timeBombs: [],
    mineReady: { p1: true, p2: true },
    visitedTiles: [],
    revealedCounts: {},
    treasures: TREASURE_TILES.map((tileId) => ({ tileId, holder: null, order: null, points: null })),
    treasureClaimCount: 0,
    players: {
      p1: { position: START_TILE.p1, score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      p2: { position: START_TILE.p2, score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
    },
    activeSeat: "p1",
    actionsPlayed: 0,
    lastEvent: null,
    lastBombEvents: [],
    pendingGameOver: false,
    winner: null,
    isDraw: false,
    ...overrides,
  };
}

function bomb(overrides: Partial<TimeBomb>): TimeBomb {
  return { id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 3, remaining: 3, status: "armed", manuallyTriggered: false, ...overrides };
}

describe("board geometry (11×11, identical to 1편)", () => {
  it("has exactly 121 tiles", () => {
    expect(ALL_TILES.length).toBe(121);
  });

  it("8-direction adjacency includes diagonals but never the tile itself or 2-away tiles", () => {
    expect(isEightDirectionAdjacent("B2", "B3")).toBe(true);
    expect(isEightDirectionAdjacent("B2", "C3")).toBe(true);
    expect(isEightDirectionAdjacent("B2", "B2")).toBe(false);
    expect(isEightDirectionAdjacent("B2", "D2")).toBe(false);
  });

  it("eightDirectionNeighbors respects board edges (corner has exactly 3, edge has 5, interior has 8)", () => {
    expect(eightDirectionNeighbors("A1").sort()).toEqual(["A2", "B1", "B2"]);
    expect(eightDirectionNeighbors("A5").length).toBe(5);
    expect(eightDirectionNeighbors("F6").length).toBe(8);
  });
});

describe("blastZone (3×3 time-bomb detonation footprint)", () => {
  it("is 9 tiles (self + 8 neighbors) for an interior tile", () => {
    expect(blastZone("F6").length).toBe(9);
    expect(new Set(blastZone("F6")).has("F6")).toBe(true);
  });

  it("clips at the board edge — corner is 4 tiles, edge is 6 tiles", () => {
    expect(blastZone("A1").length).toBe(4); // A1 + A2,B1,B2
    expect(blastZone("A5").length).toBe(6); // edge column, not corner
  });
});

describe("canPlaceHazard — shared legality for both mines and time bombs", () => {
  it("forbids all 3 treasure tiles and both start tiles for either seat", () => {
    for (const t of [...TREASURE_TILES, START_TILE.p1, START_TILE.p2]) {
      expect(canPlaceHazard("p1", t)).toBe(false);
      expect(canPlaceHazard("p2", t)).toBe(false);
    }
  });

  it("allows an ordinary interior tile", () => {
    expect(canPlaceHazard("p1", "F5")).toBe(true);
  });
});

describe("SET_SETUP validation", () => {
  function candidateMines(exclude: string[] = []): string[] {
    return ALL_TILES.filter((t) => canPlaceHazard("p1", t) && !exclude.includes(t)).slice(0, MINES_PER_PLAYER);
  }

  it("rejects wrong mine or bomb counts", () => {
    const state = startGame(() => 0.1); // deterministic firstSeat
    const mines = candidateMines();
    const bombsShort = candidateMines(mines).slice(0, TIME_BOMBS_PER_PLAYER - 1).map((tile) => ({ tile, fuseTurns: 3 as const }));
    const next = applyAction(state, { type: "SET_SETUP", seat: "p1", mines, bombs: bombsShort });
    expect(next.mineReady.p1).toBe(false); // no-op, still not ready
  });

  it("rejects a submission where a bomb tile collides with one of the same seat's own mine tiles", () => {
    const state = startGame(() => 0.1);
    const mines = candidateMines();
    const bombs = [mines[0], ...candidateMines(mines).slice(0, TIME_BOMBS_PER_PLAYER - 1)].map((tile) => ({ tile, fuseTurns: 3 as const }));
    const next = applyAction(state, { type: "SET_SETUP", seat: "p1", mines, bombs });
    expect(next.mineReady.p1).toBe(false);
  });

  it("rejects an invalid fuse length", () => {
    const state = startGame(() => 0.1);
    const mines = candidateMines();
    const bombTiles = candidateMines(mines).slice(0, TIME_BOMBS_PER_PLAYER);
    // `fuseTurns: 7` is outside TIME_BOMB_FUSE_OPTIONS — deliberately smuggled past the type system (this is exactly the runtime input the reducer must itself reject) via an `unknown` cast rather than `@ts-expect-error`, since the type error actually surfaces at the `applyAction` call site, not this literal.
    const bombs = bombTiles.map((tile) => ({ tile, fuseTurns: 7 })) as unknown as { tile: string; fuseTurns: 3 | 4 | 5 }[];
    const next = applyAction(state, { type: "SET_SETUP", seat: "p1", mines, bombs });
    expect(next.mineReady.p1).toBe(false);
  });

  it("accepts a valid submission, creates armed TimeBomb entries, and starts the match once both seats are ready", () => {
    const state = startGame(() => 0.1);
    const mines1 = candidateMines();
    const bombs1 = candidateMines(mines1)
      .slice(0, TIME_BOMBS_PER_PLAYER)
      .map((tile, i) => ({ tile, fuseTurns: TIME_BOMB_FUSE_OPTIONS[i % TIME_BOMB_FUSE_OPTIONS.length] }));
    const afterP1 = applyAction(state, { type: "SET_SETUP", seat: "p1", mines: mines1, bombs: bombs1 });
    expect(afterP1.mineReady.p1).toBe(true);
    expect(afterP1.phase).toBe("SETUP_MINE"); // p2 not ready yet
    expect(ownArmedTimeBombs(afterP1, "p1").length).toBe(TIME_BOMBS_PER_PLAYER);
    expect(ownArmedTimeBombs(afterP1, "p1").every((b) => b.remaining === b.fuseTurns)).toBe(true);

    const mines2 = candidateMines();
    const bombs2 = candidateMines(mines2)
      .slice(0, TIME_BOMBS_PER_PLAYER)
      .map((tile) => ({ tile, fuseTurns: 4 as const }));
    const started = applyAction(afterP1, { type: "SET_SETUP", seat: "p2", mines: mines2, bombs: bombs2 });
    expect(started.mineReady.p2).toBe(true);
    expect(started.phase).toBe("PLAYER_MOVE");
  });
});

describe("stepping onto a live (not-yet-detonated) time bomb tile — confirmed harmless", () => {
  it("resolves as a completely ordinary reveal, no special event, no early detonation", () => {
    const state = baseState({
      players: {
        p1: { position: "A1", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "K11", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p2-tb-0", seat: "p2", tile: "B2", fuseTurns: 5, remaining: 5 })],
    });
    const next = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p1", tile: "B2" });
    expect(next.lastEvent?.kind).toBe("reveal");
    expect(next.lastBombEvents).toEqual([]);
    const stillArmed = next.timeBombs.find((b) => b.id === "p2-tb-0")!;
    expect(stillArmed.status).toBe("armed");
    expect(stillArmed.remaining).toBe(4); // ticked down by this move, but did NOT detonate or get disarmed by being stepped on
  });
});

describe("global-turn countdown — ticks on ANY seat's move, not just the owner's", () => {
  it("an opponent's move decrements the bomb owner's fuse too", () => {
    const state = baseState({
      activeSeat: "p2",
      players: {
        p1: { position: "A2", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "K11", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 5, remaining: 5 })],
    });
    const next = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p2", tile: "K10" });
    expect(next.timeBombs[0].remaining).toBe(4);
  });
});

describe("time-bomb detonation — 3×3 blast", () => {
  it("applies -5 and forces a respawn to anyone in the zone, including the bomb's own owner", () => {
    // p1 sits still inside its own bomb's blast zone (E5 ∈ blastZone(F5)); p2's move is what ticks the fuse to 0.
    const state = baseState({
      activeSeat: "p2",
      players: {
        p1: { position: "E5", score: 10, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "K11", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 3, remaining: 1 })],
    });
    const detonated = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p2", tile: "K10" });
    expect(detonated.lastBombEvents.length).toBe(1);
    const ev = detonated.lastBombEvents[0];
    expect(ev.hitSeats).toEqual(["p1"]);
    expect(ev.ownerBonus).toBe(0);
    expect(detonated.players.p1.score).toBe(10 - TIME_BOMB_BLAST_PENALTY);
    expect(detonated.players.p1.bombHitsTaken).toBe(1);
    expect(detonated.players.p1.position).not.toBe("E5"); // forced respawn
    expect(detonated.timeBombs[0].status).toBe("exploded");
    expect(detonated.phase).toBe("REVEAL_STEP"); // dramatic pause, even though p2's own arrival was a plain reveal
  });

  it("awards the owner +2 when the blast zone is empty at detonation", () => {
    const state = baseState({
      activeSeat: "p2",
      players: {
        p1: { position: "A1", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "K11", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 3, remaining: 1 })],
    });
    const detonated = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p2", tile: "K10" });
    const ev = detonated.lastBombEvents[0];
    expect(ev.hitSeats).toEqual([]);
    expect(ev.ownerBonus).toBe(TIME_BOMB_SAFE_BONUS);
    expect(detonated.players.p1.score).toBe(TIME_BOMB_SAFE_BONUS);
    expect(detonated.players.p1.bombsSafelyDetonated).toBe(1);
  });

  it("catches BOTH seats with a flat -5 each if both stand in the 3×3 zone", () => {
    const state = baseState({
      activeSeat: "p2",
      players: {
        p1: { position: "E5", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "G6", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 3, remaining: 1 })],
    });
    // p2 must move to trigger the tick — moving G6 -> G5 keeps p2 inside blastZone(F5) the whole time.
    // (F6 is deliberately avoided here even though it's also in the zone — it's one of the fixed TREASURE_TILES, which would claim a treasure and confound the score assertions below.)
    expect(blastZone("F5")).toContain("G6");
    expect(blastZone("F5")).toContain("G5");
    const detonated = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p2", tile: "G5" });
    const ev = detonated.lastBombEvents[0];
    expect(new Set(ev.hitSeats)).toEqual(new Set(["p1", "p2"]));
    expect(detonated.players.p1.score).toBe(-TIME_BOMB_BLAST_PENALTY);
    expect(detonated.players.p2.score).toBe(-TIME_BOMB_BLAST_PENALTY);
  });

  it("does not contribute to the public adjacent-mine-count clue while still armed", () => {
    const state = baseState({
      timeBombs: [bomb({ id: "p2-tb-0", seat: "p2", tile: "B2", fuseTurns: 5, remaining: 5 })],
    });
    // A1's only neighbors are A2,B1,B2 — B2 holds a live time bomb but zero regular mines, so the reveal score must be 0.
    const next = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(next.lastEvent?.scoreGained).toBe(0);
  });

  it("publiclyExplodedBombTiles reports a tile only after its bomb has detonated", () => {
    const state = baseState({
      activeSeat: "p2",
      players: {
        p1: { position: "A1", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "K11", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 3, remaining: 1 })],
    });
    expect(publiclyExplodedBombTiles(state)).toEqual([]);
    const detonated = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p2", tile: "K10" });
    expect(publiclyExplodedBombTiles(detonated)).toEqual(["F5"]);
  });
});

describe("DETONATE_BOMB — 원격 즉시 격발 (2026-09-07)", () => {
  it("canManuallyDetonate is true only while armed and above the manual-trigger delay", () => {
    expect(canManuallyDetonate(bomb({ remaining: 5 }))).toBe(true);
    expect(canManuallyDetonate(bomb({ remaining: TIME_BOMB_MANUAL_TRIGGER_DELAY }))).toBe(false);
    expect(canManuallyDetonate(bomb({ remaining: 1 }))).toBe(false);
    expect(canManuallyDetonate(bomb({ remaining: 5, status: "exploded" }))).toBe(false);
  });

  it("clamps remaining down to TIME_BOMB_MANUAL_TRIGGER_DELAY and flags manuallyTriggered, as a free action (no phase/turn/actionsPlayed change)", () => {
    const state = baseState({
      activeSeat: "p1",
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 5, remaining: 5 })],
    });
    const next = applyAction(state, { type: "DETONATE_BOMB", seat: "p1", bombId: "p1-tb-0" });
    expect(next.timeBombs[0].remaining).toBe(TIME_BOMB_MANUAL_TRIGGER_DELAY);
    expect(next.timeBombs[0].manuallyTriggered).toBe(true);
    expect(next.phase).toBe("PLAYER_MOVE");
    expect(next.activeSeat).toBe("p1");
    expect(next.actionsPlayed).toBe(0);
  });

  it("rejects detonating on the opponent's turn", () => {
    const state = baseState({
      activeSeat: "p2",
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 5, remaining: 5 })],
    });
    const next = applyAction(state, { type: "DETONATE_BOMB", seat: "p1", bombId: "p1-tb-0" });
    expect(next.timeBombs[0].remaining).toBe(5); // unchanged, no-op
  });

  it("rejects detonating a bomb owned by the other seat", () => {
    const state = baseState({
      activeSeat: "p1",
      timeBombs: [bomb({ id: "p2-tb-0", seat: "p2", tile: "F5", fuseTurns: 5, remaining: 5 })],
    });
    const next = applyAction(state, { type: "DETONATE_BOMB", seat: "p1", bombId: "p2-tb-0" });
    expect(next.timeBombs[0].remaining).toBe(5);
  });

  it("is a no-op once the bomb is already at or below the manual-trigger delay (nothing left to shorten)", () => {
    const state = baseState({
      activeSeat: "p1",
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 5, remaining: TIME_BOMB_MANUAL_TRIGGER_DELAY })],
    });
    const next = applyAction(state, { type: "DETONATE_BOMB", seat: "p1", bombId: "p1-tb-0" });
    expect(next.timeBombs[0].remaining).toBe(TIME_BOMB_MANUAL_TRIGGER_DELAY);
    expect(next.timeBombs[0].manuallyTriggered).toBe(false);
  });

  it("is a no-op on an already-exploded bomb", () => {
    const state = baseState({
      activeSeat: "p1",
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", status: "exploded", remaining: 0 })],
    });
    const next = applyAction(state, { type: "DETONATE_BOMB", seat: "p1", bombId: "p1-tb-0" });
    expect(next.timeBombs[0].manuallyTriggered).toBe(false);
  });

  it("end-to-end: a manual trigger still detonates exactly TIME_BOMB_MANUAL_TRIGGER_DELAY moves later through the normal tickTimeBombs path", () => {
    let state = baseState({
      activeSeat: "p1",
      players: {
        p1: { position: "A1", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
        p2: { position: "G6", score: 0, treasuresClaimed: 0, mineHitsTaken: 0, bombHitsTaken: 0, bombsSafelyDetonated: 0 },
      },
      timeBombs: [bomb({ id: "p1-tb-0", seat: "p1", tile: "F5", fuseTurns: 5, remaining: 5 })],
    });
    // p1 presses "즉시 격발" on their own turn instead of a fuse naturally reaching 0.
    state = applyAction(state, { type: "DETONATE_BOMB", seat: "p1", bombId: "p1-tb-0" });
    expect(state.timeBombs[0].remaining).toBe(2);

    // It's still a free action — p1 still has to move to end the turn. A1->A2 is a
    // plain, never-visited, zero-adjacent-mine reveal, so the turn auto-passes to p2
    // immediately (no REVEAL_STEP gate — see `finalizeAction`).
    state = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p1", tile: "A2" });
    expect(state.timeBombs[0].remaining).toBe(1);
    expect(state.lastBombEvents.length).toBe(0);
    expect(state.phase).toBe("PLAYER_MOVE");
    expect(state.activeSeat).toBe("p2");

    const detonated = applyAction(state, { type: "SELECT_TILE_STEP", seat: "p2", tile: "G5" });
    expect(detonated.timeBombs[0].status).toBe("exploded");
    expect(detonated.lastBombEvents.length).toBe(1);
    expect(detonated.lastBombEvents[0].hitSeats).toEqual(["p2"]); // p2 walked into F5's blast zone
  });
});

describe("bot support — chooseBotSetup / chooseBotAction never crash and respect info fairness", () => {
  it("produces a legal disjoint mine+bomb tile set for a fresh game", () => {
    const { mines, bombs } = chooseBotSetup("p1", 5, () => 0.42);
    expect(mines.length).toBe(MINES_PER_PLAYER);
    expect(bombs.length).toBe(TIME_BOMBS_PER_PLAYER);
    const allTiles = [...mines, ...bombs.map((b) => b.tile)];
    expect(new Set(allTiles).size).toBe(allTiles.length);
    expect(bombs.every((b) => TIME_BOMB_FUSE_OPTIONS.includes(b.fuseTurns))).toBe(true);
  });

  it("chooseBotAction drives both bot seats through the whole SETUP_MINE phase without crashing", () => {
    let state = startGame(() => 0.3);
    for (let i = 0; i < 2 && state.phase === "SETUP_MINE"; i++) {
      const p1Action = chooseBotAction(state, "p1", 5, () => 0.2 + i * 0.01);
      if (p1Action) state = applyAction(state, p1Action);
      const p2Action = chooseBotAction(state, "p2", 5, () => 0.6 + i * 0.01);
      if (p2Action) state = applyAction(state, p2Action);
    }
    // Setup is a one-shot simultaneous submission per seat (no REVEAL_STEP involved), so once both are ready the engine always lands on PLAYER_MOVE — unlike a real move, which can land on REVEAL_STEP (mine/treasure/bomb).
    expect(state.phase).toBe("PLAYER_MOVE");
    expect(state.mineReady).toEqual({ p1: true, p2: true });
  });

  it("chooseBotAction can keep driving real moves afterward (advancing past any REVEAL_STEP) without ever crashing or stalling", () => {
    let state = startGame(() => 0.3);
    for (let i = 0; i < 40; i++) {
      if (state.phase === "REVEAL_STEP") {
        state = applyAction(state, { type: "READY_NEXT_ROUND" });
        continue;
      }
      if (state.phase === "GAME_OVER") break;
      const actor: "p1" | "p2" = state.phase === "SETUP_MINE" ? (state.mineReady.p1 ? "p2" : "p1") : state.activeSeat;
      const action = chooseBotAction(state, actor, 5, () => 0.3 + i * 0.003);
      if (!action) break;
      state = applyAction(state, action);
    }
    // The loop must have made real progress (setup finished AND at least a few real moves played), not stalled immediately.
    expect(state.mineReady).toEqual({ p1: true, p2: true });
    expect(state.actionsPlayed).toBeGreaterThan(0);
  });

  it("getValidMoves never offers the opponent's occupied tile", () => {
    const state = baseState();
    const moves = getValidMoves(state, "p1");
    expect(moves.every((m) => m.tile !== state.players.p2.position)).toBe(true);
  });
});

describe("safe zones (identical to 1편)", () => {
  it("only the two start tiles are safe zones", () => {
    expect(isSafeZoneTile(START_TILE.p1)).toBe(true);
    expect(isSafeZoneTile(START_TILE.p2)).toBe(true);
    expect(isSafeZoneTile("F6")).toBe(false);
  });
});
