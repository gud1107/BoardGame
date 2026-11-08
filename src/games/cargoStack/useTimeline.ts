"use client";

import { useEffect, useRef, useState } from "react";
import type { CargoState } from "./engine";
import { frameAt, type Frame } from "./anim";

/**
 * Samples the shared animation timeline (anim.ts) on requestAnimationFrame
 * while something is moving, smoothing the heel. The first state this hook
 * sees (mount / reconnect) is shown settled — only changes animate.
 */
export function useTimeline(state: CargoState): { frame: Frame; heel: number } {
  const [view, setView] = useState<{ frame: Frame; heel: number }>(() => {
    const f = frameAt(state, Infinity);
    return { frame: f, heel: f.heel };
  });
  const startRef = useRef<{ state: CargoState | null; at: number }>({ state: null, at: -Infinity });
  const heelRef = useRef(view.heel);

  useEffect(() => {
    const st = startRef.current;
    if (st.state === null) startRef.current = { state, at: -Infinity };
    else if (st.state !== state) startRef.current = { state, at: performance.now() };
    let id = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const f = frameAt(state, now - startRef.current.at);
      const target = f.heel + f.rock;
      const k = f.capsize > 0 ? 1 - Math.exp(-dt * 2.5) : 1 - Math.exp(-dt * 5);
      heelRef.current += (target - heelRef.current) * k;
      setView({ frame: f, heel: heelRef.current });
      if (f.busy || Math.abs(target - heelRef.current) > 0.03) id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [state]);

  return view;
}
