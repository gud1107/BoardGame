"use client";

import { useEffect, useRef, useState } from "react";
import { INITIAL_BACKGROUND_RESYNC_STATE, LONG_ABSENCE_MS, reduceBackgroundResync, type BackgroundResyncState } from "./backgroundResync";

export { LONG_ABSENCE_MS };

/** How long the optional "재접속 중..." indicator stays up after a long-absence resync fires. */
const RECONNECT_INDICATOR_MS = 1_500;

/**
 * Mobile background-tab resilience, shared across every online-realtime
 * game: don't treat a backgrounded tab as a departure, and resync game
 * state automatically when the tab returns.
 *
 * Deployment here is Vercel serverless (no persistent server process) and
 * every game opens its own Supabase Realtime channel inline — there is no
 * server-side "room manager" to add grace-period logic to, and this hook
 * doesn't try to build one. A backgrounded tab was already never evicted by
 * any of these games (nothing here tears down the channel/presence on
 * `hidden`), so "the player keeps their seat while backgrounded" is already
 * true by construction. This hook's only job is the other half: call the
 * caller-supplied `resync()` once the tab comes back, so state that moved
 * on without us (other players' actions while we were away) gets pulled in.
 *
 * `resync` should be that game's existing `state-request` broadcast send
 * (`channel.send({ type: "broadcast", event: "state-request", payload: {} })`)
 * — the same resync protocol every game's channel effect already implements
 * for its own initial join, reused here rather than inventing a new one.
 *
 * Research note (`@supabase/realtime-js` v2.111, see `RealtimeClient.ts` /
 * `RealtimeChannel.ts`): the underlying Phoenix-style socket already
 * reconnects on its own with backoff (`reconnectAfterMs`/`reconnectTimer`)
 * and each channel already auto-rejoins once the socket is back
 * (`rejoinTimer`) — this is standard, load-bearing Phoenix channel
 * behavior, not something specific to this repo. On top of that,
 * `RealtimeChannel.send()` for a `broadcast` message automatically falls
 * back to a plain REST call when the channel can't currently push (see
 * `RealtimeChannel.ts` `canPush()` check in `send()`), so even a
 * `state-request` sent while technically not-yet-rejoined still gets
 * delivered. Given both of those, no manual `channel.subscribe()`/
 * `track()` replay is required for the common case — sending
 * `state-request` on foreground-return is the correct minimal fix, which is
 * all this hook does. The one defensive touch left to the caller (each
 * game's own `resync` function, since only it holds the channel ref) is: if
 * `channel.state !== "joined"`, call `channel.subscribe()` once before
 * sending — cheap, and `subscribe()` itself no-ops unless the channel is
 * actually closed, so it's safe to call speculatively.
 */
export function useBackgroundResync(active: boolean, resync: () => void): { reconnecting: boolean } {
  const stateRef = useRef<BackgroundResyncState>(INITIAL_BACKGROUND_RESYNC_STATE);
  const resyncRef = useRef(resync);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    resyncRef.current = resync;
  }, [resync]);

  useEffect(() => {
    if (!active) return;
    stateRef.current = INITIAL_BACKGROUND_RESYNC_STATE;

    const handle = (type: "hidden" | "visible") => {
      const result = reduceBackgroundResync(stateRef.current, { type, at: Date.now() });
      stateRef.current = result.state;
      if (!result.shouldResync) return;
      if (result.longAbsence) {
        setReconnecting(true);
        window.setTimeout(() => setReconnecting(false), RECONNECT_INDICATOR_MS);
      }
      resyncRef.current();
    };

    const onVisibilityChange = () => handle(document.visibilityState === "hidden" ? "hidden" : "visible");
    const onBlur = () => handle("hidden");
    const onFocus = () => handle("visible");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [active]);

  return { reconnecting };
}
