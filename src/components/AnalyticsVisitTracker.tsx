"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordVisit } from "@/lib/analytics/track";

const SESSION_FLAG = "bg_visit_logged_session";

/**
 * Mounted once in the root layout. Fires exactly one `recordVisit` per
 * browser tab session (gated by `sessionStorage`, not per page navigation)
 * — this is a *visit* counter ("site_visit_log"/"monthly_visit_stats"), not
 * a page-view counter, per the confirmed analytics design. `path` captures
 * whichever page the session actually landed on.
 */
export default function AnalyticsVisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    let alreadyLogged = false;
    try {
      alreadyLogged = window.sessionStorage.getItem(SESSION_FLAG) === "1";
      if (!alreadyLogged) window.sessionStorage.setItem(SESSION_FLAG, "1");
    } catch {
      // sessionStorage unavailable (private mode, etc.) — fall through and
      // log this once anyway rather than silently tracking nothing.
    }
    if (alreadyLogged) return;
    recordVisit(pathname);
    // Only ever meant to run once per mount of the root layout (i.e. once
    // per tab session) — `pathname` intentionally isn't a re-trigger here,
    // just the value captured at that one call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
