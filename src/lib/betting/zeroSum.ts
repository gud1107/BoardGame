export interface ZeroSumCheck {
  valid: boolean;
  sum: number;
}

/**
 * The core rule from the spec: for N players, the prize/penalty table must
 * sum to exactly 0 (zero-sum) before betting can start. This is re-checked
 * live in the payout editor and again defensively before the session is
 * created.
 */
export function validatePayoutTable(payouts: number[]): ZeroSumCheck {
  const sum = payouts.reduce((a, b) => a + b, 0);
  return { valid: payouts.length > 0 && sum === 0, sum };
}

/**
 * Generates a symmetric zero-sum default table for N players, mirroring the
 * example in the spec (8 players -> 4000, 3000, ..., -4000). Always sums to
 * exactly 0 regardless of N, so it's a safe pre-fill that the organizer can
 * still hand-edit (as long as they keep it summing to 0).
 */
export function generateDefaultPayoutTable(n: number, unit = 1000): number[] {
  if (n < 1) return [];
  const half = Math.floor(n / 2);
  const isOdd = n % 2 === 1;
  const table: number[] = [];
  for (let i = 1; i <= n; i++) {
    if (i <= half) {
      table.push(unit * (half - i + 1));
    } else if (isOdd && i === half + 1) {
      table.push(0);
    } else {
      const offset = isOdd ? 1 : 0;
      table.push(unit * (half - (i - offset)));
    }
  }
  return table;
}
