"use client";

import Link from "next/link";
import { useBettingStore } from "@/store/bettingStore";

export default function SiteHeader() {
  const session = useBettingStore((s) => s.session);
  const setSidebarOpen = useBettingStore((s) => s.setSidebarOpen);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0b12]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span className="text-xl">🎲</span>
          <span className="text-sm font-bold sm:text-base">보드게임 허브</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/history" className="text-xs text-white/50 hover:text-white/80 sm:text-sm">
            기록
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
