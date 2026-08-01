import Link from "next/link";
import BettingPanel from "./betting/BettingPanel";

export default function SiteHeader() {
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
          <BettingPanel />
        </div>
      </div>
    </header>
  );
}
