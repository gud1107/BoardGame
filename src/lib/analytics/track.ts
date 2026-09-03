import { getDeviceId } from "@/lib/identity/deviceId";

/**
 * Fire-and-forget POST helper shared by every tracker below. `sendBeacon` is
 * preferred because it survives the page unloading (the exact moment
 * `endGamePlay`/an unmount cleanup fires); `fetch(..., { keepalive: true })`
 * is the fallback for browsers/contexts without it. Either way, analytics
 * must never throw into or block the caller — same "best-effort" posture as
 * `recordGuestUsage`/`recordUserUsage` elsewhere in this codebase.
 */
function beacon(url: string, payload: unknown): void {
  try {
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.(url, blob)) return;
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Best-effort only.
  }
}

/** Records one site visit (see `AnalyticsVisitTracker`). Best-effort, never throws. */
export function recordVisit(path: string): void {
  if (typeof window === "undefined") return;
  beacon("/api/analytics/visit", { deviceId: getDeviceId(), path, userAgent: navigator.userAgent });
}

/**
 * Records a game session start. Uses `fetch` (not `beacon`) because the
 * caller needs the generated `playId` back to close the loop with
 * `endGamePlay` later — this is the one analytics call that isn't fully
 * fire-and-forget. Returns `null` on any failure; callers must treat a null
 * playId as "this session won't be tracked" and carry on regardless.
 * No longer takes a `playerCount` — the local file store only keeps
 * per-game/per-day counters (see `src/lib/analytics/localStore.ts`), and
 * the admin dashboard has never surfaced a player-count breakdown.
 */
export async function startGamePlay(gameId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/analytics/game-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", gameId }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { playId?: string } | null;
    return data?.playId ?? null;
  } catch {
    return null;
  }
}

/**
 * Records a game session end (completed or abandoned). No-op when `playId`
 * is null (start was never tracked). `gameId` is required here (unlike the
 * old Supabase version) because the local store has no per-session row to
 * look it up from — see the comment in `api/analytics/game-play/route.ts`.
 */
export function endGamePlay(playId: string | null, isCompleted: boolean, gameId: string | null): void {
  if (typeof window === "undefined" || !playId) return;
  beacon("/api/analytics/game-play", { action: "end", playId, isCompleted, gameId: gameId ?? undefined });
}
