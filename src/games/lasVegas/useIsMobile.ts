"use client";

import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/**
 * Drives the mobile-compact-dashboard vs. desktop-mat layout switch in
 * `LasVegasBoard.tsx` — same hook/breakpoint as `century/useIsMobile.ts`
 * (2026-09-07 라스베가스 모바일 컴팩트 대시보드 요청, mobile-only branch confirmed
 * with the user rather than replacing the desktop layout). Deliberately
 * mounts ONLY ONE of the two layout trees at a time (not both, hidden via
 * CSS) — the casino-tile/roll-panel DOM refs that `DiceEffects.tsx`'s flying
 * dice-placement/payout animations read (`casinoTileRefs`/`rollPanelRef` in
 * `LasVegasBoard.tsx`) are set by ref-callback, so two mounted trees sharing
 * the same casino number would silently overwrite each other's entry and the
 * flight animation would sample whichever tree happened to mount last.
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
