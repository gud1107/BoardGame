"use client";

import { useState } from "react";
import Link from "next/link";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useProfileStore } from "@/store/profileStore";
import { TIER_LABELS } from "@/lib/entitlements/types";
import Avatar from "@/components/common/Avatar";
import SoundToggleButton from "@/components/audio/SoundToggleButton";
import ProfileModal from "@/components/profile/ProfileModal";
import { findActiveRoomsByCode } from "@/lib/activeRooms/repository";

/**
 * Desktop dashboard left rail (see `src/app/page.tsx`, xl+ only) — profile
 * summary + quick actions. Shows only real, already-tracked data (avatar +
 * login email/게스트 + tier badge): this app has no global nickname or
 * win/loss rating anywhere else, so this deliberately does not invent
 * placeholder fields for them (confirmed via AskUserQuestion, 2026-09-12).
 */
export default function LobbyProfileCard() {
  const configured = useSubscriptionStore((s) => s.configured);
  const userId = useSubscriptionStore((s) => s.userId);
  const email = useSubscriptionStore((s) => s.email);
  const tier = useSubscriptionStore((s) => s.tier);
  const avatarUrl = useProfileStore((s) => s.avatarUrl);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);

  async function handleQuickJoin() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeError(null);
    setCodeChecking(true);
    try {
      const matches = await findActiveRoomsByCode(code);
      if (matches.length === 0) {
        setCodeError("일치하는 방을 찾을 수 없어요. 코드를 확인해주세요.");
        return;
      }
      // A bare code can't disambiguate a cross-game collision — land on the
      // freshest match (already sorted by nothing in particular here, so
      // pick the most recently updated one).
      const target = matches.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
      window.location.href = `/games/${target.gameId}?room=${target.roomCode}`;
    } finally {
      setCodeChecking(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-3">
          {configured && userId ? (
            <button
              onClick={() => setProfileModalOpen(true)}
              className="shrink-0 rounded-full transition hover:opacity-80"
              aria-label="프로필 이미지 변경"
              title="프로필 이미지 변경"
            >
              <Avatar src={avatarUrl} size={44} />
            </button>
          ) : (
            <Avatar src={null} size={44} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {configured && userId ? (email ?? "내 계정") : "게스트로 플레이 중"}
            </p>
            {configured && (
              <Link
                href={userId ? "/account" : "/login"}
                className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25"
              >
                {userId ? (tier ? TIER_LABELS[tier] : "…") : "로그인하기"}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-bold text-white/50">⚡ 빠른 시작</p>
        <a
          href="#lobby-game-grid"
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:border-rose-400/50 hover:bg-rose-500/10"
        >
          🎮 게임 골라 방 만들기
        </a>

        <div className="mt-1 flex flex-col gap-1.5">
          <label htmlFor="quick-join-code" className="text-[11px] text-white/50">
            초대 코드로 즉시 입장
          </label>
          <div className="flex gap-1.5">
            <input
              id="quick-join-code"
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value);
                setCodeError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleQuickJoin()}
              placeholder="방 코드"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
            />
            <button
              onClick={handleQuickJoin}
              disabled={!codeInput.trim() || codeChecking}
              className="shrink-0 rounded-lg bg-rose-500/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {codeChecking ? "확인 중…" : "입장"}
            </button>
          </div>
          {codeError && <p className="text-[11px] text-rose-300">{codeError}</p>}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-xs text-white/50">사운드</span>
          <SoundToggleButton />
        </div>
      </div>

      {profileModalOpen && <ProfileModal onClose={() => setProfileModalOpen(false)} />}
    </div>
  );
}
