"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useBettingStore } from "@/store/bettingStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useProfileStore } from "@/store/profileStore";
import { TIER_LABELS } from "@/lib/entitlements/types";
import SoundToggleButton from "@/components/audio/SoundToggleButton";
import PatchNoteButton from "@/components/patchNotes/PatchNoteButton";
import ThemeToggle from "@/components/theme/ThemeToggle";
import Avatar from "@/components/common/Avatar";
import { OwnPortraitKeeper, PublicPortraitPublisher, useProfilePhoto } from "@/components/profile/ProfilePhoto";
import ProfileModal from "@/components/profile/ProfileModal";
import { useIsSiteAdmin } from "@/lib/admin/useIsSiteAdmin";

const NAV_LINKS = [
  { href: "/lobby", label: "로비" },
  { href: "/stats", label: "전적" },
  { href: "/history", label: "기록" },
  { href: "/bug-reports", label: "버그 리포트" },
] as const;

const NAV_LINK_CLASS =
  "relative shrink-0 whitespace-nowrap break-keep px-2.5 py-1 text-[13px] tracking-wide text-white/55 transition hover:text-amber-100 after:absolute after:inset-x-2.5 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-amber-300/60 after:transition after:duration-300 hover:after:scale-x-100 light:text-slate-500 light:hover:text-slate-900 light:after:bg-amber-600/60";

const MOBILE_LINK_CLASS =
  "whitespace-nowrap break-keep rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-sm text-white/80 transition active:scale-[0.98] light:border-slate-900/[0.07] light:bg-white/70 light:text-slate-700";

export default function SiteHeader() {
  const session = useBettingStore((s) => s.session);
  const setSidebarOpen = useBettingStore((s) => s.setSidebarOpen);

  const configured = useSubscriptionStore((s) => s.configured);
  const userId = useSubscriptionStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const entitlement = useSubscriptionStore((s) => s.entitlement);
  const initSubscription = useSubscriptionStore((s) => s.init);
  const isSiteAdmin = useIsSiteAdmin(userId);

  const profileAvatarUrl = useProfilePhoto();
  const initProfile = useProfileStore((s) => s.init);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void initSubscription();
  }, [initSubscription]);

  useEffect(() => {
    void initProfile();
  }, [initProfile]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Publishes this header's real rendered height as a CSS var so other
  // sticky layers (e.g. the mobile lobby's sticky search bar, page.tsx) can
  // stack directly beneath it without guessing a fixed px offset. The mobile
  // ☰ menu is absolutely positioned below the bar, so opening it never
  // changes this height (and never shoves the sticky layers around).
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

  const tierLabel = userId ? (tier ? TIER_LABELS[tier] : "…") : "게스트";
  const tierTitle = entitlement
    ? `오늘 ${entitlement.unit === "games" ? "이용 횟수" : "이용 시간"}: ${entitlement.used}/${entitlement.cap}`
    : undefined;

  return (
    <header
      data-site-chrome
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0b0b12]/80 backdrop-blur-xl light:border-slate-900/[0.07] light:bg-[#eceff3]/85"
    >
      {/* Hairline gold rule under the bar — the one accent the chrome keeps. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-300/35 to-transparent light:via-amber-600/30"
      />
      {/* flex-wrap + shrink-0 + break-keep on every label: a squeezed CJK text
          node's min-content width is a single glyph, so without these a narrow
          viewport used to split "보드게임" one character per line. Below `sm`
          the nav and utilities fold into the ☰ menu so the bar stays one row. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-6 sm:py-3">
        <Link href="/" className="group flex shrink-0 items-center gap-3 whitespace-nowrap break-keep">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300/45 font-display text-[13px] font-bold text-amber-200 transition group-hover:border-amber-200/80 light:border-amber-700/40 light:text-amber-800">
            <span aria-hidden className="absolute inset-[3px] rounded-full border border-amber-300/15 light:border-amber-700/15" />
            보
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-[15px] font-bold tracking-[0.06em] text-amber-100 sm:text-base light:text-slate-900">
              보드게임 허브
            </span>
            <span className="mt-1 hidden text-[9px] font-medium tracking-[0.32em] text-amber-200/45 uppercase sm:block light:text-amber-800/60">
              Private Lounge
            </span>
          </span>
        </Link>

        {/* < sm: avatar + ☰ only */}
        <div className="flex items-center gap-2 sm:hidden">
          <button
            onClick={() => setProfileModalOpen(true)}
            className="shrink-0 rounded-full ring-1 ring-amber-300/35 transition hover:ring-amber-200/70"
            aria-label="프로필 수정"
          >
            <Avatar src={profileAvatarUrl} size={28} />
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="site-mobile-menu"
            aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
            className="relative flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-[5px] rounded-full border border-white/12 text-white/80 transition hover:border-amber-300/50 light:border-slate-300 light:text-slate-700"
          >
            <span className={`block h-px w-4 bg-current transition ${menuOpen ? "translate-y-[3px] rotate-45" : ""}`} />
            <span className={`block h-px w-4 bg-current transition ${menuOpen ? "-translate-y-[3px] -rotate-45" : ""}`} />
            {session && !menuOpen && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#0b0b12] light:ring-[#eceff3]" />
            )}
          </button>
        </div>

        {/* sm+: text nav · divider · utilities */}
        <div className="hidden flex-wrap items-center justify-end gap-x-1 gap-y-1.5 sm:flex">
          <nav aria-label="사이트 메뉴" className="mr-2 flex items-center">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={NAV_LINK_CLASS}>
                {l.label}
              </Link>
            ))}
            {isSiteAdmin && (
              <Link href="/admin/games" className={`${NAV_LINK_CLASS} text-amber-300/80! light:text-amber-700!`}>
                관리자
              </Link>
            )}
          </nav>
          <span aria-hidden className="mr-2 h-4 w-px bg-white/10 light:bg-slate-300" />
          <div className="flex items-center gap-2">
            <PatchNoteButton />
            <ThemeToggle />
            <SoundToggleButton />
            {configured && (
              <Link
                href={userId ? "/account" : "/login"}
                className="shrink-0 whitespace-nowrap break-keep rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/65 transition hover:border-amber-300/50 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:text-slate-900"
                title={tierTitle}
              >
                {tierLabel}
              </Link>
            )}
            <button
              onClick={() => setProfileModalOpen(true)}
              className="shrink-0 rounded-full ring-1 ring-amber-300/35 transition hover:ring-amber-200/70"
              aria-label="프로필 수정"
              title="프로필 수정"
            >
              <Avatar src={profileAvatarUrl} size={28} />
            </button>
            <BetButton session={!!session} onClick={() => setSidebarOpen(true)} />
          </div>
        </div>
        <OwnPortraitKeeper />
        <PublicPortraitPublisher />
      </div>

      {menuOpen && (
        <>
          <button
            aria-label="메뉴 닫기"
            tabIndex={-1}
            // absolute, not fixed: the header's backdrop-filter makes it the
            // containing block, so `fixed` would be clipped to the bar itself.
            className="absolute inset-x-0 top-full h-[100dvh] cursor-default bg-black/50 sm:hidden light:bg-slate-900/20"
            onClick={() => setMenuOpen(false)}
          />
          <div
            id="site-mobile-menu"
            className="absolute inset-x-0 top-full border-b border-white/[0.06] bg-[#0d0d15] px-4 pt-3 pb-4 shadow-[0_16px_32px_rgba(0,0,0,0.45)] sm:hidden light:border-slate-900/[0.07] light:bg-[#eceff3] light:shadow-[0_16px_32px_rgba(15,23,42,0.12)]"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
            }}
          >
            <nav aria-label="사이트 메뉴" className="grid grid-cols-2 gap-1.5">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className={MOBILE_LINK_CLASS}>
                  {l.label}
                </Link>
              ))}
              {configured && (
                <Link href={userId ? "/account" : "/login"} className={MOBILE_LINK_CLASS} title={tierTitle}>
                  내 계정 <span className="text-white/40 light:text-slate-500">· {tierLabel}</span>
                </Link>
              )}
              {isSiteAdmin && (
                <Link href="/admin/games" className={MOBILE_LINK_CLASS}>
                  관리자
                </Link>
              )}
            </nav>
            <div className="mt-3 flex items-center gap-2">
              <PatchNoteButton />
              <ThemeToggle />
              <SoundToggleButton />
              <span className="flex-1" />
              <BetButton
                session={!!session}
                onClick={() => {
                  setMenuOpen(false);
                  setSidebarOpen(true);
                }}
              />
            </div>
          </div>
        </>
      )}
      {profileModalOpen && <ProfileModal onClose={() => setProfileModalOpen(false)} />}
    </header>
  );
}

function BetButton({ session, onClick }: { session: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap break-keep rounded-full border border-amber-300/40 bg-amber-300/[0.06] px-3.5 py-1.5 text-xs font-semibold tracking-wide text-amber-100 transition hover:border-amber-200/80 hover:bg-amber-300/[0.12] light:border-amber-700/35 light:bg-amber-50/70 light:text-amber-900 light:hover:border-amber-700/60"
    >
      {session && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
      {session ? "내기 진행 중" : "내기 관리"}
    </button>
  );
}
