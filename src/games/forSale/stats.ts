import { PROPERTY_COUNT, type ForSaleState, type SeatIndex } from "./engine";

/**
 * Per-match detail stats for `GameSelfResult.details` (see
 * src/lib/stats/details.ts for how keys are merged: `max*` keeps the
 * highest, everything else is summed).
 */
export function forSaleStatDetails(state: ForSaleState, seat: SeatIndex, rank: number): Record<string, number> {
  const p = state.players.find((pl) => pl.seat === seat);
  if (!p) return {};
  const sales = p.sales ?? [];
  const total = p.checks.reduce((s, c) => s + c, 0) + p.cash;
  const had30 = sales.some((s) => s.property === PROPERTY_COUNT) || p.properties.includes(PROPERTY_COUNT);
  return {
    zeroChecks: p.checks.filter((c) => c === 0).length,
    maxCheck: p.checks.length ? Math.max(...p.checks) : 0,
    totalMoney: total,
    maxTotal: total,
    had30: had30 ? 1 : 0,
    won30: had30 && rank === 1 ? 1 : 0,
    sold30ForZero: sales.some((s) => s.property === PROPERTY_COUNT && s.check === 0) ? 1 : 0,
  };
}
