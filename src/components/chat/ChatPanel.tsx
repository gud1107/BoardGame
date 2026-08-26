"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { QUICK_EMOJIS, QUICK_PHRASES } from "@/lib/chat/quickPhrases";

interface Props {
  messages: ChatMessage[];
  onSend: (body: string) => SendResult;
  myDeviceId: string;
  cooldownUntil?: number | null;
  placeholder?: string;
}

function bubbleClasses(message: ChatMessage, isMine: boolean): string {
  if (message.type === "SYSTEM") {
    return "self-center rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-center text-[11px] text-sky-200";
  }
  if (isMine) {
    return "self-end rounded-2xl rounded-br-sm bg-amber-600 px-3 py-1.5 text-sm text-white";
  }
  return "self-start rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm text-white/90";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChatPanel({ messages, onSend, myDeviceId, cooldownUntil, placeholder = "메시지를 입력하세요" }: Props) {
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  // Ticked forward by the interval below, only while a cooldown is active —
  // `remainingLock` itself is derived from it in render, not stored, so
  // there's nothing to reset when `cooldownUntil` clears.
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const remainingLock = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;

  function send(body: string) {
    if (!body.trim() || remainingLock > 0) return;
    const result = onSend(body);
    if (result.ok) {
      setDraft("");
      setShowEmoji(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 py-1">
        {messages.length === 0 && (
          <p className="mt-4 text-center text-xs text-white/30">아직 메시지가 없어요. 먼저 인사해보세요!</p>
        )}
        {messages.map((m) => {
          const isMine = m.deviceId === myDeviceId;
          return (
            <div key={m.id} className={`flex max-w-[85%] flex-col gap-0.5 ${isMine ? "self-end items-end" : "self-start items-start"}`}>
              {m.type !== "SYSTEM" && (
                <span className="px-1 text-[10px] text-white/35">{isMine ? "나" : m.senderName}</span>
              )}
              <span className={bubbleClasses(m, isMine)}>{m.body}</span>
              {m.type !== "SYSTEM" && <span className="px-1 text-[9px] text-white/25">{formatTime(m.createdAt)}</span>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {QUICK_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              onClick={() => send(phrase)}
              className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] whitespace-nowrap text-white/70 hover:border-amber-400 hover:text-white"
            >
              {phrase}
            </button>
          ))}
        </div>

        {showEmoji && (
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-white/5 p-2">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => send(emoji)}
                className="rounded-lg px-1.5 py-1 text-lg hover:bg-white/10"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="flex items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            aria-label="이모지"
            className="shrink-0 rounded-full border border-white/15 px-2 py-1.5 text-sm text-white/70 hover:border-white/30"
          >
            😊
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={remainingLock > 0 ? `잠시 후 다시 시도 (${remainingLock}초)` : placeholder}
            disabled={remainingLock > 0}
            maxLength={300}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || remainingLock > 0}
            className="shrink-0 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500 disabled:opacity-40"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}
