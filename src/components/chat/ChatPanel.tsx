"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { QUICK_EMOJIS, QUICK_PHRASES } from "@/lib/chat/quickPhrases";
import Avatar from "@/components/common/Avatar";

interface Props {
  messages: ChatMessage[];
  onSend: (body: string) => SendResult;
  myDeviceId: string;
  cooldownUntil?: number | null;
  placeholder?: string;
  /**
   * 2026-09-03 세션(코요테 탈락 데스 이펙트 요청, `AskUserQuestion`으로 확인)
   * — true면 메시지 목록은 그대로 보이되(관전은 계속 가능) 전송 UI(빠른
   * 문구/이모지/입력창/전송 버튼)는 전부 비활성화된다. 코요테에서 하트가
   * 0이 된 좌석에 `CoyoteGame.tsx`가 켠다 — 다른 게임은 항상 `false`(기본값)
   * 라 기존 채팅 동작에 영향 없음.
   */
  readOnly?: boolean;
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

export default function ChatPanel({ messages, onSend, myDeviceId, cooldownUntil, placeholder = "메시지를 입력하세요", readOnly = false }: Props) {
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
    if (readOnly || !body.trim() || remainingLock > 0) return;
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
          if (m.type === "SYSTEM") {
            return (
              <div key={m.id} className="flex max-w-[85%] flex-col gap-0.5 self-center items-center">
                <span className={bubbleClasses(m, isMine)}>{m.body}</span>
              </div>
            );
          }
          // No cross-device avatar sync exists (see ProfileModal's note) — every
          // sender's chat avatar renders the same DEFAULT_AVATAR (Avatar's
          // no-`src` fallback) rather than a per-player photo.
          return (
            <div
              key={m.id}
              className={`flex max-w-[85%] items-end gap-1.5 ${isMine ? "self-end flex-row-reverse" : "self-start"}`}
            >
              <Avatar size={22} className="mb-0.5 shrink-0" />
              <div className={`flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}>
                <span className="px-1 text-[10px] text-white/35">{isMine ? "나" : m.senderName}</span>
                <span className={bubbleClasses(m, isMine)}>{m.body}</span>
                <span className="px-1 text-[9px] text-white/25">{formatTime(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
        {readOnly ? (
          <p className="break-keep rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-center text-[11px] text-white/40">
            💀 탈락 후에는 관전 전용입니다 — 채팅을 보낼 수 없어요
          </p>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
