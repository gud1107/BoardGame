/**
 * Pure timing/debounce helpers behind the round-result celebration's "skip"
 * gesture (RoundResultOverlay.tsx's [⏩ 연출 스킵] button + backdrop
 * double-tap). Kept dependency-free from React/DOM — same "small pure
 * module the component imports and GridPoker.test.ts exercises directly"
 * shape as botDifficulty.ts/botTakeover.ts — so the gesture logic itself is
 * unit-testable without a component-rendering test setup (this project has
 * none; vitest.config.mts only runs `src/**\/*.test.ts` under a plain "node"
 * environment).
 */

/** How close together two backdrop taps must land to count as one double-tap skip gesture — long enough for a real double-tap, short enough that two unrelated taps a beat apart never accidentally trigger a skip. */
export const DOUBLE_TAP_SKIP_MS = 350;

/**
 * Whether a backdrop tap at `now` completes a double-tap gesture, given the
 * previous tap's timestamp. `lastTapAt === 0` is the "no previous tap yet"
 * sentinel (a real tap timestamp, `Date.now()`, is never 0) — the very first
 * tap in an overlay's lifetime can never itself count as a double-tap.
 */
export function isDoubleTap(lastTapAt: number, now: number, windowMs: number = DOUBLE_TAP_SKIP_MS): boolean {
  return lastTapAt !== 0 && now - lastTapAt < windowMs;
}
