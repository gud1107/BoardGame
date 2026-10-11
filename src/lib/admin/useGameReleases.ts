"use client";

import { useEffect, useState } from "react";
import type { GameReleasesResponse } from "./gameReleases";

/**
 * Push/deploy times for the admin 커밋/푸시/배포순 sorts — fetched only once
 * an admin actually picks one of them (`enabled`), then kept for the visit.
 * Stays null on failure; the sorts then fall back to commit time.
 */
export function useGameReleases(enabled: boolean): GameReleasesResponse | null {
  const [data, setData] = useState<GameReleasesResponse | null>(null);
  const wanted = enabled && !data;

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void fetch("/api/admin/game-releases")
      .then((res) => (res.ok ? (res.json() as Promise<GameReleasesResponse>) : null))
      .catch(() => null)
      .then((body) => {
        if (!cancelled && body) setData(body);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return data;
}
