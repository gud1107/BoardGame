import { NextRequest, NextResponse } from "next/server";
import { getGameMeta } from "@/games/registry";
import { isAutomatedClient, isClaudeTestClient } from "@/lib/analytics/playCounts";
import { getSupabase } from "@/lib/supabase/client";
import { clientIp } from "@/lib/analytics/clientIp";
import { CLAUDE_DEVICE_ID, CLAUDE_NICKNAME } from "@/lib/analytics/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set(["hub_click", "room_create", "invite_click", "join", "game_start", "game_end"]);

interface EventBody {
  gameId?: string;
  event?: string;
  roomCode?: string | null;
  isHost?: boolean;
  deviceId?: string;
  nickname?: string;
  automated?: boolean;
}

/**
 * Funnel event sink (see `src/lib/analytics/gameEvents.ts`). Writes through
 * the `log_game_event` RPC (`supabase/game_events.sql`), which also bumps
 * the public play count on a host's `game_start`. Production only — local
 * dev shares the Supabase project — and automated browsers are recorded as
 * Claude (`claude.ts`), which the database keeps out of public counts.
 * The raw IP is passed to the RPC and only its salted hash is stored.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as EventBody | null;
  if (!body?.gameId || !body.event || !EVENTS.has(body.event)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!getGameMeta(body.gameId)?.playable) return NextResponse.json({ ok: true });
  if (process.env.VERCEL_ENV !== "production") return NextResponse.json({ ok: true });
  // Claude's test browsers are kept, but as "🤖 클로드" (claude.ts); other bots are dropped.
  const userAgent = request.headers.get("user-agent");
  const isClaude = isClaudeTestClient(userAgent, body.automated);
  if (!isClaude && isAutomatedClient(userAgent, body.automated)) return NextResponse.json({ ok: true });

  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.rpc("log_game_event", {
        p_device_id: isClaude ? CLAUDE_DEVICE_ID : (body.deviceId ?? null),
        p_game_id: body.gameId,
        p_event: body.event,
        p_room_code: body.roomCode ?? null,
        p_nickname: isClaude ? CLAUDE_NICKNAME : (body.nickname ?? ""),
        p_ip: clientIp(request),
        p_is_host: body.isHost === true,
      });
    } catch {
      // Best-effort.
    }
  }
  return NextResponse.json({ ok: true });
}
