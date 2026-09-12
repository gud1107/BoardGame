"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void initSubscription();
  }, [initSubscription]);

  useEffect(() => {
    void initProfile();
  }, [initProfile]);

  // Publishes this header's real rendered height as a CSS var so other
  // sticky layers (e.g. the mobile lobby's sticky search bar, page.tsx) can
  // stack directly beneath it without guessing a fixed px offset — this bar
  // wraps to a second line on narrow viewports (see the flex-wrap comment
  // below) and grows/shrinks as async content (tier badge, avatar) resolves,
  // so a hardcoded top offset would either leave a gap or clip under it.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setVar = () => {
      document.documentElement.style.setProperty("--site-header-h", `${el.offsetHeight}px`);
    };
    setVar();
    const observer = new ResizeObserver(setVar);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-amber-500/20 bg-neutral-950/70 backdrop-blur-xl"
    >
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
        {/* 다크 럭셔리 리뉴얼(2026-09-12): 시그니처 엠블럼 + 골드 그라데이션
            워드마크. 이전엔 이 자리 옆(`hidden xl:flex`)에 데스크톱 전용 초대
            코드 입력창(`InviteCodeJoin`)이 있었으나, 대체 없이 완전히
            제거하기로 확정(모달/공유링크 자동입장 파이프라인 모두 이 코드베이스에
            존재하지 않음) — 헤더를 미니멀하게 비웠다. */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap break-keep">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-600 text-sm font-black text-neutral-950 shadow-[0_0_14px_rgba(245,158,11,0.35)]">
            ✦
          </span>
          <span className="flex flex-col leading-none">
            <span className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-500 bg-clip-text font-serif text-sm font-bold tracking-wide text-transparent sm:text-base">
              보드게임 허브
            </span>
            <span className="hidden text-[9px] font-medium tracking-[0.2em] text-amber-500/50 uppercase sm:block">
              Private Lounge
            </span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 sm:gap-3">
          {configured && userId && (
            <button
              onClick={() => setProfileModalOpen(true)}
              className="shrink-0 rounded-full ring-1 ring-amber-400/40 transition hover:opacity-80 hover:ring-amber-300/70"
              aria-label="프로필 이미지 변경"
              title="프로필 이미지 변경"
            >
              <Avatar src={profileAvatarUrl} size={28} />
            </button>
          )}
          {configured && (
            <Link
              href={userId ? "/account" : "/login"}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/20 px-2.5 py-1 text-[11px] text-white/70 hover:border-amber-400/60 sm:text-xs"
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
            className="shrink-0 whitespace-nowrap break-keep text-xs text-white/50 hover:text-amber-200 sm:text-sm"
          >
            💬 로비
          </Link>
          <Link
            href="/history"
            className="shrink-0 whitespace-nowrap break-keep text-xs text-white/50 hover:text-amber-200 sm:text-sm"
          >
            기록
          </Link>
          <Link
            href="/bug-reports"
            className="shrink-0 whitespace-nowrap break-keep text-xs text-white/50 hover:text-amber-200 sm:text-sm"
          >
            🐛 버그 리포트
          </Link>
          <PatchNoteButton />
          <SoundToggleButton />
          <button
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 whitespace-nowrap break-keep rounded-full border border-amber-500/30 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-amber-400/70 hover:text-white hover:shadow-[0_0_16px_rgba(245,158,11,0.25)]"
          >
            {session ? "🎲 내기 진행 중" : "🎲 내기 관리"}
          </button>
        </div>
      </div>
      {profileModalOpen && <ProfileModal onClose={() => setProfileModalOpen(false)} />}
    </header>
  );
}
