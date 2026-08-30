import { useEffect, useState } from "react";

/**
 * Per-viewer cosmetic countdown for the showdown overlay's "다음 라운드 준비"
 * progress bar (`ShowMeTheCoinEffects.tsx`'s `NextRoundCountdown`) — local to
 * this client only, same idiom as `grid-poker/useCountdown.ts` (duplicated
 * rather than imported, per ARCHITECTURE.md §2's zero cross-game coupling
 * rule). The actual phase advance is driven by the host's own fixed
 * `setTimeout` in `ShowMeTheCoinGame.tsx` dispatching `{type:"continue"}` —
 * this hook only ever renders a matching visual, never dispatches anything
 * itself.
 */
export function useCountdown(seconds: number, resetKey: unknown, active: boolean) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setTimeLeft(seconds);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey]);

  return { timeLeft };
}
