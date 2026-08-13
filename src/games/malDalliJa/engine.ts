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
 * **2026-08-11 direct instruction — structural redesign** (superseded, see
 * below): the user identified the 1-horse-per-seat setup as wrong and
 * instructed 10 horses per seat across two diagonal corner zones, with the
 * oasis removed entirely in favor of a "reach the opponent's corner" race.
 *
 * **2026-08-13/14 session — reverted back to rulebook verbatim, confirmed via
 * `AskUserQuestion`**: a follow-up request asked to restore the oasis using
 * coordinates from an attached board image, but no image was actually present
 * in that request. Asked the user how to proceed; they chose (1) rulebook
 * verbatim for the oasis (single center cell, no surrounding "zone" — no
 * image needed for that), and (2) a full revert of the 2026-08-11 redesign
 * back to the original 1-horse-per-seat / oasis-win-condition design. So the
 * 10-horse/corner-zone code below is gone again; this file is back to the
 * shape it had at the 2026-08-10 decision, with one addition (next
 * paragraph).
 *
 * **New 2026-08-13/14 house rule — oasis L자(나이트) 이동 제약**: also
 * requested and confirmed via the same `AskUserQuestion`, framed as a
 * "Netflix 데스게임 공식 규칙." **This does not appear anywhere in the
 * rulebook** — §3's knight-move rule has no oasis carve-out, and §6's
 * strategy tips explicitly recommend *using* knight moves near the oasis to
 * line up a slide ("L자 이동으로 라인 잡기") or to cut off an opponent's
 * approach to it. The user was told this before confirming and chose to add
 * it anyway as a new, non-rulebook house rule — implemented as exactly that
 * below (`OASIS_KNIGHT_RESTRICTION`), clearly separated from the §3/§4
 * rulebook-verbatim logic so it's easy to find and revert if it turns out to
 * be unwanted. It only affects knight moves: a knight move is illegal if its
 * landing square is the oasis, or if the oasis is the "elbow" cell of either
 * of the two ways to decompose its L-shaped path (2-then-1 or 1-then-2).
 * Slide moves are completely unaffected — sliding onto the oasis still wins
 * per §4, and sliding past it still doesn't.
 */

import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

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

/**
 * The two possible "elbow" cells for a knight move from `from` by `(dr, dc)`
 * — a knight offset with |dr|,|dc| = 2,1 (in either order) can be read as
 * "2 then turn 1" or "1 then turn 2", each implying a different corner cell
 * the L-shape bends around. Used only by the oasis knight-restriction house
 * rule below; the rulebook itself never checks a knight move's path (§3:
 * "장애물을 넘어서 이동할 수 있다").
 */
function knightElbowCells(from: Position, dr: number, dc: number): [Position, Position] {
  return [
    { row: from.row + dr, col: from.col },
    { row: from.row, col: from.col + dc },
  ];
}

/**
 * New 2026-08-13/14 house rule (see module doc) — **not** in the rulebook.
 * A knight move may not land on, or bend its L-shaped path around, the
 * oasis cell.
 */
function knightBlockedByOasis(from: Position, to: Position, dr: number, dc: number): boolean {
  if (positionsEqual(to, OASIS)) return true;
  const [elbowA, elbowB] = knightElbowCells(from, dr, dc);
  return positionsEqual(elbowA, OASIS) || positionsEqual(elbowB, OASIS);
}

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
    // §3 "이동 방식 2": lands only on an empty square; obstacles may be
    // jumped. Plus the 2026-08-13/14 house rule: never through/onto oasis.
    if (inBounds(to) && !positionsEqual(to, blocker) && !knightBlockedByOasis(from, to, dr, dc)) {
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

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). No information-fairness
// concern here at all — both horses are physically visible to both players
// on the shared board, so the bot may freely reason about the opponent's
// horse too (unlike every other game in this project).
// ---------------------------------------------------------------------------

export function getValidMoves(state: MalDalliJaState, seat: Seat): EngineAction[] {
  if (state.phase !== "playing" || state.activeSeat !== seat) return [];
  const moves: EngineAction[] = getLegalMoves(state).map((m) => ({
    type: "move",
    moveKind: m.moveKind,
    dr: m.dr,
    dc: m.dc,
  }));
  // Structurally near-impossible on a mostly-open 11x11 board, but
  // `applyPass` is a legal no-target action the reducer already supports —
  // offer it as a last resort so this never returns [] while a seat is
  // genuinely up.
  return moves.length > 0 ? moves : [{ type: "pass" }];
}

/** How many of the opponent's currently-open slide lanes get newly shortened by the mover landing at `to` — a fully public-information "블로킹" signal (both horses are visible to both players). */
function countBlockedLanes(before: Position, after: Position, opponentPos: Position): number {
  let count = 0;
  for (const [dr, dc] of SLIDE_DIRECTIONS) {
    const reachBefore = resolveSlide(opponentPos, dr, dc, before);
    const reachAfter = resolveSlide(opponentPos, dr, dc, after);
    if (reachBefore && (!reachAfter || !positionsEqual(reachBefore, reachAfter))) count++;
  }
  return count;
}

/**
 * Higher = more desirable for the bot. Tiers per ARCHITECTURE.md §7.5:
 * novice ~ uniform over every legal move. core greedily minimizes the
 * mover's Chebyshev distance to the oasis (a rough stand-in for "moves left
 * to win", since a slide can cross several cells at once). expert (Lv.8-10)
 * adds `countBlockedLanes` — how many of the opponent's own slide lanes this
 * move newly shortens — on top of the same distance heuristic.
 */
export function scoreMove(state: MalDalliJaState, seat: Seat, move: EngineAction, tier: BotTier): number {
  if (tier === "novice" || move.type !== "move") return 0;

  const from = state.positions[seat];
  const opponentPos = state.positions[otherSeat(seat)];
  const to =
    move.moveKind === "slide" ? resolveSlide(from, move.dr, move.dc, opponentPos) : { row: from.row + move.dr, col: from.col + move.dc };
  if (!to) return -1e6; // structurally unreachable — getValidMoves only ever offers legal moves

  if (positionsEqual(to, OASIS)) return 1e5; // immediate win

  const nearest = Math.max(Math.abs(OASIS.row - to.row), Math.abs(OASIS.col - to.col));
  let score = -nearest * 10;

  if (tier === "expert") {
    score += countBlockedLanes(from, to, opponentPos) * 5;
  }
  return score;
}

export function chooseBotAction(
  state: MalDalliJaState,
  seat: Seat,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
