/**
 * Chess bot search (rulebook §18). Negamax alpha-beta with a transposition
 * table, quiescence (captures + promotions), null-move pruning, killer /
 * history move ordering, check extension and repetition-as-draw, driven by
 * iterative deepening against a wall-clock budget for Lv.8-10.
 *
 * Why not shared/bot/alphaBeta.ts: that helper clones a JSON state per node
 * (fine for malDalliJa's tiny boards); chess needs make/unmake on one
 * mutable `Pos` to reach a useful depth inside a 0.35-1.6 s budget.
 *
 * Bot timing uses Date.now() — bot decisions are local UX outside the
 * engine's determinism contract (ARCHITECTURE.md §7.1).
 */

import {
  BISHOP,
  BLACK,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  colorOf,
  fileOf,
  genPseudo,
  hashKey,
  inCheck,
  isAttacked,
  makeMove,
  mFlag,
  mFrom,
  mPromo,
  mTo,
  rankOf,
  typeOf,
  unmakeMove,
  FLAG_EP,
  type Pos,
} from "./core";

export const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100000;
const INF = 1000000;

/* Piece-square tables (Michniewski "simplified evaluation"), written rank 8 → rank 1 from white's view. */
// prettier-ignore
const PST_RAW: Record<number, number[]> = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  [KING]: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};
// prettier-ignore
const KING_END_RAW = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

/** PST[piece code][sq] already oriented for that colour (index 0 = a1). */
const PST: number[][] = Array.from({ length: 16 }, () => new Array(64).fill(0));
const KING_END: number[][] = [new Array(64).fill(0), new Array(64).fill(0)];
for (let t = PAWN; t <= KING; t++) {
  for (let sq = 0; sq < 64; sq++) {
    const whiteIdx = (7 - rankOf(sq)) * 8 + fileOf(sq);
    const blackIdx = rankOf(sq) * 8 + fileOf(sq);
    PST[t][sq] = PST_RAW[t][whiteIdx];
    PST[8 | t][sq] = PST_RAW[t][blackIdx];
  }
}
for (let sq = 0; sq < 64; sq++) {
  KING_END[WHITE][sq] = KING_END_RAW[(7 - rankOf(sq)) * 8 + fileOf(sq)];
  KING_END[BLACK][sq] = KING_END_RAW[rankOf(sq) * 8 + fileOf(sq)];
}
const PHASE_W = [0, 0, 1, 1, 2, 4, 0];
const PASSED_BONUS = [0, 5, 10, 20, 35, 60, 100, 0];

const centerDist = (sq: number) => Math.max(3 - fileOf(sq), fileOf(sq) - 4, 0) + Math.max(3 - rankOf(sq), rankOf(sq) - 4, 0);

/** Static evaluation from the side-to-move's point of view (centipawns). */
export function evaluate(pos: Pos): number {
  const b = pos.b;
  let mg = 0;
  let phase = 0;
  const mat = [0, 0];
  const bishops = [0, 0];
  const pawnFiles = [new Array(8).fill(0), new Array(8).fill(0)];
  const pawnSqs: number[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p) continue;
    const t = typeOf(p);
    const c = colorOf(p);
    const sign = c === WHITE ? 1 : -1;
    mat[c] += VALUE[t];
    phase += PHASE_W[t];
    if (t !== KING) mg += sign * (VALUE[t] + PST[p][sq]);
    if (t === BISHOP) bishops[c]++;
    if (t === PAWN) {
      pawnFiles[c][fileOf(sq)]++;
      pawnSqs.push(sq);
    }
  }
  if (phase > 24) phase = 24;
  const eg = 24 - phase;
  // King: middlegame shelter table blended into the active endgame table.
  let score = mg;
  for (const c of [WHITE, BLACK]) {
    const sign = c === WHITE ? 1 : -1;
    const ksq = pos.k[c];
    score += sign * Math.round((PST[(c << 3) | KING][ksq] * phase + KING_END[c][ksq] * eg) / 24);
    if (bishops[c] >= 2) score += sign * 30;
    for (let f = 0; f < 8; f++) {
      const n = pawnFiles[c][f];
      if (n > 1) score -= sign * 12 * (n - 1);
      if (n > 0 && (f === 0 || pawnFiles[c][f - 1] === 0) && (f === 7 || pawnFiles[c][f + 1] === 0)) score -= sign * 12 * n;
    }
  }
  // Passed pawns — no enemy pawn ahead on its own or adjacent files.
  for (const sq of pawnSqs) {
    const c = colorOf(b[sq]);
    const f = fileOf(sq);
    const r = rankOf(sq);
    let passed = true;
    for (let df = -1; df <= 1 && passed; df++) {
      const ff = f + df;
      if (ff < 0 || ff > 7) continue;
      if (c === WHITE) {
        for (let rr = r + 1; rr < 7; rr++) if (b[rr * 8 + ff] === (8 | PAWN)) { passed = false; break; }
      } else {
        for (let rr = r - 1; rr > 0; rr--) if (b[rr * 8 + ff] === PAWN) { passed = false; break; }
      }
    }
    if (!passed) continue;
    const adv = c === WHITE ? r : 7 - r;
    const bonus = Math.round((PASSED_BONUS[adv] * (12 + eg)) / 24);
    score += c === WHITE ? bonus : -bonus;
  }
  // Mop-up: with a clear material edge in the endgame, push the losing king to the edge and walk ours closer (§15.4) — lets shallow searches finish K+Q / K+R mates.
  const diff = mat[WHITE] - mat[BLACK];
  if (phase <= 8 && Math.abs(diff) >= 300) {
    const winner = diff > 0 ? WHITE : BLACK;
    const loserK = pos.k[winner ^ 1];
    const winK = pos.k[winner];
    const kd = Math.abs(fileOf(loserK) - fileOf(winK)) + Math.abs(rankOf(loserK) - rankOf(winK));
    const mop = 12 * centerDist(loserK) + 5 * (14 - kd);
    score += winner === WHITE ? mop : -mop;
  }
  return pos.turn === WHITE ? score : -score;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

class Timeout extends Error {}

interface TTEntry {
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // 0 exact, 1 lower bound, 2 upper bound
  move: number;
}

export class Searcher {
  private tt = new Map<number, TTEntry>();
  private killers: number[][] = Array.from({ length: 128 }, () => [0, 0]);
  private history = new Int32Array(64 * 64);
  private nodes = 0;
  private deadline = Infinity;
  /** Hash keys of the game so far (oldest first) + the current search path. */
  private stack: number[];

  constructor(
    private pos: Pos,
    gameHistory: number[],
  ) {
    this.stack = gameHistory.slice();
  }

  get nodeCount() {
    return this.nodes;
  }

  private isRepetition(): boolean {
    // stack top is the current position; same-side positions sit 2, 4, … plies back.
    const key = hashKey(this.pos);
    for (let i = this.stack.length - 3, n = 2; i >= 0 && n <= this.pos.half; i -= 2, n += 2) {
      if (this.stack[i] === key) return true;
    }
    return false;
  }

  private orderMoves(moves: number[], ply: number, ttMove: number): number[] {
    const b = this.pos.b;
    const scored = moves.map((m) => {
      let s: number;
      if (m === ttMove) s = 10_000_000;
      else {
        const victim = mFlag(m) === FLAG_EP ? PAWN : typeOf(b[mTo(m)]);
        const promo = mPromo(m);
        if (victim || promo) s = 1_000_000 + VALUE[victim] * 10 - VALUE[typeOf(b[mFrom(m)])] / 10 + (promo ? VALUE[promo] : 0);
        else if (m === this.killers[ply][0]) s = 900_000;
        else if (m === this.killers[ply][1]) s = 800_000;
        else s = this.history[mFrom(m) * 64 + mTo(m)];
      }
      return { m, s };
    });
    scored.sort((a, c) => c.s - a.s);
    return scored.map((x) => x.m);
  }

  private tick() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) throw new Timeout();
  }

  private quiesce(alpha: number, beta: number, ply: number): number {
    this.tick();
    const pos = this.pos;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 60) return stand;
    const moves: number[] = [];
    genPseudo(pos, moves, true);
    const us = pos.turn;
    for (const m of this.orderMoves(moves, Math.min(ply, 127), 0)) {
      const u = makeMove(pos, m);
      if (isAttacked(pos.b, pos.k[us], us ^ 1)) {
        unmakeMove(pos, u);
        continue;
      }
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      unmakeMove(pos, u);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private hasNonPawnMaterial(color: number): boolean {
    const b = this.pos.b;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (p && colorOf(p) === color) {
        const t = typeOf(p);
        if (t !== PAWN && t !== KING) return true;
      }
    }
    return false;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number, allowNull = true): number {
    this.tick();
    const pos = this.pos;
    if (ply > 0) {
      if (pos.half >= 100 || this.isRepetition()) return 0;
    }
    const checked = inCheck(pos);
    if (checked) depth += 1;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    const key = hashKey(pos);
    const entry = this.tt.get(key);
    let ttMove = 0;
    if (entry) {
      ttMove = entry.move;
      if (ply > 0 && entry.depth >= depth) {
        let s = entry.score;
        if (s > MATE - 1000) s -= ply;
        else if (s < -MATE + 1000) s += ply;
        if (entry.flag === 0) return s;
        if (entry.flag === 1 && s >= beta) return s;
        if (entry.flag === 2 && s <= alpha) return s;
      }
    }

    // Null move: give the opponent a free move; if we're still above beta, prune.
    if (allowNull && !checked && depth >= 3 && ply > 0 && beta < MATE - 1000 && this.hasNonPawnMaterial(pos.turn)) {
      const savedEp = pos.ep;
      const h1 = pos.h1;
      const h2 = pos.h2;
      pos.turn ^= 1;
      pos.ep = -1;
      pos.h1 = (pos.h1 ^ 0x5bd1e995) >>> 0;
      pos.h2 = (pos.h2 ^ 0x1b873593) >>> 0;
      this.stack.push(hashKey(pos));
      let score: number;
      try {
        score = -this.negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
      } finally {
        this.stack.pop();
        pos.turn ^= 1;
        pos.ep = savedEp;
        pos.h1 = h1;
        pos.h2 = h2;
      }
      if (score >= beta) return beta;
    }

    const moves: number[] = [];
    genPseudo(pos, moves);
    const us = pos.turn;
    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    const alpha0 = alpha;
    for (const m of this.orderMoves(moves, Math.min(ply, 127), ttMove)) {
      const u = makeMove(pos, m);
      if (isAttacked(pos.b, pos.k[us], us ^ 1)) {
        unmakeMove(pos, u);
        continue;
      }
      legal++;
      this.stack.push(hashKey(pos));
      let score: number;
      try {
        if (legal === 1) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
        else {
          score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
          if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
        }
      } finally {
        this.stack.pop();
        unmakeMove(pos, u);
      }
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        const quiet = !u.captured && !mPromo(m);
        if (quiet && ply < 128) {
          const k = this.killers[ply];
          if (k[0] !== m) {
            k[1] = k[0];
            k[0] = m;
          }
          this.history[mFrom(m) * 64 + mTo(m)] += depth * depth;
        }
        break;
      }
    }
    if (legal === 0) return checked ? -MATE + ply : 0;

    let stored = best;
    if (stored > MATE - 1000) stored += ply;
    else if (stored < -MATE + 1000) stored -= ply;
    this.tt.set(key, { depth, score: stored, flag: best <= alpha0 ? 2 : best >= beta ? 1 : 0, move: bestMove });
    if (this.tt.size > 400_000) this.tt.clear();
    return best;
  }

  /**
   * Score of every root move (full window per move) — for the levelled pick.
   * Deepens 1..maxDepth and returns the deepest depth that finished for ALL
   * moves inside `budgetMs`, so a slow position degrades to a shallower but
   * consistent set of scores instead of mixing depths.
   */
  scoreRoot(rootMoves: number[], maxDepth: number, budgetMs = Infinity): { move: number; score: number }[] {
    this.deadline = Date.now() + budgetMs;
    const pos = this.pos;
    let done: { move: number; score: number }[] | null = null;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const out: { move: number; score: number }[] = [];
      try {
        for (const m of rootMoves) {
          const u = makeMove(pos, m);
          this.stack.push(hashKey(pos));
          try {
            out.push({ move: m, score: depth <= 1 ? -this.quiesce(-INF, INF, 1) : -this.negamax(depth - 1, -INF, INF, 1) });
          } finally {
            this.stack.pop();
            unmakeMove(pos, u);
          }
        }
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        break;
      }
      done = out;
    }
    if (done) return done;
    return rootMoves.map((m) => {
      const u = makeMove(pos, m);
      const score = -evaluate(pos);
      unmakeMove(pos, u);
      return { move: m, score };
    });
  }

  /** Iterative deepening to `maxDepth` or until `budgetMs` runs out; best move of the deepest finished iteration. */
  iterate(rootMoves: number[], maxDepth: number, budgetMs: number): { move: number; score: number; depth: number } {
    this.deadline = Date.now() + budgetMs;
    let bestMove = rootMoves[0];
    let bestScore = 0;
    let reached = 0;
    let order = rootMoves.slice();
    const pos = this.pos;
    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -INF;
      let iterBest = order[0];
      const scores = new Map<number, number>();
      try {
        for (const m of order) {
          const u = makeMove(pos, m);
          this.stack.push(hashKey(pos));
          let score: number;
          try {
            if (m === order[0]) score = -this.negamax(depth - 1, -INF, -alpha, 1);
            else {
              score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1);
              if (score > alpha) score = -this.negamax(depth - 1, -INF, -alpha, 1);
            }
          } finally {
            this.stack.pop();
            unmakeMove(pos, u);
          }
          scores.set(m, score);
          if (score > alpha) {
            alpha = score;
            iterBest = m;
          }
        }
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        // A partial iteration that already beat the previous best on its first (= previous best) move is still safe to use.
        if (scores.size > 0 && iterBest !== order[0] && alpha > bestScore) {
          bestMove = iterBest;
          bestScore = alpha;
        }
        break;
      }
      bestMove = iterBest;
      bestScore = alpha;
      reached = depth;
      order = [iterBest, ...order.filter((m) => m !== iterBest).sort((a, c) => (scores.get(c) ?? -INF) - (scores.get(a) ?? -INF))];
      if (Math.abs(bestScore) > MATE - 1000) break; // forced mate found
    }
    return { move: bestMove, score: bestScore, depth: reached };
  }
}

export const isMateScore = (s: number) => Math.abs(s) > MATE - 1000;
