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
 * rulebook engine. So: no cards, no dice, no chips, no seed/life system, no
 * betting anywhere in this engine — only the two house rules the rulebook
 * itself names in §5 (single-match mode, and an optional turn timer).
 *
 * House rules implemented:
 *  - §5 "단판 승부" is not a toggle — the original 3-games-to-2 match format
 *    isn't implemented at all; a "game" here always is the single round.
 *  - §5 "착수 시간 제한" (optional 30s–60s turn timer) is a *room setting*,
 *    not engine state — see `MalDalliJaGame.tsx`. The engine has no notion
 *    of wall-clock time (per ARCHITECTURE.md §1's purity contract), so a
 *    timed-out turn is just an ordinary `{ type: "pass" }` action that the
 *    active player's own client sends when its local countdown hits zero.
 *    The engine accepts `pass` unconditionally by design (same client-trust
 *    model every other online game in this project already documents in
 *    docs/architecture.md §2 — only the seat entitled to act is ever
 *    expected to send that seat's actions) rather than trying to verify
 *    "did time actually run out", which it structurally cannot do.
 */

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** 11×11 board, 0-indexed rows/cols 0..10 (rulebook's "A1..K11"). */
export const BOARD_SIZE = 11;

export interface Position {
  row: number;
  col: number;
}

/** §1: center cell (rulebook's "F6", 6th row/6th col 1-indexed = index 5). */
export const OASIS: Position = { row: 5, col: 5 };

/** §1 setup example: opposite corners. */
const START_POSITIONS: Record<Seat, Position> = {
  p1: { row: 0, col: 0 },
  p2: { row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 },
};

export function positionsEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function inBounds(p: Position): boolean {
  return p.row >= 0 && p.row < BOARD_SIZE && p.col >= 0 && p.col < BOARD_SIZE;
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
  moveKind: MoveKind;
  /** The direction (slide) or offset (knight) vector that produced `to`. */
  dr: number;
  dc: number;
  to: Position;
}

export interface MoveRecord {
  seat: Seat;
  moveKind: MoveKind;
  from: Position;
  to: Position;
}

export type GamePhase = "playing" | "gameOver";

export interface MalDalliJaState {
  positions: Record<Seat, Position>;
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
    positions: { p1: { ...START_POSITIONS.p1 }, p2: { ...START_POSITIONS.p2 } },
    activeSeat: firstSeat,
    turnNumber: 1,
    phase: "playing",
    winner: null,
    moveHistory: [],
  };
}

/** §3 "슬라이드 이동": step in one direction until the next step is blocked. */
function resolveSlide(from: Position, dr: number, dc: number, blocker: Position): Position | null {
  let cur = from;
  let moved = false;
  for (;;) {
    const next: Position = { row: cur.row + dr, col: cur.col + dc };
    if (!inBounds(next) || positionsEqual(next, blocker)) break;
    cur = next;
    moved = true;
  }
  return moved ? cur : null;
}

/**
 * All legal moves for the active seat in `state`. UI and engine share this
 * single function so "which cells can I move to" never drifts from "which
 * moves the engine will actually accept".
 */
export function getLegalMoves(state: MalDalliJaState): LegalMove[] {
  const from = state.positions[state.activeSeat];
  const blocker = state.positions[otherSeat(state.activeSeat)];
  const moves: LegalMove[] = [];

  for (const [dr, dc] of SLIDE_DIRECTIONS) {
    const to = resolveSlide(from, dr, dc, blocker);
    if (to) moves.push({ moveKind: "slide", dr, dc, to });
  }

  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const to: Position = { row: from.row + dr, col: from.col + dc };
    // §3 "이동 방식 2": lands only on an empty square; obstacles may be jumped.
    if (inBounds(to) && !positionsEqual(to, blocker)) {
      moves.push({ moveKind: "knight", dr, dc, to });
    }
  }

  return moves;
}

export type EngineAction =
  | { type: "move"; moveKind: MoveKind; dr: number; dc: number }
  | { type: "pass" };

function applyMove(state: MalDalliJaState, action: Extract<EngineAction, { type: "move" }>): MalDalliJaState {
  const legal = getLegalMoves(state).find(
    (m) => m.moveKind === action.moveKind && m.dr === action.dr && m.dc === action.dc,
  );
  if (!legal) return state; // illegal move: no-op, mirrors other engines' defensive guards

  const seat = state.activeSeat;
  const from = state.positions[seat];
  const to = legal.to;
  const won = positionsEqual(to, OASIS); // §4 "오아시스 착지" — must land exactly on it

  return {
    ...state,
    positions: { ...state.positions, [seat]: to },
    activeSeat: otherSeat(seat),
    turnNumber: state.turnNumber + 1,
    phase: won ? "gameOver" : "playing",
    winner: won ? seat : null,
    moveHistory: [...state.moveHistory, { seat, moveKind: legal.moveKind, from, to }],
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
