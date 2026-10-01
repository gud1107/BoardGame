"use client";

import { useEffect } from "react";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { resetLocalStatsToGuest, syncPlayerStats } from "@/lib/stats/playerStats";

/**
 * Mounted once in the root layout. Uploads queued matches (including guest
 * ones — the guest → account merge) whenever a session appears, and clears
 * the account's cached totals from this device on logout.
 */
export default function PlayerStatsSync() {
  useEffect(() => {
    const supabase = getAuthSupabase();
    if (!supabase) return;
    void syncPlayerStats();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") void syncPlayerStats();
      else if (event === "SIGNED_OUT") void resetLocalStatsToGuest();
    });
    const onOnline = () => void syncPlayerStats();
    window.addEventListener("online", onOnline);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return null;
}
