"use client";

import { useState } from "react";
import { useRealtimeChat } from "@/lib/chat/useRealtimeChat";
import { getChatNickname, setChatNickname } from "@/lib/chat/nickname";
import { getDeviceId } from "@/lib/identity/deviceId";
import ChatPanel from "./ChatPanel";

const LOBBY_CHANNEL = "global:lobby";

export default function LobbyChat() {
  // Lazy initializers, not an effect — same "window-guarded, read once on
  // first client render" pattern PerudoGame.tsx uses for its own
  // localStorage-backed `roomFromUrl` state.
  const [nickname, setNickname] = useState(() => getChatNickname() || "게스트");
  const [deviceId] = useState(() => (typeof window !== "undefined" ? getDeviceId() : ""));

  const { messages, connectedCount, sendMessage, cooldownUntil } = useRealtimeChat({
    channelName: LOBBY_CHANNEL,
    senderName: nickname,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-white/60">
          닉네임
          <input
            value={nickname}
            onChange={(e) => {
              const v = e.target.value.slice(0, 16);
              setNickname(v);
              setChatNickname(v);
            }}
            placeholder="닉네임"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-white/50">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {connectedCount}명 접속 중
        </span>
      </div>

      <div className="h-[60vh] max-h-[520px] rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <ChatPanel
          messages={messages}
          onSend={(body) => sendMessage(body)}
          myDeviceId={deviceId}
          cooldownUntil={cooldownUntil}
          placeholder="모두에게 메시지 보내기"
        />
      </div>
    </div>
  );
}
