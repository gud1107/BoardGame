"use client";

import { useEffect, useState } from "react";

/** Wall-clock ms, re-rendering every `intervalMs` — for countdowns (turn timer, knock-off peek, score vote). */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
