/**
 * 체스 room engine — pure reducer over a JSON state (ARCHITECTURE.md §1).
 * Implements boardGameRule/체스/체스.md; rule mechanics live in core.ts,
 * this file adds the match layer: seats/colours (§2), clocks (§12), game-end
 * detection (§10, §11), draw offers and takebacks (§13), and the bot entry
 * points (§18).
 *
 * Determinism: clock time arrives inside actions (`spentMs`, measured by the
 * sending client from the moment it saw the previous move), so every client
 * replays the same numbers. The bot search uses wall-clock time, but that is
 * local UX outside this contract (ARCHITECTURE.md §7.1).
 */

import { seededRng } from "@/lib/rng";
import { pickByLevel, botTier, clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  BLACK,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_DOUBLE,
  FLAG_EP,
  START_BOARD,
  WHITE,
  attackersOf,
  boardString,
  cannotMate,
  findUci,
  hashKey,
  hasLegalMove,
  inCheck,
  insufficientMaterial,
  legalMoves,
  makeMove,
  makePos,
  mFlag,
  mFrom,
  moveToSan,
  moveToUci,
  mPromo,
  mTo,
  pieceChar,
  repetitionKey,
  sqName,
  type Pos,
} from "./core";
import { Searcher, evaluate, isMateScore } from "./ai";

export type Seat = "p1" | "p2";
export type Color = "w" | "b";
export const SEATS: readonly Seat[] = ["p1", "p2"];
export const otherSeat = (s: Seat): Seat => (s === "p1" ? "p2" : "p1");
export const otherColor = (c: Color): Color => (c === "w" ? "b" : "w");

/* ── Time controls (§12.1) ─────────────────────────────────────────────── */

export interface TimeControl {
  id: string;
  label: string;
  kind: string;
  baseMs: number;
  incMs: number;
}

export const TIME_CONTROLS: readonly TimeControl[] = [
  { id: "none", label: "∞ 무제한", kind: "친선", baseMs: 0, incMs: 0 },
  { id: "1+0", label: "1 + 0", kind: "불릿", baseMs: 60_000, incMs: 0 },
  { id: "3+2", label: "3 + 2", kind: "블리츠", baseMs: 180_000, incMs: 2_000 },
  { id: "5+0", label: "5 + 0", kind: "블리츠", baseMs: 300_000, incMs: 0 },
  { id: "10+0", label: "10 + 0", kind: "래피드", baseMs: 600_000, incMs: 0 },
  { id: "15+10", label: "15 + 10", kind: "래피드", baseMs: 900_000, incMs: 10_000 },
  { id: "30+0", label: "30 + 0", kind: "클래식", baseMs: 1_800_000, incMs: 0 },
];
export const DEFAULT_TIME_CONTROL = "10+0";
export const timeControlById = (id: string) => TIME_CONTROLS.find((t) => t.id === id) ?? TIME_CONTROLS.find((t) => t.id === DEFAULT_TIME_CONTROL)!;

/* ── State ─────────────────────────────────────────────────────────────── */

export type MoveKind = "normal" | "double" | "ep" | "castleK" | "castleQ";

export interface MoveRecord {
  uci: string;
  san: string;
  color: Color;
  from: number;
  to: number;
  /** Piece char that moved ("P", "n", …). */
  piece: string;
  /** Piece char captured, or null. */
  captured: string | null;
  /** Square the captured piece stood on (differs from `to` for en passant). */
  capSq: number | null;
  kind: MoveKind;
  /** Promotion piece char, or null. */
  promo: string | null;
  check: boolean;
  mate: boolean;
  /** Squares giving check after this move (FX check line, §17). */
  checkers: number[];
  spentMs: number;
  /** Mover's clock after the move (increment included), null without a clock. */
  clockAfter: number | null;
}

export interface CorePosition {
  board: string;
  turn: Color;
  castling: number;
  ep: number;
  half: number;
  full: number;
}

export type ResultReason =
  | "checkmate"
  | "resign"
  | "timeout"
  | "stalemate"
  | "insufficient"
  | "threefold"
  | "fifty"
  | "agreement"
  | "timeoutVsInsufficient";

export interface ChessResult {
  winner: Color | null;
  reason: ResultReason;
}

export interface Offer {
  kind: "draw" | "takeback";
  from: Seat;
  /** moves.length when offered. */
  ply: number;
}

export interface OfferUse {
  draw: number;
  takeback: number;
  /** moves.length of this seat's last draw offer (§13.1: one per position). */
  lastDrawPly: number;
}

export interface ChessState {
  phase: "playing" | "gameOver";
  colors: Record<Seat, Color>;
  timeControlId: string;
  /** null = 무제한. */
  clock: { baseMs: number; incMs: number } | null;
  remainingMs: Record<Color, number>;
  start: CorePosition;
  pos: CorePosition;
  moves: MoveRecord[];
  /** §11 repetition counts by `repetitionKey`. */
  repetition: Record<string, number>;
  offer: Offer | null;
  offersUsed: Record<Seat, OfferUse>;
  result: ChessResult | null;
}

export type EngineAction =
  | { type: "move"; seat: Seat; uci: string; spentMs?: number }
  | { type: "resign"; seat: Seat }
  | { type: "offer"; seat: Seat; kind: "draw" | "takeback" }
  | { type: "respond"; seat: Seat; accept: boolean }
  | { type: "flag"; seat: Seat; spentMs: number };

export const MAX_OFFERS = 3;

export interface StartOptions {
  timeControlId?: string;
  /** Host (p1) colour; "random" uses the seed. */
  hostColor?: Color | "random";
}

const toColorNum = (c: Color) => (c === "w" ? WHITE : BLACK);
const fromColorNum = (n: number): Color => (n === WHITE ? "w" : "b");

export function toPos(p: CorePosition): Pos {
  return makePos(p.board, toColorNum(p.turn), p.castling, p.ep, p.half, p.full);
}

function fromPos(pos: Pos): CorePosition {
  return { board: boardString(pos), turn: fromColorNum(pos.turn), castling: pos.castling, ep: pos.ep, half: pos.half, full: pos.full };
}

export const START_POSITION: CorePosition = { board: START_BOARD, turn: "w", castling: 15, ep: -1, half: 0, full: 1 };

export function startGame(seed: number, opts: StartOptions = {}): ChessState {
  const rng = seededRng(seed);
  const hostColor: Color = opts.hostColor === "w" || opts.hostColor === "b" ? opts.hostColor : rng() < 0.5 ? "w" : "b";
  const tc = timeControlById(opts.timeControlId ?? DEFAULT_TIME_CONTROL);
  const startPos = toPos(START_POSITION);
  return {
    phase: "playing",
    colors: { p1: hostColor, p2: otherColor(hostColor) },
    timeControlId: tc.id,
    clock: tc.baseMs > 0 ? { baseMs: tc.baseMs, incMs: tc.incMs } : null,
    remainingMs: { w: tc.baseMs, b: tc.baseMs },
    start: START_POSITION,
    pos: START_POSITION,
    moves: [],
    repetition: { [repetitionKey(startPos)]: 1 },
    offer: null,
    offersUsed: { p1: { draw: 0, takeback: 0, lastDrawPly: -1 }, p2: { draw: 0, takeback: 0, lastDrawPly: -1 } },
    result: null,
  };
}

export const seatOfColor = (state: ChessState, c: Color): Seat => (state.colors.p1 === c ? "p1" : "p2");
export const turnSeat = (state: ChessState): Seat => seatOfColor(state, state.pos.turn);

/** Whose decision blocks the game: the offer's responder while one is pending, else the side to move. */
export function currentActor(state: ChessState): Seat | null {
  if (state.phase !== "playing") return null;
  if (state.offer) return otherSeat(state.offer.from);
  return turnSeat(state);
}

/* ── Applying a move (shared by live play and takeback replay) ─────────── */

const KIND_OF: Record<number, MoveKind> = { 0: "normal", [FLAG_DOUBLE]: "double", [FLAG_EP]: "ep", [FLAG_CASTLE_K]: "castleK", [FLAG_CASTLE_Q]: "castleQ" };

interface Played {
  pos: CorePosition;
  record: Omit<MoveRecord, "spentMs" | "clockAfter">;
  repKey: string;
  /** Position after the move, for end detection. */
  after: Pos;
}

function playMove(core: CorePosition, uci: string): Played | null {
  const pos = toPos(core);
  const legal = legalMoves(pos);
  const m = findUci(legal, uci);
  if (m === null) return null;
  const san = moveToSan(pos, m, legal);
  const from = mFrom(m);
  const to = mTo(m);
  const flag = mFlag(m);
  const color = fromColorNum(pos.turn);
  const piece = pieceChar(pos.b[from]);
  const capSq = flag === FLAG_EP ? (pos.turn === WHITE ? to - 8 : to + 8) : to;
  const capturedCode = pos.b[capSq];
  makeMove(pos, m);
  const check = inCheck(pos);
  const record: Played["record"] = {
    uci,
    san,
    color,
    from,
    to,
    piece,
    captured: capturedCode ? pieceChar(capturedCode) : null,
    capSq: capturedCode ? capSq : null,
    kind: KIND_OF[flag],
    promo: mPromo(m) ? pieceChar((pos.turn ^ 1) << 3 | mPromo(m)) : null,
    check,
    mate: san.endsWith("#"),
    checkers: check ? attackersOf(pos.b, pos.k[pos.turn], pos.turn ^ 1) : [],
  };
  return { pos: fromPos(pos), record, repKey: repetitionKey(pos), after: pos };
}

/** §10/§11 end detection after a move, mate first. */
function detectEnd(after: Pos, repCount: number): ChessResult | null {
  if (!hasLegalMove(after)) {
    return inCheck(after) ? { winner: fromColorNum(after.turn ^ 1), reason: "checkmate" } : { winner: null, reason: "stalemate" };
  }
  if (insufficientMaterial(after.b)) return { winner: null, reason: "insufficient" };
  if (repCount >= 3) return { winner: null, reason: "threefold" };
  if (after.half >= 100) return { winner: null, reason: "fifty" };
  return null;
}

function timeoutResult(state: ChessState, flagged: Color): ChessResult {
  const winner = otherColor(flagged);
  const b = toPos(state.pos).b;
  return cannotMate(b, toColorNum(winner)) ? { winner: null, reason: "timeoutVsInsufficient" } : { winner, reason: "timeout" };
}

/** Rebuild the position after `moves` from `start` (takeback, §13.2). */
function replay(start: CorePosition, moves: MoveRecord[]): { pos: CorePosition; repetition: Record<string, number>; moves: MoveRecord[] } {
  let pos = start;
  const repetition: Record<string, number> = { [repetitionKey(toPos(start))]: 1 };
  const out: MoveRecord[] = [];
  for (const rec of moves) {
    const played = playMove(pos, rec.uci);
    if (!played) break;
    pos = played.pos;
    repetition[played.repKey] = (repetition[played.repKey] ?? 0) + 1;
    out.push(rec);
  }
  return { pos, repetition, moves: out };
}

/* ── Reducer ───────────────────────────────────────────────────────────── */

export function applyAction(state: ChessState, action: EngineAction): ChessState {
  if (state.phase !== "playing") return state;
  const seatColor = state.colors[action.seat];
  if (!seatColor) return state;

  switch (action.type) {
    case "move": {
      if (seatColor !== state.pos.turn) return state;
      const played = playMove(state.pos, action.uci);
      if (!played) return state;
      const mover = state.pos.turn;
      const clocked = state.clock !== null && state.moves.length >= 2; // §12.2 첫 수 면제
      const spent = Math.max(0, Math.round(action.spentMs ?? 0));
      const remainingMs = { ...state.remainingMs };
      let clockAfter: number | null = null;
      if (state.clock) {
        if (clocked) {
          if (spent >= remainingMs[mover]) {
            remainingMs[mover] = 0;
            return { ...state, remainingMs, phase: "gameOver", offer: null, result: timeoutResult(state, mover) };
          }
          remainingMs[mover] = remainingMs[mover] - spent + state.clock.incMs;
        }
        clockAfter = remainingMs[mover];
      }
      const record: MoveRecord = { ...played.record, spentMs: clocked ? spent : 0, clockAfter };
      const repetition = { ...state.repetition, [played.repKey]: (state.repetition[played.repKey] ?? 0) + 1 };
      const result = detectEnd(played.after, repetition[played.repKey]);
      // Draw offers stand until the responder moves; takeback requests die with any move (§13).
      const offer = state.offer && state.offer.kind === "draw" && state.offer.from !== action.seat ? null : state.offer?.kind === "takeback" ? null : state.offer;
      return {
        ...state,
        pos: played.pos,
        moves: [...state.moves, record],
        repetition,
        remainingMs,
        offer: result ? null : offer,
        phase: result ? "gameOver" : "playing",
        result,
      };
    }

    case "resign":
      return { ...state, phase: "gameOver", offer: null, result: { winner: otherColor(seatColor), reason: "resign" } };

    case "flag": {
      if (!state.clock || state.moves.length < 2) return state;
      const flagged = state.pos.turn;
      if (Math.max(0, action.spentMs) < state.remainingMs[flagged]) return state;
      return { ...state, remainingMs: { ...state.remainingMs, [flagged]: 0 }, phase: "gameOver", offer: null, result: timeoutResult(state, flagged) };
    }

    case "offer": {
      if (!canOffer(state, action.seat, action.kind)) return state;
      const used = state.offersUsed[action.seat];
      const nextUse: OfferUse =
        action.kind === "draw" ? { ...used, draw: used.draw + 1, lastDrawPly: state.moves.length } : { ...used, takeback: used.takeback + 1 };
      return {
        ...state,
        offer: { kind: action.kind, from: action.seat, ply: state.moves.length },
        offersUsed: { ...state.offersUsed, [action.seat]: nextUse },
      };
    }

    case "respond": {
      const offer = state.offer;
      if (!offer || offer.from === action.seat) return state;
      if (!action.accept) return { ...state, offer: null };
      if (offer.kind === "draw") return { ...state, offer: null, phase: "gameOver", result: { winner: null, reason: "agreement" } };
      // Takeback: drop everything from the requester's last move on (§13.2).
      const reqColor = state.colors[offer.from];
      let idx = -1;
      for (let i = state.moves.length - 1; i >= 0; i--) {
        if (state.moves[i].color === reqColor) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return { ...state, offer: null };
      const rebuilt = replay(state.start, state.moves.slice(0, idx));
      return { ...state, offer: null, pos: rebuilt.pos, moves: rebuilt.moves, repetition: rebuilt.repetition };
    }
  }
  return state;
}

export function canOffer(state: ChessState, seat: Seat, kind: "draw" | "takeback"): boolean {
  if (state.phase !== "playing" || state.offer) return false;
  const used = state.offersUsed[seat];
  if (kind === "draw") return used.draw < MAX_OFFERS && used.lastDrawPly !== state.moves.length;
  return used.takeback < MAX_OFFERS && state.moves.some((m) => m.color === state.colors[seat]);
}

/* ── Queries for the UI ────────────────────────────────────────────────── */

export interface LegalMoveInfo {
  uci: string;
  from: number;
  to: number;
  promo: string | null;
  kind: MoveKind;
  capture: boolean;
}

/** Legal moves of the side to move in `core` (UI hints / input validation). */
export function legalMoveInfos(core: CorePosition): LegalMoveInfo[] {
  const pos = toPos(core);
  return legalMoves(pos).map((m) => {
    const flag = mFlag(m);
    return {
      uci: moveToUci(m),
      from: mFrom(m),
      to: mTo(m),
      promo: mPromo(m) ? "qnrb"[[5, 2, 4, 3].indexOf(mPromo(m))] : null,
      kind: KIND_OF[flag],
      capture: flag === FLAG_EP || pos.b[mTo(m)] !== 0,
    };
  });
}

/** Squares attacking the side-to-move's king (empty when not in check). */
export function checkersOf(core: CorePosition): number[] {
  const pos = toPos(core);
  return inCheck(pos) ? attackersOf(pos.b, pos.k[pos.turn], pos.turn ^ 1) : [];
}

export function kingSquare(core: CorePosition, c: Color): number {
  return core.board.indexOf(c === "w" ? "K" : "k");
}

/** Positions after each ply, index 0 = start (history browsing, §14). */
export function positionsAfterEach(state: ChessState): CorePosition[] {
  const out: CorePosition[] = [state.start];
  let pos = state.start;
  for (const rec of state.moves) {
    const played = playMove(pos, rec.uci);
    if (!played) break;
    pos = played.pos;
    out.push(pos);
  }
  return out;
}

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Captured piece chars per capturing colour, and the material lead (positive = white ahead). */
export function materialSummary(state: ChessState): { capturedBy: Record<Color, string[]>; whiteLead: number } {
  const capturedBy: Record<Color, string[]> = { w: [], b: [] };
  for (const m of state.moves) if (m.captured) capturedBy[m.color].push(m.captured);
  let lead = 0;
  for (const ch of state.pos.board) {
    if (ch === ".") continue;
    const v = PIECE_VALUE[ch.toLowerCase()] ?? 0;
    lead += ch === ch.toUpperCase() ? v : -v;
  }
  return { capturedBy, whiteLead: lead };
}

export const RESULT_LABEL: Record<ResultReason, string> = {
  checkmate: "체크메이트",
  resign: "기권",
  timeout: "시간 패",
  stalemate: "스테일메이트",
  insufficient: "기물 부족",
  threefold: "3회 반복",
  fifty: "50수 규칙",
  agreement: "합의 무승부",
  timeoutVsInsufficient: "시간 종료 · 상대 기물 부족",
};

export function resultScore(result: ChessResult): string {
  return result.winner === "w" ? "1-0" : result.winner === "b" ? "0-1" : "1/2-1/2";
}

/** §14 PGN text. */
export function toPgn(state: ChessState, names: Record<Seat, string>, date = new Date()): string {
  const white = names[seatOfColor(state, "w")];
  const black = names[seatOfColor(state, "b")];
  const res = state.result ? resultScore(state.result) : "*";
  const d = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  const tags = [
    `[Event "보드게임 체스 온라인 대전"]`,
    `[Site "boardGame"]`,
    `[Date "${d}"]`,
    `[White "${white.replace(/"/g, "'")}"]`,
    `[Black "${black.replace(/"/g, "'")}"]`,
    `[Result "${res}"]`,
    `[TimeControl "${state.clock ? `${state.clock.baseMs / 1000}+${state.clock.incMs / 1000}` : "-"}"]`,
  ];
  if (state.result) tags.push(`[Termination "${RESULT_LABEL[state.result.reason]}"]`);
  const parts: string[] = [];
  state.moves.forEach((m, i) => {
    if (i % 2 === 0) parts.push(`${state.start.full + i / 2}.`);
    parts.push(m.san);
  });
  parts.push(res);
  return `${tags.join("\n")}\n\n${parts.join(" ")}\n`;
}

/* ── Bots (§18, ARCHITECTURE.md §7) ────────────────────────────────────── */

export function getValidMoves(state: ChessState, seat: Seat): EngineAction[] {
  if (state.phase !== "playing") return [];
  if (state.offer) {
    return state.offer.from !== seat ? [{ type: "respond", seat, accept: true }, { type: "respond", seat, accept: false }] : [];
  }
  if (turnSeat(state) !== seat) return [];
  return legalMoveInfos(state.pos).map((m) => ({ type: "move", seat, uci: m.uci }));
}

/** Zobrist keys of every position so far (search repetition detection). */
function gameHashes(state: ChessState): number[] {
  const out: number[] = [];
  let pos = toPos(state.start);
  out.push(hashKey(pos));
  for (const rec of state.moves) {
    const legal = legalMoves(pos);
    const m = findUci(legal, rec.uci);
    if (m === null) break;
    makeMove(pos, m);
    out.push(hashKey(pos));
  }
  pos = toPos(state.pos);
  if (out[out.length - 1] !== hashKey(pos)) out.push(hashKey(pos));
  return out;
}

/** Per-level search settings. depth = plies before quiescence; expert levels use iterative deepening. */
const LEVEL_DEPTH: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4 };
/** Wall-clock cap for the levelled root scoring — keeps every bot move well under useBotAutoplay's 5 s watchdog. */
const LEVEL_BUDGET_MS: Record<number, number> = { 1: 300, 2: 300, 3: 400, 4: 500, 5: 800, 6: 1000, 7: 1400 };
const EXPERT_BUDGET_MS: Record<number, number> = { 8: 350, 9: 800, 10: 1600 };

/** Shift centipawns onto a positive scale so the shared pickByLevel tie margin reads as "within N cp". */
const shifted = (cp: number) => 1000 + Math.max(-999, Math.min(999, cp));

export interface BotOptions {
  /** Overrides the expert time budget (tests / self-play). */
  budgetMs?: number;
}

export function chooseBotAction(state: ChessState, seat: Seat, level: BotLevel = 5, rng: () => number = Math.random, opts: BotOptions = {}): EngineAction | null {
  if (state.phase !== "playing") return null;
  const lv = clampBotLevel(level);
  if (state.offer) {
    if (state.offer.from === seat) return null;
    return { type: "respond", seat, accept: wantsToAccept(state, seat, lv, rng) };
  }
  if (turnSeat(state) !== seat) return null;
  const pos = toPos(state.pos);
  const legal = legalMoves(pos);
  if (legal.length === 0) return null;
  if (legal.length === 1) return { type: "move", seat, uci: moveToUci(legal[0]) };

  // Shuffle so equal-scored moves vary from game to game.
  const roots = legal.slice();
  for (let i = roots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [roots[i], roots[j]] = [roots[j], roots[i]];
  }
  const searcher = new Searcher(pos, gameHashes(state));

  if (botTier(lv) === "expert") {
    // Opening variety (§18): pick among near-best moves for the first few plies.
    if (state.moves.length < 8) {
      const scored = searcher.scoreRoot(roots, 3, 600);
      const best = Math.max(...scored.map((s) => s.score));
      const top = scored.filter((s) => s.score >= best - 15);
      return { type: "move", seat, uci: moveToUci(top[Math.floor(rng() * top.length)].move) };
    }
    const budget = opts.budgetMs ?? EXPERT_BUDGET_MS[lv];
    const res = searcher.iterate(roots, 64, budget);
    return { type: "move", seat, uci: moveToUci(res.move) };
  }

  const scored = searcher.scoreRoot(roots, LEVEL_DEPTH[lv] ?? 2, LEVEL_BUDGET_MS[lv] ?? 800);
  const mateNow = scored.find((s) => isMateScore(s.score) && s.score > 0);
  const pick = mateNow && lv >= 4 ? mateNow.move : pickByLevel(scored.map((s) => ({ move: s.move, score: shifted(s.score) })), lv, rng);
  return { type: "move", seat, uci: moveToUci(pick) };
}

/** §13.3: draws only when not better; takebacks granted by Lv.1-5. */
function wantsToAccept(state: ChessState, seat: Seat, lv: number, rng: () => number): boolean {
  const offer = state.offer!;
  if (offer.kind === "takeback") return lv <= 5;
  if (lv <= 3) return rng() < 0.5;
  const pos = toPos(state.pos);
  const myColor = toColorNum(state.colors[seat]);
  let score: number;
  if (hasLegalMove(pos)) {
    const searcher = new Searcher(pos, gameHashes(state));
    const res = searcher.iterate(legalMoves(pos), 3, 250);
    score = res.score;
  } else score = evaluate(pos);
  const mine = pos.turn === myColor ? score : -score;
  return mine <= 25;
}

/** Square name helper re-export for the UI. */
export { sqName };
