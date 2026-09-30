import { getDeviceId } from "@/lib/identity/deviceId";
import { getVisitorNickname } from "@/lib/identity/lastNickname";

/**
 * Per-game funnel steps shown on /admin/games:
 * - `hub_click`    — a game card clicked in the 보드게임 허브 lobby
 * - `room_create`  — a host's room actually opened (reached its waiting room)
 * - `invite_click` — the "🔑 초대 코드로 참여" button pressed
 * - `join`         — a guest actually got into someone's waiting room
 * - `game_start`   — a match actually started (every participant logs one;
 *                    only the host's counts toward the public play count)
 */
export type GameEventName = "hub_click" | "room_create" | "invite_click" | "join" | "game_start";

/**
 * Fire-and-forget. The server route drops it outside production and for
 * automated browsers (Claude's Playwright runs), see `/api/analytics/event`.
 */
export function trackGameEvent(
  gameId: string,
  event: GameEventName,
  options: { roomCode?: string | null; isHost?: boolean } = {},
): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({
      gameId,
      event,
      roomCode: options.roomCode ?? null,
      isHost: options.isHost ?? false,
      deviceId: getDeviceId(),
      nickname: getVisitorNickname(),
      automated: navigator.webdriver === true,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/analytics/event", blob)) return;
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best-effort only.
  }
}
