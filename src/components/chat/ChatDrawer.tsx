"use client";

import { useState } from "react";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import ChatPanel from "./ChatPanel";

interface Props {
  messages: ChatMessage[];
  onSend: (body: string) => SendResult;
  myDeviceId: string;
  cooldownUntil?: number | null;
  title?: string;
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
 */
export default function ChatDrawer({ messages, onSend, myDeviceId, cooldownUntil, title = "채팅" }: Props) {
  const [open, setOpen] = useState(false);
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

      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/50" />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[92vw] max-w-sm flex-col border-r border-white/10 bg-[#12101c] shadow-2xl transition-transform duration-200 sm:w-96 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-bold text-white">💬 {title}</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="닫기"
            className="grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 px-3 py-3">
          <ChatPanel
            messages={messages}
            onSend={onSend}
            myDeviceId={myDeviceId}
            cooldownUntil={cooldownUntil}
            placeholder="같은 방 사람들에게 메시지 보내기"
          />
        </div>
      </aside>
    </>
  );
}
