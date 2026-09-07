"use client";

import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/**
 * Drives the mobile-compact-dashboard vs. desktop-mat layout switch in
 * CenturyBoard.tsx. Deliberately mounts ONLY ONE of the two layout trees at
 * a time (rather than rendering both and hiding one with CSS) — the market
 * slot/cart/opponent DOM refs that MerchantEffects.tsx's flying-resource
 * animation reads (see `merchantSlotRefs`/`cartRef`/`playerSummaryRefs` in
 * CenturyBoard.tsx) are set by ref-callback, so two mounted trees sharing
 * the same index would silently overwrite each other's entry and the flight
 * animation would sample whichever tree happened to mount last.
 *
 * SSR-safe: starts `false` (desktop) and corrects on mount, matching this
 * project's existing "no window on the server" convention.
 */
export function useIsMobile(): boolean {
  // Lazy initializer (not a setState call inside the effect body below) so
  // the very first render already has the right answer — CenturyGame.tsx is
  // loaded via `dynamic(..., { ssr: false })` (see playableGames.tsx), so
  // there's no server-rendered markup to mismatch against here.
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
