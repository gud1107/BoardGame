import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  BOARD_SIZE,
  HOME_ZONES,
  HORSES_PER_PLAYER,
  HORSES_PER_ZONE,
  applyAction,
  chooseBotAction,
  getLegalMoves,
  getValidMoves,
  otherSeat,
  startGame,
  targetZoneCells,
  type EngineAction,
  type MalDalliJaState,
  type Position,
  type Seat,
} from "./engine";

function posKey(p: Position) {
  return `${p.row},${p.col}`;
}

describe("home zones (§1 세팅, 2026-08-11 redesign — 10 horses split across a diagonal)", () => {
  it("gives each seat two 5-cell corner zones (10 horses total per seat)", () => {
    expect(HORSES_PER_ZONE).toBe(5);
    expect(HORSES_PER_PLAYER).toBe(10);
    for (const seat of ["p1", "p2"] as const) {
      expect(HOME_ZONES[seat][0]).toHaveLength(5);
      expect(HOME_ZONES[seat][1]).toHaveLength(5);
    }
  });

  it("p1 owns both ends of the main diagonal, p2 both ends of the anti-diagonal", () => {
    expect(HOME_ZONES.p1[0]).toContainEqual({ row: 0, col: 0 });
    expect(HOME_ZONES.p1[1]).toContainEqual({ row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 });
    expect(HOME_ZONES.p2[0]).toContainEqual({ row: 0, col: BOARD_SIZE - 1 });
    expect(HOME_ZONES.p2[1]).toContainEqual({ row: BOARD_SIZE - 1, col: 0 });
  });

  it("all 4 corner zones (20 cells) are mutually disjoint", () => {
    const allCells = [...HOME_ZONES.p1[0], ...HOME_ZONES.p1[1], ...HOME_ZONES.p2[0], ...HOME_ZONES.p2[1]];
    const keys = allCells.map(posKey);
    expect(new Set(keys).size).toBe(20);
  });

  it("each corner zone is the L-shaped 5-cell pattern hugging its vertex, not the diagonal-adjacent cell", () => {
    // 2026-08-11 corner-shape fix regression test: the 5th cell must complete
    // the L along the perpendicular edge (e.g. (2,0)), never the diagonal
    // neighbor (e.g. (1,1)) — see engine.ts's cornerZone doc.
    const MAX = BOARD_SIZE - 1;
    const expectedByZone: [Position[], Position[]][] = [
      [
        // Top-Left
        [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 2, col: 0 }],
        // Bottom-Right
        [
          { row: MAX, col: MAX },
          { row: MAX, col: MAX - 1 },
          { row: MAX, col: MAX - 2 },
          { row: MAX - 1, col: MAX },
          { row: MAX - 2, col: MAX },
        ],
      ],
      [
        // Top-Right
        [
          { row: 0, col: MAX },
          { row: 0, col: MAX - 1 },
          { row: 0, col: MAX - 2 },
          { row: 1, col: MAX },
          { row: 2, col: MAX },
        ],
        // Bottom-Left
        [{ row: MAX, col: 0 }, { row: MAX - 1, col: 0 }, { row: MAX - 2, col: 0 }, { row: MAX, col: 1 }, { row: MAX, col: 2 }],
      ],
    ];
    const actualByZone: [Position[], Position[]][] = [HOME_ZONES.p1, HOME_ZONES.p2];

    for (let seatIdx = 0; seatIdx < 2; seatIdx++) {
      for (let zoneIdx = 0; zoneIdx < 2; zoneIdx++) {
        expect(actualByZone[seatIdx][zoneIdx].map(posKey).sort()).toEqual(
          expectedByZone[seatIdx][zoneIdx].map(posKey).sort(),
        );
      }
    }

    // The forbidden diagonal-adjacent cells must not appear anywhere.
    const forbidden = [
      { row: 1, col: 1 },
      { row: 1, col: MAX - 1 },
      { row: MAX - 1, col: 1 },
      { row: MAX - 1, col: MAX - 1 },
    ].map(posKey);
    const allCells = [...HOME_ZONES.p1[0], ...HOME_ZONES.p1[1], ...HOME_ZONES.p2[0], ...HOME_ZONES.p2[1]].map(posKey);
    for (const f of forbidden) {
      expect(allCells).not.toContain(f);
    }
  });

  it("targetZoneCells(seat) is exactly the opponent's flattened home zones", () => {
    expect(targetZoneCells("p1").map(posKey).sort()).toEqual(
      [...HOME_ZONES.p2[0], ...HOME_ZONES.p2[1]].map(posKey).sort(),
    );
    expect(targetZoneCells("p2").map(posKey).sort()).toEqual(
      [...HOME_ZONES.p1[0], ...HOME_ZONES.p1[1]].map(posKey).sort(),
    );
  });
});

describe("startGame (setup, §1)", () => {
  it("places each seat's 10 horses across its two home zones", () => {
    const state = startGame(seededRng(1));
    expect(state.positions.p1).toHaveLength(10);
    expect(state.positions.p2).toHaveLength(10);
    expect(state.positions.p1.map(posKey).sort()).toEqual(
      [...HOME_ZONES.p1[0], ...HOME_ZONES.p1[1]].map(posKey).sort(),
    );
    expect(state.positions.p2.map(posKey).sort()).toEqual(
      [...HOME_ZONES.p2[0], ...HOME_ZONES.p2[1]].map(posKey).sort(),
    );
  });

  it("is deterministic for a fixed seed (same seed -> same first mover)", () => {
    const a = startGame(seededRng(42));
    const b = startGame(seededRng(42));
    expect(a.activeSeat).toBe(b.activeSeat);
  });

  it("can produce either seat as first mover across different seeds", () => {
    const seats = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      seats.add(startGame(seededRng(seed)).activeSeat);
    }
    expect(seats.has("p1")).toBe(true);
    expect(seats.has("p2")).toBe(true);
  });

  it("starts phase playing, no winner, empty history", () => {
    const state = startGame(seededRng(1));
    expect(state.phase).toBe("playing");
    expect(state.winner).toBeNull();
    expect(state.moveHistory).toEqual([]);
    expect(state.turnNumber).toBe(1);
  });
});

function forceState(overrides: Partial<MalDalliJaState>): MalDalliJaState {
  const base = startGame(seededRng(1));
  return { ...base, activeSeat: "p1", ...overrides };
}

describe("slide movement (§3 이동 방식 1)", () => {
  it("slides all the way to the board edge when unobstructed", () => {
    const state = forceState({ positions: { p1: [{ row: 0, col: 0 }], p2: [{ row: 9, col: 9 }] } });
    const moves = getLegalMoves(state);
    const rightSlide = moves.find((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1);
    expect(rightSlide?.to).toEqual({ row: 0, col: 10 });
  });

  it("stops one cell short of the opponent's horse", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 0 }], p2: [{ row: 5, col: 4 }] } });
    const moves = getLegalMoves(state);
    const rightSlide = moves.find((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1);
    expect(rightSlide?.to).toEqual({ row: 5, col: 3 });
  });

  it("stops one cell short of the mover's own horse too (any occupied cell blocks)", () => {
    const state = forceState({
      positions: { p1: [{ row: 5, col: 0 }, { row: 5, col: 3 }], p2: [{ row: 9, col: 9 }] },
    });
    const moves = getLegalMoves(state).filter((m) => m.horseIndex === 0);
    const rightSlide = moves.find((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1);
    expect(rightSlide?.to).toEqual({ row: 5, col: 2 });
  });

  it("offers no slide in a direction where the opponent is adjacent (zero-distance slide is not a move)", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 5, col: 6 }] } });
    const moves = getLegalMoves(state);
    expect(moves.some((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1)).toBe(false);
  });

  it("applying a slide moves the piece, switches the active seat, and records history with the horse index", () => {
    const state = forceState({ positions: { p1: [{ row: 0, col: 0 }], p2: [{ row: 9, col: 9 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[0]).toEqual({ row: 0, col: 10 });
    expect(next.activeSeat).toBe("p2");
    expect(next.turnNumber).toBe(state.turnNumber + 1);
    expect(next.moveHistory).toEqual([
      { seat: "p1", horseIndex: 0, moveKind: "slide", from: { row: 0, col: 0 }, to: { row: 0, col: 10 } },
    ]);
  });

  it("an illegal slide (not among legal moves) is a no-op", () => {
    const state = forceState({ positions: { p1: [{ row: 0, col: 0 }], p2: [{ row: 9, col: 9 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 1, dc: 5 });
    expect(next).toEqual(state);
  });

  it("moving an out-of-range horseIndex is a no-op", () => {
    const state = forceState({ positions: { p1: [{ row: 0, col: 0 }], p2: [{ row: 9, col: 9 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 3, moveKind: "slide", dr: 0, dc: 1 });
    expect(next).toEqual(state);
  });
});

describe("knight movement (§3 이동 방식 2)", () => {
  it("lands on any of the 8 L-shaped offsets when empty", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 9, col: 9 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves).toHaveLength(8);
    expect(moves.map((m) => m.to)).toContainEqual({ row: 3, col: 4 });
  });

  it("can jump over an obstacle sitting between origin and landing square", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 4, col: 5 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).toContainEqual({ row: 3, col: 4 });
  });

  it("cannot land on a square occupied by the opponent", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 3, col: 4 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 3, col: 4 });
  });

  it("cannot land on a square occupied by the mover's own horse", () => {
    const state = forceState({
      positions: { p1: [{ row: 5, col: 5 }, { row: 3, col: 4 }], p2: [{ row: 9, col: 9 }] },
    });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight" && m.horseIndex === 0);
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 3, col: 4 });
  });

  it("excludes knight destinations off the board", () => {
    const state = forceState({ positions: { p1: [{ row: 0, col: 0 }], p2: [{ row: 9, col: 9 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    // Only 2 of the 8 offsets from a corner stay in-bounds on an 11x11 board.
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.to).sort((a, b) => a.row - b.row)).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
    ]);
  });
});

describe("opponent-zone win condition (§4, 2026-08-11 redesign)", () => {
  it("landing exactly inside the opponent's zone via a slide wins immediately", () => {
    // p1 slides right along row 0; p2's own horse at (0,9) blocks it exactly
    // one cell short — (0,8) itself already sits inside p2's zone.
    const state = forceState({ positions: { p1: [{ row: 0, col: 5 }], p2: [{ row: 0, col: 9 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[0]).toEqual({ row: 0, col: 8 });
    expect(targetZoneCells("p1")).toContainEqual({ row: 0, col: 8 });
    expect(next.phase).toBe("gameOver");
    expect(next.winner).toBe("p1");
  });

  it("stopping short of the opponent's zone (blocked before reaching it) does not win", () => {
    const state = forceState({ positions: { p1: [{ row: 0, col: 3 }], p2: [{ row: 0, col: 8 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[0]).toEqual({ row: 0, col: 7 });
    expect(targetZoneCells("p1")).not.toContainEqual({ row: 0, col: 7 });
    expect(next.phase).toBe("playing");
    expect(next.winner).toBeNull();
  });

  it("landing inside one's own home zone does not win", () => {
    const state = forceState({ positions: { p1: [{ row: 8, col: 8 }], p2: [{ row: 0, col: 0 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "knight", dr: 2, dc: 1 });
    expect(next.positions.p1[0]).toEqual({ row: 10, col: 9 }); // inside p1's own zone, not p2's
    expect(HOME_ZONES.p1[1]).toContainEqual({ row: 10, col: 9 });
    expect(next.phase).toBe("playing");
    expect(next.winner).toBeNull();
  });

  it("landing on the opponent zone via a knight move also wins", () => {
    const state = forceState({ positions: { p1: [{ row: 4, col: 9 }], p2: [{ row: 9, col: 9 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "knight", dr: -2, dc: 1 });
    expect(next.positions.p1[0]).toEqual({ row: 2, col: 10 });
    expect(targetZoneCells("p1")).toContainEqual({ row: 2, col: 10 });
    expect(next.winner).toBe("p1");
  });

  it("once gameOver, further actions are no-ops", () => {
    const state = forceState({
      positions: { p1: [{ row: 0, col: 10 }], p2: [{ row: 9, col: 9 }] },
      phase: "gameOver",
      winner: "p1",
    });
    const next = applyAction(state, { type: "pass" });
    expect(next).toEqual(state);
  });
});

describe("pass (turn-timer house rule, §5)", () => {
  it("switches the active seat without moving any piece", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 9, col: 9 }] } });
    const next = applyAction(state, { type: "pass" });
    expect(next.positions).toEqual(state.positions);
    expect(next.activeSeat).toBe(otherSeat(state.activeSeat));
    expect(next.turnNumber).toBe(state.turnNumber + 1);
    expect(next.moveHistory).toEqual([]);
  });
});

describe("getLegalMoves / applyAction agreement", () => {
  it("every legal move reported by getLegalMoves is accepted and lands where predicted", () => {
    const state = forceState({
      positions: {
        p1: [{ row: 2, col: 2 }, { row: 6, col: 6 }],
        p2: [{ row: 8, col: 8 }, { row: 1, col: 1 }],
      },
    });
    for (const move of getLegalMoves(state)) {
      const next = applyAction(state, {
        type: "move",
        horseIndex: move.horseIndex,
        moveKind: move.moveKind,
        dr: move.dr,
        dc: move.dc,
      });
      expect(next.positions.p1[move.horseIndex]).toEqual(move.to);
    }
  });

  it("real starting position: every horse has at least one legal move", () => {
    const state = startGame(seededRng(7));
    const moves = getLegalMoves(state);
    const horsesWithMoves = new Set(moves.map((m) => m.horseIndex));
    expect(horsesWithMoves.size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty)
// ---------------------------------------------------------------------------

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("mirrors getLegalMoves as move actions for the active seat, and nothing for the idle seat", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 9, col: 9 }] } });
    const moves = getValidMoves(state, "p1");
    expect(moves).toHaveLength(getLegalMoves(state).length);
    expect(moves.every((m) => m.type === "move")).toBe(true);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("returns [] outside the 'playing' phase", () => {
    const state = forceState({ phase: "gameOver" });
    expect(getValidMoves(state, state.activeSeat)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat that isn't the active seat", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 9, col: 9 }] } });
    expect(chooseBotAction(state, "p2", 5)).toBeNull();
  });

  it("always returns a legal move regardless of level", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 6, col: 6 }] } });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) slides away from the goal, while Level 10 spots the immediate win", () => {
    // p1's lone horse sits dead center. Every slide direction is
    // unobstructed (p2's horse at (6,6) only blocks the down-right
    // diagonal). getLegalMoves lists slide dir (-1,-1) first (SLIDE_DIRECTIONS'
    // own order) -> to (0,0), which is far from p2's home zones (distance
    // 5 -> 8, strictly worse). Slide dir (-1,1) -> (0,10) lands exactly
    // inside p2's zone, an immediate win.
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 6, col: 6 }] } });

    const level1Action = chooseBotAction(state, "p1", 1, () => 0);
    expect(level1Action).toEqual({ type: "move", horseIndex: 0, moveKind: "slide", dr: -1, dc: -1 });

    const level10Action = chooseBotAction(state, "p1", 10, () => 0);
    expect(level10Action).toEqual({ type: "move", horseIndex: 0, moveKind: "slide", dr: -1, dc: 1 });
  });
});

function playFullBotGame(seed: number, levelOf: (seat: Seat) => number): MalDalliJaState {
  let state = startGame(seededRng(seed));
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 2000) {
    guard++;
    const seat = state.activeSeat;
    const action = chooseBotAction(state, seat, levelOf(seat));
    expect(action).not.toBeNull();
    state = applyAction(state, action as EngineAction);
  }
  return state;
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  it("completes an all-Level-10 game with a winner declared", () => {
    const state = playFullBotGame(123, () => 10);
    expect(state.phase).toBe("gameOver");
    expect(state.winner).not.toBeNull();
  });

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(456, (seat) => (seat === "p1" ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(state.winner).not.toBeNull();
  });
});
