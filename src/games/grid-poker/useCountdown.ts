import { useEffect, useRef, useState } from "react";

/**
 * A simple per-viewer countdown, local to this client only — consistent
 * with the lockstep/no-server-authority model (see engine.ts): every client
 * runs its own clock and, on expiry, is only ever responsible for emitting
 * an `EngineAction` for *its own* seat, never anyone else's. Small clock
 * drift between clients is harmless since the timer is a UX nudge, not a
 * consensus mechanism.
 *
 * `active` gates the whole thing (no ticking/no expiry callback while
 * false). `resetKey` restarts the countdown from `seconds` whenever it
 * changes (e.g. a fresh common-card draw, or a new scoring round) — reset is
 * done by comparing `resetKey` against its previous value *during render*
 * (React's documented "adjusting state when a prop changes" pattern)
 * instead of `setState` inside an effect, which avoids an extra
 * effect-triggered render pass. `onExpire` fires exactly once per
 * `resetKey`: the tick that brings `timeLeft` from 1 down to 0 is the only
 * one that ever calls it (every tick after that sees it's already 0 and
 * no-ops), so no extra "already expired" flag is needed.
 */
export function useCountdown(seconds: number, resetKey: unknown, active: boolean, onExpire: () => void) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  const onExpireRef = useRef(onExpire);

  // Keep the ref pointing at the latest closure without mutating it during
  // render — refs are only ever safe to write from an effect/event handler.
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setTimeLeft(seconds);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 0) return 0;
        if (t === 1) onExpireRef.current();
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey]);

  return { timeLeft };
}
