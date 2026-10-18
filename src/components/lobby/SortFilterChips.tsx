"use client";

import { ADMIN_SORT_OPTIONS, SORT_OPTIONS, type SortOption } from "@/constants/sortOptions";

/**
 * Gold chip strip for picking the lobby showcase grid's sort order — shared
 * between the mobile/tablet catalog (`src/app/page.tsx`) and the xl+ desktop
 * dashboard (`DesktopDashboard.tsx`), same lift-state-up pattern as the
 * player-count filter chips. `overflow-x-auto no-scrollbar` keeps a narrow
 * mobile viewport from wrapping this to a second line and pushing the
 * 100dvh layout down.
 */
export default function SortFilterChips({
  value,
  onChange,
  className = "",
  admin = false,
}: {
  value: SortOption;
  onChange: (option: SortOption) => void;
  /**
   * Extra classes for the root strip — e.g. `shrink-0` where this sits in a
   * flex row alongside other siblings. Without it, a browser's flex layout
   * treats this `overflow-x-auto` strip as free to shrink below its content
   * width (an `overflow:auto` item's intrinsic min-width is effectively 0),
   * which silently clips the last chip instead of showing a scrollbar (this
   * container hides its scrollbar via `no-scrollbar`) — confirmed 2026-09-16
   * on the desktop dashboard's wide-viewport header, where "난이도 쉬운순"
   * was rendering as just "난이도".
   */
  className?: string;
  /** Site admin — also shows the 🛠 커밋/푸시/배포순 chips (`ADMIN_SORT_OPTIONS`). */
  admin?: boolean;
}) {
  return (
    <div className={`-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 no-scrollbar ${className}`}>
      {SORT_OPTIONS.map((opt) => {
        const isReversed = opt.reverse !== undefined && value === opt.reverse;
        const isActive = value === opt.key || isReversed;
        const arrow = opt.reverse && isActive ? (isReversed ? " ↓" : " ↑") : "";
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.reverse && value === opt.key ? opt.reverse : opt.key)}
            aria-pressed={isActive}
            title={opt.reverse ? (isReversed ? "내림차순 — 다시 누르면 오름차순" : "오름차순 — 다시 누르면 내림차순") : undefined}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 ${
              isActive
                ? "border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)] light:text-amber-700"
                : "border-white/10 text-white/60 hover:border-amber-400/40 light:border-slate-200 light:text-slate-600 light:hover:border-amber-500/50"
            }`}
          >
            {opt.label}
            {arrow}
          </button>
        );
      })}
      {admin && (
        <>
          <span aria-hidden className="mx-0.5 w-px shrink-0 self-stretch bg-white/10 light:bg-slate-200" />
          {ADMIN_SORT_OPTIONS.map((opt) => {
            const isActive = value === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onChange(opt.key)}
                title="관리자 전용 — 게임별 최신 커밋의 커밋/푸시/운영 배포 시각 기준"
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? "border-violet-400 bg-violet-500/20 text-violet-200 light:text-violet-700"
                    : "border-violet-400/25 text-violet-300/70 hover:border-violet-400/60 light:border-violet-200 light:text-violet-600"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
