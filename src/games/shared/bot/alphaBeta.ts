/**
 * Generic iterative-deepening alpha-beta search, shared by every 2-player
 * perfect-information game's Level 8-10 ("expert") bot (ARCHITECTURE.md
 * §7.1's `botTier`).
 *
 * Why iterative deepening instead of a hardcoded depth: a fixed "search 6-10
 * plies" only works when the branching factor is small (chess: ~35). See
 * malDalliJa/engine.ts — 10 horses per seat, each with up to 16 candidate
 * moves (8 slide directions + 8 knight offsets), so a *hardcoded* depth-8
 * minimax would be b^8 ≈ 40^8 nodes even before pruning, several orders of
 * magnitude too slow for a "no UI freeze" bot. Iterative deepening is the
 * standard real-engine answer to exactly this problem: search depth 1, keep
 * the best move, search depth 2, etc., until a wall-clock budget runs out,
 * then play whatever the deepest *fully completed* iteration found. Deeper
 * levels simply get a bigger time budget — that alone produces the "Level 10
 * looks further ahead than Level 8" curve the task asked for, without a
 * per-level hardcoded ply count that would either starve on this branching
 * factor or under-use the time budget on a quieter position.
 */

export interface AlphaBetaGame<State, Move> {
  getMoves(state: State): Move[];
  applyMove(state: State, move: Move): State;
  isTerminal(state: State): boolean;
  /** Whose turn is next in `state` — decides which side is maximizing at each ply. */
  activeSeat(state: State): string;
  /** Static evaluation from `seat`'s POV (higher = better for `seat`), called only at a leaf (terminal state or depth cutoff). */
  evaluate(state: State, seat: string): number;
  /**
   * Optional cheaper stand-in for `evaluate`, used ONLY to order candidate
   * moves before recursing into them — falls back to `evaluate` when
   * omitted. Pruning efficiency depends on trying the best-looking move
   * first, but the ordering pass itself is called once per candidate at
   * EVERY node, so it doesn't need `evaluate`'s full precision. Games whose
   * real `evaluate` is expensive (e.g. malDalliJa's mobility term, which
   * walks every legal move for both seats) should supply a cheap
   * approximation here — otherwise the ordering pass itself, not the actual
   * search, ends up dominating the time budget, which can blow past
   * `timeBudgetMs` badly between two deadline checks (see `nodeCheckInterval`).
   */
  orderingHeuristic?: (state: State, seat: string) => number;
}

export interface SearchBudget {
  maxDepth: number;
  timeBudgetMs: number;
  /** How many visited nodes between wall-clock checks — checking every single node is itself overhead. */
  nodeCheckInterval?: number;
}

export interface SearchResult<Move> {
  move: Move | null;
  depthReached: number;
  nodesVisited: number;
}

// Deliberately small: Date.now() itself is cheap, but a game's `evaluate`
// (called once per candidate during move ordering, i.e. up to `branching`
// times per node — see `orderingHeuristic`'s doc) is not guaranteed to be,
// so checking infrequently risks massively overshooting `timeBudgetMs`
// between two checks rather than saving meaningful overhead.
const DEFAULT_NODE_CHECK_INTERVAL = 32;

class SearchTimeout extends Error {}

/**
 * Alpha-beta to a fixed `depth`, single-perspective (evaluates every leaf
 * from `perspectiveSeat`'s POV, alternating min/max by whose turn it is)
 * rather than negamax — this project's `evaluate` functions aren't required
 * to be antisymmetric (e.g. malDalliJa's mobility term), so single-
 * perspective keeps that contract simple. Move ordering does one shallow
 * `evaluate()` per candidate before recursing and sorts by it — cheap, but
 * enough to put the most promising branch first at every node, which is
 * what pruning efficiency actually depends on.
 */
function search<State, Move>(
  game: AlphaBetaGame<State, Move>,
  state: State,
  perspectiveSeat: string,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number,
  nodeCounter: { count: number },
  nodeCheckInterval: number,
): number {
  nodeCounter.count++;
  if (nodeCounter.count % nodeCheckInterval === 0 && Date.now() > deadline) {
    throw new SearchTimeout();
  }
  if (depth === 0 || game.isTerminal(state)) {
    return game.evaluate(state, perspectiveSeat);
  }

  const moves = game.getMoves(state);
  if (moves.length === 0) return game.evaluate(state, perspectiveSeat);

  const maximizing = game.activeSeat(state) === perspectiveSeat;
  const orderingFn = game.orderingHeuristic ?? game.evaluate;
  const ordered = moves
    .map((move) => {
      const next = game.applyMove(state, move);
      return { next, order: orderingFn(next, perspectiveSeat) };
    })
    .sort((a, b) => (maximizing ? b.order - a.order : a.order - b.order));

  if (maximizing) {
    let best = -Infinity;
    for (const { next } of ordered) {
      const value = search(game, next, perspectiveSeat, depth - 1, alpha, beta, deadline, nodeCounter, nodeCheckInterval);
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break; // beta cutoff
    }
    return best;
  }
  let best = Infinity;
  for (const { next } of ordered) {
    const value = search(game, next, perspectiveSeat, depth - 1, alpha, beta, deadline, nodeCounter, nodeCheckInterval);
    if (value < best) best = value;
    if (value < beta) beta = value;
    if (alpha >= beta) break; // alpha cutoff
  }
  return best;
}

/**
 * Top-level entry: iterative deepening from depth 1 up to `budget.maxDepth`,
 * stopping the moment `budget.timeBudgetMs` elapses. Always returns the best
 * move from the deepest iteration that finished in full — a timed-out
 * iteration's partial results are discarded (its move ordering reflects an
 * incomplete scan, not a reliable strength read), never played half-searched.
 */
export function iterativeDeepeningSearch<State, Move>(
  game: AlphaBetaGame<State, Move>,
  state: State,
  seat: string,
  budget: SearchBudget,
): SearchResult<Move> {
  const rootMoves = game.getMoves(state);
  if (rootMoves.length === 0) return { move: null, depthReached: 0, nodesVisited: 0 };
  if (rootMoves.length === 1) return { move: rootMoves[0], depthReached: budget.maxDepth, nodesVisited: 1 };

  const deadline = Date.now() + budget.timeBudgetMs;
  const nodeCheckInterval = budget.nodeCheckInterval ?? DEFAULT_NODE_CHECK_INTERVAL;
  const nodeCounter = { count: 0 };

  let bestMove: Move | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= budget.maxDepth; depth++) {
    try {
      // Poor man's PV-move ordering: try the previous iteration's best move
      // first, so a beta cutoff on the strongest line happens as early as
      // possible at this new depth too.
      const ordered: Move[] = bestMove === null ? rootMoves : [bestMove, ...rootMoves.filter((m) => m !== bestMove)];

      let localBest: Move | null = null;
      let localBestValue = -Infinity;
      let alpha = -Infinity;
      const beta = Infinity;

      for (const move of ordered) {
        const next = game.applyMove(state, move);
        const value = search(game, next, seat, depth - 1, alpha, beta, deadline, nodeCounter, nodeCheckInterval);
        if (value > localBestValue) {
          localBestValue = value;
          localBest = move;
        }
        if (value > alpha) alpha = value;
      }

      if (localBest !== null) {
        bestMove = localBest;
        depthReached = depth;
      }
    } catch (e) {
      if (e instanceof SearchTimeout) break;
      throw e;
    }
  }

  return { move: bestMove ?? rootMoves[0], depthReached, nodesVisited: nodeCounter.count };
}
