import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  BOARD_SIZE,
  OASIS,
  applyAction,
  getLegalMoves,
  otherSeat,
  startGame,
  type MalDalliJaState,
} from "./engine";

describe("startGame (setup, §1)", () => {
  it("places p1 and p2 on opposite corners", () => {
    const state = startGame(seededRng(1));
    expect(state.positions.p1).toEqual({ row: 0, col: 0 });
    expect(state.positions.p2).toEqual({ row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 });
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

  it("starts mid-board, phase playing, no winner, empty history", () => {
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
    const state = forceState({ positions: { p1: { row: 0, col: 0 }, p2: { row: 10, col: 10 } } });
    const moves = getLegalMoves(state);
    const rightSlide = moves.find((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1);
    expect(rightSlide?.to).toEqual({ row: 0, col: 10 });
  });

  it("stops one cell short of the opponent's horse", () => {
    const state = forceState({ positions: { p1: { row: 5, col: 0 }, p2: { row: 5, col: 4 } } });
    const moves = getLegalMoves(state);
    const rightSlide = moves.find((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1);
    expect(rightSlide?.to).toEqual({ row: 5, col: 3 });
  });

  it("offers no slide in a direction where the opponent is adjacent (zero-distance slide is not a move)", () => {
    const state = forceState({ positions: { p1: { row: 5, col: 5 }, p2: { row: 5, col: 6 } } });
    const moves = getLegalMoves(state);
    expect(moves.some((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1)).toBe(false);
  });

  it("applying a slide moves the piece, switches the active seat, and records history", () => {
    const state = forceState({ positions: { p1: { row: 0, col: 0 }, p2: { row: 10, col: 10 } } });
    const next = applyAction(state, { type: "move", moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1).toEqual({ row: 0, col: 10 });
    expect(next.activeSeat).toBe("p2");
    expect(next.turnNumber).toBe(state.turnNumber + 1);
    expect(next.moveHistory).toEqual([
      { seat: "p1", moveKind: "slide", from: { row: 0, col: 0 }, to: { row: 0, col: 10 } },
    ]);
  });

  it("an illegal slide (not among legal moves) is a no-op", () => {
    // Diagonal slide from (0,0) with dr=1,dc=0 is a legal *direction* but a
    // bogus dr/dc pair (e.g. dr=1, dc=5) is never in the legal-move list.
    const state = forceState({ positions: { p1: { row: 0, col: 0 }, p2: { row: 10, col: 10 } } });
    const next = applyAction(state, { type: "move", moveKind: "slide", dr: 1, dc: 5 });
    expect(next).toEqual(state);
  });
});

describe("knight movement (§3 이동 방식 2)", () => {
  it("lands on any of the 8 L-shaped offsets when empty", () => {
    const state = forceState({ positions: { p1: { row: 5, col: 5 }, p2: { row: 10, col: 10 } } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves).toHaveLength(8);
    expect(moves.map((m) => m.to)).toContainEqual({ row: 3, col: 4 });
  });

  it("can jump over an obstacle sitting between origin and landing square", () => {
    // p2 directly in the path row between p1 and a knight-move destination —
    // knight moves don't check the path, only the landing square.
    const state = forceState({ positions: { p1: { row: 5, col: 5 }, p2: { row: 4, col: 5 } } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).toContainEqual({ row: 3, col: 4 });
  });

  it("cannot land on a square occupied by the opponent", () => {
    const state = forceState({ positions: { p1: { row: 5, col: 5 }, p2: { row: 3, col: 4 } } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 3, col: 4 });
  });

  it("excludes knight destinations off the board", () => {
    const state = forceState({ positions: { p1: { row: 0, col: 0 }, p2: { row: 10, col: 10 } } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    // Only 2 of the 8 offsets from a corner stay in-bounds on an 11x11 board.
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.to).sort((a, b) => a.row - b.row)).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
    ]);
  });
});

describe("oasis win condition (§4)", () => {
  it("landing exactly on the oasis via a slide wins immediately", () => {
    // Blocker sits one cell past the oasis so the slide stops exactly on it.
    const state = forceState({ positions: { p1: { row: 5, col: 0 }, p2: { row: 5, col: 6 } } });
    const next = applyAction(state, { type: "move", moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1).toEqual(OASIS);
    expect(next.phase).toBe("gameOver");
    expect(next.winner).toBe("p1");
  });

  it("sliding past where the oasis would be (blocked elsewhere) does not count unless it stops exactly there", () => {
    // p1 slides right along row 5; nothing blocks it before the edge, so it
    // overshoots the oasis (col 5) and stops at col 10 — no win.
    const state = forceState({ positions: { p1: { row: 5, col: 0 }, p2: { row: 0, col: 0 } } });
    const next = applyAction(state, { type: "move", moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1).toEqual({ row: 5, col: 10 });
    expect(next.phase).toBe("playing");
    expect(next.winner).toBeNull();
  });

  it("a blocker also enables a win when approaching the oasis vertically", () => {
    const state = forceState({ positions: { p1: { row: 0, col: 5 }, p2: { row: 6, col: 5 } } });
    const next = applyAction(state, { type: "move", moveKind: "slide", dr: 1, dc: 0 });
    expect(next.positions.p1).toEqual(OASIS);
    expect(next.winner).toBe("p1");
  });

  it("landing on the oasis via a knight move also wins", () => {
    const state = forceState({ positions: { p1: { row: 3, col: 4 }, p2: { row: 10, col: 10 } } });
    const next = applyAction(state, { type: "move", moveKind: "knight", dr: 2, dc: 1 });
    expect(next.positions.p1).toEqual(OASIS);
    expect(next.winner).toBe("p1");
  });

  it("once gameOver, further actions are no-ops", () => {
    const state = forceState({ positions: { p1: OASIS, p2: { row: 10, col: 10 } }, phase: "gameOver", winner: "p1" });
    const next = applyAction(state, { type: "pass" });
    expect(next).toEqual(state);
  });
});

describe("pass (turn-timer house rule, §5)", () => {
  it("switches the active seat without moving any piece", () => {
    const state = forceState({ positions: { p1: { row: 5, col: 5 }, p2: { row: 10, col: 10 } } });
    const next = applyAction(state, { type: "pass" });
    expect(next.positions).toEqual(state.positions);
    expect(next.activeSeat).toBe(otherSeat(state.activeSeat));
    expect(next.turnNumber).toBe(state.turnNumber + 1);
    expect(next.moveHistory).toEqual([]);
  });
});

describe("getLegalMoves / applyAction agreement", () => {
  it("every legal move reported by getLegalMoves is accepted and lands where predicted", () => {
    const state = forceState({ positions: { p1: { row: 2, col: 2 }, p2: { row: 8, col: 8 } } });
    for (const move of getLegalMoves(state)) {
      const next = applyAction(state, { type: "move", moveKind: move.moveKind, dr: move.dr, dc: move.dc });
      expect(next.positions.p1).toEqual(move.to);
    }
  });
});
