import { useEffect, useState } from "react";

/**
 * Per-viewer cosmetic countdown for the `REVEAL_STEP` overlay's "다음 턴 준비"
 * progress bar (`MineOfOblivionEffects.tsx`) — local to this client only,
 * same idiom as `grid-poker/useCountdown.ts` / `showMeTheCoin/useCountdown.ts`
 * (duplicated rather than imported, per ARCHITECTURE.md §2's zero
 * cross-game coupling rule). The actual phase advance is driven by the
 * host's own fixed `setTimeout` in `MineOfOblivionGame.tsx` dispatching
 * `{type:"READY_NEXT_ROUND"}` — this hook only ever renders a matching
 * visual, never dispatches anything itself.
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
