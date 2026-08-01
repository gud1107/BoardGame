/**
 * Consumes a payout table across a full ranking of a betting session's
 * participants and returns the per-player delta for that round.
 *
 * `ranks` must contain exactly one entry per session participant. Values
 * only need to express relative order (ties = same value, gaps are fine —
 * e.g. 1, 1, 4 is valid and means two people tied for 1st). Because every
 * round always partitions the *entire* payout table, and the table itself
 * is validated zero-sum at session start, every round (and therefore the
 * cumulative session) is guaranteed zero-sum automatically.
 */
export function computeRoundDeltas(
  ranks: Record<string, number>,
  payoutTable: number[],
): Record<string, number> {
  const entries = Object.entries(ranks);
  if (entries.length !== payoutTable.length) {
    throw new Error(
      `Expected ${payoutTable.length} ranked participants, got ${entries.length}`,
    );
  }

  const sortedDistinctRanks = [...new Set(entries.map(([, r]) => r))].sort(
    (a, b) => a - b,
  );

  const deltas: Record<string, number> = {};
  let cursor = 0;
  for (const rankValue of sortedDistinctRanks) {
    const group = entries.filter(([, r]) => r === rankValue).map(([id]) => id);
    const slice = payoutTable.slice(cursor, cursor + group.length);
    const avg = slice.reduce((a, b) => a + b, 0) / group.length;
    for (const id of group) deltas[id] = avg;
    cursor += group.length;
  }
  return deltas;
}

export function mergeDeltasIntoTotals(
  totals: Record<string, number>,
  deltas: Record<string, number>,
): Record<string, number> {
  const next = { ...totals };
  for (const [playerId, delta] of Object.entries(deltas)) {
    next[playerId] = (next[playerId] ?? 0) + delta;
  }
  return next;
}

export interface RankedStanding {
  playerId: string;
  total: number;
  rank: number;
}

/** Final standings for a session close-out: sorted desc by total, ties share a rank. */
export function computeFinalStandings(
  totals: Record<string, number>,
): RankedStanding[] {
  const sorted = Object.entries(totals).sort(([, a], [, b]) => b - a);
  const standings: RankedStanding[] = [];
  let rank = 0;
  let lastTotal: number | null = null;
  sorted.forEach(([playerId, total], idx) => {
    if (lastTotal === null || total !== lastTotal) {
      rank = idx + 1;
      lastTotal = total;
    }
    standings.push({ playerId, total, rank });
  });
  return standings;
}
