"use client";

import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/**
 * Drives the mobile-compact-dashboard vs. desktop grid layout switch in
 * `MineOfOblivion2Board.tsx` — same hook/breakpoint as `lasVegas/useIsMobile.ts`
 * / `century/useIsMobile.ts` (2026-09-07 모바일 제로 스크롤 레이아웃 요청,
 * duplicated per-game per `ARCHITECTURE.md` §2 zero-coupling convention).
 * Mounts ONLY ONE of the two layout trees at a time — `MineOfOblivion2Grid`'s
 * own zoom/pan state is self-contained per mount, so there is no DOM-ref
 * animation collision risk here (unlike Las Vegas's flying-dice refs), but
 * the single-mount pattern is kept anyway for consistency with the other
 * games' compact-dashboard precedent.
 *
 * SSR-safe: starts `false` (desktop) and corrects on mount, matching this
 * project's existing "no window on the server" convention.
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
