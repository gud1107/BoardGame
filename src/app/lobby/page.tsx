"use client";

import { isSupabaseConfigured } from "@/lib/supabase/client";
import SupabaseRequiredNotice from "@/components/SupabaseRequiredNotice";
import LobbyChat from "@/components/chat/LobbyChat";

export default function LobbyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-bold text-white">🎲 로비</h1>
      <p className="mb-6 text-sm text-white/50">
        지금 접속한 모든 사람과 실시간으로 대화할 수 있는 전체 채팅방입니다.
      </p>

      {isSupabaseConfigured() ? <LobbyChat /> : <SupabaseRequiredNotice feature="로비 채팅" />}
    </div>
  );
}
