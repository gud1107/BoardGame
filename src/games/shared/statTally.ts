/**
 * Per-seat event counters an engine keeps in its own state for the personal
 * stats (`GameSelfResult.details`, src/lib/stats/details.ts). Lives in engine
 * state — not in a component — so it's deterministic under lockstep and
 * survives a reconnect `state-sync` without double counting.
 *
 * Optional on every state (`statTally?: StatTally`) so games in flight before
 * a game started tallying still load.
 */
export type StatTally = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Add `by` to `seat`'s `key`. */
export function tallyAdd(t: StatTally | undefined, seat: number, key: string, by = 1): StatTally {
  const prev = t ?? {};
  const row = prev[seat] ?? {};
  return { ...prev, [seat]: { ...row, [key]: (row[key] ?? 0) + by } };
}

/** Keep the larger of the stored value and `value`. */
export function tallyMax(t: StatTally | undefined, seat: number, key: string, value: number): StatTally {
  const prev = t ?? {};
  const row = prev[seat] ?? {};
  if (row[key] !== undefined && row[key] >= value) return prev;
  return { ...prev, [seat]: { ...row, [key]: value } };
}

/** Set `key` to 1 (a "this happened at least once this game" flag). */
export function tallyFlag(t: StatTally | undefined, seat: number, key: string): StatTally {
  return tallyMax(t, seat, key, 1);
}

export function tallyOf(t: StatTally | undefined, seat: number): Record<string, number> {
  return { ...(t?.[seat] ?? {}) };
}
