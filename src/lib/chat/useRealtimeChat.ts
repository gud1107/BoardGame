"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { v4 as uuid } from "uuid";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import { loadRecentMessages, persistMessage } from "./history";
import { checkThrottle, recordSend, INITIAL_THROTTLE_STATE, type ThrottleState } from "./throttle";
import { filterProfanity } from "./profanity";
import { stripControlChars } from "./sanitize";
import type { ChatMessage, ChatMessageType, SendResult } from "./types";

interface UseRealtimeChatOptions {
  /** Supabase Realtime channel name, e.g. `"global:lobby"`. Opens (and tears down) its own channel — only meant for a scope that doesn't already have one open (unlike room chat, which piggybacks on each game's existing room channel instead of using this hook — see PerudoGame.tsx/DalmutiGame.tsx). */
  channelName: string;
  senderName: string;
}

/**
 * Realtime chat for a channel this hook owns end-to-end: creates the
 * Supabase channel, loads the last 30 messages, tracks presence for a
 * connected-user count, and exposes `sendMessage` (throttled + profanity
 * filtered). Modeled on the room-channel lifecycle every online game already
 * uses (see `PerudoGame.tsx`'s room-channel effect) — same
 * create-then-cleanup-on-unmount shape, just for a chat-only channel.
 */
export function useRealtimeChat({ channelName, senderName }: UseRealtimeChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectedCount, setConnectedCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const throttleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  const senderNameRef = useRef(senderName);
  useEffect(() => {
    senderNameRef.current = senderName;
  }, [senderName]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();

    let cancelled = false;
    void loadRecentMessages(channelName).then((history) => {
      if (!cancelled) setMessages(history);
    });

    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "chat-message" }, ({ payload }) => {
      const message = payload?.message as ChatMessage | undefined;
      if (!message) return;
      setMessages((prev) => [...prev, message]);
    });

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<{ deviceId: string }>;
      setConnectedCount(Object.keys(raw).length);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ deviceId });
      }
    });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [channelName]);

  const sendMessage = useCallback(
    (rawBody: string, type: ChatMessageType = "USER"): SendResult => {
      const now = Date.now();
      const check = checkThrottle(throttleRef.current, now);
      if (!check.ok) {
        setCooldownUntil(check.lockedUntil ?? null);
        return { ok: false, lockedUntil: check.lockedUntil };
      }
      const trimmed = stripControlChars(rawBody);
      if (!trimmed) return { ok: false };
      const { clean } = filterProfanity(trimmed);

      throttleRef.current = recordSend(throttleRef.current, now);
      setCooldownUntil(throttleRef.current.lockedUntil);

      const message: ChatMessage = {
        id: uuid(),
        channel: channelName,
        deviceId: getDeviceId(),
        senderName: senderNameRef.current || "게스트",
        body: clean,
        type,
        createdAt: new Date(now).toISOString(),
      };
      channelRef.current?.send({ type: "broadcast", event: "chat-message", payload: { message } });
      void persistMessage(message);
      return { ok: true };
    },
    [channelName],
  );

  return { messages, connectedCount, sendMessage, cooldownUntil };
}
