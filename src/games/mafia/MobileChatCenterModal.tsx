"use client";

import { useState } from "react";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import ChatPanel from "@/components/chat/ChatPanel";

/**
 * 모바일 전용 "화면 중앙 집중형 플로팅 채팅 모달" (2026-09-20 2차 요청) —
 * 모바일채팅이상현상.jpg가 보여준 화면 자체는 실제로는 멀쩡했지만(가상
 * 키보드가 뜬 프레임을 캡처하지 못했을 뿐), 하단 고정 바텀시트(`ChatDrawer`)
 * 가 가상 키보드와 겹칠 수 있다는 우려 자체는 합리적이라 이 게임에 한해
 * 근본적으로 다른 배치를 도입한다. `ChatDrawer`/`ChatPanel.tsx`는 27개
 * 게임이 공유하는 컴포넌트라 그대로 두고(다른 게임 영향 없음), 이 파일은
 * `ChatPanel`(메시지 목록/입력/쿨다운/이모지/빠른문구 전부 포함)만 그대로
 * 재사용해 마피아 전용 배치(하단 중앙 퀵바 + 화면 상단 고정 모달)만 새로
 * 씌운다 — 요청 원안처럼 메시지 목록/입력을 직접 새로 구현하지 않는다.
 *
 * 모달을 화면 "중앙"이 아니라 상단 고정(`top-16`, `bottom-auto`)에 두는 게
 * 포인트 — 가상 키보드는 항상 뷰포트 아래쪽부터 올라오므로, 위쪽에
 * 고정하면 키보드가 아무리 커져도 절대 겹치지 않는다. `MafiaGame.tsx`가
 * `sm:hidden`으로 감싸 데스크톱/태블릿에서는 기존 `ChatDrawer`(사이드
 * 드로어)를 그대로 쓰고, 모바일에서만 이 컴포넌트로 완전히 대체한다.
 */

interface Props {
  messages: ChatMessage[];
  onSend: (body: string) => SendResult;
  myDeviceId: string;
  cooldownUntil?: number | null;
  title?: string;
  readOnly?: boolean;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  /** 마피아가 유령 채팅처럼 채널 2개를 동시에 띄울 때 하단 퀵바가 겹치지 않도록 위치를 밀어 올리는 값(rem). 기본 0(하단 고정). */
  quickBarBottomOffsetRem?: number;
}

export default function MobileChatCenterModal({
  messages,
  onSend,
  myDeviceId,
  cooldownUntil,
  title = "채팅",
  readOnly = false,
  onInputFocus,
  onInputBlur,
  quickBarBottomOffsetRem = 0,
}: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // 열려 있던 시점까지 이미 본 메시지 개수 — ChatDrawer.tsx와 동일한
  // "렌더 중 비교 후 setState" 패턴으로 안 읽은 개수를 유도한다.
  const [seenCount, setSeenCount] = useState(0);
  if (open && seenCount !== messages.length) {
    setSeenCount(messages.length);
  }
  const unread = open ? 0 : Math.max(0, messages.length - seenCount);
  const latest = messages[messages.length - 1];
  const preview = latest ? (latest.type === "SYSTEM" ? latest.body : `${latest.senderName}: ${latest.body}`) : "탭해서 채팅 시작하기";

  // 전송 완료 시 모달을 자동으로 닫는다(요청 명세) — ChatPanel은 onSend의
  // 반환값으로 draft 초기화 여부를 결정하므로, 원래 결과를 그대로 반환하면서
  // 부수효과로만 닫는다.
  const handleSend = (body: string): SendResult => {
    const result = onSend(body);
    if (result.ok) close();
    return result;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="채팅 열기"
        style={{ bottom: `calc(1rem + ${quickBarBottomOffsetRem}rem)` }}
        className="fixed inset-x-4 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-[#12101c]/95 px-4 py-2.5 text-left shadow-xl backdrop-blur-md light:border-slate-200 light:bg-white/95"
      >
        <span className="shrink-0 text-lg">💬</span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/70 light:text-slate-600">{preview}</span>
        {unread > 0 && (
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={close} />
          <div className="fixed inset-x-4 top-16 z-50 flex max-h-[60vh] flex-col overflow-hidden rounded-2xl border border-amber-500/30 bg-[#12101c] shadow-2xl light:border-amber-300/50 light:bg-white">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-4 py-2.5 light:border-slate-200 light:bg-slate-50">
              <h2 className="text-sm font-bold text-white light:text-slate-900">
                💬 {title}
                {readOnly && <span className="ml-1 text-white/40 light:text-slate-400">(관전 중)</span>}
              </h2>
              <button
                onClick={close}
                aria-label="닫기"
                className="-mr-2 grid h-9 w-9 place-items-center rounded-full text-xl text-white/50 transition hover:bg-white/10 hover:text-white light:text-slate-400 light:hover:bg-slate-100 light:hover:text-slate-700"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 px-3 py-3">
              <ChatPanel
                messages={messages}
                onSend={handleSend}
                myDeviceId={myDeviceId}
                cooldownUntil={cooldownUntil}
                placeholder="같은 방 사람들에게 메시지 보내기"
                readOnly={readOnly}
                onInputFocus={onInputFocus}
                onInputBlur={onInputBlur}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
