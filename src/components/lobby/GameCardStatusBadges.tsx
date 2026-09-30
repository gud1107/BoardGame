import type { GameFreshnessBadge } from "@/constants/gameUpdateCount";

/** NEW / UPDATED pill pinned to a card thumbnail's top-right (playable games only — 준비중 uses that corner). */
export function FreshnessBadge({ badge }: { badge: GameFreshnessBadge | null }) {
  if (!badge) return null;
  const isNew = badge === "NEW";
  return (
    <span
      className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wider shadow-sm ${
        isNew
          ? "bg-gradient-to-r from-rose-500 to-orange-400 text-white"
          : "bg-gradient-to-r from-sky-500 to-cyan-400 text-white"
      }`}
    >
      {badge}
    </span>
  );
}

const KST_MONTH = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric" });

/** "10월" for the given instant, in Korea time. */
export function kstMonthLabel(now: number): string {
  return KST_MONTH.format(new Date(now));
}

/** "🔥 10월 N회 플레이" (this month's real starts) — hidden at 0 so an empty counter never reads as "unpopular". */
export function PlayCountLabel({ plays, now, className = "" }: { plays: number; now: number; className?: string }) {
  if (plays <= 0) return null;
  return (
    <span className={`text-orange-300/90 light:text-orange-600 ${className}`}>
      🔥 {kstMonthLabel(now)} {plays.toLocaleString("ko-KR")}회 플레이
    </span>
  );
}
