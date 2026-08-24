/**
 * Pure "말달리자" (넷플릭스 예능 <데스게임>) rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/말달리자/말달리자.md` ("단판 승부 정식 규칙서") for
 * the core movement rules (§3/§4), overridden below where a real board image
 * (`boardGameRule/말달리자/말달리자판.png`) contradicts the rulebook's own
 * "1 horse per player" setup text — see the timeline below.
 *
 * **2026-08-10 session**: original implementation, resolved rulebook-vs-task
 * conflict via `AskUserQuestion` in favor of the rulebook verbatim — 1 horse
 * per seat, slide-or-knight movement, first to land exactly on the center
 * "오아시스" (F6) square wins.
 *
 * **2026-08-11 session**: direct instruction to redesign as 10 horses per
 * seat across two diagonal corner zones, with the oasis removed in favor of
 * "reach the opponent's corner" as the win condition.
 *
 * **2026-08-13/14 session (earlier today)**: a follow-up request asked to
 * restore the oasis using coordinates from an attached board image, but no
 * image was actually present in that request — confirmed via
 * `AskUserQuestion` and reverted all the way back to the 2026-08-10 shape
 * (1 horse/seat, single-cell oasis), plus added a new oasis-adjacent
 * knight-move house rule scoped to just the single oasis cell.
 *
 * **2026-08-14 session (this one, later the same day)** — this reverses the
 * revert above, this time with the reference image actually in hand
 * (`말달리자판.png`, pixel-analyzed for exact coordinates). Confirmed via
 * `AskUserQuestion` given this flips a decision made only hours earlier in
 * the same session: (1) fully replace the 1-horse/single-oasis-cell engine
 * with the image's 4-corner/10-horse-per-seat design (this *does* contradict
 * the rulebook's literal "말: 플레이어당 각 1개" text — the image is treated
 * as a newer, more authoritative house-rule reference for setup/board only,
 * §3's movement rules are otherwise unchanged), and (2) the win condition —
 * left undefined by both the rulebook and the image — is "any one of your 10
 * horses lands exactly on the oasis center cell", the closest analogue to
 * the rulebook's original oasis-win condition.
 *
 * Pixel-measured from `말달리자판.png` (11×11 grid, confirmed against the
 * rulebook's own "11×11" text):
 * - **4 corners, 5 horses each, L-shaped**: 3 cells along one edge from the
 *   corner vertex + 2 more along the perpendicular edge (`cornerZone` below).
 *   White occupies the (0,0) and (10,10) corners (main diagonal); black
 *   occupies the (0,10) and (10,0) corners (anti-diagonal) — each side owns
 *   both ends of one diagonal, never split across a diagonal.
 * - **Oasis zone, a Manhattan-distance-2 diamond centered on (5,5)**: the
 *   center cell alone renders blue (`OASIS`), the surrounding 12 cells
 *   (distance 1–2) render green (`OASIS_ZONE_CELLS` minus `OASIS`) — 13
 *   cells total (1+3+5+3+1 per row offset -2..2).
 *
 * **New 2026-08-14 house rule — oasis-zone-wide L자(나이트) 이동 제약**: not in
 * the rulebook (§3 has no oasis carve-out at all; §6 even recommends using
 * knight moves near the oasis). Broader than the single-cell version this
 * session replaces: a knight move is illegal if the moving horse's current
 * cell, its landing cell, or either "elbow" cell of its L-shaped path (the
 * two ways to decompose 2-then-1 vs 1-then-2) falls inside the 13-cell oasis
 * zone (blue or green) — i.e. once a horse is *on* the zone, or would
 * enter/pass through it via an L-move, only slide moves remain available.
 * Slide moves are completely unaffected — sliding onto the oasis center
 * still wins per §4, sliding through/onto the green ring is just a normal
 * stop, and sliding past the center still doesn't win.
 *
 * **2026-08-25 session — oasis-zone knight restriction relieved to
 * landing-only**: a bug report (`이동하지못하는 앞왼쪽.png`) showed a horse
 * already sitting in/near the oasis zone couldn't knight-jump back *out* of
 * it at all, and a horse elsewhere on the board could have an otherwise-legal
 * jump refused just because one of its two possible L-shape "elbow"
 * decompositions happened to graze the zone — both stricter than the
 * rulebook ever asked for (§4's own oasis-landing rule only ever cares about
 * the *destination*). Confirmed via `AskUserQuestion` (Strict No-Assumption
 * Rule in the request) in favor of relief over full removal: the
 * `from`-cell and both elbow-cell checks are dropped entirely, leaving only
 * "a knight move that *lands* inside the 13-cell zone is illegal" — slide
 * remains the only way to enter or win on the zone, but a horse already
 * there (or merely passing near it mid-arc) can now freely knight-jump
 * anywhere else on the board.
 *
 * **2026-08-16 session — 4방향 직교 슬라이드 하우스 룰**: a bug report claimed
 * diagonal slide movement was a bug. It isn't — 말달리자.md §3 "이동 방식 1"
 * explicitly specifies "상, 하, 좌, 우 및 4개 대각선 방향 (총 8방향)". Surfaced
 * this to the user via `AskUserQuestion` given it contradicts the rulebook
 * text this engine cites as its source of truth (and multiple earlier
 * sessions' confirmed design, see the timeline above); the user confirmed
 * they want a new house rule anyway: slide moves restricted to just the 4
 * orthogonal directions (diagonal slide offsets removed from
 * `SLIDE_DIRECTIONS` entirely), rulebook doc updated to match. L자(나이트)
 * moves (§3 "이동 방식 2") are explicitly unaffected — confirmed kept as-is,
 * including the oasis-zone knight restriction above.
 *
 * **2026-08-17 session — diagonal-slide bug report, still recurring**: a new
 * bug report showed diagonal slide movement still happening in production.
 * Investigation found the 2026-08-16 fix above was real and correct in this
 * branch, but `main` never merged it (`8d430d7` is not an ancestor of
 * `main` — confirmed via `git merge-base --is-ancestor`) and every session
 * since has withheld prod promotion pending that merge (see HANDOFF.md), so
 * production was still running the pre-fix 8-direction `SLIDE_DIRECTIONS`.
 * Surfaced via `AskUserQuestion` whether "diagonal" meant the L자(나이트)
 * jump or bishop-style continuous diagonal sliding — user confirmed the
 * latter (knight L자 movement itself is fine and must stay) and asked for it
 * to be fully eliminated. Since `SLIDE_DIRECTIONS` was already orthogonal-only
 * here, this session's actual change is defense-in-depth: `resolveSlide` and
 * `applyMove` now both refuse a diagonal `(dr, dc)` outright via the new
 * `isOrthogonalStep` guard (scoped to `moveKind: "slide"` only — knight moves
 * are untouched), so even a crafted/corrupted `EngineAction` arriving over
 * the network (see `MalDalliJaGame.tsx`'s broadcast `"game-action"` handler)
 * or a future `SLIDE_DIRECTIONS` regression can't produce a diagonal slide.
 */

import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

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

/** §1 / 말달리자판.png: dead-center cell (rulebook's "F6", 6th row/6th col 1-indexed = index 5). */
export const OASIS: Position = { row: 5, col: 5 };

export function positionsEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function inBounds(p: Position): boolean {
  return p.row >= 0 && p.row < BOARD_SIZE && p.col >= 0 && p.col < BOARD_SIZE;
}

function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

/** Manhattan distance from a cell to the oasis center — the diamond metric measured off `말달리자판.png`. */
function oasisZoneDistance(p: Position): number {
  return Math.abs(p.row - OASIS.row) + Math.abs(p.col - OASIS.col);
}

/** §1 / 말달리자판.png: the 13-cell diamond (center + 2-ring) — blue center + green ring in the UI. */
export const OASIS_ZONE_RADIUS = 2;

export function isOasisZoneCell(p: Position): boolean {
  return oasisZoneDistance(p) <= OASIS_ZONE_RADIUS;
}

/** All 13 oasis-zone cells (1 blue center + 12 green ring), for UI rendering. */
export const OASIS_ZONE_CELLS: Position[] = (() => {
  const cells: Position[] = [];
  for (let dr = -OASIS_ZONE_RADIUS; dr <= OASIS_ZONE_RADIUS; dr++) {
    for (let dc = -OASIS_ZONE_RADIUS; dc <= OASIS_ZONE_RADIUS; dc++) {
      if (Math.abs(dr) + Math.abs(dc) <= OASIS_ZONE_RADIUS) cells.push({ row: OASIS.row + dr, col: OASIS.col + dc });
    }
  }
  return cells;
})();

/** Each seat's 10 horses, split 5-and-5 across its two diagonal corner start zones. */
export const HORSES_PER_ZONE = 5;
export const HORSES_PER_PLAYER = HORSES_PER_ZONE * 2;

/**
 * A 5-cell "corner zone" hugging one literal board corner in an L-shape: 3
 * cells running along one edge from the corner vertex, plus 2 more running
 * along the perpendicular edge from that same vertex — e.g. corner (0,0)
 * yields (0,0),(0,1),(0,2),(1,0),(2,0), pixel-verified against
 * `말달리자판.png`. `rowDir`/`colDir` point *inward* from the corner (e.g.
 * corner (0,0) points +1/+1).
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
 * §1 세팅 (2026-08-14 image-based redesign): each seat's home zones are both
 * ends of one board diagonal — p1 (white) = main diagonal (0,0)+(10,10), p2
 * (black) = anti-diagonal (0,10)+(10,0), pixel-verified against
 * `말달리자판.png`. `HOME_ZONES[seat][0]`/`[1]` are the two 5-cell corner
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

export type MoveKind = "slide" | "knight";

/**
 * The 4 orthogonal slide directions, as unit (dRow, dCol) vectors —
 * up/down/left/right only. §3 "이동 방식 1" in 말달리자.md originally
 * specifies 8 directions (4 orthogonal + 4 diagonal); the 2026-08-16 session
 * house rule (see module doc) removes the 4 diagonal offsets, confirmed with
 * the user after surfacing that the diagonal behavior wasn't actually a bug.
 */
export const SLIDE_DIRECTIONS: readonly [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
];

/** The 8 chess-knight offsets (§3 "이동 방식 2"). */
export const KNIGHT_OFFSETS: readonly [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

/**
 * 2026-08-14 house rule (see module doc), relieved to landing-only on
 * 2026-08-25 — **not** in the rulebook either way. A knight move that
 * *lands* inside the oasis zone (blue center or green ring) is illegal —
 * only slide moves may enter the zone — but the moving horse's own current
 * cell and its L-shaped path's "elbow" cell no longer matter, so a horse
 * already in/near the zone can freely knight-jump back out.
 */
function knightBlockedByOasisZone(to: Position): boolean {
  return isOasisZoneCell(to);
}

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

/**
 * 2026-08-25 fix ("슬라이드이동중 사라진 말과 출발지점에 하얀색말로 바뀐부분"
 * bug report) — a pure guard for `MalDalliJaGame.tsx`'s `state-sync`
 * broadcast handler (the reconnect-recovery round trip: any client sends
 * `state-request` on every channel (re)subscribe, e.g. Supabase Realtime
 * auto-rejoining after a brief network drop mid-game, and any peer with a
 * live `gameState` answers with a full snapshot). That snapshot can race a
 * peer's own just-applied `game-action` broadcast — the two travel as
 * independent messages and can arrive interleaved — so a client could
 * receive a `state-sync` payload captured a moment *before* its own most
 * current state. Blindly accepting it rolls `positions` backward mid-flight:
 * the just-completed move's destination-cell horse disappears (the flying
 * `AnimatedHorse` overlay in `MoveEffects.tsx` was keyed off a `MoveRecord`
 * whose resulting state just got overwritten) and the origin-cell horse
 * reappears once that overlay unmounts and the static grid re-reads the
 * (reverted) position — exactly the reported "evaporating horse" / "ghost
 * horse back at the start cell" symptom.
 *
 * `turnNumber` increments by exactly 1 on every applied action — move *or*
 * pass, see `applyMove`/`applyPass` below — for a match's entire lifetime,
 * so it's a simple monotonic logical clock: a synced state is stale (should
 * be rejected) only when the caller already has a state *and* the synced
 * one's `turnNumber` is strictly behind it. `current === null` (this client
 * hasn't received a state at all yet — the genuine first-time catch-up
 * case) always accepts.
 */
export function isStateSyncStale(current: MalDalliJaState | null, synced: MalDalliJaState): boolean {
  return current !== null && synced.turnNumber < current.turnNumber;
}

/** All 20 currently-occupied cells (both seats), as a lookup set. */
function allOccupied(state: MalDalliJaState): Set<string> {
  const set = new Set<string>();
  for (const seat of ["p1", "p2"] as const) {
    for (const p of state.positions[seat]) set.add(posKey(p));
  }
  return set;
}

/**
 * Orthogonal-step guard for **slide** moves only — `dr`/`dc` must not both be
 * nonzero (a diagonal step). Deliberately *not* applied to knight moves:
 * §3 "이동 방식 2" 나이트(L자) 이동 is defined by offsets where both
 * components are always nonzero (e.g. (±2,±1)) and stays fully allowed, per
 * the 2026-08-17 session's explicit user confirmation (bug report was about
 * *sliding* diagonally like a bishop, not the L자 jump). See `applyMove`'s
 * defensive check below for where this actually blocks bad input.
 */
export function isOrthogonalStep(dr: number, dc: number): boolean {
  return dr === 0 || dc === 0;
}

/**
 * §3 "슬라이드 이동": step in one direction until the next step is blocked by
 * any horse or the edge. **2026-08-17 hardening**: refuses to even enter the
 * loop for a diagonal `(dr, dc)` — redundant with `SLIDE_DIRECTIONS` only
 * ever containing orthogonal vectors since the 2026-08-16 house rule, but
 * this is the actual "슬라이딩 충돌 알고리즘" entry point a future regression
 * (e.g. `SLIDE_DIRECTIONS` accidentally regaining a diagonal entry, as it had
 * before that session) would hit — failing closed here means such a
 * regression can never produce a diagonal slide destination at all, not even
 * one `applyMove`'s lookup would need to catch downstream.
 */
function resolveSlide(from: Position, dr: number, dc: number, occupied: Set<string>): Position | null {
  if (!isOrthogonalStep(dr, dc)) return null;
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
      // §3 "이동 방식 2": lands only on an empty square; any horse may be
      // jumped. Plus the 2026-08-14 house rule (landing-only since 2026-08-25):
      // never lands inside the oasis zone.
      if (inBounds(to) && !occupied.has(posKey(to)) && !knightBlockedByOasisZone(to)) {
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
  // 2026-08-17 hardening: reject a diagonal *slide* before even consulting
  // getLegalMoves — this game's actions travel over the network (Supabase
  // Realtime broadcast from the opponent's own client, see
  // MalDalliJaGame.tsx's "game-action" handler), so a crafted/corrupted
  // action must never reach the legal-move lookup below at all. Scoped to
  // moveKind "slide" only — knight (L자) moves legitimately have both dr/dc
  // nonzero and are unaffected (see isOrthogonalStep's doc).
  if (action.moveKind === "slide" && !isOrthogonalStep(action.dr, action.dc)) return state;

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
  const won = positionsEqual(to, OASIS); // §4 "오아시스 착지" — must land exactly on the center cell

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

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). No information-fairness
// concern here at all — every horse's position is physically visible to
// both players on the shared board, so the bot may freely reason about the
// opponent's horses too (unlike every other game in this project).
// ---------------------------------------------------------------------------

export function getValidMoves(state: MalDalliJaState, seat: Seat): EngineAction[] {
  if (state.phase !== "playing" || state.activeSeat !== seat) return [];
  const moves: EngineAction[] = getLegalMoves(state).map((m) => ({
    type: "move",
    horseIndex: m.horseIndex,
    moveKind: m.moveKind,
    dr: m.dr,
    dc: m.dc,
  }));
  // Structurally near-impossible with 10 horses on a mostly-open 11x11
  // board, but `applyPass` is a legal no-target action the reducer already
  // supports — offer it as a last resort so this never returns [] while a
  // seat is genuinely up.
  return moves.length > 0 ? moves : [{ type: "pass" }];
}

/** How many of `opponentPositions`' currently-open slide lanes get newly shortened by a horse landing at `to` — a fully public-information "블로킹" signal (every horse is visible to both players). */
function countBlockedLanes(before: Set<string>, after: Set<string>, opponentPositions: Position[]): number {
  let count = 0;
  for (const op of opponentPositions) {
    for (const [dr, dc] of SLIDE_DIRECTIONS) {
      const reachBefore = resolveSlide(op, dr, dc, before);
      const reachAfter = resolveSlide(op, dr, dc, after);
      if (reachBefore && (!reachAfter || !positionsEqual(reachBefore, reachAfter))) count++;
    }
  }
  return count;
}

/**
 * Anti-oscillation guard, found via a full-simulation test with 10 horses on
 * the board: a purely greedy, fully-deterministic scorer (expert tier has 0%
 * mistake chance / 0 tie margin, per `botDifficulty.ts`) can get provably
 * stuck forever cycling one horse through an exact repeating loop of knight
 * moves whose net displacement is zero, if every step of that loop happens
 * to be the unique highest-scoring move available each time it comes around
 * — a real soft-lock risk in an actual Level 8-10 vs Level 8-10 match, not
 * just a test artifact. Returns the cells this specific horse has occupied
 * recently (most-recent-first, from `moveHistory`), so `scoreMove` can
 * lightly penalize a candidate that revisits one of them and break the tie
 * in favor of a genuinely new cell whenever one scores comparably.
 */
const OSCILLATION_LOOKBACK = 8;

function recentCellsForHorse(state: MalDalliJaState, seat: Seat, horseIndex: number): Position[] {
  const cells: Position[] = [];
  for (let i = state.moveHistory.length - 1; i >= 0 && cells.length < OSCILLATION_LOOKBACK; i--) {
    const rec = state.moveHistory[i];
    if (rec.seat === seat && rec.horseIndex === horseIndex) cells.push(rec.from);
  }
  return cells;
}

/**
 * Higher = more desirable for the bot. Tiers per ARCHITECTURE.md §7.5:
 * novice ~ uniform over every legal move. core greedily minimizes the moved
 * horse's Chebyshev distance to the oasis center (a rough stand-in for
 * "moves left to win", since a slide can cross several cells at once).
 * expert (Lv.8-10) adds `countBlockedLanes` — how many of the opponent's own
 * slide lanes this move newly shortens — on top of the same distance
 * heuristic. Because this scores each of the seat's 10 horses' candidate
 * moves independently and `chooseBotAction` picks the single best-scoring
 * one, the bot naturally advances whichever horse is currently best placed.
 * Both non-novice tiers also apply the anti-oscillation penalty above.
 */
export function scoreMove(state: MalDalliJaState, seat: Seat, move: EngineAction, tier: BotTier): number {
  if (tier === "novice" || move.type !== "move") return 0;

  const occupied = allOccupied(state);
  const from = state.positions[seat][move.horseIndex];
  const to =
    move.moveKind === "slide" ? resolveSlide(from, move.dr, move.dc, occupied) : { row: from.row + move.dr, col: from.col + move.dc };
  if (!to) return -1e6; // structurally unreachable — getValidMoves only ever offers legal moves

  if (positionsEqual(to, OASIS)) return 1e5; // immediate win

  const nearest = Math.max(Math.abs(OASIS.row - to.row), Math.abs(OASIS.col - to.col));
  let score = -nearest * 10;

  if (tier === "expert") {
    const occupiedAfterMove = new Set(occupied);
    occupiedAfterMove.delete(posKey(from));
    occupiedAfterMove.add(posKey(to));
    score += countBlockedLanes(occupied, occupiedAfterMove, state.positions[otherSeat(seat)]) * 5;
  }

  if (recentCellsForHorse(state, seat, move.horseIndex).some((c) => positionsEqual(c, to))) score -= 15;

  return score;
}

// ---------------------------------------------------------------------------
// Level 8-10 "expert" bot: iterative-deepening alpha-beta minimax.
//
// See shared/bot/alphaBeta.ts's module doc for why the search depth comes
// from a wall-clock budget rather than a hardcoded ply count: 10 horses per
// seat, each with up to 16 candidate moves, makes a fixed depth-8 minimax
// combinatorially infeasible before pruning even gets a chance to help.
// Iterative deepening reaches whatever depth (6-10+ in practice, per the
// budgets below) the time budget allows, always playing the deepest fully-
// searched move.
// ---------------------------------------------------------------------------

import { iterativeDeepeningSearch, type AlphaBetaGame, type SearchBudget } from "@/games/shared/bot/alphaBeta";

function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/** Legal-move count for `seat` regardless of whose turn `state.activeSeat` actually is — `getLegalMoves` only reads `state.positions`/`state.activeSeat`, so a shallow clone with `activeSeat` swapped is a safe read-only probe (no fairness concern for this game — see this section's own module doc: every horse is physically visible to both players already). */
function mobility(state: MalDalliJaState, seat: Seat): number {
  if (state.positions[seat].length === 0) return 0;
  return getLegalMoves({ ...state, activeSeat: seat }).length;
}

/**
 * Static evaluation from `seat`'s POV — higher is better for `seat`. A
 * terminal state scores a large flat win/loss value (dwarfing anything a
 * mid-search cutoff could produce, so the search always prefers a forced win
 * over merely a good position). Otherwise: how much closer `seat`'s nearest
 * horse is to the oasis than the opponent's nearest horse (the single
 * decision-relevant distance, since only one horse needs to actually land
 * there), plus a mobility differential — how many legal moves each side has
 * right now, a standard positional signal that also rewards moves which
 * shrink the opponent's open slide lanes without recomputing per-lane detail
 * (`scoreMove`'s `countBlockedLanes` does that directly for the shallower
 * non-expert tiers; full-depth search gets the same effect "for free" a few
 * plies out from mobility alone).
 */
function evaluateState(state: MalDalliJaState, seat: Seat): number {
  if (state.phase === "gameOver") {
    if (state.winner === seat) return 1_000_000;
    if (state.winner === otherSeat(seat)) return -1_000_000;
    return 0;
  }
  const opp = otherSeat(seat);
  const myDist = Math.min(...state.positions[seat].map((p) => chebyshevDistance(p, OASIS)));
  const oppDist = Math.min(...state.positions[opp].map((p) => chebyshevDistance(p, OASIS)));
  const distanceScore = (oppDist - myDist) * 15;
  const mobilityScore = (mobility(state, seat) - mobility(state, opp)) * 0.5;
  return distanceScore + mobilityScore;
}

/**
 * Distance-only stand-in for `evaluateState`, used just for move ordering
 * (see `AlphaBetaGame.orderingHeuristic`'s doc) — `evaluateState`'s mobility
 * term calls `getLegalMoves` for both seats, and the ordering pass calls
 * this once per candidate at EVERY node, so paying that cost twice per
 * candidate there would let move ordering itself dominate the search's time
 * budget instead of the actual search.
 */
function orderingHeuristic(state: MalDalliJaState, seat: Seat): number {
  if (state.phase === "gameOver") {
    if (state.winner === seat) return 1_000_000;
    if (state.winner === otherSeat(seat)) return -1_000_000;
    return 0;
  }
  const opp = otherSeat(seat);
  const myDist = Math.min(...state.positions[seat].map((p) => chebyshevDistance(p, OASIS)));
  const oppDist = Math.min(...state.positions[opp].map((p) => chebyshevDistance(p, OASIS)));
  return (oppDist - myDist) * 15;
}

const alphaBetaAdapter: AlphaBetaGame<MalDalliJaState, EngineAction> = {
  getMoves: (state) => getValidMoves(state, state.activeSeat),
  applyMove: (state, move) => applyAction(state, move),
  isTerminal: (state) => state.phase === "gameOver",
  activeSeat: (state) => state.activeSeat,
  evaluate: (state, seat) => evaluateState(state, seat as Seat),
  orderingHeuristic: (state, seat) => orderingHeuristic(state, seat as Seat),
};

/** Per-level search budgets — deeper levels get more time, which iterative deepening turns directly into more depth (see module doc). Tunable via `chooseBotAction`'s `opts.alphaBetaBudget` (used by the self-play benchmark to run a much smaller budget so 1,000 games finish quickly). */
const ALPHA_BETA_BUDGETS: Record<number, SearchBudget> = {
  8: { maxDepth: 6, timeBudgetMs: 150 },
  9: { maxDepth: 8, timeBudgetMs: 300 },
  10: { maxDepth: 10, timeBudgetMs: 500 },
};

export function chooseBotAction(
  state: MalDalliJaState,
  seat: Seat,
  level: BotLevel,
  rng: () => number = Math.random,
  opts?: { alphaBetaBudget?: SearchBudget },
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);

  if (tier === "expert") {
    const budget = opts?.alphaBetaBudget ?? ALPHA_BETA_BUDGETS[level] ?? ALPHA_BETA_BUDGETS[10];
    const result = iterativeDeepeningSearch(alphaBetaAdapter, state, seat, budget);
    if (result.move) return result.move;
    // Structurally unreachable (getValidMoves above already confirmed >=1
    // legal move) — kept only so a search-layer bug degrades to the
    // ordinary heuristic instead of stalling a real game.
  }

  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
