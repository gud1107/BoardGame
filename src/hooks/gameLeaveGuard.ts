/**
 * Pure "what should the exit-confirm modal be doing" transition logic for
 * `useGameLeaveGuard`, split out so it's unit-testable without touching
 * `window.history`/`document` (this repo's vitest config has no jsdom — see
 * `throttle.ts` / `throttle.test.ts` for the same pattern).
 *
 * Modeled as a tiny 2-state machine: `closed` (normal play) and `open` (the
 * confirm modal is up). `popstate` (a back gesture/button was intercepted)
 * opens it; `cancel`/`confirm` (the user resolved the modal) close it again.
 */
export type GameLeaveGuardState = "closed" | "open";

export type GameLeaveGuardEvent = "popstate" | "cancel" | "confirm";

export function reduceGameLeaveGuard(state: GameLeaveGuardState, event: GameLeaveGuardEvent): GameLeaveGuardState {
  switch (event) {
    case "popstate":
      return "open";
    case "cancel":
    case "confirm":
      return "closed";
    default:
      return state;
  }
}
