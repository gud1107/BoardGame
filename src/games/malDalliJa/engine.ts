/**
 * Pure "말달리자" (넷플릭스 예능 <데스게임>) rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/말달리자/말달리자.md` ("단판 승부 정식 규칙서").
 *
 * **Rulebook-vs-task-instruction conflict, resolved via `AskUserQuestion`
 * (2026-08-10 session)**: the work order that requested this game described
 * an entirely different genre — an N-horse betting race with cards/dice,
 * blind bets, and a seed/life elimination house rule. The actual rulebook
 * describes a 2-player abstract strategy game with no cards, dice, betting,
 * or elimination mechanics at all: each side has exactly one horse, and on
 * your turn you either *slide* it in one of 8 directions until it's blocked,
 * or *knight-move* it (chess knight's L-shape, jumping over obstacles) onto
 * an empty square. First to land exactly on the center "오아시스" square
 * wins immediately. The user was asked to choose between (a) rulebook
 * verbatim, (b) task instructions verbatim, or (c) a hybrid, and picked (a)
 * — rulebook verbatim, with the Netflix death-game *presentation* (dark neon
 * UI, an elimination-style loss screen) layered on top of the *unmodified*
 * rulebook engine.
 *
 * **2026-08-11 direct instruction — structural redesign, no rulebook check**
 * (this diverges from the rulebook above on purpose; it's a fresh direct
 * user instruction, not a work-order-vs-rulebook conflict, so it wasn't run
 * past the rulebook the way the paragraph above was): the user identified
 * the 1-horse-per-seat setup as wrong and instructed (1) each seat now
 * controls **10 horses** (`HORSES_PER_PLAYER`), split 5-and-5 across **two
 * diagonal-corner start zones**, and (2) the central "오아시스" square —
 * along with the win condition built around it — is removed entirely.
 * Removing the oasis also removes the engine's *only* win condition, and the
 * corner-zone assignment across the board's 4 corners was genuinely
 * ambiguous, so both were confirmed via `AskUserQuestion` before
 * implementing: the user picked **"말 1개 먼저 도달"** (a race — the
 * instant any one of your horses lands on a cell inside the *opponent's*
 * start zone, you win immediately, no need to march all 10 across) and
 * **"플레이어별 대각선 한 쌍"** (the board has exactly 2 diagonals and 4
 * corners; each diagonal is assigned to one player rather than split between
 * them — p1 owns both ends of the main diagonal, corners (0,0) and (10,10);
 * p2 owns both ends of the anti-diagonal, corners (0,10) and (10,0); 5
 * horses at each end, so the two players' 4 corner zones never overlap).
 *
 * Note on "L자 이동 불가" — the task that requested this change described
 * an "오아시스로 인한 L자 이동 제약" to remove, but that never existed in
 * this engine: the oasis only ever gated *win detection* (must land exactly
 * on it), never move legality — knight moves could already jump obstacles
 * and land on any empty square regardless of the oasis. So there's no
 * such restriction to strip out here; deleting the oasis-win check below is
 * the entire scope of that request. What *did* need to change mechanically
 * once 10 horses per side share the board: `resolveSlide`/knight-landing
 * previously treated "the opponent's one horse" as the sole obstacle — with
 * many horses now co-existing, **any** occupied cell (friend or foe) blocks
 * a slide and blocks a knight landing (a horse can't slide through or land
 * on another horse, its own included), matching how every other
 * multi-piece game in this project already treats occupancy.
 */

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** 11×11 board, 0-indexed rows/cols 0..10 (rulebook's "A1..K11"). */
export const BOARD_SIZE = 11;
const LAST = BOARD_SIZE - 1;

export interface Position {
  row: number;
  col: number;
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function inBounds(p: Position): boolean {
  return p.row >= 0 && p.row < BOARD_SIZE && p.col >= 0 && p.col < BOARD_SIZE;
}

function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

/** Each seat's 10 horses, split 5-and-5 across its two corner start zones. */
export const HORSES_PER_ZONE = 5;
export const HORSES_PER_PLAYER = HORSES_PER_ZONE * 2;

/**
 * A 5-cell "corner zone" hugging one literal board corner in an L-shape: 3
 * cells running along one edge from the corner vertex, plus 2 more running
 * along the perpendicular edge from that same vertex — e.g. corner (0,0)
 * yields (0,0),(0,1),(0,2),(1,0),(2,0). `rowDir`/`colDir` point *inward*
 * from the corner (e.g. corner (0,0) points +1/+1).
 *
 * **2026-08-11 corner-shape fix**: the 5th cell used to be the diagonal
 * neighbor `(cornerRow + rowDir, cornerCol + colDir)` (e.g. (1,1) for the
 * (0,0) corner) instead of extending the perpendicular-edge run to
 * `(cornerRow + 2*rowDir, cornerCol)` (e.g. (2,0)) — that put a horse one
 * step off the corner's own diagonal instead of completing the L, and was
 * reported as a misplaced horse sitting at (1,1). Fixed to the L-shape
 * pattern the user specified for all 4 corners.
 */
function cornerZone(cornerRow: number, cornerCol: number, rowDir: 1 | -1, colDir: 1 | -1): Position[] {
  return [
    { row: cornerRow, col: cornerCol },
    { row: cornerRow, col: cornerCol + colDir },
    { row: cornerRow, col: cornerCol + 2 * colDir },
    { row: cornerRow + rowDir, col: cornerCol },
    { row: cornerRow + 2 * rowDir, col: cornerCol },
  ];
}

/**
 * §1 세팅 (2026-08-11 redesign): each seat's home zones are both ends of one
 * board diagonal — p1 = main diagonal (0,0)+(10,10), p2 = anti-diagonal
 * (0,10)+(10,0). `HOME_ZONES[seat][0]`/`[1]` are the two 5-cell corner
 * camps; the flattened 10-cell array is also each seat's starting layout.
 */
export const HOME_ZONES: Record<Seat, [Position[], Position[]]> = {
  p1: [cornerZone(0, 0, 1, 1), cornerZone(LAST, LAST, -1, -1)],
  p2: [cornerZone(0, LAST, 1, -1), cornerZone(LAST, 0, -1, 1)],
};

const START_POSITIONS: Record<Seat, Position[]> = {
  p1: [...HOME_ZONES.p1[0], ...HOME_ZONES.p1[1]],
  p2: [...HOME_ZONES.p2[0], ...HOME_ZONES.p2[1]],
};

/** The cells a seat is racing *toward* — the opponent's two home corners. */
export function targetZoneCells(seat: Seat): Position[] {
  const [zoneA, zoneB] = HOME_ZONES[otherSeat(seat)];
  return [...zoneA, ...zoneB];
}

function isInOpponentZone(seat: Seat, pos: Position): boolean {
  return targetZoneCells(seat).some((c) => positionsEqual(c, pos));
}

export type MoveKind = "slide" | "knight";

/** The 8 slide directions (§3 "이동 방식 1"), as unit (dRow, dCol) vectors. */
export const SLIDE_DIRECTIONS: readonly [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** The 8 chess-knight offsets (§3 "이동 방식 2"). */
export const KNIGHT_OFFSETS: readonly [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

export interface LegalMove {
  /** Index into `state.positions[seat]` — which of the seat's 10 horses this move applies to. */
  horseIndex: number;
  moveKind: MoveKind;
  /** The direction (slide) or offset (knight) vector that produced `to`. */
  dr: number;
  dc: number;
  to: Position;
}

export interface MoveRecord {
  seat: Seat;
  horseIndex: number;
  moveKind: MoveKind;
  from: Position;
  to: Position;
}

export type GamePhase = "playing" | "gameOver";

export interface MalDalliJaState {
  /** Each seat's 10 horses; array index is that horse's stable id for the game's duration. */
  positions: Record<Seat, Position[]>;
  activeSeat: Seat;
  turnNumber: number; // 1-based, increments every half-move including passes
  phase: GamePhase;
  winner: Seat | null;
  moveHistory: MoveRecord[];
}

/**
 * §1 세팅: "선/후공을 가위바위보나 선뽑기로 정합니다" — the only place this
 * engine needs randomness is picking who moves first, so `startGame` still
 * takes an injected `rng` (per ARCHITECTURE.md §1's determinism contract)
 * even though there's no deck to shuffle.
 */
export function startGame(rng: () => number = Math.random): MalDalliJaState {
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    positions: {
      p1: START_POSITIONS.p1.map((p) => ({ ...p })),
      p2: START_POSITIONS.p2.map((p) => ({ ...p })),
    },
    activeSeat: firstSeat,
    turnNumber: 1,
    phase: "playing",
    winner: null,
    moveHistory: [],
  };
}

/** All 20 currently-occupied cells (both seats), as a lookup set. */
function allOccupied(state: MalDalliJaState): Set<string> {
  const set = new Set<string>();
  for (const seat of ["p1", "p2"] as const) {
    for (const p of state.positions[seat]) set.add(posKey(p));
  }
  return set;
}

/** §3 "슬라이드 이동": step in one direction until the next step is blocked by any horse or the edge. */
function resolveSlide(from: Position, dr: number, dc: number, occupied: Set<string>): Position | null {
  let cur = from;
  let moved = false;
  for (;;) {
    const next: Position = { row: cur.row + dr, col: cur.col + dc };
    if (!inBounds(next) || occupied.has(posKey(next))) break;
    cur = next;
    moved = true;
  }
  return moved ? cur : null;
}

/**
 * All legal moves for every one of the active seat's horses in `state`. UI
 * and engine share this single function so "which cells can I move to"
 * never drifts from "which moves the engine will actually accept".
 */
export function getLegalMoves(state: MalDalliJaState): LegalMove[] {
  const seat = state.activeSeat;
  const occupied = allOccupied(state);
  const moves: LegalMove[] = [];

  state.positions[seat].forEach((from, horseIndex) => {
    for (const [dr, dc] of SLIDE_DIRECTIONS) {
      const to = resolveSlide(from, dr, dc, occupied);
      if (to) moves.push({ horseIndex, moveKind: "slide", dr, dc, to });
    }

    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const to: Position = { row: from.row + dr, col: from.col + dc };
      // §3 "이동 방식 2": lands only on an empty square; any horse may be jumped.
      if (inBounds(to) && !occupied.has(posKey(to))) {
        moves.push({ horseIndex, moveKind: "knight", dr, dc, to });
      }
    }
  });

  return moves;
}

export type EngineAction =
  | { type: "move"; horseIndex: number; moveKind: MoveKind; dr: number; dc: number }
  | { type: "pass" };

function applyMove(state: MalDalliJaState, action: Extract<EngineAction, { type: "move" }>): MalDalliJaState {
  const legal = getLegalMoves(state).find(
    (m) =>
      m.horseIndex === action.horseIndex &&
      m.moveKind === action.moveKind &&
      m.dr === action.dr &&
      m.dc === action.dc,
  );
  if (!legal) return state; // illegal move: no-op, mirrors other engines' defensive guards

  const seat = state.activeSeat;
  const from = state.positions[seat][action.horseIndex];
  const to = legal.to;
  const won = isInOpponentZone(seat, to); // 2026-08-11: first horse into the opponent's home zone wins

  const nextHorses = state.positions[seat].map((p, i) => (i === action.horseIndex ? to : p));

  return {
    ...state,
    positions: { ...state.positions, [seat]: nextHorses },
    activeSeat: otherSeat(seat),
    turnNumber: state.turnNumber + 1,
    phase: won ? "gameOver" : "playing",
    winner: won ? seat : null,
    moveHistory: [...state.moveHistory, { seat, horseIndex: action.horseIndex, moveKind: legal.moveKind, from, to }],
  };
}

function applyPass(state: MalDalliJaState): MalDalliJaState {
  if (state.phase !== "playing") return state;
  return {
    ...state,
    activeSeat: otherSeat(state.activeSeat),
    turnNumber: state.turnNumber + 1,
  };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: MalDalliJaState, action: EngineAction): MalDalliJaState {
  if (state.phase !== "playing") return state;
  switch (action.type) {
    case "move":
      return applyMove(state, action);
    case "pass":
      return applyPass(state);
    default:
      return state;
  }
}
