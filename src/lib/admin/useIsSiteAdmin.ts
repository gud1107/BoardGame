"use client";

import { useEffect, useState } from "react";
import { getAuthSupabase } from "@/lib/supabase/authClient";

/**
 * Whether the signed-in account is a site admin, asked of the database
 * (`is_site_admin()`, see supabase/game_events.sql) — only decides whether
 * to *show* admin navigation. The real gate is `src/proxy.ts` plus the same
 * check inside every admin RPC. Re-asks whenever `userId` changes
 * (login/logout); false while signed out or unknown.
 */
export function useIsSiteAdmin(userId: string | null): boolean {
  const [admin, setAdmin] = useState<{ userId: string; value: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = getAuthSupabase();
    if (!supabase) return;
    let cancelled = false;
    void supabase.rpc("is_site_admin").then(({ data }) => {
      if (!cancelled) setAdmin({ userId, value: data === true });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return !!userId && admin?.userId === userId && admin.value;
}
