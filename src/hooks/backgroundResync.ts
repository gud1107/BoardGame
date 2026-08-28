/**
 * Pure "given a hidden/visible transition, should we resync, and was this a
 * long absence" decision logic for `useBackgroundResync`, split out so it's
 * unit-testable without touching `document`/`window` (this repo's vitest
 * config has no jsdom — see `throttle.ts` / `throttle.test.ts` for the same
 * pattern).
 *
 * Both `document.visibilitychange` and `window` `blur`/`focus` are mapped
 * onto just two event kinds (`hidden` / `visible`) before reaching this
 * function, since either pair can fire for the same real-world "tab/app
 * backgrounded and returned" transition (visibilitychange for tab
 * switches/minimizing, blur/focus for OS-level app switches that leave the
 * browser window visible). Dedup falls out of the state machine itself:
 * a `visible` event only triggers a resync if we were actually marked
 * hidden (`hiddenAt !== null`); a redundant second `visible`/`focus` for
 * the same return-to-foreground is a no-op, and a redundant second
 * `hidden`/`blur` keeps the earliest timestamp.
 */
export const LONG_ABSENCE_MS = 120_000;

export interface BackgroundResyncState {
  hiddenAt: number | null;
}

export const INITIAL_BACKGROUND_RESYNC_STATE: BackgroundResyncState = { hiddenAt: null };

export type BackgroundResyncEvent = { type: "hidden"; at: number } | { type: "visible"; at: number };

export interface BackgroundResyncResult {
  state: BackgroundResyncState;
  shouldResync: boolean;
  longAbsence: boolean;
}

export function reduceBackgroundResync(state: BackgroundResyncState, event: BackgroundResyncEvent): BackgroundResyncResult {
  if (event.type === "hidden") {
    if (state.hiddenAt !== null) return { state, shouldResync: false, longAbsence: false };
    return { state: { hiddenAt: event.at }, shouldResync: false, longAbsence: false };
  }
  // "visible"
  if (state.hiddenAt === null) return { state, shouldResync: false, longAbsence: false };
  const elapsed = event.at - state.hiddenAt;
  return { state: { hiddenAt: null }, shouldResync: true, longAbsence: elapsed >= LONG_ABSENCE_MS };
}
