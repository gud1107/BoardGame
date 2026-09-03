"use client";

import { useState } from "react";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import ChatPanel from "./ChatPanel";
import DragHandle from "@/components/common/DragHandle";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

interface Props {
  messages: ChatMessage[];
  onSend: (body: string) => SendResult;
  myDeviceId: string;
  cooldownUntil?: number | null;
  title?: string;
  /** 2026-09-03 세션 — `ChatPanel.tsx`로 그대로 전달. 코요테의 탈락 좌석 관전-전용 채팅 게이팅에 쓰인다(다른 게임은 항상 기본값 `false`). */
  readOnly?: boolean;
}

/**
 * Floating in-game chat drawer — same fixed-toggle + backdrop + slide-in
 * pattern as `src/components/betting/BettingSidebar.tsx`, offset to the
 * *left* edge (`left-4`) since `BettingSidebar` already owns the bottom-right
 * corner on every page. Mounted from inside each pilot game's component
 * (`PerudoGame.tsx`/`DalmutiGame.tsx`) rather than the root layout, so it
 * only appears for games that opt in — see `GameMeta.chatEnabled`.
 *
 * Phase-independent by design: it doesn't matter whether the game underneath
 * is in its waiting room or mid-play, so it can be mounted once per phase
 * branch without any dependency on what's rendered alongside it.
 *
 * Below `sm` (640px) this switches from a full-height left side drawer into
 * a bottom sheet (rounded top, drag handle, swipe down to close via
 * `useSwipeToDismiss`) so it doesn't hide the whole board behind a
 * full-screen panel while the keyboard is up. `sm:` and above keeps the
 * original side-drawer shape untouched.
 */
export default function ChatDrawer({ messages, onSend, myDeviceId, cooldownUntil, title = "채팅", readOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { dragY, dragging, handlers } = useSwipeToDismiss(close);
  // How many messages had already been seen as of the last time the drawer
  // was open — `unread` is derived from it, not stored itself. Adjusted
  // during render (not in an effect) the moment the drawer is open and a new
  // message arrives, same "compare and setState during render" pattern
  // PerudoGame.tsx/DalmutiGame.tsx already use for their own seat bookkeeping.
  const [seenCount, setSeenCount] = useState(0);
  if (open && seenCount !== messages.length) {
    setSeenCount(messages.length);
  }
  const unread = open ? 0 : Math.max(0, messages.length - seenCount);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="채팅 열기"
        className="fixed left-4 bottom-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-2xl text-white shadow-xl transition hover:bg-sky-400"
      >
        💬
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-[#0b0b12]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && <div onClick={close} className="fixed inset-0 z-30 bg-black/50" />}

      <aside
        style={open ? { transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 200ms ease-out" } : undefined}
        className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#12101c] shadow-2xl transition-transform duration-200 sm:inset-x-auto sm:inset-y-0 sm:left-0 sm:max-h-none sm:w-96 sm:translate-y-0 sm:rounded-none sm:rounded-r-2xl sm:border-t-0 sm:border-r ${
          open ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:-translate-x-full"
        }`}
      >
        <div {...handlers} className="shrink-0 px-4 pt-3">
          <DragHandle />
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-sm font-bold text-white">
              💬 {title}
              {readOnly && <span className="ml-1 text-white/40">(관전 중)</span>}
            </h2>
            <button
              onClick={close}
              aria-label="닫기"
              className="-mr-2 grid h-12 w-12 place-items-center rounded-full text-xl text-white/50 transition hover:bg-white/10 hover:text-white active:bg-white/20"
            >
              ×
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 px-3 py-3">
          <ChatPanel
            messages={messages}
            onSend={onSend}
            myDeviceId={myDeviceId}
            cooldownUntil={cooldownUntil}
            placeholder="같은 방 사람들에게 메시지 보내기"
            readOnly={readOnly}
          />
        </div>
      </aside>
    </>
  );
}
