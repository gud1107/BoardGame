"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useBettingStore } from "@/store/bettingStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { TIER_LABELS } from "@/lib/entitlements/types";

export default function SiteHeader() {
  const session = useBettingStore((s) => s.session);
  const setSidebarOpen = useBettingStore((s) => s.setSidebarOpen);

  const configured = useSubscriptionStore((s) => s.configured);
  const userId = useSubscriptionStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const entitlement = useSubscriptionStore((s) => s.entitlement);
  const initSubscription = useSubscriptionStore((s) => s.init);

  useEffect(() => {
    void initSubscription();
  }, [initSubscription]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0b12]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span className="text-xl">🎲</span>
          <span className="text-sm font-bold sm:text-base">보드게임 허브</span>
        </Link>
        <div className="flex items-center gap-3">
          {configured && (
            <Link
              href={userId ? "/account" : "/login"}
              className="flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30 sm:text-xs"
              title={
                entitlement
                  ? `오늘 ${entitlement.unit === "games" ? "이용 횟수" : "이용 시간"}: ${entitlement.used}/${entitlement.cap}`
                  : undefined
              }
            >
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-200">
                {userId ? (tier ? TIER_LABELS[tier] : "…") : "게스트"}
              </span>
              {entitlement && (
                <span className="text-white/50">
                  {entitlement.unit === "games"
                    ? `${Math.max(0, entitlement.cap - entitlement.used)}/${entitlement.cap}회`
                    : `${Math.max(0, entitlement.cap - entitlement.used)}/${entitlement.cap}분`}
                </span>
              )}
            </Link>
          )}
          <Link href="/history" className="text-xs text-white/50 hover:text-white/80 sm:text-sm">
            기록
          </Link>
          <Link href="/bug-reports" className="text-xs text-white/50 hover:text-white/80 sm:text-sm">
            🐛 버그 리포트
          </Link>
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-rose-400 hover:text-white"
          >
            {session ? "🎲 내기 진행 중" : "🎲 내기 관리"}
          </button>
        </div>
      </div>
    </header>
  );
}
