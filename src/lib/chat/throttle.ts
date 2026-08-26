/**
 * Anti-spam throttle: sending 3+ times within 1 second locks the sender out
 * for 3 seconds. Pure, caller-owned state (no hidden clock/module state) so
 * this is trivially unit-testable, same style as `src/lib/betting/zeroSum.ts`.
 *
 * Usage: call `checkThrottle(state, now)` before sending. If `ok`, send the
 * message, then call `recordSend(state, now)` to fold it in and get the next
 * `ThrottleState` to store.
 */
const WINDOW_MS = 1_000;
const WINDOW_LIMIT = 3;
const LOCKOUT_MS = 3_000;

export interface ThrottleState {
  /** Most-recent-first, capped at `WINDOW_LIMIT` entries. */
  sendTimestamps: number[];
  /** Non-null while a lockout from a prior burst is still in effect. */
  lockedUntil: number | null;
}

export const INITIAL_THROTTLE_STATE: ThrottleState = { sendTimestamps: [], lockedUntil: null };

export interface ThrottleCheck {
  ok: boolean;
  /** Present only when `ok` is false — the timestamp (same clock as `now`) the sender may try again. */
  lockedUntil?: number;
}

export function checkThrottle(state: ThrottleState, now: number): ThrottleCheck {
  if (state.lockedUntil !== null && now < state.lockedUntil) {
    return { ok: false, lockedUntil: state.lockedUntil };
  }
  return { ok: true };
}

/** Call only after `checkThrottle` allowed the send, to fold it into the next state. */
export function recordSend(state: ThrottleState, now: number): ThrottleState {
  const sendTimestamps = [now, ...state.sendTimestamps].slice(0, WINDOW_LIMIT);
  const burst = sendTimestamps.filter((t) => now - t < WINDOW_MS);
  const lockedUntil = burst.length >= WINDOW_LIMIT ? now + LOCKOUT_MS : null;
  return { sendTimestamps, lockedUntil };
}
