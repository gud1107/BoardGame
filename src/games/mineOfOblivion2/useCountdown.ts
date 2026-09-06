import { useEffect, useState } from "react";

/**
 * Per-viewer cosmetic countdown for the `REVEAL_STEP` overlay's "다음 턴 준비"
 * progress bar — duplicated from 1편's identical hook (zero cross-game
 * coupling, see `engine.ts`'s module doc). Local to this client only; the
 * actual phase advance is driven by the host's own fixed `setTimeout` in
 * `MineOfOblivion2Game.tsx` dispatching `{type:"READY_NEXT_ROUND"}` — this
 * hook only ever renders a matching visual, never dispatches anything.
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
