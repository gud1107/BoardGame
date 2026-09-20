"use client";

import { useCallback, useState } from "react";
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
 * 재사용해 마피아 전용 배치(하단 중앙 퀵바 + 전체화면 모달)만 새로 씌운다
 * — 요청 원안처럼 메시지 목록/입력을 직접 새로 구현하지 않는다.
 *
 * 2026-09-20 3차 요청 — 전체화면 모드로 전환. `fixed inset-0`(네 방향 모두
 * 고정)을 쓰는 게 포인트: 최신 모바일 브라우저는 `position:fixed` 요소의
 * `bottom`을 가상 키보드가 올라올 때 실제 가시 뷰포트 높이에 맞춰 다시
 * 계산해준다(레이아웃 뷰포트 고정 + `100dvh`/`100vh` 같은 높이 값에 의존하는
 * 것보다 이 방식이 키보드 리사이즈에 더 안정적) — 그래서 헤더/메시지목록
 * (`flex-1 overflow-y-auto`)/입력창(`shrink-0`) 순서의 세로 flex 배치만
 * 유지하면 입력창이 항상 키보드 바로 위에 붙는다.
 *
 * 2026-09-20 4차 요청 — "전송 완료 시 자동으로 닫힘"(3차 요청 당시 명세)을
 * 도로 제거. 여러 메시지를 연달아 보낼 때마다 매번 퀵바를 다시 눌러야 하는
 * 게 오히려 불편하다는 피드백 — 이제는 ✕ 버튼으로만 닫힌다(사용자가 수동
 * 제어). 다시 이 동작을 넣지 말 것.
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
  const close = useCallback(() => setOpen(false), []);

  // 열려 있던 시점까지 이미 본 메시지 개수 — ChatDrawer.tsx와 동일한
  // "렌더 중 비교 후 setState" 패턴으로 안 읽은 개수를 유도한다.
  const [seenCount, setSeenCount] = useState(0);
  if (open && seenCount !== messages.length) {
    setSeenCount(messages.length);
  }
  const unread = open ? 0 : Math.max(0, messages.length - seenCount);
  const latest = messages[messages.length - 1];
  const preview = latest ? (latest.type === "SYSTEM" ? latest.body : `${latest.senderName}: ${latest.body}`) : "탭해서 채팅 시작하기";

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
        <div className="fixed inset-0 z-50 flex flex-col bg-[#12101c] light:bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-4 py-3 light:border-slate-200 light:bg-slate-50">
            <h2 className="text-sm font-bold text-white light:text-slate-900">
              💬 {title}
              {readOnly && <span className="ml-1 text-white/40 light:text-slate-400">(관전 중)</span>}
            </h2>
            <button
              onClick={close}
              aria-label="닫기"
              className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-2xl text-white/50 transition hover:bg-white/10 hover:text-white light:text-slate-400 light:hover:bg-slate-100 light:hover:text-slate-700"
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
              readOnly={readOnly}
              onInputFocus={onInputFocus}
              onInputBlur={onInputBlur}
            />
          </div>
        </div>
      )}
    </>
  );
}
