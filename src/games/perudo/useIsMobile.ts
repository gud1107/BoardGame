"use client";

import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/**
 * Drives the mobile zero-scroll/right-sidebar layout vs. the existing
 * rect-track desktop layout switch in `PerudoBoard.tsx` (2026-09-08 모바일
 * 화이트 오버스크롤 차단 세션). Same hook/breakpoint as `century/useIsMobile.ts`
 * / `lasVegas/useIsMobile.ts` / `mineOfOblivion2/useIsMobile.ts` (duplicated
 * per-game per `ARCHITECTURE.md` §2 zero-coupling convention). Mounts ONLY
 * ONE of the two layout trees at a time — `PerudoBoard`'s bid-composer state
 * (draft quantity/face, colorway picker, etc.) all lives in the parent and
 * is simply passed as props to whichever tree renders, so there's no DOM-ref
 * collision risk here, but the single-mount pattern is kept anyway for
 * consistency with the other games' compact-dashboard precedent.
 *
 * SSR-safe: the lazy initializer reads `window` directly rather than
 * starting `false` and correcting on mount — safe here because
 * `playableGames.tsx` loads `PerudoGame` via `dynamic(..., { ssr: false })`,
 * so there is never server-rendered markup for this to mismatch against.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
