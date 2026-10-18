/**
 * Chess rules core — move generation, legality, make/unmake, SAN.
 * Implements boardGameRule/체스/체스.md §3~§9 (FIDE Laws of Chess).
 *
 * Kept free of the room/engine state shape so the AI search (ai.ts) can run
 * millions of make/unmake calls on one mutable `Pos` without allocating a
 * new state per node. engine.ts converts its JSON state to a `Pos` and back.
 *
 * Squares: 0 = a1, 7 = h1, 56 = a8, 63 = h8 (file = sq & 7, rank = sq >> 3).
 * Pieces: 0 empty, white 1..6 (P N B R Q K), black 9..14 (8 | type).
 * Moves are packed ints: from | to << 6 | promo << 12 | flag << 15.
 */

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const WHITE = 0;
export const BLACK = 1;

export const FLAG_NORMAL = 0;
export const FLAG_DOUBLE = 1;
export const FLAG_EP = 2;
export const FLAG_CASTLE_K = 3;
export const FLAG_CASTLE_Q = 4;

/** Castling rights bits. */
export const WK = 1;
export const WQ = 2;
export const BK = 4;
export const BQ = 8;

export interface Pos {
  b: number[];
  turn: number;
  castling: number;
  /** En passant target square (the square the double-pushed pawn skipped), or -1. */
  ep: number;
  /** Half-moves since the last pawn move or capture (50-move rule, §11). */
  half: number;
  full: number;
  /** King squares [white, black]. */
  k: [number, number];
  /** Zobrist hash halves (search transposition table / repetition). */
  h1: number;
  h2: number;
}

export interface Undo {
  m: number;
  captured: number;
  capSq: number;
  castling: number;
  ep: number;
  half: number;
  h1: number;
  h2: number;
}

export const colorOf = (p: number) => p >> 3;
export const typeOf = (p: number) => p & 7;
export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const mFrom = (m: number) => m & 63;
export const mTo = (m: number) => (m >> 6) & 63;
export const mPromo = (m: number) => (m >> 12) & 7;
export const mFlag = (m: number) => (m >> 15) & 7;
export const encodeMove = (from: number, to: number, promo = 0, flag = 0) => from | (to << 6) | (promo << 12) | (flag << 15);

/* ── Precomputed tables ─────────────────────────────────────────────────── */

function targets(deltas: [number, number][]): number[][] {
  const out: number[][] = [];
  for (let sq = 0; sq < 64; sq++) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    const list: number[] = [];
    for (const [df, dr] of deltas) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) list.push(nr * 8 + nf);
    }
    out.push(list);
  }
  return out;
}

export const KNIGHT_TARGETS = targets([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]);
export const KING_TARGETS = targets([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);

/** 0..3 orthogonal (N S E W), 4..7 diagonal (NE NW SE SW). RAYS[dir][sq] lists squares outward. */
const DIRS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
export const RAYS: number[][][] = DIRS.map(([df, dr]) => {
  const perSq: number[][] = [];
  for (let sq = 0; sq < 64; sq++) {
    const list: number[] = [];
    let f = fileOf(sq) + df;
    let r = rankOf(sq) + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      list.push(r * 8 + f);
      f += df;
      r += dr;
    }
    perSq.push(list);
  }
  return perSq;
});

/** Castling rights kept after a move touches a square (king/rook start squares). */
const CASTLE_MASK: number[] = Array.from({ length: 64 }, () => 15);
CASTLE_MASK[4] = 15 & ~(WK | WQ);
CASTLE_MASK[7] = 15 & ~WK;
CASTLE_MASK[0] = 15 & ~WQ;
CASTLE_MASK[60] = 15 & ~(BK | BQ);
CASTLE_MASK[63] = 15 & ~BK;
CASTLE_MASK[56] = 15 & ~BQ;

/* ── Zobrist (fixed-seed xorshift so every client/worker gets the same keys) ─ */

function xorshift(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}
const zr = xorshift(0x9e3779b9);
const Z1_PIECE = Array.from({ length: 16 * 64 }, () => zr());
const Z2_PIECE = Array.from({ length: 16 * 64 }, () => zr());
const Z1_TURN = zr();
const Z2_TURN = zr();
const Z1_CASTLE = Array.from({ length: 16 }, () => zr());
const Z2_CASTLE = Array.from({ length: 16 }, () => zr());
const Z1_EP = Array.from({ length: 8 }, () => zr());
const Z2_EP = Array.from({ length: 8 }, () => zr());

export function computeHash(pos: Pos): void {
  let h1 = 0;
  let h2 = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.b[sq];
    if (p) {
      h1 ^= Z1_PIECE[p * 64 + sq];
      h2 ^= Z2_PIECE[p * 64 + sq];
    }
  }
  if (pos.turn === BLACK) {
    h1 ^= Z1_TURN;
    h2 ^= Z2_TURN;
  }
  h1 ^= Z1_CASTLE[pos.castling];
  h2 ^= Z2_CASTLE[pos.castling];
  if (pos.ep >= 0) {
    h1 ^= Z1_EP[fileOf(pos.ep)];
    h2 ^= Z2_EP[fileOf(pos.ep)];
  }
  pos.h1 = h1 >>> 0;
  pos.h2 = h2 >>> 0;
}

/** One number for Map keys — 32 bits of h1 and 21 bits of h2 (stays inside the 53-bit safe range). */
export const hashKey = (pos: Pos) => pos.h1 * 2097152 + (pos.h2 & 0x1fffff);

/* ── Board text (engine state) ↔ Pos ────────────────────────────────────── */

const CHAR_OF: Record<number, string> = { 1: "P", 2: "N", 3: "B", 4: "R", 5: "Q", 6: "K", 9: "p", 10: "n", 11: "b", 12: "r", 13: "q", 14: "k" };
const PIECE_OF: Record<string, number> = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, p: 9, n: 10, b: 11, r: 12, q: 13, k: 14 };

export const pieceChar = (p: number) => CHAR_OF[p] ?? ".";
export const pieceFromChar = (c: string) => PIECE_OF[c] ?? 0;

/** 64-char board string, index 0 = a1. */
export const START_BOARD =
  "RNBQKBNR" + "PPPPPPPP" + "........" + "........" + "........" + "........" + "pppppppp" + "rnbqkbnr";

export function makePos(board: string, turn: number, castling: number, ep: number, half: number, full: number): Pos {
  const b = new Array<number>(64);
  const k: [number, number] = [-1, -1];
  for (let i = 0; i < 64; i++) {
    const p = pieceFromChar(board[i]);
    b[i] = p;
    if (p === KING) k[0] = i;
    else if (p === (8 | KING)) k[1] = i;
  }
  const pos: Pos = { b, turn, castling, ep, half, full, k, h1: 0, h2: 0 };
  computeHash(pos);
  return pos;
}

/** FEN → Pos (tests and custom positions). */
export function parseFen(fen: string): Pos {
  const [placement, side = "w", castle = "-", ep = "-", half = "0", full = "1"] = fen.trim().split(/\s+/);
  const rows = placement.split("/");
  const chars = new Array<string>(64).fill(".");
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else chars[rank * 8 + file++] = ch;
    }
  });
  let rights = 0;
  if (castle.includes("K")) rights |= WK;
  if (castle.includes("Q")) rights |= WQ;
  if (castle.includes("k")) rights |= BK;
  if (castle.includes("q")) rights |= BQ;
  return makePos(chars.join(""), side === "b" ? BLACK : WHITE, rights, ep === "-" ? -1 : parseSq(ep), Number(half), Number(full));
}

export function toFen(pos: Pos): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.b[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += pieceChar(p);
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const c = pos.castling;
  const castle = (c & WK ? "K" : "") + (c & WQ ? "Q" : "") + (c & BK ? "k" : "") + (c & BQ ? "q" : "") || "-";
  return `${rows.join("/")} ${pos.turn === WHITE ? "w" : "b"} ${castle} ${pos.ep >= 0 ? sqName(pos.ep) : "-"} ${pos.half} ${pos.full}`;
}

export function boardString(pos: Pos): string {
  let s = "";
  for (let i = 0; i < 64; i++) s += pieceChar(pos.b[i]);
  return s;
}

export function clonePos(pos: Pos): Pos {
  return { ...pos, b: pos.b.slice(), k: [pos.k[0], pos.k[1]] };
}

export const sqName = (sq: number) => "abcdefgh"[fileOf(sq)] + String(rankOf(sq) + 1);
export function parseSq(name: string): number {
  if (name.length !== 2) return -1;
  const f = "abcdefgh".indexOf(name[0]);
  const r = Number(name[1]) - 1;
  if (f < 0 || !(r >= 0 && r < 8)) return -1;
  return r * 8 + f;
}

/* ── Attacks ────────────────────────────────────────────────────────────── */

/** Is `sq` attacked by any piece of color `by`? */
export function isAttacked(b: number[], sq: number, by: number): boolean {
  const f = fileOf(sq);
  if (by === WHITE) {
    if (f > 0 && sq >= 9 && b[sq - 9] === PAWN) return true;
    if (f < 7 && sq >= 7 && b[sq - 7] === PAWN) return true;
  } else {
    if (f > 0 && sq + 7 < 64 && b[sq + 7] === (8 | PAWN)) return true;
    if (f < 7 && sq + 9 < 64 && b[sq + 9] === (8 | PAWN)) return true;
  }
  const side = by << 3;
  const kn = side | KNIGHT;
  for (const t of KNIGHT_TARGETS[sq]) if (b[t] === kn) return true;
  const kg = side | KING;
  for (const t of KING_TARGETS[sq]) if (b[t] === kg) return true;
  const rook = side | ROOK;
  const bishop = side | BISHOP;
  const queen = side | QUEEN;
  for (let d = 0; d < 8; d++) {
    const ray = RAYS[d][sq];
    for (let i = 0; i < ray.length; i++) {
      const p = b[ray[i]];
      if (!p) continue;
      if (p === queen || p === (d < 4 ? rook : bishop)) return true;
      break;
    }
  }
  return false;
}

/** Squares of every `by` piece attacking `sq` (check lines for the FX, §17). */
export function attackersOf(b: number[], sq: number, by: number): number[] {
  const out: number[] = [];
  const f = fileOf(sq);
  if (by === WHITE) {
    if (f > 0 && sq >= 9 && b[sq - 9] === PAWN) out.push(sq - 9);
    if (f < 7 && sq >= 7 && b[sq - 7] === PAWN) out.push(sq - 7);
  } else {
    if (f > 0 && sq + 7 < 64 && b[sq + 7] === (8 | PAWN)) out.push(sq + 7);
    if (f < 7 && sq + 9 < 64 && b[sq + 9] === (8 | PAWN)) out.push(sq + 9);
  }
  const side = by << 3;
  for (const t of KNIGHT_TARGETS[sq]) if (b[t] === (side | KNIGHT)) out.push(t);
  for (const t of KING_TARGETS[sq]) if (b[t] === (side | KING)) out.push(t);
  for (let d = 0; d < 8; d++) {
    for (const t of RAYS[d][sq]) {
      const p = b[t];
      if (!p) continue;
      if (p === (side | QUEEN) || p === (side | (d < 4 ? ROOK : BISHOP))) out.push(t);
      break;
    }
  }
  return out;
}

export const inCheck = (pos: Pos) => isAttacked(pos.b, pos.k[pos.turn], pos.turn ^ 1);

/* ── Move generation ────────────────────────────────────────────────────── */

function pushPawnMove(moves: number[], from: number, to: number, promoRank: boolean, flag: number) {
  if (promoRank) {
    moves.push(encodeMove(from, to, QUEEN, flag), encodeMove(from, to, KNIGHT, flag), encodeMove(from, to, ROOK, flag), encodeMove(from, to, BISHOP, flag));
  } else {
    moves.push(encodeMove(from, to, 0, flag));
  }
}

/** Pseudo-legal moves (may leave the mover's king in check). `capturesOnly` for quiescence search. */
export function genPseudo(pos: Pos, moves: number[], capturesOnly = false): void {
  const b = pos.b;
  const us = pos.turn;
  const them = us ^ 1;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || colorOf(p) !== us) continue;
    const t = typeOf(p);
    if (t === PAWN) {
      const dir = us === WHITE ? 8 : -8;
      const r = rankOf(sq);
      const f = fileOf(sq);
      const lastRank = us === WHITE ? 6 : 1; // pawn on this rank promotes when it moves
      const promo = r === lastRank;
      const one = sq + dir;
      if (!b[one] && (!capturesOnly || promo)) {
        pushPawnMove(moves, sq, one, promo, FLAG_NORMAL);
        if (!capturesOnly && r === (us === WHITE ? 1 : 6) && !b[one + dir]) moves.push(encodeMove(sq, one + dir, 0, FLAG_DOUBLE));
      }
      if (f > 0) {
        const c = one - 1;
        if (b[c] && colorOf(b[c]) === them) pushPawnMove(moves, sq, c, promo, FLAG_NORMAL);
        else if (c === pos.ep) moves.push(encodeMove(sq, c, 0, FLAG_EP));
      }
      if (f < 7) {
        const c = one + 1;
        if (b[c] && colorOf(b[c]) === them) pushPawnMove(moves, sq, c, promo, FLAG_NORMAL);
        else if (c === pos.ep) moves.push(encodeMove(sq, c, 0, FLAG_EP));
      }
    } else if (t === KNIGHT || t === KING) {
      const list = t === KNIGHT ? KNIGHT_TARGETS[sq] : KING_TARGETS[sq];
      for (const to of list) {
        const q = b[to];
        if (q ? colorOf(q) === them : !capturesOnly) moves.push(encodeMove(sq, to));
      }
      if (t === KING && !capturesOnly) genCastles(pos, sq, moves);
    } else {
      const d0 = t === BISHOP ? 4 : 0;
      const d1 = t === ROOK ? 4 : 8;
      for (let d = d0; d < d1; d++) {
        const ray = RAYS[d][sq];
        for (let i = 0; i < ray.length; i++) {
          const to = ray[i];
          const q = b[to];
          if (!q) {
            if (!capturesOnly) moves.push(encodeMove(sq, to));
            continue;
          }
          if (colorOf(q) === them) moves.push(encodeMove(sq, to));
          break;
        }
      }
    }
  }
}

/** §6: king and rook unmoved, squares between empty, king not in / through / into check. */
function genCastles(pos: Pos, sq: number, moves: number[]) {
  const b = pos.b;
  if (pos.turn === WHITE) {
    if (sq !== 4) return;
    if (pos.castling & WK && !b[5] && !b[6] && b[7] === ROOK && !isAttacked(b, 4, BLACK) && !isAttacked(b, 5, BLACK) && !isAttacked(b, 6, BLACK)) {
      moves.push(encodeMove(4, 6, 0, FLAG_CASTLE_K));
    }
    if (pos.castling & WQ && !b[3] && !b[2] && !b[1] && b[0] === ROOK && !isAttacked(b, 4, BLACK) && !isAttacked(b, 3, BLACK) && !isAttacked(b, 2, BLACK)) {
      moves.push(encodeMove(4, 2, 0, FLAG_CASTLE_Q));
    }
  } else {
    if (sq !== 60) return;
    if (pos.castling & BK && !b[61] && !b[62] && b[63] === (8 | ROOK) && !isAttacked(b, 60, WHITE) && !isAttacked(b, 61, WHITE) && !isAttacked(b, 62, WHITE)) {
      moves.push(encodeMove(60, 62, 0, FLAG_CASTLE_K));
    }
    if (pos.castling & BQ && !b[59] && !b[58] && !b[57] && b[56] === (8 | ROOK) && !isAttacked(b, 60, WHITE) && !isAttacked(b, 59, WHITE) && !isAttacked(b, 58, WHITE)) {
      moves.push(encodeMove(60, 58, 0, FLAG_CASTLE_Q));
    }
  }
}

/* ── Make / unmake ──────────────────────────────────────────────────────── */

function zPiece(pos: Pos, p: number, sq: number) {
  pos.h1 = (pos.h1 ^ Z1_PIECE[p * 64 + sq]) >>> 0;
  pos.h2 = (pos.h2 ^ Z2_PIECE[p * 64 + sq]) >>> 0;
}

export function makeMove(pos: Pos, m: number): Undo {
  const b = pos.b;
  const from = mFrom(m);
  const to = mTo(m);
  const flag = mFlag(m);
  const promo = mPromo(m);
  const p = b[from];
  const us = pos.turn;
  const capSq = flag === FLAG_EP ? (us === WHITE ? to - 8 : to + 8) : to;
  const captured = b[capSq];
  const undo: Undo = { m, captured, capSq, castling: pos.castling, ep: pos.ep, half: pos.half, h1: pos.h1, h2: pos.h2 };

  if (captured) {
    zPiece(pos, captured, capSq);
    b[capSq] = 0;
  }
  zPiece(pos, p, from);
  b[from] = 0;
  const placed = promo ? (us << 3) | promo : p;
  b[to] = placed;
  zPiece(pos, placed, to);

  if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
    const rFrom = flag === FLAG_CASTLE_K ? to + 1 : to - 2;
    const rTo = flag === FLAG_CASTLE_K ? to - 1 : to + 1;
    const rook = b[rFrom];
    zPiece(pos, rook, rFrom);
    b[rFrom] = 0;
    b[rTo] = rook;
    zPiece(pos, rook, rTo);
  }
  if (typeOf(p) === KING) pos.k[us] = to;

  pos.h1 = (pos.h1 ^ Z1_CASTLE[pos.castling]) >>> 0;
  pos.h2 = (pos.h2 ^ Z2_CASTLE[pos.castling]) >>> 0;
  pos.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
  pos.h1 = (pos.h1 ^ Z1_CASTLE[pos.castling]) >>> 0;
  pos.h2 = (pos.h2 ^ Z2_CASTLE[pos.castling]) >>> 0;

  if (pos.ep >= 0) {
    pos.h1 = (pos.h1 ^ Z1_EP[fileOf(pos.ep)]) >>> 0;
    pos.h2 = (pos.h2 ^ Z2_EP[fileOf(pos.ep)]) >>> 0;
  }
  pos.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
  if (pos.ep >= 0) {
    pos.h1 = (pos.h1 ^ Z1_EP[fileOf(pos.ep)]) >>> 0;
    pos.h2 = (pos.h2 ^ Z2_EP[fileOf(pos.ep)]) >>> 0;
  }

  pos.half = typeOf(p) === PAWN || captured ? 0 : pos.half + 1;
  if (us === BLACK) pos.full += 1;
  pos.turn = us ^ 1;
  pos.h1 = (pos.h1 ^ Z1_TURN) >>> 0;
  pos.h2 = (pos.h2 ^ Z2_TURN) >>> 0;
  return undo;
}

export function unmakeMove(pos: Pos, u: Undo): void {
  const b = pos.b;
  const m = u.m;
  const from = mFrom(m);
  const to = mTo(m);
  const flag = mFlag(m);
  const promo = mPromo(m);
  pos.turn ^= 1;
  const us = pos.turn;
  if (us === BLACK) pos.full -= 1;
  const moved = b[to];
  b[from] = promo ? (us << 3) | PAWN : moved;
  b[to] = 0;
  if (u.captured) b[u.capSq] = u.captured;
  if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
    const rFrom = flag === FLAG_CASTLE_K ? to + 1 : to - 2;
    const rTo = flag === FLAG_CASTLE_K ? to - 1 : to + 1;
    b[rFrom] = b[rTo];
    b[rTo] = 0;
  }
  if (typeOf(b[from]) === KING) pos.k[us] = from;
  pos.castling = u.castling;
  pos.ep = u.ep;
  pos.half = u.half;
  pos.h1 = u.h1;
  pos.h2 = u.h2;
}

/** All legal moves for the side to move (§9 — never leaves own king attacked). */
export function legalMoves(pos: Pos): number[] {
  const pseudo: number[] = [];
  genPseudo(pos, pseudo);
  const out: number[] = [];
  const us = pos.turn;
  for (const m of pseudo) {
    const u = makeMove(pos, m);
    if (!isAttacked(pos.b, pos.k[us], us ^ 1)) out.push(m);
    unmakeMove(pos, u);
  }
  return out;
}

export function hasLegalMove(pos: Pos): boolean {
  const pseudo: number[] = [];
  genPseudo(pos, pseudo);
  const us = pos.turn;
  for (const m of pseudo) {
    const u = makeMove(pos, m);
    const ok = !isAttacked(pos.b, pos.k[us], us ^ 1);
    unmakeMove(pos, u);
    if (ok) return true;
  }
  return false;
}

/* ── Draw helpers (§11) ─────────────────────────────────────────────────── */

/**
 * §11 기물 부족: K v K, K+minor v K, or only bishops beyond the kings with
 * all of them on the same square colour.
 */
export function insufficientMaterial(b: number[]): boolean {
  let minors = 0;
  let knights = 0;
  let lightB = 0;
  let darkB = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p) continue;
    const t = typeOf(p);
    if (t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors++;
    if (t === KNIGHT) knights++;
    else if ((fileOf(sq) + rankOf(sq)) % 2 === 1) lightB++;
    else darkB++;
  }
  if (minors <= 1) return true;
  return knights === 0 && (lightB === 0 || darkB === 0);
}

/** §12.4: can `color` never mate (bare king, or king + exactly one minor)? */
export function cannotMate(b: number[], color: number): boolean {
  let minors = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || colorOf(p) !== color) continue;
    const t = typeOf(p);
    if (t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors++;
  }
  return minors <= 1;
}

/**
 * Repetition key (§11 3회 반복): placement + side + castling rights + the en
 * passant square only when an en passant capture is actually legal (FIDE 9.2.3).
 */
export function repetitionKey(pos: Pos): string {
  let ep = "-";
  if (pos.ep >= 0) {
    const legal = legalMoves(pos);
    if (legal.some((m) => mFlag(m) === FLAG_EP)) ep = sqName(pos.ep);
  }
  return `${boardString(pos)}|${pos.turn}|${pos.castling}|${ep}`;
}

/* ── Notation ───────────────────────────────────────────────────────────── */

const SAN_LETTER = ["", "", "N", "B", "R", "Q", "K"];
const PROMO_LETTER = ["", "", "n", "b", "r", "q", ""];

export function moveToUci(m: number): string {
  const promo = mPromo(m);
  return sqName(mFrom(m)) + sqName(mTo(m)) + (promo ? PROMO_LETTER[promo] : "");
}

/** The legal move matching a UCI string ("e2e4", "e7e8q"), or null. */
export function findUci(legal: number[], uci: string): number | null {
  for (const m of legal) if (moveToUci(m) === uci) return m;
  return null;
}

/** §14 SAN for `m` (must be legal in `pos`); `legal` = legalMoves(pos). Leaves `pos` unchanged. */
export function moveToSan(pos: Pos, m: number, legal: number[]): string {
  const from = mFrom(m);
  const to = mTo(m);
  const flag = mFlag(m);
  const promo = mPromo(m);
  const p = pos.b[from];
  const t = typeOf(p);
  let san: string;
  if (flag === FLAG_CASTLE_K) san = "O-O";
  else if (flag === FLAG_CASTLE_Q) san = "O-O-O";
  else {
    const capture = flag === FLAG_EP || pos.b[to] !== 0;
    if (t === PAWN) {
      san = (capture ? "abcdefgh"[fileOf(from)] + "x" : "") + sqName(to);
      if (promo) san += "=" + SAN_LETTER[promo];
    } else {
      san = SAN_LETTER[t];
      const rivals = legal.filter((o) => o !== m && mTo(o) === to && mFrom(o) !== from && pos.b[mFrom(o)] === p);
      if (rivals.length > 0) {
        const sameFile = rivals.some((o) => fileOf(mFrom(o)) === fileOf(from));
        const sameRank = rivals.some((o) => rankOf(mFrom(o)) === rankOf(from));
        if (!sameFile) san += "abcdefgh"[fileOf(from)];
        else if (!sameRank) san += String(rankOf(from) + 1);
        else san += sqName(from);
      }
      san += (capture ? "x" : "") + sqName(to);
    }
  }
  const u = makeMove(pos, m);
  if (inCheck(pos)) san += hasLegalMove(pos) ? "+" : "#";
  unmakeMove(pos, u);
  return san;
}
