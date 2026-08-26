/**
 * Shared chat message shape for both the global lobby (`global:lobby`) and
 * per-room waiting/in-game chat (`room:<gameId>:<roomCode>`). Delivered live
 * over a Supabase Realtime broadcast event named `chat-message` on whichever
 * channel is already open for that scope (see `useRealtimeChat.ts` for the
 * lobby's own channel, and `PerudoGame.tsx`/`DalmutiGame.tsx` for room chat,
 * which piggybacks on the game's existing room channel instead of opening a
 * second one). `chat_messages` (see `supabase/schema.sql`) exists only to
 * reload the last 30 messages on join/refresh — it is not the live path.
 */
export type ChatMessageType = "USER" | "SYSTEM" | "EMOJI";

export interface ChatMessage {
  id: string;
  channel: string;
  deviceId: string;
  senderName: string;
  body: string;
  type: ChatMessageType;
  createdAt: string;
}

/** Return shape of every `sendMessage`/`onSend` in the chat feature — lets a caller show a cooldown countdown when throttled. */
export interface SendResult {
  ok: boolean;
  lockedUntil?: number;
}
