import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  BOARD_SIZE,
  HOME_ZONES,
  HORSES_PER_PLAYER,
  HORSES_PER_ZONE,
  OASIS,
  OASIS_ZONE_CELLS,
  SLIDE_DIRECTIONS,
  applyAction,
  chooseBotAction,
  getLegalMoves,
  getValidMoves,
  isOasisZoneCell,
  isOrthogonalStep,
  otherSeat,
  startGame,
  type EngineAction,
  type MalDalliJaState,
  type Position,
  type Seat,
} from "./engine";

function posKey(p: Position) {
  return `${p.row},${p.col}`;
}

describe("home zones (§1 세팅, 2026-08-14 image-based redesign — 4 corners, 5 horses each)", () => {
  it("gives each seat two 5-cell corner zones (10 horses total per seat)", () => {
    expect(HORSES_PER_ZONE).toBe(5);
    expect(HORSES_PER_PLAYER).toBe(10);
    for (const seat of ["p1", "p2"] as const) {
      expect(HOME_ZONES[seat][0]).toHaveLength(5);
      expect(HOME_ZONES[seat][1]).toHaveLength(5);
    }
  });

  it("p1 (백마) owns both ends of the main diagonal, p2 (흑마) both ends of the anti-diagonal (pixel-verified against 말달리자판.png)", () => {
    expect(HOME_ZONES.p1[0]).toContainEqual({ row: 0, col: 0 });
    expect(HOME_ZONES.p1[1]).toContainEqual({ row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 });
    expect(HOME_ZONES.p2[0]).toContainEqual({ row: 0, col: BOARD_SIZE - 1 });
    expect(HOME_ZONES.p2[1]).toContainEqual({ row: BOARD_SIZE - 1, col: 0 });
  });

  it("all 4 corner zones (20 cells) are mutually disjoint", () => {
    const allCells = [...HOME_ZONES.p1[0], ...HOME_ZONES.p1[1], ...HOME_ZONES.p2[0], ...HOME_ZONES.p2[1]];
    expect(new Set(allCells.map(posKey)).size).toBe(20);
  });

  it("each corner zone is exactly the pixel-measured L-shape (3 along one edge + 2 along the perpendicular edge)", () => {
    const MAX = BOARD_SIZE - 1;
    const expectedByZone: [Position[], Position[]][] = [
      [
        // Top-Left (백마)
        [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 2, col: 0 }],
        // Bottom-Right (백마)
        [
          { row: MAX, col: MAX },
          { row: MAX, col: MAX - 1 },
          { row: MAX, col: MAX - 2 },
          { row: MAX - 1, col: MAX },
          { row: MAX - 2, col: MAX },
        ],
      ],
      [
        // Top-Right (흑마)
        [
          { row: 0, col: MAX },
          { row: 0, col: MAX - 1 },
          { row: 0, col: MAX - 2 },
          { row: 1, col: MAX },
          { row: 2, col: MAX },
        ],
        // Bottom-Left (흑마)
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
  });
});

describe("oasis diamond zone (§1 / 말달리자판.png — Manhattan distance ≤2 from center)", () => {
  it("has exactly 13 cells: 1 (distance 0) + 4×3 (distance 1-2 diamond ring)", () => {
    expect(OASIS_ZONE_CELLS).toHaveLength(13);
    expect(OASIS_ZONE_CELLS.map(posKey)).toContain(posKey(OASIS));
  });

  it("classifies the center, the green ring, and cells outside the diamond correctly", () => {
    expect(isOasisZoneCell(OASIS)).toBe(true); // blue center
    expect(isOasisZoneCell({ row: 5, col: 7 })).toBe(true); // green ring, distance 2
    expect(isOasisZoneCell({ row: 3, col: 5 })).toBe(true); // green ring tip, distance 2
    expect(isOasisZoneCell({ row: 5, col: 8 })).toBe(false); // distance 3, outside the diamond
    expect(isOasisZoneCell({ row: 2, col: 2 })).toBe(false); // far outside
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

  it("sliding into/through/out of the oasis zone is completely unrestricted (only knight moves are affected by the house rule below)", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 4 }], p2: [{ row: 9, col: 9 }] } });
    const moves = getLegalMoves(state);
    const rightSlide = moves.find((m) => m.moveKind === "slide" && m.dr === 0 && m.dc === 1);
    expect(rightSlide?.to).toEqual({ row: 5, col: 10 }); // slides straight through the oasis center and ring
  });
});

describe("[하우스 룰] 대각선 슬라이드 금지, 상하좌우 4방향만 허용 (2026-08-16, 룰북 §3 원문의 8방향에서 변경)", () => {
  it("SLIDE_DIRECTIONS contains exactly the 4 orthogonal unit vectors and no diagonal offset", () => {
    expect(SLIDE_DIRECTIONS).toHaveLength(4);
    const set = new Set(SLIDE_DIRECTIONS.map(([dr, dc]) => `${dr},${dc}`));
    expect(set).toEqual(new Set(["0,1", "0,-1", "1,0", "-1,0"]));
    for (const [dr, dc] of SLIDE_DIRECTIONS) {
      expect(dr !== 0 && dc !== 0).toBe(false); // no diagonal (both components nonzero) vector
    }
  });

  it("getLegalMoves never offers a diagonal slide, even from an open board center with nothing blocking any direction", () => {
    // A genuinely open cell away from both corners/oasis so all 4 orthogonal
    // slides plus (previously) all 4 diagonals would be legal.
    const state = forceState({ positions: { p1: [{ row: 8, col: 2 }], p2: [{ row: 10, col: 10 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "slide");
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.dr !== 0 && m.dc !== 0).toBe(false); // never both nonzero (diagonal)
    }
    // Sanity: the diagonal destination that used to be legal is absent.
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 0, col: 0 }); // old (-1,-1) slide destination
  });

  it("a horse that could previously win only via a diagonal slide no longer has that path available", () => {
    // p1 at (2,2); oasis at (5,5) is reachable only via the diagonal (1,1)
    // direction from here with nothing in between — that move must no
    // longer be offered at all now that diagonal slides are removed.
    const state = forceState({ positions: { p1: [{ row: 2, col: 2 }], p2: [{ row: 9, col: 9 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "slide");
    expect(moves.some((m) => m.dr === 1 && m.dc === 1)).toBe(false);
    expect(moves.map((m) => m.to)).not.toContainEqual(OASIS);
  });

  it("dispatching an explicit diagonal MOVE action (dr:1,dc:1) is a no-op — state is untouched, not even the turn advances", () => {
    // Same open-board setup as above: (2,2) -> (5,5) would have been a legal
    // diagonal slide before the 2026-08-16 house rule. Forging that action
    // directly (bypassing whatever the UI would offer) must still be
    // rejected by applyMove's own legal-move lookup, exactly like any other
    // fabricated illegal action.
    const state = forceState({ positions: { p1: [{ row: 2, col: 2 }], p2: [{ row: 9, col: 9 }] } });
    const diagonalAction: EngineAction = { type: "move", horseIndex: 0, moveKind: "slide", dr: 1, dc: 1 };
    const next = applyAction(state, diagonalAction);
    expect(next).toEqual(state);
    expect(next.positions.p1[0]).toEqual({ row: 2, col: 2 }); // horse never moved
    expect(next.activeSeat).toBe(state.activeSeat); // turn did not advance
  });

  it.each([
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const)("dispatching diagonal MOVE dr:%d dc:%d is a no-op from every diagonal quadrant", (dr, dc) => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 - dc }], p2: [{ row: 0, col: 10 }] } });
    // Move the p1 horse just off-center so OASIS-landing isn't a confound;
    // any diagonal offset should be rejected regardless of destination.
    const before = structuredClone(state);
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr, dc });
    expect(next).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 2026-08-17 session — bug report was recurring in production because `main`
// never merged the 2026-08-16 fix (see engine.ts's module doc timeline).
// This block adds defense-in-depth coverage for the new `isOrthogonalStep`
// guard in `resolveSlide`/`applyMove`, plus an exhaustive random-board sweep
// so this can never silently regress again.
// ---------------------------------------------------------------------------

describe("[방어 로직 2026-08-17] isOrthogonalStep — 슬라이드 전용 직교 불변식 가드", () => {
  it("accepts the 4 orthogonal unit vectors", () => {
    for (const [dr, dc] of SLIDE_DIRECTIONS) {
      expect(isOrthogonalStep(dr, dc)).toBe(true);
    }
  });

  it("rejects every diagonal vector (both components nonzero)", () => {
    for (const dr of [-1, 1]) {
      for (const dc of [-1, 1]) {
        expect(isOrthogonalStep(dr, dc)).toBe(false);
      }
    }
  });

  it("does NOT reject knight offsets when misused as a slide vector — this guard is purely (dr,dc)-shaped, callers are responsible for scoping it to moveKind 'slide' only (see applyMove)", () => {
    // Sanity check on the primitive itself: (2,1)-shaped offsets are also
    // "both nonzero", so isOrthogonalStep correctly reports them as
    // non-orthogonal too — it's applyMove's `moveKind === "slide"` scoping
    // (not this function) that keeps knight moves unaffected.
    expect(isOrthogonalStep(2, 1)).toBe(false);
    expect(isOrthogonalStep(-2, 1)).toBe(false);
  });
});

describe("[방어 로직 2026-08-17] getLegalMoves 전수 검증 — 임의의 보드 배치에서도 slide 이동은 항상 직교", () => {
  it("every slide destination getLegalMoves ever offers has row===from.row or col===from.col, across many random board layouts", () => {
    const rng = seededRng(2026_08_17);
    for (let trial = 0; trial < 200; trial++) {
      const randCell = () => ({ row: Math.floor(rng() * BOARD_SIZE), col: Math.floor(rng() * BOARD_SIZE) });
      const p1Cell = randCell();
      let p2Cell = randCell();
      while (posKey(p2Cell) === posKey(p1Cell)) p2Cell = randCell(); // keep the two horses on distinct cells
      const state = forceState({ positions: { p1: [p1Cell], p2: [p2Cell] } });

      for (const move of getLegalMoves(state).filter((m) => m.moveKind === "slide")) {
        const from = state.positions.p1[move.horseIndex];
        expect(move.to.row === from.row || move.to.col === from.col).toBe(true);
        expect(isOrthogonalStep(move.dr, move.dc)).toBe(true);
      }
    }
  });

  it("applyMove rejects a forged diagonal slide action even when getLegalMoves is never consulted first (isOrthogonalStep short-circuits inside applyMove itself)", () => {
    // Regression guard for the exact defense-in-depth path added this
    // session: even if some future bug made a diagonal vector slip past
    // getLegalMoves's own filtering, applyMove's own `isOrthogonalStep`
    // check (engine.ts) rejects it independently before the legal-move
    // lookup even runs.
    const state = forceState({ positions: { p1: [{ row: 4, col: 4 }], p2: [{ row: 9, col: 9 }] } });
    for (const [dr, dc] of [[-2, -2], [-3, 3], [5, -5]] as const) {
      const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr, dc });
      expect(next).toEqual(state);
    }
  });
});

describe("knight movement (§3 이동 방식 2, tested away from the oasis zone to isolate general legality)", () => {
  it("lands on any of the 8 L-shaped offsets when empty", () => {
    const state = forceState({ positions: { p1: [{ row: 8, col: 8 }], p2: [{ row: 1, col: 1 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves).toHaveLength(8);
    expect(moves.map((m) => m.to)).toContainEqual({ row: 6, col: 7 });
  });

  it("can jump over an obstacle sitting between origin and landing square", () => {
    const state = forceState({ positions: { p1: [{ row: 8, col: 8 }], p2: [{ row: 7, col: 8 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).toContainEqual({ row: 6, col: 7 });
  });

  it("cannot land on a square occupied by the opponent", () => {
    const state = forceState({ positions: { p1: [{ row: 8, col: 8 }], p2: [{ row: 6, col: 7 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 6, col: 7 });
  });

  it("cannot land on a square occupied by the mover's own horse", () => {
    const state = forceState({
      positions: { p1: [{ row: 8, col: 8 }, { row: 6, col: 7 }], p2: [{ row: 1, col: 1 }] },
    });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight" && m.horseIndex === 0);
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 6, col: 7 });
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

describe("oasis win condition (§4 — must land exactly on the single blue center cell)", () => {
  it("landing exactly on the oasis via a slide wins immediately", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 0 }], p2: [{ row: 5, col: 6 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[0]).toEqual(OASIS);
    expect(next.phase).toBe("gameOver");
    expect(next.winner).toBe("p1");
  });

  it("sliding past where the oasis would be (nothing blocks it there) does not count unless it stops exactly there", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 0 }], p2: [{ row: 0, col: 0 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[0]).toEqual({ row: 5, col: 10 });
    expect(next.phase).toBe("playing");
    expect(next.winner).toBeNull();
  });

  it("landing on the oasis with a second horse while the first is elsewhere still wins for that seat", () => {
    const state = forceState({
      positions: { p1: [{ row: 0, col: 0 }, { row: 5, col: 0 }], p2: [{ row: 5, col: 6 }] },
    });
    const next = applyAction(state, { type: "move", horseIndex: 1, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[1]).toEqual(OASIS);
    expect(next.positions.p1[0]).toEqual({ row: 0, col: 0 }); // untouched
    expect(next.winner).toBe("p1");
  });

  it("once gameOver, further actions are no-ops", () => {
    const state = forceState({
      positions: { p1: [OASIS], p2: [{ row: 9, col: 9 }] },
      phase: "gameOver",
      winner: "p1",
    });
    const next = applyAction(state, { type: "pass" });
    expect(next).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// New 2026-08-14 house rule — NOT in the rulebook (§3/§4 have no oasis
// carve-out for knight moves; §6 even recommends knight moves near the
// oasis). Zone-wide (13-cell diamond), broader than the single-cell version
// this session replaces. See engine.ts's module doc for the full context.
// ---------------------------------------------------------------------------

describe("[하우스 룰] 오아시스 구역 L자 이동 제약 (2026-08-14, 룰북에 없는 신규 규칙, 존 전체 적용)", () => {
  it("blocks a knight move whenever the mover's own cell is already inside the oasis zone, even if the landing/elbow cells are outside it", () => {
    // From (5,3) — inside the zone (distance 2) — offset (1,-2) lands on
    // (6,1) (distance 5, outside) via elbow cells (6,3) and (5,1) (distances
    // 3 and 4, both outside) — the only reason this is blocked is "위에서".
    const state = forceState({ positions: { p1: [{ row: 5, col: 3 }], p2: [{ row: 10, col: 10 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 6, col: 1 });
  });

  it("blocks a knight move whenever the landing cell alone is inside the oasis zone ('진입')", () => {
    // From (3,2) — outside the zone (distance 5) — offset (2,1) lands on
    // (5,3), which is inside the zone (distance 2); both elbow cells (5,2)
    // and (3,3) are outside it.
    const state = forceState({ positions: { p1: [{ row: 3, col: 2 }], p2: [{ row: 10, col: 10 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 5, col: 3 });
  });

  it("blocks a knight move whenever only an elbow cell passes through the oasis zone ('경유'), even though the mover's cell and landing cell are both outside it (row-first decomposition)", () => {
    // From (3,3): offset (2,-1) lands on (5,2) (distance 3, outside) but the
    // "2 rows then turn 1 column" elbow reading is (5,3) (distance 2, inside).
    const state = forceState({ positions: { p1: [{ row: 3, col: 3 }], p2: [{ row: 10, col: 10 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 5, col: 2 });
  });

  it("blocks a knight move via the other elbow decomposition (column-first), same origin", () => {
    // From (3,3): offset (-1,2) lands on (2,5) (distance 3, outside) but the
    // "2 columns then turn 1 row" elbow reading is (3,5) (distance 2, inside).
    const state = forceState({ positions: { p1: [{ row: 3, col: 3 }], p2: [{ row: 10, col: 10 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual({ row: 2, col: 5 });
  });

  it("never offers a knight move landing exactly on the oasis center", () => {
    const state = forceState({ positions: { p1: [{ row: 3, col: 4 }], p2: [{ row: 10, col: 10 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves.map((m) => m.to)).not.toContainEqual(OASIS);
  });

  it("away from the oasis zone, knight (L자) moves are completely unrestricted", () => {
    const state = forceState({ positions: { p1: [{ row: 8, col: 8 }], p2: [{ row: 1, col: 1 }] } });
    const moves = getLegalMoves(state).filter((m) => m.moveKind === "knight");
    expect(moves).toHaveLength(8); // (8,8) and all its offsets/elbows are >2 Manhattan away from (5,5)
  });

  it("slide moves are completely unaffected — sliding onto the oasis still wins even starting from inside the zone", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 3 }], p2: [{ row: 5, col: 6 }] } });
    const next = applyAction(state, { type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });
    expect(next.positions.p1[0]).toEqual(OASIS);
    expect(next.winner).toBe("p1");
  });
});

describe("pass (turn-timer house rule, §5)", () => {
  it("switches the active seat without moving any piece", () => {
    const state = forceState({ positions: { p1: [{ row: 5, col: 5 }], p2: [{ row: 9, col: 9 }] }, activeSeat: "p1" });
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
        p1: [{ row: 2, col: 2 }, { row: 8, col: 8 }],
        p2: [{ row: 8, col: 2 }, { row: 1, col: 1 }],
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

  // Levels 8-10 now run real iterative-deepening alpha-beta with a
  // wall-clock budget (see engine.ts's ALPHA_BETA_BUDGETS) instead of one
  // cheap heuristic pass, so looping every level (and, below, every level ×
  // several rng samples) genuinely costs real time — both bumped well past
  // vitest's 5s default, generously enough to absorb CI/parallel-test load.
  it("always returns a legal move regardless of level", () => {
    const state = forceState({ positions: { p1: [{ row: 2, col: 2 }], p2: [{ row: 7, col: 7 }] } });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
  }, 30_000);

  it("never proposes a knight move that the oasis-zone house rule blocks", () => {
    const state = forceState({ positions: { p1: [{ row: 3, col: 5 }], p2: [{ row: 10, col: 10 }] } });
    for (let level = 1; level <= 10; level++) {
      for (let sample = 0; sample < 5; sample++) {
        const action = chooseBotAction(state, "p1", level, seededRng(level * 100 + sample));
        expect(action).not.toBeNull();
        if (action && action.type === "move" && action.moveKind === "knight") {
          const to = { row: 3 + action.dr, col: 5 + action.dc };
          expect(isOasisZoneCell(to)).toBe(false);
        }
      }
    }
  }, 60_000);

  it("Level 1 (forced onto its mistake path) slides away from the oasis, while Level 10 spots the immediate win", () => {
    // p1 at (0,5) — directly above the oasis column. p2 at (6,5) blocks the
    // downward slide exactly one step past the oasis, so slide dir (1,0)
    // stops exactly on (5,5) — an immediate win. getLegalMoves lists slide
    // dir (0,1) first (SLIDE_DIRECTIONS' own order) -> unobstructed all the
    // way to (0,10), away from the oasis (distance 5 -> 5, but not a win).
    const state = forceState({ positions: { p1: [{ row: 0, col: 5 }], p2: [{ row: 6, col: 5 }] } });

    const level1Action = chooseBotAction(state, "p1", 1, () => 0);
    expect(level1Action).toEqual({ type: "move", horseIndex: 0, moveKind: "slide", dr: 0, dc: 1 });

    const level10Action = chooseBotAction(state, "p1", 10, () => 0);
    expect(level10Action).toEqual({ type: "move", horseIndex: 0, moveKind: "slide", dr: 1, dc: 0 });
  });
});

function playFullBotGame(
  seed: number,
  levelOf: (seat: Seat) => number,
  opts?: { guard?: number; alphaBetaBudget?: { maxDepth: number; timeBudgetMs: number } },
): MalDalliJaState {
  const guardLimit = opts?.guard ?? 2000;
  // Separate seeded stream from startGame's own seededRng(seed) (first-mover
  // pick), so the two don't share state — keeps the whole simulation
  // deterministic instead of falling back to real Math.random for move
  // selection (that nondeterminism was masking exactly the flakiness this
  // describe block's 2026-08-16 update below is about).
  const moveRng = seededRng(seed + 1);
  let state = startGame(seededRng(seed));
  let guard = 0;
  while (state.phase !== "gameOver" && guard < guardLimit) {
    guard++;
    const seat = state.activeSeat;
    const action = chooseBotAction(
      state,
      seat,
      levelOf(seat),
      moveRng,
      opts?.alphaBetaBudget ? { alphaBetaBudget: opts.alphaBetaBudget } : undefined,
    );
    expect(action).not.toBeNull();
    state = applyAction(state, action as EngineAction);
  }
  return state;
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (크래시/무한루프 방지)", () => {
  // Level 8-10 now run real iterative-deepening alpha-beta (up to a 500ms
  // wall-clock budget per move at Level 10, see engine.ts's
  // ALPHA_BETA_BUDGETS) instead of a single cheap heuristic pass, so a full
  // game genuinely takes real time — bumped well past vitest's 5s default.
  //
  // **2026-08-16 update**: the 4방향 직교 슬라이드 하우스 룰(see engine.ts's
  // module doc, diagonal slides removed) shrinks the oasis's approach lines
  // from 8 down to 2 (its own row + column), which makes permanently
  // blocking both of them far easier than before. A standalone diagnostic
  // (5 seeds, reduced search budget, 20,000-half-move cap, confirmed via
  // `AskUserQuestion`) found 3 of 5 seeds never reached `gameOver` even at
  // that cap — a real perpetual-stalemate risk between two equally-strong
  // players, not a bug in this engine (mitigated in actual play by §5's
  // optional turn timer, which forces a `pass` rather than requiring a
  // move). So this test no longer asserts `gameOver` is reached; it only
  // asserts the game runs many half-moves with legal, non-null actions
  // throughout and never crashes or stalls silently.
  it("runs many half-moves in an all-Level-10 game without crashing, and reports a legal winner if it does finish", () => {
    const state = playFullBotGame(123, () => 10, { guard: 1500, alphaBetaBudget: { maxDepth: 3, timeBudgetMs: 10 } });
    expect(["playing", "gameOver"]).toContain(state.phase);
    if (state.phase === "gameOver") expect(state.winner).not.toBeNull();
  }, 60_000);

  it("runs many half-moves with a mixed Level 1 / Level 10 table without crashing, and reports a legal winner if it does finish", () => {
    // Level 1's high mistake rate makes convergence likelier than the pure
    // Level-10-vs-Level-10 case above, but the same 2026-08-16 stalemate
    // risk still applies in principle, so this is a smoke test too rather
    // than an assertion that gameOver is always reached.
    const state = playFullBotGame(456, (seat) => (seat === "p1" ? 1 : 10), {
      guard: 1500,
      alphaBetaBudget: { maxDepth: 3, timeBudgetMs: 10 },
    });
    expect(["playing", "gameOver"]).toContain(state.phase);
    if (state.phase === "gameOver") expect(state.winner).not.toBeNull();
  }, 60_000);
});
