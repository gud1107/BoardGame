import { getSupabase } from "@/lib/supabase/client";
import type { ChatMessage, ChatMessageType } from "./types";

const HISTORY_LIMIT = 30;

interface ChatMessageRow {
  id: string;
  channel: string;
  device_id: string;
  sender_name: string;
  body: string;
  msg_type: ChatMessageType;
  created_at: string;
}

function fromRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    channel: row.channel,
    deviceId: row.device_id,
    senderName: row.sender_name,
    body: row.body,
    type: row.msg_type,
    createdAt: row.created_at,
  };
}

/**
 * Last `HISTORY_LIMIT` messages for a channel (`global:lobby` or
 * `room:<gameId>:<roomCode>`), oldest first. Never throws — Supabase being
 * unreachable or unconfigured just means no history to restore (live chat
 * still works via broadcast either way).
 */
export async function loadRecentMessages(channel: string): Promise<ChatMessage[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, channel, device_id, sender_name, body, msg_type, created_at")
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error || !data) return [];
    return (data as ChatMessageRow[]).map(fromRow).reverse();
  } catch {
    return [];
  }
}

/**
 * Folds a history-reload result into an existing in-memory message list
 * without duplicating anything a live broadcast already delivered while the
 * history fetch was in flight — dedupe by `id`, then re-sort by `createdAt`
 * since the merge order isn't otherwise guaranteed.
 */
export function mergeHistoryIntoMessages(prev: ChatMessage[], history: ChatMessage[]): ChatMessage[] {
  const seen = new Set(prev.map((m) => m.id));
  return [...history.filter((h) => !seen.has(h.id)), ...prev].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Fire-and-forget persistence for history reload — never blocks or throws
 * into the caller (same "best-effort, live delivery already happened via
 * broadcast" convention as `src/lib/supabase/sync.ts`).
 */
export async function persistMessage(message: ChatMessage): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("chat_messages").insert({
      id: message.id,
      channel: message.channel,
      device_id: message.deviceId,
      sender_name: message.senderName,
      body: message.body,
      msg_type: message.type,
      created_at: message.createdAt,
    });
  } catch {
    // Best-effort only — chat already delivered live via broadcast.
  }
}
