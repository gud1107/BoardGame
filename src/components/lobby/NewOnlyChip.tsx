"use client";

import { NEW_BADGE_DAYS } from "@/constants/gameUpdateCount";

/**
 * "🆕 신규만" toggle that sits after the player-count chips on every lobby
 * layout — narrows the grid to games still wearing the NEW badge (first
 * commit within `NEW_BADGE_DAYS`). Emerald like the badge itself, so it
 * reads as a filter rather than a sort.
 */
export default function NewOnlyChip({
  value,
  onChange,
  compact = false,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  /** Desktop header's smaller chip size. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      title={`최근 ${NEW_BADGE_DAYS}일 안에 추가된 게임만 보기`}
      className={`shrink-0 rounded-full border font-medium whitespace-nowrap transition ${
        compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
      } ${
        value
          ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-200 light:text-emerald-800"
          : "border-white/10 text-white/60 hover:border-emerald-400/40 light:border-slate-200 light:text-slate-600 light:hover:border-emerald-500/50"
      }`}
    >
      🆕 신규만
    </button>
  );
}
