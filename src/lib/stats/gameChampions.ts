"use client";

import { getAuthSupabase } from "@/lib/supabase/authClient";
import type { LeaderboardResult } from "./leaderboard";

export type BoardPeriod = "month" | "all";

export interface GameBoardRow {
  rank: number;
  nickname: string;
  /** Public character portrait, else the uploaded site avatar, else null. */
  portrait: string | null;
  played: number;
  wins: number;
  winRate: number | null;
  isMe: boolean;
}

/** One game's board via the `public_game_board` RPC (supabase/game_champions.sql). */
export async function fetchGameBoard(
  gameId: string,
  period: BoardPeriod,
  limit = 10,
): Promise<LeaderboardResult<GameBoardRow>> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_game_board", {
    p_game_id: gameId,
    p_period: period,
    p_limit: limit,
  });
  if (error || !Array.isArray(data)) return error?.code === "PGRST202" ? "not-installed" : null;
  return data.map((r) => ({
    rank: Number(r.rank),
    nickname: String(r.nickname),
    portrait: typeof r.portrait === "string" ? r.portrait : null,
    played: Number(r.played),
    wins: Number(r.wins),
    winRate: r.win_rate === null ? null : Number(r.win_rate),
    isMe: !!r.is_me,
  }));
}

/** The month's champions: every row tied at rank 1, only once someone has actually won. */
export function champions(rows: readonly GameBoardRow[]): GameBoardRow[] {
  return rows.filter((r) => r.rank === 1 && r.wins > 0);
}

const SENT_KEY = "bg_public_portrait_sent_v1";
const PORTRAIT_PX = 72;

/** Shrinks a portrait data URL so it fits the server's 30k-character cap (webp, PNG where webp encoding is missing). */
export async function shrinkPortrait(url: string): Promise<string | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PORTRAIT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
  const out = canvas.toDataURL("image/webp", 0.82);
  return out.length <= 30000 ? out : null;
}

/**
 * Publishes (or clears, with null) the signed-in player's character portrait
 * for the public boards. `sig` identifies what is being published; the same
 * account + sig is sent only once per device.
 */
export async function publishPortrait(sig: string, url: string | null): Promise<void> {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user.id;
    if (!uid) return;
    const stamp = `${uid}|${sig}`;
    if (window.localStorage.getItem(SENT_KEY) === stamp) return;
    const { error } = await supabase.rpc("set_my_public_portrait", { p_url: url });
    // not-installed (PGRST202) or a rejected image: retry on a later visit
    if (!error) window.localStorage.setItem(SENT_KEY, stamp);
  } catch {
    // Storage blocked / offline — try again next load.
  }
}
