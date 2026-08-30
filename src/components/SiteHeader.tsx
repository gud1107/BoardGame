"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useBettingStore } from "@/store/bettingStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useProfileStore } from "@/store/profileStore";
import { TIER_LABELS } from "@/lib/entitlements/types";
import SoundToggleButton from "@/components/audio/SoundToggleButton";
import PatchNoteButton from "@/components/patchNotes/PatchNoteButton";
import Avatar from "@/components/common/Avatar";
import ProfileModal from "@/components/profile/ProfileModal";

export default function SiteHeader() {
  const session = useBettingStore((s) => s.session);
  const setSidebarOpen = useBettingStore((s) => s.setSidebarOpen);

  const configured = useSubscriptionStore((s) => s.configured);
  const userId = useSubscriptionStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const entitlement = useSubscriptionStore((s) => s.entitlement);
  const initSubscription = useSubscriptionStore((s) => s.init);

  const profileAvatarUrl = useProfileStore((s) => s.avatarUrl);
  const initProfile = useProfileStore((s) => s.init);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  useEffect(() => {
    void initSubscription();
  }, [initSubscription]);

  useEffect(() => {
    void initProfile();
  }, [initProfile]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0b12]/80 backdrop-blur">
      {/* flex-wrap + shrink-0 on every child below is the actual fix for the
          "보\n드\n게\n임" vertical-splitting bug reported on this bar: with no
          flex-wrap, a too-narrow viewport made the flex row shrink every
          child (default flex-shrink:1) down toward its min-content width —
          and a CJK text node's min-content width is a single character
          (default East Asian line-break allows a break between any two
          characters), so squeezed labels collapsed into one-glyph-per-line
          columns. shrink-0 stops labels from being squeezed below their
          natural width at all; flex-wrap lets the row spill onto a second
          line instead when things don't fit, so nothing ever gets that
          squeeze. break-keep is extra insurance for the multi-word labels
          (버그 리포트/내기 진행 중) so a wrap point can't land mid-word either. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 sm:px-6 sm:py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap break-keep text-white">
          <span className="text-xl">🎲</span>
          <span className="text-sm font-bold sm:text-base">보드게임 허브</span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 sm:gap-3">
          {configured && userId && (
            <button
              onClick={() => setProfileModalOpen(true)}
              className="shrink-0 rounded-full transition hover:opacity-80"
              aria-label="프로필 이미지 변경"
              title="프로필 이미지 변경"
            >
              <Avatar src={profileAvatarUrl} size={28} />
            </button>
          )}
          {configured && (
            <Link
              href={userId ? "/account" : "/login"}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30 sm:text-xs"
              title={
                entitlement
                  ? `오늘 ${entitlement.unit === "games" ? "이용 횟수" : "이용 시간"}: ${entitlement.used}/${entitlement.cap}`
                  : undefined
              }
            >
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-200">
                {userId ? (tier ? TIER_LABELS[tier] : "…") : "게스트"}
              </span>
              {/* TEMP: 무료 이용 횟수(N/N회) 배지 임시 숨김 — 요청에 따라 비활성화. 되돌리려면 이 블록 복원.
              {entitlement && (
                <span className="text-white/50">
                  {entitlement.unit === "games"
                    ? `${Math.max(0, entitlement.cap - entitlement.used)}/${entitlement.cap}회`
                    : `${Math.max(0, entitlement.cap - entitlement.used)}/${entitlement.cap}분`}
                </span>
              )}
              */}
            </Link>
          )}
          <Link
            href="/lobby"
            className="shrink-0 whitespace-nowrap break-keep text-xs text-white/50 hover:text-white/80 sm:text-sm"
          >
            💬 로비
          </Link>
          <Link
            href="/history"
            className="shrink-0 whitespace-nowrap break-keep text-xs text-white/50 hover:text-white/80 sm:text-sm"
          >
            기록
          </Link>
          <Link
            href="/bug-reports"
            className="shrink-0 whitespace-nowrap break-keep text-xs text-white/50 hover:text-white/80 sm:text-sm"
          >
            🐛 버그 리포트
          </Link>
          <PatchNoteButton />
          <SoundToggleButton />
          <button
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 whitespace-nowrap break-keep rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-rose-400 hover:text-white"
          >
            {session ? "🎲 내기 진행 중" : "🎲 내기 관리"}
          </button>
        </div>
      </div>
      {profileModalOpen && <ProfileModal onClose={() => setProfileModalOpen(false)} />}
    </header>
  );
}
