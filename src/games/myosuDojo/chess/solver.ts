/**
 * Mate-in-N search for 묘수 도장 ♟️ (rulebook §2). Full-width, no pruning
 * tricks beyond "stop at the first mating line" — puzzle positions are sparse
 * and N ≤ 3, so plain make/unmake on chess/core.ts is fast enough in the
 * browser and in tests.
 *
 * "mate in n" = the side to move can force checkmate with its n-th move at
 * the latest, whatever the defender does. Stalemate is never a win.
 */

import { hasLegalMove, inCheck, legalMoves, makeMove, unmakeMove, type Pos } from "@/games/chess/core";

export const isMate = (pos: Pos) => inCheck(pos) && !hasLegalMove(pos);

/** Can the side to move force mate within `n` of its own moves? */
export function mateIn(pos: Pos, n: number): boolean {
  if (n <= 0) return false;
  for (const m of legalMoves(pos)) {
    const u = makeMove(pos, m);
    const ok = afterAttack(pos, n);
    unmakeMove(pos, u);
    if (ok) return true;
  }
  return false;
}

/** Defender to move after an attacking move with `n` attacking moves budgeted (that move included). */
function afterAttack(pos: Pos, n: number): boolean {
  const replies = legalMoves(pos);
  if (replies.length === 0) return inCheck(pos);
  if (n <= 1) return false;
  for (const r of replies) {
    const u = makeMove(pos, r);
    const ok = mateIn(pos, n - 1);
    unmakeMove(pos, u);
    if (!ok) return false;
  }
  return true;
}

/** Smallest k ≤ n with mateIn(pos, k), or 0 when there is none. */
export function mateDistance(pos: Pos, n: number): number {
  for (let k = 1; k <= n; k++) if (mateIn(pos, k)) return k;
  return 0;
}

/** Attacking moves that keep a forced mate within `n` (n counts this move). */
export function winningMoves(pos: Pos, n: number): number[] {
  const out: number[] = [];
  for (const m of legalMoves(pos)) {
    const u = makeMove(pos, m);
    if (afterAttack(pos, n)) out.push(m);
    unmakeMove(pos, u);
  }
  return out;
}

/**
 * The defender's reply after the attacker played into this position with
 * `n` attacking moves left (including the next one): a refutation (escape
 * from mate within n) when one exists, otherwise the reply that delays mate
 * the longest. Ties keep generator order, so the same position always
 * defends the same way. Returns null when the defender has no legal move.
 */
export function bestDefence(pos: Pos, n: number): { move: number; refutes: boolean } | null {
  const replies = legalMoves(pos);
  if (replies.length === 0) return null;
  let best = replies[0];
  let bestScore = -1;
  for (const r of replies) {
    const u = makeMove(pos, r);
    const d = n > 0 ? mateDistance(pos, n) : 0;
    unmakeMove(pos, u);
    if (d === 0) return { move: r, refutes: true };
    if (d > bestScore) {
      bestScore = d;
      best = r;
    }
  }
  return { move: best, refutes: false };
}
