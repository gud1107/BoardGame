import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { recordGameComplete, recordGameStart } from "@/lib/analytics/localStore";
import { bumpGamePlayCount, isAutomatedClient } from "@/lib/analytics/playCounts";
import { getGameMeta } from "@/games/registry";
import { recordVisitorPlay } from "@/lib/analytics/visitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartBody {
  action: "start";
  gameId?: string;
  /** Client's `navigator.webdriver` — true under Playwright (Claude's test runs). */
  automated?: boolean;
  deviceId?: string;
  nickname?: string;
}

interface EndBody {
  action: "end";
  playId?: string;
  isCompleted?: boolean;
  gameId?: string;
}

/**
 * Game session lifecycle tracking, called from the shared
 * `src/app/games/[gameId]/page.tsx` wrapper — one hook point covers every
 * game's start/complete/abandon regardless of which engine is playing, per
 * the original "공통 훅" requirement (no per-game instrumentation needed).
 * Backed by `src/lib/analytics/localStore.ts` (replaces the old
 * `game_play_log` Supabase table).
 *
 * Unlike the old Supabase version, "end" doesn't look up a row by `playId`
 * — the local store only keeps aggregate counters, not per-session rows, so
 * `endGamePlay()` now sends `gameId` directly (see `src/lib/analytics/track.ts`).
 * `playId` is still generated/returned/round-tripped so the client-side
 * "was a start ever recorded" guard in `track.ts` keeps working unchanged.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as (StartBody | EndBody) | null;
  if (!body?.action) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  if (body.action === "start") {
    if (!body.gameId) return NextResponse.json({ error: "gameId required" }, { status: 400 });
    recordGameStart(body.gameId);
    // Durable counter behind the lobby's 인기순 sort (localStore resets on
    // Vercel). Real people on real games only: automated browsers and ids
    // outside the registry never reach the public count.
    const automated = isAutomatedClient(request.headers.get("user-agent"), body.automated);
    if (!automated && getGameMeta(body.gameId)?.playable) {
      await bumpGamePlayCount(body.gameId);
      if (body.deviceId) {
        await recordVisitorPlay({ deviceId: body.deviceId, gameId: body.gameId, nickname: body.nickname });
      }
    }
    return NextResponse.json({ playId: randomUUID() });
  }

  if (body.action === "end") {
    if (!body.playId) return NextResponse.json({ error: "playId required" }, { status: 400 });
    if (body.isCompleted && body.gameId) recordGameComplete(body.gameId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
